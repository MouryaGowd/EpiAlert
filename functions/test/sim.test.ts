import { describe, it, expect } from "vitest";
import {
  mulberry32,
  poisson,
  planarLaplaceRadiusKm,
  runStrategies,
  runPrivacy,
  buildIndex,
  queryIndex,
  queryLinear,
  randomPoints,
  quantile,
  DEFAULT_PARAMS,
  type SimParams,
} from "../src/sim.js";
import { ALERT_CAP } from "../src/engine.js";
import { haversineM } from "../src/geo.js";

const P = (over: Partial<SimParams> = {}): SimParams => ({ ...DEFAULT_PARAMS, incidents: 600, seed: 7, ...over });

describe("rng and samplers", () => {
  it("mulberry32 is deterministic and in [0,1)", () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it("poisson has mean and variance near lambda, including large lambda", () => {
    for (const lambda of [0.5, 7, 120]) {
      const r = mulberry32(3);
      const xs = Array.from({ length: 4000 }, () => poisson(lambda, r));
      const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
      const varr = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length;
      expect(Math.abs(mean - lambda) / lambda).toBeLessThan(0.06);
      expect(Math.abs(varr - lambda) / lambda).toBeLessThan(0.2);
    }
  });

  it("planar Laplace radius has mean 2/epsilon", () => {
    const r = mulberry32(5);
    for (const eps of [0.5, 2, 10]) {
      const xs = Array.from({ length: 20000 }, () => planarLaplaceRadiusKm(eps, r));
      const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
      expect(Math.abs(mean - 2 / eps) / (2 / eps)).toBeLessThan(0.03);
    }
  });

  it("quantile interpolates", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([10], 0.95)).toBe(10);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });
});

describe("alerting strategies (experiment 1)", () => {
  const byName = (rows: ReturnType<typeof runStrategies>) => Object.fromEntries(rows.map((r) => [r.strategy, r]));

  it("is reproducible for a fixed seed", () => {
    expect(runStrategies(P())).toEqual(runStrategies(P()));
  });

  it("alert burden orders broadcast >= fixed3 >= escalate >= fixed2", () => {
    const r = byName(runStrategies(P({ densityPerKm2: 0.6 })));
    expect(r.broadcast.alertsPerIncident).toBeGreaterThanOrEqual(r.fixed3.alertsPerIncident);
    expect(r.fixed3.alertsPerIncident).toBeGreaterThanOrEqual(r.escalate.alertsPerIncident);
    expect(r.escalate.alertsPerIncident).toBeGreaterThanOrEqual(r.fixed2.alertsPerIncident);
  });

  it("escalation reaches at least as many incidents as fixed 2 km, with fewer alerts than fixed 3 km", () => {
    const r = byName(runStrategies(P({ densityPerKm2: 0.15, incidents: 1500 })));
    expect(r.escalate.reachedPct).toBeGreaterThanOrEqual(r.fixed2.reachedPct);
    expect(r.escalate.alertsPerIncident).toBeLessThan(r.fixed3.alertsPerIncident);
  });

  it("never alerts more than the per-ring cap for ring strategies", () => {
    const r = byName(runStrategies(P({ densityPerKm2: 8 })));
    expect(r.fixed2.alertsPerIncident).toBeLessThanOrEqual(ALERT_CAP);
    expect(r.fixed3.alertsPerIncident).toBeLessThanOrEqual(ALERT_CAP);
    expect(r.escalate.alertsPerIncident).toBeLessThanOrEqual(2 * ALERT_CAP);
    expect(r.broadcast.alertsPerIncident).toBeGreaterThan(ALERT_CAP); // broadcast has no cap
  });

  it("with no responders nobody is reached and nothing throws", () => {
    const rows = runStrategies(P({ densityPerKm2: 0 }));
    for (const row of rows) {
      expect(row.reachedPct).toBe(0);
      expect(row.alertsPerIncident).toBe(0);
      expect(Number.isNaN(row.arrivalMedianS)).toBe(true);
    }
  });

  it("if everyone accepts instantly, reach is 100% wherever someone is in range", () => {
    const r = byName(runStrategies(P({ densityPerKm2: 3, acceptProb: 1, acceptMedianS: 1, acceptSigma: 0.01 })));
    expect(r.fixed3.reachedPct).toBeGreaterThan(99);
    expect(r.escalate.reachedPct).toBeGreaterThan(99);
  });

  it("within-deadline rate is unconditional: never above reach, and a tight deadline lowers it", () => {
    const loose = byName(runStrategies(P({ densityPerKm2: 0.1, deadlineS: 1e9 })));
    const tight = byName(runStrategies(P({ densityPerKm2: 0.1, deadlineS: 300 })));
    for (const s of ["broadcast", "fixed2", "fixed3", "escalate"] as const) {
      expect(loose[s].withinDeadlinePct).toBeCloseTo(loose[s].reachedPct, 9); // no deadline means same as reached
      expect(tight[s].withinDeadlinePct).toBeLessThanOrEqual(tight[s].reachedPct);
      expect(tight[s].withinDeadlinePct).toBeLessThanOrEqual(loose[s].withinDeadlinePct);
    }
    // Broadcast reaches the most incidents but its far-away acceptors miss a tight deadline.
    expect(tight.broadcast.withinDeadlinePct).toBeLessThan(tight.broadcast.reachedPct);
  });

  it("arrival times are positive and p95 >= median", () => {
    for (const row of runStrategies(P({ densityPerKm2: 0.5 }))) {
      expect(row.arrivalMedianS).toBeGreaterThan(0);
      expect(row.arrivalP95S).toBeGreaterThanOrEqual(row.arrivalMedianS);
    }
  });
});

describe("location privacy (experiment 2)", () => {
  it("no noise means no misses and no false alerts", () => {
    const [none] = runPrivacy(P({ densityPerKm2: 1 }), [Infinity]);
    expect(none.missRatePct).toBe(0);
    expect(none.falseAlertPct).toBe(0);
  });

  it("more noise (smaller epsilon) never improves accuracy", () => {
    const rows = runPrivacy(P({ densityPerKm2: 1, incidents: 1500 }), [Infinity, 10, 3, 1, 0.5]);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].missRatePct + rows[i].falseAlertPct).toBeGreaterThanOrEqual(rows[i - 1].missRatePct + rows[i - 1].falseAlertPct - 0.5);
    }
    expect(rows[rows.length - 1].missRatePct).toBeGreaterThan(rows[1].missRatePct);
  });
});

describe("geohash index (experiment 3)", () => {
  const centre = { lat: 12.9759, lng: 77.605 };

  it("returns exactly the same responders as a full scan, at several radii", () => {
    const rng = mulberry32(11);
    const pts = randomPoints(3000, centre, 20, rng);
    const idx = buildIndex(pts);
    for (const radiusKm of [0.5, 2, 3, 6]) {
      for (let q = 0; q < 20; q++) {
        const c = randomPoints(1, centre, 10, rng)[0];
        const a = queryIndex(idx, c, radiusKm).matches.slice().sort((x, y) => x - y);
        const b = queryLinear(pts, c, radiusKm).slice().sort((x, y) => x - y);
        expect(a).toEqual(b);
      }
    }
  });

  it("candidates are a superset of matches (geohash boxes over-fetch)", () => {
    const rng = mulberry32(12);
    const pts = randomPoints(2000, centre, 20, rng);
    const idx = buildIndex(pts);
    const r = queryIndex(idx, centre, 2);
    expect(r.candidates).toBeGreaterThanOrEqual(r.matches.length);
    for (const i of r.matches) expect(haversineM(centre, pts[i])).toBeLessThanOrEqual(2000);
  });

  it("handles an empty index and a query far from all points", () => {
    expect(queryIndex(buildIndex([]), centre, 2).matches).toEqual([]);
    const idx = buildIndex(randomPoints(100, centre, 5, mulberry32(1)));
    expect(queryIndex(idx, { lat: 40, lng: -100 }, 2).matches).toEqual([]);
  });
});
