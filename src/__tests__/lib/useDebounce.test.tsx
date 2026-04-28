/**
 * useDebounce / useDebouncedValue — unit tests.
 *
 * src/lib/useDebounce.ts has 0% coverage before this file. We use
 * @testing-library/react's renderHook with vitest fake timers to exercise:
 *   - debounced callback only fires after delay of inactivity
 *   - rapid calls coalesce into a single invocation
 *   - debounced VALUE updates only after the value stops changing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebounce, useDebouncedValue } from '@/lib/useDebounce';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebounce', () => {
  it('does not invoke callback before delay elapses', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useDebounce(cb, 200));
    act(() => {
      result.current('hello');
    });
    // Just before delay
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it('invokes callback once after delay', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useDebounce(cb, 200));
    act(() => {
      result.current('hello');
      vi.advanceTimersByTime(200);
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('hello');
  });

  it('coalesces rapid calls into a single invocation with the latest args', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useDebounce(cb, 200));
    act(() => {
      result.current('first');
      vi.advanceTimersByTime(100);
      result.current('second');
      vi.advanceTimersByTime(100);
      result.current('third');
      vi.advanceTimersByTime(200);
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('third');
  });
});

describe('useDebouncedValue', () => {
  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 200));
    expect(result.current).toBe('a');
  });

  it('updates the debounced value only after delay', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 200), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'b' });
    expect(result.current).toBe('a');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('b');
  });

  it('cancels in-flight timer when value keeps changing rapidly', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 200), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'b' });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    rerender({ v: 'c' });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    // Total elapsed since 'c': 150ms — still under delay → still 'a' (or last committed).
    expect(result.current).toBe('a');
    act(() => {
      vi.advanceTimersByTime(50); // Now 200ms since c was set
    });
    expect(result.current).toBe('c');
  });
});
