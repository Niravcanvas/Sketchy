import { beforeEach, describe, expect, it } from 'vitest';
import { forgetActiveRoom, readActiveRoom, rememberActiveRoom } from './active-room';

/**
 * Active-room memory — the localStorage the site-entry
 * rejoin prompt reads (game-design.md §8 / copy §8).
 */
describe('active-room memory', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('has no remembered room by default', () => {
    expect(readActiveRoom()).toBeNull();
  });

  it('remembers, reads back, and forgets a room code', () => {
    rememberActiveRoom('ABCDE');
    expect(readActiveRoom()).toBe('ABCDE');
    forgetActiveRoom();
    expect(readActiveRoom()).toBeNull();
  });

  it('overwrites a previously remembered room', () => {
    rememberActiveRoom('AAAAA');
    rememberActiveRoom('BBBBB');
    expect(readActiveRoom()).toBe('BBBBB');
  });
});
