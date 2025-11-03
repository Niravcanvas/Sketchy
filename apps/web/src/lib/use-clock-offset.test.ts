import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomStore } from '@/stores/room-store';
import { useCountdown } from './use-clock-offset';

describe('useCountdown', () => {
  beforeEach(() => {
    useRoomStore.getState().reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when endsAt is null (untimed phase/preset) and never starts ticking', () => {
    const { result } = renderHook(() => useCountdown(null));
    expect(result.current).toBeNull();
  });

  it('returns whole seconds remaining when the clock offset is 0', () => {
    vi.setSystemTime(0);
    useRoomStore.getState().setClockOffsetMs(0);

    const { result } = renderHook(() => useCountdown(10_000));
    expect(result.current).toBe(10);
  });

  it('corrects for a measured clock offset (api-contract.md §2.3 rule 3)', () => {
    vi.setSystemTime(0);
    // Server clock reads 2s ahead of ours: remaining = 10000 - (0 + 2000) = 8000ms.
    useRoomStore.getState().setClockOffsetMs(2000);

    const { result } = renderHook(() => useCountdown(10_000));
    expect(result.current).toBe(8);
  });

  it('clamps at 0 and never goes negative once the deadline has passed', () => {
    vi.setSystemTime(20_000);
    useRoomStore.getState().setClockOffsetMs(0);

    const { result } = renderHook(() => useCountdown(10_000));
    expect(result.current).toBe(0);
  });

  it('ticks down over time on its 250ms interval', () => {
    vi.setSystemTime(0);
    useRoomStore.getState().setClockOffsetMs(0);

    const { result } = renderHook(() => useCountdown(3000));
    expect(result.current).toBe(3);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(2);
  });

  it('stops ticking once endsAt becomes null', () => {
    vi.setSystemTime(0);
    useRoomStore.getState().setClockOffsetMs(0);

    const { result, rerender } = renderHook(({ endsAt }) => useCountdown(endsAt), {
      initialProps: { endsAt: 3000 as number | null },
    });
    expect(result.current).toBe(3);

    rerender({ endsAt: null });
    expect(result.current).toBeNull();

    // No stray interval left running to throw/update after unmount-adjacent state.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBeNull();
  });
});
