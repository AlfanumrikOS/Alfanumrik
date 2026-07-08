'use client';

import { useEffect } from 'react';

/* ═══════════════════════════════════════════════════════════════
   useScrollLock — shared overlay foundation (Phase 2 Batch B2)

   Locks <body> scroll while any overlay is open. Reference-counted
   at module scope so that stacking or nesting overlays (e.g. a
   Tooltip inside a Dialog, or a ConfirmDialog opened over a Drawer)
   never unlocks the page early — the body only unlocks once the
   LAST active overlay releases. Restores the exact prior inline
   values on final release so we never clobber page-author styles.
   ═══════════════════════════════════════════════════════════════ */

let lockCount = 0;
let restore: { overflow: string; paddingRight: string } | null = null;

function acquire() {
  if (typeof document === 'undefined') return;
  if (lockCount === 0) {
    const { body } = document;
    // Compensate for the disappearing scrollbar so layout doesn't jump.
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
    restore = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    body.style.overflow = 'hidden';
    if (scrollbarW > 0) {
      const current = parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${current + scrollbarW}px`;
    }
  }
  lockCount += 1;
}

function release() {
  if (typeof document === 'undefined') return;
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0 && restore) {
    document.body.style.overflow = restore.overflow;
    document.body.style.paddingRight = restore.paddingRight;
    restore = null;
  }
}

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    acquire();
    return release;
  }, [active]);
}
