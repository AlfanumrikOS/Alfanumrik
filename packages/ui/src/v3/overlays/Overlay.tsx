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
const BACKGROUND_REGIONS = '[data-v3-shell-background], #main-content, [data-v3-shell-navigation]';

let openOverlayCount = 0;
let applicationFocus: HTMLElement | null = null;
const inertLeases = new WeakMap<HTMLElement, { count: number; wasInert: boolean }>();

function acquireInert(element: HTMLElement) {
  const lease = inertLeases.get(element);
  if (lease) lease.count += 1;
  else inertLeases.set(element, { count: 1, wasInert: element.hasAttribute('inert') });
  element.setAttribute('inert', '');
}

function releaseInert(element: HTMLElement) {
  const lease = inertLeases.get(element);
  if (!lease) return;
  lease.count -= 1;
  if (lease.count > 0) return;
  if (!lease.wasInert) element.removeAttribute('inert');
  inertLeases.delete(element);
}

function Overlay({ open, onClose, title, description, children, footer, closeLabel = 'Close', kind }: OverlayProps) {
  const [mounted, setMounted] = useState(false);
  const portalRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (openOverlayCount === 0) applicationFocus = previous;
    const bodyBackground = Array.from(document.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && !element.hasAttribute('data-v3-overlay-root'));
    const backgroundRegions = Array.from(new Set([
      ...bodyBackground,
      ...document.querySelectorAll<HTMLElement>(BACKGROUND_REGIONS),
    ])).filter((element) => element !== portalRef.current);
    backgroundRegions.forEach(acquireInert);
    openOverlayCount += 1;
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
      backgroundRegions.forEach(releaseInert);
      openOverlayCount = Math.max(0, openOverlayCount - 1);
      if (openOverlayCount === 0) {
        document.body.classList.remove('v3-overlay-open');
        if (applicationFocus?.isConnected) applicationFocus.focus({ preventScroll: true });
        applicationFocus = null;
      } else if (previous?.isConnected && !previous.closest('[inert]')) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [onClose, open]);

  if (!mounted || !open) return null;
  return createPortal(
    <div ref={portalRef} data-experience="v3" data-v3-overlay-root className={`v3-overlay v3-overlay--${kind}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
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
