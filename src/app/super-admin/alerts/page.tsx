'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import DataTable, { Column } from '../_components/DataTable';
import StatusBadge from '../_components/StatusBadge';
import { colors, S } from '../_components/admin-styles';

// ── Types ──

interface AlertRule {
  id: string;
  school_id: string | null;
  school_name: string | null;
  scope: string;
  rule_type: string;
  threshold: number;
  is_active: boolean;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

interface SchoolOption {
  id: string;
  name: string;
}

const RULE_TYPE_LABELS: Record<string, string> = {
  error_rate: 'Error Rate',
  engagement_drop: 'Engagement Drop',
  payment_failure: 'Payment Failure',
  ai_budget: 'AI Budget',
  seat_limit: 'Seat Limit',
};

const RULE_TYPE_UNITS: Record<string, string> = {
  error_rate: '%',
  engagement_drop: '%',
  payment_failure: 'failures',
  ai_budget: '%',
  seat_limit: '%',
};

const TEMPLATES = [
  { label: 'Error rate > 5%', rule_type: 'error_rate', threshold: 5 },
  { label: 'Engagement drop > 20%', rule_type: 'engagement_drop', threshold: 20 },
  { label: 'Seat utilization > 90%', rule_type: 'seat_limit', threshold: 90 },
  { label: 'AI budget > 80%', rule_type: 'ai_budget', threshold: 80 },
  { label: 'Payment failures > 3', rule_type: 'payment_failure', threshold: 3 },
];

// ── Content ──

function AlertsContent() {
  const { apiFetch } = useAdmin();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [schools, setSchools] = useState<SchoolOption[]>([]);

  // Form state
  const [formRuleType, setFormRuleType] = useState('error_rate');
  const [formThreshold, setFormThreshold] = useState(5);
  const [formSchoolId, setFormSchoolId] = useState<string>('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/alerts');
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const json = await res.json();
      setRules(json.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  const fetchSchools = useCallback(async () => {
    try {
      const res = await apiFetch('/api/super-admin/institutions?limit=100');
      if (res.ok) {
        const json = await res.json();
        setSchools((json.data || []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })));
      }
    } catch { /* non-critical */ }
  }, [apiFetch]);

  useEffect(() => { fetchRules(); fetchSchools(); }, [fetchRules, fetchSchools]);

  const toggleRule = async (rule: AlertRule) => {
    try {
      await apiFetch('/api/super-admin/alerts', {
        method: 'PATCH',
        body: JSON.stringify({ id: rule.id, is_active: !rule.is_active }),
      });
      fetchRules();
    } catch { /* refresh will show current state */ }
  };

  const deleteRule = async (rule: AlertRule) => {
    if (!window.confirm(`Delete "${RULE_TYPE_LABELS[rule.rule_type] || rule.rule_type}" rule?`)) return;
    try {
      await apiFetch('/api/super-admin/alerts', {
        method: 'DELETE',
        body: JSON.stringify({ id: rule.id }),
      });
      fetchRules();
    } catch { /* refresh will show current state */ }
  };

  const createRule = async () => {
    setFormSubmitting(true);
    try {
      const res = await apiFetch('/api/super-admin/alerts', {
        method: 'POST',
        body: JSON.stringify({
          rule_type: formRuleType,
          threshold: formThreshold,
          school_id: formSchoolId || null,
        }),
      });
      if (res.ok) {
        setShowModal(false);
        setFormRuleType('error_rate');
        setFormThreshold(5);
        setFormSchoolId('');
        fetchRules();
      } else {
        const body = await res.json().catch(() => ({ error: 'Create failed' }));
        alert(body.error || 'Failed to create rule');
      }
    } catch {
      alert('Failed to create rule');
    } finally {
      setFormSubmitting(false);
    }
  };

  const applyTemplate = (template: typeof TEMPLATES[0]) => {
    setFormRuleType(template.rule_type);
    setFormThreshold(template.threshold);
    setShowModal(true);
  };

  const columns: Column<AlertRule>[] = [
    {
      key: 'rule_type', label: 'Type',
      render: r => <strong style={{ color: colors.text1 }}>{RULE_TYPE_LABELS[r.rule_type] || r.rule_type}</strong>,
    },
    {
      key: 'threshold', label: 'Threshold',
      render: r => <span style={{ fontWeight: 600 }}>{r.threshold}{RULE_TYPE_UNITS[r.rule_type] || ''}</span>,
    },
    {
      key: 'scope', label: 'Scope',
      render: r => (
        <StatusBadge
          label={r.school_name ? r.school_name : 'Global'}
          variant={r.school_id ? 'info' : 'neutral'}
        />
      ),
    },
    {
      key: 'is_active', label: 'Status',
      render: r => (
        <StatusBadge
          label={r.is_active ? 'Active' : 'Inactive'}
          variant={r.is_active ? 'success' : 'neutral'}
        />
      ),
    },
    {
      key: 'last_triggered_at', label: 'Last Triggered',
      render: r => (
        <span style={{ color: colors.text3, fontSize: 12 }}>
          {r.last_triggered_at ? new Date(r.last_triggered_at).toLocaleDateString() : 'Never'}
        </span>
      ),
    },
    {
      key: '_actions', label: 'Actions', sortable: false,
      render: r => (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={e => { e.stopPropagation(); toggleRule(r); }}
            style={{
              ...S.actionBtn,
              color: r.is_active ? colors.warning : colors.success,
              borderColor: r.is_active ? colors.warning : colors.success,
            }}
          >
            {r.is_active ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={e => { e.stopPropagation(); deleteRule(r); }}
            style={{ ...S.actionBtn, color: colors.danger, borderColor: colors.danger }}
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ color: colors.danger, fontSize: 14, marginBottom: 12 }}>{error}</div>
        <button onClick={fetchRules} style={S.secondaryBtn}>Retry</button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={S.h1}>Alert Rules</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            Configure monitoring alerts for error rates, engagement, payments, and resource usage
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchRules} style={S.secondaryBtn}>&#8635; Refresh</button>
          <button onClick={() => setShowModal(true)} style={S.primaryBtn}>+ Add Rule</button>
        </div>
      </div>

      {/* Quick Templates */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: colors.text3, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
          Quick Templates
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TEMPLATES.map(t => (
            <button
              key={t.label}
              onClick={() => applyTemplate(t)}
              style={{
                ...S.filterBtn,
                fontSize: 12,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <div style={S.card}>
          <div style={{ fontSize: 24, fontWeight: 800, color: colors.text1 }}>{rules.length}</div>
          <div style={{ fontSize: 11, color: colors.text3, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>Total Rules</div>
        </div>
        <div style={S.card}>
          <div style={{ fontSize: 24, fontWeight: 800, color: colors.success }}>{rules.filter(r => r.is_active).length}</div>
          <div style={{ fontSize: 11, color: colors.text3, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>Active</div>
        </div>
        <div style={S.card}>
          <div style={{ fontSize: 24, fontWeight: 800, color: colors.warning }}>{rules.filter(r => r.last_triggered_at).length}</div>
          <div style={{ fontSize: 11, color: colors.text3, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>Triggered</div>
        </div>
      </div>

      {/* Rules Table */}
      <DataTable
        columns={columns}
        data={rules}
        keyField="id"
        loading={loading}
        emptyMessage="No alert rules configured yet. Use templates above to get started."
      />

      {/* Add Rule Modal */}
      {showModal && (
        <>
          <div
            onClick={() => setShowModal(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 999 }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: colors.bg, borderRadius: 12, padding: 28, width: 440,
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)', zIndex: 1000,
            border: `1px solid ${colors.border}`,
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20, color: colors.text1 }}>Add Alert Rule</h3>

            {/* Rule Type */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: colors.text2, display: 'block', marginBottom: 6 }}>
                Rule Type
              </label>
              <select
                value={formRuleType}
                onChange={e => setFormRuleType(e.target.value)}
                style={{ ...S.select, width: '100%' }}
              >
                {Object.entries(RULE_TYPE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>

            {/* Threshold */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: colors.text2, display: 'block', marginBottom: 6 }}>
                Threshold ({RULE_TYPE_UNITS[formRuleType] || ''})
              </label>
              <input
                type="number"
                value={formThreshold}
                onChange={e => setFormThreshold(Number(e.target.value))}
                min={0}
                max={100}
                style={{ ...S.searchInput, width: '100%' }}
              />
            </div>

            {/* Scope */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: colors.text2, display: 'block', marginBottom: 6 }}>
                Scope (leave empty for global)
              </label>
              <select
                value={formSchoolId}
                onChange={e => setFormSchoolId(e.target.value)}
                style={{ ...S.select, width: '100%' }}
              >
                <option value="">Global (all schools)</option>
                {schools.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={S.secondaryBtn}>Cancel</button>
              <button
                onClick={createRule}
                disabled={formSubmitting}
                style={{ ...S.primaryBtn, opacity: formSubmitting ? 0.6 : 1 }}
              >
                {formSubmitting ? 'Creating...' : 'Create Rule'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function AlertsPage() {
  return <AdminShell><AlertsContent /></AdminShell>;
}
