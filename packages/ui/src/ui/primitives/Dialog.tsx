'use client';

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from '@alfanumrik/lib/utils';
import { Button, type ButtonProps } from './Button';
import { Portal } from './overlay/Portal';
import { Scrim } from './overlay/Scrim';
import { useScrollLock } from './overlay/useScrollLock';
import { useFocusTrap } from './overlay/useFocusTrap';
import { useEscapeKey } from './overlay/useEscapeKey';
import { usePresence } from './overlay/usePresence';
import { useOverlayStack } from './overlay/overlayStack';

/* ═══════════════════════════════════════════════════════════════
   Dialog / Modal — canonical primitive (Phase 2 Batch B2)

   Centered modal built on the shared overlay foundation. A11y contract:
     - role="dialog" aria-modal="true"
     - aria-labelledby wired to <DialogTitle> (auto-registered)
     - aria-describedby wired to <DialogBody> (auto-registered)
     - focus trapped inside + RESTORED to the trigger on close
     - Escape closes (opt-out for destructive confirms)
     - scrim click closes (opt-out for destructive confirms)
     - body scroll locked (ref-counted) while open
   Token-driven only; enter/exit fade+scale is reduced-motion aware.
   All copy comes from children/props (P7).
   ═══════════════════════════════════════════════════════════════ */

export type DialogSize = 'sm' | 'md' | 'lg';

interface DialogContextValue {
  titleId: string;
  descriptionId: string;
  registerTitle: (present: boolean) => void;
  registerDescription: (present: boolean) => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

const SIZE: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export interface DialogProps {
  /** Controlled open state. */
  open: boolean;
  /** Requested close (Escape, scrim click, or a close control). */
  onClose: () => void;
  size?: DialogSize;
  /** Disable Escape-to-close (destructive confirmations). Default false. */
  disableEscapeClose?: boolean;
  /** Disable scrim-click-to-close (destructive confirmations). Default false. */
  disableScrimClose?: boolean;
  /** Element focused first on open. Defaults to the first focusable. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Accessible name when no <DialogTitle> is rendered (P7 — caller localises). */
  'aria-label'?: string;
  /** Frost the scrim. Default false. */
  scrimBlur?: boolean;
  children: ReactNode;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  size = 'md',
  disableEscapeClose = false,
  disableScrimClose = false,
  initialFocusRef,
  'aria-label': ariaLabel,
  scrimBlur = false,
  children,
  className,
}: DialogProps) {
  const { mounted, visible } = usePresence(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const autoId = useId();
  const titleId = `${autoId}-title`;
  const descriptionId = `${autoId}-desc`;
  const overlayId = `${autoId}-overlay`;
  const [hasTitle, setHasTitle] = useState(false);
  const [hasDescription, setHasDescription] = useState(false);

  useScrollLock(mounted);
  useOverlayStack(mounted, overlayId);
  useFocusTrap(mounted, panelRef, { initialFocusRef, overlayId });
  useEscapeKey(mounted && !disableEscapeClose, onClose, overlayId);

  const ctx: DialogContextValue = {
    titleId,
    descriptionId,
    registerTitle: setHasTitle,
    registerDescription: setHasDescription,
  };

  if (!mounted) return null;

  return (
    <Portal>
      {/* Single full-viewport container = one stacking context. Scrim is
          the first child (painted behind); the scroll/centering layer and
          panel come after (painted in front). No z-index juggling. */}
      <div className="fixed inset-0" style={{ zIndex: 'var(--z-modal)' }}>
        <Scrim visible={visible} blur={scrimBlur} />
        {/* Scroll + centering layer sits ABOVE the scrim and catches
            outside clicks; the panel stops propagation so its own clicks
            never reach here. */}
        <div
          className="absolute inset-0 overflow-y-auto"
          onClick={disableScrimClose ? undefined : onClose}
        >
          <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
            <DialogContext.Provider value={ctx}>
              <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={hasTitle ? titleId : undefined}
                aria-describedby={hasDescription ? descriptionId : undefined}
                aria-label={!hasTitle ? ariaLabel : undefined}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'relative flex w-full flex-col overflow-hidden rounded-2xl bg-surface-1 text-foreground shadow-lg',
                  'focus-visible:outline-none',
                  'transition duration-200 ease-out motion-reduce:transition-none',
                  visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0',
                  SIZE[size],
                  className,
                )}
              >
                {children}
              </div>
            </DialogContext.Provider>
          </div>
        </div>
      </div>
    </Portal>
  );
}

/* ── Composition parts ── */

export interface DialogTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  /** Heading level for the DOM (visual size is fixed). Default 2. */
  as?: 'h1' | 'h2' | 'h3';
}

export function DialogTitle({ as: Tag = 'h2', className, children, ...props }: DialogTitleProps) {
  const ctx = useContext(DialogContext);
  useEffect(() => {
    ctx?.registerTitle(true);
    return () => ctx?.registerTitle(false);
  }, [ctx]);
  return (
    <Tag
      id={ctx?.titleId}
      className={cn(
        'px-6 pt-6 text-fluid-lg font-bold text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}

export function DialogBody({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const ctx = useContext(DialogContext);
  useEffect(() => {
    ctx?.registerDescription(true);
    return () => ctx?.registerDescription(false);
  }, [ctx]);
  return (
    <div
      id={ctx?.descriptionId}
      className={cn('overflow-y-auto px-6 py-4 text-fluid-sm text-muted-foreground', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function DialogFooter({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t border-surface-3 px-6 py-4 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* ── ConfirmDialog — convenience wrapper ── */

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  /** Fired when the confirm action is chosen. */
  onConfirm: () => void;
  title: ReactNode;
  /** Body copy (P7 — caller localises). */
  description?: ReactNode;
  /** Confirm button label (required copy — P7). */
  confirmLabel: ReactNode;
  /** Cancel button label (required copy — P7). */
  cancelLabel: ReactNode;
  /** Style the confirm as destructive + hardened (no Escape / scrim close). */
  destructive?: boolean;
  /** Confirm button busy state. */
  loading?: boolean;
  size?: DialogSize;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  loading = false,
  size = 'sm',
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmVariant: ButtonProps['variant'] = destructive ? 'danger' : 'primary';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size={size}
      // Destructive confirms require an explicit choice — no accidental dismiss.
      disableEscapeClose={destructive}
      disableScrimClose={destructive}
      initialFocusRef={cancelRef}
    >
      <DialogTitle>{title}</DialogTitle>
      {description != null && <DialogBody>{description}</DialogBody>}
      <DialogFooter>
        <Button ref={cancelRef} variant="ghost" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button variant={confirmVariant} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
