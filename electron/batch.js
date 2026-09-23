// Batch crop/upscale/convert pipeline (Electron main).
// Output: <source>/CaptionManager_output_<timestamp>/ + progress events.
const fsp = require('fs/promises');
const path = require('path');
const { normalizeAngle, cropParams, loadOriented } = require('./images');

let sharp;
try { sharp = require('sharp'); } catch (e) { console.warn('sharp not available', e && e.message); }

const FORMAT_MAP = {
  jpg: { ext: 'jpg', opts: { quality: 92 } },
  jpeg: { ext: 'jpg', opts: { quality: 92 } },
  png: { ext: 'png', opts: { compressionLevel: 6 } },
  tif: { ext: 'tif', opts: { compression: 'lzw' } },
  tiff: { ext: 'tif', opts: { compression: 'lzw' } },
  webp: { ext: 'webp', opts: { quality: 90 } },
};

function outputDirFor(folder) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(folder, `CaptionManager_output_${timestamp}`);
}

async function upscaleLanczos2x(pipeline) {
  const tmpBuf = await pipeline.toBuffer();
  const tmpMeta = await sharp(tmpBuf).metadata();
  return sharp(tmpBuf).resize(tmpMeta.width * 2, tmpMeta.height * 2, { kernel: 'lanczos3' });
}

function applyFormat(pipeline, fmt) {
  if (fmt.ext === 'jpg') return pipeline.jpeg(fmt.opts);
  if (fmt.ext === 'png') return pipeline.png(fmt.opts);
  if (fmt.ext === 'tif') return pipeline.tiff(fmt.opts);
  if (fmt.ext === 'webp') return pipeline.webp(fmt.opts);
  return pipeline.jpeg({ quality: 92 });
}

async function processOne(imgPath, s, { fmt, globalUpscale }) {
  await fsp.access(imgPath);
  // Auto-orient, then user rotation FIRST so crop coords (defined in rotated
  // preview space) map 1:1 onto these pixels.
  const oriented = await loadOriented(imgPath, normalizeAngle(s.rotation));
  const meta = await sharp(oriented).metadata();
  let pipeline = sharp(oriented);

  const rect = cropParams(meta, s.crop);
  if (rect) pipeline = pipeline.extract(rect);

  if (globalUpscale || s.upscaleEnabled) {
    pipeline = await upscaleLanczos2x(pipeline);
  }
  return applyFormat(pipeline, fmt);
}

function registerBatch({ ipcMain, getMainWindow }) {
  ipcMain.handle('process-batch', async (event, { folder, settings, globalFormat, globalUpscale }) => {
    if (!folder) throw new Error('No folder');
    if (!sharp) throw new Error('sharp missing');

    const outDir = outputDirFor(folder);
    await fsp.mkdir(outDir, { recursive: true });

    const fmtKey = (globalFormat || 'jpg').toLowerCase();
    const fmt = FORMAT_MAP[fmtKey] || FORMAT_MAP.jpg;

    let processed = 0;
    const errors = [];
    const entries = Object.entries(settings); // {path: {crop, aspect, upscaleEnabled?, rotation?}}

    for (let i = 0; i < entries.length; i++) {
      const [imgPath, s] = entries[i];
      try {
        const pipeline = await processOne(imgPath, s, { fmt, globalUpscale });
        const base = path.basename(imgPath, path.extname(imgPath));
        await pipeline.toFile(path.join(outDir, `${base}.${fmt.ext}`));
        processed++;
      } catch (e) {
        console.error('process fail', imgPath, e);
        errors.push({ path: imgPath, error: e.message });
      }
      const win = getMainWindow();
      if (win) win.webContents.send('batch-progress', { current: i + 1, total: entries.length, processed, errors: errors.length });
    }

    return { outDir, processed, total: entries.length, errors };
  });
}

module.exports = { registerBatch, processOne, outputDirFor, FORMAT_MAP, upscaleLanczos2x, applyFormat };
