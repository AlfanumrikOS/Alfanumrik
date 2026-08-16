'use client';

/**
 * Bilingual wrapper around the canonical `ConfirmDialog` primitive
 * (`@alfanumrik/ui/ui/primitives`) — accessible (role="dialog",
 * aria-modal, focus-trapped + restored, Escape support) confirmation for
 * every destructive action on the Users page. Replaces browser `confirm()`.
 *
 * Use `TypedConfirmDialog` instead for changes that need a stronger,
 * type-to-confirm gate (e.g. granting super_admin).
 */

import { ConfirmDialog } from '@alfanumrik/ui/ui/primitives';

export interface ConfirmActionDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isHi: boolean;
  titleEn: string;
  titleHi: string;
  descriptionEn?: string;
  descriptionHi?: string;
  confirmEn?: string;
  confirmHi?: string;
  /** Danger styling + hardened (no Escape / scrim dismiss). Default true. */
  destructive?: boolean;
  loading?: boolean;
}

export default function ConfirmActionDialog({
  open,
  onClose,
  onConfirm,
  isHi,
  titleEn,
  titleHi,
  descriptionEn,
  descriptionHi,
  confirmEn = 'Confirm',
  confirmHi = 'पुष्टि करें',
  destructive = true,
  loading = false,
}: ConfirmActionDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title={isHi ? titleHi : titleEn}
      description={descriptionEn != null ? (isHi ? descriptionHi : descriptionEn) : undefined}
      confirmLabel={isHi ? confirmHi : confirmEn}
      cancelLabel={isHi ? 'रद्द करें' : 'Cancel'}
      destructive={destructive}
      loading={loading}
    />
  );
}
