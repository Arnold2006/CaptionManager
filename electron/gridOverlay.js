// Labeled 0-1000 coordinate grid for the Ideogram vision input.
//
// Small local VLMs are poor at inventing normalized coordinates: they guess
// round numbers, echo examples from the prompt, and sometimes measure y up from
// the bottom edge. A visible grid with the values printed on it turns "estimate
// a coordinate" into "read the line next to the object", so every bbox edge can
// be named against a gridline instead of hallucinated.
//
// Labels are drawn as vector blocks rather than SVG <text>: sharp renders SVG
// text only when the host has usable fonts, and a silent no-label grid would
// defeat the whole point.
//
// Pure string builder: no sharp, no DOM, unit-testable on its own.
const GRID_DIVISIONS = 10;

// 5x7 block digits.
const DIGITS = {
  0: ['11111', '10001', '10001', '10001', '10001', '10001', '11111'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['11111', '00001', '00001', '11111', '10000', '10000', '11111'],
  3: ['11111', '00001', '00001', '11111', '00001', '00001', '11111'],
  4: ['10001', '10001', '10001', '11111', '00001', '00001', '00001'],
  5: ['11111', '10000', '10000', '11111', '00001', '00001', '11111'],
  6: ['11111', '10000', '10000', '11111', '10001', '10001', '11111'],
  7: ['11111', '00001', '00001', '00001', '00001', '00001', '00001'],
  8: ['11111', '10001', '10001', '11111', '10001', '10001', '11111'],
  9: ['11111', '10001', '10001', '11111', '00001', '00001', '11111'],
};

const DIGIT_W = 5;
const DIGIT_H = 7;
const TRACKING = 1; // blank block columns between digits

function labelPx(w, h) {
  // Block size: 2px gives 10x14 labels on a 640px image, 16px on a 1280px one.
  return Math.min(4, Math.max(2, Math.round(Math.min(w, h) / 450)));
}

function labelWidth(label, px) {
  return label.length * (DIGIT_W + TRACKING) * px - TRACKING * px;
}

function labelRects(label, x, y, px, color) {
  const out = [];
  let cursor = x;
  for (const ch of label) {
    const rows = DIGITS[ch];
    if (rows) {
      for (let ry = 0; ry < DIGIT_H; ry++) {
        for (let rx = 0; rx < DIGIT_W; rx++) {
          if (rows[ry][rx] === '1') {
            out.push(`<rect x="${cursor + rx * px}" y="${y + ry * px}" width="${px}" height="${px}" fill="${color}"/>`);
          }
        }
      }
    }
    cursor += (DIGIT_W + TRACKING) * px;
  }
  return out;
}

function gridSvg(width, height) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const div = GRID_DIVISIONS;
  const px = labelPx(w, h);
  const pad = px * 2;
  const chipH = DIGIT_H * px + pad * 2;
  const stroke = Math.max(1, Math.round(Math.min(w, h) / 700));
  const parts = [];

  const chip = (label, x, y, alignRight) => {
    const cw = Math.min(w, labelWidth(label, px) + pad * 2);
    const cx = Math.max(0, Math.min(alignRight ? x - cw : x, w - cw));
    const cy = Math.max(0, Math.min(y, h - chipH));
    parts.push(`<rect x="${cx}" y="${cy}" width="${cw}" height="${chipH}" fill="#000000" fill-opacity="0.72"/>`);
    parts.push(...labelRects(label, cx + pad, cy + pad, px, '#FFFFFF'));
  };

  // Vertical lines with their x value along the top edge.
  for (let i = 0; i <= div; i++) {
    const x = Math.round((w * i) / div);
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#00E5FF" stroke-opacity="0.5" stroke-width="${stroke}"/>`);
    chip(String(Math.round((1000 * i) / div)), x, 0, i === div);
  }

  // Horizontal lines with their y value along the left edge. y=0 shares the
  // top-left corner chip, so it gets a line but no second label.
  for (let i = 0; i <= div; i++) {
    const y = Math.round((h * i) / div);
    parts.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#00E5FF" stroke-opacity="0.5" stroke-width="${stroke}"/>`);
    if (i === 0) continue;
    chip(String(Math.round((1000 * i) / div)), 0, y, false);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`;
}

module.exports = { gridSvg, GRID_DIVISIONS, labelWidth, labelPx };
