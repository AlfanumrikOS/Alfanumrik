'use client';

/**
 * Super-Admin Student Detail page.
 *
 * NOTE: A richer version of this page (Data Panel, Live View, Notes,
 * Subject Mastery Grid) lives on the `feature/observability-console` branch
 * (see commit 5890fa3). When that branch lands, the Subjects card defined
 * here MUST be merged into the unified page. For now it stands alone so
 * Phase E5 of subject-governance is not blocked.
 */

import { useState, useEffect, useCallback, use as usePromise } from 'react';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import StatusBadge from '../../_components/StatusBadge';
import { colors, S } from '../../_components/admin-styles';

// ── Types ─────────────────────────────────────────────────────
interface StudentProfile {
  id: string;
  name?: string;
  email?: string;
  grade?: string;
  stream?: string | null;
  board?: string;
  subscription_plan?: string;
  selected_subjects?: string[];
  preferred_subject?: string | null;
  is_active?: boolean;
  created_at?: string;
  [key: string]: unknown;
}

interface AllowedSubject {
  code: string;
  name: string;
  nameHi?: string;
  isLocked?: boolean;
  isCore?: boolean;
}

/** Helper used by the modal to fetch what subjects the admin can assign for THIS student. */
async function fetchAllowedSubjectsForAdmin(
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>,
  studentId: string,
): Promise<AllowedSubject[]> {
  // Tries the dedicated admin endpoint first; falls back to the generic subjects list.
  try {
    const res = await apiFetch(`/api/super-admin/students/${encodeURIComponent(studentId)}/allowed-subjects`);
    if (res.ok) {
      const d = await res.json();
      return d.data || d.subjects || [];
    }
  } catch { /* fall through */ }
  // Fallback: list every active subject (admin may override).
  const res = await apiFetch('/api/super-admin/subjects');
  if (!res.ok) return [];
  const d = await res.json();
  const list = (d.data || d.subjects || []) as { code: string; name: string; name_hi?: string; is_active?: boolean }[];
  return list
    .filter((s) => s.is_active !== false)
    .map((s) => ({ code: s.code, name: s.name, nameHi: s.name_hi, isLocked: false, isCore: false }));
}

// ── Page content ──
function StudentContent({ studentId }: { studentId: string }) {
  const { apiFetch } = useAdmin();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/super-admin/students/${encodeURIComponent(studentId)}/profile`);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const d = await res.json();
      setProfile(d.data || d.profile || d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load student');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, studentId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <a href="/super-admin/users" style={{ fontSize: 12, color: colors.accent, textDecoration: 'none' }}>
          ← Users
        </a>
      </div>

      <h1 style={S.h1}>{profile?.name || `Student ${studentId.slice(0, 8)}…`}</h1>
      <div style={S.subtitle}>
        <code style={{ fontSize: 11 }}>{studentId}</code>
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

      {loading && !profile && (
        <div style={{ ...S.card, padding: 32, textAlign: 'center', color: colors.text3 }}>Loading…</div>
      )}

      {profile && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {/* Profile card */}
          <div style={{ ...S.card }}>
            <h2 style={S.h2}>Profile</h2>
            <Row k="Name" v={profile.name} />
            <Row k="Email" v={profile.email} />
            <Row k="Grade" v={profile.grade} />
            <Row k="Board" v={profile.board} />
            <Row k="Plan" v={profile.subscription_plan ? <StatusBadge label={profile.subscription_plan} variant="info" /> : '—'} />
            <Row k="Status" v={profile.is_active ? <StatusBadge label="active" variant="success" /> : <StatusBadge label="inactive" variant="neutral" />} />
          </div>

          {/* Subjects card */}
          <div style={{ ...S.card }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ ...S.h2, marginBottom: 0 }}>Subjects</h2>
              <button style={S.actionBtn} onClick={() => setEditing(true)}>Edit subjects</button>
            </div>
            <Row
              k="Stream"
              v={profile.stream ? <StatusBadge label={profile.stream} variant="info" /> : <span style={{ color: colors.text3 }}>—</span>}
            />
            <Row
              k="Selected"
              v={
                profile.selected_subjects && profile.selected_subjects.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {profile.selected_subjects.map((s) => (
                      <span key={s} style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 10,
                        background: colors.surface, color: colors.text1, fontWeight: 500,
                        border: `1px solid ${colors.border}`,
                      }}>{s}</span>
                    ))}
                  </div>
                ) : (
                  <span style={{ color: colors.text3 }}>None selected</span>
                )
              }
            />
            <Row
              k="Preferred"
              v={profile.preferred_subject ? <code>{profile.preferred_subject}</code> : <span style={{ color: colors.text3 }}>—</span>}
            />
          </div>
        </div>
      )}

      {editing && profile && (
        <EditSubjectsModal
          studentId={studentId}
          current={profile.selected_subjects || []}
          currentPreferred={profile.preferred_subject || null}
          onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); }}
        />
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 0', borderBottom: `1px solid ${colors.borderLight}`, fontSize: 13,
    }}>
      <span style={{ color: colors.text2, fontSize: 12 }}>{k}</span>
      <span style={{ color: colors.text1, textAlign: 'right' }}>{v ?? '—'}</span>
    </div>
  );
}

// ── Edit subjects modal ──
function EditSubjectsModal({
  studentId, current, currentPreferred, onCancel, onSaved,
}: {
  studentId: string;
  current: string[];
  currentPreferred: string | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { apiFetch } = useAdmin();
  const [allowed, setAllowed] = useState<AllowedSubject[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set(current));
  const [preferred, setPreferred] = useState<string>(currentPreferred || '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetchAllowedSubjectsForAdmin(apiFetch, studentId)
      .then((rows) => setAllowed(rows))
      .catch(() => setAllowed([]))
      .finally(() => setLoading(false));
  }, [apiFetch, studentId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  const toggle = (code: string) => {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code); else next.add(code);
    setSelected(next);
    if (preferred && !next.has(preferred)) setPreferred('');
  };

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      if (reason.trim().length < 1) {
        setErr('Reason is required for admin overrides.');
        setSaving(false);
        return;
      }
      const subjects = Array.from(selected);
      const res = await apiFetch(`/api/super-admin/students/${encodeURIComponent(studentId)}/subjects`, {
        method: 'PATCH',
        body: JSON.stringify({
          subjects,
          preferred: preferred || subjects[0] || null,
          reason: reason.trim(),
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 999 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-subj-title"
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          background: colors.bg, borderRadius: 10, padding: 24, width: 560, maxHeight: '85vh',
          boxShadow: '0 12px 48px rgba(0,0,0,0.18)', zIndex: 1000,
          display: 'flex', flexDirection: 'column',
        }}
      >
        <h3 id="edit-subj-title" style={{ margin: 0, fontSize: 16, color: colors.text1, fontWeight: 700 }}>
          Edit subjects (admin override)
        </h3>
        <div style={{ fontSize: 12, color: colors.text2, marginTop: 4 }}>
          Allowed subjects are computed from this student&apos;s grade, stream, and active plan.
          Changes are logged to <code>admin_audit_log</code>.
        </div>

        <div style={{ marginTop: 16, flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 24, color: colors.text3, fontSize: 13, textAlign: 'center' }}>Loading allowed subjects…</div>
          ) : !allowed || allowed.length === 0 ? (
            <div style={{ padding: 24, color: colors.text3, fontSize: 13, textAlign: 'center' }}>
              No allowed subjects returned. Verify the student&apos;s grade and plan.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
              {allowed.map((s) => {
                const checked = selected.has(s.code);
                return (
                  <label
                    key={s.code}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                      border: `1px solid ${checked ? colors.accent : colors.border}`,
                      background: checked ? colors.accentLight : colors.bg,
                      fontSize: 13,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(s.code)}
                      aria-label={`Select ${s.name}`}
                    />
                    <span style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      <code style={{ fontSize: 10, color: colors.text3 }}>{s.code}</code>
                    </span>
                    {s.isLocked && <StatusBadge label="locked" variant="warning" />}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <label htmlFor="preferred-select" style={{ fontSize: 12, color: colors.text2, display: 'block', marginBottom: 4 }}>
            Preferred subject
          </label>
          <select
            id="preferred-select"
            style={{ ...S.select, width: '100%' }}
            value={preferred}
            onChange={(e) => setPreferred(e.target.value)}
          >
            <option value="">(first selected)</option>
            {Array.from(selected).map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: 12 }}>
          <label htmlFor="reason-input" style={{ fontSize: 12, color: colors.text2, display: 'block', marginBottom: 4 }}>
            Reason (required) <span style={{ color: colors.danger }}>*</span>
          </label>
          <textarea
            id="reason-input"
            style={{
              width: '100%', minHeight: 60, padding: '8px 12px', borderRadius: 6,
              border: `1px solid ${colors.border}`, background: colors.bg, color: colors.text1,
              fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
            }}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Student requested via support ticket #1234"
          />
        </div>

        {err && (
          <div role="alert" style={{
            marginTop: 12, padding: 10, borderRadius: 6,
            border: `1px solid ${colors.danger}`, background: colors.dangerLight,
            color: colors.danger, fontSize: 12,
          }}>
            {err}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button style={S.secondaryBtn} onClick={onCancel} disabled={saving}>Cancel</button>
          <button
            style={S.primaryBtn}
            onClick={save}
            disabled={saving || reason.trim().length < 1}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Default export ──
export default function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  return (
    <AdminShell>
      <StudentContent studentId={id} />
    </AdminShell>
  );
}
