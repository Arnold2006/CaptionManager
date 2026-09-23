const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');

let sharp;
try { sharp = require('sharp'); } catch(e) { console.warn('sharp not available', e); }

let captionServer;
try { captionServer = require('./captionServer'); } catch(e) { console.warn('caption server not available', e); }

const SUPPORTED_EXTS = new Set(['.jpg','.jpeg','.png','.tif','.tiff','.webp','.bmp','.avif','.heic','.heif']);

// ---- crash/close diagnostics ----
// Everything unexpected is appended to <userData>/captionmanager-debug.log
// so a vanishing window leaves a trace of HOW it died.
function debugLog(...args) {
  try {
    const line = `[${new Date().toISOString()}] ` + args.map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch (_) { return String(a); } }
      return String(a);
    }).join(' ') + '\n';
    let dir = null;
    try { dir = app.getPath('userData'); } catch (_) {}
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'captionmanager-debug.log'), line);
    }
  } catch (_) {}
  console.error('[debug]', ...args);
}

process.on('uncaughtException', (e) => debugLog('main uncaughtException:', e));
process.on('unhandledRejection', (e) => debugLog('main unhandledRejection:', e));

let mainWindow;
let splash;

function createSplash() {
  splash = new BrowserWindow({
    width: 380,
    height: 260,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    center: true,
    resizable: false,
    show: true,
    skipTaskbar: false
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  // splash never blocks quit
  splash.on('closed', () => { splash = null; });
}

function createWindow() {
  // Show splash immediately — portable exe extraction + AV scan can be 5-10s with no feedback
  createSplash();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    show: false, // show only when ready
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true,
    title: 'CaptionManager'
  });

  // When main is ready, hide splash
  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (splash) { splash.close(); }
      mainWindow.show();
      mainWindow.focus();    }, 300); // tiny fade buffer so splash doesn't flash
  });

  const isDev = !app.isPackaged;
  // Pinokio (and any launcher using the prebuilt dist without a vite server)
  // sets CAPTIONMANAGER_USE_DIST=1 to skip the vite probe entirely.
  const useDist = process.env.CAPTIONMANAGER_USE_DIST === '1';
  if (isDev && !useDist) {
    // Don't auto-open DevTools (causes noisy Autofill.enable errors in Electron 33)
    // User can press F12 / Ctrl+Shift+I to open manually
    const devUrl = 'http://localhost:5173';
    const fallbackFile = path.join(__dirname, '..', 'dist', 'index.html');

    // Poll Vite via plain HTTP instead of calling loadURL immediately.
    // This avoids Electron's "(node:...) Failed to load URL: ERR_CONNECTION_REFUSED" warning
    // that is emitted before our did-fail-load handler can suppress it.
    function isViteReady(url) {
      return new Promise((resolve) => {
        const req = http.get(url, (res) => {
          // Vite returns 200 when ready; any 2xx/3xx counts as ready
          resolve(res.statusCode >= 200 && res.statusCode < 400);
          res.resume();
        });
        req.on('error', () => resolve(false));
        req.setTimeout(600, () => { req.destroy(); resolve(false); });
      });
    }

    async function waitForViteThenLoad() {
      const timeout = 15000;
      const interval = 300;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await isViteReady(devUrl)) {
          mainWindow.loadURL(devUrl);
          return;
        }
        await new Promise(r => setTimeout(r, interval));
      }
      console.log('Vite dev server not available after 15s, loading built dist');
      mainWindow.loadFile(fallbackFile);
    }

    waitForViteThenLoad();

    // Non-5173 load failures are still worth logging
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      if (!url.includes('5173')) console.error('did-fail-load', code, desc, url);
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Diagnostics: distinguish an orderly window close from a renderer crash.
  // A normal close logs here; a native crash never reaches this line.
  mainWindow.on('close', () => {
    debugLog('mainWindow close event fired (orderly window close)');
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    debugLog('RENDERER GONE:', details && details.reason, 'exitCode:', details && details.exitCode);
  });
  mainWindow.webContents.on('crashed', (_e, killed) => {
    debugLog('RENDERER CRASHED, killed:', killed);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  try { if (captionServer) captionServer.stopServer(); } catch {}
});

// Helpers
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
  files.sort((a,b) => a.name.localeCompare(b.name));
  return files;
}

ipcMain.handle('select-folder', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths[0]) return null;
    return res.filePaths[0];
  } catch (e) {
    console.error('select-folder failed', e);
    // fallback without parent window
    try {
      const res2 = await dialog.showOpenDialog({ properties: ['openDirectory'] });
      if (res2.canceled || !res2.filePaths[0]) return null;
      return res2.filePaths[0];
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
  return await listImages(folder);
});

ipcMain.handle('get-thumbnail', async (_e, imagePath, size=256) => {
  if (!sharp) throw new Error('sharp not installed');
  try {
    const buf = await sharp(imagePath).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (err) {
    console.error('thumb fail', imagePath, err);
    throw err;
  }
});

ipcMain.handle('get-image-data', async (_e, imagePath, rotation) => {
  if (!sharp) throw new Error('sharp not installed');
  try {
    const angle = ((Number(rotation) % 360) + 360) % 360;
    // Auto-orient first (matches existing behavior), then apply user rotation
    // so the preview — and all crop math derived from it — lives in rotated space.
    let buf = await sharp(imagePath).rotate().toBuffer();
    if (angle) buf = await sharp(buf).rotate(angle).toBuffer();
    const meta = await sharp(buf).metadata();
    const out = await sharp(buf).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return {
      dataUrl: `data:image/jpeg;base64,${out.toString('base64')}`,
      width: meta.width,
      height: meta.height,
      format: meta.format,
      rotation: angle
    };
  } catch (err) {
    console.error('get-image-data fail', err);
    throw err;
  }
});

ipcMain.handle('get-image-buffer', async (_e, imagePath) => {
  // raw buffer for processing verification (not used in UI)
  const buf = await fsp.readFile(imagePath);
  return buf.toString('base64');
});

ipcMain.handle('delete-image', async (_e, imagePath) => {
  debugLog('delete-image start:', imagePath);
  try {
    await shell.trashItem(imagePath);
    debugLog('delete-image trashed ok:', imagePath);
    return { success: true, trashed: true };
  } catch (err) {
    debugLog('delete-image trash failed:', imagePath, err && err.message);
    // fallback try unlink
    try { await fsp.unlink(imagePath); debugLog('delete-image unlinked ok:', imagePath); return { success: true, trashed: false }; } catch(e2) { debugLog('delete-image unlink failed:', imagePath, e2 && e2.message); return { success:false, error: e2.message }; }
  }
});

ipcMain.handle('open-path', async (_e, p) => {
  return shell.openPath(p);
});

// Batch processing
ipcMain.handle('process-batch', async (event, { folder, settings, globalFormat, globalUpscale }) => {
  if (!folder) throw new Error('No folder');
  if (!sharp) throw new Error('sharp missing');

  const timestamp = new Date().toISOString().replace(/[:.]/g,'-');
  const outDir = path.join(folder, `CaptionManager_output_${timestamp}`);
  await fsp.mkdir(outDir, { recursive: true });

  const formatMap = {
    jpg: { ext: 'jpg', opts: { quality: 92 }},
    jpeg: { ext: 'jpg', opts: { quality: 92 }},
    png: { ext: 'png', opts: { compressionLevel: 6 }},
    tif: { ext: 'tif', opts: { compression: 'lzw' }},
    tiff: { ext: 'tif', opts: { compression: 'lzw' }},
    webp: { ext: 'webp', opts: { quality: 90 }},
  };
  const fmtKey = (globalFormat||'jpg').toLowerCase();
  const fmt = formatMap[fmtKey] || formatMap.jpg;

  let processed = 0;
  let errors = [];
  const entries = Object.entries(settings); // {path: {crop, aspect, upscaleEnabled?}}

  for (let i=0;i<entries.length;i++) {
    const [imgPath, s] = entries[i];
    try {
      // check file still exists
      await fsp.access(imgPath);
      // Auto-orient, then apply user rotation FIRST so crop coords (defined
      // in rotated preview space) map 1:1 onto these pixels.
      const angle = ((Number(s.rotation) % 360) + 360) % 360;
      let oriented = await sharp(imgPath).rotate().toBuffer();
      if (angle) oriented = await sharp(oriented).rotate(angle).toBuffer();
      const meta = await sharp(oriented).metadata();
      let pipeline = sharp(oriented);

      // Crop
      if (s.crop) {
        const left = Math.round(s.crop.x * meta.width);
        const top = Math.round(s.crop.y * meta.height);
        let w = Math.round(s.crop.w * meta.width);
        let h = Math.round(s.crop.h * meta.height);
        // clamp
        w = Math.min(w, meta.width - left);
        h = Math.min(h, meta.height - top);
        if (w > 10 && h > 10) {
          pipeline = pipeline.extract({ left: Math.max(0,left), top: Math.max(0,top), width: w, height: h });
        }
      }

      // Upscale (2x only) - if enabled globally OR per image
      const doUpscale = globalUpscale || s.upscaleEnabled;
      if (doUpscale) {
        // Try Upscaler if available, fallback to sharp lanczos
        let usedAI = false;
        try {
          // Lazy try to require upscaler
          // We attempt to load @upscaler/node or upscaler if installed
          let upscalerMod = null;
          try { upscalerMod = require('upscaler'); } catch {}
          if (!upscalerMod) { try { upscalerMod = require('@upscaler/node'); } catch {} }
          if (upscalerMod) {
            // Upscaler expects slightly different API; we do our best, but if it fails we fallback
            // For now we try generic path - if model not present it'll throw
            // We buffer first
            const buf = await pipeline.toBuffer();
            // Create upscaler instance – models need to be downloaded; we treat failure as fallback
            const Upscaler = upscalerMod.default || upscalerMod;
            const upscaler = new Upscaler({ model: 'esrgan-slim' });
            const upscaled = await upscaler.upscale(buf);
            // upscaler returns base64 or buffer depending on version; normalize
            let upBuf;
            if (Buffer.isBuffer(upscaled)) upBuf = upscaled;
            else if (typeof upscaled === 'string' && upscaled.startsWith('data:')) {
              upBuf = Buffer.from(upscaled.split(',')[1], 'base64');
            } else {
              throw new Error('unexpected upscaler output');
            }
            pipeline = sharp(upBuf);
            usedAI = true;
          }
        } catch (aiErr) {
          console.warn('AI upscale failed, fallback to sharp', aiErr.message);
        }
        if (!usedAI) {
          // sharp 2x lanczos
          const curMeta = await pipeline.metadata().catch(()=> meta);
          // need to get dimensions after crop: we estimate from pipeline
          // Instead we just resize by 2x using pipeline without knowing exact - sharp will compute
          // We buffer to get current size then double
          const tmpBuf = await pipeline.toBuffer();
          const tmpMeta = await sharp(tmpBuf).metadata();
          pipeline = sharp(tmpBuf).resize(tmpMeta.width*2, tmpMeta.height*2, { kernel: 'lanczos3' });
        } else {
          // already set to upscaled buffer; need to continue chain - already handled
        }
      }

      // Convert format
      const base = path.basename(imgPath, path.extname(imgPath));
      const outPath = path.join(outDir, `${base}.${fmt.ext}`);
      if (fmt.ext === 'jpg') pipeline = pipeline.jpeg(fmt.opts);
      else if (fmt.ext === 'png') pipeline = pipeline.png(fmt.opts);
      else if (fmt.ext === 'tif') pipeline = pipeline.tiff(fmt.opts);
      else if (fmt.ext === 'webp') pipeline = pipeline.webp(fmt.opts);
      else pipeline = pipeline.jpeg({ quality: 92 });

      await pipeline.toFile(outPath);
      processed++;
    } catch (e) {
      console.error('process fail', imgPath, e);
      errors.push({ path: imgPath, error: e.message });
    }
    // progress
    mainWindow.webContents.send('batch-progress', { current: i+1, total: entries.length, processed, errors: errors.length });
  }

  return { outDir, processed, total: entries.length, errors };
});

// ---- Settings + first-launch model management ----
const appSettings = require('./settings');

ipcMain.handle('settings-get', async () => appSettings.loadSettings());

ipcMain.handle('settings-set', async (_e, patch) => {
  const next = appSettings.saveSettings(patch || {});
  // A changed models folder applies to the next server start.
  try { if (captionServer) captionServer.stopServer(); } catch (_) {}
  return next;
});

ipcMain.handle('models-browse', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths[0]) return { path: null };
  return { path: res.filePaths[0] };
});

ipcMain.handle('models-status', async () => {
  const { dir, source } = appSettings.resolveModelsDir();
  const info = appSettings.describeModelsDir(dir);
  let bin = false;
  try {
    const st = captionServer ? captionServer.status() : null;
    bin = !!(st && st.binPresent);
  } catch (_) { bin = false; }
  const { MODEL_FILE: mf, MODEL_SIZE: ms, MMPROJ_FILE: pf, MMPROJ_SIZE: ps } = require('./modelInfo');
  return {
    dir, source,
    complete: info.complete,
    files: [
      { name: mf, expected: ms, ...info.files[mf] },
      { name: pf, expected: ps, ...info.files[pf] },
    ],
    binPresent: bin,
  };
});

let modelsDownloading = false;
ipcMain.handle('models-download', async (event) => {
  if (modelsDownloading) throw new Error('Download already in progress');
  const { dir } = appSettings.resolveModelsDir();
  const win = BrowserWindow.fromWebContents(event.sender);
  modelsDownloading = true;
  try {
    const { downloadModels } = require('./modelDownload');
    await downloadModels(dir, (p) => {
      if (win) win.webContents.send('models-progress', p);
    });
    if (win) win.webContents.send('models-progress', { file: '', received: 0, total: 0, finished: true });
    return { ok: true, dir };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), dir };
  } finally {
    modelsDownloading = false;
  }
});

// ---- AI captioning (llama.cpp + Qwen3-VL) ----
ipcMain.handle('caption-status', async () => {
  if (!captionServer) return { running: false, error: 'caption backend missing' };
  return captionServer.status();
});

ipcMain.handle('caption-ensure-server', async (event) => {
  if (!captionServer) throw new Error('caption backend missing');
  const win = BrowserWindow.fromWebContents(event.sender);
  const info = await captionServer.ensureServer();
  if (win) win.webContents.send('caption-progress', { type: 'server-ready', url: info.url });
  return info;
});

ipcMain.handle('caption-stop-server', async () => {
  if (!captionServer) return { stopped: true };
  captionServer.stopServer();
  return { stopped: true };
});

// Returns { dataUrl, width, height } of the (optionally cropped) image,
// downscaled for the vision model. width/height are the TRUE cropped dims.
ipcMain.handle('caption-image-data', async (_e, imagePath, crop) => {
  if (!sharp) throw new Error('sharp missing');
  const meta = await sharp(imagePath).rotate().metadata();
  let pipeline = sharp(imagePath).rotate();
  let width = meta.width, height = meta.height;
  if (crop && typeof crop.x === 'number') {
    const left = Math.max(0, Math.round(crop.x * meta.width));
    const top = Math.max(0, Math.round(crop.y * meta.height));
    let w = Math.round(crop.w * meta.width);
    let h = Math.round(crop.h * meta.height);
    w = Math.min(w, meta.width - left);
    h = Math.min(h, meta.height - top);
    if (w > 10 && h > 10) {
      pipeline = pipeline.extract({ left, top, width: w, height: h });
      width = w; height = h;
    }
  }
  const buf = await pipeline.resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return { dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`, width, height };
});

ipcMain.handle('caption-generate', async (event, { imagePath, crop, mode, instructions }) => {
  if (!captionServer) throw new Error('caption backend missing');
  if (!sharp) throw new Error('sharp missing');
  if (!imagePath) throw new Error('No image path');
  await fsp.access(imagePath);
  // Build vision input (cropped pixels when a crop is set)
  const meta = await sharp(imagePath).rotate().metadata();
  let pipeline = sharp(imagePath).rotate();
  let width = meta.width, height = meta.height;
  if (crop && typeof crop.x === 'number') {
    const left = Math.max(0, Math.round(crop.x * meta.width));
    const top = Math.max(0, Math.round(crop.y * meta.height));
    let w = Math.round(crop.w * meta.width);
    let h = Math.round(crop.h * meta.height);
    w = Math.min(w, meta.width - left);
    h = Math.min(h, meta.height - top);
    if (w > 10 && h > 10) {
      pipeline = pipeline.extract({ left, top, width: w, height: h });
      width = w; height = h;
    }
  }
  const buf = await pipeline.resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const base64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.webContents.send('caption-progress', { type: 'caption-start', path: imagePath, mode });
  console.log('[caption] generate', mode, path.basename(imagePath),
    '| steering:', JSON.stringify(String(instructions || '').trim().slice(0, 200)) || '(none)');
  const result = await captionServer.generate(base64, { mode, instructions, dims: { width, height } });
  if (win) win.webContents.send('caption-progress', { type: 'caption-done', path: imagePath, mode, ok: result.ok });
  return { ...result, width, height };
});

ipcMain.handle('save-caption', async (_e, { imagePath, mode, content }) => {
  if (!imagePath || content == null) throw new Error('Missing image path or content');
  const ext = mode === 'ideogram' ? '.json' : '.txt';
  const outPath = imagePath.replace(/\.[^.]+$/, '') + ext;
  const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  await fsp.writeFile(outPath, data, 'utf8');
  return { saved: true, path: outPath };
});

// Sample real dominant colors from image pixels for bbox regions.
// The VLM often guesses gray-ish palettes; sampling the actual region pixels
// gives truthful colors (skin tones, clothing blues, ...).
// boxes: array of [ymin,xmin,ymax,xmax] in 0-1000 (or nulls). Returns
// { palettes: [[hex,...]|null per box], global: [hex,...] }.
function toHex(r, g, b) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
  return '#' + h(r) + h(g) + h(b);
}

function topColorsFromPixels(data, maxColors) {
  // Quantize to 5 bits/channel, count, average actual colors per bucket.
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let e = buckets.get(key);
    if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; buckets.set(key, e); }
    e.n++; e.r += r; e.g += g; e.b += b;
  }
  const sorted = [...buckets.values()]
    .map((e) => ({ n: e.n, r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }))
    .sort((a, b) => b.n - a.n);
  // Greedy diversity: skip colors too close to an already picked one.
  const picked = [];
  const tooClose = (c) => picked.some((p) => {
    const dr = p.r - c.r, dg = p.g - c.g, db = p.b - c.b;
    return Math.sqrt(dr * dr + dg * dg + db * db) < 32;
  });
  for (const c of sorted) {
    if (picked.length >= maxColors) break;
    if (!tooClose(c)) picked.push(c);
  }
  return picked.slice(0, maxColors).map((c) => toHex(c.r, c.g, c.b));
}

async function sampleRegion(imagePath, meta, bbox, target) {
  const w = meta.width, h = meta.height;
  let left, top, width, height;
  if (Array.isArray(bbox) && bbox.some((v) => v > 0)) {
    const [ymin, xmin, ymax, xmax] = bbox;
    left = Math.max(0, Math.min(w - 1, Math.round((xmin / 1000) * w)));
    top = Math.max(0, Math.min(h - 1, Math.round((ymin / 1000) * h)));
    width = Math.max(1, Math.min(w - left, Math.round(((xmax - xmin) / 1000) * w)));
    height = Math.max(1, Math.min(h - top, Math.round(((ymax - ymin) / 1000) * h)));
  } else {
    left = 0; top = 0; width = w; height = h;
  }
  if (width < 4 || height < 4) return [];
  let { data, info } = await sharp(imagePath).rotate()
    .extract({ left, top, width, height })
    .resize(target, target, { fit: 'fill' })
    .toColorspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels < 3) {
    // Grayscale source: expand the single channel to RGB so the region's
    // true tones are sampled instead of silently falling back.
    if (info.channels === 1) {
      const gray = data;
      data = Buffer.alloc(gray.length * 3);
      for (let i = 0; i < gray.length; i++) {
        data[i * 3] = gray[i]; data[i * 3 + 1] = gray[i]; data[i * 3 + 2] = gray[i];
      }
      info = { ...info, channels: 3 };
    } else {
      return [];
    }
  }
  return topColorsFromPixels(data, 5);
}

ipcMain.handle('sample-palettes', async (_e, { imagePath, boxes }) => {
  if (!sharp) throw new Error('sharp missing');
  await fsp.access(imagePath);
  const meta = await sharp(imagePath).rotate().metadata();
  const palettes = [];
  for (const b of boxes || []) {
    try {
      const hasBox = Array.isArray(b) && b.some((v) => v > 0);
      palettes.push(hasBox ? await sampleRegion(imagePath, meta, b, 32) : null);
    } catch (e) {
      console.error('sample region failed', e);
      palettes.push(null);
    }
  }
  let global = [];
  try { global = await sampleRegion(imagePath, meta, null, 48); } catch (e) { console.error('sample global failed', e); }
  return { palettes, global: global.slice(0, 8) };
});
