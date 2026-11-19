import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "./server.js";
import { barChart, lineChart } from "./charts.js";
import {
  DEFAULT_PARAMS,
  STRATEGIES,
  buildIndex,
  mulberry32,
  quantile,
  queryIndex,
  queryLinear,
  randomPoints,
  runPrivacy,
  runStrategies,
  type SimParams,
  type StrategyName,
} from "./sim.js";

const out = path.resolve(process.argv[2] ?? "../paper/results");
mkdirSync(out, { recursive: true });
const write = (name: string, data: string) => writeFileSync(path.join(out, name), data);
const SEEDS = Array.from({ length: 10 }, (_, i) => 101 + i);

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
const NAMES: Record<StrategyName, string> = {
  broadcast: "Alert everyone",
  fixed2: "Fixed 2 km",
  fixed3: "Fixed 3 km",
  escalate: "Escalate 2 to 3 km (ours)",
};
const csv = (rows: (string | number)[][]) => rows.map((r) => r.join(",")).join("\n") + "\n";

// ---- Experiment 1: alerting strategies vs responder density -----------------------------
function exp1() {
  const densities = [0.02, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6];
  const params: SimParams = { ...DEFAULT_PARAMS, incidents: 5000 };
  const rows: (string | number)[][] = [["density_per_km2", "strategy", "reached_pct_mean", "reached_pct_sd", "within_deadline_pct_mean", "within_deadline_pct_sd", "alerts_per_incident_mean", "alerts_per_incident_sd", "arrival_median_s_mean_reached_only", "arrival_p95_s_mean_reached_only"]];
  const table: Record<string, Record<StrategyName, { reached: number; reachedSd: number; within: number; withinSd: number; alerts: number; alertsSd: number; med: number; p95: number }>> = {};
  for (const d of densities) {
    const per = SEEDS.map((seed) => runStrategies({ ...params, densityPerKm2: d, seed }));
    table[d] = {} as never;
    for (const s of STRATEGIES) {
      const pick = (f: (r: (typeof per)[0][0]) => number) => per.map((run) => f(run.find((r) => r.strategy === s)!));
      const reached = pick((r) => r.reachedPct), alerts = pick((r) => r.alertsPerIncident);
      const med = pick((r) => r.arrivalMedianS).filter(Number.isFinite), p95 = pick((r) => r.arrivalP95S).filter(Number.isFinite);
      const within = pick((r) => r.withinDeadlinePct);
      const row = { reached: mean(reached), reachedSd: sd(reached), within: mean(within), withinSd: sd(within), alerts: mean(alerts), alertsSd: sd(alerts), med: med.length ? mean(med) : NaN, p95: p95.length ? mean(p95) : NaN };
      table[d][s] = row;
      rows.push([d, s, row.reached.toFixed(2), row.reachedSd.toFixed(2), row.within.toFixed(2), row.withinSd.toFixed(2), row.alerts.toFixed(2), row.alertsSd.toFixed(2), Number.isNaN(row.med) ? "" : row.med.toFixed(1), Number.isNaN(row.p95) ? "" : row.p95.toFixed(1)]);
    }
  }
  write("exp1_strategies.csv", csv(rows));
  write("exp1_strategies.json", JSON.stringify({ params, seeds: SEEDS, densities, table }, null, 2));
  const series = (f: (r: (typeof table)[string][StrategyName]) => number, errF?: (r: (typeof table)[string][StrategyName]) => number) =>
    STRATEGIES.map((s) => ({ name: NAMES[s], dash: s === "broadcast", points: densities.map((d) => ({ x: d, y: f(table[d][s]), err: errF?.(table[d][s]) })) }));
  write("exp1_reached.svg", lineChart(series((r) => r.reached, (r) => r.reachedSd), { title: "Incidents reaching a responder vs. density", xLabel: "On-duty responders per km² (log scale)", yLabel: "Incidents with an accepting responder (%)", logX: true }));
  write("exp1_alerts.svg", lineChart(series((r) => r.alerts, (r) => r.alertsSd), { title: "Alert burden vs. density", xLabel: "On-duty responders per km² (log scale)", yLabel: "Alerts sent per incident", logX: true, logY: true }));
  write("exp1_within_deadline.svg", lineChart(series((r) => r.within, (r) => r.withinSd), { title: "Incidents with a responder on scene within 10 min", xLabel: "On-duty responders per km² (log scale)", yLabel: "All incidents with responder in 10 min (%)", logX: true }));
  return table;
}

// ---- Experiment 2: location privacy vs alert accuracy -----------------------------------
function exp2() {
  const eps = [Infinity, 20, 10, 5, 2, 1, 0.5];
  const params: SimParams = { ...DEFAULT_PARAMS, incidents: 5000, densityPerKm2: 0.3 };
  const per = SEEDS.map((seed) => runPrivacy({ ...params, seed }, eps));
  const rows: (string | number)[][] = [["epsilon_per_km", "mean_noise_km", "miss_rate_pct_mean", "miss_rate_pct_sd", "false_alert_pct_mean", "false_alert_pct_sd", "reached_pct_mean"]];
  const agg = eps.map((e, i) => {
    const col = (f: (r: (typeof per)[0][0]) => number) => per.map((run) => f(run[i]));
    const miss = col((r) => r.missRatePct), fa = col((r) => r.falseAlertPct), re = col((r) => r.reachedPct);
    const row = { eps: e, noiseKm: e === Infinity ? 0 : 2 / e, miss: mean(miss), missSd: sd(miss), fa: mean(fa), faSd: sd(fa), reached: mean(re) };
    rows.push([e === Infinity ? "inf" : e, row.noiseKm.toFixed(2), row.miss.toFixed(2), row.missSd.toFixed(2), row.fa.toFixed(2), row.faSd.toFixed(2), row.reached.toFixed(2)]);
    return row;
  });
  write("exp2_privacy.csv", csv(rows));
  write("exp2_privacy.json", JSON.stringify({ params, seeds: SEEDS, agg }, null, 2));
  const pts = agg.filter((a) => a.noiseKm > 0);
  write("exp2_privacy.svg", lineChart(
    [
      { name: "Responders missed (%)", points: pts.map((a) => ({ x: a.noiseKm, y: a.miss, err: a.missSd })) },
      { name: "Alerts to out-of-range (%)", points: pts.map((a) => ({ x: a.noiseKm, y: a.fa, err: a.faSd })) },
      { name: "Incidents still reached (%)", points: pts.map((a) => ({ x: a.noiseKm, y: a.reached })) },
    ],
    { title: "Cost of blurring responder location", xLabel: "Mean location noise in km (planar Laplace, log scale)", yLabel: "Percent", logX: true, xTicks: pts.map((a) => ({ value: a.noiseKm, label: String(a.noiseKm) })) },
  ));
  return agg;
}

// ---- Experiment 3: geohash index vs full scan -------------------------------------------
function exp3() {
  const centre = { lat: 12.9759, lng: 77.605 };
  const sizes = [1_000, 10_000, 50_000, 100_000, 250_000];
  const rows: (string | number)[][] = [["responders", "linear_us_median", "index_us_median", "speedup", "candidates_mean", "matches_mean"]];
  const res = sizes.map((n) => {
    const rng = mulberry32(2024);
    const pts = randomPoints(n, centre, 30, rng);
    const idx = buildIndex(pts);
    const queries = randomPoints(300, centre, 8, rng);
    const lin: number[] = [], ix: number[] = [];
    let cand = 0, mat = 0;
    for (const q of queries) {
      const t0 = performance.now();
      const a = queryLinear(pts, q, 2);
      lin.push((performance.now() - t0) * 1000);
      const t1 = performance.now();
      const b = queryIndex(idx, q, 2);
      ix.push((performance.now() - t1) * 1000);
      cand += b.candidates; mat += b.matches.length;
      if (a.length !== b.matches.length) throw new Error("index and scan disagree");
    }
    const row = { n, lin: quantile(lin, 0.5), ix: quantile(ix, 0.5), cand: cand / queries.length, mat: mat / queries.length };
    rows.push([n, row.lin.toFixed(1), row.ix.toFixed(1), (row.lin / row.ix).toFixed(1), row.cand.toFixed(1), row.mat.toFixed(1)]);
    return row;
  });
  const machine = { cpu: os.cpus()[0]?.model ?? "unknown", cores: os.cpus().length, node: process.version, platform: `${os.platform()} ${os.arch()}` };
  write("exp3_index.csv", csv(rows));
  write("exp3_index.json", JSON.stringify({ machine, queries: 300, radiusKm: 2, results: res }, null, 2));
  write("exp3_index.svg", lineChart(
    [
      { name: "Full scan", points: res.map((r) => ({ x: r.n, y: r.lin })) },
      { name: "Geohash index + exact filter", points: res.map((r) => ({ x: r.n, y: r.ix })) },
    ],
    { title: "Responder lookup time (2 km radius)", xLabel: "Responders stored (log scale)", yLabel: "Median µs per query (log scale)", logX: true, logY: true },
  ));
  return { machine, res };
}

// ---- Sensitivity: how the Experiment 1 conclusion moves with the assumed parameters -----
function sensitivity() {
  const density = 0.2; // the density where the paper's headline comparison is made
  const sweeps: { name: string; key: "speedKmh" | "deadlineS" | "acceptProb"; values: number[] }[] = [
    { name: "travel speed (km/h)", key: "speedKmh", values: [10, 15, 20, 30] },
    { name: "deadline (s)", key: "deadlineS", values: [300, 600, 900] },
    { name: "acceptance probability", key: "acceptProb", values: [0.2, 0.4, 0.6] },
  ];
  const rows: (string | number)[][] = [["parameter", "value", "strategy", "reached_pct_mean", "within_deadline_pct_mean", "alerts_per_incident_mean"]];
  const out: Record<string, unknown[]> = {};
  for (const sw of sweeps) {
    out[sw.key] = [];
    for (const v of sw.values) {
      const params: SimParams = { ...DEFAULT_PARAMS, incidents: 5000, densityPerKm2: density, [sw.key]: v };
      const runs = SEEDS.map((seed) => runStrategies({ ...params, seed }));
      const pick = (s: StrategyName, f: (r: (typeof runs)[0][0]) => number) => mean(runs.map((run) => f(run.find((r) => r.strategy === s)!)));
      const entry: Record<string, number | string> = { value: v };
      for (const s of STRATEGIES) {
        const reached = pick(s, (r) => r.reachedPct), within = pick(s, (r) => r.withinDeadlinePct), alerts = pick(s, (r) => r.alertsPerIncident);
        rows.push([sw.key, v, s, reached.toFixed(2), within.toFixed(2), alerts.toFixed(2)]);
        entry[s] = `${within.toFixed(2)} on time / ${alerts.toFixed(2)} alerts`;
      }
      out[sw.key].push(entry);
    }
  }
  write("exp4_sensitivity.csv", csv(rows));
  write("exp4_sensitivity.json", JSON.stringify({ density, seeds: SEEDS, defaults: DEFAULT_PARAMS, sweeps: out }, null, 2));
  // Gap between escalation and fixed 3 km on-time rate, per value, for each sweep.
  const gap = sweeps.map((sw) => ({ name: sw.name, points: rows.filter((r) => r[0] === sw.key && r[2] === "escalate").map((r, i) => {
    const f3 = rows.find((q) => q[0] === sw.key && q[1] === r[1] && q[2] === "fixed3")!;
    return { x: Number(r[1]), y: Number(r[4]) - Number(f3[4]) };
  }) }));
  write("exp4_escalate_minus_fixed3.svg", lineChart(
    gap.map((g) => ({ name: g.name, points: g.points.map((p) => ({ x: p.x, y: p.y })) })),
    { title: "On-time rate: escalation minus fixed 3 km", xLabel: "Parameter value (see legend)", yLabel: "Percentage points", width: 640, height: 380 },
  ));
  return out;
}

// ---- Measurement 4: end-to-end latency over the real HTTP server ------------------------
async function latency() {
  const app = createApp({ fixedOtp: "123456" });
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, token?: string, body?: unknown) => {
    const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await res.json().catch(() => null)) as any;
    if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${j?.error}`);
    return j;
  };
  const login = async (phone: string, name: string) => {
    await call("POST", "/api/otp/request", undefined, { phone });
    return (await call("POST", "/api/otp/verify", undefined, { phone, code: "123456", name })).token as string;
  };
  const centre = { lat: 12.9759, lng: 77.605 };
  const doc = await login("+919700000001", "Responder");
  await call("POST", "/api/responder/register", doc, { fullName: "Anita Desai", qualification: "MBBS", regNo: "12345", council: "KMC", regYear: 2010, specialities: ["general"] });
  await call("POST", "/api/duty", doc, { onDuty: true, lat: centre.lat + 0.005, lng: centre.lng });

  // Server-sent-events stream for the responder; resolve a waiter on each alert frame.
  const waiters: (() => void)[] = [];
  const ac = new AbortController();
  const sse = await fetch(`${base}/api/events?token=${doc}`, { signal: ac.signal });
  void (async () => {
    const reader = sse.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) return;
      buf += dec.decode(value);
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (frame.includes("event: notify") && frame.includes("incident_alert")) waiters.shift()?.();
      }
    }
  })();

  const trials = 60;
  const post: number[] = [], push: number[] = [];
  for (let t = 0; t < trials + 5; t++) {
    const poster = await login(`+9197000${String(1000 + t)}`, `Poster ${t}`);
    const at = { lat: centre.lat + t * 0.01, lng: centre.lng }; // spread out so incidents never merge
    await call("POST", "/api/duty", doc, { onDuty: true, lat: at.lat + 0.005, lng: at.lng });
    const arrived = new Promise<number>((resolve) => waiters.push(() => resolve(performance.now())));
    const t0 = performance.now();
    await call("POST", "/api/incidents", poster, { ...at, accuracyM: 8, problemType: "other", note: "", withPhoto: false });
    const t1 = performance.now();
    const t2 = await arrived;
    if (t >= 5) { post.push(t1 - t0); push.push(t2 - t0); } // first 5 are warm-up
  }
  ac.abort();
  await app.close();
  const stats = (xs: number[]) => ({ n: xs.length, p50: quantile(xs, 0.5), p95: quantile(xs, 0.95), max: Math.max(...xs), min: Math.min(...xs) });
  const result = {
    conditions: "Single process, loopback (127.0.0.1), one machine, shared clock, in-memory store, one on-duty responder in range, no real FCM and no radio network. Measures server and browser-stream overhead only, NOT mobile network or push-service latency.",
    machine: { cpu: os.cpus()[0]?.model ?? "unknown", node: process.version, platform: `${os.platform()} ${os.arch()}` },
    warmup: 5,
    postMs: stats(post),
    postToAlertReceivedMs: stats(push),
  };
  write("latency.json", JSON.stringify(result, null, 2));
  write("latency.csv", csv([["trial", "post_response_ms", "alert_received_ms"], ...post.map((p, i) => [i + 1, p.toFixed(2), push[i].toFixed(2)])]));
  write("latency.svg", barChart(
    [
      { label: "p50", value: result.postToAlertReceivedMs.p50 },
      { label: "p95", value: result.postToAlertReceivedMs.p95 },
      { label: "max", value: result.postToAlertReceivedMs.max },
    ],
    { title: `Post to alert received, ${trials} trials (loopback)`, yLabel: "Milliseconds" },
  ));
  return result;
}

const t0 = Date.now();
console.log("experiment 1...");
const e1 = exp1();
console.log("experiment 2...");
const e2 = exp2();
console.log("experiment 3...");
const e3 = exp3();
console.log("sensitivity...");
const e4 = sensitivity();
console.log("latency...");
const lat = await latency();
write("summary.json", JSON.stringify({ generatedBy: "functions/src/experiments.ts", seconds: (Date.now() - t0) / 1000, seeds: SEEDS, exp1: e1, exp2: e2, exp3: e3, exp4: e4, latency: lat }, null, 2));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s, results in ${out}`);
console.log("latency (ms):", JSON.stringify(lat.postToAlertReceivedMs));
