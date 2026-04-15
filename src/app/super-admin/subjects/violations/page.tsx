'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import DataTable, { Column } from '../../_components/DataTable';
import StatusBadge from '../../_components/StatusBadge';
import { colors, S } from '../../_components/admin-styles';

// ── Types ─────────────────────────────────────────────────────
type PlanCode = 'free' | 'starter' | 'pro' | 'unlimited' | '';
type Stream = 'science' | 'commerce' | 'humanities' | '';
const PLANS: PlanCode[] = ['', 'free', 'starter', 'pro', 'unlimited'];
const GRADES = ['', '6', '7', '8', '9', '10', '11', '12'];
const STREAMS: Stream[] = ['', 'science', 'commerce', 'humanities'];

interface Violation {
  student_id: string;
  student_name?: string;
  grade: string;
  stream: string | null;
  plan: string;
  invalid_subjects: string[];
  valid_subjects?: string[];
  total?: number;
  [key: string]: unknown;
}

interface RepairProgress {
  total: number;
  done: number;
  failures: { id: string; error: string }[];
}

function ViolationsContent() {
  const { apiFetch } = useAdmin();
  const [data, setData] = useState<Violation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [planFilter, setPlanFilter] = useState<PlanCode>('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [streamFilter, setStreamFilter] = useState<Stream>('');

  const [repairing, setRepairing] = useState<string | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<RepairProgress | null>(null);
  const [downloadingCsv, setDownloadingCsv] = useState(false);

  // ── Build query ──
  const buildParams = useCallback((extra: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    if (planFilter) p.set('plan', planFilter);
    if (gradeFilter) p.set('grade', gradeFilter);
    if (streamFilter) p.set('stream', streamFilter);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return p;
  }, [planFilter, gradeFilter, streamFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/super-admin/subjects/violations?${buildParams()}`);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const d = await res.json();
      const rows: Violation[] = d.data || d.rows || [];
      setData(rows);
      setTotal(d.total ?? rows.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, buildParams]);

  useEffect(() => { load(); }, [load]);

  // ── Repair single ──
  const repairOne = async (row: Violation) => {
    setRepairing(row.student_id);
    try {
      // Filter selected_subjects (valid_subjects from API, or compute from invalid)
      const valid = row.valid_subjects || [];
      const res = await apiFetch(`/api/super-admin/students/${encodeURIComponent(row.student_id)}/subjects`, {
        method: 'PATCH',
        body: JSON.stringify({
          subjects: valid,
          preferred: valid[0] || null,
          reason: 'auto-repair: removed subjects no longer allowed under current grade/stream/plan',
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Repair failed');
    } finally {
      setRepairing(null);
    }
  };

  // ── Bulk repair ──
  const runBulkRepair = async () => {
    setBulkConfirm(false);
    const items = [...data];
    setBulkProgress({ total: items.length, done: 0, failures: [] });
    const failures: { id: string; error: string }[] = [];
    for (let i = 0; i < items.length; i++) {
      const row = items[i];
      try {
        const valid = row.valid_subjects || [];
        const res = await apiFetch(`/api/super-admin/students/${encodeURIComponent(row.student_id)}/subjects`, {
          method: 'PATCH',
          body: JSON.stringify({
            subjects: valid,
            preferred: valid[0] || null,
            reason: 'bulk auto-repair: removed subjects no longer allowed',
          }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          failures.push({ id: row.student_id, error: e.error || `HTTP ${res.status}` });
        }
      } catch (e) {
        failures.push({ id: row.student_id, error: e instanceof Error ? e.message : 'unknown' });
      }
      setBulkProgress({ total: items.length, done: i + 1, failures: [...failures] });
    }
    await load();
  };

  const downloadCsv = async () => {
    setDownloadingCsv(true);
    try {
      const res = await apiFetch(`/api/super-admin/subjects/violations?${buildParams({ format: 'csv' })}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `subject-violations-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CSV download failed');
    } finally {
      setDownloadingCsv(false);
    }
  };

  // ── Columns ──
  const columns: Column<Violation>[] = useMemo(() => [
    {
      key: 'student_id', label: 'Student', width: 220,
      render: (r) => (
        <div>
          {r.student_name && <div style={{ fontWeight: 600 }}>{r.student_name}</div>}
          <a
            href={`/super-admin/students/${encodeURIComponent(r.student_id)}`}
            style={{ fontSize: 11, color: colors.accent, textDecoration: 'none' }}
          >
            <code>{r.student_id.slice(0, 8)}…</code>
          </a>
        </div>
      ),
    },
    { key: 'grade', label: 'Grade', width: 70 },
    {
      key: 'stream', label: 'Stream', width: 110,
      render: (r) => r.stream ? <StatusBadge label={r.stream} variant="info" /> : <span style={{ color: colors.text3 }}>—</span>,
    },
    {
      key: 'plan', label: 'Plan', width: 100,
      render: (r) => <StatusBadge label={r.plan || 'free'} variant="neutral" />,
    },
    {
      key: 'invalid_subjects', label: 'Invalid subjects',
      render: (r) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(r.invalid_subjects || []).map((s) => (
            <span key={s} style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 10,
              background: colors.dangerLight, color: colors.danger, fontWeight: 500,
            }}>{s}</span>
          ))}
        </div>
      ),
    },
    {
      key: 'total', label: '#', width: 50,
      render: (r) => <span style={{ fontWeight: 600 }}>{(r.invalid_subjects || []).length}</span>,
    },
    {
      key: '__actions', label: 'Actions', width: 130, sortable: false,
      render: (r) => (
        <button
          style={S.actionBtn}
          disabled={repairing === r.student_id || !!bulkProgress}
          onClick={(e) => { e.stopPropagation(); repairOne(r); }}
        >
          {repairing === r.student_id ? 'Repairing…' : 'Auto-repair'}
        </button>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [repairing, bulkProgress]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={S.h1}>Subject Violations</h1>
          <div style={S.subtitle}>
            Students whose current enrollment includes subjects not allowed under their
            grade, stream, or plan. Auto-repair preserves the valid subset and logs to <code>admin_audit_log</code>.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.dlBtn} onClick={downloadCsv} disabled={downloadingCsv}>
            {downloadingCsv ? 'Downloading…' : 'Download CSV'}
          </button>
          <button style={S.secondaryBtn} onClick={load} disabled={loading}>Refresh</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={{ fontSize: 11, color: colors.text2, display: 'block', marginBottom: 4 }} htmlFor="plan-filter">
            Plan
          </label>
          <select
            id="plan-filter"
            style={S.select}
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value as PlanCode)}
          >
            {PLANS.map((p) => <option key={p} value={p}>{p === '' ? 'All plans' : p}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: colors.text2, display: 'block', marginBottom: 4 }} htmlFor="grade-filter">
            Grade
          </label>
          <select
            id="grade-filter"
            style={S.select}
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
          >
            {GRADES.map((g) => <option key={g} value={g}>{g === '' ? 'All grades' : `Grade ${g}`}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: colors.text2, display: 'block', marginBottom: 4 }} htmlFor="stream-filter">
            Stream
          </label>
          <select
            id="stream-filter"
            style={S.select}
            value={streamFilter}
            onChange={(e) => setStreamFilter(e.target.value as Stream)}
          >
            {STREAMS.map((s) => <option key={s} value={s}>{s === '' ? 'All streams' : s}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button
            style={S.dangerBtn}
            disabled={loading || data.length === 0 || !!bulkProgress}
            onClick={() => setBulkConfirm(true)}
          >
            Auto-repair all filtered ({data.length})
          </button>
        </div>
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

      <div style={{ fontSize: 12, color: colors.text3, marginBottom: 8 }}>
        {loading ? 'Loading…' : `${total} violation${total === 1 ? '' : 's'} matching filters`}
      </div>

      <DataTable
        columns={columns}
        data={data}
        keyField="student_id"
        loading={loading}
        emptyMessage="No violations under the current filters."
      />

      {/* Bulk confirm modal */}
      {bulkConfirm && (
        <Modal
          title={`Auto-repair ${data.length} student${data.length === 1 ? '' : 's'}?`}
          body={`This will remove invalid subject enrollments for every student in the current filtered list. Each repair preserves the valid subset and is logged to admin_audit_log. This cannot be undone in bulk.`}
          confirmLabel="Repair all"
          confirmDanger
          onCancel={() => setBulkConfirm(false)}
          onConfirm={runBulkRepair}
        />
      )}

      {/* Bulk progress modal */}
      {bulkProgress && (
        <Modal
          title="Bulk repair in progress"
          body={
            <div>
              <div style={{ marginBottom: 12 }}>
                Repaired <strong>{bulkProgress.done}</strong> of <strong>{bulkProgress.total}</strong>
                {bulkProgress.failures.length > 0 && (
                  <span style={{ color: colors.danger }}> · {bulkProgress.failures.length} failed</span>
                )}
              </div>
              <div style={{
                height: 8, background: colors.surface, borderRadius: 4, overflow: 'hidden',
                border: `1px solid ${colors.border}`,
              }}>
                <div style={{
                  height: '100%',
                  width: `${(bulkProgress.done / Math.max(1, bulkProgress.total)) * 100}%`,
                  background: colors.success,
                  transition: 'width 0.2s',
                }} />
              </div>
              {bulkProgress.failures.length > 0 && (
                <div style={{ marginTop: 12, maxHeight: 160, overflowY: 'auto', fontSize: 11 }}>
                  {bulkProgress.failures.map((f) => (
                    <div key={f.id} style={{ color: colors.danger, marginBottom: 4 }}>
                      <code>{f.id.slice(0, 8)}…</code>: {f.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          }
          confirmLabel="Close"
          onCancel={() => setBulkProgress(null)}
          onConfirm={() => setBulkProgress(null)}
          hideCancel={bulkProgress.done < bulkProgress.total}
        />
      )}
    </div>
  );
}

function Modal({
  title, body, confirmLabel, onCancel, onConfirm, confirmDanger, hideCancel,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmDanger?: boolean;
  hideCancel?: boolean;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);
  return (
    <>
      <div onClick={hideCancel ? undefined : onCancel} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 999,
      }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-title"
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          background: colors.bg, borderRadius: 10, padding: 24, width: 480,
          boxShadow: '0 12px 48px rgba(0,0,0,0.18)', zIndex: 1000,
        }}
      >
        <h3 id="bulk-title" style={{ margin: 0, fontSize: 16, color: colors.text1, fontWeight: 700 }}>{title}</h3>
        <div style={{ fontSize: 13, color: colors.text2, marginTop: 12, lineHeight: 1.5 }}>{body}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          {!hideCancel && <button style={S.secondaryBtn} onClick={onCancel} autoFocus>Cancel</button>}
          <button style={confirmDanger ? S.dangerBtn : S.primaryBtn} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </>
  );
}

export default function ViolationsPage() {
  return (
    <AdminShell>
      <ViolationsContent />
    </AdminShell>
  );
}
