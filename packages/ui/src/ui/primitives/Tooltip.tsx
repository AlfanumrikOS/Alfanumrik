'use client';

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@alfanumrik/lib/utils';
import { Portal } from './overlay/Portal';

/* ═══════════════════════════════════════════════════════════════
   Tooltip — canonical primitive (Phase 2 Batch B2)

   Accessible, supplementary hint bubble. A11y contract:
     - shows on pointer HOVER and on keyboard FOCUS (both wired)
     - the trigger gets aria-describedby → the tooltip node, so the
       hint is announced (role="tooltip")
     - touch: TAP shows, tap-away hides (pointerType 'touch')
     - positioned top/bottom/left/right, flipping + clamping so it
       never overflows the viewport (rendered via body Portal)
     - reduced-motion aware fade
     - never uses the native `title` attribute (no browser dialog)

   Tooltips are SUPPLEMENTARY: never put information ONLY in a tooltip
   (see docs/design/design-system.md §12). Copy via `content` (P7).
   ═══════════════════════════════════════════════════════════════ */

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

const GAP = 8; // px between trigger and tooltip
const PAD = 8; // px viewport inset the tooltip stays clear of

export interface TooltipProps {
  /** The hint copy (P7 — caller localises). */
  content: ReactNode;
  /** Preferred placement; flips to the opposite side if it would overflow. */
  side?: TooltipSide;
  /** The single interactive trigger element (must forward ref + props). */
  children: ReactElement;
  className?: string;
}

interface Coords {
  top: number;
  left: number;
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref && typeof ref === 'object') {
        (ref as { current: T }).current = node;
      }
    }
  };
}

export function Tooltip({ content, side = 'top', children, className }: TooltipProps) {
  const triggerRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const tooltipId = useId();

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const tip = tooltipRef.current;
    if (!trigger || !tip) return;
    const t = trigger.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Flip the preferred side if there isn't room for it.
    let resolved = side;
    if (side === 'top' && t.top - h - GAP < PAD) resolved = 'bottom';
    else if (side === 'bottom' && t.bottom + h + GAP > vh - PAD) resolved = 'top';
    else if (side === 'left' && t.left - w - GAP < PAD) resolved = 'right';
    else if (side === 'right' && t.right + w + GAP > vw - PAD) resolved = 'left';

    let top = 0;
    let left = 0;
    switch (resolved) {
      case 'top':
        top = t.top - h - GAP;
        left = t.left + (t.width - w) / 2;
        break;
      case 'bottom':
        top = t.bottom + GAP;
        left = t.left + (t.width - w) / 2;
        break;
      case 'left':
        top = t.top + (t.height - h) / 2;
        left = t.left - w - GAP;
        break;
      case 'right':
        top = t.top + (t.height - h) / 2;
        left = t.right + GAP;
        break;
    }
    // Clamp inside the viewport on the cross axis.
    left = Math.min(Math.max(PAD, left), vw - w - PAD);
    top = Math.min(Math.max(PAD, top), vh - h - PAD);
    setCoords({ top, left });
  }, [side]);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  // Tap-away closes a touch-opened tooltip.
  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        tooltipRef.current?.contains(target)
      ) {
        return;
      }
      hide();
    }
    document.addEventListener('pointerdown', onDocPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true);
  }, [open, hide]);

  if (!isValidElement(children)) {
    return children as unknown as ReactElement;
  }

  const child = children as ReactElement<Record<string, unknown>> & {
    ref?: Ref<HTMLElement>;
  };
  const childProps = child.props;

  function call(name: string, e: unknown) {
    const handler = childProps[name];
    if (typeof handler === 'function') handler(e);
  }

  const trigger = cloneElement(child, {
    ref: mergeRefs(triggerRef, child.ref),
    'aria-describedby': open
      ? [childProps['aria-describedby'], tooltipId].filter(Boolean).join(' ')
      : childProps['aria-describedby'],
    onMouseEnter: (e: unknown) => {
      call('onMouseEnter', e);
      show();
    },
    onMouseLeave: (e: unknown) => {
      call('onMouseLeave', e);
      hide();
    },
    onFocus: (e: unknown) => {
      call('onFocus', e);
      show();
    },
    onBlur: (e: unknown) => {
      call('onBlur', e);
      hide();
    },
    onPointerDown: (e: ReactPointerEvent) => {
      call('onPointerDown', e);
      // Touch: toggle (mouse uses hover, and would already be shown).
      if (e.pointerType === 'touch') setOpen((v) => !v);
    },
  } as Record<string, unknown>);

  return (
    <>
      {trigger}
      {open && (
        <Portal>
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            className={cn(
              'pointer-events-none fixed max-w-xs rounded-lg px-3 py-2',
              // Inverse surface: ink bg + paper text (auto-flips per theme).
              'bg-foreground text-fluid-xs font-medium text-surface-1 shadow-md',
              'transition-opacity duration-150 ease-out motion-reduce:transition-none',
              coords ? 'opacity-100' : 'opacity-0',
              className,
            )}
            style={{
              zIndex: 'var(--z-tooltip)',
              top: coords?.top ?? 0,
              left: coords?.left ?? 0,
            }}
          >
            {content}
          </div>
        </Portal>
      )}
    </>
  );
}
