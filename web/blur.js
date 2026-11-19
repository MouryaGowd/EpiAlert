/* On-device face blur helpers (ADR-2). Pure functions so Node can test them; the browser pipeline is in app.js.
   Blur is applied to the PIXELS of the canvas, then the image is re-encoded, which also drops all EXIF.
   Blur is best-effort: a face the detector misses stays visible, so the user must confirm the preview. */
(function (root) {
  "use strict";

  function clampBox(box, w, h) {
    var x0 = Math.max(0, Math.floor(box.x));
    var y0 = Math.max(0, Math.floor(box.y));
    var x1 = Math.min(w, Math.ceil(box.x + box.width));
    var y1 = Math.min(h, Math.ceil(box.y + box.height));
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  /** Replace each block x block cell inside the box with its average colour. Mutates `data` (RGBA). */
  function pixelateRegion(data, w, h, box, block) {
    var b = clampBox(box, w, h);
    if (b.x1 <= b.x0 || b.y1 <= b.y0 || block < 1) return;
    for (var by = b.y0; by < b.y1; by += block) {
      for (var bx = b.x0; bx < b.x1; bx += block) {
        var ey = Math.min(by + block, b.y1);
        var ex = Math.min(bx + block, b.x1);
        var r = 0, g = 0, bl = 0, n = 0, x, y, i;
        for (y = by; y < ey; y++) {
          for (x = bx; x < ex; x++) {
            i = (y * w + x) * 4;
            r += data[i]; g += data[i + 1]; bl += data[i + 2]; n++;
          }
        }
        r = Math.round(r / n); g = Math.round(g / n); bl = Math.round(bl / n);
        for (y = by; y < ey; y++) {
          for (x = bx; x < ex; x++) {
            i = (y * w + x) * 4;
            data[i] = r; data[i + 1] = g; data[i + 2] = bl;
          }
        }
      }
    }
  }

  /** Grow a detected face box so hair, chin and ears are covered, kept inside the image. */
  function padBox(box, w, h, pad) {
    var px = box.width * pad, py = box.height * pad;
    var x = Math.max(0, box.x - px), y = Math.max(0, box.y - py);
    var x2 = Math.min(w, box.x + box.width + px), y2 = Math.min(h, box.y + box.height + py);
    return { x: x, y: y, width: x2 - x, height: y2 - y };
  }

  /** Coarse blocks: roughly 6 across the shortest side, never finer than 4 px. */
  function blockSizeFor(box) {
    return Math.max(4, Math.round(Math.min(box.width, box.height) / 6));
  }

  /** Fraction (0..1) of pixels inside the box whose RGB differs between two images. */
  function regionDiffers(a, b, w, box) {
    var h = a.length / 4 / w;
    var c = clampBox(box, w, h);
    var total = 0, diff = 0;
    for (var y = c.y0; y < c.y1; y++) {
      for (var x = c.x0; x < c.x1; x++) {
        var i = (y * w + x) * 4;
        total++;
        if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff++;
      }
    }
    return total ? diff / total : 0;
  }

  var api = { pixelateRegion: pixelateRegion, padBox: padBox, blockSizeFor: blockSizeFor, regionDiffers: regionDiffers };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Blur = api;
})(typeof self !== "undefined" ? self : this);
