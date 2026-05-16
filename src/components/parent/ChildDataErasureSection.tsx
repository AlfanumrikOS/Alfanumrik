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
 */

import { useCallback, useEffect, useState } from 'react';

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
      <div
        style={{
          padding: '12px 14px',
          marginTop: 12,
          backgroundColor: '#FEF2F2',
          border: '1px solid #FECACA',
          borderRadius: 10,
        }}
      >
        <p style={{ fontSize: 13, fontWeight: 600, color: '#B91C1C', margin: 0 }}>
          {t(
            isHi,
            `Erasure scheduled for ${formatDate(status.purge_at, isHi)}`,
            `${formatDate(status.purge_at, isHi)} के लिए मिटाना निर्धारित है`,
          )}
        </p>
        <p style={{ fontSize: 12, color: '#7F1D1D', margin: '4px 0 8px' }}>
          {t(
            isHi,
            "All of your child's learning data will be deleted on this date. You can cancel until then.",
            'इस तिथि को आपके बच्चे का सारा डेटा हटा दिया जाएगा। आप तब तक रद्द कर सकते हैं।',
          )}
        </p>
        <button
          onClick={cancelErasure}
          disabled={loading}
          style={{
            padding: '6px 14px',
            backgroundColor: '#FFFFFF',
            color: '#B91C1C',
            border: '1px solid #B91C1C',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading
            ? t(isHi, 'Cancelling…', 'रद्द हो रहा है…')
            : t(isHi, 'Cancel erasure', 'मिटाना रद्द करें')}
        </button>
        {error && (
          <p style={{ fontSize: 11, color: '#B91C1C', margin: '6px 0 0' }}>{error}</p>
        )}
      </div>
    );
  };

  const renderCompletedNote = () => {
    if (!status || status.status !== 'completed') return null;
    return (
      <div
        style={{
          padding: '10px 12px',
          marginTop: 12,
          backgroundColor: '#F3F4F6',
          border: '1px solid #D1D5DB',
          borderRadius: 10,
          fontSize: 12,
          color: '#374151',
        }}
      >
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

  return (
    <div style={{ marginTop: 12 }}>
      {renderPendingBanner()}
      {renderCompletedNote()}
      {showDeleteCta && (
        <button
          onClick={() => setShowDialog(true)}
          style={{
            padding: '7px 16px',
            marginTop: status ? 12 : 0,
            backgroundColor: 'transparent',
            color: '#B91C1C',
            border: '1px solid #B91C1C',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {t(isHi, "Delete my child's data", 'मेरे बच्चे का डेटा हटाएं')}
        </button>
      )}

      {showDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="erasure-dialog-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 12,
              maxWidth: 520,
              width: '100%',
              padding: 24,
            }}
          >
            <h3 id="erasure-dialog-title" style={{ fontSize: 18, fontWeight: 700, color: '#1E293B', margin: '0 0 8px' }}>
              {t(isHi, 'Permanently delete child data?', 'बच्चे का डेटा स्थायी रूप से हटाएं?')}
            </h3>
            <p style={{ fontSize: 13, color: '#475569', margin: '0 0 12px', lineHeight: 1.5 }}>
              {t(
                isHi,
                "Under DPDP §15 you can request erasure of your child's data. We schedule the deletion 7 days from now so you can change your mind. Once the grace period ends, all learning history, quiz attempts, AI tutor chats, and the account itself are deleted permanently. This cannot be undone.",
                'DPDP §15 के तहत आप अपने बच्चे के डेटा को मिटाने का अनुरोध कर सकते हैं। हम आज से 7 दिन बाद मिटाना निर्धारित करते हैं ताकि आप अपना मन बदल सकें। ग्रेस अवधि समाप्त होने के बाद, सभी सीखने का इतिहास, क्विज़ प्रयास, AI ट्यूटर चैट और स्वयं खाता स्थायी रूप से हटा दिया जाता है। यह वापस नहीं किया जा सकता।',
              )}
            </p>
            <label
              htmlFor="erasure-confirm-name"
              style={{ fontSize: 12, fontWeight: 600, color: '#1E293B', display: 'block', marginBottom: 4 }}
            >
              {t(
                isHi,
                `Type your child's full name to confirm: ${studentName}`,
                `पुष्टि के लिए अपने बच्चे का पूरा नाम टाइप करें: ${studentName}`,
              )}
            </label>
            <input
              id="erasure-confirm-name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #CBD5E1',
                borderRadius: 8,
                fontSize: 14,
                marginBottom: 12,
              }}
            />
            <label
              htmlFor="erasure-reason"
              style={{ fontSize: 12, fontWeight: 600, color: '#1E293B', display: 'block', marginBottom: 4 }}
            >
              {t(isHi, 'Reason (optional)', 'कारण (वैकल्पिक)')}
            </label>
            <textarea
              id="erasure-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #CBD5E1',
                borderRadius: 8,
                fontSize: 13,
                resize: 'vertical',
              }}
            />
            {error && (
              <p style={{ fontSize: 12, color: '#B91C1C', margin: '8px 0 0' }}>{error}</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => {
                  setShowDialog(false);
                  setConfirmName('');
                  setReason('');
                  setError(null);
                }}
                disabled={loading}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#FFFFFF',
                  color: '#475569',
                  border: '1px solid #CBD5E1',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: loading ? 'wait' : 'pointer',
                }}
              >
                {t(isHi, 'Cancel', 'रद्द करें')}
              </button>
              <button
                onClick={requestErasure}
                disabled={loading || confirmName.trim() !== studentName.trim()}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#B91C1C',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor:
                    loading || confirmName.trim() !== studentName.trim()
                      ? 'not-allowed'
                      : 'pointer',
                  opacity: confirmName.trim() !== studentName.trim() ? 0.5 : 1,
                }}
              >
                {loading
                  ? t(isHi, 'Submitting…', 'सबमिट हो रहा है…')
                  : t(isHi, 'Schedule deletion in 7 days', '7 दिनों में मिटाना निर्धारित करें')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
