// Caption data helpers (renderer-side, framework-free).
export const HEX_RE = /^#[0-9A-F]{6}$/;

export function normHex(c) {
  const v = String(c || '').trim().toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(v)) return '#' + [...v.slice(1)].map((x) => x + x).join('');
  return HEX_RE.test(v) ? v : null;
}

export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function emptyIdeogram() {
  return {
    high_level_description: '',
    style_description: { aesthetics: '', lighting: '', medium: 'photograph', photo: '' },
    compositional_deconstruction: { background: '', elements: [] },
  };
}

export function elementPreview(el) {
  if (el.desc) return el.desc.slice(0, 40) + (el.desc.length > 40 ? '…' : '');
  if (el.type === 'text' && el.text) return `"${el.text}"`;
  return el.type === 'obj' ? 'Object' : 'Text element';
}
