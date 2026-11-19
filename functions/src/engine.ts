import { randomUUID } from "node:crypto";
import { geohashForLocation } from "geofire-common";
import { haversineM, withinRadius, type LatLng } from "./geo.js";
import { namesMatch, surnameMatches } from "./nameMatch.js";
import { transition, type IncidentEvent, type IncidentStatus } from "./stateMachine.js";

// ---- constants (spec section 3.3) -------------------------------------------------------
export const ALERT_CAP = 20; // per ring, to avoid alert fatigue
export const FRESH_MS = 10 * 60_000; // responder location freshness window
export const DEDUPE_M = 100;
export const DEDUPE_MS = 10 * 60_000;
export const EXPIRY_MS = 24 * 3600_000;
export const FIRST_RING_KM = 2;
export const WIDE_RING_KM = 3;
export const WIDEN_AFTER_S = 60;
export const NO_ACK_AFTER_S = 180;
export const RATE_LIMIT = 3; // posts ...
export const RATE_WINDOW_MS = 10 * 60_000; // ... per window
export const FLAG_THRESHOLD = 2;
export const SUSPEND_AFTER_FALSE_POSTS = 2;
export const AUDIT_GEOHASH_CHARS = 5; // ~5 km cells, see DECISIONS D-2
export const MAX_PHOTO_CHARS = 600_000; // data-URL length cap (~450 KB of JPEG)
export const SAFETY_TEXT = "Scene safety first. Do not enter an unsafe scene. Call 112 if in doubt.";
export const NO_ACK_TEXT = "No volunteer has accepted yet. Call 108.";

// ---- types ------------------------------------------------------------------------------
export type Speciality = "cardiac" | "trauma" | "bone" | "breathing" | "general";
export const SPECIALITIES: Speciality[] = ["cardiac", "trauma", "bone", "breathing", "general"];
export type ProblemType = "cardiac" | "bleeding" | "bone" | "breathing" | "other";
export const PROBLEM_TYPES: ProblemType[] = ["cardiac", "bleeding", "bone", "breathing", "other"];
const NEEDED: Record<ProblemType, Speciality> = {
  cardiac: "cardiac",
  bleeding: "trauma",
  bone: "bone",
  breathing: "breathing",
  other: "general",
};

export type VerificationStatus = "pending" | "verified" | "needs_review" | "rejected" | "revoked";

export interface Clock {
  now(): number;
}
export const systemClock: Clock = { now: () => Date.now() };

export interface AlertMessage {
  kind: "incident_alert" | "responder_coming" | "no_ack";
  incidentId: string;
  problemType?: ProblemType;
  distanceM?: number;
  matchesSpeciality?: boolean;
  text: string;
}
/** May throw; the engine treats a throw as a failed delivery. */
export interface Notifier {
  send(uid: string, msg: AlertMessage): void;
}

export interface RegistryRecord {
  name: string;
  active: boolean;
  blacklisted?: boolean;
}
export interface RegistryQuery {
  council: string;
  regNo: string;
  fullName: string;
}
/** Resolves to a record, or null when it cannot decide (not found / human review needed). */
export interface Verifier {
  verify(q: RegistryQuery): Promise<RegistryRecord | null>;
}

export class MockVerifier implements Verifier {
  records = new Map<string, RegistryRecord>();
  static key(council: string, regNo: string) {
    return `${council}:${regNo}`;
  }
  async verify(q: RegistryQuery) {
    return this.records.get(MockVerifier.key(q.council, q.regNo)) ?? null;
  }
}
/** Never decides; everything goes to a human reviewer. */
export class ManualReviewVerifier implements Verifier {
  async verify() {
    return null;
  }
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}

export interface ResponderForm {
  fullName: string;
  qualification: string;
  regNo: string;
  council: string;
  regYear: number;
  specialities: Speciality[];
}
export interface NewIncident {
  lat: number;
  lng: number;
  accuracyM: number;
  problemType: ProblemType;
  note: string;
  /** The poster intends to attach a blurred photo later (ADR-1). */
  withPhoto?: boolean;
}
export type PhotoState = "none" | "pending" | "ready" | "rejected";
export interface AuditEntry {
  ts: number;
  roughArea: string;
  problemType: ProblemType;
  outcome: "resolved" | "cancelled" | "flagged" | "expired";
  alertedCount: number;
  ackCount: number;
  timeToFirstAckS: number | null;
}

interface User {
  uid: string;
  name: string;
  suspended: boolean;
  falseFlagCount: number;
}
interface Profile extends ResponderForm {
  uid: string;
  status: VerificationStatus;
  verifiedBy: "registry" | "manual" | null;
  reason: string;
}
interface Live {
  lat: number;
  lng: number;
  updatedAt: number;
}
interface Incident {
  id: string;
  createdBy: string;
  reporters: Set<string>;
  createdAt: number;
  expireAt: number;
  lat: number;
  lng: number;
  accuracyM: number;
  problemType: ProblemType;
  note: string;
  status: IncidentStatus;
  radiusKm: number;
  ackCount: number;
  firstAckAt: number | null;
  flaggedBy: Set<string>;
  alerts: Map<string, { alertedAt: number; distanceM: number }>;
  responses: Map<string, { at: number; distanceM: number }>;
  notice: string;
  audited: boolean;
  photoState: PhotoState;
  photoData: string | null;
}

export interface EngineOptions {
  clock?: Clock;
  notifier: Notifier;
  verifier: Verifier;
  admins?: string[];
  verifyTimeoutMs?: number;
}

const round100 = (m: number) => Math.round(m / 100) * 100;

export class Engine {
  readonly audit: AuditEntry[] = [];
  private clock: Clock;
  private notifier: Notifier;
  private verifier: Verifier;
  private admins: Set<string>;
  private verifyTimeoutMs: number;
  private users = new Map<string, User>();
  private profiles = new Map<string, Profile>();
  private live = new Map<string, Live>();
  private incidents = new Map<string, Incident>();
  private posts = new Map<string, number[]>();

  constructor(o: EngineOptions) {
    this.clock = o.clock ?? systemClock;
    this.notifier = o.notifier;
    this.verifier = o.verifier;
    this.admins = new Set(o.admins ?? []);
    this.verifyTimeoutMs = o.verifyTimeoutMs ?? 5000;
  }

  // ---- users --------------------------------------------------------------------------
  addUser(uid: string, name: string) {
    if (!this.users.has(uid)) this.users.set(uid, { uid, name, suspended: false, falseFlagCount: 0 });
  }
  private user(uid: string): User {
    const u = this.users.get(uid);
    if (!u) throw new EngineError("unknown user");
    return u;
  }
  private requireAdmin(uid: string) {
    if (!this.admins.has(uid)) throw new EngineError("admin only");
  }

  // ---- verification (US-2) ------------------------------------------------------------
  async registerResponder(uid: string, form: ResponderForm): Promise<VerificationStatus> {
    this.user(uid);
    if (!form.fullName?.trim() || !form.regNo?.trim() || !form.qualification?.trim()) {
      throw new EngineError("name, qualification and registration number are required");
    }
    if (!form.council?.trim()) throw new EngineError("State Medical Council is required");
    if (!Number.isInteger(form.regYear) || form.regYear < 1950 || form.regYear > 2100) {
      throw new EngineError("invalid registration year");
    }
    this.checkSpecialities(form.specialities);
    if (this.profiles.get(uid)?.status === "verified") throw new EngineError("already verified");

    const { status, reason, verifiedBy } = await this.decide(form);
    this.profiles.set(uid, { ...form, uid, status, reason, verifiedBy });
    return status;
  }

  private async decide(form: ResponderForm) {
    const q = { council: form.council.trim(), regNo: form.regNo.trim(), fullName: form.fullName };
    let rec: RegistryRecord | null;
    try {
      rec = await this.withTimeout(this.verifier.verify(q));
    } catch {
      return this.out("needs_review", "Registry lookup failed or timed out; sent for manual review.");
    }
    if (!rec) return this.out("needs_review", "Not decided automatically; sent for manual review.");
    if (rec.blacklisted) return this.out("rejected", "Registration is blacklisted.");
    if (!rec.active) return this.out("rejected", "Registration is not active.");
    if (namesMatch(form.fullName, rec.name)) return this.out("verified", "Matched registry.", "registry");
    if (surnameMatches(form.fullName, rec.name)) {
      return this.out("needs_review", "Name only partly matches the registry; sent for manual review.");
    }
    return this.out("rejected", "Name does not match the registry record.");
  }
  private out(status: VerificationStatus, reason: string, verifiedBy: "registry" | null = null) {
    return { status, reason, verifiedBy };
  }
  private withTimeout<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), this.verifyTimeoutMs);
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }
  private checkSpecialities(list: Speciality[]) {
    if (!Array.isArray(list) || list.some((s) => !SPECIALITIES.includes(s))) {
      throw new EngineError("unknown speciality");
    }
  }

  setSpecialities(uid: string, list: Speciality[]) {
    const p = this.verifiedProfile(uid);
    this.checkSpecialities(list);
    p.specialities = [...new Set(list)];
  }
  private verifiedProfile(uid: string): Profile {
    const p = this.profiles.get(uid);
    if (!p || p.status !== "verified") throw new EngineError("not a verified responder");
    return p;
  }

  adminQueue(adminUid: string) {
    this.requireAdmin(adminUid);
    return [...this.profiles.values()]
      .filter((p) => p.status === "needs_review")
      .map((p) => ({ ...p, name: this.users.get(p.uid)?.name ?? "" }));
  }
  adminDecide(adminUid: string, targetUid: string, approve: boolean, reason = "") {
    this.requireAdmin(adminUid);
    const p = this.profiles.get(targetUid);
    if (!p || p.status !== "needs_review") throw new EngineError("nothing to review");
    p.status = approve ? "verified" : "rejected";
    p.verifiedBy = approve ? "manual" : null;
    p.reason = reason || (approve ? "Approved by reviewer." : "Rejected by reviewer.");
  }
  adminSuspend(adminUid: string, targetUid: string) {
    this.requireAdmin(adminUid);
    this.user(targetUid).suspended = true;
  }

  // ---- duty (US-3, ADR-3) -------------------------------------------------------------
  setDuty(uid: string, onDuty: boolean, at?: LatLng) {
    this.verifiedProfile(uid);
    if (!onDuty) {
      this.live.delete(uid); // stop sharing immediately
      return;
    }
    if (!at || !this.validLatLng(at)) throw new EngineError("a valid location is required to go on duty");
    this.live.set(uid, { lat: at.lat, lng: at.lng, updatedAt: this.clock.now() });
  }
  private validLatLng(p: LatLng) {
    return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  }

  // ---- incidents (US-4) ---------------------------------------------------------------
  createIncident(uid: string, n: NewIncident): { id: string; deduped: boolean } {
    const u = this.user(uid);
    if (u.suspended) throw new EngineError("account suspended");
    if (!this.validLatLng(n)) throw new EngineError("invalid location");
    if (!PROBLEM_TYPES.includes(n.problemType)) throw new EngineError("unknown problem type");
    const note = (n.note ?? "").slice(0, 280);

    const now = this.clock.now();
    const recent = (this.posts.get(uid) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) throw new EngineError("Rate limit: too many reports, try again later");
    this.posts.set(uid, [...recent, now]);

    for (const inc of this.incidents.values()) {
      if (
        (inc.status === "OPEN" || inc.status === "ACKNOWLEDGED") &&
        !this.expired(inc) &&
        now - inc.createdAt <= DEDUPE_MS &&
        haversineM(inc, n) <= DEDUPE_M
      ) {
        inc.reporters.add(uid);
        return { id: inc.id, deduped: true };
      }
    }

    const inc: Incident = {
      id: randomUUID(),
      createdBy: uid,
      reporters: new Set([uid]),
      createdAt: now,
      expireAt: now + EXPIRY_MS,
      lat: n.lat,
      lng: n.lng,
      accuracyM: n.accuracyM,
      problemType: n.problemType,
      note,
      status: "OPEN",
      radiusKm: FIRST_RING_KM,
      ackCount: 0,
      firstAckAt: null,
      flaggedBy: new Set(),
      alerts: new Map(),
      responses: new Map(),
      notice: "",
      audited: false,
      photoState: n.withPhoto ? "pending" : "none",
      photoData: null,
    };
    this.incidents.set(inc.id, inc);
    this.alertIncident(inc.id);
    return { id: inc.id, deduped: false };
  }

  private expired(inc: Incident) {
    return this.clock.now() >= inc.expireAt;
  }

  /**
   * Attach the on-device-blurred photo after the alert has already gone out.
   * `null` means the client's blur failed, so the photo is rejected and the alert stands (ADR-2).
   */
  setPhoto(id: string, uid: string, dataUrl: string | null) {
    const inc = this.readable(id);
    if (!inc.reporters.has(uid)) throw new EngineError("not allowed");
    if (inc.photoState === "none") throw new EngineError("this incident was posted without a photo");
    if (dataUrl === null) {
      inc.photoState = "rejected";
      inc.photoData = null;
      return;
    }
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/jpeg;base64,")) {
      throw new EngineError("photo must be a JPEG data URL");
    }
    if (dataUrl.length > MAX_PHOTO_CHARS) throw new EngineError("photo is too large");
    inc.photoState = "ready";
    inc.photoData = dataUrl;
  }
  private photoView(inc: Incident) {
    return { state: inc.photoState, data: inc.photoState === "ready" ? inc.photoData : null };
  }

  /** Alert not-yet-alerted eligible responders inside the current ring. Idempotent. */
  alertIncident(id: string): number {
    const inc = this.incidents.get(id);
    if (!inc || this.expired(inc) || (inc.status !== "OPEN" && inc.status !== "ACKNOWLEDGED")) return 0;
    const now = this.clock.now();
    const need = NEEDED[inc.problemType];

    const candidates = [...this.live.entries()]
      .filter(([uid, l]) => {
        const u = this.users.get(uid);
        return (
          this.profiles.get(uid)?.status === "verified" &&
          u &&
          !u.suspended &&
          !inc.reporters.has(uid) &&
          !inc.alerts.has(uid) &&
          now - l.updatedAt <= FRESH_MS &&
          withinRadius(inc, l, inc.radiusKm)
        );
      })
      .map(([uid, l]) => ({
        uid,
        distanceM: haversineM(inc, l),
        match: this.profiles.get(uid)!.specialities.includes(need),
      }))
      .sort((a, b) => Number(b.match) - Number(a.match) || a.distanceM - b.distanceM)
      .slice(0, ALERT_CAP);

    let sent = 0;
    for (const c of candidates) {
      try {
        this.notifier.send(c.uid, {
          kind: "incident_alert",
          incidentId: inc.id,
          problemType: inc.problemType,
          distanceM: Math.round(c.distanceM),
          matchesSpeciality: c.match,
          text: SAFETY_TEXT,
        });
      } catch {
        continue; // not recorded as alerted, so the next ring retries it
      }
      inc.alerts.set(c.uid, { alertedAt: now, distanceM: c.distanceM });
      sent++;
    }
    return sent;
  }

  /** Runs every minute. Escalates by lack of acceptance, not lack of existence. */
  escalateStale() {
    const now = this.clock.now();
    for (const inc of this.incidents.values()) {
      if (inc.status !== "OPEN" || inc.ackCount > 0 || this.expired(inc)) continue;
      const ageS = (now - inc.createdAt) / 1000;
      if (ageS >= WIDEN_AFTER_S && inc.radiusKm < WIDE_RING_KM) {
        inc.radiusKm = WIDE_RING_KM;
        this.alertIncident(inc.id);
      }
      if (ageS >= NO_ACK_AFTER_S && !inc.notice) {
        inc.notice = NO_ACK_TEXT;
        this.notify([...inc.reporters], { kind: "no_ack", incidentId: inc.id, text: NO_ACK_TEXT });
      }
    }
  }

  private notify(uids: string[], msg: AlertMessage) {
    for (const uid of uids) {
      try {
        this.notifier.send(uid, msg);
      } catch {
        /* best-effort */
      }
    }
  }

  // ---- responding (US-6) --------------------------------------------------------------
  respond(id: string, uid: string) {
    const inc = this.readable(id);
    const alert = inc.alerts.get(uid);
    if (!alert) throw new EngineError("you were not alerted to this incident");
    if (inc.status !== "OPEN" && inc.status !== "ACKNOWLEDGED") throw new EngineError("incident is closed");
    if (inc.responses.has(uid)) return;
    inc.responses.set(uid, { at: this.clock.now(), distanceM: round100(alert.distanceM) });
    inc.ackCount++;
    if (inc.status === "OPEN") {
      this.move(inc, "ack");
      inc.firstAckAt = this.clock.now();
    }
    this.notify([...inc.reporters], {
      kind: "responder_coming",
      incidentId: inc.id,
      text: "A medical volunteer is coming.",
    });
  }

  resolve(id: string, uid: string) {
    const inc = this.readable(id);
    if (!inc.reporters.has(uid) && !inc.responses.has(uid)) throw new EngineError("not allowed");
    this.move(inc, "resolve");
    this.finish(inc);
  }
  cancel(id: string, uid: string) {
    const inc = this.readable(id);
    if (inc.createdBy !== uid) throw new EngineError("only the poster can cancel");
    this.move(inc, "cancel");
    this.finish(inc);
  }

  flag(id: string, uid: string) {
    const inc = this.readable(id);
    if (!inc.alerts.has(uid)) throw new EngineError("you were not alerted to this incident");
    if (inc.status !== "OPEN" && inc.status !== "ACKNOWLEDGED") throw new EngineError("incident is closed");
    if (inc.flaggedBy.has(uid)) return;
    inc.flaggedBy.add(uid);
    if (inc.flaggedBy.size >= FLAG_THRESHOLD) {
      this.move(inc, "flagThreshold");
      const poster = this.user(inc.createdBy);
      poster.falseFlagCount++;
      if (poster.falseFlagCount >= SUSPEND_AFTER_FALSE_POSTS) poster.suspended = true;
      this.finish(inc);
    }
  }

  private readable(id: string): Incident {
    const inc = this.incidents.get(id);
    if (!inc || this.expired(inc)) throw new EngineError("incident not found");
    return inc;
  }
  /** Every transition goes through the state machine; illegal ones surface as EngineError. */
  private move(inc: Incident, ev: IncidentEvent) {
    try {
      inc.status = transition(inc.status, ev);
    } catch {
      throw new EngineError(`cannot ${ev} an incident that is ${inc.status.toLowerCase()}`);
    }
  }

  // ---- expiry and audit (US-7, ADR-4) -------------------------------------------------
  /** Physically deletes expired incidents. Reads are already blocked by expireAt. */
  expireSweep(): number {
    let n = 0;
    for (const inc of [...this.incidents.values()]) {
      if (!this.expired(inc)) continue;
      if (inc.status === "OPEN" || inc.status === "ACKNOWLEDGED") this.move(inc, "expire");
      this.finish(inc);
      this.incidents.delete(inc.id);
      n++;
    }
    return n;
  }

  /** One anonymised entry per incident, written when it ends. No uids, names, note or exact location. */
  private finish(inc: Incident) {
    if (inc.audited) return;
    inc.audited = true;
    const outcome = (
      { RESOLVED: "resolved", CANCELLED: "cancelled", FLAGGED: "flagged", EXPIRED: "expired" } as const
    )[inc.status as "RESOLVED" | "CANCELLED" | "FLAGGED" | "EXPIRED"];
    this.audit.push({
      ts: this.clock.now(),
      roughArea: geohashForLocation([inc.lat, inc.lng], AUDIT_GEOHASH_CHARS),
      problemType: inc.problemType,
      outcome,
      alertedCount: inc.alerts.size,
      ackCount: inc.ackCount,
      timeToFirstAckS: inc.firstAckAt === null ? null : Math.round((inc.firstAckAt - inc.createdAt) / 1000),
    });
  }

  // ---- read models --------------------------------------------------------------------
  incidentForPoster(uid: string, id: string) {
    const inc = this.incidents.get(id);
    if (!inc || this.expired(inc) || !inc.reporters.has(uid)) return null;
    return {
      id: inc.id,
      status: inc.status,
      problemType: inc.problemType,
      note: inc.note,
      lat: inc.lat,
      lng: inc.lng,
      createdAt: inc.createdAt,
      expireAt: inc.expireAt,
      ackCount: inc.ackCount,
      radiusKm: inc.radiusKm,
      alertedCount: inc.alerts.size,
      reportCount: inc.reporters.size,
      notice: inc.notice,
      photo: this.photoView(inc),
      // Only rounded distance, never a responder identity (ADR-3).
      responders: [...inc.responses.values()].map((r) => ({ distanceM: r.distanceM })),
    };
  }

  /** Alert existence grants read. No poster identity is ever included (ADR-5). */
  incidentForResponder(uid: string, id: string) {
    const inc = this.incidents.get(id);
    if (!inc || this.expired(inc) || !inc.alerts.has(uid) || inc.status === "FLAGGED") return null;
    return {
      id: inc.id,
      status: inc.status,
      problemType: inc.problemType,
      note: inc.note,
      lat: inc.lat,
      lng: inc.lng,
      createdAt: inc.createdAt,
      expireAt: inc.expireAt,
      distanceM: Math.round(inc.alerts.get(uid)!.distanceM),
      matchesSpeciality: !!this.profiles.get(uid)?.specialities.includes(NEEDED[inc.problemType]),
      youResponded: inc.responses.has(uid),
      photo: this.photoView(inc),
      safety: SAFETY_TEXT,
    };
  }

  snapshot(uid: string) {
    const u = this.user(uid);
    const p = this.profiles.get(uid);
    const ids = [...this.incidents.keys()];
    return {
      user: { uid, name: u.name, suspended: u.suspended, isAdmin: this.admins.has(uid) },
      profile: p
        ? {
            status: p.status,
            reason: p.reason,
            verifiedBy: p.verifiedBy,
            specialities: p.specialities,
            council: p.council,
            qualification: p.qualification,
          }
        : null,
      onDuty: this.live.has(uid),
      mine: ids.map((id) => this.incidentForPoster(uid, id)).filter((v) => v !== null),
      alerts: ids
        .map((id) => this.incidentForResponder(uid, id))
        .filter((v) => v !== null && (v.status === "OPEN" || v.status === "ACKNOWLEDGED")),
    };
  }

  /** Demo-only god view for the map and admin tab. Not exposed to ordinary users. */
  demoOverview() {
    return {
      responders: [...this.live.entries()].map(([uid, l]) => ({
        uid,
        name: this.users.get(uid)?.name ?? uid,
        lat: l.lat,
        lng: l.lng,
        updatedAt: l.updatedAt,
        specialities: this.profiles.get(uid)?.specialities ?? [],
      })),
      incidents: [...this.incidents.values()].map((i) => ({
        id: i.id,
        status: i.status,
        problemType: i.problemType,
        lat: i.lat,
        lng: i.lng,
        radiusKm: i.radiusKm,
        ackCount: i.ackCount,
        alertedCount: i.alerts.size,
        flagCount: i.flaggedBy.size,
        expireAt: i.expireAt,
      })),
    };
  }
}
