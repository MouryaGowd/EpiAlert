import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { createApp, DEMO_ADMIN_PHONE } from "../src/server.js";

let app: ReturnType<typeof createApp>;
let base = "";

beforeAll(async () => {
  app = createApp({ fixedOtp: "123456" });
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(() => app.close());

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function login(phone: string, name: string) {
  await call("POST", "/api/otp/request", undefined, { phone });
  const r = await call("POST", "/api/otp/verify", undefined, { phone, code: "123456", name });
  expect(r.status).toBe(200);
  return r.json.token as string;
}

const centre = { lat: 12.9759, lng: 77.605 };
const north = (km: number) => ({ lat: centre.lat + km / 111.195, lng: centre.lng });

describe("auth", () => {
  it("protected routes need a token", async () => {
    expect((await call("GET", "/api/me")).status).toBe(401);
    expect((await call("POST", "/api/incidents", "bogus", {})).status).toBe(401);
  });
  it("login works and a wrong code is a 400", async () => {
    await call("POST", "/api/otp/request", undefined, { phone: "+919811111111" });
    const bad = await call("POST", "/api/otp/verify", undefined, { phone: "+919811111111", code: "000000" });
    expect(bad.status).toBe(400);
    const t = await login("+919811111112", "Alice");
    const me = await call("GET", "/api/me", t);
    expect(me.json.user.name).toBe("Alice");
    expect(me.json.user.isAdmin).toBe(false);
  });
  it("only the configured demo admin is an admin, and admin routes are 403 for others", async () => {
    const admin = await login(DEMO_ADMIN_PHONE, "Admin");
    expect((await call("GET", "/api/me", admin)).json.user.isAdmin).toBe(true);
    expect((await call("GET", "/api/admin/queue", admin)).status).toBe(200);
    const user = await login("+919811111113", "Bob");
    expect((await call("GET", "/api/admin/queue", user)).status).toBe(403);
    expect((await call("GET", "/api/demo/overview", user)).status).toBe(403);
    expect((await call("POST", "/api/demo/skip", user, { seconds: 100 })).status).toBe(403);
    expect((await call("POST", "/api/demo/seed", user, centre)).status).toBe(403);
  });
});

describe("end to end over HTTP", () => {
  it("register -> duty -> post -> alert -> respond -> resolve, with no poster identity leaked", async () => {
    const doc = await login("+919822222221", "Dr Anita");
    const poster = await login("+919822222222", "Poster Pat");

    const reg = await call("POST", "/api/responder/register", doc, {
      fullName: "Anita Desai", qualification: "MBBS", regNo: "12345", council: "KMC", regYear: 2010, specialities: ["cardiac"],
    });
    expect(reg.json.status).toBe("verified");
    expect((await call("POST", "/api/duty", doc, { onDuty: true, ...north(1) })).status).toBe(200);

    const post = await call("POST", "/api/incidents", poster, { ...centre, accuracyM: 9, problemType: "cardiac", note: "man collapsed", withPhoto: true });
    expect(post.status).toBe(200);
    const id = post.json.id as string;

    const mine = await call("GET", "/api/me", doc);
    expect(mine.json.alerts).toHaveLength(1);
    expect(mine.json.alerts[0].matchesSpeciality).toBe(true);
    expect(mine.json.inbox[0].kind).toBe("incident_alert");
    expect(JSON.stringify(mine.json)).not.toContain("Poster Pat");

    const photo = await call("POST", `/api/incidents/${id}/photo`, poster, { data: "data:image/jpeg;base64,/9j/AAAA" });
    expect(photo.status).toBe(200);
    expect((await call("GET", "/api/me", doc)).json.alerts[0].photo.state).toBe("ready");

    expect((await call("POST", `/api/incidents/${id}/respond`, poster)).status).toBe(400); // poster was never alerted
    expect((await call("POST", `/api/incidents/${id}/respond`, doc)).status).toBe(200);
    const view = (await call("GET", "/api/me", poster)).json.mine[0];
    expect(view.status).toBe("ACKNOWLEDGED");
    expect(view.responders).toEqual([{ distanceM: 1000 }]);
    expect(JSON.stringify(view)).not.toContain("Dr Anita");

    expect((await call("POST", `/api/incidents/${id}/resolve`, doc)).status).toBe(200);
    expect((await call("GET", "/api/me", poster)).json.mine[0].status).toBe("RESOLVED");
  });

  it("an unverified user cannot go on duty; a stranger cannot read or act on an incident", async () => {
    const u = await login("+919833333331", "Carl");
    expect((await call("POST", "/api/duty", u, { onDuty: true, ...centre })).status).toBe(400);
    const poster = await login("+919833333332", "Dana");
    const { json } = await call("POST", "/api/incidents", poster, { ...north(8), accuracyM: 5, problemType: "other", note: "" });
    expect((await call("POST", `/api/incidents/${json.id}/resolve`, u)).status).toBe(400);
    expect((await call("GET", "/api/me", u)).json.mine).toEqual([]);
  });

  it("manual review path: needs_review -> admin approves -> can go on duty", async () => {
    const admin = await login(DEMO_ADMIN_PHONE, "Admin");
    const u = await login("+919844444441", "Eve");
    const reg = await call("POST", "/api/responder/register", u, {
      fullName: "Eve Unknown", qualification: "Nurse", regNo: "99999", council: "KMC", regYear: 2018, specialities: ["general"],
    });
    expect(reg.json.status).toBe("needs_review");
    expect((await call("GET", "/api/admin/queue", admin)).json.some((p: any) => p.regNo === "99999")).toBe(true);
    const uid = (await call("GET", "/api/me", u)).json.user.uid;
    expect((await call("POST", "/api/admin/decide", admin, { uid, approve: true })).status).toBe(200);
    expect((await call("POST", "/api/duty", u, { onDuty: true, ...centre })).status).toBe(200);
  });

  it("time skip: escalation widens the ring, then expiry removes the incident", async () => {
    const admin = await login(DEMO_ADMIN_PHONE, "Admin");
    const poster = await login("+919855555551", "Fay");
    const { json } = await call("POST", "/api/incidents", poster, { ...north(20), accuracyM: 5, problemType: "other", note: "" });
    await call("POST", "/api/demo/skip", admin, { seconds: 70 });
    expect((await call("GET", "/api/me", poster)).json.mine.find((i: any) => i.id === json.id).radiusKm).toBe(3);
    await call("POST", "/api/demo/skip", admin, { seconds: 120 });
    expect((await call("GET", "/api/me", poster)).json.mine.find((i: any) => i.id === json.id).notice).toMatch(/108/);
    await call("POST", "/api/demo/skip", admin, { seconds: 25 * 3600 });
    expect((await call("GET", "/api/me", poster)).json.mine.find((i: any) => i.id === json.id)).toBeUndefined();
    expect((await call("POST", "/api/demo/skip", admin, { seconds: -5 })).status).toBe(400);
  });

  it("rejects malformed JSON and unknown routes", async () => {
    const t = await login("+919866666661", "Gus");
    const res = await fetch(base + "/api/incidents", { method: "POST", headers: { Authorization: `Bearer ${t}` }, body: "{not json" });
    expect(res.status).toBe(400);
    expect((await call("GET", "/api/nope", t)).status).toBe(404);
  });
});

describe("static files", () => {
  it("does not serve files outside the web directory", async () => {
    for (const p of ["/../package.json", "/%2e%2e/package.json", "/..%2fpackage.json"]) {
      const res = await fetch(base + p);
      expect([403, 404]).toContain(res.status);
      expect(await res.text()).not.toContain("epialert-functions");
    }
  });
  it("sends a strict CSP and nosniff", async () => {
    const res = await fetch(base + "/api/nope", { headers: { Authorization: "Bearer x" } });
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
