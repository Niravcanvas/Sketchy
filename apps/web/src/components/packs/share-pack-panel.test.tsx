import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Pack } from '@sketchy/shared/contract/packs';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { SharePackPanel } from './share-pack-panel';

vi.mock('@/lib/api-client', () => ({ apiClient: { patchPack: vi.fn() } }));

const patchPackMock = vi.mocked(apiClient.patchPack);

const privatePack: Pack = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  slug: null,
  name: 'Inside Jokes',
  description: '',
  category: 'custom',
  language: 'en',
  isOfficial: false,
  ownerId: '223e4567-e89b-12d3-a456-426614174000',
  visibility: 'private',
  reviewStatus: 'pending',
  shareCode: null,
  coverUrl: null,
  pairCount: 12,
  createdAt: Date.now(),
};

describe('SharePackPanel make-public control', () => {
  it('offers both Share and Make public on a private pack', () => {
    render(<SharePackPanel pack={privatePack} onShared={vi.fn()} />);
    expect(screen.getByText(copy.packs.sharing.shareButton)).toBeTruthy();
    expect(screen.getByText(copy.packs.sharing.makePublicButton)).toBeTruthy();
  });

  it('patches visibility to public after the confirm dialog and reports the updated pack', async () => {
    const updated: Pack = { ...privatePack, visibility: 'public', reviewStatus: 'approved' };
    patchPackMock.mockResolvedValue({ pack: updated });
    const onShared = vi.fn();

    render(<SharePackPanel pack={privatePack} onShared={onShared} />);
    fireEvent.click(screen.getByText(copy.packs.sharing.makePublicButton));
    // The confirm dialog explains the immediate, catalog-wide effect.
    expect(screen.getByText(copy.packs.sharing.makePublicConfirm.description)).toBeTruthy();
    fireEvent.click(screen.getByText(copy.packs.sharing.makePublicConfirm.confirm));

    await waitFor(() =>
      expect(patchPackMock).toHaveBeenCalledWith(privatePack.id, { visibility: 'public' }),
    );
    await waitFor(() => expect(onShared).toHaveBeenCalledWith(updated));
  });

  it('shows the live public state (not the make-public button) once a pack is public', () => {
    render(
      <SharePackPanel
        pack={{ ...privatePack, visibility: 'public', reviewStatus: 'approved' }}
        onShared={vi.fn()}
      />,
    );
    expect(screen.getByText(copy.packs.review.publicBadge)).toBeTruthy();
    expect(screen.queryByText(copy.packs.sharing.makePublicButton)).toBeNull();
  });
});
