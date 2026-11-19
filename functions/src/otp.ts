import { createHash, randomBytes, randomInt } from "node:crypto";
import type { Clock } from "./engine.js";

export const OTP_FAILS_BEFORE_LOCK = 3;
export const OTP_LOCK_MS = 5 * 60_000;
export const OTP_TTL_MS = 5 * 60_000;

/** Stable account id for a phone number. */
export function uidForPhone(phone: string): string {
  return "u_" + createHash("sha256").update(phone).digest("hex").slice(0, 16);
}

interface Pending {
  code: string;
  expiresAt: number;
}
interface Attempts {
  fails: number;
  lockedUntil: number;
}

/**
 * Demo phone-OTP auth. There is no SMS here: the server hands the code back so
 * the prototype can be driven from a browser. It is NOT a production auth system.
 */
export class OtpAuth {
  private pending = new Map<string, Pending>();
  private attempts = new Map<string, Attempts>();
  private tokens = new Map<string, string>();

  constructor(
    private clock: Clock,
    private makeCode: () => string = () => String(randomInt(0, 1_000_000)).padStart(6, "0"),
  ) {}

  private checkPhone(phone: string) {
    if (!/^\+\d{10,14}$/.test(phone ?? "")) throw new Error("Enter a phone number like +919800000001");
  }
  private assertNotLocked(phone: string) {
    const a = this.attempts.get(phone);
    if (a && this.clock.now() < a.lockedUntil) throw new Error("Too many wrong codes. Locked, try again after the cool-down.");
  }

  request(phone: string): string {
    this.checkPhone(phone);
    this.assertNotLocked(phone);
    const code = this.makeCode();
    this.pending.set(phone, { code, expiresAt: this.clock.now() + OTP_TTL_MS });
    return code;
  }

  verify(phone: string, code: string): { uid: string; token: string } {
    this.checkPhone(phone);
    this.assertNotLocked(phone);
    const p = this.pending.get(phone);
    if (!p) throw new Error("Request a code first");
    if (this.clock.now() > p.expiresAt) {
      this.pending.delete(phone);
      throw new Error("Code expired, request a new one");
    }
    if (p.code !== code) {
      const a = this.attempts.get(phone) ?? { fails: 0, lockedUntil: 0 };
      a.fails++;
      if (a.fails >= OTP_FAILS_BEFORE_LOCK) {
        a.fails = 0;
        a.lockedUntil = this.clock.now() + OTP_LOCK_MS;
        this.pending.delete(phone);
      }
      this.attempts.set(phone, a);
      throw new Error("Invalid code");
    }
    this.pending.delete(phone);
    this.attempts.delete(phone);
    // uid is derived from the phone so a returning user keeps the same account.
    const uid = uidForPhone(phone);
    const token = randomBytes(24).toString("hex");
    this.tokens.set(token, uid);
    return { uid, token };
  }

  uidForToken(token: string): string | null {
    return this.tokens.get(token) ?? null;
  }
}
