import { describe, it, expect } from 'vitest';
import { isNewer, parseVersion, checkForUpdates } from '../electron/updates.js';

describe('parseVersion / isNewer', () => {
  it('compares dotted versions', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
    expect(isNewer('v0.2.0', '0.1.9')).toBe(true);
    expect(isNewer('0.1.10', '0.1.9')).toBe(true);
  });

  it('parses leniently', () => {
    expect(parseVersion('v1.2')).toEqual([1, 2]);
    expect(parseVersion('')).toEqual([0]);
  });
});

describe('checkForUpdates', () => {
  const fakeFetch = (version) => async () => ({ ok: true, json: async () => ({ version }) });

  it('reports available updates and notifies', async () => {
    let notified = null;
    const r = await checkForUpdates({
      loadSettings: () => ({}),
      localVersion: '0.1.0',
      notify: (info) => { notified = info; },
      fetchImpl: fakeFetch('0.2.0'),
    });
    expect(r.available).toBe(true);
    expect(r.version).toBe('0.2.0');
    expect(r.url).toContain('github.com');
    expect(notified).toEqual(r);
  });

  it('stays silent when current', async () => {
    let notified = null;
    const r = await checkForUpdates({
      loadSettings: () => ({}),
      localVersion: '0.2.0',
      notify: (info) => { notified = info; },
      fetchImpl: fakeFetch('0.2.0'),
    });
    expect(r).toEqual({ available: false });
    expect(notified).toBeNull();
  });

  it('respects the opt-out and survives network errors', async () => {
    const off = await checkForUpdates({
      loadSettings: () => ({ updateCheck: false }),
      localVersion: '0.1.0',
      fetchImpl: () => { throw new Error('nope'); },
    });
    expect(off).toEqual({ available: false, disabled: true });

    const failed = await checkForUpdates({
      loadSettings: () => ({}),
      localVersion: '0.1.0',
      fetchImpl: async () => { throw new Error('offline'); },
    });
    expect(failed.available).toBe(false);
    expect(failed.error).toMatch('offline');
  });
});
