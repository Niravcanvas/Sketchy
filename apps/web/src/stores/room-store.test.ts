import { beforeEach, describe, expect, it } from 'vitest';
import type { RedactedGameState } from '@sketchy/engine/redact-for';
import type {
  ChatMessage,
  RoomEvent,
  RoomSnapshot,
  YouSlice,
} from '@sketchy/shared/contract/socket';
import { copy } from '@/copy';
import { roomEventText, useRoomStore } from './room-store';

function buildYou(overrides: Partial<YouSlice> = {}): YouSlice {
  return {
    playerId: 'player-1',
    role: null,
    word: null,
    specialRole: null,
    yourVote: null,
    canAct: {
      submitClue: false,
      vote: false,
      judge: false,
      grudge: false,
      advancePhase: false,
      start: false,
      kick: false,
      extendTimer: false,
    },
    lovebirdsPartnerId: null,
    rivalId: null,
    ...overrides,
  };
}

function buildState(overrides: Partial<RedactedGameState> = {}): RedactedGameState {
  return {
    code: 'ABCJK',
    mode: 'online_private',
    phase: 'lobby',
    round: 0,
    settings: {
      maxPlayers: 12,
      undercoverCount: 1,
      mrWhiteCount: 0,
      specialRoles: [],
      packIds: [],
      difficulties: ['easy', 'medium', 'hard'],
      clueTimerSec: 60,
      discussionTimerSec: 120,
      voteTimerSec: 45,
      mrWhiteFirstClueBan: true,
      eliminationReveal: 'role',
    },
    players: [],
    hostId: 'player-1',
    turnSeat: null,
    clues: [],
    votes: {},
    votedIds: [],
    tiedPlayerIds: null,
    revoteCount: 0,
    pendingElimination: null,
    pair: null,
    winnerFaction: null,
    scoreboard: {},
    gamesPlayedInRoom: 0,
    phaseEndsAt: null,
    seed: '',
    createdAt: 0,
    voteHistory: [],
    lastGuess: null,
    timerExtended: false,
    pendingCascade: [],
    mirrorBounced: false,
    mimeId: null,
    ...overrides,
  };
}

function buildSnapshot(ver: number, overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    ver,
    state: buildState(),
    you: buildYou(),
    ...overrides,
  };
}

function buildChat(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    from: { id: 'player-1', name: 'Priya' },
    text: 'hey',
    at: 0,
    ...overrides,
  };
}

describe('room-store', () => {
  beforeEach(() => {
    useRoomStore.getState().reset();
  });

  describe('applySnapshot', () => {
    it('applies a snapshot whose ver is greater than the current ver', () => {
      useRoomStore.getState().applySnapshot(buildSnapshot(1, { state: buildState({ round: 1 }) }));

      const state = useRoomStore.getState();
      expect(state.ver).toBe(1);
      expect(state.snapshot?.round).toBe(1);
    });

    it('discards a snapshot whose ver equals the current ver (api-contract.md §2.3 rule 1)', () => {
      useRoomStore.getState().applySnapshot(buildSnapshot(1, { state: buildState({ round: 1 }) }));
      useRoomStore.getState().applySnapshot(buildSnapshot(1, { state: buildState({ round: 99 }) }));

      const state = useRoomStore.getState();
      expect(state.ver).toBe(1);
      expect(state.snapshot?.round).toBe(1);
    });

    it('discards a snapshot whose ver is less than the current ver (out-of-order delivery)', () => {
      useRoomStore.getState().applySnapshot(buildSnapshot(3, { state: buildState({ round: 3 }) }));
      useRoomStore.getState().applySnapshot(buildSnapshot(2, { state: buildState({ round: 2 }) }));

      const state = useRoomStore.getState();
      expect(state.ver).toBe(3);
      expect(state.snapshot?.round).toBe(3);
    });

    it('a ver-0 snapshot is discarded against the initial ver-0 state', () => {
      useRoomStore.getState().applySnapshot(buildSnapshot(0, { state: buildState({ round: 5 }) }));

      const state = useRoomStore.getState();
      expect(state.ver).toBe(0);
      expect(state.snapshot).toBeNull();
    });

    it('replaces `you` alongside a newer snapshot', () => {
      useRoomStore.getState().applySnapshot(buildSnapshot(1, { you: buildYou({ playerId: 'p1' }) }));
      useRoomStore.getState().applySnapshot(buildSnapshot(2, { you: buildYou({ playerId: 'p2' }) }));

      expect(useRoomStore.getState().you?.playerId).toBe('p2');
    });
  });

  describe('roomEventText', () => {
    it('maps every RoomEvent type to its copy.md §8 line', () => {
      expect(roomEventText({ type: 'playerJoined', playerId: 'p2', name: 'Priya' }, 'p1')).toBe(
        copy.presence.playerJoined('Priya'),
      );
      expect(roomEventText({ type: 'playerLeft', playerId: 'p2', name: 'Priya' }, 'p1')).toBe(
        copy.presence.playerLeft('Priya'),
      );
      expect(
        roomEventText({ type: 'playerDisconnected', playerId: 'p2', name: 'Priya' }, 'p1'),
      ).toBe(copy.presence.playerDisconnected('Priya'));
      expect(
        roomEventText({ type: 'playerReconnected', playerId: 'p2', name: 'Priya' }, 'p1'),
      ).toBe(copy.presence.playerReconnected('Priya'));
      expect(roomEventText({ type: 'hostChanged', playerId: 'p2', name: 'Priya' }, 'p1')).toBe(
        copy.presence.hostChanged('Priya'),
      );
      expect(roomEventText({ type: 'timerExtended' }, 'p1')).toBe(copy.presence.timerExtended);
    });

    it('disambiguates `kicked` for the kicked player vs. everyone else', () => {
      const event: RoomEvent = { type: 'kicked', playerId: 'p1', name: 'Sam' };

      expect(roomEventText(event, 'p1')).toBe(copy.presence.kickedSelf);
      expect(roomEventText(event, 'p2')).toBe(copy.presence.kickedOthers('Sam'));
      expect(roomEventText(event, null)).toBe(copy.presence.kickedOthers('Sam'));
    });
  });

  describe('pushEvent / dismissEvent', () => {
    it('appends a toast whose text is derived via roomEventText against the current you.playerId', () => {
      useRoomStore.getState().applySnapshot(buildSnapshot(1, { you: buildYou({ playerId: 'me' }) }));

      useRoomStore.getState().pushEvent({ type: 'kicked', playerId: 'me', name: 'Me' });

      const events = useRoomStore.getState().events;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'kicked', text: copy.presence.kickedSelf });
      expect(typeof events[0]?.id).toBe('string');
    });

    it('dismissEvent removes only the toast with the given id', () => {
      useRoomStore.getState().pushEvent({ type: 'timerExtended' });
      useRoomStore.getState().pushEvent({ type: 'playerJoined', playerId: 'p2', name: 'Jo' });
      const [first, second] = useRoomStore.getState().events;

      useRoomStore.getState().dismissEvent(first!.id);

      const remaining = useRoomStore.getState().events;
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe(second!.id);
    });
  });

  describe('chat', () => {
    it('appendChat appends messages in order', () => {
      useRoomStore.getState().appendChat(buildChat({ text: 'one' }));
      useRoomStore.getState().appendChat(buildChat({ text: 'two' }));

      expect(useRoomStore.getState().chat.map((m) => m.text)).toEqual(['one', 'two']);
    });

    it('appendChat caps history at 200, dropping the oldest', () => {
      for (let i = 0; i < 210; i += 1) {
        useRoomStore.getState().appendChat(buildChat({ text: `msg-${i}` }));
      }

      const chat = useRoomStore.getState().chat;
      expect(chat).toHaveLength(200);
      expect(chat[0]?.text).toBe('msg-10');
      expect(chat[chat.length - 1]?.text).toBe('msg-209');
    });

    it('appendChat increments unreadChat while the drawer is closed', () => {
      useRoomStore.getState().appendChat(buildChat());
      useRoomStore.getState().appendChat(buildChat());

      expect(useRoomStore.getState().unreadChat).toBe(2);
    });

    it('setChatOpen(true) clears unreadChat, and appendChat stops counting while open', () => {
      useRoomStore.getState().appendChat(buildChat());
      expect(useRoomStore.getState().unreadChat).toBe(1);

      useRoomStore.getState().setChatOpen(true);
      expect(useRoomStore.getState().unreadChat).toBe(0);

      useRoomStore.getState().appendChat(buildChat());
      expect(useRoomStore.getState().unreadChat).toBe(0);

      useRoomStore.getState().setChatOpen(false);
      expect(useRoomStore.getState().unreadChat).toBe(0);

      useRoomStore.getState().appendChat(buildChat());
      expect(useRoomStore.getState().unreadChat).toBe(1);
    });
  });

  describe('clockOffsetMs', () => {
    it('defaults to 0', () => {
      expect(useRoomStore.getState().clockOffsetMs).toBe(0);
    });

    it('setClockOffsetMs records the latest measurement (lib/socket.ts time:ping, api-contract.md §2.3)', () => {
      useRoomStore.getState().setClockOffsetMs(1500);
      expect(useRoomStore.getState().clockOffsetMs).toBe(1500);

      useRoomStore.getState().setClockOffsetMs(-250);
      expect(useRoomStore.getState().clockOffsetMs).toBe(-250);
    });
  });

  describe('reset', () => {
    it('clears every field back to its initial value', () => {
      useRoomStore.getState().applySnapshot(buildSnapshot(1));
      useRoomStore.getState().setStatus('connected');
      useRoomStore.getState().setJoinError('room_full');
      useRoomStore.getState().pushEvent({ type: 'timerExtended' });
      useRoomStore.getState().appendChat(buildChat());
      useRoomStore.getState().setChatOpen(true);
      useRoomStore.getState().setClockOffsetMs(750);

      useRoomStore.getState().reset();

      expect(useRoomStore.getState()).toMatchObject({
        snapshot: null,
        you: null,
        ver: 0,
        status: 'idle',
        joinError: null,
        chat: [],
        events: [],
        unreadChat: 0,
        chatOpen: false,
        clockOffsetMs: 0,
      });
    });
  });
});
