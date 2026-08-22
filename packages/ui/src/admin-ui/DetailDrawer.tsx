'use client';

import { useEffect } from 'react';

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
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden'; // lock background scroll
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        data-testid="detail-drawer-overlay"
        onClick={onClose}
        className="fixed inset-0 bg-black/20 z-[999] animate-fade-in"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed top-0 right-0 bottom-0 z-[1000] flex flex-col bg-surface-1 border-l border-surface-3 shadow-2xl overflow-hidden animate-slide-up max-sm:w-full"
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
    </>
  );
}
