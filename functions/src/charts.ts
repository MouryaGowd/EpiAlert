/** Minimal dependency-free SVG line charts, drawn from the measured data only. */
export interface Series {
  name: string;
  points: { x: number; y: number; err?: number }[];
  dash?: boolean;
}
export interface ChartOpts {
  title: string;
  xLabel: string;
  yLabel: string;
  logX?: boolean;
  logY?: boolean;
  width?: number;
  height?: number;
  /** Optional explicit tick labels for x (value -> label). */
  xTicks?: { value: number; label: string }[];
}

// Colour-blind-safe (Okabe-Ito) palette, chosen for contrast on white.
const COLOURS = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9"];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (v: number) => (Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v * 10) / 10) : String(Math.round(v * 100) / 100));

function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (hi === lo) return [lo];
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export function lineChart(series: Series[], o: ChartOpts): string {
  const W = o.width ?? 640, H = o.height ?? 380;
  const m = { l: 62, r: 16, t: 40, b: 56 + 18 * Math.ceil(series.length / 3) };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const all = series.flatMap((s) => s.points).filter((p) => Number.isFinite(p.y));
  const tx = (v: number) => (o.logX ? Math.log10(v) : v);
  const ty = (v: number) => (o.logY ? Math.log10(v) : v);
  const xs = all.map((p) => tx(p.x)), ys = all.flatMap((p) => [ty(p.y), ty(p.y + (p.err ?? 0)), ty(Math.max(p.y - (p.err ?? 0), o.logY ? 1e-9 : -Infinity))]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = o.logY ? Math.min(...ys) : Math.min(0, ...ys), y1 = Math.max(...ys);
  if (y1 === y0) y1 = y0 + 1;
  y1 += (y1 - y0) * 0.06;
  const X = (v: number) => m.l + ((tx(v) - x0) / (x1 - x0 || 1)) * pw;
  const Y = (v: number) => m.t + ph - ((ty(v) - y0) / (y1 - y0)) * ph;

  const g: string[] = [];
  g.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif" font-size="12" role="img" aria-label="${esc(o.title)}">`);
  g.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  g.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="14" font-weight="600" fill="#111">${esc(o.title)}</text>`);

  const yTicks = o.logY ? [] : niceTicks(y0, y1);
  if (o.logY) for (let e = Math.ceil(y0); e <= Math.floor(y1); e++) yTicks.push(10 ** e);
  for (const t of yTicks) {
    const y = Y(t);
    g.push(`<line x1="${m.l}" y1="${y}" x2="${m.l + pw}" y2="${y}" stroke="#e3e6ea"/>`);
    g.push(`<text x="${m.l - 8}" y="${y + 4}" text-anchor="end" fill="#333">${fmt(t)}</text>`);
  }
  const xTicks = o.xTicks ?? (o.logX ? [] : niceTicks(x0, x1).map((v) => ({ value: v, label: fmt(v) })));
  if (o.logX && !o.xTicks) for (let e = Math.ceil(x0); e <= Math.floor(x1); e++) xTicks.push({ value: 10 ** e, label: fmt(10 ** e) });
  for (const t of xTicks) {
    const x = X(t.value);
    g.push(`<line x1="${x}" y1="${m.t + ph}" x2="${x}" y2="${m.t + ph + 4}" stroke="#333"/>`);
    g.push(`<text x="${x}" y="${m.t + ph + 18}" text-anchor="middle" fill="#333">${esc(t.label)}</text>`);
  }
  g.push(`<line x1="${m.l}" y1="${m.t + ph}" x2="${m.l + pw}" y2="${m.t + ph}" stroke="#333"/><line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${m.t + ph}" stroke="#333"/>`);
  g.push(`<text x="${m.l + pw / 2}" y="${m.t + ph + 38}" text-anchor="middle" fill="#111">${esc(o.xLabel)}</text>`);
  g.push(`<text transform="translate(16 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="#111">${esc(o.yLabel)}</text>`);

  series.forEach((s, i) => {
    const c = COLOURS[i % COLOURS.length];
    const pts = s.points.filter((p) => Number.isFinite(p.y));
    if (pts.length === 0) return;
    g.push(`<polyline fill="none" stroke="${c}" stroke-width="2"${s.dash ? ' stroke-dasharray="6 4"' : ""} points="${pts.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ")}"/>`);
    for (const p of pts) {
      if (p.err) g.push(`<line x1="${X(p.x)}" y1="${Y(p.y + p.err)}" x2="${X(p.x)}" y2="${Y(Math.max(p.y - p.err, o.logY ? 1e-9 : -Infinity))}" stroke="${c}" stroke-width="1.2"/>`);
      g.push(`<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3.4" fill="${c}"/>`);
    }
    const col = i % 3, row = Math.floor(i / 3);
    const lx = m.l + col * (pw / 3), ly = H - 16 - 18 * (Math.ceil(series.length / 3) - 1 - row);
    g.push(`<line x1="${lx}" y1="${ly - 4}" x2="${lx + 22}" y2="${ly - 4}" stroke="${c}" stroke-width="2"${s.dash ? ' stroke-dasharray="6 4"' : ""}/><text x="${lx + 28}" y="${ly}" fill="#111">${esc(s.name)}</text>`);
  });
  g.push("</svg>");
  return g.join("\n");
}

export function barChart(bars: { label: string; value: number }[], o: Pick<ChartOpts, "title" | "yLabel" | "width" | "height">): string {
  const W = o.width ?? 640, H = o.height ?? 360;
  const m = { l: 62, r: 16, t: 40, b: 60 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const max = Math.max(...bars.map((b) => b.value), 1e-9) * 1.1;
  const bw = pw / bars.length;
  const g: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif" font-size="12" role="img" aria-label="${esc(o.title)}"><rect width="${W}" height="${H}" fill="#fff"/>`];
  g.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="14" font-weight="600" fill="#111">${esc(o.title)}</text>`);
  for (const t of niceTicks(0, max)) {
    const y = m.t + ph - (t / max) * ph;
    g.push(`<line x1="${m.l}" y1="${y}" x2="${m.l + pw}" y2="${y}" stroke="#e3e6ea"/><text x="${m.l - 8}" y="${y + 4}" text-anchor="end" fill="#333">${fmt(t)}</text>`);
  }
  bars.forEach((b, i) => {
    const h = (b.value / max) * ph, x = m.l + i * bw + bw * 0.18;
    g.push(`<rect x="${x}" y="${m.t + ph - h}" width="${bw * 0.64}" height="${h}" fill="${COLOURS[i % COLOURS.length]}"/>`);
    g.push(`<text x="${x + bw * 0.32}" y="${m.t + ph - h - 5}" text-anchor="middle" fill="#111">${fmt(b.value)}</text>`);
    g.push(`<text x="${x + bw * 0.32}" y="${m.t + ph + 18}" text-anchor="middle" fill="#333">${esc(b.label)}</text>`);
  });
  g.push(`<line x1="${m.l}" y1="${m.t + ph}" x2="${m.l + pw}" y2="${m.t + ph}" stroke="#333"/><text transform="translate(16 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="#111">${esc(o.yLabel)}</text></svg>`);
  return g.join("\n");
}
