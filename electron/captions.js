// AI captioning IPC (Electron main). Vision-model orchestration lives in
// captionServer.js; image prep lives in images.js — this file only wires IPC.
const path = require('path');
const { captionMax, previewQuality } = require('./config');
const { cropParams } = require('./images');
const { gridSvg } = require('./gridOverlay');
const { debugLog } = require('./log');

let sharp;
try { sharp = require('sharp'); } catch (e) { console.warn('sharp not available', e && e.message); }

// Build the downscaled vision input; returns base64 + TRUE (post-crop) dims.
// `grid` draws the labeled 0-1000 coordinate grid (Ideogram mode) so bbox edges
// can be read off gridlines instead of guessed. verifyBase64 is always the
// clean, grid-free copy: the text-verification pass must never confirm grid
// numbers as if they were text in the picture.
async function buildVisionInput(imagePath, crop, { grid = false } = {}) {
  const meta = await sharp(imagePath).rotate().metadata();
  let pipeline = sharp(imagePath).rotate();
  let width = meta.width, height = meta.height;
  const rect = cropParams(meta, crop);
  if (rect) {
    pipeline = pipeline.extract(rect);
    width = rect.width; height = rect.height;
  }
  const buf = await pipeline.resize(captionMax, captionMax, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: previewQuality }).toBuffer();
  const verifyBase64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
  if (!grid) return { base64: verifyBase64, verifyBase64, width, height };
  const sized = await sharp(buf).metadata();
  const gridded = await sharp(buf)
    .composite([{ input: Buffer.from(gridSvg(sized.width, sized.height)), top: 0, left: 0 }])
    .jpeg({ quality: previewQuality })
    .toBuffer();
  return { base64: `data:image/jpeg;base64,${gridded.toString('base64')}`, verifyBase64, width, height };
}

function registerCaptions({ ipcMain, getMainWindow, captionServer }) {
  const needBackend = () => { if (!captionServer) throw new Error('caption backend missing'); };

  ipcMain.handle('caption-status', async () => {
    needBackend();
    return captionServer.status();
  });

  ipcMain.handle('caption-ensure-server', async (event) => {
    needBackend();
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(event.sender);
    const info = await captionServer.ensureServer();
    if (win) win.webContents.send('caption-progress', { type: 'server-ready', url: info.url });
    return info;
  });

  ipcMain.handle('caption-generate', async (event, { imagePath, crop, mode, instructions, promptOptions, triggerWord }) => {
    needBackend();
    if (!sharp) throw new Error('sharp missing');
    if (!imagePath) throw new Error('No image path');
    const fsp = require('fs/promises');
    await fsp.access(imagePath);
    const { base64, verifyBase64, width, height } = await buildVisionInput(imagePath, crop, { grid: mode !== 'plain' });
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.webContents.send('caption-progress', { type: 'caption-start', path: imagePath, mode });
    debugLog('caption generate', mode, path.basename(imagePath),
      '| steering:', JSON.stringify(String(instructions || '').trim().slice(0, 200)) || '(none)',
      '| details:', JSON.stringify(promptOptions || []),
      '| trigger:', JSON.stringify(String(triggerWord || '').trim()));
    const result = await captionServer.generate(base64, { mode, instructions, promptOptions, triggerWord, dims: { width, height }, verifyImageBase64: verifyBase64 });
    if (win) win.webContents.send('caption-progress', { type: 'caption-done', path: imagePath, mode, ok: result.ok });
    return { ...result, width, height };
  });

  ipcMain.handle('save-caption', async (_e, { imagePath, mode, content }) => {
    if (!imagePath || content == null) throw new Error('Missing image path or content');
    const ext = mode === 'ideogram' ? '.json' : '.txt';
    const fsp = require('fs/promises');
    const outPath = imagePath.replace(/\.[^.]+$/, '') + ext;
    const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    await fsp.writeFile(outPath, data, 'utf8');
    return { saved: true, path: outPath };
  });
}

module.exports = { registerCaptions, buildVisionInput };
