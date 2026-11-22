// Bounding-box conversion between the two coordinate conventions in play.
//
// Ideogram 4 (our output) wants [y_min, x_min, y_max, x_max], 0-1000 per axis,
// origin top-left, and normalizes each axis to the frame independently — see
// docs/prompting.md ("[y_min, x_min, y_max, x_max] in normalized 0-1000
// coordinates (origin at top-left)").
//
// The local vision model (Qwen3-VL) was trained to emit grounding boxes in its
// own convention: "bbox_2d": [x1, y1, x2, y2], also normalized 0-1000 per axis
// and also origin top-left. Asking it for y-first inline in the caption JSON
// made it place boxes badly, so the grounding pass asks in its native order and
// this module transposes deterministically.
//
// Pure functions: no fs, no sharp, unit-testable.

const BBOX_MAX = 1000;

function clampInt(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.min(BBOX_MAX, Math.max(0, Math.round(value)));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.min(BBOX_MAX, Math.max(0, Math.round(n)));
  }
  return null;
}

// Qwen-style [x_min, y_min, x_max, y_max] -> Ideogram [y_min, x_min, y_max, x_max].
// Returns null for anything unusable (wrong shape, non-numeric, zero-area).
function toIdeogramBox(box) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const nums = box.map(clampInt);
  if (nums.some((n) => n === null)) return null;
  let [xMin, yMin, xMax, yMax] = nums;
  if (xMin > xMax) [xMin, xMax] = [xMax, xMin];
  if (yMin > yMax) [yMin, yMax] = [yMax, yMin];
  if (xMin === xMax || yMin === yMax) return null;
  return [yMin, xMin, yMax, xMax];
}

// Rebuild an element with a fresh box, preserving Ideogram's strict key order
// (obj: type, bbox, desc, color_palette; text: type, bbox, text, desc, ...).
function withBox(element, bbox) {
  const out = { type: element.type === 'text' ? 'text' : 'obj' };
  out.bbox = bbox;
  if (out.type === 'text' && typeof element.text === 'string') out.text = element.text;
  out.desc = element.desc;
  if (Array.isArray(element.color_palette)) out.color_palette = element.color_palette;
  return out;
}

// Merge a grounding answer ({boxes:[{index, bbox}]}, 1-based index into the
// element list) into the caption's elements. Entries that fail conversion are
// skipped, so a partial or malformed answer leaves those boxes as they were.
function applyGrounding(elements, boxes) {
  const list = Array.isArray(elements) ? elements : [];
  const byIndex = new Map();
  for (const entry of Array.isArray(boxes) ? boxes : []) {
    const index = Number(entry?.index);
    if (!Number.isInteger(index) || index < 1 || index > list.length) continue;
    const box = toIdeogramBox(entry?.bbox);
    if (box) byIndex.set(index, box);
  }
  let applied = 0;
  const out = list.map((element, i) => {
    const box = byIndex.get(i + 1);
    if (!box) return element;
    applied++;
    return withBox(element, box);
  });
  return { elements: out, applied };
}

module.exports = { toIdeogramBox, applyGrounding, withBox, BBOX_MAX };
