'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { colors, S } from '../../_components/admin-styles';
import StatCard from '../../_components/StatCard';

/**
 * Grounding Coverage — super-admin page (Task 3.17a)
 *
 * Lists ingestion_gaps rows (cbse_syllabus chapters where rag_status !=
 * 'ready'). Filter by grade + subject + status. Summary at top.
 *
 * Read-only: ingestion is driven by nightly coverage-audit Edge Function;
 * this page is for triage + operator awareness.
 */

interface Gap {
  board: string;
  grade: string;
  subject_code: string;
  subject_display: string;
  chapter_number: number;
  chapter_title: string;
  rag_status: string;
  chunk_count: number;
  verified_question_count: number;
  severity: string;
  request_count: number;
  potential_affected_students: number;
  last_verified_at: string | null;
}

interface CoverageResponse {
  success: boolean;
  data: {
    gaps: Gap[];
    summary: { total_gaps: number; critical: number; high: number; medium: number };
    filters: { grade: string | null; subject: string | null };
  };
  error?: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: colors.danger,
  high: colors.warning,
  medium: '#2563EB',
  low: colors.text3,
};

function CoverageContent() {
  const { apiFetch } = useAdmin();
  const [data, setData] = useState<CoverageResponse['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gradeFilter, setGradeFilter] = useState<string>('');
  const [subjectFilter, setSubjectFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const fetchCoverage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (gradeFilter) params.set('grade', gradeFilter);
      if (subjectFilter) params.set('subject', subjectFilter);
      const qs = params.toString();
      const url = `/api/super-admin/grounding/coverage${qs ? `?${qs}` : ''}`;
      const res = await apiFetch(url);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || `Request failed with status ${res.status}`);
        return;
      }
      const body = (await res.json()) as CoverageResponse;
      if (!body.success) {
        setError(body.error || 'Request failed');
        return;
      }
      setData(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load coverage');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, gradeFilter, subjectFilter]);

  useEffect(() => {
    fetchCoverage();
  }, [fetchCoverage]);

  const filteredGaps = (data?.gaps ?? []).filter((g) => {
    if (statusFilter && g.rag_status !== statusFilter) return false;
    return true;
  });

  return (
    <div data-testid="grounding-coverage-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={S.h1}>Grounding Coverage</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            CBSE syllabus chapters that are not yet fully ingested or verified
          </p>
        </div>
        <button onClick={fetchCoverage} style={S.secondaryBtn}>Refresh</button>
      </div>

      {error && (
        <div
          data-testid="grounding-coverage-error"
          style={{ padding: 12, marginBottom: 16, borderRadius: 6, background: colors.dangerLight, color: colors.danger, fontSize: 13 }}
        >
          Error: {error}
        </div>
      )}

      {/* Summary */}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          <StatCard label="Total gaps" value={data.summary.total_gaps} />
          <StatCard label="Critical" value={data.summary.critical} accentColor={SEVERITY_COLORS.critical} />
          <StatCard label="High" value={data.summary.high} accentColor={SEVERITY_COLORS.high} />
          <StatCard label="Medium" value={data.summary.medium} accentColor={SEVERITY_COLORS.medium} />
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Grade (6-12)"
          value={gradeFilter}
          onChange={(e) => setGradeFilter(e.target.value)}
          style={{ ...S.searchInput, width: 120 }}
          aria-label="Filter by grade"
        />
        <input
          type="text"
          placeholder="Subject (e.g. science)"
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          style={{ ...S.searchInput, width: 180 }}
          aria-label="Filter by subject"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={S.select}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="not_started">not_started</option>
          <option value="ingesting">ingesting</option>
          <option value="chunks_ready">chunks_ready</option>
          <option value="questions_pending">questions_pending</option>
          <option value="ready">ready</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <table style={S.table} data-testid="grounding-coverage-table">
          <thead>
            <tr>
              <th style={S.th}>Grade</th>
              <th style={S.th}>Subject</th>
              <th style={S.th}>Chapter</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Chunks</th>
              <th style={S.th}>Verified Q</th>
              <th style={S.th}>Severity</th>
              <th style={S.th}>Requests</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} style={{ ...S.td, textAlign: 'center', color: colors.text3 }}>
                  Loading...
                </td>
              </tr>
            )}
            {!loading && filteredGaps.length === 0 && !error && (
              <tr>
                <td colSpan={8} style={{ ...S.td, textAlign: 'center', color: colors.text3 }}>
                  No gaps found.
                </td>
              </tr>
            )}
            {filteredGaps.map((g, idx) => (
              <tr key={`${g.grade}-${g.subject_code}-${g.chapter_number}-${idx}`}>
                <td style={S.td}>{g.grade}</td>
                <td style={S.td}>{g.subject_display || g.subject_code}</td>
                <td style={S.td}>
                  <span style={{ color: colors.text3, marginRight: 6 }}>Ch {g.chapter_number}</span>
                  {g.chapter_title}
                </td>
                <td style={S.td}>
                  <code style={{ fontSize: 11, color: colors.text2 }}>{g.rag_status}</code>
                </td>
                <td style={S.td}>{g.chunk_count}</td>
                <td style={S.td}>{g.verified_question_count}</td>
                <td style={S.td}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 10,
                      fontSize: 11,
                      fontWeight: 600,
                      background: (SEVERITY_COLORS[g.severity] || colors.text3) + '20',
                      color: SEVERITY_COLORS[g.severity] || colors.text3,
                    }}
                  >
                    {g.severity}
                  </span>
                </td>
                <td style={S.td}>{g.request_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function GroundingCoveragePage() {
  return (
    <AdminShell>
      <CoverageContent />
    </AdminShell>
  );
}