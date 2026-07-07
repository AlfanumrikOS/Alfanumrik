'use client';

import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@alfanumrik/lib/utils';

/* ═══════════════════════════════════════════════════════════════
   Scrim — shared overlay foundation (Phase 2 Batch B2)

   The dimming backdrop rendered BEHIND an overlay's content. Fully
   token-driven: the veil colour is var(--scrim) (declared in the
   token layer, warm-ink in light / near-black in dark). It is
   decorative (aria-hidden) — the content layer above it owns the
   dialog semantics. Click-to-dismiss is opt-in via `onClick`.

   Layering is by DOM ORDER, not z-index: the Scrim is the FIRST child
   of the overlay's single portalled stacking-context container and the
   panel comes AFTER it, so the panel always paints on top and is never
   dimmed-over or click-blocked. (An earlier version pinned the Scrim to
   var(--z-overlay)=90 while the panel sat at var(--z-modal)=60 — the
   opaque scrim then painted OVER the panel and, lacking pointer-events
   handling, swallowed every click. Fixed structurally in Batch B2.)
   It fills its positioned parent via `absolute inset-0`.

   Fade honours prefers-reduced-motion: `visible` toggles opacity
   with a colour transition that motion-reduce collapses to none.
   ═══════════════════════════════════════════════════════════════ */

export interface ScrimProps extends HTMLAttributes<HTMLDivElement> {
  /** Open-state opacity flag driven by usePresence. */
  visible?: boolean;
  /** Adds a frosted blur behind the scrim (premium surfaces). */
  blur?: boolean;
}

export const Scrim = forwardRef<HTMLDivElement, ScrimProps>(function Scrim(
  { visible = true, blur = false, className, style, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn(
        'absolute inset-0',
        'transition-opacity duration-200 ease-out motion-reduce:transition-none',
        blur && 'backdrop-blur-sm',
        visible ? 'opacity-100' : 'opacity-0',
        className,
      )}
      style={{ backgroundColor: 'var(--scrim)', ...style }}
      {...props}
    />
  );
});
