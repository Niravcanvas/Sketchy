import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Pack } from '@sketchy/shared/contract/packs';
import { copy } from '@/copy';
import { PackCard } from './pack-card';

const basePack: Pack = {
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

describe('PackCard public badge', () => {
  it('shows the Public badge on a public pack', () => {
    render(<PackCard pack={{ ...basePack, visibility: 'public', reviewStatus: 'approved' }} />);
    expect(screen.getByText(copy.packs.review.publicBadge)).toBeTruthy();
  });

  it('hides the badge on a private pack', () => {
    render(<PackCard pack={{ ...basePack, visibility: 'private', reviewStatus: 'pending' }} />);
    expect(screen.queryByText(copy.packs.review.publicBadge)).toBeNull();
  });

  it('hides the badge on an unlisted pack', () => {
    render(<PackCard pack={{ ...basePack, visibility: 'unlisted', reviewStatus: 'pending' }} />);
    expect(screen.queryByText(copy.packs.review.publicBadge)).toBeNull();
  });
});
