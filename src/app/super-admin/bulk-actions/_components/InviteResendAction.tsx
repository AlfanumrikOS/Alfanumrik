'use client';

import { useState } from 'react';
import { useAdmin } from '../../_components/AdminShell';
import StatusBadge from '../../_components/StatusBadge';
import { colors, S } from '../../_components/admin-styles';

interface InviteResult {
  sent: number;
  failed: number;
  errors: string[];
}

interface InviteResendActionProps {
  selectedIds: Set<string>;
}

export default function InviteResendAction({ selectedIds }: InviteResendActionProps) {
  const { apiFetch } = useAdmin();
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [error, setError] = useState('');

  const execute = async () => {
    if (selectedIds.size === 0) return;
    setExecuting(true);
    setResult(null);
    setError('');
    try {
      const res = await apiFetch('/api/super-admin/bulk-actions/resend-invites', {
        method: 'POST',
        body: JSON.stringify({
          studentIds: Array.from(selectedIds),
        }),
      });
      const d = await res.json();
      if (d.success) {
        setResult(d.data);
      } else {
        setError(d.error || 'Request failed');
      }
    } catch {
      setError('Network error');
    }
    setExecuting(false);
  };

  return (
    <div style={{ ...S.card, marginTop: 16, borderLeft: `3px solid ${colors.success}` }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: colors.text1, marginBottom: 12 }}>
        Resend Invites
      </h3>

      {selectedIds.size === 0 ? (
        <p style={{ fontSize: 13, color: colors.text3 }}>Select students from the table above to resend their invite emails.</p>
      ) : (
        <>
          <div style={{ fontSize: 13, color: colors.text2, marginBottom: 12 }}>
            <strong>{selectedIds.size}</strong> student{selectedIds.size !== 1 ? 's' : ''} selected
          </div>

          <p style={{ fontSize: 12, color: colors.text3, marginBottom: 12 }}>
            This will resend magic-link invite emails to the selected students.
            Emails are sent in batches of 10 with rate limiting.
          </p>

          <button
            onClick={execute}
            disabled={executing}
            style={{ ...S.primaryBtn, opacity: executing ? 0.6 : 1 }}
            data-testid="execute-resend-invites"
          >
            {executing ? 'Sending...' : `Resend ${selectedIds.size} Invite${selectedIds.size !== 1 ? 's' : ''}`}
          </button>
        </>
      )}

      {/* Result display */}
      {result && (
        <div style={{ ...S.cardSurface, marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
            <StatusBadge label={`${result.sent} sent`} variant="success" />
            {result.failed > 0 && <StatusBadge label={`${result.failed} failed`} variant="danger" />}
          </div>
          {result.errors.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: colors.danger, fontWeight: 600, marginBottom: 4 }}>Errors:</div>
              {result.errors.map((e, i) => (
                <div key={i} style={{ fontSize: 12, color: colors.danger, padding: '2px 0' }}>{e}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, fontSize: 13, color: colors.danger }}>{error}</div>
      )}
    </div>
  );
}
