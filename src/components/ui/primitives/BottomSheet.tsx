'use client';

import {
  useCallback,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from '@/lib/utils';
import { Portal } from './overlay/Portal';
import { Scrim } from './overlay/Scrim';
import { useScrollLock } from './overlay/useScrollLock';
import { useFocusTrap } from './overlay/useFocusTrap';
import { useEscapeKey } from './overlay/useEscapeKey';
import { usePresence } from './overlay/usePresence';
import { useOverlayStack } from './overlay/overlayStack';

/* ═══════════════════════════════════════════════════════════════
   BottomSheet — canonical primitive (Phase 2 Batch B2)

   The primary MOBILE overlay pattern: a sheet anchored to the bottom
   edge, snapping to its content height. Full dialog a11y contract
   (role="dialog" aria-modal, aria-labelledby/‑describedby, focus trap
   + restore, Escape, ref-counted scroll lock, scrim click close).

   Touch: a visible drag handle affords swipe-to-dismiss — pointer
   events only, no library. Dragging down past the threshold (or a
   flick) closes; a short drag snaps back. The handle is ALSO a real
   button so keyboard/click users get an equivalent close fallback,
   and the content honours safe-area-inset-bottom. Reduced-motion
   aware. Copy via props (P7).
   ═══════════════════════════════════════════════════════════════ */

/** Drag distance (px) past which release dismisses the sheet. */
const DISMISS_DISTANCE = 110;
/** Movement (px) beyond which a pointer gesture counts as a DRAG, not a tap.
    Used to suppress the synthetic click that follows a sub-threshold drag so
    the handle's onClick={onClose} fires ONLY on a genuine tap. */
const DRAG_SLOP = 6;

const GRABBER = (
  <span
    aria-hidden="true"
    className="block h-1.5 w-10 rounded-full bg-surface-3"
  />
);

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Accessible title (P7 — caller localises). */
  title: ReactNode;
  /** Optional description, wired into aria-describedby. */
  description?: ReactNode;
  /** Accessible label for the drag handle / close affordance (P7). */
  handleLabel: string;
  disableEscapeClose?: boolean;
  disableScrimClose?: boolean;
  /** Disable swipe-to-dismiss (still closable via handle/Escape/scrim). */
  disableSwipe?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Sticky footer region (actions). */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function BottomSheet({
  open,
  onClose,
  title,
  description,
  handleLabel,
  disableEscapeClose = false,
  disableScrimClose = false,
  disableSwipe = false,
  initialFocusRef,
  footer,
  children,
  className,
}: BottomSheetProps) {
  const { mounted, visible } = usePresence(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  // True once a pointer gesture has moved past DRAG_SLOP — the ensuing
  // synthetic click is then suppressed so a sub-threshold drag never closes.
  const draggedRef = useRef(false);
  const [dragY, setDragY] = useState<number | null>(null);
  const autoId = useId();
  const titleId = `${autoId}-title`;
  const descId = `${autoId}-desc`;
  const overlayId = `${autoId}-overlay`;

  useScrollLock(mounted);
  useOverlayStack(mounted, overlayId);
  useFocusTrap(mounted, panelRef, { initialFocusRef, overlayId });
  useEscapeKey(mounted && !disableEscapeClose, onClose, overlayId);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (disableSwipe) return;
      startYRef.current = e.clientY;
      draggedRef.current = false;
      setDragY(0);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [disableSwipe],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    if (startYRef.current == null) return;
    const delta = e.clientY - startYRef.current;
    // Any real movement past the slop marks this gesture as a drag.
    if (Math.abs(delta) > DRAG_SLOP) draggedRef.current = true;
    // Only downward drag translates the sheet; upward is clamped.
    setDragY(Math.max(0, delta));
  }, []);

  const onPointerEnd = useCallback(() => {
    if (startYRef.current == null) return;
    const shouldClose = (dragY ?? 0) > DISMISS_DISTANCE;
    startYRef.current = null;
    setDragY(null); // snap back (or let presence exit run if closing)
    if (shouldClose) onClose();
  }, [dragY, onClose]);

  const onHandleClick = useCallback(() => {
    // A drag (even sub-threshold) synthesises a click on pointer-up — swallow
    // it so only a genuine tap (no drag) closes via the handle button.
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    onClose();
  }, [onClose]);

  if (!mounted) return null;

  const dragging = dragY != null;

  return (
    <Portal>
      {/* Single full-viewport container = one stacking context. Scrim
          behind; the bottom-anchored panel layer in front. */}
      <div className="fixed inset-0" style={{ zIndex: 'var(--z-modal)' }}>
        <Scrim visible={visible} onClick={disableScrimClose ? undefined : onClose} />
        {/* Panel layer is pointer-events-none so clicks above / beside the
            sheet fall through to the scrim (close); the sheet re-enables them. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center">
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description != null ? descId : undefined}
            tabIndex={-1}
            className={cn(
              'pointer-events-auto flex w-full max-w-lg flex-col rounded-t-2xl bg-surface-1 text-foreground shadow-lg',
              'focus-visible:outline-none',
              !dragging &&
                'transition-transform duration-200 ease-out motion-reduce:transition-none',
              !dragging && (visible ? 'translate-y-0' : 'translate-y-full'),
              className,
            )}
            style={{
              maxHeight: '90dvh',
              ...(dragging ? { transform: `translateY(${dragY}px)` } : null),
            }}
          >
            {/* Drag handle — also a real button (keyboard/click close fallback).
                onHandleClick swallows the synthetic click after a drag. */}
            <button
              type="button"
              aria-label={handleLabel}
              onClick={onHandleClick}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              className={cn(
                'flex w-full shrink-0 items-center justify-center py-3',
                'touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                'rounded-t-2xl',
              )}
            >
              {GRABBER}
            </button>

            <header className="shrink-0 px-5 pb-2">
              <h2 id={titleId} className="text-fluid-lg font-bold text-foreground">
                {title}
              </h2>
              {description != null && (
                <p id={descId} className="mt-1 text-fluid-sm text-muted-foreground">
                  {description}
                </p>
              )}
            </header>

            {/* Safe-area padding lives on the body when there is no footer,
                so we never render an empty padded footer strip. */}
            <div
              className={cn(
                'min-h-0 flex-1 overflow-y-auto px-5 py-3',
                footer == null && 'safe-bottom',
              )}
            >
              {children}
            </div>

            {footer != null && (
              <footer className="safe-bottom shrink-0 border-t border-surface-3 px-5 pt-2">
                {footer}
              </footer>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
