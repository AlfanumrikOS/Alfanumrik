'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useAdmin } from '../../_components/AdminShell';
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
const cardStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 8,
  border: '1px solid #E5E7EB',
  background: '#FFFFFF',
};
const filterBtnStyle: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: 6,
  border: '1px solid #E5E7EB',
  background: '#FFFFFF',
  color: '#6B7280',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
};
const filterActiveStyle: React.CSSProperties = {
  background: '#111827',
  color: '#FFFFFF',
  borderColor: '#111827',
};

// ─── Types ────────────────────────────────────────────────────

interface RetentionPeriod {
  period: number;
  active: number;
  percent: number;
}

interface CohortRow {
  cohortStart: string;
  cohortEnd: string;
  totalStudents: number;
  retention: RetentionPeriod[];
}

interface CohortRetentionData {
  interval: string;
  cohorts: CohortRow[];
}

type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';

interface BloomByGradeData {
  grades: Record<string, Record<BloomLevel, number>>;
}

// ─── Helpers ──────────────────────────────────────────────────

const BLOOM_LEVELS: BloomLevel[] = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
const BLOOM_LABELS: Record<BloomLevel, string> = {
  remember: 'Remember',
  understand: 'Understand',
  apply: 'Apply',
  analyze: 'Analyze',
  evaluate: 'Evaluate',
  create: 'Create',
};

const GRADES = ['6', '7', '8', '9', '10', '11', '12'];

function retentionCellColor(percent: number): string {
  if (percent >= 60) return 'rgba(34, 197, 94, 0.18)';
  if (percent >= 40) return 'rgba(245, 158, 11, 0.18)';
  if (percent > 0) return 'rgba(239, 68, 68, 0.15)';
  return '#F9FAFB';
}

function retentionTextColor(percent: number): string {
  if (percent >= 60) return '#16A34A';
  if (percent >= 40) return '#D97706';
  if (percent > 0) return '#DC2626';
  return '#9CA3AF';
}

function bloomCellBg(percent: number): string {
  if (percent >= 30) return 'rgba(37, 99, 235, 0.20)';
  if (percent >= 20) return 'rgba(37, 99, 235, 0.14)';
  if (percent >= 10) return 'rgba(37, 99, 235, 0.08)';
  if (percent > 0) return 'rgba(37, 99, 235, 0.04)';
  return '#F9FAFB';
}

function formatCohortLabel(start: string, end: string, interval: string): string {
  const s = new Date(start);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (interval === 'monthly') {
    return `${monthNames[s.getUTCMonth()]} ${s.getUTCFullYear()}`;
  }
  const day = s.getUTCDate();
  return `${monthNames[s.getUTCMonth()]} ${day}`;
}

// ─── Component ────────────────────────────────────────────────

export default function StrategicReportsTab() {
  const { apiFetch } = useAdmin();
  const [interval, setInterval] = useState<'weekly' | 'monthly'>('weekly');
  const [bloomGradeFilter, setBloomGradeFilter] = useState<string>('all');

  // SWR fetchers using apiFetch
  const cohortFetcher = async (url: string) => {
    const res = await apiFetch(url);
    if (!res.ok) throw new Error(`Cohort API error: ${res.status}`);
    return res.json();
  };

  const bloomFetcher = async (url: string) => {
    const res = await apiFetch(url);
    if (!res.ok) throw new Error(`Bloom API error: ${res.status}`);
    return res.json();
  };

  const { data: cohortData, error: cohortError, isLoading: cohortLoading } = useSWR<CohortRetentionData>(
    `/api/super-admin/strategic-reports/cohort-retention?interval=${interval}&periods=12`,
    cohortFetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );

  const bloomUrl = bloomGradeFilter === 'all'
    ? '/api/super-admin/strategic-reports/bloom-by-grade'
    : `/api/super-admin/strategic-reports/bloom-by-grade?grade=${bloomGradeFilter}`;

  const { data: bloomData, error: bloomError, isLoading: bloomLoading } = useSWR<BloomByGradeData>(
    bloomUrl,
    bloomFetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );

  // Find max period across all cohorts for column headers
  const maxPeriods = cohortData?.cohorts.reduce((max, c) => Math.max(max, c.retention.length), 0) ?? 0;
  const periodPrefix = interval === 'weekly' ? 'W' : 'M';

  return (
    <div>
      {/* ═══ COHORT RETENTION ═══ */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 0 }}>Cohort Retention</h2>
            <p style={{ fontSize: 12, color: '#9CA3AF', margin: '4px 0 0 0' }}>
              Students grouped by signup {interval === 'weekly' ? 'week' : 'month'}, with quiz activity in subsequent periods
            </p>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => setInterval('weekly')}
              style={{
                ...filterBtnStyle,
                ...(interval === 'weekly' ? filterActiveStyle : {}),
              }}
            >
              Weekly
            </button>
            <button
              onClick={() => setInterval('monthly')}
              style={{
                ...filterBtnStyle,
                ...(interval === 'monthly' ? filterActiveStyle : {}),
              }}
            >
              Monthly
            </button>
          </div>
        </div>

        {cohortLoading && (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: '#9CA3AF' }}>
            Loading cohort retention data...
          </div>
        )}

        {cohortError && (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: '#DC2626' }}>
            Failed to load cohort retention data. {cohortError.message}
          </div>
        )}

        {!cohortLoading && !cohortError && cohortData && cohortData.cohorts.length === 0 && (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: '#9CA3AF' }}>
            No cohort data available. Students need to sign up and take quizzes first.
          </div>
        )}

        {!cohortLoading && !cohortError && cohortData && cohortData.cohorts.length > 0 && (
          <div style={{ ...cardStyle, overflowX: 'auto', padding: 0 }}>
            <table style={{ ...tableStyle, width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, minWidth: 100, position: 'sticky', left: 0, zIndex: 2, background: '#F9FAFB' }}>
                    Cohort
                  </th>
                  <th style={{ ...thStyle, minWidth: 60, textAlign: 'center' }}>
                    Size
                  </th>
                  {Array.from({ length: maxPeriods }, (_, i) => (
                    <th key={i} style={{ ...thStyle, minWidth: 52, textAlign: 'center' }}>
                      {periodPrefix}+{i}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohortData.cohorts.map(cohort => (
                  <tr key={cohort.cohortStart}>
                    <td style={{
                      ...tdStyle,
                      fontWeight: 600,
                      fontSize: 12,
                      position: 'sticky',
                      left: 0,
                      background: '#FFFFFF',
                      zIndex: 1,
                      whiteSpace: 'nowrap',
                    }}>
                      {formatCohortLabel(cohort.cohortStart, cohort.cohortEnd, interval)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700, fontSize: 13 }}>
                      {cohort.totalStudents}
                    </td>
                    {Array.from({ length: maxPeriods }, (_, i) => {
                      const ret = cohort.retention.find(r => r.period === i);
                      if (!ret) {
                        return (
                          <td key={i} style={{ ...tdStyle, textAlign: 'center', background: '#F9FAFB', color: '#9CA3AF', fontSize: 11 }}>
                            --
                          </td>
                        );
                      }
                      return (
                        <td
                          key={i}
                          title={`${ret.active} of ${cohort.totalStudents} active (${ret.percent}%)`}
                          style={{
                            ...tdStyle,
                            textAlign: 'center',
                            background: retentionCellColor(ret.percent),
                            color: retentionTextColor(ret.percent),
                            fontWeight: 700,
                            fontSize: 12,
                          }}
                        >
                          {ret.percent}%
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: '10px 14px', fontSize: 11, color: '#9CA3AF', borderTop: '1px solid #F3F4F6' }}>
              Green: 60%+ retention | Yellow: 40-59% | Red: &lt;40%
            </div>
          </div>
        )}
      </div>

      {/* ═══ BLOOM'S DISTRIBUTION BY GRADE ═══ */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 0 }}>Bloom&apos;s Taxonomy Distribution by Grade</h2>
            <p style={{ fontSize: 12, color: '#9CA3AF', margin: '4px 0 0 0' }}>
              How quiz responses distribute across cognitive levels per grade
            </p>
          </div>
          <select
            value={bloomGradeFilter}
            onChange={e => setBloomGradeFilter(e.target.value)}
            className="rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm cursor-pointer"
          >
            <option value="all">All Grades</option>
            {GRADES.map(g => (
              <option key={g} value={g}>Grade {g}</option>
            ))}
          </select>
        </div>

        {bloomLoading && (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: '#9CA3AF' }}>
            Loading Bloom&apos;s distribution data...
          </div>
        )}

        {bloomError && (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: '#DC2626' }}>
            Failed to load Bloom&apos;s distribution data. {bloomError.message}
          </div>
        )}

        {!bloomLoading && !bloomError && bloomData && Object.keys(bloomData.grades).length === 0 && (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: '#9CA3AF' }}>
            No Bloom&apos;s taxonomy data available. Students need to complete quizzes with tagged questions.
          </div>
        )}

        {!bloomLoading && !bloomError && bloomData && Object.keys(bloomData.grades).length > 0 && (
          <div style={{ ...cardStyle, overflowX: 'auto', padding: 0 }}>
            <table style={{ ...tableStyle, width: '100%' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Grade</th>
                  {BLOOM_LEVELS.map(level => (
                    <th key={level} style={{ ...thStyle, textAlign: 'center' }}>
                      {BLOOM_LABELS[level]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GRADES
                  .filter(g => bloomData.grades[g])
                  .map(grade => {
                    const dist = bloomData.grades[grade];
                    return (
                      <tr key={grade}>
                        <td style={{ ...tdStyle, fontWeight: 700 }}>Grade {grade}</td>
                        {BLOOM_LEVELS.map(level => {
                          const pct = dist[level] ?? 0;
                          return (
                            <td
                              key={level}
                              style={{
                                ...tdStyle,
                                textAlign: 'center',
                                background: bloomCellBg(pct),
                                fontWeight: pct > 0 ? 700 : 400,
                                color: pct > 0 ? '#2563EB' : '#9CA3AF',
                                fontSize: 13,
                              }}
                            >
                              {pct}%
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <div style={{ padding: '10px 14px', fontSize: 11, color: '#9CA3AF', borderTop: '1px solid #F3F4F6' }}>
              Percentages show proportion of responses at each Bloom&apos;s level within the grade. Darker shade = higher concentration.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
