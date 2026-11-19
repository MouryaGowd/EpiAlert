import { geohashForLocation, geohashQueryBounds } from "geofire-common";
import { ALERT_CAP, FIRST_RING_KM, WIDE_RING_KM, WIDEN_AFTER_S } from "./engine.js";
import { haversineM, withinRadius, type LatLng } from "./geo.js";

// ---- rng and samplers -------------------------------------------------------------------

/** Small deterministic PRNG so every experiment is reproducible from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function knuthPoisson(lambda: number, rng: () => number): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit);
  return k - 1;
}

/** Exact Poisson sampler. Large means are split into chunks of 30 so exp(-lambda) never underflows. */
export function poisson(lambda: number, rng: () => number): number {
  if (!(lambda > 0)) return 0;
  let total = 0;
  let rest = lambda;
  while (rest > 30) {
    total += knuthPoisson(30, rng);
    rest -= 30;
  }
  return total + knuthPoisson(rest, rng);
}

function standardNormal(rng: () => number): number {
  const u = 1 - rng(); // (0, 1]
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Radius (km) of planar-Laplace noise with privacy parameter epsilon (per km), as in
 * geo-indistinguishability. The radial density is eps^2 * r * exp(-eps * r), which is
 * Gamma(shape 2, scale 1/eps), i.e. the sum of two independent exponentials. Mean is 2/eps.
 */
export function planarLaplaceRadiusKm(epsilonPerKm: number, rng: () => number): number {
  const e1 = -Math.log(1 - rng());
  const e2 = -Math.log(1 - rng());
  return (e1 + e2) / epsilonPerKm;
}

export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

// ---- parameters -------------------------------------------------------------------------

export interface SimParams {
  /** On-duty responders per km^2 (assumed; swept in the experiments). */
  densityPerKm2: number;
  incidents: number;
  seed: number;
  /** Responders are placed uniformly in a disk of this radius around the incident. */
  cityRadiusKm: number;
  /** Probability an alerted responder accepts (assumed). */
  acceptProb: number;
  /** Lognormal accept delay: median seconds and sigma (assumed). */
  acceptMedianS: number;
  acceptSigma: number;
  /** Door-to-scene travel: straight-line distance times a detour factor over a speed (assumed). */
  speedKmh: number;
  detourFactor: number;
  cap: number;
  ring1Km: number;
  ring2Km: number;
  widenAfterS: number;
  /** Deadline (s) for the unconditional "responder on scene in time" metric (assumed). */
  deadlineS: number;
}

export const DEFAULT_PARAMS: SimParams = {
  densityPerKm2: 0.3,
  incidents: 5000,
  seed: 1,
  cityRadiusKm: 8,
  acceptProb: 0.4,
  acceptMedianS: 25,
  acceptSigma: 0.8,
  speedKmh: 20,
  detourFactor: 1.4,
  cap: ALERT_CAP,
  ring1Km: FIRST_RING_KM,
  ring2Km: WIDE_RING_KM,
  widenAfterS: WIDEN_AFTER_S,
  deadlineS: 600,
};

// ---- experiment 1: alerting strategies --------------------------------------------------

export type StrategyName = "broadcast" | "fixed2" | "fixed3" | "escalate";
export const STRATEGIES: StrategyName[] = ["broadcast", "fixed2", "fixed3", "escalate"];

export interface StrategyRow {
  strategy: StrategyName;
  /** % of incidents where at least one alerted responder accepted. */
  reachedPct: number;
  /**
   * % of ALL incidents with a responder on scene within deadlineS. Unlike the arrival
   * quantiles below, this is not conditional on being reached, so strategies with
   * different reach can be compared fairly.
   */
  withinDeadlinePct: number;
  /** Mean number of responders alerted per incident. */
  alertsPerIncident: number;
  /** Time from the report to the first responder arriving, over incidents that were reached. */
  /** Arrival quantiles are over reached incidents only (conditional); compare with care. */
  arrivalMedianS: number;
  arrivalP95S: number;
}

interface Resp {
  d: number;
  accepts: boolean;
  delayS: number;
  travelS: number;
}

/**
 * Every strategy is evaluated on the SAME simulated responders for each incident
 * (common random numbers), so differences come from the strategy, not from luck.
 */
export function runStrategies(p: SimParams): StrategyRow[] {
  const rng = mulberry32(p.seed);
  const lambda = p.densityPerKm2 * Math.PI * p.cityRadiusKm ** 2;
  const acc = Object.fromEntries(STRATEGIES.map((s) => [s, { alerts: 0, reached: 0, within: 0, arrivals: [] as number[] }])) as Record<
    StrategyName,
    { alerts: number; reached: number; within: number; arrivals: number[] }
  >;

  const record = (name: StrategyName, alerted: { r: Resp; at: number }[]) => {
    const a = acc[name];
    a.alerts += alerted.length;
    let best = Infinity;
    for (const { r, at } of alerted) {
      if (r.accepts) best = Math.min(best, at + r.delayS + r.travelS);
    }
    if (best < Infinity) {
      a.reached++;
      a.arrivals.push(best);
      if (best <= p.deadlineS) a.within++;
    }
  };

  for (let i = 0; i < p.incidents; i++) {
    const n = poisson(lambda, rng);
    const rs: Resp[] = [];
    for (let k = 0; k < n; k++) {
      const d = p.cityRadiusKm * Math.sqrt(rng());
      rs.push({
        d,
        accepts: rng() < p.acceptProb,
        delayS: p.acceptMedianS * Math.exp(p.acceptSigma * standardNormal(rng)),
        travelS: ((d * p.detourFactor) / p.speedKmh) * 3600,
      });
    }
    rs.sort((a, b) => a.d - b.d);

    record("broadcast", rs.map((r) => ({ r, at: 0 })));
    record("fixed2", rs.filter((r) => r.d <= p.ring1Km).slice(0, p.cap).map((r) => ({ r, at: 0 })));
    record("fixed3", rs.filter((r) => r.d <= p.ring2Km).slice(0, p.cap).map((r) => ({ r, at: 0 })));

    // Escalate by lack of acceptance (spec 3.3): widen only if nobody accepted by widenAfterS.
    const ring1 = rs.filter((r) => r.d <= p.ring1Km).slice(0, p.cap);
    const alerted = ring1.map((r) => ({ r, at: 0 }));
    if (!ring1.some((r) => r.accepts && r.delayS <= p.widenAfterS)) {
      const already = new Set(ring1);
      for (const r of rs.filter((x) => x.d <= p.ring2Km && !already.has(x)).slice(0, p.cap)) {
        alerted.push({ r, at: p.widenAfterS });
      }
    }
    record("escalate", alerted);
  }

  return STRATEGIES.map((strategy) => {
    const a = acc[strategy];
    return {
      strategy,
      reachedPct: (100 * a.reached) / p.incidents,
      withinDeadlinePct: (100 * a.within) / p.incidents,
      alertsPerIncident: a.alerts / p.incidents,
      arrivalMedianS: quantile(a.arrivals, 0.5),
      arrivalP95S: quantile(a.arrivals, 0.95),
    };
  });
}

// ---- experiment 2: location privacy vs alert accuracy -----------------------------------

export interface PrivacyRow {
  /** Infinity means responders report their exact location (no noise). */
  epsilonPerKm: number;
  meanNoiseKm: number;
  /** % of responders truly inside the ring who were NOT alerted. */
  missRatePct: number;
  /** % of alerted responders who were truly outside the ring. */
  falseAlertPct: number;
  /** % of incidents (with at least one truly in-range responder) where one of them was alerted. */
  reachedPct: number;
}

/** Responders report a planar-Laplace-noised location; the server alerts using the noisy position. */
export function runPrivacy(p: SimParams, epsilons: number[]): PrivacyRow[] {
  const lambda = p.densityPerKm2 * Math.PI * p.cityRadiusKm ** 2;
  return epsilons.map((eps) => {
    const posRng = mulberry32(p.seed); // identical positions for every epsilon
    const noiseRng = mulberry32((p.seed ^ 0x9e3779b9) >>> 0);
    let trueInRange = 0, missed = 0, alerted = 0, falseAlerts = 0, eligibleIncidents = 0, reachedIncidents = 0;
    for (let i = 0; i < p.incidents; i++) {
      const n = poisson(lambda, posRng);
      let inRangeHere = 0, hitHere = 0;
      for (let k = 0; k < n; k++) {
        const d = p.cityRadiusKm * Math.sqrt(posRng());
        const th = 2 * Math.PI * posRng();
        let x = d * Math.cos(th), y = d * Math.sin(th);
        if (Number.isFinite(eps)) {
          const nr = planarLaplaceRadiusKm(eps, noiseRng);
          const nt = 2 * Math.PI * noiseRng();
          x += nr * Math.cos(nt);
          y += nr * Math.sin(nt);
        }
        const truly = d <= p.ring1Km;
        const flagged = Math.hypot(x, y) <= p.ring1Km;
        if (truly) {
          trueInRange++;
          inRangeHere++;
          if (flagged) hitHere++;
          else missed++;
        }
        if (flagged) {
          alerted++;
          if (!truly) falseAlerts++;
        }
      }
      if (inRangeHere > 0) {
        eligibleIncidents++;
        if (hitHere > 0) reachedIncidents++;
      }
    }
    return {
      epsilonPerKm: eps,
      meanNoiseKm: Number.isFinite(eps) ? 2 / eps : 0,
      missRatePct: trueInRange ? (100 * missed) / trueInRange : 0,
      falseAlertPct: alerted ? (100 * falseAlerts) / alerted : 0,
      reachedPct: eligibleIncidents ? (100 * reachedIncidents) / eligibleIncidents : 0,
    };
  });
}

// ---- experiment 3: geohash index vs linear scan -----------------------------------------

export interface GeoIndex {
  pts: LatLng[];
  /** Sorted by geohash, like a Firestore index on the geohash field. */
  entries: { hash: string; idx: number }[];
}

export function randomPoints(n: number, centre: LatLng, radiusKm: number, rng: () => number): LatLng[] {
  const out: LatLng[] = [];
  const kmLng = 111.195 * Math.cos((centre.lat * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    const d = radiusKm * Math.sqrt(rng());
    const th = 2 * Math.PI * rng();
    out.push({ lat: centre.lat + (d * Math.sin(th)) / 111.195, lng: centre.lng + (d * Math.cos(th)) / kmLng });
  }
  return out;
}

export function buildIndex(pts: LatLng[]): GeoIndex {
  const entries = pts.map((p, idx) => ({ hash: geohashForLocation([p.lat, p.lng]), idx }));
  entries.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  return { pts, entries };
}

/** Same procedure as the alert function: geohash range queries, then an exact haversine filter. */
export function queryIndex(index: GeoIndex, centre: LatLng, radiusKm: number): { matches: number[]; candidates: number } {
  const seen = new Set<number>();
  const { entries, pts } = index;
  for (const [start, end] of geohashQueryBounds([centre.lat, centre.lng], radiusKm * 1000)) {
    let lo = 0;
    let hi = entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (entries[mid].hash < start) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < entries.length && entries[i].hash <= end; i++) seen.add(entries[i].idx);
  }
  const matches: number[] = [];
  for (const idx of seen) if (withinRadius(centre, pts[idx], radiusKm)) matches.push(idx);
  return { matches, candidates: seen.size };
}

export function queryLinear(pts: LatLng[], centre: LatLng, radiusKm: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) if (haversineM(centre, pts[i]) <= radiusKm * 1000) out.push(i);
  return out;
}
