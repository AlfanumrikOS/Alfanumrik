'use client';

import { useId, useRef } from 'react';
import { Portal } from '../ui/primitives/overlay/Portal';
import { useScrollLock } from '../ui/primitives/overlay/useScrollLock';
import { useFocusTrap } from '../ui/primitives/overlay/useFocusTrap';
import { useEscapeKey } from '../ui/primitives/overlay/useEscapeKey';
import { useOverlayStack } from '../ui/primitives/overlay/overlayStack';

/* ═══════════════════════════════════════════════════════════════
   DetailDrawer — admin-ui side panel

   Refactored (2026-08-16, Phase 0 super-admin overhaul) onto the
   shared overlay foundation used by the canonical Dialog/Drawer/
   BottomSheet primitives (packages/ui/src/ui/primitives/overlay/):
   Portal + ref-counted scroll lock + from-scratch Tab focus trap
   (with restore-on-close) + overlay-stack-gated Escape. The prior
   hand-rolled version had Escape-close + scroll-lock + role="dialog"
   aria-modal but NO focus trap — keyboard focus could escape into
   the page behind the drawer. Props/behaviour are unchanged; only
   the internal listener wiring moved onto the shared primitives.
   ═══════════════════════════════════════════════════════════════ */

export interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Drawer width in pixels. Mobile (<640px) always full-width. */
  width?: number;
}

export default function DetailDrawer({
  open, onClose, title, children, width = 480,
}: DetailDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const autoId = useId();
  const overlayId = `${autoId}-detail-drawer`;

  useScrollLock(open);
  useOverlayStack(open, overlayId);
  useFocusTrap(open, panelRef, { overlayId });
  useEscapeKey(open, onClose, overlayId);

  if (!open) return null;

  return (
    <Portal>
      <div
        data-testid="detail-drawer-overlay"
        onClick={onClose}
        className="fixed inset-0 bg-black/20 z-[999] animate-fade-in"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="fixed top-0 right-0 bottom-0 z-[1000] flex flex-col bg-surface-1 border-l border-surface-3 shadow-2xl overflow-hidden animate-slide-up max-sm:w-full focus:outline-none"
        style={{ width: typeof window !== 'undefined' && window.innerWidth < 640 ? '100%' : width }}
      >
        <div className="flex items-center justify-between border-b border-surface-3 p-4 shrink-0">
          <h3 className="m-0 text-base font-bold text-foreground">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close drawer"
            className="rounded-md border border-surface-3 bg-surface-1 px-2.5 py-1 text-sm text-muted-foreground hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </Portal>
  );
}
