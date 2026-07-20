'use client';

import { useState } from 'react';
import { useAdmin, readAdminJson } from '../../_components/AdminShell';
import StatusBadge from '../../_components/StatusBadge';

interface BulkResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

interface PlanChangeActionProps {
  selectedIds: Set<string>;
}

const TARGET_PLANS = [
  { value: 'free', label: 'Free' },
  { value: 'starter', label: 'Starter' },
  { value: 'pro', label: 'Pro' },
  { value: 'unlimited', label: 'Ultimate' },
];

const selectStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid #E5E7EB',
  background: '#FFFFFF',
  color: '#111827',
  fontSize: 13,
  outline: 'none',
  cursor: 'pointer',
};

export default function PlanChangeAction({ selectedIds }: PlanChangeActionProps) {
  const { apiFetch } = useAdmin();
  const [targetPlan, setTargetPlan] = useState('free');
  const [action, setAction] = useState<'upgrade_plan' | 'downgrade_plan'>('upgrade_plan');
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState('');

  const execute = async () => {
    if (selectedIds.size === 0) return;
    setExecuting(true);
    setResult(null);
    setError('');
    try {
      const res = await apiFetch('/api/super-admin/bulk-actions/plan-change', {
        method: 'POST',
        body: JSON.stringify({
          studentIds: Array.from(selectedIds),
          targetPlan,
          action,
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
      style={{ marginTop: 16, borderLeft: '3px solid #2563EB' }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 12 }}>
        Plan Change
      </h3>

      {selectedIds.size === 0 ? (
        <p style={{ fontSize: 13, color: '#9CA3AF' }}>Select students from the table above to change their plan.</p>
      ) : (
        <>
          <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 12 }}>
            <strong>{selectedIds.size}</strong> student{selectedIds.size !== 1 ? 's' : ''} selected
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: 11, color: '#9CA3AF', display: 'block', marginBottom: 4 }}>Target Plan</label>
              <select
                value={targetPlan}
                onChange={e => setTargetPlan(e.target.value)}
                style={selectStyle}
                data-testid="target-plan"
              >
                {TARGET_PLANS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#9CA3AF', display: 'block', marginBottom: 4 }}>Action Type</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#111827', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="plan-action"
                    value="upgrade_plan"
                    checked={action === 'upgrade_plan'}
                    onChange={() => setAction('upgrade_plan')}
                  />
                  Upgrade
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#111827', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="plan-action"
                    value="downgrade_plan"
                    checked={action === 'downgrade_plan'}
                    onChange={() => setAction('downgrade_plan')}
                  />
                  Downgrade
                </label>
              </div>
            </div>
            <button
              onClick={execute}
              disabled={executing}
              className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90"
              style={{ opacity: executing ? 0.6 : 1 }}
              data-testid="execute-plan-change"
            >
              {executing ? 'Processing...' : `Apply ${action === 'upgrade_plan' ? 'Upgrade' : 'Downgrade'}`}
            </button>
          </div>
        </>
      )}

      {/* Result display */}
      {result && (
        <div
          className="rounded-lg border border-surface-3 p-4"
          style={{ marginTop: 12, background: '#F9FAFB' }}
        >
          <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
            <StatusBadge label={`${result.succeeded} succeeded`} variant="success" />
            {result.failed > 0 && <StatusBadge label={`${result.failed} failed`} variant="danger" />}
          </div>
          <div style={{ fontSize: 12, color: '#9CA3AF' }}>
            Processed: {result.processed}
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
