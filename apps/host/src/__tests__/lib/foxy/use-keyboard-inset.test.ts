/**
 * useKeyboardInset — soft-keyboard inset publisher for the Foxy OS mobile
 * redesign (ff_foxy_os_v1, <lg only, Phase 2).
 *
 * The hook is a thin, side-effecting bridge between `window.visualViewport` and
 * a CSS custom property `--kb-inset` (px) on a target element. Its safety
 * contract is what we pin here:
 *
 *   1. DISABLED (enabled:false) → fully inert: attaches NO visualViewport
 *      listeners, leaves `--kb-inset` at `0px`, returns keyboardOpen=false.
 *   2. ENABLED + keyboard open (visualViewport.height < innerHeight) →
 *      `--kb-inset` === Math.round(Math.max(0, innerHeight - vv.height -
 *      vv.offsetTop)) and keyboardOpen flips true once the inset clears the
 *      ~80px threshold.
 *   3. NO visualViewport (older Android WebView) → graceful no-op: `--kb-inset`
 *      stays `0px`, no throw, no listeners.
 *   4. UNMOUNT → resets `--kb-inset` to `0px` and removes both listeners.
 *
 * The hook rAF-throttles its writes, so we install a synchronous
 * requestAnimationFrame stub (invoke immediately) to make the publish
 * observable within the test tick. We always pass an explicit `target` element
 * so assertions never depend on document.documentElement global state.
 *
 * Owning agent: testing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useKeyboardInset } from '@alfanumrik/lib/foxy/use-keyboard-inset';

const KB_INSET_PROP = '--kb-inset';

/**
 * Minimal VisualViewport stub. Tracks listeners so we can both dispatch
 * resize/scroll and assert add/remove balance.
 */
interface FakeVisualViewport {
  height: number;
  offsetTop: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  _fire: (type: 'resize' | 'scroll') => void;
}

function makeVisualViewport(height: number, offsetTop = 0): FakeVisualViewport {
  const listeners: Record<string, Array<() => void>> = { resize: [], scroll: [] };
  return {
    height,
    offsetTop,
    addEventListener: vi.fn((type: string, cb: () => void) => {
      (listeners[type] ||= []).push(cb);
    }),
    removeEventListener: vi.fn((type: string, cb: () => void) => {
      listeners[type] = (listeners[type] || []).filter((fn) => fn !== cb);
    }),
    _fire(type: 'resize' | 'scroll') {
      for (const cb of listeners[type] || []) cb();
    },
  };
}

const INNER_HEIGHT = 800;

let originalVisualViewport: PropertyDescriptor | undefined;
let originalInnerHeight: number;
let target: HTMLElement;

beforeEach(() => {
  // Synchronous rAF so the rAF-throttled compute() publishes within the tick.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});

  originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  originalInnerHeight = window.innerHeight;
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: INNER_HEIGHT,
  });

  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalVisualViewport) {
    Object.defineProperty(window, 'visualViewport', originalVisualViewport);
  } else {
    // jsdom may not define it natively; remove the stub we set per-test.
    delete (window as unknown as { visualViewport?: unknown }).visualViewport;
  }
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: originalInnerHeight,
  });
  target.remove();
});

function setVisualViewport(vv: FakeVisualViewport | undefined) {
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    writable: true,
    value: vv,
  });
}

describe('useKeyboardInset — disabled (enabled:false)', () => {
  it('is inert: no listeners, --kb-inset stays 0px, keyboardOpen false', () => {
    // A keyboard IS open in the environment, but enabled:false must ignore it.
    const vv = makeVisualViewport(/* height */ 500);
    setVisualViewport(vv);

    const { result } = renderHook(() =>
      useKeyboardInset({ enabled: false, target }),
    );

    expect(target.style.getPropertyValue(KB_INSET_PROP)).toBe('0px');
    expect(result.current).toBe(false);
    // Inert: never subscribes to visualViewport.
    expect(vv.addEventListener).not.toHaveBeenCalled();
  });
});

describe('useKeyboardInset — enabled + keyboard open', () => {
  it('publishes the inset and flips keyboardOpen past the threshold', () => {
    // innerHeight 800, vv.height 500, offsetTop 0 → inset 300 (> 80 threshold).
    const vv = makeVisualViewport(/* height */ 500, /* offsetTop */ 0);
    setVisualViewport(vv);

    const { result } = renderHook(() =>
      useKeyboardInset({ enabled: true, target }),
    );

    const expected = Math.round(
      Math.max(0, INNER_HEIGHT - vv.height - vv.offsetTop),
    );
    expect(expected).toBe(300);
    // Seeded on mount via compute().
    expect(target.style.getPropertyValue(KB_INSET_PROP)).toBe(`${expected}px`);
    expect(result.current).toBe(true);

    // Subscribes to both resize and scroll.
    expect(vv.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(vv.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it('honours offsetTop in the inset formula and recomputes on resize', () => {
    // height 600, offsetTop 40 → inset = 800 - 600 - 40 = 160 (> 80).
    const vv = makeVisualViewport(/* height */ 600, /* offsetTop */ 40);
    setVisualViewport(vv);

    const { result } = renderHook(() =>
      useKeyboardInset({ enabled: true, target }),
    );

    expect(target.style.getPropertyValue(KB_INSET_PROP)).toBe('160px');
    expect(result.current).toBe(true);

    // Keyboard dismissed → visual viewport returns to full height; resize fires.
    act(() => {
      vv.height = INNER_HEIGHT;
      vv.offsetTop = 0;
      vv._fire('resize');
    });

    // inset 0 → clamped, keyboardOpen back to false.
    expect(target.style.getPropertyValue(KB_INSET_PROP)).toBe('0px');
    expect(result.current).toBe(false);
  });

  it('keeps keyboardOpen false when the inset is at or below the threshold', () => {
    // height 740, offsetTop 0 → inset 60, below the ~80px threshold.
    const vv = makeVisualViewport(/* height */ 740, /* offsetTop */ 0);
    setVisualViewport(vv);

    const { result } = renderHook(() =>
      useKeyboardInset({ enabled: true, target }),
    );

    expect(target.style.getPropertyValue(KB_INSET_PROP)).toBe('60px');
    expect(result.current).toBe(false);
  });
});

describe('useKeyboardInset — no visualViewport (fallback)', () => {
  it('is a graceful no-op: --kb-inset 0px, no throw', () => {
    setVisualViewport(undefined);

    let result: { current: boolean } | undefined;
    expect(() => {
      ({ result } = renderHook(() => useKeyboardInset({ enabled: true, target })));
    }).not.toThrow();

    expect(target.style.getPropertyValue(KB_INSET_PROP)).toBe('0px');
    expect(result?.current).toBe(false);
  });
});

describe('useKeyboardInset — cleanup on unmount', () => {
  it('resets --kb-inset to 0px and removes both listeners', () => {
    const vv = makeVisualViewport(/* height */ 500, /* offsetTop */ 0);
    setVisualViewport(vv);

    const { unmount } = renderHook(() =>
      useKeyboardInset({ enabled: true, target }),
    );

    // Active: inset published, listeners attached.
    expect(target.style.getPropertyValue(KB_INSET_PROP)).toBe('300px');
    expect(vv.addEventListener).toHaveBeenCalledTimes(2);

    act(() => {
      unmount();
    });

    expect(target.style.getPropertyValue(KB_INSET_PROP)).toBe('0px');
    expect(vv.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(vv.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(vv.removeEventListener).toHaveBeenCalledTimes(2);
  });
});
