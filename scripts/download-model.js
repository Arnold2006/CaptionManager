const fs = require('fs');
const path = require('path');
const https = require('https');

const MODEL_DIR = path.join(__dirname, '..', 'models', 'esrgan-slim');
const MODEL_URL = 'https://unpkg.com/upscaler@1.0.0/dist/models/esrgan-slim/model.json';
// For ONNX fallback, also try a small ONNX model
const ONNX_URL = 'https://huggingface.co/captain-pool/esrgan-tf2/resolve/main/esrgan-tf2.onnx';
const ONNX_DEST = path.join(__dirname, '..', 'models', 'esrgan-slim.onnx');

async function download(url, dest, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) {
      console.log(`Already exists: ${dest}`);
      return resolve();
    }
    console.log(`Downloading ${url} -> ${dest}`);
    const file = fs.createWriteStream(dest);
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      console.warn(`Download timeout ${url}`);
      try { file.close(); } catch {}
      try { fs.unlinkSync(dest); } catch {}
      resolve();
    }, timeoutMs);
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        if (done) return;
        done = true;
        console.warn(`Download failed ${url}: ${res.statusCode}`);
        try { file.close(); fs.unlinkSync(dest); } catch {}
        return resolve();
      }
      res.pipe(file);
      file.on('finish', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        file.close(() => resolve());
      });
    });
    req.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      console.warn(`Download error: ${e.message}`);
      try { file.close(); } catch {}
      try { fs.unlinkSync(dest); } catch {}
      resolve();
    });
    req.setTimeout(timeoutMs, () => {
      if (done) return;
      done = true;
      console.warn(`Request timeout ${url}`);
      req.destroy();
      try { file.close(); } catch {}
      try { fs.unlinkSync(dest); } catch {}
      resolve();
    });
  });
}

(async () => {
  try {
    // Try to download TFJS model manifest (won't fail build if offline)
    await download(MODEL_URL, path.join(MODEL_DIR, 'model.json'));
    // Try ONNX model (optional)
    // await download(ONNX_URL, ONNX_DEST);
    // Create placeholder if still missing to ensure portable includes something
    if (!fs.existsSync(path.join(MODEL_DIR, 'model.json'))) {
      fs.mkdirSync(MODEL_DIR, { recursive: true });
      fs.writeFileSync(path.join(MODEL_DIR, 'README.txt'), 'ESRGAN slim model placeholder. Run npm run download-model with network to fetch real weights. App will fallback to sharp lanczos 2x if model missing.');
      console.log('Created placeholder model README');
    }
    if (!fs.existsSync(ONNX_DEST)) {
      fs.writeFileSync(path.join(path.dirname(ONNX_DEST), 'README.txt'), 'ONNX placeholder. App uses sharp fallback if missing.', { flag: 'a' });
    }
    console.log('Model setup complete');
  } catch (e) {
    console.warn('Model download script warning', e.message);
  }
})();
