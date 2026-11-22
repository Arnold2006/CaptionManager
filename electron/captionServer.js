// llama.cpp caption engine (CommonJS, Electron main process).
// Manages a persistent llama-server daemon running the Qwen3-VL GGUF + mmproj,
// and generates Ideogram 4 / plain-text captions from images.
// Models are resolved from the Settings folder choice, a bundled models dir,
// or the userData models dir (downloaded at first launch) — GGUFs are NOT
// shipped inside the portable exe.
const fs = require('fs');
const path = require('path');
const { spawn } = require('node:child_process');
const { IDEOGRAM_SYSTEM_PROMPT, PLAIN_SYSTEM_PROMPT } = require('./captionPrompts');
const { GENERATION_SCHEMA, TEXT_VERIFY_SCHEMA, GROUNDING_SCHEMA } = require('./captionSchema');
const { applyGrounding } = require('./bbox');
const { normalizeCaption, serializeCaption } = require('./captionNormalize');
const { validateCaption } = require('./captionValidate');
const { buildExtrasInstruction, applyTriggerWord, applyPlainTrigger } = require('./captionOptions');
const { debugLog } = require('./log');
const { MODEL_FILE, MMPROJ_FILE } = require('./modelInfo');
const { resolveModelsDir } = require('./settings');
const {
  llamaHost, llamaPreferredPort, llamaPortScanMax, llamaCtxSize, llamaGpuLayers,
  llamaReadyTimeoutMs, llamaReadyPollMs, captionMaxAttempts,
  captionFirstTemp, captionRetryTemp, captionTopP, captionMaxTokens,
  verifyMaxTokens, verifyTemp, plainMaxTokens,
  captionGroundPass, groundMaxTokens, groundTemp, groundMaxDescChars,
} = require('./config');

const MAX_ATTEMPTS = captionMaxAttempts;

let proc = null;
let llamaUrl = null;
let llamaPort = null;
let starting = null;
let stopRequested = false;

// Bump past ports that already answer /health.
async function findFreePort(port) {
  for (let i = 0; i < llamaPortScanMax; i++) {
    let busy = false;
    try {
      const r = await fetch(`http://${llamaHost}:${port}/health`);
      busy = r.ok;
    } catch (_) { busy = false; }
    if (!busy) return port;
    port++;
  }
  return port;
}

// Confirm the ready server is ours (not a foreign /health on the same port).
async function servedModelMatches(url, modelFile) {
  try {
    const r = await fetch(url + '/v1/models');
    if (!r.ok) return false;
    return (await r.text()).includes(path.basename(modelFile));
  } catch (_) {
    return false;
  }
}

function appRoot() {
  // electron/captionServer.js -> repo root (dev) or app root (packaged)
  return path.join(__dirname, '..');
}

function resolveModels() {
  const { dir: modelsDir } = resolveModelsDir();
  let files = [];
  try { files = fs.readdirSync(modelsDir); } catch (_) {}
  const missing = [MODEL_FILE, MMPROJ_FILE].filter((f) => !files.includes(f));
  if (missing.length) {
    throw new Error(`Caption model missing in ${modelsDir}: ${missing.join(', ')}. Open Settings (⚙) to pick a models folder or download them.`);
  }
  return { modelFile: path.join(modelsDir, MODEL_FILE), mmprojFile: path.join(modelsDir, MMPROJ_FILE), modelsDir };
}

function resolveLlamaServer() {
  const candidates = [
    path.join(appRoot(), 'bin', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'),
    path.join(appRoot(), 'app', 'bin', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('llama-server binary not found. Open Settings (⚙) to download it.');
}

async function waitForLlama(baseUrl, timeoutMs = llamaReadyTimeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(baseUrl + '/health');
      if (r.ok) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, llamaReadyPollMs));
  }
  throw new Error('llama-server did not become ready in time');
}

function spawnLlama({ bin, port, model, mmproj }) {
  const args = [
    '--model', model,
    '--ctx-size', String(llamaCtxSize),
    '--port', String(port),
    '--host', llamaHost,
    '--no-webui',
    '--jinja',
    '--n-gpu-layers', String(llamaGpuLayers),
    '--parallel', '1',
    '--log-disable',
  ];
  if (mmproj) args.push('--mmproj', mmproj);
  const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  p.stderr.on('data', (d) => { const s = d.toString().trim(); if (s) console.error('[llama]', s.slice(0, 500)); });
  p.on('error', (e) => console.error('[caption] llama-server spawn error:', e.message));
  return p;
}

async function ensureServer() {
  if (llamaUrl && proc && proc.exitCode === null) return { url: llamaUrl, port: llamaPort };
  if (starting) return starting;
  stopRequested = false;
  starting = (async () => {
    const { modelFile, mmprojFile } = resolveModels();
    const bin = resolveLlamaServer();
    let port = llamaPreferredPort;
    // Try a few ports: skip ports already answering /health AND verify the
    // ready server is actually ours (a foreign /health must not hijack us).
    for (let attempt = 0; attempt < 3; attempt++) {
      port = await findFreePort(port);
      if (proc) { try { proc.kill(); } catch (_) {} proc = null; }
      proc = spawnLlama({ bin, port, model: modelFile, mmproj: mmprojFile });
      llamaUrl = `http://${llamaHost}:${port}`;
      llamaPort = port;
      console.log('[caption] starting llama-server on', llamaUrl);
      try {
        await waitForLlama(llamaUrl);
      } catch (e) {
        try { proc.kill(); } catch (_) {}
        proc = null; llamaUrl = null;
        throw e;
      }
      if (stopRequested) {
        try { proc.kill(); } catch (_) {}
        proc = null; llamaUrl = null;
        throw new Error('caption server stopped');
      }
      if (await servedModelMatches(llamaUrl, modelFile)) {
        console.log('[caption] llama-server ready');
        return { url: llamaUrl, port };
      }
      console.warn('[caption] port', port, 'is served by a foreign process, trying next port');
      try { proc.kill(); } catch (_) {}
      proc = null; llamaUrl = null;
      port++;
    }
    throw new Error('could not start llama-server on a free port');
  })();
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

function stopServer() {
  stopRequested = true;
  if (starting) return; // in-flight start observes the flag and tears down
  if (proc) { try { proc.kill(); } catch (_) {} proc = null; llamaUrl = null; }
}

function status() {
  let modelPresent = false, mmprojPresent = false, binPresent = false;
  try { resolveModels(); modelPresent = true; mmprojPresent = true; } catch (_) {}
  try { resolveLlamaServer(); binPresent = true; } catch (_) {}
  return {
    running: !!(proc && proc.exitCode === null && llamaUrl),
    url: llamaUrl, port: llamaPort,
    modelPresent, mmprojPresent, binPresent,
    modelFile: MODEL_FILE, mmprojFile: MMPROJ_FILE,
  };
}

// ---- message builders ----
function aspectLine(dims) {
  const w = Number(dims?.width), h = Number(dims?.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '';
  const ratio = w / h;
  const orient = ratio > 1.05 ? 'landscape' : ratio < 0.95 ? 'portrait' : 'square';
  // A square region spans the same pixels on both axes, so on this frame its
  // x-span (0-1000 units) is y-span × h/w. Spell the number out: asking a small
  // model to apply a formula mid-JSON does not work.
  const squareX = Math.round((1000 * h) / w);
  return ` The image is ${w} pixels wide × ${h} pixels tall (${orient}, aspect ratio ${ratio.toFixed(2)}). Bounding-box coordinates are normalized to this frame, 0–1000 on EACH axis independently (the frame is not a 1000×1000 square when the picture is not square): x=0 is the left edge and x=1000 the right edge, y=0 is the top edge and y=1000 the bottom edge. On this picture a region that looks square spans about ${squareX} x-units for every 1000 y-units.`;
}

// Ideogram mode renders a labeled 0-1000 grid on the vision input; tell the
// model to read box edges off it rather than recall coordinates.
function gridLine() {
  return ' The picture has a labeled coordinate grid on it: cyan lines every 100 units with the values printed along the top edge (x) and the left edge (y). Read every bbox edge off that grid; do not estimate coordinates and do not describe or transcribe the grid itself.';
}

function extractHldPrefix(instructions) {
  const s = (instructions || '').trim();
  if (!s) return null;
  const patterns = [
    /add\s+the\s+word\s+["'“”]([^"'“”]+)["'“”]\s+as\s+(?:a\s+)?prefix\s+(?:to\s+)?high_level_description/i,
    /prefix\s+high_level_description\s+with\s+(?:the\s+word\s+)?["'“”]([^"'“”]+)["'“”]/i,
    /prefix\s+["'“”]([^"'“”]+)["'“”]\s+to\s+high_level_description/i,
    // Unquoted / looser phrasings: prefix high_level_description with X
    /prefix\s+high_level_description\s+with\s+([^\s"'“”,;]+)/i,
    // high_level_description (must) start(s) with ["X" | X]
    /high_level_description\s+(?:must\s+)?starts?\s+with\s+["'“”]?([^"'“”\s,;]+)["'“”]?/i,
    // start high_level_description with ["X" | X]
    /starts?\s+high_level_description\s+with\s+["'“”]?([^"'“”\s,;]+)["'“”]?/i,
    // add "X" as (a) prefix [to high_level_description] — applies to HLD
    /add\s+["'“”]?([^"'“”\s,;]+)["'“”]?\s+as\s+(?:a\s+)?prefix(?:\s+to\s+high_level_description)?/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m && m[1].trim()) {
      let v = m[1].trim();
      // Trailing . ! ? is part of the prefix only at end of instructions;
      // mid-text it is sentence punctuation ("...with Sarah. Describe...").
      const rest = s.slice(m.index + m[0].length).trim();
      if (rest) v = v.replace(/[.!?]+$/, '');
      if (v) return v;
    }
  }
  return null;
}

function stripEdgePunct(s) {
  return String(s || '').toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

function applySteeringPostProcess(caption, instructions) {
  const prefix = extractHldPrefix(instructions);
  if (!prefix) return { applied: false };
  const want = /\s$/.test(prefix) ? prefix : prefix + ' ';
  const core = stripEdgePunct(prefix.trim());
  const cur = caption.high_level_description || '';
  const trimmed = cur.trimStart();
  if (core) {
    const firstTok = trimmed.split(/\s+/, 1)[0] || '';
    if (stripEdgePunct(firstTok) === core) {
      let rest = trimmed.slice(firstTok.length).trimStart();
      for (;;) {
        const t = rest.split(/\s+/, 1)[0] || '';
        if (!t || stripEdgePunct(t) !== core) break;
        rest = rest.slice(t.length).trimStart();
      }
      const next = want + rest;
      if (next !== cur) { caption.high_level_description = next; return { applied: true, prefix, reason: 'normalized' }; }
      return { applied: false, prefix, reason: 'already present' };
    }
  }
  caption.high_level_description = want + trimmed;
  return { applied: true, prefix };
}

function buildIdeogramMessages(imageBase64, instructions, lastErrors, dims, promptOptions, triggerWord) {
  const steering = (instructions || '').trim();
  const extras = buildExtrasInstruction(promptOptions, triggerWord);
  const sysPrompt = steering
    ? IDEOGRAM_SYSTEM_PROMPT + '\n\nCRITICAL — User steering instructions (MUST follow exactly, takes precedence over defaults; applies to ALL fields, not just style):\n' + steering
    : IDEOGRAM_SYSTEM_PROMPT;
  const styleNote = '\n\nYou MUST always include the "style_description" object with ALL fields, in order: aesthetics, lighting, medium, photo, art_style, color_palette. Give every field a rich, specific value — never an empty string. "medium" is "photograph" for photos, otherwise the broad type (illustration, painting, 3d_render, …). Fill in BOTH "photo" (camera/lens details) and "art_style" (technique, texture); the pipeline keeps the one matching "medium".';
  const messages = [{ role: 'system', content: sysPrompt + styleNote }];
  const errorSuffix = lastErrors.length > 0
    ? '\n\n(Your previous answer had these problems, fix them: ' + lastErrors.join('; ') + ')'
    : '';
  const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');
  const forcedPrefix = extractHldPrefix(steering);
  const exactPrefix = forcedPrefix ? (/\s$/.test(forcedPrefix) ? forcedPrefix : forcedPrefix + ' ') : null;
  const prefixRule = exactPrefix
    ? ` The "high_level_description" MUST start with exactly "${exactPrefix}" (these exact characters, including punctuation). Do not use a colon or any other variation, and do not repeat the prefix.`
    : '';
  messages.push({
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Data}` } },
      {
        type: 'text',
        text: (steering
          ? `Write a long detailed description for this image.${aspectLine(dims)}${gridLine()} You MUST obey these user instructions exactly: ${steering}${prefixRule}${extras ? ' ' + extras : ''} Respond with ONLY the Ideogram 4 JSON caption object for it — a single JSON object and nothing else.`
          : `Write a long detailed description for this image.${aspectLine(dims)}${gridLine()}${extras ? ' ' + extras : ''} Respond with ONLY the Ideogram 4 JSON caption object for it — a single JSON object and nothing else.`) + errorSuffix
      }
    ]
  });
  return messages;
}

function buildFreeMessages(systemPrompt, imageBase64, userText) {
  const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');
  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Data}` } },
        { type: 'text', text: userText }
      ]
    }
  ];
}

async function chatCompletion(url, { messages, temperature, topP, maxTokens, jsonSchema }) {
  const body = { model: 'local', messages, temperature, top_p: topP, max_tokens: maxTokens, stream: false };
  if (jsonSchema) {
    body.response_format = { type: 'json_schema', json_schema: { name: jsonSchema.name, schema: jsonSchema.schema, strict: true } };
  }
  const res = await fetch(url + '/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`llama-server error ${res.status}: ${err.slice(0, 400)}`);
  }
  const j = await res.json();
  return j.choices?.[0]?.message?.content || '';
}

// ---- text-element verification (second read) ----
function normTranscribed(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function isTextConfirmed(elemText, transcribed) {
  const e = normTranscribed(elemText);
  if (!e) return false;
  return transcribed.some((t) => {
    const n = normTranscribed(t);
    if (!n) return false;
    if (n === e) return true;
    if (Math.min(n.length, e.length) >= 3 && (n.includes(e) || e.includes(n))) return true;
    return false;
  });
}
async function verifyTextElements(url, imageBase64, caption) {
  const elements = caption?.compositional_deconstruction?.elements || [];
  if (!elements.some((el) => el.type === 'text' && el.text)) return { checked: false };
  const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');
  const messages = [
    { role: 'system', content: 'You transcribe text visible in images. Reply with ONLY JSON, nothing else.' },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Data}` } },
        { type: 'text', text: 'Transcribe every piece of clearly legible text visible in this image, each as a separate string. If no legible text is visible, return an empty array. Reply with ONLY JSON of the form {"texts": [...]}, nothing else.' },
      ],
    },
  ];
  let raw = null;
  try {
    const content = await chatCompletion(url, { messages, temperature: verifyTemp, topP: captionTopP, maxTokens: verifyMaxTokens, jsonSchema: { name: 'text_transcription', schema: TEXT_VERIFY_SCHEMA } });
    try { raw = JSON.parse(content); }
    catch {
      const s = content.indexOf('{'), e = content.lastIndexOf('}');
      if (s >= 0 && e > s) raw = JSON.parse(content.slice(s, e + 1));
    }
  } catch (err) {
    console.log('[caption] text verification skipped:', String(err?.message || err).slice(0, 200));
    return { checked: false };
  }
  const transcribed = raw && Array.isArray(raw.texts) ? raw.texts.filter((t) => typeof t === 'string') : null;
  if (!transcribed) return { checked: false };
  const before = elements.length;
  caption.compositional_deconstruction.elements = elements.filter((el) => {
    if (el.type !== 'text' || !el.text) return true;
    const ok = isTextConfirmed(el.text, transcribed);
    if (!ok) console.log('[caption] dropping unconfirmed text element:', JSON.stringify(el.text));
    return ok;
  });
  return { checked: true, dropped: before - caption.compositional_deconstruction.elements.length };
}

// ---- bounding-box grounding pass ----
// The caption pass writes boxes inline in a large JSON object, which the small
// local model does poorly: it guesses round numbers and loses track of which
// axis is which. This pass asks for the boxes on their own, in the vision
// model's native grounding format ("bbox_2d": [x1, y1, x2, y2], 0-1000 per
// axis, origin top-left), and bbox.js transposes them to Ideogram's
// [y_min, x_min, y_max, x_max]. Best-effort: any failure keeps the caption's
// own boxes.
function shortenText(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function orientationOf(w, h) {
  const ratio = w / h;
  return ratio > 1.05 ? 'landscape' : ratio < 0.95 ? 'portrait' : 'square';
}

function buildGroundingMessages(imageBase64, elements, dims) {
  const w = Number(dims?.width), h = Number(dims?.height);
  const measured = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
  const frame = measured
    ? `The image is ${w} pixels wide and ${h} pixels tall (${orientationOf(w, h)}, aspect ratio ${(w / h).toFixed(2)}). Both axes are normalized to 0-1000 separately, so the frame is not square on this picture: a region that looks square spans about ${Math.round((1000 * h) / w)} units on the x axis for every 1000 units on the y axis.`
    : '';
  const list = elements
    .map((el, i) => {
      const text = el.type === 'text' && el.text ? ` (rendered text: "${shortenText(el.text, 60)}")` : '';
      return `${i + 1}. ${shortenText(el.desc, groundMaxDescChars)}${text}`;
    })
    .join('\n');
  const text = [
    'Locate each numbered object in this image and give it ONE tight bounding box that encloses only that object — its outer visible edges, no padding, no room for the neighbours.',
    frame,
    'Normalized coordinates, 0-1000 on each axis independently, origin at the TOP-LEFT: x=0 is the left edge and x=1000 the right edge; y=0 is the TOP edge and y=1000 the BOTTOM edge, so y grows DOWNWARD (an object low in the picture has large y values).',
    'Order the four numbers as [x_min, y_min, x_max, y_max] with x_min < x_max and y_min < y_max. Read every edge off the labeled grid drawn on the picture; never describe or transcribe the grid itself.',
    'Objects:',
    list,
    'Return exactly one box per object, keyed by its number. Reply with ONLY JSON: {"boxes":[{"index":1,"bbox":[x_min,y_min,x_max,y_max]}]}'
  ].filter(Boolean).join('\n');
  const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');
  return [
    { role: 'system', content: 'You are an object-location model. You reply with JSON only.' },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Data}` } },
        { type: 'text', text }
      ]
    }
  ];
}

async function groundElementBoxes(url, imageBase64, caption, dims) {
  const elements = caption?.compositional_deconstruction?.elements || [];
  if (!captionGroundPass || elements.length === 0) return { applied: 0 };
  let content;
  try {
    content = await chatCompletion(url, {
      messages: buildGroundingMessages(imageBase64, elements, dims),
      temperature: groundTemp, topP: captionTopP, maxTokens: groundMaxTokens,
      jsonSchema: { name: 'element_boxes', schema: GROUNDING_SCHEMA }
    });
  } catch (err) {
    console.log('[caption] grounding pass skipped:', String(err?.message || err).slice(0, 200));
    return { applied: 0 };
  }
  const parsed = parseJsonLoose(content);
  if (!parsed.ok || !Array.isArray(parsed.value?.boxes)) return { applied: 0 };
  const result = applyGrounding(elements, parsed.value.boxes);
  if (result.applied > 0) caption.compositional_deconstruction.elements = result.elements;
  return result;
}

// ---- generators ----
function parseJsonLoose(text) {
  try { return { ok: true, value: JSON.parse(text) }; } catch (_) {}
  const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return { ok: true, value: JSON.parse(cleaned) }; } catch (_) {}
  const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try { return { ok: true, value: JSON.parse(cleaned.slice(s, e + 1)) }; } catch (_) {}
  }
  return { ok: false };
}

async function generateIdeogram(url, imageBase64, instructions, dims, promptOptions, triggerWord, verifyImageBase64) {
  debugLog('caption prompt extras (ideogram):', buildExtrasInstruction(promptOptions, triggerWord) || '(none)');
  let lastErrors = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const messages = buildIdeogramMessages(imageBase64, instructions, lastErrors, dims, promptOptions, triggerWord);
    let text;
    try {
      text = await chatCompletion(url, {
        messages, temperature: attempt === 1 ? captionFirstTemp : captionRetryTemp, topP: captionTopP, maxTokens: captionMaxTokens,
        jsonSchema: { name: 'ideogram_prompt', schema: GENERATION_SCHEMA }
      });
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
    const parsed = parseJsonLoose(text);
    if (!parsed.ok) { lastErrors = ['output was not parseable JSON']; continue; }
    const normalized = normalizeCaption(parsed.value);
    if (!normalized.ok) { lastErrors = [normalized.reason]; continue; }
    const { valid, errors } = validateCaption(normalized.value);
    if (!valid) { lastErrors = errors; continue; }
    const steeringResult = applySteeringPostProcess(normalized.value, instructions);
    const triggerResult = applyTriggerWord(normalized.value, triggerWord);
    normalized.value = triggerResult.caption;
    // Verify against the grid-free copy so grid numbers can never be confirmed
    // as if they were text rendered in the picture.
    const verifyResult = await verifyTextElements(url, verifyImageBase64 || imageBase64, normalized.value);
    const recheck = validateCaption(normalized.value);
    if (!recheck.valid) {
      lastErrors = [...recheck.errors, 'create "text" elements ONLY for clearly legible on-image text; describe blurry/unreadable signs as "obj" elements instead'];
      continue;
    }
    // Re-measure the boxes on their own, in the model's native grounding
    // format, against the gridded image. Runs after the text pass so the
    // 1-based indices match the elements that actually survived it.
    const grounded = await groundElementBoxes(url, imageBase64, normalized.value, dims);
    return {
      ok: true, mode: 'ideogram',
      data: normalized.value,
      prompt_compact: serializeCaption(normalized.value),
      valid: true, attempts: attempt,
      steering_applied: steeringResult.applied || false,
      steering_used: ((instructions || '').trim().length > 0),
      trigger_used: triggerResult.used || false,
      trigger_applied: triggerResult.applied || false,
      text_verified: verifyResult.checked || false,
      boxes_grounded: grounded.applied || 0,
      boxes_total: normalized.value.compositional_deconstruction.elements.length,
    };
  }
  return { ok: false, mode: 'ideogram', error: `Could not produce a valid caption after ${MAX_ATTEMPTS} attempts.`, errors: lastErrors };
}

async function generatePlain(url, imageBase64, instructions, dims, promptOptions, triggerWord) {
  const steering = (instructions || '').trim();
  const extras = buildExtrasInstruction(promptOptions, triggerWord);
  debugLog('caption prompt extras (plain):', extras || '(none)');
  const base = steering
    ? `Write a single detailed plain-text caption paragraph for this image.${aspectLine(dims)} Obey these user instructions exactly: ${steering}`
    : `Write a single detailed plain-text caption paragraph for this image.${aspectLine(dims)}`;
  const userText = base + (extras ? ` ${extras}` : '') + ' Output ONLY the caption, nothing else.';
  const messages = buildFreeMessages(PLAIN_SYSTEM_PROMPT, imageBase64, userText);
  try {
    const raw = (await chatCompletion(url, { messages, temperature: captionFirstTemp, topP: captionTopP, maxTokens: plainMaxTokens })).trim();
    if (!raw) return { ok: false, mode: 'plain', error: 'empty response from model' };
    const triggered = applyPlainTrigger(raw, triggerWord);
    return {
      ok: true, mode: 'plain', text: triggered.text,
      steering_used: (steering.length > 0),
      trigger_used: triggered.used || false,
      trigger_applied: triggered.applied || false,
    };
  } catch (err) {
    return { ok: false, mode: 'plain', error: String(err?.message || err) };
  }
}

async function generate(imageBase64, { mode, instructions, dims, promptOptions, triggerWord, verifyImageBase64 }) {
  const { url } = await ensureServer();
  if (mode === 'plain') return generatePlain(url, imageBase64, instructions, dims, promptOptions, triggerWord);
  return generateIdeogram(url, imageBase64, instructions, dims, promptOptions, triggerWord, verifyImageBase64);
}

module.exports = { ensureServer, stopServer, status, generate, buildIdeogramMessages, MODEL_FILE, MMPROJ_FILE, extractHldPrefix, findFreePort, servedModelMatches };
