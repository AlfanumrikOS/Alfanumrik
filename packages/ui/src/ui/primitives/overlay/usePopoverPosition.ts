'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type RefObject,
} from 'react';

/* ═══════════════════════════════════════════════════════════════
   usePopoverPosition — shared overlay foundation

   Computes fixed-viewport coordinates for a floating panel anchored
   to a trigger element, with FLIP (swap to the opposite side when the
   preferred one has no room) and CLAMP (never let the panel leave the
   viewport padding box). No positioning library — hand-rolled, per the
   bundle budget (P10).

   DEDUP NOTE — Tooltip.tsx contains a near-identical `reposition()`
   (side flip + cross-axis clamp) inlined in the component. It is
   deliberately NOT refactored onto this hook: Tooltip is shipped and
   the regression risk of rewriting its positioning outweighs the
   duplication. If Tooltip's positioning is ever touched for another
   reason, fold it onto this hook then — the semantics already match
   (same GAP/PAD defaults, same flip-then-clamp order). Tooltip's
   `TooltipSide` ('top'|'bottom'|'left'|'right') is the side half of
   this module's `PopoverPlacement`.

   JSDOM CONTRACT: `getBoundingClientRect()` returns all zeros and
   `offsetWidth/offsetHeight` are 0 under JSDOM. Every branch below is
   pure arithmetic on those numbers, so a zero-rect yields real finite
   coordinates (the viewport-padding corner) rather than NaN, null, or
   a thrown error. Callers must therefore NEVER gate rendering or
   visibility on a non-zero measurement — `coords` is non-null as soon
   as both refs are attached, in every environment. `measured` reports
   whether the panel reported a real size, for callers that want to
   know; it is informational only.
   ═══════════════════════════════════════════════════════════════ */

/** Side the panel sits on, plus how it aligns on the cross axis. */
export type PopoverPlacement =
  | 'top-start'
  | 'top-end'
  | 'bottom-start'
  | 'bottom-end'
  | 'left-start'
  | 'left-end'
  | 'right-start'
  | 'right-end';

type PopoverSide = 'top' | 'bottom' | 'left' | 'right';
type PopoverAlign = 'start' | 'end';

/** px between the anchor edge and the panel. Matches Tooltip's GAP. */
const DEFAULT_GAP = 8;
/** px viewport inset the panel stays clear of. Matches Tooltip's PAD. */
const DEFAULT_VIEWPORT_PADDING = 8;

const OPPOSITE: Record<PopoverSide, PopoverSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

function splitPlacement(placement: PopoverPlacement): [PopoverSide, PopoverAlign] {
  const dash = placement.indexOf('-');
  return [
    placement.slice(0, dash) as PopoverSide,
    placement.slice(dash + 1) as PopoverAlign,
  ];
}

function clamp(value: number, min: number, max: number): number {
  // `max < min` happens when the panel is larger than the viewport; the
  // padding edge wins so the panel is at least anchored on-screen.
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export interface PopoverCoords {
  top: number;
  left: number;
}

export interface UsePopoverPositionOptions {
  /** Preferred placement; flips to the opposite side if it would overflow. */
  placement?: PopoverPlacement;
  /** px between anchor and panel. Default 8. */
  gap?: number;
  /** px viewport inset the panel stays clear of. Default 8. */
  viewportPadding?: number;
  /**
   * Only measure/listen while true (i.e. while the panel is mounted).
   * When false, `coords` resets to null and listeners are detached.
   */
  enabled?: boolean;
}

export interface UsePopoverPositionResult {
  /** Fixed-position coordinates, or null before the first measurement. */
  coords: PopoverCoords | null;
  /** The placement actually used after flipping. */
  placement: PopoverPlacement;
  /** True when the panel reported a non-zero box (false under JSDOM). */
  measured: boolean;
  /** Force a recompute (e.g. after the item list changes). */
  update: () => void;
}

/**
 * `useLayoutEffect` warns when a client component is server-rendered.
 * Picking the hook once at module scope (never per render) keeps the
 * rules-of-hooks contract while staying silent during SSR.
 */
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function usePopoverPosition(
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  {
    placement = 'bottom-start',
    gap = DEFAULT_GAP,
    viewportPadding = DEFAULT_VIEWPORT_PADDING,
    enabled = true,
  }: UsePopoverPositionOptions = {},
): UsePopoverPositionResult {
  const [coords, setCoords] = useState<PopoverCoords | null>(null);
  const [resolved, setResolved] = useState<PopoverPlacement>(placement);
  const [measured, setMeasured] = useState(false);

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;

    const rect = anchor.getBoundingClientRect();
    // offsetWidth/Height ignore CSS transforms (the enter animation scales
    // the panel), so the measurement stays stable across the transition.
    const w = floating.offsetWidth;
    const h = floating.offsetHeight;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0;

    let [side, align] = splitPlacement(placement);

    // ── Flip: only when the preferred side lacks room AND the opposite
    //    side has it. Otherwise keep the preference and let clamping cope.
    const need = side === 'top' || side === 'bottom' ? h + gap : w + gap;
    const room: Record<PopoverSide, number> = {
      top: rect.top - viewportPadding,
      bottom: vh - rect.bottom - viewportPadding,
      left: rect.left - viewportPadding,
      right: vw - rect.right - viewportPadding,
    };
    if (room[side] < need && room[OPPOSITE[side]] >= need) {
      side = OPPOSITE[side];
    }

    // ── Main axis: sit outside the anchor edge, `gap` away.
    let top = 0;
    let left = 0;
    switch (side) {
      case 'top':
        top = rect.top - h - gap;
        break;
      case 'bottom':
        top = rect.bottom + gap;
        break;
      case 'left':
        left = rect.left - w - gap;
        break;
      case 'right':
        left = rect.right + gap;
        break;
    }

    // ── Cross axis: 'start' aligns leading edges, 'end' aligns trailing.
    if (side === 'top' || side === 'bottom') {
      left = align === 'start' ? rect.left : rect.right - w;
    } else {
      top = align === 'start' ? rect.top : rect.bottom - h;
    }

    // ── Clamp inside the viewport padding box on BOTH axes.
    left = clamp(left, viewportPadding, vw - w - viewportPadding);
    top = clamp(top, viewportPadding, vh - h - viewportPadding);

    setCoords({ top, left });
    setResolved(`${side}-${align}` as PopoverPlacement);
    setMeasured(w > 0 && h > 0);
  }, [anchorRef, floatingRef, placement, gap, viewportPadding]);

  useIsomorphicLayoutEffect(() => {
    if (!enabled) {
      setCoords(null);
      setMeasured(false);
      return;
    }
    update();
    // `true` = capture phase, so scrolling any ancestor container (not just
    // the document) repositions the panel.
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [enabled, update]);

  return { coords, placement: resolved, measured, update };
}
