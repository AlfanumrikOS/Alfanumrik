'use client';

import { useState } from 'react';
import { useAdmin, readAdminJson } from '../../_components/AdminShell';
import StatusBadge from '../../_components/StatusBadge';

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
      const d = await readAdminJson(res);
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
    <div
      className="rounded-lg border border-surface-3 bg-surface-1 p-4"
      style={{ marginTop: 16, borderLeft: '3px solid #16A34A' }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 12 }}>
        Resend Invites
      </h3>

      {selectedIds.size === 0 ? (
        <p style={{ fontSize: 13, color: '#9CA3AF' }}>Select students from the table above to resend their invite emails.</p>
      ) : (
        <>
          <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 12 }}>
            <strong>{selectedIds.size}</strong> student{selectedIds.size !== 1 ? 's' : ''} selected
          </div>

          <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 12 }}>
            This will resend magic-link invite emails to the selected students.
            Emails are sent in batches of 10 with rate limiting.
          </p>

          <button
            onClick={execute}
            disabled={executing}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90"
            style={{ opacity: executing ? 0.6 : 1 }}
            data-testid="execute-resend-invites"
          >
            {executing ? 'Sending...' : `Resend ${selectedIds.size} Invite${selectedIds.size !== 1 ? 's' : ''}`}
          </button>
        </>
      )}

      {/* Result display */}
      {result && (
        <div
          className="rounded-lg border border-surface-3 p-4"
          style={{ marginTop: 12, background: '#F9FAFB' }}
        >
          <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
            <StatusBadge label={`${result.sent} sent`} variant="success" />
            {result.failed > 0 && <StatusBadge label={`${result.failed} failed`} variant="danger" />}
          </div>
          {result.errors.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 600, marginBottom: 4 }}>Errors:</div>
              {result.errors.map((e, i) => (
                <div key={i} style={{ fontSize: 12, color: '#DC2626', padding: '2px 0' }}>{e}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, fontSize: 13, color: '#DC2626' }}>{error}</div>
      )}
    </div>
  );
}
