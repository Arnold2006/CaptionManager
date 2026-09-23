// Pure palette quantization helpers (CommonJS, no Electron/sharp imports).
// Shared by the main-process sampler and unit tests.
const { sampleColorDistance, sampleQuantShift } = require('./config');

function toHex(r, g, b) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
  return '#' + h(r) + h(g) + h(b);
}

// data: flat RGB bytes. Returns up to maxColors hex colors, most frequent
// first, with near-duplicates (euclidean RGB distance) skipped for diversity.
function topColorsFromPixels(data, maxColors, distance = sampleColorDistance) {
  const shift = sampleQuantShift;
  const buckets = new Map();
  for (let i = 0; i + 2 < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = ((r >> shift) << (2 * (8 - shift))) | ((g >> shift) << (8 - shift)) | (b >> shift);
    let e = buckets.get(key);
    if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; buckets.set(key, e); }
    e.n++; e.r += r; e.g += g; e.b += b;
  }
  const sorted = [...buckets.values()]
    .map((e) => ({ n: e.n, r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }))
    .sort((a, b) => b.n - a.n);
  const picked = [];
  const tooClose = (c) => picked.some((p) => {
    const dr = p.r - c.r, dg = p.g - c.g, db = p.b - c.b;
    return Math.sqrt(dr * dr + dg * dg + db * db) < distance;
  });
  for (const c of sorted) {
    if (picked.length >= maxColors) break;
    if (!tooClose(c)) picked.push(c);
  }
  return picked.slice(0, maxColors).map((c) => toHex(c.r, c.g, c.b));
}

// Expand single-channel grayscale bytes to RGB.
function grayToRgb(gray) {
  const out = Buffer.alloc(gray.length * 3);
  for (let i = 0; i < gray.length; i++) {
    out[i * 3] = gray[i]; out[i * 3 + 1] = gray[i]; out[i * 3 + 2] = gray[i];
  }
  return out;
}

module.exports = { toHex, topColorsFromPixels, grayToRgb };
