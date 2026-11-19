import { describe, it, expect, beforeEach } from "vitest";
import { OtpAuth, OTP_FAILS_BEFORE_LOCK, OTP_LOCK_MS } from "../src/otp.js";
import type { Clock } from "../src/engine.js";

class FakeClock implements Clock {
  t = 1_700_000_000_000;
  now() {
    return this.t;
  }
}

let clock: FakeClock;
let auth: OtpAuth;
beforeEach(() => {
  clock = new FakeClock();
  auth = new OtpAuth(clock, () => "654321");
});

describe("phone OTP (US-1)", () => {
  it("a valid OTP signs the user in and returns a stable uid for the same phone", () => {
    const code = auth.request("+919800000001");
    const a = auth.verify("+919800000001", code);
    const b = auth.verify("+919800000001", auth.request("+919800000001"));
    expect(a.uid).toBe(b.uid);
    expect(a.token).not.toBe(b.token);
    expect(auth.uidForToken(a.token)).toBe(a.uid);
  });

  it("different phones get different uids", () => {
    const a = auth.verify("+919800000001", auth.request("+919800000001"));
    const b = auth.verify("+919800000002", auth.request("+919800000002"));
    expect(a.uid).not.toBe(b.uid);
  });

  it("a wrong code is rejected and an unknown token resolves to nothing", () => {
    auth.request("+919800000001");
    expect(() => auth.verify("+919800000001", "000000")).toThrow(/invalid/i);
    expect(auth.uidForToken("nope")).toBeNull();
  });

  it("verifying without requesting a code fails", () => {
    expect(() => auth.verify("+919800000001", "654321")).toThrow(/request/i);
  });

  it("three wrong codes lock the phone; even the right code fails until the cool-down ends", () => {
    auth.request("+919800000001");
    for (let i = 0; i < OTP_FAILS_BEFORE_LOCK; i++) {
      expect(() => auth.verify("+919800000001", "000000")).toThrow();
    }
    expect(() => auth.verify("+919800000001", "654321")).toThrow(/locked|cool/i);
    expect(() => auth.request("+919800000001")).toThrow(/locked|cool/i);
    clock.t += OTP_LOCK_MS + 1;
    const code = auth.request("+919800000001");
    expect(auth.verify("+919800000001", code).uid).toBeTruthy();
  });

  it("a code is single use", () => {
    const code = auth.request("+919800000001");
    auth.verify("+919800000001", code);
    expect(() => auth.verify("+919800000001", code)).toThrow();
  });

  it("a code expires after five minutes", () => {
    const code = auth.request("+919800000001");
    clock.t += 5 * 60_000 + 1;
    expect(() => auth.verify("+919800000001", code)).toThrow(/expired|request/i);
  });

  it("rejects malformed phone numbers", () => {
    expect(() => auth.request("123")).toThrow(/phone/i);
    expect(() => auth.request("")).toThrow(/phone/i);
  });
});
