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
const { GENERATION_SCHEMA, TEXT_VERIFY_SCHEMA } = require('./captionSchema');
const { normalizeCaption, serializeCaption } = require('./captionNormalize');
const { validateCaption } = require('./captionValidate');
const { MODEL_FILE, MMPROJ_FILE } = require('./modelInfo');
const { resolveModelsDir } = require('./settings');
const {
  llamaHost, llamaPreferredPort, llamaPortScanMax, llamaCtxSize, llamaGpuLayers,
  llamaReadyTimeoutMs, llamaReadyPollMs, captionMaxAttempts,
  captionFirstTemp, captionRetryTemp, captionTopP, captionMaxTokens,
  verifyMaxTokens, verifyTemp, plainMaxTokens,
} = require('./config');

const MAX_ATTEMPTS = captionMaxAttempts;

let proc = null;
let llamaUrl = null;
let llamaPort = null;
let starting = null;

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
  starting = (async () => {
    const { modelFile, mmprojFile } = resolveModels();
    const bin = resolveLlamaServer();
    // Fixed preferred port, bump if busy
    let port = llamaPreferredPort;
    for (let i = 0; i < llamaPortScanMax; i++) {
      try {
        const test = await fetch(`http://127.0.0.1:${port}/health`).then(() => true).catch(() => false);
        if (!test) break;
        port++;
      } catch (_) { break; }
    }
    if (proc) { try { proc.kill(); } catch (_) {} proc = null; }
    proc = spawnLlama({ bin, port, model: modelFile, mmproj: mmprojFile });
    llamaUrl = `http://127.0.0.1:${port}`;
    llamaPort = port;
    console.log('[caption] starting llama-server on', llamaUrl);
    await waitForLlama(llamaUrl);
    console.log('[caption] llama-server ready');
    return { url: llamaUrl, port };
  })();
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

function stopServer() {
  if (starting) return;
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
  return ` The original image is ${w} wide × ${h} tall (${orient}, aspect ratio ${ratio.toFixed(2)}). The vision input is square, so compensate for that distortion: coordinates are 0–1000 relative to the ORIGINAL image — x=1000 is its right edge however narrow, y=1000 its bottom however tall.`;
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

function buildIdeogramMessages(imageBase64, instructions, lastErrors, dims) {
  const steering = (instructions || '').trim();
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
          ? `Write a long detailed description for this image.${aspectLine(dims)} You MUST obey these user instructions exactly: ${steering}${prefixRule} Respond with ONLY the Ideogram 4 JSON caption object for it — a single JSON object and nothing else.`
          : `Write a long detailed description for this image.${aspectLine(dims)} Respond with ONLY the Ideogram 4 JSON caption object for it — a single JSON object and nothing else.`) + errorSuffix
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

async function generateIdeogram(url, imageBase64, instructions, dims) {
  let lastErrors = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const messages = buildIdeogramMessages(imageBase64, instructions, lastErrors, dims);
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
    const verifyResult = await verifyTextElements(url, imageBase64, normalized.value);
    const recheck = validateCaption(normalized.value);
    if (!recheck.valid) {
      lastErrors = [...recheck.errors, 'create "text" elements ONLY for clearly legible on-image text; describe blurry/unreadable signs as "obj" elements instead'];
      continue;
    }
    return {
      ok: true, mode: 'ideogram',
      data: normalized.value,
      prompt_compact: serializeCaption(normalized.value),
      valid: true, attempts: attempt,
      steering_applied: steeringResult.applied || false,
      steering_used: ((instructions || '').trim().length > 0),
      text_verified: verifyResult.checked || false,
    };
  }
  return { ok: false, mode: 'ideogram', error: `Could not produce a valid caption after ${MAX_ATTEMPTS} attempts.`, errors: lastErrors };
}

async function generatePlain(url, imageBase64, instructions, dims) {
  const steering = (instructions || '').trim();
  const userText = steering
    ? `Write a single detailed plain-text caption paragraph for this image.${aspectLine(dims)} Obey these user instructions exactly: ${steering} Output ONLY the caption, nothing else.`
    : `Write a single detailed plain-text caption paragraph for this image.${aspectLine(dims)} Output ONLY the caption, nothing else.`;
  const messages = buildFreeMessages(PLAIN_SYSTEM_PROMPT, imageBase64, userText);
  try {
    const text = (await chatCompletion(url, { messages, temperature: captionFirstTemp, topP: captionTopP, maxTokens: plainMaxTokens })).trim();
    if (!text) return { ok: false, mode: 'plain', error: 'empty response from model' };
    return { ok: true, mode: 'plain', text, steering_used: (steering.length > 0) };
  } catch (err) {
    return { ok: false, mode: 'plain', error: String(err?.message || err) };
  }
}

async function generate(imageBase64, { mode, instructions, dims }) {
  const { url } = await ensureServer();
  if (mode === 'plain') return generatePlain(url, imageBase64, instructions, dims);
  return generateIdeogram(url, imageBase64, instructions, dims);
}

module.exports = { ensureServer, stopServer, status, generate, MODEL_FILE, MMPROJ_FILE, extractHldPrefix };
