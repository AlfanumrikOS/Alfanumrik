'use client';

import { useEffect, useState, useCallback } from 'react';

/* ═══════════════════════════════════════════════════════════════
   ALFANUMRIK TOAST — In-app notification component (Phase A.4)

   Replaces native alert() across the app. The styling mirrors the
   existing ad-hoc toast patterns already used in
   src/app/teacher/classes/page.tsx and src/app/support/page.tsx so
   cheap school tablets / Chromebooks don't see blocking dialogs.

   Usage:
     import { toast } from '@/components/ui/toast';
     toast.error('Could not save');
     toast.success('Saved');
     toast.info('Heads up');

   Mount <Toaster /> once in src/app/layout.tsx.
   ═══════════════════════════════════════════════════════════════ */

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

type Listener = (toasts: ToastItem[]) => void;

let counter = 0;
let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();
const DEFAULT_DURATION = 4000;

function emit() {
  for (const fn of listeners) fn(toasts);
}

function push(kind: ToastKind, message: string, duration = DEFAULT_DURATION) {
  // Drop empty messages — defensive, since callers occasionally pass undefined.
  if (!message) return;
  const id = ++counter;
  toasts = [...toasts, { id, kind, message }];
  emit();
  if (typeof window !== 'undefined' && duration > 0) {
    window.setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
      emit();
    }, duration);
  }
}

export const toast = {
  success: (message: string, duration?: number) => push('success', message, duration),
  error: (message: string, duration?: number) => push('error', message, duration),
  info: (message: string, duration?: number) => push('info', message, duration),
};

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function colorFor(kind: ToastKind) {
  switch (kind) {
    case 'success': return { bg: '#059669', fg: '#fff' };
    case 'error':   return { bg: '#DC2626', fg: '#fff' };
    case 'info':    return { bg: '#0F172A', fg: '#fff' };
  }
}

/**
 * <Toaster /> — mount once near the root of the tree.
 * Renders fixed-position stack of in-app toasts. Pure client, no portals
 * to keep the bundle slim.
 */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener: Listener = (next) => setItems(next);
    listeners.add(listener);
    listener(toasts);
    return () => { listeners.delete(listener); };
  }, []);

  const onDismiss = useCallback((id: number) => { dismiss(id); }, []);

  if (items.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: 'fixed',
        bottom: 96,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
        maxWidth: 'calc(100vw - 32px)',
      }}
      data-testid="toaster-root"
    >
      {items.map((t) => {
        const c = colorFor(t.kind);
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            onClick={() => onDismiss(t.id)}
            style={{
              backgroundColor: c.bg,
              color: c.fg,
              padding: '10px 24px',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              pointerEvents: 'auto',
              cursor: 'pointer',
              animation: 'fadeIn 0.2s ease',
              textAlign: 'center',
              maxWidth: '90vw',
              wordBreak: 'break-word',
            }}
            data-testid={`toast-${t.kind}`}
          >
            {t.message}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Test-only helper. Resets the internal store between tests; not exported
 * for production callers.
 */
export function __resetToastsForTests() {
  toasts = [];
  counter = 0;
  emit();
}
