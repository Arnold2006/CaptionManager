// Image listing / thumbnails / oriented previews / palette sampling (Electron main).
// Single home for the orient→crop→downscale pipeline previously copy-pasted
// across get-image-data, caption-image-data, caption-generate and batch.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const {
  previewMax, previewQuality, thumbDefaultSize, captionMax,
  sampleBoxTarget, sampleGlobalTarget, sampleElementMax, sampleGlobalMax, sampleMinSize,
} = require('./config');
const { topColorsFromPixels, grayToRgb } = require('./palette');
const { debugLog } = require('./log');

let sharp;
try { sharp = require('sharp'); } catch (e) { console.warn('sharp not available', e && e.message); }

const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.bmp', '.avif', '.heic', '.heif']);

// ---- pure helpers (unit-tested) ----
function normalizeAngle(rotation) {
  const n = Number(rotation);
  if (!Number.isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
}

// Normalized {x,y,w,h} crop against {width,height} dims -> pixel rect or null
// when the crop is absent/too small. Shared clamp logic for every consumer.
function cropParams(meta, crop) {
  if (!crop || typeof crop.x !== 'number') return null;
  const left = Math.max(0, Math.round(crop.x * meta.width));
  const top = Math.max(0, Math.round(crop.y * meta.height));
  let w = Math.round(crop.w * meta.width);
  let h = Math.round(crop.h * meta.height);
  w = Math.min(w, meta.width - left);
  h = Math.min(h, meta.height - top);
  if (w <= 10 || h <= 10) return null;
  return { left, top, width: w, height: h };
}

// ---- sharp pipeline (orient first, so downstream coords are stable) ----
async function loadOriented(imagePath, angle) {
  let buf = await sharp(imagePath).rotate().toBuffer();
  if (angle) buf = await sharp(buf).rotate(angle).toBuffer();
  return buf;
}

async function orientedMeta(imagePath, angle) {
  return sharp(await loadOriented(imagePath, angle)).metadata();
}

// Apply an optional normalized crop, then downscale to a JPEG data URL.
// Returns { dataUrl, width, height, format } with TRUE (post-crop) dimensions.
async function previewDataUrl(imagePath, { angle = 0, crop = null, maxSize = previewMax, quality = previewQuality } = {}) {
  const buf = await loadOriented(imagePath, angle);
  const meta = await sharp(buf).metadata();
  let pipeline = sharp(buf);
  const rect = cropParams(meta, crop);
  let width = meta.width, height = meta.height;
  if (rect) {
    pipeline = pipeline.extract(rect);
    width = rect.width; height = rect.height;
  }
  const out = await pipeline.resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality }).toBuffer();
  return { dataUrl: `data:image/jpeg;base64,${out.toString('base64')}`, width, height, format: meta.format };
}

async function listImages(folder) {
  const entries = await fsp.readdir(folder, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) continue;
    const full = path.join(folder, e.name);
    try {
      const stat = await fsp.stat(full);
      files.push({ path: full, name: e.name, size: stat.size, mtime: stat.mtimeMs });
    } catch {}
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

async function sampleRegion(imagePath, meta, bbox, target) {
  const w = meta.width, h = meta.height;
  let rect;
  if (Array.isArray(bbox) && bbox.some((v) => v > 0)) {
    const [ymin, xmin, ymax, xmax] = bbox;
    const left = Math.max(0, Math.min(w - 1, Math.round((xmin / 1000) * w)));
    const top = Math.max(0, Math.min(h - 1, Math.round((ymin / 1000) * h)));
    const width = Math.max(1, Math.min(w - left, Math.round(((xmax - xmin) / 1000) * w)));
    const height = Math.max(1, Math.min(h - top, Math.round(((ymax - ymin) / 1000) * h)));
    rect = { left, top, width, height };
  } else {
    rect = { left: 0, top: 0, width: w, height: h };
  }
  if (rect.width < sampleMinSize || rect.height < sampleMinSize) return [];
  let { data, info } = await sharp(imagePath).rotate()
    .extract(rect)
    .resize(target, target, { fit: 'fill' })
    .toColorspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels < 3) {
    if (info.channels === 1) {
      data = grayToRgb(data);
      info = { ...info, channels: 3 };
    } else {
      return [];
    }
  }
  return topColorsFromPixels(data, sampleElementMax);
}

function registerImages({ ipcMain, dialog, shell, getMainWindow }) {
  const needSharp = () => { if (!sharp) throw new Error('sharp missing'); };

  ipcMain.handle('select-folder', async () => {
    const attempt = async (win) => {
      const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
      if (res.canceled || !res.filePaths[0]) return null;
      return res.filePaths[0];
    };
    try {
      const win = (require('electron').BrowserWindow.getFocusedWindow() || getMainWindow());
      return await attempt(win);
    } catch (e) {
      console.error('select-folder failed', e);
      try {
        return await attempt(undefined);
      } catch (e2) { console.error('fallback select-folder failed', e2); throw e2; }
    }
  });

  ipcMain.handle('check-path', async (_e, p) => {
    try {
      const stat = await fsp.stat(p);
      return { exists: true, isDirectory: stat.isDirectory(), isFile: stat.isFile(), path: p, dir: stat.isDirectory() ? p : path.dirname(p) };
    } catch (err) {
      return { exists: false, error: err.message, path: p };
    }
  });

  ipcMain.handle('list-images', async (_e, folder) => {
    if (!folder) return [];
    try {
      await fsp.access(folder);
    } catch { return []; }
    return listImages(folder);
  });

  ipcMain.handle('get-thumbnail', async (_e, imagePath, size = thumbDefaultSize) => {
    needSharp();
    try {
      const buf = await sharp(imagePath).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch (err) {
      console.error('thumb fail', imagePath, err);
      throw err;
    }
  });

  ipcMain.handle('get-image-data', async (_e, imagePath, rotation) => {
    needSharp();
    try {
      const angle = normalizeAngle(rotation);
      const { dataUrl, width, height, format } = await previewDataUrl(imagePath, { angle });
      return { dataUrl, width, height, format, rotation: angle };
    } catch (err) {
      console.error('get-image-data fail', err);
      throw err;
    }
  });

  ipcMain.handle('delete-image', async (_e, imagePath) => {
    debugLog('delete-image start:', imagePath);
    try {
      await shell.trashItem(imagePath);
      debugLog('delete-image trashed ok:', imagePath);
      return { success: true, trashed: true };
    } catch (err) {
      debugLog('delete-image trash failed:', imagePath, err && err.message);
      try {
        await fsp.unlink(imagePath);
        debugLog('delete-image unlinked ok:', imagePath);
        return { success: true, trashed: false };
      } catch (e2) {
        debugLog('delete-image unlink failed:', imagePath, e2 && e2.message);
        return { success: false, error: e2.message };
      }
    }
  });

  ipcMain.handle('open-path', async (_e, p) => shell.openPath(p));

  // Downscaled vision input with TRUE (post-crop) dimensions.
  ipcMain.handle('caption-image-data', async (_e, imagePath, crop) => {
    needSharp();
    const meta = await sharp(imagePath).rotate().metadata();
    return previewDataUrl(imagePath, { crop, maxSize: captionMax, quality: previewQuality });
  });

  ipcMain.handle('sample-palettes', async (_e, { imagePath, boxes }) => {
    needSharp();
    await fsp.access(imagePath);
    const meta = await sharp(imagePath).rotate().metadata();
    const palettes = [];
    for (const b of boxes || []) {
      try {
        const hasBox = Array.isArray(b) && b.some((v) => v > 0);
        palettes.push(hasBox ? await sampleRegion(imagePath, meta, b, sampleBoxTarget) : null);
      } catch (e) {
        console.error('sample region failed', e);
        palettes.push(null);
      }
    }
    let global = [];
    try { global = await sampleRegion(imagePath, meta, null, sampleGlobalTarget); } catch (e) { console.error('sample global failed', e); }
    return { palettes, global: global.slice(0, sampleGlobalMax) };
  });
}

module.exports = {
  registerImages, listImages, normalizeAngle, cropParams,
  loadOriented, orientedMeta, previewDataUrl, sampleRegion, SUPPORTED_EXTS,
};
