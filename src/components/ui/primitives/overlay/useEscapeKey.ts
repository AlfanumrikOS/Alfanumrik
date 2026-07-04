'use client';

import { useEffect } from 'react';
import { isTopOverlay } from './overlayStack';

/* ═══════════════════════════════════════════════════════════════
   useEscapeKey — shared overlay foundation (Phase 2 Batch B2)

   Calls `onEscape` when Escape is pressed while `active`. Registered
   on the capture phase. Because `e.stopPropagation()` does NOT stop
   other capture listeners bound to the SAME target (document), a raw
   handler would fire on every open overlay at once. So when an
   `overlayId` is supplied, the handler acts ONLY when that overlay is
   the frontmost entry on the shared overlay stack — stacked overlays
   therefore close top-first, one Escape at a time.
   ═══════════════════════════════════════════════════════════════ */

export function useEscapeKey(
  active: boolean,
  onEscape: (() => void) | undefined,
  overlayId?: string,
): void {
  useEffect(() => {
    if (!active || !onEscape) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Only the frontmost overlay reacts (registry-gated).
      if (overlayId && !isTopOverlay(overlayId)) return;
      e.stopPropagation();
      onEscape?.();
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [active, onEscape, overlayId]);
}
