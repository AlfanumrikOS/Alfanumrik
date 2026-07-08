'use client';

/**
 * ChildDataErasureSection — parent-surface CTA + dialog for DPDP §15
 * right-to-erasure (Phase D.3).
 *
 * Renders:
 *   - A status banner when a pending erasure exists ("scheduled for X —
 *     click to cancel").
 *   - A "Delete my child's data" CTA + confirmation dialog requiring the
 *     parent to type the child's full name before the destructive POST.
 *
 * The component fetches its own status on mount and on every successful
 * mutation. Parent pages just need to pass `studentId`, `studentName`,
 * and an `onChange` callback if they want to refresh siblings.
 *
 * Presentation rebuilt on canonical primitives (Phase 10). The destructive
 * confirm gating (typed-name match + disabled submit) is byte-for-byte
 * preserved — P13.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogBody,
  DialogFooter,
  Button,
  Field,
  Input,
  Textarea,
  Alert,
} from '@alfanumrik/ui/ui/primitives';

interface ErasureStatus {
  id: string;
  status: 'pending' | 'cancelled' | 'purging' | 'completed' | 'failed';
  requested_at: string;
  purge_at: string;
  processed_at: string | null;
  reason: string | null;
  error_message: string | null;
}

interface Props {
  studentId: string;
  studentName: string;
  /** Called after any successful state change so parent dashboards can refresh. */
  onChange?: () => void;
  isHi?: boolean;
}

function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

function formatDate(iso: string, isHi: boolean): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function ChildDataErasureSection({
  studentId,
  studentName,
  onChange,
  isHi = false,
}: Props) {
  const [status, setStatus] = useState<ErasureStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/parent/children/${studentId}/erasure-status`,
        { method: 'GET' },
      );
      if (!res.ok) return;
      const body = (await res.json()) as { request: ErasureStatus | null };
      setStatus(body.request);
    } catch {
      /* non-load-bearing */
    }
  }, [studentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const requestErasure = async () => {
    if (confirmName.trim() !== studentName.trim()) {
      setError(t(isHi, "Type your child's name exactly to confirm.", 'पुष्टि के लिए अपने बच्चे का नाम सटीक रूप से टाइप करें।'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/parent/children/${studentId}/request-erasure`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() || undefined }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok || !body.success) {
        setError(body.error ?? t(isHi, 'Could not submit erasure request.', 'मिटाने का अनुरोध सबमिट नहीं हो सका।'));
        return;
      }
      setShowDialog(false);
      setConfirmName('');
      setReason('');
      await refresh();
      onChange?.();
    } catch {
      setError(t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया पुनः प्रयास करें।'));
    } finally {
      setLoading(false);
    }
  };

  const cancelErasure = async () => {
    if (!status || status.status !== 'pending') return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/parent/children/${studentId}/request-erasure`,
        { method: 'DELETE' },
      );
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok || !body.success) {
        setError(body.error ?? t(isHi, 'Could not cancel erasure.', 'मिटाने को रद्द नहीं किया जा सका।'));
        return;
      }
      await refresh();
      onChange?.();
    } catch {
      setError(t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया पुनः प्रयास करें।'));
    } finally {
      setLoading(false);
    }
  };

  const renderPendingBanner = () => {
    if (!status || status.status !== 'pending') return null;
    return (
      <div className="mt-3">
        <Alert
          tone="danger"
          title={t(
            isHi,
            `Erasure scheduled for ${formatDate(status.purge_at, isHi)}`,
            `${formatDate(status.purge_at, isHi)} के लिए मिटाना निर्धारित है`,
          )}
        >
          <p className="mb-2">
            {t(
              isHi,
              "All of your child's learning data will be deleted on this date. You can cancel until then.",
              'इस तिथि को आपके बच्चे का सारा डेटा हटा दिया जाएगा। आप तब तक रद्द कर सकते हैं।',
            )}
          </p>
          <Button size="sm" variant="secondary" onClick={cancelErasure} loading={loading} disabled={loading}>
            {loading ? t(isHi, 'Cancelling…', 'रद्द हो रहा है…') : t(isHi, 'Cancel erasure', 'मिटाना रद्द करें')}
          </Button>
          {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
        </Alert>
      </div>
    );
  };

  const renderCompletedNote = () => {
    if (!status || status.status !== 'completed') return null;
    return (
      <div className="mt-3 rounded-lg border border-surface-3 bg-surface-2 px-3 py-2.5 text-xs text-muted-foreground">
        {t(
          isHi,
          `Erasure completed on ${formatDate(status.processed_at ?? status.purge_at, isHi)}.`,
          `${formatDate(status.processed_at ?? status.purge_at, isHi)} को मिटाना पूरा हुआ।`,
        )}
      </div>
    );
  };

  // Don't render the destructive CTA when the row is purging/completed —
  // there's nothing left to delete. `cancelled` and `failed` rows let the
  // guardian re-request.
  const showDeleteCta = !status || ['cancelled', 'failed'].includes(status.status);

  const nameMismatch = confirmName.trim() !== studentName.trim();

  return (
    <div className="mt-3">
      {renderPendingBanner()}
      {renderCompletedNote()}
      {showDeleteCta && (
        <div className={status ? 'mt-3' : ''}>
          <Button variant="danger" size="sm" onClick={() => setShowDialog(true)}>
            {t(isHi, "Delete my child's data", 'मेरे बच्चे का डेटा हटाएं')}
          </Button>
        </div>
      )}

      <Dialog
        open={showDialog}
        onClose={() => {
          if (loading) return;
          setShowDialog(false);
          setConfirmName('');
          setReason('');
          setError(null);
        }}
        size="md"
        disableEscapeClose
        disableScrimClose
      >
        <DialogTitle>
          {t(isHi, 'Permanently delete child data?', 'बच्चे का डेटा स्थायी रूप से हटाएं?')}
        </DialogTitle>
        <DialogBody className="space-y-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t(
              isHi,
              "Under DPDP §15 you can request erasure of your child's data. We schedule the deletion 7 days from now so you can change your mind. Once the grace period ends, all learning history, quiz attempts, AI tutor chats, and the account itself are deleted permanently. This cannot be undone.",
              'DPDP §15 के तहत आप अपने बच्चे के डेटा को मिटाने का अनुरोध कर सकते हैं। हम आज से 7 दिन बाद मिटाना निर्धारित करते हैं ताकि आप अपना मन बदल सकें। ग्रेस अवधि समाप्त होने के बाद, सभी सीखने का इतिहास, क्विज़ प्रयास, AI ट्यूटर चैट और स्वयं खाता स्थायी रूप से हटा दिया जाता है। यह वापस नहीं किया जा सकता।',
            )}
          </p>
          <Field
            label={t(
              isHi,
              `Type your child's full name to confirm: ${studentName}`,
              `पुष्टि के लिए अपने बच्चे का पूरा नाम टाइप करें: ${studentName}`,
            )}
            htmlFor="erasure-confirm-name"
          >
            <Input
              id="erasure-confirm-name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label={t(isHi, 'Reason (optional)', 'कारण (वैकल्पिक)')} htmlFor="erasure-reason" optional>
            <Textarea
              id="erasure-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
              rows={3}
            />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setShowDialog(false);
              setConfirmName('');
              setReason('');
              setError(null);
            }}
            disabled={loading}
          >
            {t(isHi, 'Cancel', 'रद्द करें')}
          </Button>
          <Button
            variant="danger"
            onClick={requestErasure}
            loading={loading}
            disabled={loading || nameMismatch}
          >
            {loading
              ? t(isHi, 'Submitting…', 'सबमिट हो रहा है…')
              : t(isHi, 'Schedule deletion in 7 days', '7 दिनों में मिटाना निर्धारित करें')}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
