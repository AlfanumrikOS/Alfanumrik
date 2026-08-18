'use client';

/**
 * Type-to-confirm dialog for the highest-blast-radius actions on the Users
 * page (currently: elevating an admin_users row to `super_admin`). Built on
 * the canonical `Dialog` primitive (accessible, focus-trapped, Escape +
 * scrim disabled — an explicit choice is required) rather than the plain
 * `ConfirmDialog`, because a single click is not enough friction for this
 * class of change. Mirrors the type-the-name pattern already used for
 * protected feature flags in `/super-admin/flags`.
 */

import { useEffect, useState } from 'react';
import { Dialog, DialogTitle, DialogBody, DialogFooter, Button } from '@alfanumrik/ui/ui/primitives';

export interface TypedConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isHi: boolean;
  titleEn: string;
  titleHi: string;
  descriptionEn: string;
  descriptionHi: string;
  /** Exact (case-sensitive) token the operator must type to enable Confirm. */
  confirmToken: string;
  loading?: boolean;
}

export default function TypedConfirmDialog({
  open,
  onClose,
  onConfirm,
  isHi,
  titleEn,
  titleHi,
  descriptionEn,
  descriptionHi,
  confirmToken,
  loading = false,
}: TypedConfirmDialogProps) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (!open) setText('');
  }, [open]);

  const matches = text === confirmToken;

  return (
    <Dialog open={open} onClose={onClose} size="sm" disableEscapeClose disableScrimClose>
      <DialogTitle>{isHi ? titleHi : titleEn}</DialogTitle>
      <DialogBody>
        <p className="mb-3">{isHi ? descriptionHi : descriptionEn}</p>
        <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
          {isHi ? `पुष्टि के लिए "${confirmToken}" टाइप करें` : `Type "${confirmToken}" to confirm`}
        </label>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={confirmToken}
          aria-label={isHi ? 'पुष्टि पाठ' : 'Confirmation text'}
          disabled={loading}
          className="w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches) onConfirm();
          }}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          {isHi ? 'रद्द करें' : 'Cancel'}
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={!matches} loading={loading}>
          {isHi ? 'पुष्टि करें' : 'Confirm'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
