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

interface PlanChangeActionProps {
  selectedIds: Set<string>;
}

const TARGET_PLANS = [
  { value: 'free', label: 'Free' },
  { value: 'starter', label: 'Starter' },
  { value: 'pro', label: 'Pro' },
  { value: 'unlimited', label: 'Ultimate' },
];

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
    <div style={{ ...S.card, marginTop: 16, borderLeft: `3px solid ${colors.accent}` }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: colors.text1, marginBottom: 12 }}>
        Plan Change
      </h3>

      {selectedIds.size === 0 ? (
        <p style={{ fontSize: 13, color: colors.text3 }}>Select students from the table above to change their plan.</p>
      ) : (
        <>
          <div style={{ fontSize: 13, color: colors.text2, marginBottom: 12 }}>
            <strong>{selectedIds.size}</strong> student{selectedIds.size !== 1 ? 's' : ''} selected
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Target Plan</label>
              <select
                value={targetPlan}
                onChange={e => setTargetPlan(e.target.value)}
                style={S.select}
                data-testid="target-plan"
              >
                {TARGET_PLANS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Action Type</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: colors.text1, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="plan-action"
                    value="upgrade_plan"
                    checked={action === 'upgrade_plan'}
                    onChange={() => setAction('upgrade_plan')}
                  />
                  Upgrade
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: colors.text1, cursor: 'pointer' }}>
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
              style={{ ...S.primaryBtn, opacity: executing ? 0.6 : 1 }}
              data-testid="execute-plan-change"
            >
              {executing ? 'Processing...' : `Apply ${action === 'upgrade_plan' ? 'Upgrade' : 'Downgrade'}`}
            </button>
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
