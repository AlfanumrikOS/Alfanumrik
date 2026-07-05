'use client';

import {
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from '@/lib/utils';
import { IconButton } from './IconButton';
import { Portal } from './overlay/Portal';
import { Scrim } from './overlay/Scrim';
import { useScrollLock } from './overlay/useScrollLock';
import { useFocusTrap } from './overlay/useFocusTrap';
import { useEscapeKey } from './overlay/useEscapeKey';
import { usePresence } from './overlay/usePresence';
import { useOverlayStack } from './overlay/overlayStack';

/* ═══════════════════════════════════════════════════════════════
   Drawer — canonical primitive (Phase 2 Batch B2)

   Side sheet anchored left or right. Same a11y contract as Dialog:
   role="dialog" aria-modal, aria-labelledby (title) + aria-describedby
   (description), focus trap + restore, Escape close, ref-counted scroll
   lock, scrim click close. Width is token-driven (Tailwind max-w scale).
   Slide transition is reduced-motion aware. Copy via props (P7).
   ═══════════════════════════════════════════════════════════════ */

export type DrawerSide = 'left' | 'right';
export type DrawerSize = 'sm' | 'md' | 'lg';

const WIDTH: Record<DrawerSize, string> = {
  sm: 'max-w-xs',
  md: 'max-w-sm',
  lg: 'max-w-md',
};

const CLOSE_ICON = (
  <svg viewBox="0 0 20 20" width="1.1em" height="1.1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M5 5l10 10M15 5L5 15" />
  </svg>
);

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Anchor edge. Default 'right'. */
  side?: DrawerSide;
  size?: DrawerSize;
  /** Accessible title (P7 — caller localises). */
  title: ReactNode;
  /** Optional description, wired into aria-describedby. */
  description?: ReactNode;
  /** Accessible label for the close button. Omit to hide it (Escape/scrim still close). */
  closeLabel?: string;
  disableEscapeClose?: boolean;
  disableScrimClose?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Sticky footer region (actions). */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Drawer({
  open,
  onClose,
  side = 'right',
  size = 'md',
  title,
  description,
  closeLabel,
  disableEscapeClose = false,
  disableScrimClose = false,
  initialFocusRef,
  footer,
  children,
  className,
}: DrawerProps) {
  const { mounted, visible } = usePresence(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const autoId = useId();
  const titleId = `${autoId}-title`;
  const descId = `${autoId}-desc`;
  const overlayId = `${autoId}-overlay`;

  useScrollLock(mounted);
  useOverlayStack(mounted, overlayId);
  useFocusTrap(mounted, panelRef, { initialFocusRef, overlayId });
  useEscapeKey(mounted && !disableEscapeClose, onClose, overlayId);

  if (!mounted) return null;

  const closedTransform =
    side === 'right' ? 'translate-x-full' : '-translate-x-full';

  return (
    <Portal>
      {/* Single full-viewport container = one stacking context. Scrim
          behind; the side-anchored panel layer in front. */}
      <div className="fixed inset-0" style={{ zIndex: 'var(--z-modal)' }}>
        <Scrim visible={visible} onClick={disableScrimClose ? undefined : onClose} />
        {/* Panel layer is pointer-events-none so clicks in the gutter
            fall through to the scrim (close); the panel re-enables them. */}
        <div
          className={cn(
            'pointer-events-none absolute inset-y-0 flex',
            side === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description != null ? descId : undefined}
            tabIndex={-1}
            className={cn(
              'pointer-events-auto flex h-full w-screen flex-col bg-surface-1 text-foreground shadow-lg',
              'focus-visible:outline-none',
              'transition-transform duration-200 ease-out motion-reduce:transition-none',
              visible ? 'translate-x-0' : closedTransform,
              WIDTH[size],
              className,
            )}
          >
          <header className="flex items-start gap-3 border-b border-surface-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-fluid-lg font-bold text-foreground">
                {title}
              </h2>
              {description != null && (
                <p id={descId} className="mt-1 text-fluid-sm text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            {closeLabel != null && (
              <IconButton
                label={closeLabel}
                icon={CLOSE_ICON}
                variant="ghost"
                size="sm"
                onClick={onClose}
              />
            )}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer != null && (
            <footer className="border-t border-surface-3 px-5 py-4">{footer}</footer>
          )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
