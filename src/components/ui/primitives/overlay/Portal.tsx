'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/* ═══════════════════════════════════════════════════════════════
   Portal — shared overlay foundation (Phase 2 Batch B2)

   Renders children into document.body so overlays escape any
   ancestor `overflow:hidden` / `transform` / stacking context and
   layer cleanly on the canonical z-index ladder. SSR-safe: nothing
   is portalled until after mount (createPortal needs a real DOM
   node, which does not exist during the server render).
   ═══════════════════════════════════════════════════════════════ */

export interface PortalProps {
  children: ReactNode;
  /** Optional explicit mount node. Defaults to document.body. */
  container?: HTMLElement | null;
}

export function Portal({ children, container }: PortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted) return null;
  const target = container ?? (typeof document !== 'undefined' ? document.body : null);
  if (!target) return null;

  return createPortal(children, target);
}
