import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { copy } from '@/copy';
import { PlayerModeration } from './player-moderation';

// The component pulls in the socket + api-client singletons via its actions and the
// blocks-store; stub the ones that would otherwise touch a socket/network so this is a
// pure render test.
vi.mock('@/lib/socket', () => ({ emitKick: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { createReport: vi.fn() } }));

describe('PlayerModeration — accessibility', () => {
  it('names each per-player Report·Block trigger so screen readers can tell them apart', () => {
    render(<PlayerModeration playerId="p2" playerName="Sam" roomCode="ABCDE" canKick={false} />);

    const trigger = screen.getByTestId('player-moderation-trigger');
    expect(trigger.getAttribute('aria-label')).toBe(
      copy.matchmaking.moderation.moderateAria('Sam'),
    );
  });

  it('gives the menu-mode dialog a (screen-reader) description so Radix has one to wire', () => {
    render(<PlayerModeration playerId="p2" playerName="Sam" roomCode="ABCDE" canKick={false} />);

    fireEvent.click(screen.getByTestId('player-moderation-trigger'));

    expect(screen.getByText(copy.matchmaking.moderation.menuDescription('Sam'))).toBeTruthy();
  });
});
