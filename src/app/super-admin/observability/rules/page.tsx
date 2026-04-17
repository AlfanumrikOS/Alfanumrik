'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { colors, S } from '../../_components/admin-styles';

/* ── Types ─────────────────────────────────────────────── */

interface AlertRule {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  category: string | null;
  source: string | null;
  min_severity: string;
  count_threshold: number;
  window_minutes: number;
  channel_ids: string[];
  cooldown_minutes: number;
  created_at: string;
  updated_at: string;
  last_fired: string | null;
}

interface TestResult {
  dryRun: boolean;
  wouldFire: boolean;
  matchedCount: number;
  threshold: number;
  message: string;
}

interface RuleFormData {
  name: string;
  description: string;
  category: string;
  source: string;
  min_severity: string;
  count_threshold: number;
  window_minutes: number;
  cooldown_minutes: number;
  channel_ids: string[];
  enabled: boolean;
}

interface Channel {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
}

const EMPTY_FORM: RuleFormData = {
  name: '',
  description: '',
  category: '',
  source: '',
  min_severity: 'error',
  count_threshold: 5,
  window_minutes: 10,
  cooldown_minutes: 15,
  channel_ids: [],
  enabled: false,
};

const CATEGORIES = ['', 'ai', 'payment', 'auth', 'health', 'deployment', 'admin_action', 'content'];
const SEVERITIES = ['info', 'warning', 'error', 'critical'];

/* ── Helpers ───────────────────────────────────────────── */

function severityColor(sev: string): string {
  switch (sev) {
    case 'critical': return colors.danger;
    case 'error': return '#DC2626';
    case 'warning': return colors.warning;
    default: return colors.accent;
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ── Content ───────────────────────────────────────────── */

function RulesContent() {
  const { apiFetch } = useAdmin();

  const fetcher = useCallback(
    async (url: string) => {
      const res = await apiFetch(url);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    [apiFetch],
  );

  const { data, error, isLoading, mutate } = useSWR(
    '/api/super-admin/observability/rules',
    fetcher,
  );

  const { data: channelsData } = useSWR(
    '/api/super-admin/observability/channels',
    fetcher,
  );

  const rules: AlertRule[] = data?.data ?? [];
  const channels: Channel[] = channelsData?.data ?? [];

  const [testResults, setTestResults] = useState<Record<string, TestResult | null>>({});
  const [testLoading, setTestLoading] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormData>(EMPTY_FORM);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  /* ── Actions ─────── */

  const handleTest = async (ruleId: string) => {
    setTestLoading(prev => ({ ...prev, [ruleId]: true }));
    setTestResults(prev => ({ ...prev, [ruleId]: null }));
    try {
      const res = await apiFetch(`/api/super-admin/observability/rules/${ruleId}/test`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) {
        setActionError(json.error || 'Test failed');
        return;
      }
      setTestResults(prev => ({ ...prev, [ruleId]: json }));
    } catch {
      setActionError('Test request failed');
    } finally {
      setTestLoading(prev => ({ ...prev, [ruleId]: false }));
    }
  };

  const handleToggle = async (rule: AlertRule) => {
    const newEnabled = !rule.enabled;
    if (newEnabled && rule.channel_ids.length === 0) {
      setActionError('Add channels before enabling this rule.');
      return;
    }
    setActionError(null);
    try {
      const res = await apiFetch(`/api/super-admin/observability/rules/${rule.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: newEnabled }),
      });
      const json = await res.json();
      if (!res.ok) {
        setActionError(json.error || 'Toggle failed');
        return;
      }
      mutate();
    } catch {
      setActionError('Toggle request failed');
    }
  };

  const handleDelete = async (ruleId: string) => {
    try {
      const res = await apiFetch(`/api/super-admin/observability/rules/${ruleId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json();
        setActionError(json.error || 'Delete failed');
        return;
      }
      setDeleteConfirm(null);
      mutate();
    } catch {
      setActionError('Delete request failed');
    }
  };

  const openEdit = (rule: AlertRule) => {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      description: rule.description || '',
      category: rule.category || '',
      source: rule.source || '',
      min_severity: rule.min_severity,
      count_threshold: rule.count_threshold,
      window_minutes: rule.window_minutes,
      cooldown_minutes: rule.cooldown_minutes,
      channel_ids: rule.channel_ids,
      enabled: rule.enabled,
    });
    setFormError(null);
    setShowForm(true);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    setFormSaving(true);
    setFormError(null);
    try {
      const url = editingId
        ? `/api/super-admin/observability/rules/${editingId}`
        : '/api/super-admin/observability/rules';
      const method = editingId ? 'PATCH' : 'POST';

      const payload = {
        name: form.name,
        description: form.description || null,
        category: form.category || null,
        source: form.source || null,
        min_severity: form.min_severity,
        count_threshold: form.count_threshold,
        window_minutes: form.window_minutes,
        cooldown_minutes: form.cooldown_minutes,
        channel_ids: form.channel_ids,
        enabled: form.enabled,
      };

      const res = await apiFetch(url, { method, body: JSON.stringify(payload) });
      const json = await res.json();

      if (!res.ok) {
        setFormError(json.error || 'Save failed');
        return;
      }

      setShowForm(false);
      mutate();
    } catch {
      setFormError('Save request failed');
    } finally {
      setFormSaving(false);
    }
  };

  const toggleChannelInForm = (chId: string) => {
    setForm(prev => ({
      ...prev,
      channel_ids: prev.channel_ids.includes(chId)
        ? prev.channel_ids.filter(c => c !== chId)
        : [...prev.channel_ids, chId],
    }));
  };

  /* ── Render ──────── */

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={S.h1}>Alert Rules</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            Define threshold-based alerting on ops events
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/super-admin/observability/channels" style={{ ...S.secondaryBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
            Channels
          </a>
          <a href="/super-admin/observability" style={{ ...S.secondaryBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
            Timeline
          </a>
          <button onClick={openCreate} style={S.primaryBtn}>+ New Rule</button>
        </div>
      </div>

      {/* Action error */}
      {actionError && (
        <div style={{ padding: '10px 14px', background: colors.dangerLight, color: colors.danger, fontSize: 13, borderRadius: 6, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} style={{ background: 'none', border: 'none', color: colors.danger, cursor: 'pointer', fontWeight: 600 }}>x</button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 13 }}>
          Loading rules...
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div style={{ padding: 16, color: colors.danger, fontSize: 13, background: colors.dangerLight, borderRadius: 8 }}>
          Failed to load rules. <button onClick={() => mutate()} style={{ ...S.actionBtn, marginLeft: 8 }}>Retry</button>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && rules.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 13, border: `1px solid ${colors.border}`, borderRadius: 8 }}>
          No alert rules configured yet. Click "+ New Rule" to create one.
        </div>
      )}

      {/* Rules list */}
      {rules.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rules.map(rule => (
            <div key={rule.id} style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                {/* Left: status + info */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1 }}>
                  {/* Enabled dot */}
                  <div
                    style={{
                      width: 10, height: 10, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                      background: rule.enabled ? colors.success : colors.text3,
                    }}
                    title={rule.enabled ? 'Enabled' : 'Disabled'}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: colors.text1 }}>{rule.name}</div>
                    {rule.description && (
                      <div style={{ fontSize: 12, color: colors.text2, marginTop: 2 }}>{rule.description}</div>
                    )}
                    <div style={{ fontSize: 12, color: colors.text3, marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                      {rule.category && (
                        <span>Category: <strong style={{ color: colors.text2 }}>{rule.category}</strong></span>
                      )}
                      <span>
                        Severity: <strong style={{ color: severityColor(rule.min_severity) }}>{rule.min_severity}+</strong>
                      </span>
                      <span>
                        Threshold: <strong style={{ color: colors.text2 }}>{rule.count_threshold}</strong> in <strong style={{ color: colors.text2 }}>{rule.window_minutes}m</strong>
                      </span>
                      <span>
                        Cooldown: <strong style={{ color: colors.text2 }}>{rule.cooldown_minutes}m</strong>
                      </span>
                      <span>
                        Channels: <strong style={{ color: colors.text2 }}>{rule.channel_ids.length}</strong>
                      </span>
                      {rule.last_fired && (
                        <span>
                          Last fired: <strong style={{ color: colors.text2 }}>{timeAgo(rule.last_fired)}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: actions */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => handleTest(rule.id)}
                    disabled={testLoading[rule.id]}
                    style={S.actionBtn}
                    title="Dry-run test"
                  >
                    {testLoading[rule.id] ? '...' : 'Test'}
                  </button>
                  <button
                    onClick={() => handleToggle(rule)}
                    style={{
                      ...S.actionBtn,
                      color: rule.enabled ? colors.warning : colors.success,
                      borderColor: rule.enabled ? colors.warning : colors.success,
                    }}
                  >
                    {rule.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => openEdit(rule)}
                    style={S.actionBtn}
                  >
                    Edit
                  </button>
                  {deleteConfirm === rule.id ? (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => handleDelete(rule.id)}
                        style={{ ...S.actionBtn, color: colors.danger, borderColor: colors.danger }}
                      >
                        Confirm
                      </button>
                      <button onClick={() => setDeleteConfirm(null)} style={S.actionBtn}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(rule.id)}
                      style={{ ...S.actionBtn, color: colors.danger, borderColor: colors.danger }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {/* Test result */}
              {testResults[rule.id] && (
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    fontSize: 12,
                    background: testResults[rule.id]!.wouldFire ? colors.warningLight : colors.successLight,
                    color: testResults[rule.id]!.wouldFire ? colors.warning : colors.success,
                    border: `1px solid ${testResults[rule.id]!.wouldFire ? colors.warning : colors.success}`,
                  }}
                >
                  {testResults[rule.id]!.message}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Form Modal */}
      {showForm && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}
        >
          <div style={{ background: colors.bg, borderRadius: 12, padding: 24, width: 520, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
            <h2 style={{ ...S.h1, marginBottom: 16 }}>
              {editingId ? 'Edit Rule' : 'New Alert Rule'}
            </h2>

            {formError && (
              <div style={{ padding: '8px 12px', background: colors.dangerLight, color: colors.danger, fontSize: 13, borderRadius: 6, marginBottom: 12 }}>
                {formError}
              </div>
            )}

            {/* Name */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: colors.text2, display: 'block', marginBottom: 4 }}>Name</label>
              <input
                style={{ ...S.searchInput, width: '100%' }}
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Payment error spike"
              />
            </div>

            {/* Description */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: colors.text2, display: 'block', marginBottom: 4 }}>Description</label>
              <input
                style={{ ...S.searchInput, width: '100%' }}
                value={form.description}
                onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Optional description"
              />
            </div>

            {/* Category + Source */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.text2, display: 'block', marginBottom: 4 }}>Category</label>
                <select
                  style={{ ...S.select, width: '100%' }}
                  value={form.category}
                  onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))}
                >
                  <option value="">Any category</option>
                  {CATEGORIES.filter(Boolean).map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.text2, display: 'block', marginBottom: 4 }}>Source</label>
                <input
                  style={{ ...S.searchInput, width: '100%' }}
                  value={form.source}
                  onChange={e => setForm(prev => ({ ...prev, source: e.target.value }))}
                  placeholder="Any source"
                />
              </div>
            </div>

            {/* Severity + Threshold */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.text2, display: 'block', marginBottom: 4 }}>Min Severity</label>
                <select
                  style={{ ...S.select, width: '100%' }}
                  value={form.min_severity}
                  onChange={e => setForm(prev => ({ ...prev, min_severity: e.target.value }))}
                >
                  {SEVERITIES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.text2, display: 'block', marginBottom: 4 }}>Count Threshold</label>
                <input
                  type="number"
                  min={1}
                  style={{ ...S.searchInput, width: '100%' }}
                  value={form.count_threshold}
                  onChange={e => setForm(prev => ({ ...prev, count_threshold: parseInt(e.target.value) || 1 }))}
                />
              </div>
            </div>

            {/* Window + Cooldown */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.text2, display: 'block', marginBottom: 4 }}>Window (minutes)</label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  style={{ ...S.searchInput, width: '100%' }}
                  value={form.window_minutes}
                  onChange={e => setForm(prev => ({ ...prev, window_minutes: parseInt(e.target.value) || 1 }))}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.text2, display: 'block', marginBottom: 4 }}>Cooldown (minutes)</label>
                <input
                  type="number"
                  min={0}
                  style={{ ...S.searchInput, width: '100%' }}
                  value={form.cooldown_minutes}
                  onChange={e => setForm(prev => ({ ...prev, cooldown_minutes: parseInt(e.target.value) || 0 }))}
                />
              </div>
            </div>

            {/* Channels selection */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: colors.text2, display: 'block', marginBottom: 4 }}>
                Channels {channels.length === 0 && <span style={{ fontWeight: 400, color: colors.text3 }}>(none configured)</span>}
              </label>
              {channels.length === 0 ? (
                <div style={{ fontSize: 12, color: colors.text3 }}>
                  <a href="/super-admin/observability/channels" style={{ color: colors.accent }}>Create a channel</a> before assigning one to a rule.
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {channels.map(ch => {
                    const selected = form.channel_ids.includes(ch.id);
                    return (
                      <button
                        key={ch.id}
                        onClick={() => toggleChannelInForm(ch.id)}
                        style={{
                          ...S.filterBtn,
                          ...(selected ? S.filterActive : {}),
                          fontSize: 12,
                          padding: '5px 10px',
                          opacity: ch.enabled ? 1 : 0.5,
                        }}
                        title={ch.enabled ? ch.type : `${ch.type} (disabled)`}
                      >
                        {ch.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Enabled toggle */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={e => setForm(prev => ({ ...prev, enabled: e.target.checked }))}
                />
                <span style={{ fontWeight: 600, color: colors.text2 }}>Enable rule immediately</span>
              </label>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setShowForm(false)} style={S.secondaryBtn}>Cancel</button>
              <button onClick={handleSubmit} disabled={formSaving} style={S.primaryBtn}>
                {formSaving ? 'Saving...' : (editingId ? 'Update' : 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AlertRulesPage() {
  return (
    <AdminShell>
      <RulesContent />
    </AdminShell>
  );
}