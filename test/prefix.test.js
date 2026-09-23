import { describe, it, expect } from 'vitest';
import { extractHldPrefix } from '../electron/captionServer.js';

describe('extractHldPrefix', () => {
  const cases = [
    ['Add the word "TBMRobbie." as a prefix to high_level_description', 'TBMRobbie.'],
    ['prefix high_level_description with "Sarah"', 'Sarah'],
    ['prefix "HALO" to high_level_description', 'HALO'],
    ['prefix high_level_description with TBMRobbie.', 'TBMRobbie.'],
    ['high_level_description must start with "Sarah"', 'Sarah'],
    ['high_level_description starts with TBMRobbie', 'TBMRobbie'],
    ['start high_level_description with "Intro:"', 'Intro:'],
    ['add TBMRobbie as prefix', 'TBMRobbie'],
    ['add "TBMRobbie." as a prefix to high_level_description', 'TBMRobbie.'],
    // trailing sentence punctuation is stripped mid-text, kept at the end
    ['Prefix high_level_description with Sarah. Describe everything in a moody tone', 'Sarah'],
    ['Describe everything in a cinematic tone', null],
    ['', null],
    [null, null],
  ];
  for (const [input, want] of cases) {
    it(JSON.stringify(input), () => {
      expect(extractHldPrefix(input)).toBe(want);
    });
  }
});
