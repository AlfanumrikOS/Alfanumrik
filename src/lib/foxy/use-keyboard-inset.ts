/**
 * useKeyboardInset — keyboard-aware composer support for the Foxy OS mobile
 * redesign (ff_foxy_os_v1, <lg only). Phase 2 of the redesign.
 *
 * THE PROBLEM IT SOLVES
 * The Foxy shell is viewport-locked: `.foxy-shell { height:100dvh }` plus
 * `html:has(.foxy-shell)/body { overflow:hidden; position:fixed }`. `dvh`
 * does NOT shrink when the soft keyboard opens, so the keyboard overlays the
 * composer / send button and the latest message is hidden behind it.
 *
 * THE FIX
 * `window.visualViewport` reports the *visible* viewport (the area NOT covered
 * by the keyboard). On its `resize`/`scroll` events we compute the keyboard
 * inset and publish it as a CSS custom property `--kb-inset` (in px) on a
 * target element (defaults to `document.documentElement`). CSS under `.foxy-os`
 * then reads `--kb-inset` to lift the composer above the keyboard and let the
 * message thread shrink. The write is rAF-throttled so rapid resize bursts
 * never thrash layout.
 *
 * GRACEFUL FALLBACK
 * If `window.visualViewport` is undefined (older Android WebView), the hook is
 * a no-op: `--kb-inset` stays `0px`, so the composer keeps its current
 * safe-area padding and behavior is byte-identical to today (no regression).
 *
 * SCOPE / SAFETY
 * - SSR-safe (guards `typeof window`).
 * - Must only be active on the flag-ON mobile path — gate the call site with
 *   `useFoxyOsHeader` (`enabled` prop). When `enabled` is false the hook does
 *   nothing and resets `--kb-inset` to `0px`, so the OFF path and desktop are
 *   untouched.
 * - No PII, no logging, no network.
 */

import { useEffect, useState } from 'react';

const KB_INSET_PROP = '--kb-inset';

export interface UseKeyboardInsetOptions {
  /**
   * When false (default flips per call site), the hook is inert and keeps
   * `--kb-inset` at `0px`. Wire this to `useFoxyOsHeader` so the OFF path and
   * every >=lg viewport never observe the keyboard.
   */
  enabled?: boolean;
  /**
   * Element to receive the `--kb-inset` custom property. Defaults to
   * `document.documentElement` (`:root`) so a single global rule can read it.
   */
  target?: HTMLElement | null;
}

/**
 * Publishes the soft-keyboard inset to `--kb-inset` (px) on the target element.
 * Returns `keyboardOpen` (true when the inset exceeds a small threshold) for
 * call sites that want to re-fire scroll-to-bottom when the keyboard appears.
 */
export function useKeyboardInset(options: UseKeyboardInsetOptions = {}): boolean {
  const { enabled = true, target } = options;
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const root: HTMLElement | null = target ?? document.documentElement;
    if (!root) return;

    const reset = () => {
      root.style.setProperty(KB_INSET_PROP, '0px');
      setKeyboardOpen(false);
    };

    // Disabled (OFF path / desktop) — ensure the property is neutral and bail.
    if (!enabled) {
      reset();
      return reset;
    }

    const vv = window.visualViewport;
    // Graceful fallback: no VisualViewport API → no-op, --kb-inset stays 0px.
    if (!vv) {
      reset();
      return reset;
    }

    let rafId: number | null = null;

    const compute = () => {
      rafId = null;
      // Inset = portion of the layout viewport hidden below the visual
      // viewport. `offsetTop` accounts for any pinch-zoom / shifted viewport.
      const inset = Math.max(
        0,
        window.innerHeight - vv.height - vv.offsetTop,
      );
      // Round to whole px to avoid sub-pixel churn re-painting every frame.
      const px = Math.round(inset);
      root.style.setProperty(KB_INSET_PROP, `${px}px`);
      // Threshold guards against address-bar/toolbar jitter (a few px) being
      // mistaken for the keyboard.
      setKeyboardOpen(px > 80);
    };

    const onChange = () => {
      if (rafId !== null) return; // rAF-throttle: coalesce bursts to one write.
      rafId = window.requestAnimationFrame(compute);
    };

    // Seed once so the property is defined immediately.
    compute();

    vv.addEventListener('resize', onChange);
    vv.addEventListener('scroll', onChange);

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      vv.removeEventListener('resize', onChange);
      vv.removeEventListener('scroll', onChange);
      // Reset on unmount so a later OFF render never inherits a stale inset.
      reset();
    };
  }, [enabled, target]);

  return keyboardOpen;
}
