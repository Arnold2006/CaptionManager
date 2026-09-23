// Crash/close diagnostics + shared logging (CommonJS, Electron main).
// Everything unexpected is appended to <userData>/captionmanager-debug.log
// so a vanishing window leaves a trace of HOW it died.
const fs = require('fs');
const path = require('path');

let userDataDir = null;

function init(app) {
  try { userDataDir = app.getPath('userData'); } catch (_) { userDataDir = null; }
}

function formatArg(a) {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === 'object') { try { return JSON.stringify(a); } catch (_) { return String(a); } }
  return String(a);
}

function debugLog(...args) {
  try {
    const line = `[${new Date().toISOString()}] ` + args.map(formatArg).join(' ') + '\n';
    if (userDataDir) {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.appendFileSync(path.join(userDataDir, 'captionmanager-debug.log'), line);
    }
  } catch (_) {}
  console.error('[debug]', ...args);
}

function verbose(...args) {
  if (process.env.CAPTIONMANAGER_VERBOSE) debugLog(...args);
  else console.log(...args);
}

function installCrashHandlers({ app, mainWindowRef }) {
  process.on('uncaughtException', (e) => debugLog('main uncaughtException:', e));
  process.on('unhandledRejection', (e) => debugLog('main unhandledRejection:', e));
  app.on('before-quit', () => debugLog('app before-quit'));
  const attachWindow = () => {
    const w = mainWindowRef();
    if (!w) return;
    w.on('close', () => debugLog('mainWindow close event fired (orderly window close)'));
    w.webContents.on('render-process-gone', (_e, details) => {
      debugLog('RENDERER GONE:', details && details.reason, 'exitCode:', details && details.exitCode);
    });
    w.webContents.on('crashed', (_e, killed) => {
      debugLog('RENDERER CRASHED, killed:', killed);
    });
  };
  return { attachWindow };
}

module.exports = { init, debugLog, verbose, installCrashHandlers };
