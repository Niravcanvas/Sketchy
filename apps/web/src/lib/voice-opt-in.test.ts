import { beforeEach, describe, expect, it } from 'vitest';
import { hasVoiceOptIn, setVoiceOptIn } from './voice-opt-in';

/** Voice auto-rejoin preference (game-design.md §10). */
describe('voice opt-in preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to not opted in', () => {
    expect(hasVoiceOptIn()).toBe(false);
  });

  it('remembers an opt-in and can be turned back off', () => {
    setVoiceOptIn(true);
    expect(hasVoiceOptIn()).toBe(true);
    setVoiceOptIn(false);
    expect(hasVoiceOptIn()).toBe(false);
  });
});
