'use client';

import { useEffect, type RefObject } from 'react';
import { isTopOverlay } from './overlayStack';

/* ═══════════════════════════════════════════════════════════════
   useFocusTrap — shared overlay foundation (Phase 2 Batch B2)

   While `active`, keyboard focus is trapped inside `containerRef`:
     - On open, focus moves to `initialFocusRef` (if given and still
       in the DOM) otherwise the first focusable descendant, otherwise
       the container itself (which callers make programmatically
       focusable via tabIndex={-1}).
     - Tab / Shift+Tab wrap around the focusable set instead of
       escaping to the page behind the scrim.
     - On close/unmount, focus is RESTORED to whatever element was
       focused when the trap engaged (typically the trigger button),
       so keyboard users are never dumped at the top of the page.

   Implemented from scratch — no focus-trap library (Batch B2 rule 4).
   ═══════════════════════════════════════════════════════════════ */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      // offsetParent is null for display:none; allow position:fixed via rects.
      (el.offsetParent !== null || el.getClientRects().length > 0),
  );
}

export interface UseFocusTrapOptions {
  /** Element to focus first when the trap engages. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Set false to keep focus where it is on open (rare). Default true. */
  autoFocus?: boolean;
  /** Set false to skip restoring focus to the trigger on close. Default true. */
  restoreFocus?: boolean;
  /**
   * Overlay-stack id. When supplied, Tab is trapped only while this
   * overlay is the frontmost one — so a stacked overlay beneath the
   * top one does not fight it for keyboard focus.
   */
  overlayId?: string;
}

export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  { initialFocusRef, autoFocus = true, restoreFocus = true, overlayId }: UseFocusTrapOptions = {},
): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

    // Focus the requested / first focusable element on open.
    if (autoFocus) {
      const target =
        initialFocusRef?.current ??
        getFocusable(container)[0] ??
        container;
      // Defer to allow enter transition / portal paint to settle.
      requestAnimationFrame(() => target?.focus?.());
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      // Only the frontmost overlay traps Tab (registry-gated).
      if (overlayId && !isTopOverlay(overlayId)) return;
      const node = containerRef.current;
      if (!node) return;
      const focusable = getFocusable(node);
      if (focusable.length === 0) {
        // Nothing to tab to — keep focus on the container.
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (activeEl === first || !node.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !node.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (restoreFocus && previouslyFocused && typeof previouslyFocused.focus === 'function') {
        // Restore after unmount paint so the trigger is back in the layout.
        requestAnimationFrame(() => previouslyFocused.focus());
      }
    };
    // initialFocusRef is a stable ref object; intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, containerRef, autoFocus, restoreFocus, overlayId]);
}
