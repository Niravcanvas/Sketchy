import { create } from 'zustand';
import { apiClient } from '@/lib/api-client';

/**
 * The caller's block list, mirrored client-side. Drives the
 * "hide their chat locally" filter (chat-drawer) and the block/unblock
 * affordances. The SERVER is the source of truth for matchmaking's "never
 * matched together" guarantee — this store is purely the local view + a thin
 * wrapper over the block endpoints.
 */
export interface BlocksState {
  blockedIds: string[];
  loaded: boolean;
  load: () => Promise<void>;
  block: (playerId: string) => Promise<boolean>;
  unblock: (playerId: string) => Promise<boolean>;
  isBlocked: (playerId: string) => boolean;
}

export const useBlocksStore = create<BlocksState>((set, get) => ({
  blockedIds: [],
  loaded: false,

  load: async () => {
    try {
      const { items } = await apiClient.listBlocks();
      set({ blockedIds: items.map((i) => i.blockedPlayerId), loaded: true });
    } catch {
      // Offline / unauth — leave the (possibly empty) local view; nothing to hide.
      set({ loaded: true });
    }
  },

  block: async (playerId) => {
    try {
      await apiClient.blockPlayer({ blockedPlayerId: playerId });
      set((state) =>
        state.blockedIds.includes(playerId) ? state : { blockedIds: [...state.blockedIds, playerId] },
      );
      return true;
    } catch {
      return false;
    }
  },

  unblock: async (playerId) => {
    try {
      await apiClient.unblockPlayer(playerId);
      set((state) => ({ blockedIds: state.blockedIds.filter((id) => id !== playerId) }));
      return true;
    } catch {
      return false;
    }
  },

  isBlocked: (playerId) => get().blockedIds.includes(playerId),
}));
