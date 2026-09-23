// Persistent app settings (CommonJS, Electron main).
// Stores the user-chosen models folder so GGUFs don't need to ship with the
// portable exe — they are downloaded at first launch instead.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const { MODEL_FILE, MMPROJ_FILE } = require('./modelInfo');

function settingsPath(appOverride) {
  const a = appOverride || app;
  return path.join(a.getPath('userData'), 'captionmanager-settings.json');
}

function load(appOverride) {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(appOverride), 'utf8'));
  } catch (_) {
    return {};
  }
}

function save(patch, appOverride) {
  const next = { ...load(appOverride), ...patch };
  const p = settingsPath(appOverride);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function get(appOverride) {
  return load(appOverride);
}

// Repo/app-bundled models dir (dev checkout; absent in portable builds).
function bundledModelsDir() {
  return path.join(path.join(__dirname, '..'), 'models');
}

function hasCompleteModels(dir) {
  try {
    const files = fs.readdirSync(dir);
    return files.includes(MODEL_FILE) && files.includes(MMPROJ_FILE);
  } catch (_) {
    return false;
  }
}

// Effective models dir: explicit user choice first, then a bundled dir that
// already has complete models (dev machines), else userData/models.
// appOverride is a dependency-injection hook for tests.
function resolveModelsDir(appOverride) {
  const custom = (load(appOverride).modelsDir || '').trim();
  if (custom) return { dir: custom, source: 'custom' };
  const bundled = bundledModelsDir();
  if (hasCompleteModels(bundled)) return { dir: bundled, source: 'bundled' };
  const a = appOverride || app;
  return { dir: path.join(a.getPath('userData'), 'models'), source: 'userdata' };
}

function describeModelsDir(dir) {
  const info = { dir, files: {} };
  for (const name of [MODEL_FILE, MMPROJ_FILE]) {
    try {
      const st = fs.statSync(path.join(dir, name));
      info.files[name] = { present: true, size: st.size };
    } catch (_) {
      info.files[name] = { present: false, size: 0 };
    }
  }
  info.complete = info.files[MODEL_FILE].present && info.files[MMPROJ_FILE].present;
  return info;
}

module.exports = { loadSettings: get, saveSettings: save, resolveModelsDir, describeModelsDir, bundledModelsDir };
