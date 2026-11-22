import { describe, it, expect } from 'vitest';
import { gridSvg, GRID_DIVISIONS, labelWidth, labelPx } from '../electron/gridOverlay.js';

const count = (s, re) => (s.match(re) || []).length;
const rectsWith = (s, attr) => (s.match(new RegExp(`<rect [^>]*${attr}`, 'g')) || []).length;

describe('gridSvg', () => {
  const svg = gridSvg(1280, 960);

  it('draws one line per division on both axes', () => {
    expect(count(svg, /<line /g)).toBe((GRID_DIVISIONS + 1) * 2);
    expect(svg).toContain('width="1280" height="960" viewBox="0 0 1280 960"');
  });

  it('labels both axes with a chip per gridline', () => {
    // 11 x labels along the top + 10 y labels down the left (y=0 shares the corner).
    expect(rectsWith(svg, 'fill-opacity="0.72"')).toBe((GRID_DIVISIONS + 1) + GRID_DIVISIONS);
    // "1000" is 3 digits + a 1, so 11 labels x up to 4 digits are drawn as blocks.
    expect(rectsWith(svg, 'fill="#FFFFFF"')).toBeGreaterThan(100);
  });

  it('produces labels wide enough to read at every value', () => {
    const px = labelPx(1280, 960);
    expect(px).toBeGreaterThanOrEqual(2);
    for (let v = 0; v <= 1000; v += 100) expect(labelWidth(String(v), px)).toBeGreaterThanOrEqual(10);
  });

  it('keeps every chip inside the frame and never emits invalid numbers', () => {
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    const x = 1280, y = 960;
    for (const m of svg.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="(\d+)" height="(\d+)"/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(0);
      expect(Number(m[2])).toBeGreaterThanOrEqual(0);
      expect(Number(m[1]) + Number(m[3])).toBeLessThanOrEqual(x);
      expect(Number(m[2]) + Number(m[4])).toBeLessThanOrEqual(y);
    }
  });

  it('handles tiny and odd sizes', () => {
    for (const [w, h] of [[40, 30], [1, 1], [1001, 37]]) {
      const out = gridSvg(w, h);
      expect(out).not.toMatch(/NaN|undefined|Infinity/);
      expect(out).toContain(`width="${w}" height="${h}"`);
      for (const m of out.matchAll(/<rect x="(-?[\d.]+)"/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(0);
    }
  });
});
