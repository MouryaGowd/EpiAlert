import { describe, it, expect, beforeEach } from "vitest";
import {
  Engine,
  MockVerifier,
  ManualReviewVerifier,
  EngineError,
  ALERT_CAP,
  type Clock,
  type Notifier,
  type AlertMessage,
  type Speciality,
  type Verifier,
} from "../src/engine.js";

class FakeClock implements Clock {
  t = 1_700_000_000_000;
  now() {
    return this.t;
  }
  advance(seconds: number) {
    this.t += seconds * 1000;
  }
}

class FakeNotifier implements Notifier {
  sent: { uid: string; msg: AlertMessage }[] = [];
  failFor = new Set<string>();
  send(uid: string, msg: AlertMessage) {
    if (this.failFor.has(uid)) throw new Error("fcm unavailable");
    this.sent.push({ uid, msg });
  }
  uidsOf(kind: AlertMessage["kind"]) {
    return this.sent.filter((s) => s.msg.kind === kind).map((s) => s.uid);
  }
}

const centre = { lat: 12.9759, lng: 77.605 };
const north = (km: number) => ({ lat: centre.lat + km / 111.195, lng: centre.lng });

const pos = new Map<string, { lat: number; lng: number }>();
let clock: FakeClock;
let notifier: FakeNotifier;
let verifier: MockVerifier;
let e: Engine;

beforeEach(() => {
  pos.clear();
  clock = new FakeClock();
  notifier = new FakeNotifier();
  verifier = new MockVerifier();
  e = new Engine({ clock, notifier, verifier, admins: ["admin"] });
  e.addUser("admin", "Admin");
});

async function addResponder(
  uid: string,
  at: { lat: number; lng: number } | null,
  specialities: Speciality[] = ["general"],
) {
  e.addUser(uid, uid);
  verifier.records.set(MockVerifier.key("KMC", uid), { name: `Dr ${uid}`, active: true });
  const status = await e.registerResponder(uid, {
    fullName: `Dr ${uid}`,
    qualification: "MBBS",
    regNo: uid,
    council: "KMC",
    regYear: 2015,
    specialities,
  });
  expect(status).toBe("verified");
  if (at) {
    pos.set(uid, at);
    e.setDuty(uid, true, at);
  }
}

/** Re-send a fresh location so these responders are inside the freshness window. */
function refresh(...uids: string[]) {
  for (const uid of uids) e.setDuty(uid, true, pos.get(uid)!);
}

describe("verification (US-2)", () => {
  const form = (over: Partial<Parameters<Engine["registerResponder"]>[1]> = {}) => ({
    fullName: "Anita Desai",
    qualification: "MBBS",
    regNo: "12345",
    council: "KMC",
    regYear: 2010,
    specialities: ["general"] as Speciality[],
    ...over,
  });

  it("registry match with same name and active -> verified", async () => {
    verifier.records.set("KMC:12345", { name: "Dr. Anita Desai", active: true });
    e.addUser("u", "u");
    expect(await e.registerResponder("u", form())).toBe("verified");
    expect(e.snapshot("u").profile?.status).toBe("verified");
  });

  it("no registry record -> needs_review, never auto-approved", async () => {
    e.addUser("u", "u");
    expect(await e.registerResponder("u", form())).toBe("needs_review");
  });

  it("different name -> rejected with a visible reason", async () => {
    verifier.records.set("KMC:12345", { name: "Rohit Sharma", active: true });
    e.addUser("u", "u");
    expect(await e.registerResponder("u", form())).toBe("rejected");
    expect(e.snapshot("u").profile?.reason).toMatch(/name/i);
  });

  it("same surname but different given name is ambiguous -> needs_review", async () => {
    verifier.records.set("KMC:12345", { name: "Anita Kumari Desai", active: true });
    e.addUser("u", "u");
    expect(await e.registerResponder("u", form({ fullName: "Anita Desai" }))).toBe("needs_review");
  });

  it("inactive and blacklisted registrations -> rejected", async () => {
    verifier.records.set("KMC:1", { name: "Anita Desai", active: false });
    verifier.records.set("KMC:2", { name: "Anita Desai", active: true, blacklisted: true });
    e.addUser("a", "a");
    e.addUser("b", "b");
    expect(await e.registerResponder("a", form({ regNo: "1" }))).toBe("rejected");
    expect(await e.registerResponder("b", form({ regNo: "2" }))).toBe("rejected");
  });

  it("council is mandatory and part of the key (numbers collide across councils)", async () => {
    verifier.records.set("KMC:12345", { name: "Anita Desai", active: true });
    e.addUser("u", "u");
    expect(await e.registerResponder("u", form({ council: "TNMC" }))).toBe("needs_review");
    await expect(e.registerResponder("u", form({ council: "" }))).rejects.toBeInstanceOf(EngineError);
  });

  it("verifier that throws or hangs -> needs_review", async () => {
    const boom: Verifier = { verify: async () => Promise.reject(new Error("registry down")) };
    const hang: Verifier = { verify: () => new Promise(() => {}) };
    const e1 = new Engine({ clock, notifier, verifier: boom });
    const e2 = new Engine({ clock, notifier, verifier: hang, verifyTimeoutMs: 10 });
    e1.addUser("u", "u");
    e2.addUser("u", "u");
    expect(await e1.registerResponder("u", form())).toBe("needs_review");
    expect(await e2.registerResponder("u", form())).toBe("needs_review");
  });

  it("ManualReviewVerifier always defers to a human; admin decides", async () => {
    const m = new Engine({ clock, notifier, verifier: new ManualReviewVerifier(), admins: ["admin"] });
    m.addUser("admin", "Admin");
    m.addUser("u", "u");
    expect(await m.registerResponder("u", form())).toBe("needs_review");
    expect(() => m.adminDecide("u", "u", true)).toThrow(EngineError); // not an admin
    expect(m.adminQueue("admin").map((p) => p.uid)).toEqual(["u"]);
    m.adminDecide("admin", "u", true);
    expect(m.snapshot("u").profile?.status).toBe("verified");
    expect(m.snapshot("u").profile?.verifiedBy).toBe("manual");
  });

  it("only verified responders can go on duty; off duty stops sharing immediately", async () => {
    e.addUser("u", "u");
    await e.registerResponder("u", form());
    expect(() => e.setDuty("u", true, centre)).toThrow(EngineError);
    await addResponder("r", centre);
    expect(e.demoOverview().responders.map((r) => r.uid)).toContain("r");
    e.setDuty("r", false);
    expect(e.demoOverview().responders.map((r) => r.uid)).not.toContain("r");
  });
});

describe("alert eligibility (spec 3.3, section 10)", () => {
  it("notifies ONLY on-duty, verified, fresh, in-radius, non-suspended, non-poster responders", async () => {
    await addResponder("poster", centre); // poster is also a responder
    await addResponder("in", north(1.0));
    await addResponder("off", north(0.5));
    e.setDuty("off", false);
    await addResponder("far", north(3.1));
    await addResponder("mid", north(2.1));
    await addResponder("susp", north(0.7));
    e.adminSuspend("admin", "susp");
    await addResponder("stale", north(0.6));
    // unverified user cannot be on duty at all
    e.addUser("unverified", "unverified");
    await e.registerResponder("unverified", {
      fullName: "Nobody",
      qualification: "MBBS",
      regNo: "999",
      council: "KMC",
      regYear: 2020,
      specialities: ["general"],
    });
    clock.advance(11 * 60); // "stale" last updated 11 min ago
    refresh("poster", "in", "far", "mid", "susp"); // everyone except "stale" and "off"

    e.createIncident("poster", { ...centre, accuracyM: 12, problemType: "cardiac", note: "" });
    expect(notifier.uidsOf("incident_alert")).toEqual(["in"]);
  });

  it("1.9 km in, 2.1 km out at first ring then in after escalation, 3.1 km never", async () => {
    e.addUser("p", "p");
    await addResponder("r19", north(1.9));
    await addResponder("r21", north(2.1));
    await addResponder("r31", north(3.1));
    e.createIncident("p", { ...centre, accuracyM: 10, problemType: "bleeding", note: "" });
    expect(notifier.uidsOf("incident_alert")).toEqual(["r19"]);

    clock.advance(61);
    refresh("r19", "r21", "r31");
    e.escalateStale();
    expect(notifier.uidsOf("incident_alert").sort()).toEqual(["r19", "r21"]);
    expect(notifier.uidsOf("incident_alert").filter((u) => u === "r19")).toHaveLength(1); // not re-alerted
    clock.advance(200);
    e.escalateStale();
    expect(notifier.uidsOf("incident_alert")).not.toContain("r31");
  });

  it("ranks speciality match first, then distance, and caps at N=20 per ring", async () => {
    e.addUser("p", "p");
    for (let i = 0; i < 25; i++) await addResponder(`g${i}`, north(0.1 + i * 0.01), ["general"]);
    for (let i = 0; i < 5; i++) await addResponder(`c${i}`, north(1.5 + i * 0.05), ["cardiac"]);
    e.createIncident("p", { ...centre, accuracyM: 10, problemType: "cardiac", note: "" });
    const alerted = notifier.uidsOf("incident_alert");
    expect(alerted).toHaveLength(ALERT_CAP);
    for (let i = 0; i < 5; i++) expect(alerted).toContain(`c${i}`);
    expect(alerted.slice(0, 5)).toEqual(["c0", "c1", "c2", "c3", "c4"]);
  });

  it("is idempotent: a duplicate trigger sends nothing new", async () => {
    e.addUser("p", "p");
    await addResponder("r", north(1));
    const { id } = e.createIncident("p", { ...centre, accuracyM: 10, problemType: "other", note: "" });
    expect(e.alertIncident(id)).toBe(0);
    expect(notifier.uidsOf("incident_alert")).toEqual(["r"]);
  });

  it("a notifier failure mid-batch does not stop the rest", async () => {
    e.addUser("p", "p");
    await addResponder("a", north(0.5));
    await addResponder("b", north(0.6));
    await addResponder("c", north(0.7));
    notifier.failFor.add("b");
    e.createIncident("p", { ...centre, accuracyM: 10, problemType: "other", note: "" });
    expect(notifier.uidsOf("incident_alert")).toEqual(["a", "c"]);
  });
});

describe("dedupe and abuse", () => {
  beforeEach(async () => {
    e.addUser("p", "p");
    e.addUser("q", "q");
    await addResponder("r", north(1));
  });

  it("merges a report within 100 m and 10 min without re-alerting", () => {
    const first = e.createIncident("p", { ...centre, accuracyM: 10, problemType: "cardiac", note: "" });
    const second = e.createIncident("q", { ...north(0.05), accuracyM: 10, problemType: "cardiac", note: "" });
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    expect(notifier.uidsOf("incident_alert")).toHaveLength(1);
    expect(e.incidentForPoster("q", first.id)?.reportCount).toBe(2);
  });

  it("does not merge beyond 100 m or after 10 min", () => {
    const first = e.createIncident("p", { ...centre, accuracyM: 10, problemType: "cardiac", note: "" });
    expect(e.createIncident("q", { ...north(0.2), accuracyM: 10, problemType: "cardiac", note: "" }).id).not.toBe(first.id);
    clock.advance(11 * 60);
    refresh("r");
    expect(e.createIncident("q", { ...centre, accuracyM: 10, problemType: "cardiac", note: "" }).id).not.toBe(first.id);
  });

  it("rate-limits posts (3 per 10 minutes)", () => {
    for (let i = 0; i < 3; i++) e.createIncident("p", { ...north(i), accuracyM: 10, problemType: "other", note: "" });
    expect(() => e.createIncident("p", { ...north(9), accuracyM: 10, problemType: "other", note: "" })).toThrow(/rate/i);
    clock.advance(11 * 60);
    expect(() => e.createIncident("p", { ...north(9), accuracyM: 10, problemType: "other", note: "" })).not.toThrow();
  });

  it("flags hide the post; repeated false posts suspend the poster", async () => {
    await addResponder("r2", north(1.1));
    const a = e.createIncident("p", { ...north(0), accuracyM: 10, problemType: "other", note: "" });
    e.flag(a.id, "r");
    expect(e.incidentForResponder("r", a.id)).not.toBeNull(); // 1 flag is below the threshold
    e.flag(a.id, "r2");
    expect(e.incidentForPoster("p", a.id)?.status).toBe("FLAGGED");
    pos.set("r", north(6));
    pos.set("r2", north(6));
    refresh("r", "r2");
    const b = e.createIncident("p", { ...north(5), accuracyM: 10, problemType: "other", note: "" });
    e.flag(b.id, "r");
    e.flag(b.id, "r2");
    expect(e.snapshot("p").user.suspended).toBe(true);
    expect(() => e.createIncident("p", { ...north(7), accuracyM: 10, problemType: "other", note: "" })).toThrow(EngineError);
  });

  it("a responder flags once, and only for incidents they were alerted to", async () => {
    await addResponder("far", north(3.5));
    const a = e.createIncident("p", { ...centre, accuracyM: 10, problemType: "other", note: "" });
    expect(() => e.flag(a.id, "far")).toThrow(EngineError);
    e.flag(a.id, "r");
    e.flag(a.id, "r");
    expect(e.demoOverview().incidents[0].flagCount).toBe(1);
  });
});

describe("responding and state machine (US-6)", () => {
  let id: string;
  beforeEach(async () => {
    e.addUser("p", "p");
    await addResponder("r", north(1.04)); // 1040 m away, rounds to 1000
    await addResponder("far", north(3.5));
    id = e.createIncident("p", { ...centre, accuracyM: 10, problemType: "cardiac", note: "x" }).id;
  });

  it("only an alerted responder can say I'm coming; ack is idempotent", () => {
    expect(() => e.respond(id, "far")).toThrow(EngineError);
    e.respond(id, "r");
    e.respond(id, "r");
    const v = e.incidentForPoster("p", id)!;
    expect(v.status).toBe("ACKNOWLEDGED");
    expect(v.ackCount).toBe(1);
    expect(notifier.uidsOf("responder_coming")).toEqual(["p"]);
  });

  it("poster sees only responder count and distance rounded to 100 m", () => {
    e.respond(id, "r");
    expect(e.incidentForPoster("p", id)!.responders).toEqual([{ distanceM: 1000 }]);
  });

  it("responder view never contains the poster's identity", () => {
    const v = e.incidentForResponder("r", id)!;
    expect(JSON.stringify(v)).not.toContain('"p"');
    expect(Object.keys(v)).not.toContain("createdBy");
    expect(v.matchesSpeciality).toBe(false);
  });

  it("resolve needs ACKNOWLEDGED; OPEN can only be cancelled", () => {
    expect(() => e.resolve(id, "p")).toThrow(EngineError);
    e.respond(id, "r");
    e.resolve(id, "r");
    expect(e.incidentForPoster("p", id)!.status).toBe("RESOLVED");
    expect(() => e.cancel(id, "p")).toThrow(EngineError);
  });

  it("only the poster can cancel; strangers cannot resolve or read", () => {
    expect(() => e.cancel(id, "r")).toThrow(EngineError);
    e.respond(id, "r");
    expect(() => e.resolve(id, "far")).toThrow(EngineError);
    expect(e.incidentForPoster("far", id)).toBeNull();
    expect(e.incidentForResponder("far", id)).toBeNull();
  });
});

describe("escalation (US-5, spec 3.3 step 6)", () => {
  it("no ack at 180 s tells the poster to call 108; an ack prevents escalation", async () => {
    e.addUser("p", "p");
    e.addUser("p2", "p2");
    await addResponder("r", north(1));
    await addResponder("mid", north(2.5));
    const quiet = e.createIncident("p", { ...centre, accuracyM: 10, problemType: "other", note: "" });
    pos.set("r", north(5.5));
    refresh("r");
    const acked = e.createIncident("p2", { ...north(5), accuracyM: 10, problemType: "other", note: "" });
    e.respond(acked.id, "r");
    clock.advance(61);
    refresh("mid");
    e.escalateStale();
    expect(e.incidentForPoster("p", quiet.id)!.radiusKm).toBe(3);
    expect(e.incidentForPoster("p2", acked.id)!.radiusKm).toBe(2);
    clock.advance(120);
    e.escalateStale();
    e.escalateStale(); // runs every minute; must only notify once
    expect(notifier.uidsOf("no_ack")).toEqual(["p"]);
    expect(e.incidentForPoster("p", quiet.id)!.notice).toMatch(/108/);
  });
});

describe("expiry and audit (US-7, ADR-4)", () => {
  it("expired incident is unreadable before the sweeper runs; sweeper deletes it", async () => {
    e.addUser("p", "p");
    await addResponder("r", north(1));
    const { id } = e.createIncident("p", { ...centre, accuracyM: 10, problemType: "other", note: "" });
    clock.advance(24 * 3600 - 1);
    expect(e.incidentForPoster("p", id)).not.toBeNull();
    clock.advance(2);
    expect(e.incidentForPoster("p", id)).toBeNull();
    expect(e.incidentForResponder("r", id)).toBeNull();
    expect(e.snapshot("p").mine).toEqual([]);
    expect(e.demoOverview().incidents).toHaveLength(1); // still stored until the sweeper
    expect(e.expireSweep()).toBe(1);
    expect(e.demoOverview().incidents).toHaveLength(0);
  });

  it("audit log is anonymised: no uids, names, exact location or note", async () => {
    e.addUser("poster-uid-123", "Secret Name");
    await addResponder("responder-uid-456", north(1));
    const { id } = e.createIncident("poster-uid-123", { ...centre, accuracyM: 10, problemType: "cardiac", note: "private note" });
    clock.advance(30);
    e.respond(id, "responder-uid-456");
    e.resolve(id, "poster-uid-123");
    clock.advance(25 * 3600);
    e.expireSweep();
    expect(e.audit).toHaveLength(1); // one entry per incident, written when it ends
    const text = JSON.stringify(e.audit);
    for (const secret of ["poster-uid-123", "responder-uid-456", "Secret Name", "private note", String(centre.lat)]) {
      expect(text).not.toContain(secret);
    }
    expect(e.audit[0]).toMatchObject({ outcome: "resolved", problemType: "cardiac", ackCount: 1, timeToFirstAckS: 30 });
    expect(e.audit[0].roughArea).toHaveLength(5);
  });

  it("an unresolved incident ends as expired in the audit log", async () => {
    e.addUser("p", "p");
    e.createIncident("p", { ...centre, accuracyM: 10, problemType: "other", note: "" });
    clock.advance(24 * 3600 + 1);
    e.expireSweep();
    expect(e.audit[0].outcome).toBe("expired");
    expect(e.audit[0].timeToFirstAckS).toBeNull();
  });
});

describe("input validation", () => {
  it("rejects bad coordinates and unknown problem types", () => {
    e.addUser("p", "p");
    expect(() => e.createIncident("p", { lat: 120, lng: 0, accuracyM: 5, problemType: "other", note: "" })).toThrow(EngineError);
    expect(() => e.createIncident("p", { ...centre, accuracyM: 5, problemType: "nope" as never, note: "" })).toThrow(EngineError);
    expect(() => e.createIncident("ghost", { ...centre, accuracyM: 5, problemType: "other", note: "" })).toThrow(EngineError);
  });
});
