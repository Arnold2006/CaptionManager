import { describe, it, expect } from 'vitest';
import { validateCaption } from '../electron/captionValidate.js';

function validPhoto() {
  return {
    high_level_description: 'A cat.',
    style_description: {
      aesthetics: 'warm',
      lighting: 'soft daylight',
      photo: '35mm, f/1.4',
      medium: 'photograph',
      color_palette: ['#FF6B35'],
    },
    compositional_deconstruction: {
      background: 'A room.',
      elements: [
        { type: 'obj', bbox: [10, 10, 500, 500], desc: 'A cat.', color_palette: ['#FFFFFF'] },
        { type: 'text', bbox: [600, 100, 700, 900], text: 'HELLO', desc: 'A sign.' },
      ],
    },
  };
}

describe('validateCaption', () => {
  it('accepts a canonical caption', () => {
    expect(validateCaption(validPhoto())).toEqual({ valid: true, errors: [] });
  });

  it('rejects non-objects', () => {
    expect(validateCaption(null).valid).toBe(false);
    expect(validateCaption([1]).valid).toBe(false);
  });

  it('rejects bad hex, out-of-range and zero-area bboxes', () => {
    const c = validPhoto();
    c.style_description.color_palette = ['#gggggg'];
    c.compositional_deconstruction.elements[0].bbox = [10, 10, 500, 5000];
    expect(validateCaption(c).valid).toBe(false);

    const z = validPhoto();
    z.compositional_deconstruction.elements[0].bbox = [100, 100, 100, 500];
    expect(validateCaption(z).errors.some((e) => e.includes('zero-area'))).toBe(true);
  });

  it('rejects empty text element text', () => {
    const c = validPhoto();
    c.compositional_deconstruction.elements[1].text = '  ';
    expect(validateCaption(c).valid).toBe(false);
  });

  it('enforces photo/art variant exclusivity', () => {
    const c = validPhoto();
    c.style_description.art_style = 'oil';
    expect(validateCaption(c).errors.some((e) => e.includes('art_style'))).toBe(true);

    const a = validPhoto();
    a.style_description.medium = 'painting';
    delete a.style_description.photo;
    a.style_description.art_style = 'oil, impasto';
    // fix key order for art variant
    a.style_description = {
      aesthetics: a.style_description.aesthetics,
      lighting: a.style_description.lighting,
      medium: 'painting',
      art_style: 'oil, impasto',
    };
    expect(validateCaption(a).valid).toBe(true);
  });

  it('enforces key order', () => {
    const c = validPhoto();
    c.style_description = {
      medium: 'photograph',
      photo: '35mm',
      lighting: 'soft',
      aesthetics: 'warm',
    };
    const r = validateCaption(c);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('style_description'))).toBe(true);
  });
});
