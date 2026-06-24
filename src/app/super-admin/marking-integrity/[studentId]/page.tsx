'use client';

/**
 * Super Admin — Marking Integrity Session Drill-Down
 *
 * Displays all drift/missing-snapshot rows for a single student, optionally
 * filtered to a specific session via `?session=<session_id>`.
 *
 * Route: /super-admin/marking-integrity/[studentId]?session=<session_id>
 *
 * Backend contract:
 *   GET /api/super-admin/marking-integrity/[studentId]?session=<sid>&limit=100
 *   => { student_id, session_filter, rows: SessionDetailRow[], sessions, total }
 *
 * Auth: same AdminShell / apiFetch pattern as the parent page.
 * Privacy: UUIDs only — no PII displayed.
 *
 * Runbook: docs/runbooks/forensic-quiz-investigation.md
 */

import { useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { useAuth } from '@/lib/AuthContext';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { StatusBadge } from '@/components/admin-ui';

/* ── Design tokens (mirror the parent page) ─────────────────────────── */

const colors = {
  bg: '#FFFFFF',
  text1: '#111827',
  text2: '#6B7280',
  text3: '#9CA3AF',
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
  borderLight: '#F3F4F6',
  surface: '#F9FAFB',
  surfaceHover: '#F3F4F6',
  accent: '#2563EB',
  accentLight: '#EFF6FF',
  success: '#16A34A',
  successLight: '#F0FDF4',
  warning: '#D97706',
  warningLight: '#FFFBEB',
  danger: '#DC2626',
  dangerLight: '#FEF2F2',
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
};

/* ── Types ──────────────────────────────────────────────────────────── */

interface SessionDetailRow {
  student_id: string;
  session_id: string;
  question_id: string;
  selected_option: number | null;
  snapshot_correct_idx: number | null;
  recorded_is_correct: boolean | null;
  expected_is_correct: boolean | null;
  completed_at: string;
}

interface SessionSummary {
  session_id: string;
  drift: number;
  missing: number;
  total: number;
}

interface DetailResponse {
  student_id: string;
  session_filter: string | null;
  rows: SessionDetailRow[];
  sessions: SessionSummary[];
  total: number;
}

/* ── Helpers ────────────────────────────────────────────────────────── */

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

function classifyRow(row: SessionDetailRow): 'drift' | 'missing_snapshot' | 'ok' {
  if (row.snapshot_correct_idx === null) return 'missing_snapshot';
  if (row.recorded_is_correct !== row.expected_is_correct) return 'drift';
  return 'ok';
}

/* ── Skeleton ───────────────────────────────────────────────────────── */

function TableSkeleton() {
  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        overflow: 'hidden',
        opacity: 0.6,
      }}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            padding: '12px 14px',
            borderBottom: `1px solid ${colors.borderLight}`,
            display: 'flex',
            gap: 24,
          }}
        >
          {[120, 90, 90, 50, 50, 60, 90].map((w, j) => (
            <div
              key={j}
              style={{
                height: 12,
                width: w,
                background: colors.borderStrong,
                borderRadius: 4,
                opacity: 0.4,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Main content ───────────────────────────────────────────────────── */

function SessionDetailContent() {
  const { isHi } = useAuth();
  const { apiFetch } = useAdmin();
  const params = useParams();
  const searchParams = useSearchParams();

  const studentId = typeof params.studentId === 'string' ? params.studentId : '';
  const sessionId = searchParams.get('session') ?? '';

  const apiUrl = sessionId
    ? `/api/super-admin/marking-integrity/${studentId}?session=${sessionId}&limit=100`
    : `/api/super-admin/marking-integrity/${studentId}?limit=100`;

  const fetcher = useCallback(
    async (url: string): Promise<DetailResponse> => {
      const res = await apiFetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    [apiFetch],
  );

  const { data, error, isLoading, mutate } = useSWR<DetailResponse>(
    studentId ? apiUrl : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  if (!studentId) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: 'center',
          color: colors.danger,
          fontSize: 14,
        }}
      >
        {isHi ? 'Student ID नहीं मिला।' : 'No student ID in the URL.'}
      </div>
    );
  }

  const rows = data?.rows ?? [];
  const sessions = data?.sessions ?? [];

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 20,
        }}
      >
        <div>
          {/* Back link */}
          <Link
            href="/super-admin/marking-integrity"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: colors.accent,
              textDecoration: 'none',
              marginBottom: 10,
            }}
          >
            &#8592; {isHi ? 'वापस Marking Integrity' : 'Back to Marking Integrity'}
          </Link>
          <h1 style={S.h1}>
            {isHi ? 'Session विवरण' : 'Session Drill-Down'}
          </h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            {isHi
              ? 'एक student के सभी drift/missing-snapshot rows। UUIDs only, कोई PII नहीं।'
              : 'All drift and missing-snapshot rows for this student. UUIDs only — no PII.'}
          </p>
        </div>
        <button
          onClick={() => mutate()}
          disabled={isLoading}
          className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2 disabled:opacity-50"
        >
          {isLoading
            ? isHi ? 'लोड हो रहा है...' : 'Loading...'
            : isHi ? 'Refresh' : 'Refresh'}
        </button>
      </div>

      {/* Identity cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            padding: '14px 18px',
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            {isHi ? 'Student ID' : 'Student ID'}
          </div>
          <code style={{ fontSize: 12, color: colors.text1, wordBreak: 'break-all' }}>
            {studentId}
          </code>
        </div>
        {sessionId && (
          <div
            style={{
              padding: '14px 18px',
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: colors.surface,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
              {isHi ? 'Session ID (filter)' : 'Session ID (filter)'}
            </div>
            <code style={{ fontSize: 12, color: colors.text1, wordBreak: 'break-all' }}>
              {sessionId}
            </code>
          </div>
        )}
        <div
          style={{
            padding: '14px 18px',
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            {isHi ? 'कुल Rows' : 'Total Rows'}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: rows.length > 0 ? colors.danger : colors.success }}>
            {isLoading ? '—' : (data?.total ?? 0)}
          </div>
        </div>
        <div
          style={{
            padding: '14px 18px',
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            {isHi ? 'Sessions प्रभावित' : 'Sessions Affected'}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: colors.accent }}>
            {isLoading ? '—' : sessions.length}
          </div>
        </div>
      </div>

      {/* Loading */}
      {isLoading && !data && <TableSkeleton />}

      {/* Error */}
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
            <strong>
              {isHi ? 'डेटा लोड नहीं हुआ।' : 'Failed to load session detail.'}
            </strong>
            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
              {error instanceof Error ? error.message : String(error)}
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

      {/* Session summary chips (only when not already filtered to one session) */}
      {!isLoading && !error && !sessionId && sessions.length > 1 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: colors.text3, marginBottom: 8, fontWeight: 600 }}>
            {isHi ? 'Sessions (click करें filter के लिए):' : 'Sessions (click to filter):'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {sessions.map((s) => (
              <Link
                key={s.session_id}
                href={`/super-admin/marking-integrity/${studentId}?session=${s.session_id}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: `1px solid ${colors.border}`,
                  background: colors.surface,
                  fontSize: 12,
                  color: colors.text2,
                  textDecoration: 'none',
                }}
              >
                <code style={{ fontSize: 11 }}>{shortUuid(s.session_id)}</code>
                {s.drift > 0 && (
                  <span
                    style={{
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: colors.dangerLight,
                      color: colors.danger,
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {s.drift} drift
                  </span>
                )}
                {s.missing > 0 && (
                  <span
                    style={{
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: colors.warningLight,
                      color: colors.warning,
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {s.missing} missing
                  </span>
                )}
              </Link>
            ))}
          </div>
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
            ? 'इस student के लिए कोई marking integrity issue नहीं मिला।'
            : 'No marking integrity issues found for this student.'}
        </div>
      )}

      {/* Detail table */}
      {!isLoading && !error && rows.length > 0 && (
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>{isHi ? 'Session' : 'Session'}</th>
                <th style={S.th}>{isHi ? 'Question' : 'Question'}</th>
                <th style={S.th}>{isHi ? 'Selected Opt' : 'Selected Opt'}</th>
                <th style={S.th}>{isHi ? 'Snapshot Correct Idx' : 'Snapshot Correct Idx'}</th>
                <th style={S.th}>{isHi ? 'Recorded ✓' : 'Recorded ✓'}</th>
                <th style={S.th}>{isHi ? 'Expected ✓' : 'Expected ✓'}</th>
                <th style={S.th}>{isHi ? 'Mismatch Type' : 'Mismatch Type'}</th>
                <th style={S.th}>{isHi ? 'Completed At' : 'Completed At'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const klass = classifyRow(row);
                const variant: 'danger' | 'warning' | 'neutral' =
                  klass === 'drift'
                    ? 'danger'
                    : klass === 'missing_snapshot'
                    ? 'warning'
                    : 'neutral';
                const labelEn =
                  klass === 'drift'
                    ? 'Drift'
                    : klass === 'missing_snapshot'
                    ? 'Missing Snapshot'
                    : 'OK';
                const labelHi =
                  klass === 'drift'
                    ? 'Drift'
                    : klass === 'missing_snapshot'
                    ? 'Missing Snapshot'
                    : 'OK';

                return (
                  <tr
                    key={`${row.session_id}-${row.question_id}-${idx}`}
                    style={
                      klass === 'drift'
                        ? { background: '#FFF5F5' }
                        : klass === 'missing_snapshot'
                        ? { background: '#FFFBEB' }
                        : {}
                    }
                  >
                    <td style={S.td}>
                      <code style={{ fontSize: 11, color: colors.accent }} title={row.session_id}>
                        {shortUuid(row.session_id)}
                      </code>
                    </td>
                    <td style={S.td}>
                      <code style={{ fontSize: 11, color: colors.text3 }} title={row.question_id}>
                        {shortUuid(row.question_id)}
                      </code>
                    </td>
                    <td style={S.td}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                        {row.selected_option ?? '—'}
                      </span>
                    </td>
                    <td style={S.td}>
                      {row.snapshot_correct_idx === null ? (
                        <span style={{ color: colors.warning, fontWeight: 600 }}>
                          {isHi ? 'गायब' : 'missing'}
                        </span>
                      ) : (
                        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {row.snapshot_correct_idx}
                        </span>
                      )}
                    </td>
                    <td style={S.td}>
                      {row.recorded_is_correct === null ? (
                        <span style={{ color: colors.text3 }}>—</span>
                      ) : row.recorded_is_correct ? (
                        <span style={{ color: colors.success, fontWeight: 600 }}>
                          {isHi ? 'सही' : 'true'}
                        </span>
                      ) : (
                        <span style={{ color: colors.danger, fontWeight: 600 }}>
                          {isHi ? 'गलत' : 'false'}
                        </span>
                      )}
                    </td>
                    <td style={S.td}>
                      {row.expected_is_correct === null ? (
                        <span style={{ color: colors.text3 }}>—</span>
                      ) : row.expected_is_correct ? (
                        <span style={{ color: colors.success, fontWeight: 600 }}>
                          {isHi ? 'सही' : 'true'}
                        </span>
                      ) : (
                        <span style={{ color: colors.danger, fontWeight: 600 }}>
                          {isHi ? 'गलत' : 'false'}
                        </span>
                      )}
                    </td>
                    <td style={S.td}>
                      <StatusBadge label={isHi ? labelHi : labelEn} variant={variant} />
                    </td>
                    <td style={S.td}>
                      <span style={{ fontSize: 11, color: colors.text3 }}>
                        {formatTimestamp(row.completed_at)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer: forensic command hint */}
      {!isLoading && !error && rows.length > 0 && (
        <div
          style={{
            marginTop: 20,
            padding: '12px 16px',
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            fontSize: 12,
            color: colors.text2,
          }}
        >
          <strong>{isHi ? 'Deep forensic:' : 'Deep forensic:'}</strong>{' '}
          <code style={{ color: colors.text1, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            npm run forensic:quiz -- --student-id {studentId}
            {sessionId ? ` --session-id ${sessionId}` : ''}
          </code>
        </div>
      )}
    </div>
  );
}

export default function MarkingIntegritySessionPage() {
  return (
    <AdminShell>
      <SessionDetailContent />
    </AdminShell>
  );
}
