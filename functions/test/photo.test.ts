import { describe, it, expect, beforeEach } from "vitest";
import { Engine, MockVerifier, EngineError, MAX_PHOTO_CHARS, type AlertMessage, type Notifier } from "../src/engine.js";

class Rec implements Notifier {
  sent: { uid: string; msg: AlertMessage }[] = [];
  send(uid: string, msg: AlertMessage) {
    this.sent.push({ uid, msg });
  }
}

const centre = { lat: 12.9759, lng: 77.605 };
const north = (km: number) => ({ lat: centre.lat + km / 111.195, lng: centre.lng });
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";

const clock = { t: 1_700_000_000_000, now() { return this.t; } };
let e: Engine;
let n: Rec;
let id: string;

beforeEach(async () => {
  clock.t = 1_700_000_000_000;
  n = new Rec();
  const v = new MockVerifier();
  e = new Engine({ clock, notifier: n, verifier: v });
  for (const u of ["p", "r", "far", "stranger"]) e.addUser(u, u);
  for (const [u, km] of [["r", 1], ["far", 3.5]] as const) {
    v.records.set(`KMC:${u}`, { name: `Dr ${u}`, active: true });
    await e.registerResponder(u, { fullName: `Dr ${u}`, qualification: "MBBS", regNo: u, council: "KMC", regYear: 2012, specialities: ["general"] });
    e.setDuty(u, true, north(km));
  }
  id = e.createIncident("p", { ...centre, accuracyM: 8, problemType: "other", note: "", withPhoto: true }).id;
});

describe("alert first, photo later (ADR-1)", () => {
  it("the alert fires while the photo is still pending", () => {
    expect(n.sent.filter((s) => s.msg.kind === "incident_alert").map((s) => s.uid)).toEqual(["r"]);
    expect(e.incidentForPoster("p", id)!.photo.state).toBe("pending");
    expect(e.incidentForResponder("r", id)!.photo.state).toBe("pending");
  });

  it("an incident posted without a photo has state none", () => {
    const other = e.createIncident("p", { ...north(9), accuracyM: 8, problemType: "other", note: "" });
    expect(e.incidentForPoster("p", other.id)!.photo.state).toBe("none");
  });

  it("a rejected (failed blur) photo leaves the alert standing", () => {
    e.setPhoto(id, "p", null);
    expect(e.incidentForPoster("p", id)!.photo).toEqual({ state: "rejected", data: null });
    expect(e.incidentForPoster("p", id)!.status).toBe("OPEN");
    expect(e.incidentForResponder("r", id)!.photo.state).toBe("rejected");
  });

  it("a ready photo is visible to the poster and alerted responders only", () => {
    e.setPhoto(id, "p", JPEG);
    expect(e.incidentForPoster("p", id)!.photo).toEqual({ state: "ready", data: JPEG });
    expect(e.incidentForResponder("r", id)!.photo.data).toBe(JPEG);
    expect(e.incidentForResponder("far", id)).toBeNull();
    expect(e.incidentForPoster("stranger", id)).toBeNull();
  });
});

describe("photo input checks", () => {
  it("only a reporter can attach a photo", () => {
    expect(() => e.setPhoto(id, "r", JPEG)).toThrow(EngineError);
    expect(() => e.setPhoto(id, "stranger", JPEG)).toThrow(EngineError);
  });
  it("only a jpeg data URL under the size cap is accepted", () => {
    expect(() => e.setPhoto(id, "p", "http://evil/x.jpg")).toThrow(EngineError);
    expect(() => e.setPhoto(id, "p", "data:image/png;base64,AAAA")).toThrow(EngineError);
    expect(() => e.setPhoto(id, "p", "data:image/jpeg;base64," + "A".repeat(MAX_PHOTO_CHARS))).toThrow(EngineError);
    expect(e.incidentForPoster("p", id)!.photo.state).toBe("pending");
  });
  it("a photo cannot be attached to an incident that did not ask for one", () => {
    const other = e.createIncident("p", { ...north(9), accuracyM: 8, problemType: "other", note: "" });
    expect(() => e.setPhoto(other.id, "p", JPEG)).toThrow(EngineError);
  });
  it("the photo is gone when the incident expires and is swept", () => {
    e.setPhoto(id, "p", JPEG);
    clock.t += 25 * 3600_000;
    expect(e.incidentForPoster("p", id)).toBeNull();
    expect(e.expireSweep()).toBe(1);
  });
});
