// First-launch model downloader (CommonJS, Electron main).
// Fetches the Qwen3-VL GGUF + mmproj from HuggingFace into the effective
// models dir (Settings choice or userData/models). Reports progress via
// onProgress({ file, received, total, done, skipped }).
const fs = require('fs');
const path = require('path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { MODEL_FILE, MODEL_SIZE, MMPROJ_FILE, MMPROJ_SIZE, REPO } = require('./modelInfo');

function gb(n) {
  return ((n || 0) / 1024 ** 3).toFixed(2) + ' GB';
}

async function downloadModels(dir, onProgress) {
  const { downloadFile } = await import('@huggingface/hub');
  fs.mkdirSync(dir, { recursive: true });
  const files = [
    [MODEL_FILE, MODEL_SIZE],
    [MMPROJ_FILE, MMPROJ_SIZE],
  ];
  for (const [name, expectedTotal] of files) {
    const dest = path.join(dir, name);
    const report = (received, total, extra) => {
      if (onProgress) {
        try { onProgress({ file: name, received, total, ...extra }); } catch (_) {}
      }
    };
    let existing = 0;
    try { existing = fs.statSync(dest).size; } catch (_) {}
    if (existing === expectedTotal && expectedTotal > 0) {
      console.log('[models] already present:', name);
      report(existing, expectedTotal, { done: true, skipped: true });
      continue;
    }
    console.log('[models] downloading', name, '->', dest);
    const blob = await downloadFile({ repo: { type: 'model', name: REPO }, path: name });
    if (!blob) throw new Error('file not found in repo ' + REPO + ': ' + name);
    const total = blob.size || expectedTotal;
    const tmp = dest + '.part';
    let received = 0;
    let lastReport = 0;
    const tap = new Transform({
      transform(chunk, _enc, cb) {
        received += chunk.length;
        const now = Date.now();
        if (now - lastReport > 500 || received >= total) {
          lastReport = now;
          report(received, total, {});
        }
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(blob.stream()), tap, fs.createWriteStream(tmp));
    report(total, total, { done: true });
    fs.renameSync(tmp, dest);
    console.log('[models] saved', dest, `(${gb(fs.statSync(dest).size)})`);
  }
  return { dir };
}

module.exports = { downloadModels };
