import { describe, it, expect } from 'vitest';
import { toHex, topColorsFromPixels, grayToRgb } from '../electron/palette.js';

function solid(w, h, r, g, b) {
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { buf[i * 3] = r; buf[i * 3 + 1] = g; buf[i * 3 + 2] = b; }
  return buf;
}

describe('toHex', () => {
  it('formats uppercase #RRGGBB and clamps', () => {
    expect(toHex(255, 107, 53)).toBe('#FF6B35');
    expect(toHex(0, 0, 0)).toBe('#000000');
    expect(toHex(300, -5, 128)).toBe('#FF0080');
    expect(toHex(232.4, 180.6, 140)).toBe('#E8B58C');
  });
});

describe('topColorsFromPixels', () => {
  it('returns the dominant color of a solid region', () => {
    expect(topColorsFromPixels(solid(32, 32, 232, 180, 140), 5)).toEqual(['#E8B48C']);
  });

  it('orders by frequency and caps at maxColors', () => {
    const big = solid(30, 32, 10, 20, 30);
    const small = solid(2, 32, 200, 210, 220);
    const data = Buffer.concat([big, small]);
    const out = topColorsFromPixels(data, 5);
    expect(out[0]).toBe('#0A141E');
    expect(out).toContain('#C8D2DC');
    expect(topColorsFromPixels(data, 1)).toHaveLength(1);
  });

  it('skips near-duplicate shades for diversity', () => {
    const a = solid(16, 32, 232, 180, 140);
    const b = solid(16, 32, 231, 180, 141); // distance ~1.4 from a
    const c = solid(16, 32, 58, 110, 165);
    const out = topColorsFromPixels(Buffer.concat([a, b, c]), 5, 32);
    expect(out).toContain('#E8B48C');
    expect(out).toContain('#3A6EA5');
    expect(out).toHaveLength(2);
  });

  it('returns [] for empty input', () => {
    expect(topColorsFromPixels(Buffer.alloc(0), 5)).toEqual([]);
  });
});

describe('grayToRgb', () => {
  it('triples each byte', () => {
    expect([...grayToRgb(Buffer.from([0, 128, 255]))]).toEqual([0, 0, 0, 128, 128, 128, 255, 255, 255]);
  });
});
