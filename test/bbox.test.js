import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { toIdeogramBox, applyGrounding } = require('../electron/bbox.js');

describe('toIdeogramBox', () => {
  it('transposes x-first grounding boxes into Ideogram y-first order', () => {
    // white car in the lower-left: x 0-280, y 700-900
    expect(toIdeogramBox([0, 700, 280, 900])).toEqual([700, 0, 900, 280]);
  });

  it('rounds and clamps to 0-1000', () => {
    expect(toIdeogramBox([-20, 200, 1200, 1500])).toEqual([200, 0, 1000, 1000]);
    expect(toIdeogramBox([10.6, 20.4, 30.5, 40.5])).toEqual([20, 11, 41, 31]);
  });

  it('accepts numeric strings from the grammar', () => {
    expect(toIdeogramBox(['10', '20', '110', '220'])).toEqual([20, 10, 220, 110]);
  });

  it('sorts inverted ranges instead of dropping them', () => {
    expect(toIdeogramBox([300, 800, 100, 200])).toEqual([200, 100, 800, 300]);
  });

  it('rejects unusable boxes', () => {
    expect(toIdeogramBox(null)).toBeNull();
    expect(toIdeogramBox([0, 0, 10])).toBeNull();
    expect(toIdeogramBox([0, 0, 0, 500])).toBeNull();
    expect(toIdeogramBox([0, 0, 'x', 500])).toBeNull();
    expect(toIdeogramBox([0, 0, NaN, 500])).toBeNull();
  });
});

describe('applyGrounding', () => {
  const elements = [
    { type: 'obj', bbox: [0, 0, 10, 10], desc: 'boy', color_palette: ['#111111'] },
    { type: 'text', bbox: [1, 1, 2, 2], text: 'F1', desc: 'logo', color_palette: ['#222222'] },
  ];

  it('maps 1-based indices and keeps Ideogram key order', () => {
    const { elements: out, applied } = applyGrounding(elements, [
      { index: 1, bbox: [0, 700, 280, 900] },
      { index: 2, bbox: [600, 100, 700, 200] },
    ]);
    expect(applied).toBe(2);
    expect(out[0].bbox).toEqual([700, 0, 900, 280]);
    expect(Object.keys(out[0])).toEqual(['type', 'bbox', 'desc', 'color_palette']);
    expect(Object.keys(out[1])).toEqual(['type', 'bbox', 'text', 'desc', 'color_palette']);
  });

  it('leaves elements untouched when their box is missing or invalid', () => {
    const { elements: out, applied } = applyGrounding(elements, [
      { index: 1, bbox: [0, 0, 0, 0] },
      { index: 9, bbox: [1, 2, 3, 4] },
    ]);
    expect(applied).toBe(0);
    expect(out[0].bbox).toEqual([0, 0, 10, 10]);
    expect(out[1].bbox).toEqual([1, 1, 2, 2]);
  });

  it('tolerates a missing or empty answer', () => {
    expect(applyGrounding(elements, null).applied).toBe(0);
    expect(applyGrounding(elements, []).applied).toBe(0);
  });
});
