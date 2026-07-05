'use client';

import { useEffect } from 'react';

/* ═══════════════════════════════════════════════════════════════
   overlayStack — shared overlay foundation (Phase 2 Batch B2)

   A module-level registry of the currently-open modal overlays, in
   open order. The LAST id is the frontmost (top) overlay.

   Capture-phase document listeners fire on EVERY open overlay, and
   `e.stopPropagation()` does NOT stop sibling listeners on the same
   target — so two stacked overlays would each act on one Escape / Tab.
   To make behaviour frontmost-only, each overlay pushes an id while
   active and its Escape / focus-trap handlers consult `isTopOverlay`
   before acting. Only the top overlay closes on Escape; only the top
   overlay traps Tab. This also makes the ref-counted scroll-lock's
   stacking scenario behave correctly.
   ═══════════════════════════════════════════════════════════════ */

let stack: string[] = [];

export function pushOverlay(id: string): void {
  // Guard against duplicate pushes (e.g. StrictMode double-invoke).
  if (!stack.includes(id)) stack.push(id);
}

export function removeOverlay(id: string): void {
  stack = stack.filter((entry) => entry !== id);
}

export function isTopOverlay(id: string): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}

/**
 * Registers `id` on the overlay stack while `active`, popping it on
 * deactivation / unmount. Wire this in every modal overlay so its
 * Escape + focus-trap handlers can gate on `isTopOverlay(id)`.
 */
export function useOverlayStack(active: boolean, id: string): void {
  useEffect(() => {
    if (!active) return;
    pushOverlay(id);
    return () => removeOverlay(id);
  }, [active, id]);
}
