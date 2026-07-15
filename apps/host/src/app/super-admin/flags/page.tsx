'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { StatusBadge, AdminErrorState, NoDataState } from '@alfanumrik/ui/admin-ui';
import { Bone } from '@alfanumrik/ui/Skeleton';

interface FeatureFlag {
  id: string; name: string; enabled: boolean; rollout_percentage: number | null;
  target_institutions: string[]; target_roles: string[]; target_environments: string[];
  description: string | null; created_at: string; updated_at: string | null;
}

function FlagsContent() {
  const { apiFetch } = useAdmin();
  const { isHi } = useAuth();
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newFlagName, setNewFlagName] = useState('');
  const [editingFlagId, setEditingFlagId] = useState<string | null>(null);
  const [flagScopeRoles, setFlagScopeRoles] = useState('');
  const [flagScopeEnvs, setFlagScopeEnvs] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/feature-flags');
      // Without this branch a failed fetch left an empty list that was
      // indistinguishable from "no flags configured" — a silent-null defect.
      if (!res.ok) throw new Error(isHi ? 'फ़्लैग लोड नहीं हो सके' : 'Feature flags could not be loaded');
      const d = await res.json();
      setFlags(d.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : (isHi ? 'फ़्लैग लोड करने में विफल' : 'Failed to load flags'));
    } finally {
      setLoading(false);
    }
  }, [apiFetch, isHi]);

  useEffect(() => { fetchFlags(); }, [fetchFlags]);

  const toggleFlag = async (flag: FeatureFlag) => {
    if (togglingId === flag.id) return;
    setTogglingId(flag.id);
    try {
      await apiFetch('/api/super-admin/feature-flags', {
        method: 'PATCH', body: JSON.stringify({ id: flag.id, updates: { enabled: !flag.enabled } }),
      });
      await fetchFlags();
    } finally {
      setTogglingId(null);
    }
  };

  const createFlag = async () => {
    if (!newFlagName.trim()) return;
    await apiFetch('/api/super-admin/feature-flags', {
      method: 'POST', body: JSON.stringify({ name: newFlagName.trim(), enabled: false }),
    });
    setNewFlagName('');
    fetchFlags();
  };

  const saveFlagScoping = async (flagId: string) => {
    const roles = flagScopeRoles.split(',').map(s => s.trim()).filter(Boolean);
    const envs = flagScopeEnvs.split(',').map(s => s.trim()).filter(Boolean);
    await apiFetch('/api/super-admin/feature-flags', {
      method: 'PATCH', body: JSON.stringify({ id: flagId, updates: { target_roles: roles, target_environments: envs } }),
    });
    setEditingFlagId(null);
    fetchFlags();
  };

  const deleteFlag = async (flag: FeatureFlag) => {
    if (!confirm(`Delete flag "${flag.name}"?`)) return;
    await apiFetch('/api/super-admin/feature-flags', {
      method: 'DELETE', body: JSON.stringify({ id: flag.id }),
    });
    fetchFlags();
  };

  const recommended = ['foxy_ai_enabled', 'razorpay_payments', 'quiz_module', 'simulations', 'parent_portal', 'teacher_portal', 'leaderboard', 'push_notifications', 'onboarding_flow', 'beta_features'];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 className="text-xl font-bold text-foreground">Feature Flags</h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>Toggle features, emergency disables, and beta access controls</p>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
          {flags.filter(f => f.enabled).length} of {flags.length} enabled
        </div>
      </div>

      {/* Partial-failure banner — a later refresh failed but flags are still shown. */}
      {error && flags.length > 0 && (
        <AdminErrorState compact onRetry={fetchFlags} message={error} isHi={isHi} />
      )}

      {/* Create Flag */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          value={newFlagName}
          onChange={e => setNewFlagName(e.target.value)}
          placeholder="New flag name (e.g. foxy_ai_enabled)"
          className="flex-1 rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          onKeyDown={e => e.key === 'Enter' && createFlag()}
        />
        <button onClick={createFlag} className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90">+ Add Flag</button>
      </div>

      {/* Flag List */}
      <div style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
        {loading && flags.length === 0 && (
          <div aria-busy="true" role="status" className="grid gap-2">
            <span className="sr-only">{isHi ? 'फ़्लैग लोड हो रहे हैं…' : 'Loading feature flags…'}</span>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-surface-3 bg-surface-1 p-4">
                <div className="space-y-1.5">
                  <Bone width={180} height={14} />
                  <Bone width={120} height={10} />
                </div>
                <Bone width={64} height={28} radius={14} />
              </div>
            ))}
          </div>
        )}
        {!loading && error && flags.length === 0 && (
          <AdminErrorState onRetry={fetchFlags} message={error} isHi={isHi} />
        )}
        {!loading && !error && flags.length === 0 && (
          <NoDataState
            reason="no_data"
            title={isHi ? 'कोई फ़ीचर फ़्लैग नहीं' : 'No feature flags configured'}
            message={isHi ? 'ऊपर एक फ़्लैग जोड़ें।' : 'Add one above to get started.'}
          />
        )}
        {flags.map(flag => (
          <div
            key={flag.id}
            className="rounded-lg border border-surface-3 bg-surface-1 p-4"
            style={{ borderLeft: `3px solid ${flag.enabled ? 'var(--success)' : 'var(--surface-3)'}` }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <code style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{flag.name}</code>
                {flag.description && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{flag.description}</div>}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={() => {
                    if (editingFlagId === flag.id) { setEditingFlagId(null); }
                    else { setEditingFlagId(flag.id); setFlagScopeRoles((flag.target_roles || []).join(', ')); setFlagScopeEnvs((flag.target_environments || []).join(', ')); }
                  }}
                  className="rounded-md border border-surface-3 bg-transparent px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-surface-2"
                >
                  {editingFlagId === flag.id ? 'Cancel' : 'Scope'}
                </button>
                <button
                  onClick={() => toggleFlag(flag)}
                  disabled={togglingId === flag.id}
                  style={{
                    padding: '6px 18px', borderRadius: 20, border: 'none',
                    cursor: togglingId === flag.id ? 'not-allowed' : 'pointer',
                    fontSize: 12, fontWeight: 700,
                    background: flag.enabled ? 'var(--success)' : 'var(--surface-3)',
                    color: flag.enabled ? 'var(--surface-1)' : 'var(--text-3)',
                    opacity: togglingId === flag.id ? 0.5 : 1,
                    transition: 'opacity 0.15s',
                  }}
                >
                  {togglingId === flag.id ? '...' : (flag.enabled ? 'ON' : 'OFF')}
                </button>
                <button
                  onClick={() => deleteFlag(flag)}
                  className="rounded-md border bg-transparent px-2.5 py-1 text-[11px] font-medium hover:bg-surface-2"
                  style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                >
                  Del
                </button>
              </div>
            </div>

            {/* Scope tags */}
            <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
              {flag.target_roles?.length > 0 && flag.target_roles.map(r => (
                <span key={r} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#EFF6FF', color: '#2563EB' }}>role:{r}</span>
              ))}
              {flag.target_environments?.length > 0 && flag.target_environments.map(e => (
                <span key={e} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#FFFBEB', color: '#D97706' }}>env:{e}</span>
              ))}
              {(!flag.target_roles?.length) && (!flag.target_environments?.length) && (
                <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Global (all roles, all environments)</span>
              )}
            </div>

            {/* Scope editor */}
            {editingFlagId === flag.id && (
              <div style={{ marginTop: 12, padding: 12, background: 'var(--surface-2)', borderRadius: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4, fontWeight: 600 }}>Target Roles</label>
                    <input
                      value={flagScopeRoles}
                      onChange={e => setFlagScopeRoles(e.target.value)}
                      placeholder="student, teacher, parent"
                      className="w-56 rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4, fontWeight: 600 }}>Target Environments</label>
                    <input
                      value={flagScopeEnvs}
                      onChange={e => setFlagScopeEnvs(e.target.value)}
                      placeholder="production, staging"
                      className="w-56 rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
                <button
                  onClick={() => saveFlagScoping(flag.id)}
                  className="mt-2 rounded-md bg-foreground px-4 py-2 text-xs font-semibold text-surface-1 hover:opacity-90"
                >
                  Save Scoping
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Recommended Flags */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recommended Flags</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
        {recommended.map(name => {
          const exists = flags.some(f => f.name === name);
          return (
            <div
              key={name}
              className="rounded-lg border border-surface-3 bg-surface-1"
              style={{ opacity: exists ? 0.5 : 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12 }}
            >
              <code style={{ fontSize: 12, color: 'var(--text-2)' }}>{name}</code>
              {!exists ? (
                <button
                  onClick={() => { setNewFlagName(name); }}
                  className="rounded-md border bg-transparent px-2.5 py-1 text-[11px] font-medium hover:bg-surface-2"
                  style={{ color: '#2563EB', borderColor: '#2563EB' }}
                >
                  Add
                </button>
              ) : (
                <StatusBadge label="Added" variant="success" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function FlagsPage() {
  return <AdminShell><FlagsContent /></AdminShell>;
}
