'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { StatCard, StatusBadge, DataTable, type Column } from '@/components/admin-ui';

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

const SEVERITY_ACCENT: Record<string, string> = {
  critical: 'var(--danger)',
  high: 'var(--warning)',
  medium: 'var(--info)',
  low: 'var(--text-3)',
};

const SEVERITY_VARIANT: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
};

type GapRow = Gap & { _key: string; [k: string]: unknown };

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

  const filteredGaps: GapRow[] = (data?.gaps ?? [])
    .filter((g) => (statusFilter ? g.rag_status === statusFilter : true))
    .map((g, idx) => ({ ...g, _key: `${g.grade}-${g.subject_code}-${g.chapter_number}-${idx}` }));

  const columns: Column<GapRow>[] = [
    { key: 'grade', label: 'Grade', sortable: true },
    {
      key: 'subject',
      label: 'Subject',
      sortable: false,
      render: (g) => g.subject_display || g.subject_code,
    },
    {
      key: 'chapter',
      label: 'Chapter',
      sortable: false,
      render: (g) => (
        <>
          <span className="mr-1.5 text-muted-foreground">Ch {g.chapter_number}</span>
          {g.chapter_title}
        </>
      ),
    },
    {
      key: 'rag_status',
      label: 'Status',
      sortable: true,
      render: (g) => <code className="text-[11px] text-muted-foreground">{g.rag_status}</code>,
    },
    { key: 'chunk_count', label: 'Chunks', sortable: true },
    { key: 'verified_question_count', label: 'Verified Q', sortable: true },
    {
      key: 'severity',
      label: 'Severity',
      sortable: true,
      render: (g) => (
        <StatusBadge label={g.severity} variant={SEVERITY_VARIANT[g.severity] || 'neutral'} />
      ),
    },
    { key: 'request_count', label: 'Requests', sortable: true },
  ];

  return (
    <div data-testid="grounding-coverage-page">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Grounding Coverage</h1>
          <p className="m-0 text-[13px] text-muted-foreground">
            CBSE syllabus chapters that are not yet fully ingested or verified
          </p>
        </div>
        <button
          onClick={fetchCoverage}
          className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div
          data-testid="grounding-coverage-error"
          className="mb-4 rounded-md p-3 text-[13px] text-danger"
          style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)' }}
        >
          Error: {error}
        </div>
      )}

      {/* Summary */}
      {data && (
        <div className="mb-4 grid grid-cols-4 gap-3">
          <StatCard label="Total gaps" value={data.summary.total_gaps} />
          <StatCard label="Critical" value={data.summary.critical} accentColor={SEVERITY_ACCENT.critical} />
          <StatCard label="High" value={data.summary.high} accentColor={SEVERITY_ACCENT.high} />
          <StatCard label="Medium" value={data.summary.medium} accentColor={SEVERITY_ACCENT.medium} />
        </div>
      )}

      {/* Filters */}
      <div className="mb-3 flex items-center gap-3">
        <input
          type="text"
          placeholder="Grade (6-12)"
          value={gradeFilter}
          onChange={(e) => setGradeFilter(e.target.value)}
          className="w-[120px] rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Filter by grade"
        />
        <input
          type="text"
          placeholder="Subject (e.g. science)"
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="w-[180px] rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Filter by subject"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="cursor-pointer rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm"
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
      <div data-testid="grounding-coverage-table">
        <DataTable<GapRow>
          columns={columns}
          data={filteredGaps}
          keyField="_key"
          loading={loading}
          emptyMessage={error ? '' : 'No gaps found.'}
        />
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
