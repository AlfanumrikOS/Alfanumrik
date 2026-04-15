'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { colors, S } from '../../_components/admin-styles';

// ── Types ─────────────────────────────────────────────────────
type Stream = 'science' | 'commerce' | 'humanities' | null;

interface Subject {
  code: string;
  name: string;
  is_active: boolean;
  display_order?: number;
}

interface GradeMapRow {
  id?: string;
  grade: string;
  subject_code: string;
  stream: Stream;
  is_core: boolean;
  min_questions_seeded: number;
}

const GRADES = ['6', '7', '8', '9', '10', '11', '12'];

interface Band {
  grade: string;
  stream: Stream;
  label: string;
}

const BANDS: Band[] = [
  ...['6', '7', '8', '9', '10'].map((g) => ({ grade: g, stream: null as Stream, label: `Grade ${g}` })),
  { grade: '11', stream: 'science', label: 'Grade 11 — Science' },
  { grade: '11', stream: 'commerce', label: 'Grade 11 — Commerce' },
  { grade: '11', stream: 'humanities', label: 'Grade 11 — Humanities' },
  { grade: '12', stream: 'science', label: 'Grade 12 — Science' },
  { grade: '12', stream: 'commerce', label: 'Grade 12 — Commerce' },
  { grade: '12', stream: 'humanities', label: 'Grade 12 — Humanities' },
];

function bandKey(grade: string, stream: Stream): string {
  return `${grade}::${stream ?? '_'}`;
}

function rowKey(grade: string, subjectCode: string, stream: Stream): string {
  return `${grade}::${subjectCode}::${stream ?? '_'}`;
}

interface PendingCell {
  grade: string;
  subject_code: string;
  stream: Stream;
  enrolledCount: number | null;
  loading: boolean;
}

function GradeMapContent() {
  const { apiFetch } = useAdmin();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [rows, setRows] = useState<GradeMapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [activeBand, setActiveBand] = useState<string>(bandKey('6', null));
  const [pendingDisable, setPendingDisable] = useState<PendingCell | null>(null);

  // ── Loaders ──
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [subjRes, mapRes] = await Promise.all([
        apiFetch('/api/super-admin/subjects'),
        apiFetch('/api/super-admin/subjects/grade-map'),
      ]);
      if (!subjRes.ok) throw new Error(`Subjects HTTP ${subjRes.status}`);
      if (!mapRes.ok) throw new Error(`Grade-map HTTP ${mapRes.status}`);
      const sd = await subjRes.json();
      const md = await mapRes.json();
      setSubjects(sd.data || sd.subjects || []);
      setRows(md.data || md.rows || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  // ── Lookup ──
  const rowMap = useMemo(() => {
    const m = new Map<string, GradeMapRow>();
    for (const r of rows) m.set(rowKey(r.grade, r.subject_code, r.stream), r);
    return m;
  }, [rows]);

  const activeBandObj = BANDS.find((b) => bandKey(b.grade, b.stream) === activeBand) || BANDS[0];

  // ── Mutations ──
  const upsert = async (row: GradeMapRow) => {
    const key = rowKey(row.grade, row.subject_code, row.stream);
    setSavingKey(key);
    try {
      const res = await apiFetch('/api/super-admin/subjects/grade-map', {
        method: 'PUT',
        body: JSON.stringify(row),
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

  const remove = async (grade: string, subject_code: string, stream: Stream) => {
    const key = rowKey(grade, subject_code, stream);
    setSavingKey(key);
    try {
      const params = new URLSearchParams({ grade, subject_code });
      if (stream) params.set('stream', stream);
      const res = await apiFetch(`/api/super-admin/subjects/grade-map?${params}`, {
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

  const checkEnrollmentBeforeDisable = async (grade: string, subject_code: string, stream: Stream) => {
    const cell: PendingCell = { grade, subject_code, stream, enrolledCount: null, loading: true };
    setPendingDisable(cell);
    try {
      const params = new URLSearchParams({ grade, subject: subject_code, format: 'count' });
      if (stream) params.set('stream', stream);
      const res = await apiFetch(`/api/super-admin/subjects/violations?${params}`);
      let count = 0;
      if (res.ok) {
        const data = await res.json();
        count = data.count ?? data.total ?? (data.data?.length || 0);
      }
      setPendingDisable({ ...cell, enrolledCount: count, loading: false });
    } catch {
      setPendingDisable({ ...cell, enrolledCount: 0, loading: false });
    }
  };

  const confirmDisable = async () => {
    if (!pendingDisable) return;
    const { grade, subject_code, stream } = pendingDisable;
    setPendingDisable(null);
    await remove(grade, subject_code, stream);
  };

  // ── Render ──
  const enabledSubjectsForBand = subjects.filter((s) => s.is_active);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={S.h1}>Grade × Subject Map</h1>
          <div style={S.subtitle}>
            Toggle subject availability per grade and stream. Disabling a row only blocks new enrollment;
            existing students remain affected — review the Violations report.
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

      {/* Band selector */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }} role="tablist" aria-label="Grade bands">
        {BANDS.map((b) => {
          const k = bandKey(b.grade, b.stream);
          const isActive = k === activeBand;
          return (
            <button
              key={k}
              role="tab"
              aria-selected={isActive}
              style={{
                ...S.filterBtn,
                ...(isActive ? S.filterActive : {}),
              }}
              onClick={() => setActiveBand(k)}
            >
              {b.label}
            </button>
          );
        })}
      </div>

      {/* Grid for the active band */}
      <div style={{ ...S.card, padding: 0, overflowX: 'auto' }}>
        {loading && enabledSubjectsForBand.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 13 }}>
            Loading subjects…
          </div>
        ) : enabledSubjectsForBand.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 13 }}>
            No active subjects yet. Seed the master catalog first.
          </div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Subject</th>
                <th style={{ ...S.th, width: 110, textAlign: 'center' }}>Enabled</th>
                <th style={{ ...S.th, width: 110, textAlign: 'center' }}>Is core</th>
                <th style={{ ...S.th, width: 160 }}>Min questions</th>
                <th style={{ ...S.th, width: 110 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {enabledSubjectsForBand.map((s) => {
                const k = rowKey(activeBandObj.grade, s.code, activeBandObj.stream);
                const existing = rowMap.get(k);
                const enabled = !!existing;
                const isSaving = savingKey === k;
                return (
                  <tr key={s.code}>
                    <td style={S.td}>
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      <code style={{ fontSize: 11, color: colors.text3 }}>{s.code}</code>
                    </td>
                    <td style={{ ...S.td, textAlign: 'center' }}>
                      <label style={{ display: 'inline-flex', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          aria-label={`Enable ${s.name} for ${activeBandObj.label}`}
                          checked={enabled}
                          disabled={isSaving}
                          onChange={(e) => {
                            if (e.target.checked) {
                              upsert({
                                grade: activeBandObj.grade,
                                subject_code: s.code,
                                stream: activeBandObj.stream,
                                is_core: true,
                                min_questions_seeded: 10,
                              });
                            } else {
                              checkEnrollmentBeforeDisable(activeBandObj.grade, s.code, activeBandObj.stream);
                            }
                          }}
                        />
                      </label>
                    </td>
                    <td style={{ ...S.td, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        aria-label={`Mark ${s.name} as core`}
                        checked={existing?.is_core ?? false}
                        disabled={!enabled || isSaving}
                        onChange={(e) =>
                          existing && upsert({ ...existing, is_core: e.target.checked })
                        }
                      />
                    </td>
                    <td style={S.td}>
                      <input
                        type="number"
                        min={0}
                        aria-label={`Minimum questions seeded for ${s.name}`}
                        style={{ ...S.searchInput, width: 100 }}
                        value={existing?.min_questions_seeded ?? 10}
                        disabled={!enabled || isSaving}
                        onChange={(e) =>
                          existing &&
                          upsert({ ...existing, min_questions_seeded: parseInt(e.target.value, 10) || 0 })
                        }
                      />
                    </td>
                    <td style={S.td}>
                      {isSaving ? <span style={{ color: colors.text3, fontSize: 12 }}>Saving…</span>
                        : enabled ? <span style={{ color: colors.success, fontSize: 12 }}>● Enabled</span>
                        : <span style={{ color: colors.text3, fontSize: 12 }}>Disabled</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: 16, fontSize: 12, color: colors.text3 }}>
        All changes are logged to <code>admin_audit_log</code> as
        <code> grade_subject_map.upserted</code> / <code>grade_subject_map.deleted</code>.
      </div>

      {/* Confirm disable modal */}
      {pendingDisable && (
        <ConfirmDisableModal
          cell={pendingDisable}
          subjectName={subjects.find((s) => s.code === pendingDisable.subject_code)?.name || pendingDisable.subject_code}
          bandLabel={
            BANDS.find((b) => b.grade === pendingDisable.grade && b.stream === pendingDisable.stream)?.label
            || `Grade ${pendingDisable.grade}`
          }
          onCancel={() => setPendingDisable(null)}
          onConfirm={confirmDisable}
        />
      )}
    </div>
  );
}

function ConfirmDisableModal({
  cell, subjectName, bandLabel, onCancel, onConfirm,
}: {
  cell: PendingCell;
  subjectName: string;
  bandLabel: string;
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
      <div onClick={onCancel} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 999,
      }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-disable-title"
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          background: colors.bg, borderRadius: 10, padding: 24, width: 460,
          boxShadow: '0 12px 48px rgba(0,0,0,0.18)', zIndex: 1000,
        }}
      >
        <h3 id="confirm-disable-title" style={{ margin: 0, fontSize: 16, color: colors.text1, fontWeight: 700 }}>
          Disable {subjectName} for {bandLabel}?
        </h3>
        <div style={{ fontSize: 13, color: colors.text2, marginTop: 12, lineHeight: 1.5 }}>
          {cell.loading ? (
            <span>Checking enrolled students…</span>
          ) : cell.enrolledCount && cell.enrolledCount > 0 ? (
            <span>
              <strong style={{ color: colors.warning }}>{cell.enrolledCount}</strong> student{cell.enrolledCount === 1 ? '' : 's'}
              {' '}currently {cell.enrolledCount === 1 ? 'is' : 'are'} enrolled in this subject within this band.
              They will appear in the Violations report and need re-selection.
            </span>
          ) : (
            <span>No students are currently enrolled in this subject for this band.</span>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button style={S.secondaryBtn} onClick={onCancel} autoFocus>Cancel</button>
          <button style={S.dangerBtn} onClick={onConfirm} disabled={cell.loading}>
            Disable anyway
          </button>
        </div>
      </div>
    </>
  );
}

export default function GradeMapPage() {
  return (
    <AdminShell>
      <GradeMapContent />
    </AdminShell>
  );
}
