import { describe, it, expect } from "vitest";
import { haversineM, withinRadius } from "../src/geo.js";

const centre = { lat: 12.9716, lng: 77.5946 }; // Bangalore

// Move due north by `km` (1 deg latitude ~ 111.19 km on the haversine sphere).
const north = (km: number) => ({ lat: centre.lat + km / 111.195, lng: centre.lng });

describe("haversineM", () => {
  it("is zero for identical points", () => {
    expect(haversineM(centre, centre)).toBeCloseTo(0, 6);
  });
  it("matches ~1 degree of latitude = 111.2 km", () => {
    const d = haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });
});

describe("withinRadius (spec 3.3: 1.9 in, 2.1 out of 2 km, 3.1 out of 3 km)", () => {
  it("1.9 km is inside a 2 km ring", () => {
    expect(withinRadius(centre, north(1.9), 2)).toBe(true);
  });
  it("2.1 km is outside a 2 km ring but inside the 3 km ring", () => {
    expect(withinRadius(centre, north(2.1), 2)).toBe(false);
    expect(withinRadius(centre, north(2.1), 3)).toBe(true);
  });
  it("3.1 km is always outside", () => {
    expect(withinRadius(centre, north(3.1), 2)).toBe(false);
    expect(withinRadius(centre, north(3.1), 3)).toBe(false);
  });
});
