import { describe, it, expect } from 'vitest';
import { normalizeCaption, normalizeHexColor, serializeCaption } from '../electron/captionNormalize.js';

const baseStyle = {
  aesthetics: 'warm, cozy',
  lighting: 'soft daylight',
  medium: 'photograph',
  photo: '35mm, f/1.4',
  art_style: 'photo style',
  color_palette: ['#ff6b35', 'F7C59F', '#004e89'],
};

const baseElements = [
  { type: 'obj', bbox: { y_min: 10, x_min: 10, y_max: 500, x_max: 500 }, desc: 'A cat sitting.', color_palette: ['#ffffff'] },
];

function baseRaw() {
  return {
    high_level_description: '  A cat.  ',
    style_description: { ...baseStyle },
    compositional_deconstruction: { background: 'A room.', elements: structuredClone(baseElements) },
  };
}

describe('normalizeHexColor', () => {
  it('uppercases and keeps valid hex', () => {
    expect(normalizeHexColor('#ff6b35')).toBe('#FF6B35');
  });
  it('adds a missing hash', () => {
    expect(normalizeHexColor('ff6b35')).toBe('#FF6B35');
  });
  it('expands 3-digit shorthand', () => {
    expect(normalizeHexColor('#fff')).toBe('#FFFFFF');
    expect(normalizeHexColor('abc')).toBe('#AABBCC');
  });
  it('rejects garbage', () => {
    expect(normalizeHexColor('red')).toBeNull();
    expect(normalizeHexColor('#12345')).toBeNull();
    expect(normalizeHexColor('#GGGGGG')).toBeNull();
    expect(normalizeHexColor(42)).toBeNull();
    expect(normalizeHexColor('')).toBeNull();
  });
});

describe('normalizeCaption', () => {
  it('accepts a valid caption and canonicalizes it', () => {
    const r = normalizeCaption(baseRaw());
    expect(r.ok).toBe(true);
    expect(r.value.high_level_description).toBe('A cat.');
    // photo variant keeps photo, drops art_style
    expect(r.value.style_description.photo).toBe('35mm, f/1.4');
    expect(r.value.style_description).not.toHaveProperty('art_style');
    // palettes normalized + deduped + capped
    expect(r.value.style_description.color_palette).toEqual(['#FF6B35', '#F7C59F', '#004E89']);
    // labeled bbox object -> official array form
    expect(r.value.compositional_deconstruction.elements[0].bbox).toEqual([10, 10, 500, 500]);
    // canonical top-level key order
    expect(Object.keys(r.value)).toEqual(['high_level_description', 'style_description', 'compositional_deconstruction']);
  });

  it('keeps art variant and drops photo', () => {
    const raw = baseRaw();
    raw.style_description.medium = 'illustration';
    raw.style_description.art_style = 'flat vector';
    const r = normalizeCaption(raw);
    expect(r.ok).toBe(true);
    expect(r.value.style_description.art_style).toBe('flat vector');
    expect(r.value.style_description).not.toHaveProperty('photo');
  });

  it('swaps inverted bbox coords and clamps to 0-1000', () => {
    const raw = baseRaw();
    raw.compositional_deconstruction.elements[0].bbox = [900, 800, 100, 2000];
    const r = normalizeCaption(raw);
    expect(r.ok).toBe(true);
    // [ymin,xmin,ymax,xmax]: clamp xmax 2000->1000, swap y 900/100
    expect(r.value.compositional_deconstruction.elements[0].bbox).toEqual([100, 800, 900, 1000]);
  });

  it('drops exact-duplicate boxes, keeping the first', () => {
    const raw = baseRaw();
    raw.compositional_deconstruction.elements.push({
      type: 'obj', bbox: { y_min: 10, x_min: 10, y_max: 500, x_max: 500 }, desc: 'Duplicate.',
    });
    const r = normalizeCaption(raw);
    expect(r.ok).toBe(true);
    expect(r.value.compositional_deconstruction.elements).toHaveLength(1);
  });

  it('falls back to high_level_description when background is empty', () => {
    const raw = baseRaw();
    raw.compositional_deconstruction.background = '   ';
    const r = normalizeCaption(raw);
    expect(r.ok).toBe(true);
    expect(r.value.compositional_deconstruction.background).toBe('A cat.');
  });

  it('rejects missing composition / empty elements / empty style', () => {
    expect(normalizeCaption(null).ok).toBe(false);
    expect(normalizeCaption({}).ok).toBe(false);
    const noEl = baseRaw();
    noEl.compositional_deconstruction.elements = [{ type: 'obj', desc: '   ' }];
    expect(normalizeCaption(noEl).ok).toBe(false);
    const noStyle = baseRaw();
    delete noStyle.style_description;
    expect(normalizeCaption(noStyle).ok).toBe(false);
  });

  it('serializes compactly', () => {
    const r = normalizeCaption(baseRaw());
    expect(serializeCaption(r.value)).toBe(JSON.stringify(r.value));
  });
});
