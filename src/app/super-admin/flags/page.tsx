'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import StatusBadge from '../_components/StatusBadge';
import { colors, S } from '../_components/admin-styles';

interface FeatureFlag {
  id: string; name: string; enabled: boolean; rollout_percentage: number | null;
  target_institutions: string[]; target_roles: string[]; target_environments: string[];
  description: string | null; created_at: string; updated_at: string | null;
}

function FlagsContent() {
  const { apiFetch } = useAdmin();
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(false);
  const [newFlagName, setNewFlagName] = useState('');
  const [editingFlagId, setEditingFlagId] = useState<string | null>(null);
  const [flagScopeRoles, setFlagScopeRoles] = useState('');
  const [flagScopeEnvs, setFlagScopeEnvs] = useState('');

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch('/api/super-admin/feature-flags');
    if (res.ok) { const d = await res.json(); setFlags(d.data || []); }
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => { fetchFlags(); }, [fetchFlags]);

  const toggleFlag = async (flag: FeatureFlag) => {
    await apiFetch('/api/super-admin/feature-flags', {
      method: 'PATCH', body: JSON.stringify({ id: flag.id, updates: { enabled: !flag.enabled } }),
    });
    fetchFlags();
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
          <h1 style={S.h1}>Feature Flags</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>Toggle features, emergency disables, and beta access controls</p>
        </div>
        <div style={{ fontSize: 13, color: colors.text2 }}>
          {flags.filter(f => f.enabled).length} of {flags.length} enabled
        </div>
      </div>

      {/* Create Flag */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input value={newFlagName} onChange={e => setNewFlagName(e.target.value)} placeholder="New flag name (e.g. foxy_ai_enabled)"
          style={{ ...S.searchInput, flex: 1 }} onKeyDown={e => e.key === 'Enter' && createFlag()} />
        <button onClick={createFlag} style={S.primaryBtn}>+ Add Flag</button>
      </div>

      {/* Flag List */}
      <div style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
        {loading && flags.length === 0 && <div style={{ color: colors.text3, padding: 20, textAlign: 'center' }}>Loading...</div>}
        {!loading && flags.length === 0 && <div style={{ ...S.card, textAlign: 'center', color: colors.text3, padding: 24 }}>No feature flags configured. Add one above.</div>}
        {flags.map(flag => (
          <div key={flag.id} style={{ ...S.card, borderLeft: `3px solid ${flag.enabled ? colors.success : colors.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <code style={{ fontSize: 14, fontWeight: 700, color: colors.text1 }}>{flag.name}</code>
                {flag.description && <div style={{ fontSize: 11, color: colors.text3, marginTop: 2 }}>{flag.description}</div>}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => {
                  if (editingFlagId === flag.id) { setEditingFlagId(null); }
                  else { setEditingFlagId(flag.id); setFlagScopeRoles((flag.target_roles || []).join(', ')); setFlagScopeEnvs((flag.target_environments || []).join(', ')); }
                }} style={{ ...S.actionBtn, fontSize: 11 }}>
                  {editingFlagId === flag.id ? 'Cancel' : 'Scope'}
                </button>
                <button onClick={() => toggleFlag(flag)} style={{
                  padding: '6px 18px', borderRadius: 20, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 700,
                  background: flag.enabled ? colors.success : colors.border,
                  color: flag.enabled ? '#fff' : colors.text3,
                }}>{flag.enabled ? 'ON' : 'OFF'}</button>
                <button onClick={() => deleteFlag(flag)} style={{ ...S.actionBtn, color: colors.danger, borderColor: colors.danger, fontSize: 11 }}>Del</button>
              </div>
            </div>

            {/* Scope tags */}
            <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
              {flag.target_roles?.length > 0 && flag.target_roles.map(r => (
                <span key={r} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: colors.accentLight, color: colors.accent }}>role:{r}</span>
              ))}
              {flag.target_environments?.length > 0 && flag.target_environments.map(e => (
                <span key={e} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: colors.warningLight, color: colors.warning }}>env:{e}</span>
              ))}
              {(!flag.target_roles?.length) && (!flag.target_environments?.length) && (
                <span style={{ fontSize: 10, color: colors.text3 }}>Global (all roles, all environments)</span>
              )}
            </div>

            {/* Scope editor */}
            {editingFlagId === flag.id && (
              <div style={{ marginTop: 12, padding: 12, background: colors.surface, borderRadius: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4, fontWeight: 600 }}>Target Roles</label>
                    <input value={flagScopeRoles} onChange={e => setFlagScopeRoles(e.target.value)} placeholder="student, teacher, parent"
                      style={S.searchInput} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4, fontWeight: 600 }}>Target Environments</label>
                    <input value={flagScopeEnvs} onChange={e => setFlagScopeEnvs(e.target.value)} placeholder="production, staging"
                      style={S.searchInput} />
                  </div>
                </div>
                <button onClick={() => saveFlagScoping(flag.id)} style={{ ...S.primaryBtn, marginTop: 8, fontSize: 12 }}>Save Scoping</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Recommended Flags */}
      <h2 style={S.h2}>Recommended Flags</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
        {recommended.map(name => {
          const exists = flags.some(f => f.name === name);
          return (
            <div key={name} style={{ ...S.card, opacity: exists ? 0.5 : 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12 }}>
              <code style={{ fontSize: 12, color: colors.text2 }}>{name}</code>
              {!exists ? (
                <button onClick={() => { setNewFlagName(name); }} style={{ ...S.actionBtn, color: colors.accent, borderColor: colors.accent, fontSize: 11 }}>Add</button>
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
