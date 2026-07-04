'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';
import { Portal } from './overlay/Portal';
import { IconButton } from './IconButton';
import { TONE_VAR } from './tokens';

/* ═══════════════════════════════════════════════════════════════
   Toast — canonical primitive (Phase 2 Batch B3)

   A SINGLE canonical toast system: mount <ToastProvider> once, then
   call useToast() anywhere below it. A11y contract:
     - ONE persistent live region (rendered via the overlay Portal so
       it escapes ancestor clipping and layers on --z-toast). The
       region is aria-live="polite" by default; an ERROR toast carries
       role="alert" so it is announced assertively.
     - auto-dismiss after `duration` (0 = sticky), but the timer
       PAUSES on pointer hover AND on keyboard focus (focus-within),
       so a reader never loses a message mid-read.
     - a manual dismiss button (aria-label via `dismissLabel` — P7).
     - stacking with a max-visible cap (oldest drop out).
     - tone-aware: a distinct glyph per tone (non-colour signal) + ink
       text on an opaque surface (always AA); the tone hue is a hairline
       accent, never load-bearing colour-only meaning.
     - reduced-motion aware: no slide/translate when the user opts out.

   Copy is always passed in (message + dismissLabel + regionLabel) — P7.
   Do NOT auto-mount this provider app-wide from a shared layout; it is
   opt-in per tree (see design-system.md §13).
   ═══════════════════════════════════════════════════════════════ */

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  /** ms before auto-dismiss. 0 (or negative) = sticky (manual only). */
  duration?: number;
  /** Optional action node (e.g. an <button>/"Undo"). Caller localises. */
  action?: ReactNode;
  /** Per-toast override of the dismiss button aria-label (P7). */
  dismissLabel?: string;
  /** Override the default tone glyph (decorative, aria-hidden). */
  icon?: ReactNode;
}

interface ToastRecord extends Required<Pick<ToastOptions, 'duration'>> {
  id: number;
  tone: ToastTone;
  message: ReactNode;
  action?: ReactNode;
  dismissLabel?: string;
  icon?: ReactNode;
}

export interface ToastApi {
  success: (message: ReactNode, opts?: ToastOptions) => number;
  error: (message: ReactNode, opts?: ToastOptions) => number;
  warning: (message: ReactNode, opts?: ToastOptions) => number;
  info: (message: ReactNode, opts?: ToastOptions) => number;
  /** Generic entry point. */
  show: (tone: ToastTone, message: ReactNode, opts?: ToastOptions) => number;
  dismiss: (id: number) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Default tone glyphs — a NON-colour signal (distinct per tone). */
const TONE_GLYPH: Record<ToastTone, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

/** Map the toast tone onto the shared semantic tone var (error → danger). */
function toneVar(tone: ToastTone): string {
  return TONE_VAR[tone === 'error' ? 'danger' : tone];
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export interface ToastProviderProps {
  children: ReactNode;
  /** Accessible name for the live region (P7 — caller localises). */
  regionLabel: string;
  /** Fallback dismiss-button aria-label when a toast omits its own (P7). */
  dismissLabel: string;
  /** Default auto-dismiss in ms. Default 5000. */
  defaultDuration?: number;
  /** Max toasts rendered at once; oldest drop when exceeded. Default 4. */
  max?: number;
}

export function ToastProvider({
  children,
  regionLabel,
  dismissLabel,
  defaultDuration = 5000,
  max = 4,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => setToasts([]), []);

  const show = useCallback(
    (tone: ToastTone, message: ReactNode, opts: ToastOptions = {}) => {
      const id = ++idRef.current;
      const record: ToastRecord = {
        id,
        tone,
        message,
        action: opts.action,
        dismissLabel: opts.dismissLabel,
        icon: opts.icon,
        duration: opts.duration ?? defaultDuration,
      };
      // Newest first; cap the stack (oldest fall off the end).
      setToasts((prev) => [record, ...prev].slice(0, Math.max(1, max)));
      return id;
    },
    [defaultDuration, max],
  );

  const api: ToastApi = useMemo(
    () => ({
      show,
      dismiss,
      dismissAll,
      success: (m, o) => show('success', m, o),
      error: (m, o) => show('error', m, o),
      warning: (m, o) => show('warning', m, o),
      info: (m, o) => show('info', m, o),
    }),
    [show, dismiss, dismissAll],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Portal>
        {/* ONE persistent live region. pointer-events-none so it never
            blocks the page; each toast re-enables its own pointer events. */}
        <div
          role="region"
          aria-label={regionLabel}
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-0 flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end safe-bottom"
          style={{ zIndex: 'var(--z-toast)' }}
        >
          {toasts.map((t) => (
            <ToastItem
              key={t.id}
              record={t}
              fallbackDismissLabel={dismissLabel}
              onRemove={dismiss}
            />
          ))}
        </div>
      </Portal>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>.');
  }
  return ctx;
}

interface ToastItemProps {
  record: ToastRecord;
  fallbackDismissLabel: string;
  onRemove: (id: number) => void;
}

function ToastItem({ record, fallbackDismissLabel, onRemove }: ToastItemProps) {
  const { id, tone, message, action, duration } = record;
  const [reduced] = useState(prefersReducedMotion);
  const [entered, setEntered] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(duration);

  // Enter transition: mount → next frame → slide/fade in.
  useEffect(() => {
    if (reduced) {
      setEntered(true);
      return;
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const close = useCallback(() => {
    if (reduced) {
      onRemove(id);
      return;
    }
    setLeaving(true);
    const timer = setTimeout(() => onRemove(id), 200);
    return () => clearTimeout(timer);
  }, [reduced, id, onRemove]);

  // Auto-dismiss countdown that pauses while hovered/focused.
  useEffect(() => {
    if (duration <= 0 || paused || leaving) return;
    const start = Date.now();
    const timer = setTimeout(close, remainingRef.current);
    return () => {
      remainingRef.current -= Date.now() - start;
      clearTimeout(timer);
    };
  }, [duration, paused, leaving, close]);

  const accent = toneVar(tone);
  const isError = tone === 'error';

  return (
    <div
      // role="alert" (assertive) for errors; polite region announces the rest.
      role={isError ? 'alert' : undefined}
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-surface-3 bg-surface-1 px-4 py-3 shadow-lg',
        'transition duration-200 ease-out motion-reduce:transition-none',
        entered && !leaving ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
      style={{ borderInlineStartWidth: 4, borderInlineStartColor: accent }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0 text-fluid-base font-bold" style={{ color: accent }}>
        {record.icon ?? TONE_GLYPH[tone]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-fluid-sm font-medium text-foreground">{message}</p>
        {action != null && <div className="mt-2">{action}</div>}
      </div>
      <IconButton
        variant="ghost"
        size="sm"
        label={record.dismissLabel ?? fallbackDismissLabel}
        icon={<span aria-hidden="true">✕</span>}
        onClick={close}
        className="-me-1.5 -mt-1 shrink-0"
      />
    </div>
  );
}
