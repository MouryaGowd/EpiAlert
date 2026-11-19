import http from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Engine,
  EngineError,
  MockVerifier,
  type AlertMessage,
  type Clock,
  type Notifier,
  type Speciality,
} from "./engine.js";
import { OtpAuth, uidForPhone } from "./otp.js";
import type { LatLng } from "./geo.js";

const MAX_BODY = 1_000_000;
const INBOX_MAX = 50;
export const DEMO_ADMIN_PHONE = "+919999999999";

/** Real time plus an offset the admin can advance, so escalation and expiry can be demoed. */
export class OffsetClock implements Clock {
  offsetMs = 0;
  now() {
    return Date.now() + this.offsetMs;
  }
}

type Sse = http.ServerResponse;

/** Never throws: every message lands in the user's inbox and is pushed live if a tab is open. */
class InboxNotifier implements Notifier {
  inbox = new Map<string, (AlertMessage & { at: number })[]>();
  streams = new Map<string, Set<Sse>>();
  constructor(private clock: Clock) {}
  send(uid: string, msg: AlertMessage) {
    const list = this.inbox.get(uid) ?? [];
    list.push({ ...msg, at: this.clock.now() });
    this.inbox.set(uid, list.slice(-INBOX_MAX));
    for (const res of this.streams.get(uid) ?? []) res.write(`event: notify\ndata: ${JSON.stringify(msg)}\n\n`);
  }
}

const DEMO_REGISTRY: [string, string, { name: string; active: boolean; blacklisted?: boolean }][] = [
  ["KMC", "12345", { name: "Dr. Anita Desai", active: true }],
  ["KMC", "23456", { name: "Rohit Sharma", active: true }],
  ["KMC", "34567", { name: "Meera Nair", active: false }],
  ["KMC", "45678", { name: "Vikram Rao", active: true, blacklisted: true }],
  ["KMC", "56789", { name: "Kavya Kumari Shetty", active: true }],
];

const SEED_SPOTS: { km: number; bearing: number; specs: Speciality[] }[] = [
  { km: 0.6, bearing: 20, specs: ["general"] },
  { km: 1.1, bearing: 110, specs: ["cardiac", "general"] },
  { km: 1.5, bearing: 200, specs: ["trauma"] },
  { km: 1.8, bearing: 290, specs: ["breathing"] },
  { km: 2.3, bearing: 45, specs: ["bone", "general"] },
  { km: 2.6, bearing: 160, specs: ["cardiac"] },
  { km: 2.9, bearing: 250, specs: ["general"] },
  { km: 3.4, bearing: 330, specs: ["cardiac", "trauma"] },
];

function offset(c: LatLng, km: number, bearingDeg: number): LatLng {
  const b = (bearingDeg * Math.PI) / 180;
  return {
    lat: c.lat + (km * Math.cos(b)) / 111.195,
    lng: c.lng + (km * Math.sin(b)) / (111.195 * Math.cos((c.lat * Math.PI) / 180)),
  };
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(self), geolocation=(self)",
};

/** Works from both src/ (tests) and lib/src/ (built): walk up to the first folder holding web/index.html. */
function findWebDir(from: string): string {
  for (let dir = from, i = 0; i < 5; i++, dir = path.dirname(dir)) {
    const candidate = path.join(dir, "web");
    if (existsSync(path.join(candidate, "index.html"))) return candidate;
  }
  throw new Error("web/ folder not found");
}

export interface AppOptions {
  webDir?: string;
  fixedOtp?: string;
  adminPhones?: string[];
}

export function createApp(opts: AppOptions = {}) {
  const webDir = path.resolve(opts.webDir ?? findWebDir(path.dirname(fileURLToPath(import.meta.url))));
  const clock = new OffsetClock();
  const notifier = new InboxNotifier(clock);
  const verifier = new MockVerifier();
  for (const [c, n, r] of DEMO_REGISTRY) verifier.records.set(MockVerifier.key(c, n), r);
  const adminPhones = opts.adminPhones ?? [DEMO_ADMIN_PHONE];
  const engine = new Engine({ clock, notifier, verifier, admins: adminPhones.map(uidForPhone) });
  const auth = new OtpAuth(clock, opts.fixedOtp ? () => opts.fixedOtp! : undefined);
  const seeded = new Map<string, LatLng>();

  const timers = [
    setInterval(() => engine.escalateStale(), 5000), // spec: every minute; 5 s keeps the demo responsive
    setInterval(() => engine.expireSweep(), 60_000),
    setInterval(() => {
      for (const [uid, at] of seeded) engine.setDuty(uid, true, at); // simulated periodic location update
    }, 60_000),
  ];
  for (const t of timers) t.unref();

  function seedResponders(centre: LatLng) {
    let i = seeded.size;
    for (const s of SEED_SPOTS) {
      i++;
      const uid = `seed_${i}`;
      const at = offset(centre, s.km, s.bearing);
      engine.addUser(uid, `Demo Responder ${i}`);
      verifier.records.set(MockVerifier.key("KMC", uid), { name: `Demo Responder ${i}`, active: true });
      void engine
        .registerResponder(uid, {
          fullName: `Demo Responder ${i}`,
          qualification: "MBBS",
          regNo: uid,
          council: "KMC",
          regYear: 2015,
          specialities: s.specs,
        })
        .then(() => {
          seeded.set(uid, at);
          engine.setDuty(uid, true, at);
        });
    }
  }

  // ---- http plumbing ------------------------------------------------------------------
  const json = (res: http.ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", ...SECURITY_HEADERS });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: http.IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new EngineError("request too large"));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        try {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve(text ? (JSON.parse(text) as Record<string, unknown>) : {});
        } catch {
          reject(new EngineError("invalid JSON"));
        }
      });
      req.on("error", reject);
    });
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

  async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const route = `${req.method} ${url.pathname}`;
    const body = req.method === "POST" ? await readBody(req) : {};

    if (route === "POST /api/otp/request") return json(res, 200, { code: auth.request(str(body.phone)), demo: true });
    if (route === "POST /api/otp/verify") {
      const { uid, token } = auth.verify(str(body.phone), str(body.code));
      engine.addUser(uid, str(body.name).trim().slice(0, 40) || `User ${uid.slice(-4)}`);
      return json(res, 200, { token });
    }

    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const uid = auth.uidForToken(bearer || url.searchParams.get("token") || "");
    if (!uid) return json(res, 401, { error: "Please log in" });

    if (route === "GET /api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", ...SECURITY_HEADERS });
      res.write("retry: 3000\n\n");
      const set = notifier.streams.get(uid) ?? new Set<Sse>();
      set.add(res);
      notifier.streams.set(uid, set);
      req.on("close", () => set.delete(res));
      return;
    }
    if (route === "GET /api/me") {
      return json(res, 200, { ...engine.snapshot(uid), inbox: (notifier.inbox.get(uid) ?? []).slice(-10), now: clock.now() });
    }

    if (route === "POST /api/responder/register") {
      const status = await engine.registerResponder(uid, {
        fullName: str(body.fullName),
        qualification: str(body.qualification),
        regNo: str(body.regNo),
        council: str(body.council),
        regYear: num(body.regYear),
        specialities: (Array.isArray(body.specialities) ? body.specialities : []) as Speciality[],
      });
      return json(res, 200, { status });
    }
    if (route === "POST /api/responder/specialities") {
      engine.setSpecialities(uid, (Array.isArray(body.specialities) ? body.specialities : []) as Speciality[]);
      return json(res, 200, { ok: true });
    }
    if (route === "POST /api/duty") {
      engine.setDuty(uid, body.onDuty === true, { lat: num(body.lat), lng: num(body.lng) });
      return json(res, 200, { ok: true });
    }
    if (route === "POST /api/incidents") {
      const r = engine.createIncident(uid, {
        lat: num(body.lat),
        lng: num(body.lng),
        accuracyM: num(body.accuracyM) || 0,
        problemType: str(body.problemType) as never,
        note: str(body.note),
        withPhoto: body.withPhoto === true,
      });
      return json(res, 200, r);
    }

    const m = /^POST \/api\/incidents\/([0-9a-f-]{36})\/(photo|respond|resolve|cancel|flag)$/.exec(route);
    if (m) {
      const [, id, action] = m;
      if (action === "photo") engine.setPhoto(id, uid, body.data === null ? null : str(body.data));
      else if (action === "respond") engine.respond(id, uid);
      else if (action === "resolve") engine.resolve(id, uid);
      else if (action === "cancel") engine.cancel(id, uid);
      else engine.flag(id, uid);
      return json(res, 200, { ok: true });
    }

    // admin + demo controls
    if (route === "GET /api/admin/queue") return json(res, 200, engine.adminQueue(uid));
    if (route === "POST /api/admin/decide") {
      engine.adminDecide(uid, str(body.uid), body.approve === true, str(body.reason));
      return json(res, 200, { ok: true });
    }
    if (route === "GET /api/demo/overview") {
      engine.adminQueue(uid); // throws unless admin
      return json(res, 200, { ...engine.demoOverview(), audit: engine.audit.slice(-20), registry: DEMO_REGISTRY.map(([c, n, r]) => ({ council: c, regNo: n, ...r })), offsetS: Math.round(clock.offsetMs / 1000) });
    }
    if (route === "POST /api/demo/seed") {
      engine.adminQueue(uid);
      seedResponders({ lat: num(body.lat), lng: num(body.lng) });
      return json(res, 200, { ok: true });
    }
    if (route === "POST /api/demo/skip") {
      engine.adminQueue(uid);
      const s = num(body.seconds);
      if (!(s > 0 && s <= 48 * 3600)) throw new EngineError("seconds must be between 1 and 172800");
      clock.offsetMs += s * 1000;
      for (const [id, at] of seeded) engine.setDuty(id, true, at); // simulated periodic updates keep seeded responders fresh
      engine.escalateStale();
      engine.expireSweep();
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: "not found" });
  }

  async function serveStatic(res: http.ServerResponse, pathname: string) {
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = path.resolve(webDir, rel);
    if (file !== webDir && !file.startsWith(webDir + path.sep)) return json(res, 403, { error: "forbidden" });
    try {
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache", ...SECURITY_HEADERS });
      res.end(data);
    } catch {
      json(res, 404, { error: "not found" });
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const run = url.pathname.startsWith("/api/") ? api(req, res, url) : serveStatic(res, url.pathname);
    run.catch((err: unknown) => {
      if (res.headersSent) return res.end();
      if (err instanceof EngineError) return json(res, err.message === "admin only" ? 403 : 400, { error: err.message });
      if (err instanceof Error && /code|phone|locked|Locked|Request a code|expired|Invalid/.test(err.message)) return json(res, 400, { error: err.message });
      console.error(err);
      json(res, 500, { error: "internal error" });
    });
  });

  return {
    server,
    engine,
    clock,
    close: () =>
      new Promise<void>((resolve) => {
        for (const t of timers) clearInterval(t);
        for (const set of notifier.streams.values()) for (const r of set) r.end();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 3000);
  const app = createApp();
  app.server.listen(port, "127.0.0.1", () => {
    console.log(`EpiAlert prototype on http://localhost:${port}  (demo admin phone ${DEMO_ADMIN_PHONE})`);
  });
}
