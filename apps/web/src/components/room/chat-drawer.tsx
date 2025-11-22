'use client';

import { useEffect, useState, type FormEvent } from 'react';
import clsx from 'clsx';
import { IconChat } from '@/components/icons/icon-chat';
import { IconGhost } from '@/components/icons/icon-ghost';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { PopInput } from '@/components/pop/pop-input';
import { copy } from '@/copy';
import { copyForError } from '@/lib/error-copy';
import { emitChat } from '@/lib/socket';
import { useBlocksStore } from '@/stores/blocks-store';
import { useRoomStore } from '@/stores/room-store';

const MAX_CHAT_LENGTH = 200;

/**
 * Chat drawer (game-design.md §3.4): a toggle button with an unread badge, and a panel with
 * message list + composer. Sets `chatOpen` on `room-store` so unread counting pauses while
 * open (`room-store.ts`'s `appendChat`). Ghost "from beyond" message styling: a
 * `ChatMessage` carries no redaction flag of its own (api-contract.md §2.2 — it's ephemeral,
 * never replayed), so whether a sender is currently an eliminated Ghost is looked up against
 * the live snapshot's `players[]` at RENDER time, same as any other redacted-state read.
 */
export function ChatDrawer() {
  const chat = useRoomStore((state) => state.chat);
  const unreadChat = useRoomStore((state) => state.unreadChat);
  const chatOpen = useRoomStore((state) => state.chatOpen);
  const setChatOpen = useRoomStore((state) => state.setChatOpen);
  const snapshot = useRoomStore((state) => state.snapshot);
  const ghostActive = snapshot?.settings.specialRoles.includes('ghost') ?? false;
  // Hide messages from players the viewer has blocked ("blocked-in-room
  // hides their chat locally"). Load the block list once on mount.
  const blockedIds = useBlocksStore((state) => state.blockedIds);
  const loadBlocks = useBlocksStore((state) => state.load);
  useEffect(() => {
    void loadBlocks();
  }, [loadBlocks]);

  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || isSending) {
      return;
    }
    setIsSending(true);
    setError(null);
    const ack = await emitChat(trimmed);
    setIsSending(false);
    if (ack.ok) {
      setText('');
    } else {
      setError(copyForError(ack.error));
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-20 flex flex-col items-end gap-2">
      {chatOpen ? (
        <PopCard className="flex h-96 w-80 flex-col gap-3">
          <ul className="flex flex-1 flex-col gap-2 overflow-y-auto">
            {chat.map((message, index) => {
              const sender = snapshot?.players.find((p) => p.id === message.from.id);
              const isGhostMessage = ghostActive && sender ? !sender.alive : false;
              const isBlocked = blockedIds.includes(message.from.id);
              if (isBlocked) {
                return (
                  <li
                    key={`${message.at}-${index}`}
                    data-testid="chat-message"
                    data-blocked="true"
                    className="font-ui text-sm italic text-graphite"
                  >
                    {copy.matchmaking.moderation.chatHidden}
                  </li>
                );
              }
              return (
                <li
                  key={`${message.at}-${index}`}
                  data-testid="chat-message"
                  data-ghost={isGhostMessage}
                  className={clsx(
                    'font-ui text-base leading-snug',
                    isGhostMessage ? 'italic text-graphite' : 'text-ink',
                  )}
                >
                  {isGhostMessage ? (
                    <IconGhost className="mr-1 inline h-3 w-3 align-text-top" aria-hidden="true" />
                  ) : null}
                  <span className="font-ui text-sm font-bold text-graphite">{`${message.from.name}: `}</span>
                  {message.text}
                </li>
              );
            })}
          </ul>

          {error ? (
            <p role="alert" className="font-ui text-sm text-undercover">
              {error}
            </p>
          ) : null}

          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              void handleSubmit(event);
            }}
          >
            <div className="flex-1">
              <PopInput
                label={copy.rooms.chat.label}
                placeholder={copy.rooms.chat.placeholder}
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={MAX_CHAT_LENGTH}
                data-testid="chat-input"
              />
            </div>
            <PopButton
              type="submit"
              variant="primary"
              disabled={isSending || text.trim().length === 0}
              data-testid="chat-send"
            >
              {copy.rooms.chat.send}
            </PopButton>
          </form>
        </PopCard>
      ) : null}

      <PopButton
        type="button"
        variant="secondary"
        data-testid="chat-toggle"
        aria-pressed={chatOpen}
        onClick={() => setChatOpen(!chatOpen)}
      >
        <IconChat className="h-5 w-5" />
        {unreadChat > 0 ? (
          <span
            className="flex h-5 min-w-5 items-center justify-center rounded-full border-3 border-ink bg-undercover px-1 font-ui text-xs font-bold text-white"
            aria-hidden="true"
          >
            {unreadChat}
          </span>
        ) : null}
        <span className="sr-only">
          {unreadChat > 0 ? `${unreadChat}` : ''}
        </span>
      </PopButton>
    </div>
  );
}
