import { describe, it, expect, vi, afterEach } from 'vitest';
import { findFreePort, servedModelMatches } from '../electron/captionServer.js';
import { MODEL_FILE } from '../electron/modelInfo.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

describe('findFreePort', () => {
  it('returns the port when nothing answers', async () => {
    globalThis.fetch = async () => { throw new Error('refused'); };
    expect(await findFreePort(8901)).toBe(8901);
  });

  it('bumps past ports answering /health', async () => {
    globalThis.fetch = async (url) => ({ ok: String(url).includes(':8901/') || String(url).includes(':8902/') });
    expect(await findFreePort(8901)).toBe(8903);
  });
});

describe('servedModelMatches', () => {
  it('accepts our model and rejects foreign servers', async () => {
    globalThis.fetch = async () => ({ ok: true, text: async () => `{"data":[{"id":"${MODEL_FILE}"}]}` });
    expect(await servedModelMatches('http://x', MODEL_FILE)).toBe(true);

    globalThis.fetch = async () => ({ ok: true, text: async () => '{"data":[{"id":"other-model"}]}' });
    expect(await servedModelMatches('http://x', MODEL_FILE)).toBe(false);

    globalThis.fetch = async () => ({ ok: false });
    expect(await servedModelMatches('http://x', MODEL_FILE)).toBe(false);
  });
});
