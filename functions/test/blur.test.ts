import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Blur = require("../../web/blur.js") as {
  pixelateRegion(d: Uint8ClampedArray, w: number, h: number, box: { x: number; y: number; width: number; height: number }, block: number): void;
  padBox(box: { x: number; y: number; width: number; height: number }, w: number, h: number, pad: number): { x: number; y: number; width: number; height: number };
  blockSizeFor(box: { width: number; height: number }): number;
  regionDiffers(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, box: { x: number; y: number; width: number; height: number }): number;
};

// A noisy w x h RGBA image so any blur visibly changes pixels.
function image(w: number, h: number) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = (i * 37) % 256;
    d[i * 4 + 1] = (i * 91) % 256;
    d[i * 4 + 2] = (i * 53) % 256;
    d[i * 4 + 3] = 255;
  }
  return d;
}
const px = (d: Uint8ClampedArray, w: number, x: number, y: number) => [...d.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];

describe("pixelateRegion", () => {
  const w = 40, h = 40;
  const box = { x: 10, y: 10, width: 20, height: 20 };

  it("changes pixels inside the box and leaves pixels outside untouched", () => {
    const before = image(w, h);
    const after = image(w, h);
    Blur.pixelateRegion(after, w, h, box, 10);
    expect(px(after, w, 0, 0)).toEqual(px(before, w, 0, 0));
    expect(px(after, w, 39, 39)).toEqual(px(before, w, 39, 39));
    expect(px(after, w, 9, 15)).toEqual(px(before, w, 9, 15)); // just left of the box
    expect(px(after, w, 30, 15)).toEqual(px(before, w, 30, 15)); // just right of the box
    expect(Blur.regionDiffers(before, after, w, box)).toBeGreaterThan(0.5);
  });

  it("makes every pixel in a block identical (real pixel destruction, not an overlay)", () => {
    const d = image(w, h);
    Blur.pixelateRegion(d, w, h, box, 10);
    const first = px(d, w, 10, 10);
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) expect(px(d, w, x, y)).toEqual(first);
  });

  it("clips a box that sticks out of the image without throwing", () => {
    const d = image(w, h);
    expect(() => Blur.pixelateRegion(d, w, h, { x: -5, y: 30, width: 30, height: 30 }, 8)).not.toThrow();
  });

  it("ignores a degenerate box", () => {
    const before = image(w, h);
    const d = image(w, h);
    Blur.pixelateRegion(d, w, h, { x: 5, y: 5, width: 0, height: 0 }, 8);
    expect(d).toEqual(before);
  });
});

describe("padBox and blockSizeFor", () => {
  it("pads outwards but stays inside the image", () => {
    const b = Blur.padBox({ x: 2, y: 2, width: 10, height: 10 }, 20, 20, 0.5);
    expect(b.x).toBe(0);
    expect(b.y).toBe(0);
    expect(b.x + b.width).toBeLessThanOrEqual(20);
    expect(b.y + b.height).toBeLessThanOrEqual(20);
    expect(b.width).toBeGreaterThan(10);
  });
  it("blocks are coarse: at most about 6 blocks across the face, at least 4 px", () => {
    expect(Blur.blockSizeFor({ width: 120, height: 150 })).toBeGreaterThanOrEqual(20);
    expect(Blur.blockSizeFor({ width: 6, height: 6 })).toBe(4);
  });
});
