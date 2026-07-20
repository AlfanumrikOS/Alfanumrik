'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { getProtection, type FlagProtection } from '@alfanumrik/lib/flags/protected-flags';
import { StatusBadge, AdminErrorState, NoDataState } from '@alfanumrik/ui/admin-ui';
import { Bone } from '@alfanumrik/ui/Skeleton';

interface FeatureFlag {
  id: string; name: string; enabled: boolean; rollout_percentage: number | null;
  target_institutions: string[]; target_roles: string[]; target_environments: string[];
  description: string | null; created_at: string; updated_at: string | null;
}

/** Render order + bilingual labels for the danger tiers. */
const TIER_ORDER: Array<FlagProtection['tier']> = [
  'p0_outage', 'p11_payment', 'ai_provider', 'constitution_pinned', 'staged_rollout', 'special_do_not_touch',
];
const TIER_LABELS: Record<FlagProtection['tier'], { en: string; hi: string }> = {
  p0_outage: { en: 'P0 outage kill-switch', hi: 'P0 आउटेज किल-स्विच' },
  p11_payment: { en: 'P11 payment integrity', hi: 'P11 भुगतान अखंडता' },
  ai_provider: { en: 'AI provider', hi: 'AI प्रोवाइडर' },
  constitution_pinned: { en: 'Constitution-pinned', hi: 'संविधान-पिन्ड' },
  staged_rollout: { en: 'Staged rollout', hi: 'चरणबद्ध रोलआउट' },
  special_do_not_touch: { en: 'Special — do not touch', hi: 'विशेष — छेड़छाड़ न करें' },
};

/** Flags whose DISABLE is also confirm-gated (in addition to tier special_do_not_touch). */
const CONFIRM_BOTH_DIRECTIONS_FLAGS = ['ff_atomic_subscription_activation'];

/**
 * Parse an API error body ({ error } or { code, details }) into a human
 * message. Special-cases ADMIN_INSUFFICIENT_LEVEL so an under-leveled admin
 * learns their writes are being rejected instead of silently swallowed, and
 * FLAG_PROTECTED (409) so a missing/mismatched confirmation surfaces the
 * protection reason instead of a generic failure.
 */
async function parseApiError(res: Response, isHi: boolean): Promise<string> {
  let body: { error?: string; code?: string; details?: unknown; reason?: string; reasonHi?: string } | null = null;
  try { body = await res.json(); } catch { /* non-JSON error body */ }
  if (body?.code === 'ADMIN_INSUFFICIENT_LEVEL') {
    return isHi
      ? 'आपका एडमिन स्तर super_admin से नीचे है — बदलाव सहेजे नहीं जा रहे हैं।'
      : 'Your admin level is below super_admin — changes are not being saved.';
  }
  if (body?.code === 'FLAG_PROTECTED') {
    const reason = (isHi ? body.reasonHi : undefined) || body.reason || body.error || '';
    const head = isHi
      ? 'सुरक्षित फ़्लैग — पुष्टि गुम है या मेल नहीं खाती।'
      : 'Protected flag — confirmation missing or mismatched.';
    return reason ? `${head} ${reason}` : head;
  }
  let detail = typeof body?.error === 'string' ? body.error : '';
  if (Array.isArray(body?.details)) {
    const issues = (body!.details as Array<{ path?: string; message?: string }>)
      .map(d => [d.path, d.message].filter(Boolean).join(': '))
      .filter(Boolean)
      .join('; ');
    if (issues) detail = detail ? `${detail} — ${issues}` : issues;
  }
  const prefix = isHi ? `सहेजना विफल (HTTP ${res.status})` : `Save failed (HTTP ${res.status})`;
  return detail ? `${prefix}: ${detail}` : prefix;
}

/**
 * The honesty fix: mirrors the server evaluator — a flag is effective in
 * production ONLY if enabled AND rollout_percentage !== 0 AND
 * (target_environments empty OR includes 'production').
 */
function effectiveInProduction(flag: FeatureFlag): { state: 'effective' | 'ineffective' | 'disabled'; reason: 'rollout_zero' | 'env_scope' | null } {
  if (!flag.enabled) return { state: 'disabled', reason: null };
  if (flag.rollout_percentage === 0) return { state: 'ineffective', reason: 'rollout_zero' };
  const envs = flag.target_environments || [];
  if (envs.length > 0 && !envs.includes('production')) return { state: 'ineffective', reason: 'env_scope' };
  return { state: 'effective', reason: null };
}

/** Does this direction of toggle require the type-to-confirm flow? */
function toggleNeedsConfirm(flag: FeatureFlag, protection: FlagProtection | null): boolean {
  if (!protection) return false;
  const enabling = !flag.enabled;
  if (enabling) return true; // enabling a protected flag is always confirm-gated
  // Disabling keeps one-click kill-switch speed, EXCEPT the hard cases the
  // server also gates on disable (p11_payment, special_do_not_touch, and the
  // explicit both-directions list) — otherwise the console 409s without ever
  // opening the confirm flow.
  return (
    protection.tier === 'p11_payment' ||
    protection.tier === 'special_do_not_touch' ||
    CONFIRM_BOTH_DIRECTIONS_FLAGS.includes(flag.name)
  );
}

type ConfirmAction = 'enable' | 'disable' | 'rollout';

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
  // Mutation failures were previously swallowed (403/400/500 looked like
  // success). Any failed write now lands here and renders a dismissible banner.
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [rolloutEditId, setRolloutEditId] = useState<string | null>(null);
  const [rolloutDraft, setRolloutDraft] = useState('100');
  // Guarded flow for protected flags: which flag/action awaits type-to-confirm.
  const [confirmState, setConfirmState] = useState<{ flagId: string; action: ConfirmAction } | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // limit=500 so all ~180 flags render (older API deployments ignore it harmlessly).
      const res = await apiFetch('/api/super-admin/feature-flags?limit=500');
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

  const networkErrorMsg = () => (isHi ? 'नेटवर्क त्रुटि — बदलाव सहेजा नहीं गया।' : 'Network error — the change was not saved.');

  const closeConfirm = () => { setConfirmState(null); setConfirmText(''); };

  /** Returns true on success so the confirm UI knows when to close. */
  const toggleFlag = async (flag: FeatureFlag, confirm?: string): Promise<boolean> => {
    if (togglingId === flag.id) return false;
    setTogglingId(flag.id);
    try {
      const res = await apiFetch('/api/super-admin/feature-flags', {
        method: 'PATCH',
        body: JSON.stringify({
          id: flag.id,
          updates: { enabled: !flag.enabled },
          ...(confirm !== undefined ? { confirm } : {}),
        }),
      });
      if (!res.ok) {
        setMutationError(await parseApiError(res, isHi));
        return false;
      }
      setMutationError(null);
      await fetchFlags();
      return true;
    } catch {
      setMutationError(networkErrorMsg());
      return false;
    } finally {
      setTogglingId(null);
    }
  };

  /** Toggle entry point: routes protected directions into the confirm flow. */
  const requestToggle = (flag: FeatureFlag, protection: FlagProtection | null) => {
    if (toggleNeedsConfirm(flag, protection)) {
      setConfirmState({ flagId: flag.id, action: flag.enabled ? 'disable' : 'enable' });
      setConfirmText('');
      return;
    }
    toggleFlag(flag);
  };

  const createFlag = async () => {
    if (!newFlagName.trim()) return;
    try {
      const res = await apiFetch('/api/super-admin/feature-flags', {
        method: 'POST', body: JSON.stringify({ name: newFlagName.trim(), enabled: false }),
      });
      if (!res.ok) {
        setMutationError(await parseApiError(res, isHi));
        return;
      }
      setMutationError(null);
      setNewFlagName('');
      fetchFlags();
    } catch {
      setMutationError(networkErrorMsg());
    }
  };

  const saveFlagScoping = async (flagId: string) => {
    const roles = flagScopeRoles.split(',').map(s => s.trim()).filter(Boolean);
    const envs = flagScopeEnvs.split(',').map(s => s.trim()).filter(Boolean);
    try {
      const res = await apiFetch('/api/super-admin/feature-flags', {
        method: 'PATCH', body: JSON.stringify({ id: flagId, updates: { target_roles: roles, target_environments: envs } }),
      });
      if (!res.ok) {
        setMutationError(await parseApiError(res, isHi));
        return;
      }
      setMutationError(null);
      setEditingFlagId(null);
      fetchFlags();
    } catch {
      setMutationError(networkErrorMsg());
    }
  };

  const deleteFlag = async (flag: FeatureFlag) => {
    if (!confirm(`Delete flag "${flag.name}"?`)) return;
    try {
      const res = await apiFetch('/api/super-admin/feature-flags', {
        method: 'DELETE', body: JSON.stringify({ id: flag.id }),
      });
      if (!res.ok) {
        setMutationError(await parseApiError(res, isHi));
        return;
      }
      setMutationError(null);
      fetchFlags();
    } catch {
      setMutationError(networkErrorMsg());
    }
  };

  /** Returns true on success so the confirm UI knows when to close. */
  const saveRollout = async (flagId: string, confirm?: string): Promise<boolean> => {
    const parsed = Number(rolloutDraft);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      setMutationError(isHi ? 'रोलआउट 0 से 100 के बीच की संख्या होनी चाहिए।' : 'Rollout must be a number between 0 and 100.');
      return false;
    }
    try {
      const res = await apiFetch('/api/super-admin/feature-flags', {
        method: 'PATCH',
        body: JSON.stringify({
          id: flagId,
          updates: { rollout_percentage: Math.round(parsed) },
          ...(confirm !== undefined ? { confirm } : {}),
        }),
      });
      if (!res.ok) {
        setMutationError(await parseApiError(res, isHi));
        return false;
      }
      setMutationError(null);
      setRolloutEditId(null);
      fetchFlags();
      return true;
    } catch {
      setMutationError(networkErrorMsg());
      return false;
    }
  };

  /** Rollout save entry point: rollout edits going ABOVE 0 on protected flags are confirm-gated. */
  const requestSaveRollout = (flag: FeatureFlag, protection: FlagProtection | null) => {
    const parsed = Number(rolloutDraft);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      setMutationError(isHi ? 'रोलआउट 0 से 100 के बीच की संख्या होनी चाहिए।' : 'Rollout must be a number between 0 and 100.');
      return;
    }
    if (protection && parsed > 0) {
      setConfirmState({ flagId: flag.id, action: 'rollout' });
      setConfirmText('');
      return;
    }
    saveRollout(flag.id);
  };

  const submitConfirm = async (flag: FeatureFlag) => {
    if (!confirmState || confirmState.flagId !== flag.id) return;
    const ok = confirmState.action === 'rollout'
      ? await saveRollout(flag.id, confirmText)
      : await toggleFlag(flag, confirmText);
    if (ok) closeConfirm();
  };

  const recommended = ['foxy_ai_enabled', 'razorpay_payments', 'quiz_module', 'simulations', 'parent_portal', 'teacher_portal', 'leaderboard', 'push_notifications', 'onboarding_flow', 'beta_features'];

  const renderFlagCard = (flag: FeatureFlag, protection: FlagProtection | null) => {
    const eff = effectiveInProduction(flag);
    const effLabel = eff.state === 'effective'
      ? (isHi ? 'प्रोडक्शन में प्रभावी' : 'Effective in production')
      : eff.state === 'disabled'
        ? (isHi ? 'अक्षम' : 'Disabled')
        : `${isHi ? 'सक्षम पर प्रभावी नहीं' : 'Enabled but NOT effective'} — ${
            eff.reason === 'rollout_zero'
              ? (isHi ? 'रोलआउट 0%' : 'rollout 0%')
              : (isHi ? 'प्रोडक्शन के लिए स्कोप नहीं' : 'not scoped to production')
          }`;
    const effColors = eff.state === 'effective'
      ? { bg: '#ECFDF5', fg: '#059669' } // green
      : eff.state === 'ineffective'
        ? { bg: '#FFFBEB', fg: '#B45309' } // amber
        : { bg: 'var(--surface-2)', fg: 'var(--text-3)' }; // grey
    const protectionReason = protection ? ((isHi && protection.reasonHi) ? protection.reasonHi : protection.reason) : '';
    const isManagedOutside = protection?.tier === 'special_do_not_touch';
    const confirmOpen = confirmState?.flagId === flag.id;
    return (
      <div
        key={flag.id}
        className="rounded-lg border border-surface-3 bg-surface-1 p-4"
        style={{ borderLeft: `3px solid ${protection ? 'var(--danger)' : eff.state === 'effective' ? 'var(--success)' : eff.state === 'ineffective' ? '#D97706' : 'var(--surface-3)'}` }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{flag.name}</code>
              {/* Honesty badge: 'ON' alone lies when rollout=0% or env-scoped away from production */}
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: effColors.bg, color: effColors.fg }}>
                {effLabel}
              </span>
            </div>
            {flag.description && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{flag.description}</div>}
            {protection && (
              <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2, fontWeight: 600 }}>
                🔒 {TIER_LABELS[protection.tier][isHi ? 'hi' : 'en']} — {protectionReason}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {rolloutEditId === flag.id ? (
              <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={rolloutDraft}
                  onChange={e => setRolloutDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') requestSaveRollout(flag, protection); if (e.key === 'Escape') setRolloutEditId(null); }}
                  aria-label={isHi ? 'रोलआउट प्रतिशत' : 'Rollout percentage'}
                  className="w-16 rounded-md border border-surface-3 bg-surface-1 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  onClick={() => requestSaveRollout(flag, protection)}
                  className="rounded-md bg-foreground px-2.5 py-1 text-[11px] font-semibold text-surface-1 hover:opacity-90"
                >
                  {isHi ? 'सहेजें' : 'Save'}
                </button>
                <button
                  onClick={() => setRolloutEditId(null)}
                  className="rounded-md border border-surface-3 bg-transparent px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-surface-2"
                >
                  {isHi ? 'रद्द' : 'Cancel'}
                </button>
              </span>
            ) : (
              <button
                onClick={() => { setRolloutEditId(flag.id); setRolloutDraft(String(flag.rollout_percentage ?? 100)); }}
                title={isHi ? 'रोलआउट प्रतिशत संपादित करें' : 'Edit rollout percentage'}
                className="rounded-md border border-surface-3 bg-transparent px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-surface-2"
                style={flag.rollout_percentage === 0 ? { color: '#B45309', borderColor: '#D97706' } : undefined}
              >
                {isHi ? 'रोलआउट' : 'Rollout'} {flag.rollout_percentage ?? 100}%
              </button>
            )}
            <button
              onClick={() => {
                if (editingFlagId === flag.id) { setEditingFlagId(null); }
                else { setEditingFlagId(flag.id); setFlagScopeRoles((flag.target_roles || []).join(', ')); setFlagScopeEnvs((flag.target_environments || []).join(', ')); }
              }}
              className="rounded-md border border-surface-3 bg-transparent px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-surface-2"
            >
              {editingFlagId === flag.id ? 'Cancel' : 'Scope'}
            </button>
            {isManagedOutside ? (
              /* special_do_not_touch: no toggle by default — managed outside; override reveals the confirm flow */
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 600, fontStyle: 'italic', color: 'var(--text-3)' }}>
                  {isHi ? 'कंसोल के बाहर प्रबंधित' : 'Managed outside the console'}
                </span>
                {!confirmOpen && (
                  <button
                    onClick={() => { setConfirmState({ flagId: flag.id, action: flag.enabled ? 'disable' : 'enable' }); setConfirmText(''); }}
                    style={{ fontSize: 11, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                  >
                    {isHi ? 'ओवरराइड…' : 'override…'}
                  </button>
                )}
              </span>
            ) : (
              <button
                onClick={() => requestToggle(flag, protection)}
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
            )}
            <button
              onClick={() => deleteFlag(flag)}
              className="rounded-md border bg-transparent px-2.5 py-1 text-[11px] font-medium hover:bg-surface-2"
              style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
            >
              Del
            </button>
          </div>
        </div>

        {/* Type-to-confirm flow for protected flags */}
        {confirmOpen && confirmState && protection && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 8, border: '1px solid var(--danger)', background: 'rgba(220, 38, 38, 0.06)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)', marginBottom: 2 }}>
              {confirmState.action === 'rollout'
                ? (isHi ? `रोलआउट ${rolloutDraft}% पर सेट करें?` : `Set rollout to ${rolloutDraft}%?`)
                : confirmState.action === 'enable'
                  ? (isHi ? 'यह सुरक्षित फ़्लैग सक्षम करें?' : 'Enable this protected flag?')
                  : (isHi ? 'यह सुरक्षित फ़्लैग अक्षम करें?' : 'Disable this protected flag?')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 8 }}>{protectionReason}</div>
            <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4, fontWeight: 600 }}>
              {isHi ? 'पुष्टि के लिए फ़्लैग का नाम टाइप करें' : 'Type the flag name to confirm'}
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder={flag.name}
                onKeyDown={e => { if (e.key === 'Enter') submitConfirm(flag); if (e.key === 'Escape') closeConfirm(); }}
                aria-label={isHi ? 'पुष्टि के लिए फ़्लैग का नाम टाइप करें' : 'Type the flag name to confirm'}
                className="w-72 rounded-md border border-surface-3 bg-surface-1 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                onClick={() => submitConfirm(flag)}
                disabled={!confirmText.trim() || togglingId === flag.id}
                className="rounded-md px-3 py-1.5 text-[11px] font-semibold text-surface-1 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: 'var(--danger)', border: 'none' }}
              >
                {isHi ? 'पुष्टि करें' : 'Confirm'}
              </button>
              <button
                onClick={closeConfirm}
                className="rounded-md border border-surface-3 bg-transparent px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-surface-2"
              >
                {isHi ? 'रद्द' : 'Cancel'}
              </button>
            </div>
          </div>
        )}

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
    );
  };

  // Partition: unprotected flags vs. registry-protected flags grouped by danger tier.
  const unprotectedFlags = flags.filter(f => !getProtection(f.name));
  const protectedFlags = flags
    .map(f => ({ flag: f, protection: getProtection(f.name) }))
    .filter((x): x is { flag: FeatureFlag; protection: FlagProtection } => x.protection !== null);
  const protectedByTier = TIER_ORDER
    .map(tier => ({ tier, items: protectedFlags.filter(x => x.protection.tier === tier) }))
    .filter(g => g.items.length > 0);

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

      {/* Mutation-failure banner — visible + dismissible. Failed writes must never look like success. */}
      {mutationError && (
        <div
          role="alert"
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
            marginBottom: 16, padding: '10px 14px', borderRadius: 8,
            border: '1px solid var(--danger)', background: 'rgba(220, 38, 38, 0.08)',
            color: 'var(--danger)', fontSize: 13, fontWeight: 600,
          }}
        >
          <span>{mutationError}</span>
          <button
            onClick={() => setMutationError(null)}
            aria-label={isHi ? 'बंद करें' : 'Dismiss'}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, fontWeight: 700, lineHeight: 1, padding: 4 }}
          >
            ×
          </button>
        </div>
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

      {/* Loading / error / empty states for the whole list */}
      {loading && flags.length === 0 && (
        <div aria-busy="true" role="status" className="mb-6 grid gap-2">
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
        <div className="mb-6">
          <AdminErrorState onRetry={fetchFlags} message={error} isHi={isHi} />
        </div>
      )}
      {!loading && !error && flags.length === 0 && (
        <div className="mb-6">
          <NoDataState
            reason="no_data"
            title={isHi ? 'कोई फ़ीचर फ़्लैग नहीं' : 'No feature flags configured'}
            message={isHi ? 'ऊपर एक फ़्लैग जोड़ें।' : 'Add one above to get started.'}
          />
        </div>
      )}

      {/* Unprotected flag list */}
      {unprotectedFlags.length > 0 && (
        <>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {isHi ? 'फ़्लैग' : 'Flags'}
          </h2>
          <div style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
            {unprotectedFlags.map(flag => renderFlagCard(flag, null))}
          </div>
        </>
      )}

      {/* Protected flags — visually distinct red-bordered danger zone, grouped by tier */}
      {protectedFlags.length > 0 && (
        <div
          style={{ border: '2px solid var(--danger)', borderRadius: 12, padding: 16, marginBottom: 24, background: 'rgba(220, 38, 38, 0.03)' }}
        >
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--danger)' }}>
            {isHi ? '🔒 सुरक्षित — चरणबद्ध रोलआउट / छेड़छाड़ न करें' : '🔒 Protected — staged rollout / do-not-touch'}
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            {isHi
              ? 'इन फ़्लैग में बदलाव के लिए पुष्टि आवश्यक है। अक्षम करना (किल-स्विच) एक-क्लिक रहता है, सिवाय P11 भुगतान और do-not-touch के।'
              : 'Changes to these flags require confirmation. Disabling (kill-switch) stays one-click, except P11 payment and do-not-touch.'}
          </p>
          {protectedByTier.map(group => (
            <div key={group.tier} style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--danger)', margin: '0 0 6px' }}>
                {TIER_LABELS[group.tier][isHi ? 'hi' : 'en']}
              </h3>
              <div style={{ display: 'grid', gap: 8 }}>
                {group.items.map(({ flag, protection }) => renderFlagCard(flag, protection))}
              </div>
            </div>
          ))}
        </div>
      )}

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
