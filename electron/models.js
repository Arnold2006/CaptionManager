// Settings + first-launch model management IPC (Electron main).
const appSettings = require('./settings');
const { MODEL_FILE, MODEL_SIZE, MMPROJ_FILE, MMPROJ_SIZE } = require('./modelInfo');

function registerModels({ ipcMain, dialog, getMainWindow, captionServer }) {
  ipcMain.handle('settings-get', async () => appSettings.loadSettings());

  ipcMain.handle('settings-set', async (_e, patch) => {
    const next = appSettings.saveSettings(patch || {});
    // A changed models folder applies to the next server start.
    try { if (captionServer) captionServer.stopServer(); } catch (_) {}
    return next;
  });

  ipcMain.handle('models-browse', async (event) => {
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(event.sender) || getMainWindow();
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
    return {
      dir, source,
      complete: info.complete,
      files: [
        { name: MODEL_FILE, expected: MODEL_SIZE, ...info.files[MODEL_FILE] },
        { name: MMPROJ_FILE, expected: MMPROJ_SIZE, ...info.files[MMPROJ_FILE] },
      ],
      binPresent: bin,
    };
  });

  let modelsDownloading = false;
  ipcMain.handle('models-download', async (event) => {
    if (modelsDownloading) throw new Error('Download already in progress');
    const { dir } = appSettings.resolveModelsDir();
    const { BrowserWindow } = require('electron');
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
}

module.exports = { registerModels };
