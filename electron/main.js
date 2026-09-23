const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const http = require('http');
const { init: initLog, debugLog, installCrashHandlers } = require('./log');
const { registerImages } = require('./images');
const { registerBatch } = require('./batch');
const { registerModels } = require('./models');
const { registerCaptions } = require('./captions');
const { checkForUpdates, localPackageVersion, registerUpdates } = require('./updates');
const { updateStartupDelayMs, viteReadyTimeoutMs, viteReadyPollMs, viteHttpTimeoutMs } = require('./config');

let captionServer;
try { captionServer = require('./captionServer'); } catch(e) { console.warn('caption server not available', e); }

initLog(app);

let mainWindow;
let splash;
const getMainWindow = () => mainWindow;
const { attachWindow } = installCrashHandlers({ app, mainWindowRef: getMainWindow });

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
  // Show splash immediately â€” portable exe extraction + AV scan can be 5-10s with no feedback
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
        req.setTimeout(viteHttpTimeoutMs, () => { req.destroy(); resolve(false); });
      });
    }

    async function waitForViteThenLoad() {
      const timeout = viteReadyTimeoutMs;
      const interval = viteReadyPollMs;
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

  attachWindow();
}

app.whenReady().then(() => {
  createWindow();
  registerImages({ ipcMain, dialog, shell, getMainWindow });
  registerBatch({ ipcMain, getMainWindow });
  registerModels({ ipcMain, dialog, getMainWindow, captionServer });
  registerCaptions({ ipcMain, getMainWindow, captionServer });
  // Update check shortly after startup (silent unless an update exists).
  setTimeout(() => {
    const appSettings = require('./settings');
    checkForUpdates({
      loadSettings: appSettings.loadSettings,
      localVersion: localPackageVersion,
      notify: (info) => { if (mainWindow) mainWindow.webContents.send('update-available', info); },
    }).catch(() => {});
  }, updateStartupDelayMs);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  try { if (captionServer) captionServer.stopServer(); } catch {}
});

registerUpdates({ ipcMain });
