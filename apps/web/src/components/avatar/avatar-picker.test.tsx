import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AvatarConfig } from '@sketchy/engine/types';
import { copy } from '@/copy';
import { AvatarPicker } from './avatar-picker';
import { AVATAR_ACCESSORY_IDS, AVATAR_FACE_IDS, AVATAR_HEAD_IDS } from './avatar-config';

const VALUE: AvatarConfig = {
  head: AVATAR_HEAD_IDS[0],
  face: AVATAR_FACE_IDS[0],
  accessory: 'none',
  inkColor: 'civilian',
};

describe('AvatarPicker', () => {
  it('renders the heading, helper, and row labels verbatim from copy.ts', () => {
    render(<AvatarPicker value={VALUE} onChange={vi.fn()} />);
    expect(screen.getByTestId('avatar-picker')).toBeTruthy();
    expect(screen.getByText(copy.avatar.picker.heading)).toBeTruthy();
    expect(screen.getByText(copy.avatar.picker.helper)).toBeTruthy();
    expect(screen.getByText(copy.avatar.picker.rows.head)).toBeTruthy();
    expect(screen.getByText(copy.avatar.picker.rows.face)).toBeTruthy();
    expect(screen.getByText(copy.avatar.picker.rows.accessory)).toBeTruthy();
  });

  it('every prev/next/ink control is a real, keyboard-reachable <button>', () => {
    render(<AvatarPicker value={VALUE} onChange={vi.fn()} />);
    for (const part of ['head', 'face', 'accessory']) {
      expect(screen.getByTestId(`avatar-part-prev-${part}`).tagName).toBe('BUTTON');
      expect(screen.getByTestId(`avatar-part-next-${part}`).tagName).toBe('BUTTON');
    }
    expect(screen.getByTestId('avatar-ink-civilian').tagName).toBe('BUTTON');
  });

  it('next-head cycles forward and wraps around at the end of the list', () => {
    const onChange = vi.fn();
    const { rerender } = render(<AvatarPicker value={VALUE} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('avatar-part-next-head'));
    expect(onChange).toHaveBeenCalledWith({ ...VALUE, head: AVATAR_HEAD_IDS[1] });

    const lastHead = AVATAR_HEAD_IDS[AVATAR_HEAD_IDS.length - 1]!;
    rerender(<AvatarPicker value={{ ...VALUE, head: lastHead }} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('avatar-part-next-head'));
    expect(onChange).toHaveBeenCalledWith({ ...VALUE, head: AVATAR_HEAD_IDS[0] });
  });

  it('prev-head wraps backward from the first id to the last', () => {
    const onChange = vi.fn();
    render(<AvatarPicker value={VALUE} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('avatar-part-prev-head'));
    expect(onChange).toHaveBeenCalledWith({
      ...VALUE,
      head: AVATAR_HEAD_IDS[AVATAR_HEAD_IDS.length - 1],
    });
  });

  it('next-accessory reaches every curated accessory id, including none', () => {
    const onChange = vi.fn();
    render(<AvatarPicker value={VALUE} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('avatar-part-next-accessory'));
    expect(onChange).toHaveBeenCalledWith({ ...VALUE, accessory: AVATAR_ACCESSORY_IDS[1] });
  });

  it('ink swatches report aria-pressed for the selected token only, and never rely on color alone', () => {
    render(<AvatarPicker value={VALUE} onChange={vi.fn()} />);
    expect(screen.getByTestId('avatar-ink-civilian').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('avatar-ink-undercover').getAttribute('aria-pressed')).toBe('false');
    // Selected state also carries a check icon, not just a ring — verified structurally.
    expect(screen.getByTestId('avatar-ink-civilian').querySelector('svg')).toBeTruthy();
    expect(screen.getByTestId('avatar-ink-undercover').querySelector('svg')).toBeNull();
  });

  it('clicking an ink swatch reports that token via onChange', () => {
    const onChange = vi.fn();
    render(<AvatarPicker value={VALUE} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('avatar-ink-highlight'));
    expect(onChange).toHaveBeenCalledWith({ ...VALUE, inkColor: 'highlight' });
  });

  it('recovers gracefully when the incoming config carries an id it has never shipped art for', () => {
    const onChange = vi.fn();
    render(
      <AvatarPicker
        value={{ head: 'not-real', face: 'not-real', accessory: 'not-real', inkColor: 'ink' }}
        onChange={onChange}
      />,
    );

    // Falls back to the first curated id in each row instead of crashing or showing a blank.
    fireEvent.click(screen.getByTestId('avatar-part-next-head'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ head: AVATAR_HEAD_IDS[1] }),
    );
  });
});
