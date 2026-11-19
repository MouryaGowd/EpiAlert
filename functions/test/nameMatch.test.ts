import { describe, it, expect } from "vitest";
import { namesMatch, surnameMatches } from "../src/nameMatch.js";

describe("surnameMatches", () => {
  it("compares the last token only, ignoring honorifics", () => {
    expect(surnameMatches("Dr. Anita Desai", "Anita Kumari Desai")).toBe(true);
    expect(surnameMatches("Anita Desai", "Anita Rao")).toBe(false);
    expect(surnameMatches("", "Anita Rao")).toBe(false);
  });
});

describe("namesMatch (tolerant on form, strict otherwise)", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(namesMatch("  ASHA rao ", "Asha Rao")).toBe(true);
  });
  it("ignores honorifics like Dr.", () => {
    expect(namesMatch("Dr. Asha Rao", "Asha Rao")).toBe(true);
    expect(namesMatch("Asha Rao", "DR ASHA RAO")).toBe(true);
  });
  it("accepts an initial for a given name", () => {
    expect(namesMatch("A. Rao", "Asha Rao")).toBe(true);
    expect(namesMatch("Asha K Rao", "Asha Kumari Rao")).toBe(true);
  });
  it("rejects a different surname or different given name", () => {
    expect(namesMatch("Asha Rao", "Asha Nair")).toBe(false);
    expect(namesMatch("Asha Rao", "Meera Rao")).toBe(false);
  });
  it("rejects a different initial", () => {
    expect(namesMatch("B. Rao", "Asha Rao")).toBe(false);
  });
  it("rejects empty input", () => {
    expect(namesMatch("", "Asha Rao")).toBe(false);
    expect(namesMatch("Dr.", "Asha Rao")).toBe(false);
  });
});
