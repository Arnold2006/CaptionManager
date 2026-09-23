import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const settings = require('../electron/settings.js');
const { normalizeAngle, cropParams } = require('../electron/images.js');

// Isolated fake Electron app: settings resolve against a temp userData dir,
// never the developer's real %APPDATA%.
let tmpUserData;
let fakeApp;
beforeEach(() => {
  tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-test-userdata-'));
  fakeApp = { getPath: (name) => (name === 'userData' ? tmpUserData : os.tmpdir()) };
});
afterEach(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
});

describe('normalizeAngle', () => {
  it('wraps to 0-359', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(90)).toBe(90);
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(450)).toBe(90);
    expect(normalizeAngle(undefined)).toBe(0);
    expect(normalizeAngle('180')).toBe(180);
  });
});

describe('cropParams', () => {
  const meta = { width: 1000, height: 500 };

  it('converts normalized crop to pixels', () => {
    expect(cropParams(meta, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }))
      .toEqual({ left: 100, top: 50, width: 500, height: 250 });
  });

  it('returns null for missing or tiny crops', () => {
    expect(cropParams(meta, null)).toBeNull();
    expect(cropParams(meta, { x: 0, y: 0, w: 0.005, h: 0.005 })).toBeNull();
    expect(cropParams(meta, 'nope')).toBeNull();
  });

  it('clamps to image bounds', () => {
    expect(cropParams(meta, { x: 0.9, y: 0.9, w: 0.5, h: 0.5 }))
      .toEqual({ left: 900, top: 450, width: 100, height: 50 });
  });
});

describe('resolveModelsDir', () => {
  it('prefers an explicit custom dir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-models-'));
    settings.saveSettings({ modelsDir: dir }, fakeApp);
    try {
      expect(settings.resolveModelsDir(fakeApp)).toEqual({ dir, source: 'custom' });
    } finally {
      fs.rmdirSync(dir);
    }
  });

  it('falls back to userData when nothing is configured', () => {
    const r = settings.resolveModelsDir(fakeApp);
    // (bundled dev models/ may or may not be complete on this machine)
    expect(r.dir).toBe(
      r.source === 'bundled'
        ? settings.bundledModelsDir()
        : path.join(tmpUserData, 'models')
    );
  });

  it('describes completeness honestly', () => {
    const d = settings.describeModelsDir(path.join(tmpUserData, 'does-not-exist'));
    expect(d.complete).toBe(false);
  });
});
