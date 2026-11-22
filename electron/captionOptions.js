// Optional caption prompt extras: checked detail categories and the trigger
// word. The catalogue JSON is also imported by the renderer so labels and
// prompt clauses stay in one place.
const CATALOG = require('./captionOptions.json');

const BY_ID = Object.fromEntries(CATALOG.map((o) => [o.id, o]));

// Strip quotes and trailing separators people paste along with a trigger word.
function cleanTriggerWord(value) {
  return String(value ?? '')
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/[,\s]+$/g, '');
}

// Keep only known ids, in catalogue order, so the prompt is deterministic.
function normalizeOptionIds(ids) {
  if (!Array.isArray(ids)) return [];
  const wanted = new Set(ids);
  return CATALOG.filter((o) => wanted.has(o.id)).map((o) => o.id);
}

// Returns the instruction block appended to the caption prompt, or '' when no
// detail is selected.
function buildExtrasInstruction(ids) {
  const list = normalizeOptionIds(ids);
  if (list.length === 0) return '';
  const lines = list.map((id) => '- ' + BY_ID[id].clause);
  return 'CAPTION DETAILS — the caption MUST explicitly cover every item below:\n' +
    lines.join('\n') +
    '\nWrite them as natural prose woven into the caption, never as a list of labels.';
}

function startsWithWord(text, word) {
  const t = String(text || '').trimStart();
  if (t.length < word.length) return false;
  if (t.slice(0, word.length).toLowerCase() !== word.toLowerCase()) return false;
  const after = t.charAt(word.length);
  return after === '' || /[\s,.:;!?—–-]/.test(after);
}

function prependOnce(text, word) {
  const body = String(text || '').trim();
  if (!body) return word;
  return startsWithWord(body, word) ? body : `${word} ${body}`;
}

// Prefix the Ideogram high_level_description with the trigger word exactly
// once. Returns a new caption object so the canonical key order stays intact
// even when high_level_description was absent.
function applyTriggerWord(caption, triggerWord) {
  const word = cleanTriggerWord(triggerWord);
  if (!word || !caption || typeof caption !== 'object') {
    return { caption, applied: false, used: false, word };
  }
  const hld = typeof caption.high_level_description === 'string' ? caption.high_level_description : '';
  const background = caption.compositional_deconstruction?.background;
  const base = hld.trim() || (typeof background === 'string' ? background.trim() : '');
  if (!base) return { caption, applied: false, used: false, word };

  const next = prependOnce(base, word);
  const out = { high_level_description: next };
  for (const key of Object.keys(caption)) {
    if (key !== 'high_level_description') out[key] = caption[key];
  }
  return { caption: out, applied: next !== hld, used: true, word };
}

// Prefix a plain-text caption with the trigger word, comma-separated.
function applyPlainTrigger(text, triggerWord) {
  const word = cleanTriggerWord(triggerWord);
  const body = String(text ?? '').trim();
  if (!word || !body) return { text: String(text ?? ''), applied: false, used: false, word };
  if (startsWithWord(body, word)) return { text: body, applied: false, used: true, word };
  return { text: `${word}, ${body}`, applied: true, used: true, word };
}

module.exports = {
  CATALOG,
  buildExtrasInstruction,
  normalizeOptionIds,
  cleanTriggerWord,
  applyTriggerWord,
  applyPlainTrigger,
};
