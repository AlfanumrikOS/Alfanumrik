'use client';

/**
 * Super Admin — Marking Integrity (last 30d)
 *
 * Surfaces drift rows from `public.marking_audit_last_30d` so ops can triage
 * marking complaints in <60s. PII boundary: UUIDs only (truncated for display);
 * never email/phone/full-name.
 *
 * Backend contract: GET /api/super-admin/marking-integrity?limit=50&orderBy=drift_count
 *   => { rows: MarkingAuditRow[], summary: MarkingAuditSummary }
 *
 * Runbook: docs/runbooks/forensic-quiz-investigation.md
 */

import { useMemo, useState, useCallback } from 'react';
import useSWR from 'swr';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { StatCard, StatusBadge } from '@alfanumrik/ui/admin-ui';

const colors = {
  bg: 'var(--surface-1)',
  text1: 'var(--text-1)',
  text2: 'var(--text-2)',
  text3: 'var(--text-3)',
  border: 'var(--border)',
  borderStrong: 'var(--border-strong)',
  borderLight: 'var(--border)',
  surface: 'var(--surface-2)',
  surfaceHover: 'var(--surface-3)',
  accent: 'var(--info)',
  accentLight: 'color-mix(in srgb, var(--info) 10%, transparent)',
  success: 'var(--success)',
  successLight: 'color-mix(in srgb, var(--success) 10%, transparent)',
  warning: 'var(--warning)',
  warningLight: 'color-mix(in srgb, var(--warning) 12%, transparent)',
  danger: 'var(--danger)',
  dangerLight: 'color-mix(in srgb, var(--danger) 10%, transparent)',
} as const;

const S = {
  h1: {
    fontSize: 20,
    fontWeight: 700,
    color: colors.text1,
    marginBottom: 4,
    letterSpacing: -0.3,
  } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } as React.CSSProperties,
  th: {
    textAlign: 'left',
    padding: '10px 14px',
    borderBottom: `2px solid ${colors.border}`,
    color: colors.text2,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 1,
    background: colors.surface,
    position: 'sticky',
    top: 0,
    zIndex: 1,
  } as React.CSSProperties,
  td: {
    padding: '10px 14px',
    borderBottom: `1px solid ${colors.borderLight}`,
    color: colors.text1,
    fontSize: 13,
  } as React.CSSProperties,
  filterBtn: {
    padding: '7px 14px',
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.text2,
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
  } as React.CSSProperties,
  filterActive: {
    background: colors.text1,
    color: colors.bg,
    borderColor: colors.text1,
  } as React.CSSProperties,
  actionBtn: {
    background: 'none',
    border: `1px solid ${colors.border}`,
    borderRadius: 5,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 500,
    color: colors.text2,
  } as React.CSSProperties,
};

/* ── Types ─────────────────────────────────────────────── */

interface MarkingAuditRow {
  student_id: string;
  session_id: string;
  question_id: string;
  selected_option: number | null;
  snapshot_correct_idx: number | null;
  recorded_is_correct: boolean | null;
  expected_is_correct: boolean | null;
  marking_authenticity_path: string | null;
  completed_at: string;
  drift_count?: number;
}

interface MarkingAuditSummary {
  total_drift_count: number;
  total_missing_snapshot: number;
  affected_students: number;
  time_window: string;
}

interface MarkingIntegrityResponse {
  rows: MarkingAuditRow[];
  summary: MarkingAuditSummary;
}

type FilterMode = 'all' | 'drift' | 'missing_snapshot';

/* ── Helpers ───────────────────────────────────────────── */

function shortUuid(uuid: string): string {
  if (!uuid) return '—';
  return `${uuid.slice(0, 8)}...`;
}

function formatTimestamp(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}Z`;
  } catch {
    return iso;
  }
}

function classifyRow(row: MarkingAuditRow): 'drift' | 'missing_snapshot' | 'ok' {
  if (row.snapshot_correct_idx === null) return 'missing_snapshot';
  if (row.recorded_is_correct !== row.expected_is_correct) return 'drift';
  return 'ok';
}

/* ── Loading Skeleton ─────────────────────────────────── */

function SummaryCardsSkeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
      {[0, 1, 2, 3].map(i => (
        <div
          key={i}
          style={{
            padding: '16px 18px',
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            height: 78,
            opacity: 0.6,
          }}
        >
          <div style={{ height: 28, width: '40%', background: colors.borderStrong, borderRadius: 4, opacity: 0.4 }} />
          <div style={{ height: 11, width: '60%', background: colors.borderStrong, borderRadius: 4, marginTop: 8, opacity: 0.4 }} />
        </div>
      ))}
    </div>
  );
}

/* ── Forensic Modal ───────────────────────────────────── */

function ForensicModal({
  studentId,
  isHi,
  onClose,
}: {
  studentId: string;
  isHi: boolean;
  onClose: () => void;
}) {
  const cmd = `npm run forensic:quiz -- --student-id ${studentId}`;
  const [copied, setCopied] = useState(false);

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'var(--scrim)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: colors.bg, borderRadius: 12, padding: 24, width: 560, maxWidth: '92vw', boxShadow: 'var(--shadow-lg)' }}>
        <h2 style={{ ...S.h1, marginBottom: 4 }}>
          {isHi ? 'Forensic रिपोर्ट चलाएँ' : 'Run Forensic Report'}
        </h2>
        <p style={{ fontSize: 13, color: colors.text3, margin: 0, marginBottom: 16 }}>
          {isHi
            ? 'अपने टर्मिनल में नीचे दिया कमांड चलाएँ। यह विश्लेषण server पर अभी auto नहीं चलता।'
            : 'Run the command below in your terminal. This analysis is not yet auto-executed server-side.'}
        </p>

        <div
          style={{
            padding: 12,
            borderRadius: 6,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            color: colors.text1,
            wordBreak: 'break-all',
            marginBottom: 12,
          }}
        >
          {cmd}
        </div>

        <div style={{ fontSize: 12, color: colors.text3, marginBottom: 16 }}>
          {isHi ? 'student UUID:' : 'student UUID:'} <code style={{ color: colors.text2 }}>{studentId}</code>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={() => {
              navigator.clipboard.writeText(cmd).then(
                () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
                () => { /* ignore */ },
              );
            }}
            className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
          >
            {copied ? (isHi ? 'कॉपी हो गया' : 'Copied') : (isHi ? 'कमांड कॉपी करें' : 'Copy command')}
          </button>
          <button
            onClick={onClose}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90"
          >
            {isHi ? 'बंद करें' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Content ─────────────────────────────────────── */

function MarkingIntegrityContent() {
  const { isHi } = useAuth();
  const { apiFetch } = useAdmin();
  const [filter, setFilter] = useState<FilterMode>('all');
  const [forensicStudentId, setForensicStudentId] = useState<string | null>(null);

  const fetcher = useCallback(
    async (url: string): Promise<MarkingIntegrityResponse> => {
      const res = await apiFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    [apiFetch],
  );

  const { data, error, isLoading, mutate } = useSWR<MarkingIntegrityResponse>(
    '/api/super-admin/marking-integrity?limit=50&orderBy=drift_count',
    fetcher,
    { revalidateOnFocus: false },
  );

  const rows = useMemo<MarkingAuditRow[]>(() => data?.rows ?? [], [data]);
  const summary = data?.summary;

  const filteredRows = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'drift') return rows.filter(r => classifyRow(r) === 'drift');
    if (filter === 'missing_snapshot') return rows.filter(r => classifyRow(r) === 'missing_snapshot');
    return rows;
  }, [rows, filter]);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground mb-1">
            {isHi ? 'Marking Integrity (पिछले 30 दिन)' : 'Marking Integrity (last 30d)'}
          </h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            {isHi
              ? 'Quiz scoring drift और missing snapshot rows की निगरानी। UUIDs only, कोई PII नहीं।'
              : 'Quiz scoring drift and missing-snapshot rows. UUIDs only — no PII.'}
          </p>
        </div>
        <button
          onClick={() => mutate()}
          disabled={isLoading}
          className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2 disabled:opacity-50"
        >
          {isLoading ? (isHi ? 'लोड हो रहा है...' : 'Loading...') : (isHi ? 'Refresh' : 'Refresh')}
        </button>
      </div>

      {/* Loading state */}
      {isLoading && !data && <SummaryCardsSkeleton />}

      {/* Error state */}
      {error && !isLoading && (
        <div
          style={{
            padding: 20,
            borderRadius: 8,
            background: colors.dangerLight,
            border: `1px solid ${colors.danger}`,
            color: colors.danger,
            fontSize: 13,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            marginBottom: 24,
          }}
        >
          <div>
            <strong>{isHi ? 'डेटा लोड नहीं हुआ।' : 'Failed to load marking integrity data.'}</strong>
            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
              {isHi
                ? 'कृपया कुछ देर बाद दोबारा कोशिश करें या console में detail देखें।'
                : 'Please retry shortly, or check the console for details.'}
            </div>
          </div>
          <button
            onClick={() => mutate()}
            className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
          >
            {isHi ? 'दोबारा कोशिश करें' : 'Retry'}
          </button>
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
          <StatCard
            label={isHi ? 'कुल Drift Rows' : 'Total Drift Rows'}
            value={summary.total_drift_count}
            accentColor={summary.total_drift_count > 0 ? colors.danger : colors.success}
          />
          <StatCard
            label={isHi ? 'Missing Snapshot' : 'Missing Snapshot'}
            value={summary.total_missing_snapshot}
            accentColor={summary.total_missing_snapshot > 0 ? colors.warning : colors.success}
          />
          <StatCard
            label={isHi ? 'प्रभावित Students' : 'Affected Students'}
            value={summary.affected_students}
            accentColor={colors.accent}
          />
          <StatCard
            label={isHi ? 'समय window' : 'Time Window'}
            value={summary.time_window || '30d'}
            accentColor={colors.text3}
          />
        </div>
      )}

      {/* Filters */}
      {!isLoading && !error && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: colors.text3, marginRight: 4 }}>
            {isHi ? 'Filter:' : 'Filter:'}
          </span>
          {([
            { id: 'all' as const, labelEn: `All (${rows.length})`, labelHi: `सभी (${rows.length})` },
            { id: 'drift' as const, labelEn: 'Drift only', labelHi: 'सिर्फ Drift' },
            { id: 'missing_snapshot' as const, labelEn: 'Missing snapshot only', labelHi: 'सिर्फ Missing Snapshot' },
          ]).map(f => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                style={{ ...S.filterBtn, ...(active ? S.filterActive : {}) }}
              >
                {isHi ? f.labelHi : f.labelEn}
              </button>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && rows.length === 0 && (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            background: colors.successLight,
            color: colors.success,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {isHi
            ? 'पिछले 30 दिनों में कोई marking integrity issue नहीं मिला।'
            : 'No marking integrity issues detected in last 30 days.'}
        </div>
      )}

      {/* No results after filter */}
      {!isLoading && !error && rows.length > 0 && filteredRows.length === 0 && (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            color: colors.text3,
            fontSize: 13,
          }}
        >
          {isHi ? 'इस filter से कोई row नहीं मिली।' : 'No rows match this filter.'}
        </div>
      )}

      {/* Drift table */}
      {!isLoading && !error && filteredRows.length > 0 && (
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>{isHi ? 'Student' : 'Student'}</th>
                <th style={S.th}>{isHi ? 'Session' : 'Session'}</th>
                <th style={S.th}>{isHi ? 'Question' : 'Question'}</th>
                <th style={S.th}>{isHi ? 'Selected' : 'Selected'}</th>
                <th style={S.th}>{isHi ? 'Snapshot Correct' : 'Snapshot Correct'}</th>
                <th style={S.th}>{isHi ? 'Path' : 'Path'}</th>
                <th style={S.th}>{isHi ? 'Status' : 'Status'}</th>
                <th style={S.th}>{isHi ? 'Completed At' : 'Completed At'}</th>
                <th style={S.th}>{isHi ? 'Action' : 'Action'}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, idx) => {
                const klass = classifyRow(row);
                const variant: 'danger' | 'warning' | 'neutral' =
                  klass === 'drift' ? 'danger' : klass === 'missing_snapshot' ? 'warning' : 'neutral';
                const labelEn = klass === 'drift' ? 'Drift' : klass === 'missing_snapshot' ? 'Missing Snapshot' : 'OK';
                const labelHi = klass === 'drift' ? 'Drift' : klass === 'missing_snapshot' ? 'Missing Snapshot' : 'OK';
                return (
                  <tr key={`${row.session_id}-${row.question_id}-${idx}`}>
                    <td style={S.td}>
                      <code style={{ fontSize: 11, color: colors.text2 }} title={row.student_id}>
                        {shortUuid(row.student_id)}
                      </code>
                    </td>
                    <td style={S.td}>
                      <a
                        href={`/super-admin/marking-integrity/${row.student_id}?session=${row.session_id}`}
                        style={{ color: colors.accent, textDecoration: 'none', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}
                        title={row.session_id}
                      >
                        {shortUuid(row.session_id)}
                      </a>
                    </td>
                    <td style={S.td}>
                      <code style={{ fontSize: 11, color: colors.text3 }} title={row.question_id}>
                        {shortUuid(row.question_id)}
                      </code>
                    </td>
                    <td style={S.td}>{row.selected_option ?? '—'}</td>
                    <td style={S.td}>
                      {row.snapshot_correct_idx === null ? (
                        <span style={{ color: colors.warning, fontWeight: 600 }}>
                          {isHi ? 'गायब' : 'missing'}
                        </span>
                      ) : (
                        row.snapshot_correct_idx
                      )}
                    </td>
                    <td style={S.td}>
                      <code style={{ fontSize: 11, color: colors.text2 }}>
                        {row.marking_authenticity_path ?? 'unknown'}
                      </code>
                    </td>
                    <td style={S.td}>
                      <StatusBadge label={isHi ? labelHi : labelEn} variant={variant} />
                    </td>
                    <td style={S.td}>
                      <span style={{ fontSize: 11, color: colors.text3 }}>
                        {formatTimestamp(row.completed_at)}
                      </span>
                    </td>
                    <td style={S.td}>
                      <button
                        onClick={() => setForensicStudentId(row.student_id)}
                        style={S.actionBtn}
                      >
                        {isHi ? 'Forensic चलाएँ' : 'Run forensic'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Forensic modal */}
      {forensicStudentId && (
        <ForensicModal
          studentId={forensicStudentId}
          isHi={isHi}
          onClose={() => setForensicStudentId(null)}
        />
      )}
    </div>
  );
}

export default function MarkingIntegrityPage() {
  return (
    <AdminShell>
      <MarkingIntegrityContent />
    </AdminShell>
  );
}
