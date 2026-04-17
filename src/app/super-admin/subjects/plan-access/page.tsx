'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { colors, S } from '../../_components/admin-styles';

// ── Types ─────────────────────────────────────────────────────
type PlanCode = 'free' | 'starter' | 'pro' | 'unlimited';
const PLANS: PlanCode[] = ['free', 'starter', 'pro', 'unlimited'];

interface Subject {
  code: string;
  name: string;
  is_active: boolean;
}

interface PlanAccessRow {
  plan_code: PlanCode;
  subject_code: string;
}

interface PlanCaps {
  plan_code: PlanCode;
  max_subjects: number | null;
}

interface PendingDisable {
  plan: PlanCode;
  subject_code: string;
  affectedCount: number | null;
  loading: boolean;
}

function PlanAccessContent() {
  const { apiFetch } = useAdmin();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [accessRows, setAccessRows] = useState<PlanAccessRow[]>([]);
  const [caps, setCaps] = useState<PlanCaps[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDisable | null>(null);
  const [capDraft, setCapDraft] = useState<Record<PlanCode, string>>({
    free: '', starter: '', pro: '', unlimited: '',
  });
  const [savingCap, setSavingCap] = useState<PlanCode | null>(null);

  // ── Loaders ──
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [subjRes, paRes] = await Promise.all([
        apiFetch('/api/super-admin/subjects'),
        apiFetch('/api/super-admin/subjects/plan-access'),
      ]);
      if (!subjRes.ok) throw new Error(`Subjects HTTP ${subjRes.status}`);
      if (!paRes.ok) throw new Error(`Plan-access HTTP ${paRes.status}`);
      const sd = await subjRes.json();
      const pd = await paRes.json();
      setSubjects(sd.data || sd.subjects || []);
      const access = pd.data || pd.access || pd.rows || [];
      setAccessRows(access);
      const plans: PlanCaps[] = pd.plans || pd.subscription_plans || [];
      setCaps(plans);
      const draft: Record<PlanCode, string> = { free: '', starter: '', pro: '', unlimited: '' };
      for (const p of plans) {
        draft[p.plan_code] = p.max_subjects == null ? '' : String(p.max_subjects);
      }
      setCapDraft(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const accessSet = useMemo(() => {
    const s = new Set<string>();
    for (const r of accessRows) s.add(`${r.plan_code}::${r.subject_code}`);
    return s;
  }, [accessRows]);

  const activeSubjects = subjects.filter((s) => s.is_active);

  // ── Mutations ──
  const enable = async (plan: PlanCode, subject_code: string) => {
    const key = `${plan}::${subject_code}`;
    setSavingKey(key);
    try {
      const res = await apiFetch('/api/super-admin/subjects/plan-access', {
        method: 'PUT',
        body: JSON.stringify({ plan_code: plan, subject_code }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingKey(null);
    }
  };

  const remove = async (plan: PlanCode, subject_code: string) => {
    const key = `${plan}::${subject_code}`;
    setSavingKey(key);
    try {
      const params = new URLSearchParams({ plan_code: plan, subject_code });
      const res = await apiFetch(`/api/super-admin/subjects/plan-access?${params}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setSavingKey(null);
    }
  };

  const checkBeforeDisable = async (plan: PlanCode, subject_code: string) => {
    const cell: PendingDisable = { plan, subject_code, affectedCount: null, loading: true };
    setPending(cell);
    try {
      const params = new URLSearchParams({ plan, subject: subject_code, format: 'count' });
      const res = await apiFetch(`/api/super-admin/subjects/violations?${params}`);
      let count = 0;
      if (res.ok) {
        const data = await res.json();
        count = data.count ?? data.total ?? (data.data?.length || 0);
      }
      setPending({ ...cell, affectedCount: count, loading: false });
    } catch {
      setPending({ ...cell, affectedCount: 0, loading: false });
    }
  };

  const confirmDisable = async () => {
    if (!pending) return;
    const { plan, subject_code } = pending;
    setPending(null);
    await remove(plan, subject_code);
  };

  const saveCap = async (plan: PlanCode) => {
    setSavingCap(plan);
    try {
      const raw = capDraft[plan].trim();
      const max_subjects = raw === '' ? null : Math.max(0, parseInt(raw, 10) || 0);
      const res = await apiFetch('/api/super-admin/subjects/plan-access', {
        method: 'PUT',
        body: JSON.stringify({ plan_code: plan, max_subjects }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cap save failed');
    } finally {
      setSavingCap(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={S.h1}>Plan × Subject Access</h1>
          <div style={S.subtitle}>
            Toggle subject availability per plan. Disabling a subject for a plan
            does not retroactively un-enroll students — review the Violations report.
          </div>
        </div>
        <button style={S.secondaryBtn} onClick={load} disabled={loading}>Refresh</button>
      </div>

      {error && (
        <div role="alert" style={{
          padding: 12, marginBottom: 16, borderRadius: 8,
          border: `1px solid ${colors.danger}`, background: colors.dangerLight,
          color: colors.danger, fontSize: 13,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{error}</span>
          <button style={{ ...S.actionBtn, color: colors.danger, borderColor: colors.danger }} onClick={load}>Retry</button>
        </div>
      )}

      {/* Matrix */}
      <div style={{ ...S.card, padding: 0, overflowX: 'auto' }}>
        {loading && activeSubjects.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 13 }}>Loading…</div>
        ) : activeSubjects.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 13 }}>
            No active subjects yet.
          </div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                <th style={{ ...S.th, position: 'sticky', left: 0, zIndex: 2, background: colors.surface, minWidth: 110 }}>Plan</th>
                {activeSubjects.map((s) => (
                  <th
                    key={s.code}
                    style={{ ...S.th, textAlign: 'center', minWidth: 80 }}
                    title={s.name}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 11 }}>{s.name}</span>
                      <code style={{ fontSize: 9, color: colors.text3, fontWeight: 400 }}>{s.code}</code>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PLANS.map((plan) => (
                <tr key={plan}>
                  <td style={{ ...S.td, position: 'sticky', left: 0, background: colors.bg, fontWeight: 600 }}>
                    {plan}
                  </td>
                  {activeSubjects.map((s) => {
                    const k = `${plan}::${s.code}`;
                    const enabled = accessSet.has(k);
                    const isSaving = savingKey === k;
                    return (
                      <td key={s.code} style={{ ...S.td, textAlign: 'center' }}>
                        <label style={{ display: 'inline-flex', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            aria-label={`Allow ${s.name} on ${plan} plan`}
                            checked={enabled}
                            disabled={isSaving}
                            onChange={(e) => {
                              if (e.target.checked) enable(plan, s.code);
                              else checkBeforeDisable(plan, s.code);
                            }}
                          />
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Cap editor */}
      <div style={{ marginTop: 24 }}>
        <h2 style={S.h2}>Per-plan subject caps</h2>
        <div style={{ ...S.card, padding: 16 }}>
          <div style={{ fontSize: 12, color: colors.text2, marginBottom: 12 }}>
            <code>max_subjects</code> per plan. Empty = unlimited within the allowlist above.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            {PLANS.map((plan) => {
              const current = caps.find((c) => c.plan_code === plan);
              const isSaving = savingCap === plan;
              return (
                <div key={plan} style={{ ...S.cardSurface, padding: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: colors.text1, marginBottom: 8, textTransform: 'capitalize' }}>
                    {plan}
                  </div>
                  <label style={{ fontSize: 11, color: colors.text2, display: 'block', marginBottom: 4 }}>
                    max_subjects
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="number"
                      min={0}
                      placeholder="unlimited"
                      style={{ ...S.searchInput, width: '100%' }}
                      value={capDraft[plan]}
                      onChange={(e) => setCapDraft({ ...capDraft, [plan]: e.target.value })}
                      aria-label={`Maximum subjects for ${plan} plan`}
                    />
                    <button
                      style={S.primaryBtn}
                      disabled={isSaving || (current?.max_subjects ?? null) === (capDraft[plan].trim() === '' ? null : parseInt(capDraft[plan], 10))}
                      onClick={() => saveCap(plan)}
                    >
                      {isSaving ? '…' : 'Save'}
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: colors.text3, marginTop: 6 }}>
                    Currently: {current?.max_subjects == null ? 'unlimited' : current.max_subjects}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, fontSize: 12, color: colors.text3 }}>
        All changes are logged to <code>admin_audit_log</code> as
        <code> plan_subject_access.upserted</code> / <code>plan_subject_access.deleted</code>.
      </div>

      {pending && (
        <ConfirmModal
          title={`Disable ${pending.subject_code} for ${pending.plan} plan?`}
          loading={pending.loading}
          warning={
            pending.affectedCount && pending.affectedCount > 0
              ? `${pending.affectedCount} student${pending.affectedCount === 1 ? '' : 's'} on the ${pending.plan} plan currently have ${pending.subject_code} enrolled. They will appear in the Violations report.`
              : 'No students on this plan are currently enrolled in this subject.'
          }
          onCancel={() => setPending(null)}
          onConfirm={confirmDisable}
        />
      )}
    </div>
  );
}

function ConfirmModal({
  title, warning, loading, onCancel, onConfirm,
}: {
  title: string;
  warning: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);
  return (
    <>
      <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 999 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          background: colors.bg, borderRadius: 10, padding: 24, width: 460,
          boxShadow: '0 12px 48px rgba(0,0,0,0.18)', zIndex: 1000,
        }}
      >
        <h3 id="confirm-title" style={{ margin: 0, fontSize: 16, color: colors.text1, fontWeight: 700 }}>{title}</h3>
        <div style={{ fontSize: 13, color: colors.text2, marginTop: 12, lineHeight: 1.5 }}>
          {loading ? 'Checking affected students…' : warning}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button style={S.secondaryBtn} onClick={onCancel} autoFocus>Cancel</button>
          <button style={S.dangerBtn} onClick={onConfirm} disabled={loading}>Disable anyway</button>
        </div>
      </div>
    </>
  );
}

export default function PlanAccessPage() {
  return (
    <AdminShell>
      <PlanAccessContent />
    </AdminShell>
  );
}
