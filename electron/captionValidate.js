// Self-contained Ideogram 4 caption validation (no external deps).
// Checks: required fields, hex format, bbox ranges, variant rules, key order.

const HEX_RE = /^#[0-9A-F]{6}$/;
const KEY_ORDER = {
  top: ['high_level_description', 'style_description', 'compositional_deconstruction'],
  stylePhoto: ['aesthetics', 'lighting', 'photo', 'medium', 'color_palette'],
  styleArt: ['aesthetics', 'lighting', 'medium', 'art_style', 'color_palette'],
  composition: ['background', 'elements'],
  elementObj: ['type', 'bbox', 'desc', 'color_palette'],
  elementText: ['type', 'bbox', 'text', 'desc', 'color_palette']
};

function checkKeyOrder(obj, canonical, label, errors) {
  const actual = Object.keys(obj);
  const expected = canonical.filter((k) => k in obj);
  if (actual.join(',') !== expected.join(',')) {
    errors.push(`${label}: keys are [${actual.join(', ')}], expected order [${expected.join(', ')}]`);
  }
}

function validateCaption(caption) {
  const errors = [];
  if (typeof caption !== 'object' || caption === null || Array.isArray(caption)) {
    return { valid: false, errors: ['caption is not an object'] };
  }
  const comp = caption.compositional_deconstruction;
  if (typeof comp !== 'object' || comp === null || Array.isArray(comp)) {
    errors.push('compositional_deconstruction is missing');
  } else {
    if (typeof comp.background !== 'string' || comp.background.trim().length === 0) {
      errors.push('compositional_deconstruction.background is empty');
    }
    if (!Array.isArray(comp.elements) || comp.elements.length === 0) {
      errors.push('compositional_deconstruction.elements is empty');
    } else {
      comp.elements.forEach((el, i) => {
        if (typeof el !== 'object' || el === null) { errors.push(`elements[${i}] is not an object`); return; }
        if (el.type !== 'obj' && el.type !== 'text') errors.push(`elements[${i}].type must be "obj" or "text"`);
        if (el.type === 'text' && (typeof el.text !== 'string' || el.text.trim().length === 0)) {
          errors.push(`elements[${i}].text is empty`);
        }
        if (typeof el.desc !== 'string' || el.desc.trim().length === 0) errors.push(`elements[${i}].desc is empty`);
        if (el.bbox !== undefined) {
          if (!Array.isArray(el.bbox) || el.bbox.length !== 4 || el.bbox.some((n) => !Number.isInteger(n) || n < 0 || n > 1000)) {
            errors.push(`elements[${i}].bbox must be 4 integers 0-1000 [y_min,x_min,y_max,x_max]`);
          } else {
            const [yMin, xMin, yMax, xMax] = el.bbox;
            if (yMin > yMax || xMin > xMax) errors.push(`elements[${i}].bbox: expected y_min <= y_max and x_min <= x_max`);
            if (yMin === yMax || xMin === xMax) errors.push(`elements[${i}].bbox is zero-area`);
          }
        }
        for (const key of ['color_palette']) {
          if (el[key] !== undefined) {
            if (!Array.isArray(el[key]) || el[key].length === 0 || el[key].length > 5 || el[key].some((c) => typeof c !== 'string' || !HEX_RE.test(c))) {
              errors.push(`elements[${i}].${key} must be 1-5 uppercase #RRGGBB`);
            }
          }
        }
        const order = el.type === 'text' ? KEY_ORDER.elementText : KEY_ORDER.elementObj;
        checkKeyOrder(el, order, `elements[${i}]`, errors);
      });
    }
    checkKeyOrder(comp, KEY_ORDER.composition, 'compositional_deconstruction', errors);
  }
  const style = caption.style_description;
  if (typeof style === 'object' && style !== null && !Array.isArray(style)) {
    const isPhoto = String(style.medium || '').toLowerCase() === 'photograph';
    if (isPhoto) {
      for (const k of ['aesthetics', 'lighting', 'photo']) {
        if (typeof style[k] !== 'string' || style[k].trim().length === 0) errors.push(`style_description.${k} is empty`);
      }
      if (style.medium !== 'photograph') errors.push('style_description.medium must be "photograph" for photo variant');
      if ('art_style' in style) errors.push('style_description must not contain art_style for photo variant');
      checkKeyOrder(style, KEY_ORDER.stylePhoto, 'style_description', errors);
    } else {
      for (const k of ['aesthetics', 'lighting', 'medium', 'art_style']) {
        if (typeof style[k] !== 'string' || style[k].trim().length === 0) errors.push(`style_description.${k} is empty`);
      }
      if (String(style.medium || '').toLowerCase() === 'photograph') errors.push('style_description.medium must not be photograph for art variant');
      if ('photo' in style) errors.push('style_description must not contain photo for art variant');
      checkKeyOrder(style, KEY_ORDER.styleArt, 'style_description', errors);
    }
    if (style.color_palette !== undefined) {
      if (!Array.isArray(style.color_palette) || style.color_palette.length === 0 || style.color_palette.length > 16 ||
          style.color_palette.some((c) => typeof c !== 'string' || !HEX_RE.test(c))) {
        errors.push('style_description.color_palette must be 1-16 uppercase #RRGGBB');
      }
    }
  }
  checkKeyOrder(caption, KEY_ORDER.top, 'top level', errors);
  return { valid: errors.length === 0, errors };
}

module.exports = { validateCaption, KEY_ORDER };
