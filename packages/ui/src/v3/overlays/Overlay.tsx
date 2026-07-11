'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type OverlayKind = 'dialog' | 'drawer' | 'sheet';

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
  kind: OverlayKind;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function Overlay({ open, onClose, title, description, children, footer, closeLabel = 'Close', kind }: OverlayProps) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const main = document.getElementById('main-content');
    const shellNav = document.querySelector<HTMLElement>('[data-v3-shell-navigation]');
    main?.setAttribute('inert', '');
    shellNav?.setAttribute('inert', '');
    document.body.classList.add('v3-overlay-open');

    const frame = requestAnimationFrame(() => {
      const initial = panelRef.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button, a[href]');
      (initial || panelRef.current)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!focusable.length) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      main?.removeAttribute('inert');
      shellNav?.removeAttribute('inert');
      document.body.classList.remove('v3-overlay-open');
      previous?.focus();
    };
  }, [onClose, open]);

  if (!mounted || !open) return null;
  return createPortal(
    <div data-experience="v3" className={`v3-overlay v3-overlay--${kind}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={panelRef}
        className="v3-overlay__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="v3-overlay__header">
          <div><h2 id={titleId}>{title}</h2>{description ? <p id={descriptionId}>{description}</p> : null}</div>
          <button type="button" className="v3-icon-button" aria-label={closeLabel} onClick={onClose}>×</button>
        </header>
        <div className="v3-overlay__body">{children}</div>
        {footer ? <footer className="v3-overlay__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export type DialogProps = Omit<OverlayProps, 'kind'>;
export function Dialog(props: DialogProps) { return <Overlay {...props} kind="dialog" />; }
export function Drawer(props: DialogProps) { return <Overlay {...props} kind="drawer" />; }
export function BottomSheet(props: DialogProps) { return <Overlay {...props} kind="sheet" />; }
