// Update checker (GitHub, runs at startup). Pure version logic is exported
// for unit tests; the Electron wiring stays in main.js via checkForUpdates.
const { updateRepo, updateTimeoutMs } = require('./config');
const { debugLog } = require('./log');

const UPDATE_URL = `https://github.com/${updateRepo}/releases`;

function parseVersion(v) {
  return String(v).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
}

function isNewer(remote, local) {
  const r = parseVersion(remote), l = parseVersion(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

async function fetchRemoteVersion(fetchImpl = fetch) {
  const res = await fetchImpl(`https://raw.githubusercontent.com/${updateRepo}/main/package.json`, {
    signal: AbortSignal.timeout(updateTimeoutMs),
    headers: { 'User-Agent': 'CaptionManager' },
  });
  if (!res.ok) return null;
  const remote = await res.json();
  return (remote && remote.version) || null;
}

// Returns { available, version?, url? }. updateCheck=false opts out.
async function checkForUpdates({ loadSettings, localVersion, notify, fetchImpl } = {}) {
  const settings = loadSettings ? loadSettings() : {};
  if (settings.updateCheck === false) return { available: false, disabled: true };
  try {
    const remoteVersion = await fetchRemoteVersion(fetchImpl);
    const local = typeof localVersion === 'function' ? localVersion() : localVersion;
    if (remoteVersion && isNewer(remoteVersion, local)) {
      const info = { available: true, version: remoteVersion, url: UPDATE_URL };
      if (notify) notify(info);
      return info;
    }
    return { available: false };
  } catch (err) {
    debugLog('update check failed:', err && err.message);
    return { available: false, error: String((err && err.message) || err) };
  }
}

function localPackageVersion() {
  try {
    const pkg = require('../package.json');
    return (pkg && pkg.version) || '0.0.0';
  } catch (_) {
    return '0.0.0';
  }
}

function registerUpdates({ ipcMain }) {
  const appSettings = require('./settings');
  ipcMain.handle('check-updates', async () => checkForUpdates({
    loadSettings: appSettings.loadSettings,
    localVersion: localPackageVersion,
  }));
}

module.exports = { isNewer, parseVersion, fetchRemoteVersion, checkForUpdates, localPackageVersion, registerUpdates, UPDATE_URL };
