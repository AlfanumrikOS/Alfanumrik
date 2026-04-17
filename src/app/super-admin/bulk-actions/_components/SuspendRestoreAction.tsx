'use client';

import { useState } from 'react';
import { useAdmin } from '../../_components/AdminShell';
import StatusBadge from '../../_components/StatusBadge';
import { colors, S } from '../../_components/admin-styles';

interface BulkResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

interface SuspendRestoreActionProps {
  selectedIds: Set<string>;
}

export default function SuspendRestoreAction({ selectedIds }: SuspendRestoreActionProps) {
  const { apiFetch } = useAdmin();
  const [action, setAction] = useState<'suspend' | 'restore'>('suspend');
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const execute = async () => {
    setShowConfirm(false);
    if (selectedIds.size === 0) return;
    setExecuting(true);
    setResult(null);
    setError('');
    try {
      const res = await apiFetch('/api/super-admin/bulk-actions/suspend-restore', {
        method: 'POST',
        body: JSON.stringify({
          studentIds: Array.from(selectedIds),
          action,
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

  const handleExecuteClick = () => {
    if (action === 'suspend') {
      setShowConfirm(true);
    } else {
      execute();
    }
  };

  return (
    <div style={{ ...S.card, marginTop: 16, borderLeft: `3px solid ${action === 'suspend' ? colors.danger : colors.success}` }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: colors.text1, marginBottom: 12 }}>
        Suspend / Restore
      </h3>

      {selectedIds.size === 0 ? (
        <p style={{ fontSize: 13, color: colors.text3 }}>Select students from the table above to suspend or restore their accounts.</p>
      ) : (
        <>
          <div style={{ fontSize: 13, color: colors.text2, marginBottom: 12 }}>
            <strong>{selectedIds.size}</strong> student{selectedIds.size !== 1 ? 's' : ''} selected
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Action</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => setAction('suspend')}
                  style={{
                    ...S.filterBtn,
                    ...(action === 'suspend' ? { background: colors.danger, color: '#fff', borderColor: colors.danger } : {}),
                  }}
                  data-testid="action-suspend"
                >
                  Suspend
                </button>
                <button
                  onClick={() => setAction('restore')}
                  style={{
                    ...S.filterBtn,
                    ...(action === 'restore' ? { background: colors.success, color: '#fff', borderColor: colors.success } : {}),
                  }}
                  data-testid="action-restore"
                >
                  Restore
                </button>
              </div>
            </div>
            <button
              onClick={handleExecuteClick}
              disabled={executing}
              style={{
                ...(action === 'suspend' ? S.dangerBtn : S.primaryBtn),
                opacity: executing ? 0.6 : 1,
              }}
              data-testid="execute-suspend-restore"
            >
              {executing ? 'Processing...' : `${action === 'suspend' ? 'Suspend' : 'Restore'} ${selectedIds.size} Student${selectedIds.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </>
      )}

      {/* Confirmation dialog */}
      {showConfirm && (
        <>
          <div
            onClick={() => setShowConfirm(false)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
              zIndex: 9998,
            }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: colors.bg, borderRadius: 12, padding: 24,
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)', zIndex: 9999,
            maxWidth: 420, width: '90%',
            border: `1px solid ${colors.border}`,
          }}>
            <h4 style={{ fontSize: 16, fontWeight: 700, color: colors.text1, marginBottom: 8 }}>
              Confirm Suspension
            </h4>
            <p style={{ fontSize: 13, color: colors.text2, marginBottom: 20 }}>
              Are you sure you want to suspend <strong>{selectedIds.size}</strong> student{selectedIds.size !== 1 ? 's' : ''}?
              Suspended students will not be able to log in.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowConfirm(false)} style={S.secondaryBtn}>Cancel</button>
              <button onClick={execute} style={S.dangerBtn} data-testid="confirm-suspend">
                Yes, Suspend
              </button>
            </div>
          </div>
        </>
      )}

      {/* Result display */}
      {result && (
        <div style={{ ...S.cardSurface, marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
            <StatusBadge label={`${result.succeeded} succeeded`} variant="success" />
            {result.failed > 0 && <StatusBadge label={`${result.failed} failed`} variant="danger" />}
          </div>
          <div style={{ fontSize: 12, color: colors.text3 }}>
            Processed: {result.processed}
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
