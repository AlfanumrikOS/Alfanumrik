'use client';

import { useEffect, useRef, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════
   usePresence — shared overlay foundation (Phase 2 Batch B2)

   Drives enter/exit transitions for portalled overlays from a single
   `open` boolean:
     - mounted  → whether to render at all (stays true through the exit
                  transition, then flips false so the node unmounts)
     - visible  → the "open" visual state; flip transform/opacity on it

   On open: mount immediately, then flip `visible` true on the next
   frame so the browser transitions from the closed styles.
   On close: flip `visible` false (plays the exit transition), then
   unmount after `durationMs`.

   Respects prefers-reduced-motion: when reduced, transitions are
   instant, so we unmount on the same tick instead of waiting.
   ═══════════════════════════════════════════════════════════════ */

export interface UsePresenceResult {
  mounted: boolean;
  visible: boolean;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function usePresence(open: boolean, durationMs = 220): UsePresenceResult {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const reduced = prefersReducedMotion();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);

    if (open) {
      setMounted(true);
      if (reduced) {
        setVisible(true);
      } else {
        // Two frames: one to commit the closed styles, one to flip to open.
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = requestAnimationFrame(() => setVisible(true));
        });
      }
    } else {
      setVisible(false);
      if (reduced) {
        setMounted(false);
      } else {
        timerRef.current = setTimeout(() => setMounted(false), durationMs);
      }
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [open, durationMs]);

  return { mounted, visible };
}
