import { describe, it, expect } from 'vitest';
import CATALOG from '../electron/captionOptions.json';
import { buildExtrasInstruction, normalizeOptionIds } from '../electron/captionOptions.js';
import { buildIdeogramMessages } from '../electron/captionServer.js';

describe('caption prompt extras catalogue', () => {
  it('has the 25 registry.py options with unique ids', () => {
    expect(CATALOG).toHaveLength(25);
    expect(new Set(CATALOG.map((o) => o.id)).size).toBe(25);
    expect(CATALOG[0]).toMatchObject({
      label: 'Call the person by the trigger word',
      default: false,
    });
    const labels = CATALOG.map((o) => o.label);
    expect(labels).toContain('Camera angle');
    expect(labels).toContain('Ages');
  });

  it('defaults on the five options marked true in the registry', () => {
    expect(CATALOG.filter((o) => o.default).map((o) => o.label)).toEqual([
      'Lighting',
      'Camera angle',
      'Shot type (close-up to wide)',
      'Not the resolution',
      'No “This image shows…”',
    ]);
  });

  it('keeps known ids in catalogue order', () => {
    expect(normalizeOptionIds(['ages', 'cameraAngle', 'nope'])).toEqual(['cameraAngle', 'ages']);
  });
});

describe('buildExtrasInstruction', () => {
  it('appends the selected instructions', () => {
    expect(buildExtrasInstruction(['lighting', 'notResolution'])).toBe(
      'PROMPT EXTRAS — follow every instruction below exactly:\n' +
      '- Include information about lighting.\n' +
      "- Do NOT mention the image's resolution."
    );
  });

  it('fills {name} with the trigger word', () => {
    const text = buildExtrasInstruction(['callByName', 'ages'], '  ohwx  ');
    expect(text).toContain('refer to them as ohwx.');
    expect(text).not.toContain('{name}');
    expect(text).toContain('Include information about the ages');
  });

  it('skips the {name} option when no trigger word is set', () => {
    expect(buildExtrasInstruction(['callByName'], '')).toBe('');
    expect(buildExtrasInstruction(['callByName', 'cameraAngle'], '')).toBe(
      'PROMPT EXTRAS — follow every instruction below exactly:\n' +
      '- Include information about camera angle.'
    );
  });

  it('puts the tooltip instructions in the Ideogram caption prompt', () => {
    const messages = buildIdeogramMessages(
      'data:image/jpeg;base64,AAAA',
      '',
      [],
      { width: 100, height: 100 },
      ['cameraAngle', 'ages', 'callByName'],
      'ohwx'
    );
    const userText = messages[1].content.find((part) => part.type === 'text').text;
    expect(userText).toContain('Include information about camera angle.');
    expect(userText).toContain('Include information about the ages of any people/characters when applicable.');
    expect(userText).toContain('refer to them as ohwx.');
    expect(userText).not.toContain('{name}');
  });
});
