'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import StatCard from '../_components/StatCard';
import StatusBadge from '../_components/StatusBadge';

interface CoverageSummary {
  totalQuestions: number;
  activeQuestions: number;
  totalTopics: number;
  coveredTopics: number;
  uncoveredTopics: number;
  thinCoverage: number;
  coveragePercent: number;
}

interface GradeRow {
  grade: string;
  questions: number;
  active: number;
  topics: number;
  covered: number;
}

interface SubjectRow {
  subject: string;
  questions: number;
  active: number;
  topics: number;
  covered: number;
}

interface GapRow {
  grade: string;
  subject: string;
  chapterNumber: number;
  title: string;
  questionCount: number;
  status: string;
}

interface ContentCoverageData {
  summary: CoverageSummary;
  byGrade: GradeRow[];
  bySubject: SubjectRow[];
  gaps: GapRow[];
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  borderBottom: '2px solid #E5E7EB',
  color: '#6B7280',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 1,
  background: '#F9FAFB',
  position: 'sticky',
  top: 0,
  zIndex: 1,
};
const tdStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid #F3F4F6',
  color: '#111827',
  fontSize: 13,
};

function coverageColor(percent: number): string {
  if (percent >= 80) return '#16A34A';
  if (percent >= 50) return '#D97706';
  return '#DC2626';
}

function coverageVariant(percent: number): 'success' | 'warning' | 'danger' {
  if (percent >= 80) return 'success';
  if (percent >= 50) return 'warning';
  return 'danger';
}

function ContentCoverageDashboard() {
  const { apiFetch } = useAdmin();
  const [data, setData] = useState<ContentCoverageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gradeFilter, setGradeFilter] = useState('all');
  const [subjectFilter, setSubjectFilter] = useState('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/content-coverage');
      if (!res.ok) {
        setError(`Failed to load content coverage (${res.status})`);
        return;
      }
      const json = await res.json();
      setData(json);
    } catch {
      setError('Network error loading content coverage');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const grades = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.gaps.map(g => g.grade))).sort((a, b) => Number(a) - Number(b));
  }, [data]);

  const subjects = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.gaps.map(g => g.subject))).sort();
  }, [data]);

  const filteredGaps = useMemo(() => {
    if (!data) return [];
    let gaps = [...data.gaps];
    if (gradeFilter !== 'all') gaps = gaps.filter(g => g.grade === gradeFilter);
    if (subjectFilter !== 'all') gaps = gaps.filter(g => g.subject === subjectFilter);
    // Sort: 0 questions first, then ascending by count
    gaps.sort((a, b) => a.questionCount - b.questionCount);
    return gaps;
  }, [data, gradeFilter, subjectFilter]);

  // Loading skeleton
  if (loading && !data) {
    return (
      <div>
        <div style={{ marginBottom: 24 }}>
          <div style={{ width: 200, height: 24, background: '#F9FAFB', borderRadius: 4, marginBottom: 8 }} />
          <div style={{ width: 320, height: 14, background: '#F9FAFB', borderRadius: 4 }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="rounded-lg border border-surface-3 bg-surface-1 p-4">
              <div style={{ width: 60, height: 28, background: '#F9FAFB', borderRadius: 4, marginBottom: 8 }} />
              <div style={{ width: 100, height: 12, background: '#F9FAFB', borderRadius: 4 }} />
            </div>
          ))}
        </div>
        {[1, 2].map(i => (
          <div key={i} style={{ marginBottom: 24 }}>
            <div style={{ width: 180, height: 14, background: '#F9FAFB', borderRadius: 4, marginBottom: 12 }} />
            <div style={{ height: 120, background: '#F9FAFB', borderRadius: 8, border: '1px solid #E5E7EB' }} />
          </div>
        ))}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div>
        <h1 className="text-xl font-bold text-foreground" style={{ marginBottom: 4 }}>Content Coverage</h1>
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ borderLeft: '3px solid #DC2626', marginTop: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#DC2626', marginBottom: 4 }}>Error</div>
          <div style={{ fontSize: 13, color: '#6B7280' }}>{error}</div>
          <button onClick={fetchData} className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2" style={{ marginTop: 12 }}>Retry</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { summary } = data;
  const covPct = summary.coveragePercent;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 className="text-xl font-bold text-foreground" style={{ marginBottom: 4 }}>Content Coverage</h1>
          <p style={{ fontSize: 13, color: '#9CA3AF', margin: 0 }}>Question bank coverage across grades, subjects, and chapters</p>
        </div>
        <button onClick={fetchData} className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2">Refresh</button>
      </div>

      {/* Summary KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatCard
          label="Total Questions"
          value={summary.totalQuestions}
          accentColor="#2563EB"
          subtitle={`${summary.activeQuestions} active`}
        />
        <StatCard
          label="Coverage"
          value={`${covPct}%`}
          accentColor={coverageColor(covPct)}
          subtitle={`${summary.coveredTopics} of ${summary.totalTopics} topics`}
        />
        <StatCard
          label="Thin Coverage"
          value={summary.thinCoverage}
          accentColor={summary.thinCoverage > 0 ? '#D97706' : '#16A34A'}
          subtitle="Topics with < 5 questions"
        />
        <StatCard
          label="Uncovered Topics"
          value={summary.uncoveredTopics}
          accentColor={summary.uncoveredTopics > 0 ? '#DC2626' : '#16A34A'}
          subtitle="Topics with 0 questions"
        />
      </div>

      {/* Coverage health indicator */}
      <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>Overall Coverage Health</div>
          <div style={{ height: 8, background: '#F9FAFB', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(covPct, 100)}%`,
              height: '100%',
              background: coverageColor(covPct),
              borderRadius: 4,
              transition: 'width 0.3s',
            }} />
          </div>
        </div>
        <StatusBadge
          label={covPct >= 80 ? 'Healthy' : covPct >= 50 ? 'Needs Work' : 'Critical'}
          variant={coverageVariant(covPct)}
        />
      </div>

      {/* By Grade Table */}
      <div style={{ marginBottom: 24 }}>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 12 }}>Coverage by Grade</h2>
        <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Grade</th>
                <th style={thStyle}>Questions</th>
                <th style={thStyle}>Active</th>
                <th style={thStyle}>Topics</th>
                <th style={thStyle}>Covered</th>
                <th style={thStyle}>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {data.byGrade.map(row => {
                const pct = row.topics > 0 ? Math.round((row.covered / row.topics) * 100) : 0;
                return (
                  <tr key={row.grade}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>Grade {row.grade}</td>
                    <td style={tdStyle}>{row.questions.toLocaleString()}</td>
                    <td style={tdStyle}>{row.active.toLocaleString()}</td>
                    <td style={tdStyle}>{row.topics}</td>
                    <td style={tdStyle}>{row.covered}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 60, height: 6, background: '#F9FAFB', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: coverageColor(pct), borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: coverageColor(pct) }}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* By Subject Table */}
      <div style={{ marginBottom: 24 }}>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 12 }}>Coverage by Subject</h2>
        <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Subject</th>
                <th style={thStyle}>Questions</th>
                <th style={thStyle}>Active</th>
                <th style={thStyle}>Topics</th>
                <th style={thStyle}>Covered</th>
                <th style={thStyle}>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {data.bySubject.map(row => {
                const pct = row.topics > 0 ? Math.round((row.covered / row.topics) * 100) : 0;
                return (
                  <tr key={row.subject}>
                    <td style={{ ...tdStyle, fontWeight: 600, textTransform: 'capitalize' }}>{row.subject}</td>
                    <td style={tdStyle}>{row.questions.toLocaleString()}</td>
                    <td style={tdStyle}>{row.active.toLocaleString()}</td>
                    <td style={tdStyle}>{row.topics}</td>
                    <td style={tdStyle}>{row.covered}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 60, height: 6, background: '#F9FAFB', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: coverageColor(pct), borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: coverageColor(pct) }}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Gaps Section */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 0 }}>Content Gaps</h2>
            <StatusBadge
              label={`${filteredGaps.length} gap${filteredGaps.length !== 1 ? 's' : ''}`}
              variant={filteredGaps.length === 0 ? 'success' : filteredGaps.some(g => g.questionCount === 0) ? 'danger' : 'warning'}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={gradeFilter}
              onChange={e => setGradeFilter(e.target.value)}
              className="rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm cursor-pointer"
            >
              <option value="all">All Grades</option>
              {grades.map(g => (
                <option key={g} value={g}>Grade {g}</option>
              ))}
            </select>
            <select
              value={subjectFilter}
              onChange={e => setSubjectFilter(e.target.value)}
              className="rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm cursor-pointer"
            >
              <option value="all">All Subjects</option>
              {subjects.map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>

        {filteredGaps.length === 0 ? (
          <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 14, color: '#9CA3AF' }}>
              {data.gaps.length === 0
                ? 'No content gaps found. All topics have adequate coverage.'
                : 'No gaps match the current filters.'}
            </div>
          </div>
        ) : (
          <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ maxHeight: 480, overflowY: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Grade</th>
                    <th style={thStyle}>Subject</th>
                    <th style={thStyle}>Chapter</th>
                    <th style={thStyle}>Title</th>
                    <th style={thStyle}>Questions</th>
                    <th style={thStyle}>Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGaps.map((gap, idx) => (
                    <tr key={`${gap.grade}-${gap.subject}-${gap.chapterNumber}-${idx}`}>
                      <td style={tdStyle}>{gap.grade}</td>
                      <td style={{ ...tdStyle, textTransform: 'capitalize' }}>{gap.subject}</td>
                      <td style={tdStyle}>Ch. {gap.chapterNumber}</td>
                      <td style={{ ...tdStyle, maxWidth: 280 }}>{gap.title}</td>
                      <td style={{ ...tdStyle, fontWeight: 700, color: gap.questionCount === 0 ? '#DC2626' : '#D97706' }}>
                        {gap.questionCount}
                      </td>
                      <td style={tdStyle}>
                        {gap.questionCount === 0 ? (
                          <StatusBadge label="No Content" variant="danger" />
                        ) : (
                          <StatusBadge label="Low Content" variant="warning" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ContentCoveragePage() {
  return <AdminShell><ContentCoverageDashboard /></AdminShell>;
}
