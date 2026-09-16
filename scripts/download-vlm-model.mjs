// Downloads the Qwen3-VL caption model (GGUF + mmproj) into models/.
// Huihui Qwen3-VL-8B-Instruct (abliterated) GGUF + matching mmproj.
// mmproj is vision-tower-specific: do NOT mix it with another model's mmproj.
// Quality ladder in the same repo: Q4_K_M (default, ~5GB) < Q5_K_M < Q6_K < Q8_0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.join(__dirname, '..', 'models');

const MODEL_FILE = 'Huihui-Qwen3-VL-8B-Instruct-abliterated-Q4_K_M.gguf';
const MMPROJ_FILE = 'mmproj-F16.gguf';
// Stale files from the previous JoyCaption model — keeping them wastes ~6GB
// and risks the server pairing the wrong mmproj, so remove them on switch.
const STALE_FILES = [
  'Llama-Joycaption-Beta-One-Hf-Llava-Q4_K.gguf',
  'llama-joycaption-beta-one-llava-mmproj-model-f16.gguf',
];
const REPO = 'noctrex/Huihui-Qwen3-VL-8B-Instruct-abliterated-GGUF';

if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });
for (const stale of STALE_FILES) {
  const p = path.join(modelsDir, stale);
  if (fs.existsSync(p)) {
    fs.rmSync(p);
    console.log('removed stale model file:', stale);
  }
}
const { downloadFile } = await import('@huggingface/hub');

function gb(n) {
  return (n / 1024 ** 3).toFixed(2) + ' GB';
}

// Byte-counting transform that prints a live progress line.
function progressTap(total, label) {
  let received = 0;
  const start = Date.now();
  let lastPrint = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      const now = Date.now();
      if (now - lastPrint > 500 || received >= total) {
        lastPrint = now;
        const secs = Math.max(1, (now - start) / 1000);
        const pct = total > 0 ? ((received / total) * 100).toFixed(1) + '%' : '';
        const speed = (received / 1024 ** 2 / secs).toFixed(1) + ' MB/s';
        process.stdout.write(`\r  ${label}: ${gb(received)} / ${gb(total)} ${pct} (${speed})   `);
      }
      cb(null, chunk);
    },
  });
}

async function fetchFile(name, dest) {
  const tmp = dest + '.part';
  const blob = await downloadFile({ repo: { type: 'model', name: REPO }, path: name });
  if (!blob) throw new Error('file not found in repo ' + REPO + ': ' + name);
  const total = blob.size || 0;
  // Skip only if the existing file is complete; a partial file from an
  // interrupted run must be re-downloaded, never mistaken for done.
  if (fs.existsSync(dest) && total > 0 && fs.statSync(dest).size === total) {
    console.log('already present:', name, `(${gb(total)})`);
    return;
  }
  if (fs.existsSync(dest)) console.log('incomplete file found, (re)downloading', name, '...');
  else console.log('downloading', name, `(${gb(total)}) ...`);
  await pipeline(Readable.fromWeb(blob.stream()), progressTap(total, name), fs.createWriteStream(tmp));
  process.stdout.write('\n');
  fs.renameSync(tmp, dest);
  console.log('saved', dest, `(${gb(fs.statSync(dest).size)})`);
}
await fetchFile(MODEL_FILE, path.join(modelsDir, MODEL_FILE));
await fetchFile(MMPROJ_FILE, path.join(modelsDir, MMPROJ_FILE));
console.log('VLM model download complete');
