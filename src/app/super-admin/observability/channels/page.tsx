'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { colors, S } from '../../_components/admin-styles';

/* ── Types ─────────────────────────────────────────────── */

interface Channel {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface TestResult {
  ok: boolean;
  detail: string;
}

interface ChannelFormData {
  name: string;
  type: string;
  webhook_url: string;
  email_to: string;
  enabled: boolean;
}

const EMPTY_FORM: ChannelFormData = {
  name: '',
  type: 'slack_webhook',
  webhook_url: '',
  email_to: '',
  enabled: true,
};

const TYPE_LABELS: Record<string, string> = {
  slack_webhook: 'Slack Webhook',
  email: 'Email',
};

/* ── Helpers ───────────────────────────────────────────── */

function typeBadge(type: string): { label: string; bg: string; color: string } {
  switch (type) {
    case 'slack_webhook':
      return { label: 'Slack', bg: '#E8D5F5', color: '#6B21A8' };
    case 'email':
      return { label: 'Email', bg: colors.accentLight, color: colors.accent };
    default:
      return { label: type, bg: colors.surface, color: colors.text2 };
  }
}

function configPreview(config: Record<string, unknown>, type: string): string {
  if (type === 'slack_webhook' && config.webhook_url) {
    return String(config.webhook_url);
  }
  if (type === 'email' && config.to) {
    return String(config.to);
  }
  return JSON.stringify(config);
}

/* ── Content ───────────────────────────────────────────── */

function ChannelsContent() {
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
    '/api/super-admin/observability/channels',
    fetcher,
  );

  const channels: Channel[] = data?.data ?? [];

  const [testResults, setTestResults] = useState<Record<string, TestResult | null>>({});
  const [testLoading, setTestLoading] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ChannelFormData>(EMPTY_FORM);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  /* ── Actions ─────── */

  const handleTest = async (channelId: string) => {
    setTestLoading(prev => ({ ...prev, [channelId]: true }));
    setTestResults(prev => ({ ...prev, [channelId]: null }));
    try {
      const res = await apiFetch(`/api/super-admin/observability/channels/${channelId}/test`, {
        method: 'POST',
      });
      const json = await res.json();
      if (json.error) {
        setTestResults(prev => ({ ...prev, [channelId]: { ok: false, detail: json.error } }));
      } else {
        setTestResults(prev => ({ ...prev, [channelId]: json }));
      }
    } catch {
      setTestResults(prev => ({ ...prev, [channelId]: { ok: false, detail: 'Request failed' } }));
    } finally {
      setTestLoading(prev => ({ ...prev, [channelId]: false }));
    }
  };

  const handleToggle = async (channel: Channel) => {
    setActionError(null);
    try {
      const res = await apiFetch(`/api/super-admin/observability/channels/${channel.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !channel.enabled }),
      });
      if (!res.ok) {
        const json = await res.json();
        setActionError(json.error || 'Toggle failed');
        return;
      }
      mutate();
    } catch {
      setActionError('Toggle request failed');
    }
  };

  const handleDelete = async (channelId: string) => {
    try {
      const res = await apiFetch(`/api/super-admin/observability/channels/${channelId}`, {
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

  const handleSubmit = async () => {
    setFormSaving(true);
    setFormError(null);
    try {
      const config: Record<string, unknown> = {};
      if (form.type === 'slack_webhook') {
        config.webhook_url = form.webhook_url;
      } else if (form.type === 'email') {
        config.to = form.email_to;
      }

      const payload = {
        name: form.name,
        type: form.type,
        config,
        enabled: form.enabled,
      };

      const res = await apiFetch('/api/super-admin/observability/channels', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!res.ok) {
        setFormError(json.error || 'Create failed');
        return;
      }

      setShowForm(false);
      setForm(EMPTY_FORM);
      mutate();
    } catch {
      setFormError('Create request failed');
    } finally {
      setFormSaving(false);
    }
  };

  /* ── Render ──────── */

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={S.h1}>Notification Channels</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            Configure delivery targets for alert rules
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/super-admin/observability/rules" style={{ ...S.secondaryBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
            Rules
          </a>
          <a href="/super-admin/observability" style={{ ...S.secondaryBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
            Timeline
          </a>
          <button onClick={() => { setForm(EMPTY_FORM); setFormError(null); setShowForm(true); }} style={S.primaryBtn}>
            + New Channel
          </button>
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
          Loading channels...
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div style={{ padding: 16, color: colors.danger, fontSize: 13, background: colors.dangerLight, borderRadius: 8 }}>
          Failed to load channels. <button onClick={() => mutate()} style={{ ...S.actionBtn, marginLeft: 8 }}>Retry</button>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && channels.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 13, border: `1px solid ${colors.border}`, borderRadius: 8 }}>
          No notification channels configured yet. Click "+ New Channel" to create one.
        </div>
      )}

      {/* Channels list */}
      {channels.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {channels.map(ch => {
            const badge = typeBadge(ch.type);
            return (
              <div key={ch.id} style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {/* Left: status + info */}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1 }}>
                    {/* Enabled dot */}
                    <div
                      style={{
                        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                        background: ch.enabled ? colors.success : colors.text3,
                      }}
                      title={ch.enabled ? 'Enabled' : 'Disabled'}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: colors.text1 }}>{ch.name}</span>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                          background: badge.bg, color: badge.color,
                        }}>
                          {badge.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: colors.text3, marginTop: 2, fontFamily: 'monospace' }}>
                        {configPreview(ch.config, ch.type)}
                      </div>
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => handleTest(ch.id)}
                      disabled={testLoading[ch.id]}
                      style={S.actionBtn}
                      title="Send test message"
                    >
                      {testLoading[ch.id] ? '...' : 'Test'}
                    </button>
                    <button
                      onClick={() => handleToggle(ch)}
                      style={{
                        ...S.actionBtn,
                        color: ch.enabled ? colors.warning : colors.success,
                        borderColor: ch.enabled ? colors.warning : colors.success,
                      }}
                    >
                      {ch.enabled ? 'Disable' : 'Enable'}
                    </button>
                    {deleteConfirm === ch.id ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          onClick={() => handleDelete(ch.id)}
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
                        onClick={() => setDeleteConfirm(ch.id)}
                        style={{ ...S.actionBtn, color: colors.danger, borderColor: colors.danger }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {/* Test result inline */}
                {testResults[ch.id] && (
                  <div
                    style={{
                      padding: '8px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      background: testResults[ch.id]!.ok ? colors.successLight : colors.dangerLight,
                      color: testResults[ch.id]!.ok ? colors.success : colors.danger,
                      border: `1px solid ${testResults[ch.id]!.ok ? colors.success : colors.danger}`,
                    }}
                  >
                    {testResults[ch.id]!.detail}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Form Modal */}
      {showForm && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}
        >
          <div style={{ background: colors.bg, borderRadius: 12, padding: 24, width: 480, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
            <h2 style={{ ...S.h1, marginBottom: 16 }}>New Notification Channel</h2>

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
                placeholder="e.g. #ops-alerts"
              />
            </div>

            {/* Type */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: colors.text2, display: 'block', marginBottom: 4 }}>Type</label>
              <select
                style={{ ...S.select, width: '100%' }}
                value={form.type}
                onChange={e => setForm(prev => ({ ...prev, type: e.target.value }))}
              >
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            {/* Config — type-specific */}
            {form.type === 'slack_webhook' && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.text2, display: 'block', marginBottom: 4 }}>Webhook URL</label>
                <input
                  style={{ ...S.searchInput, width: '100%' }}
                  value={form.webhook_url}
                  onChange={e => setForm(prev => ({ ...prev, webhook_url: e.target.value }))}
                  placeholder="https://hooks.slack.com/services/..."
                  type="url"
                />
              </div>
            )}
            {form.type === 'email' && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.text2, display: 'block', marginBottom: 4 }}>Email Address</label>
                <input
                  style={{ ...S.searchInput, width: '100%' }}
                  value={form.email_to}
                  onChange={e => setForm(prev => ({ ...prev, email_to: e.target.value }))}
                  placeholder="ops@example.com"
                  type="email"
                />
              </div>
            )}

            {/* Enabled */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={e => setForm(prev => ({ ...prev, enabled: e.target.checked }))}
                />
                <span style={{ fontWeight: 600, color: colors.text2 }}>Enable channel immediately</span>
              </label>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setShowForm(false)} style={S.secondaryBtn}>Cancel</button>
              <button onClick={handleSubmit} disabled={formSaving} style={S.primaryBtn}>
                {formSaving ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NotificationChannelsPage() {
  return (
    <AdminShell>
      <ChannelsContent />
    </AdminShell>
  );
}