'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

async function api(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/teacher-dashboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`API error ${res.status}: ${errorText}`);
  }
  return res.json();
}

/* ─── Styles ─── */
const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  backgroundColor: '#0B1120',
  color: '#E2E8F0',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: '24px 20px 80px',
  maxWidth: 900,
  margin: '0 auto',
};

const cardStyle: React.CSSProperties = {
  background: '#0F172A',
  borderRadius: 14,
  padding: '18px 20px',
  border: '1px solid #1E293B',
  marginBottom: 16,
};

const statCardStyle: React.CSSProperties = {
  backgroundColor: '#0F172A',
  borderRadius: 12,
  padding: '14px 16px',
  border: '1px solid #1E293B',
};

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  backgroundColor: '#0F172A',
  borderRadius: 12,
  padding: 4,
  marginBottom: 20,
  border: '1px solid #1E293B',
};

const spinnerStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  border: '3px solid #1E293B',
  borderTopColor: '#2563EB',
  borderRadius: '50%',
  margin: '0 auto 16px',
  animation: 'spin 0.8s linear infinite',
};

/* ─── Helpers ─── */
function getMasteryColor(level: string): string {
  switch (level) {
    case 'mastered': return '#16A34A';
    case 'proficient': return '#7C3AED';
    case 'familiar': return '#2563EB';
    case 'developing': return '#D97706';
    default: return '#64748B';
  }
}

function getMasteryLabel(level: string): string {
  switch (level) {
    case 'mastered': return 'Mastered';
    case 'proficient': return 'Proficient';
    case 'familiar': return 'Familiar';
    case 'developing': return 'Developing';
    default: return 'Not Started';
  }
}

function heatCellColor(value: number): string {
  if (value >= 8) return '#1D4ED8';
  if (value >= 5) return '#2563EB';
  if (value >= 3) return '#3B82F6';
  if (value >= 1) return '#60A5FA';
  return '#1E293B';
}

/* ─── Tab 1: Class Overview ─── */
function ClassOverviewTab({ data }: { data: any }) {
  const stats = data?.stats || {};
  const distribution = data?.mastery_distribution || {};
  const topPerformers: any[] = data?.top_performers || [];
  const needsAttention: any[] = data?.needs_attention || [];

  const statItems = [
    { label: 'Total Students', value: stats.total_students ?? 0, color: '#2563EB' },
    { label: 'Average Mastery', value: `${stats.avg_mastery ?? 0}%`, color: '#7C3AED' },
    { label: 'Average Accuracy', value: `${stats.avg_accuracy ?? 0}%`, color: '#059669' },
    { label: 'Active This Week', value: stats.active_this_week ?? 0, color: '#D97706' },
  ];

  const masteryLevels = [
    { key: 'mastered', label: 'Mastered', color: '#16A34A' },
    { key: 'proficient', label: 'Proficient', color: '#7C3AED' },
    { key: 'familiar', label: 'Familiar', color: '#2563EB' },
    { key: 'developing', label: 'Developing', color: '#D97706' },
    { key: 'not_started', label: 'Not Started', color: '#64748B' },
  ];

  return (
    <div>
      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        {statItems.map((s, i) => (
          <div key={i} style={statCardStyle}>
            <p style={{ color: '#64748B', fontSize: 11, margin: 0, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</p>
            <p style={{ color: s.color, fontSize: 26, fontWeight: 700, margin: '4px 0 0' }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Mastery Distribution */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#F1F5F9', margin: '0 0 14px' }}>Mastery Distribution</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {masteryLevels.map((lvl) => {
            const pct = distribution[lvl.key] ?? 0;
            return (
              <div key={lvl.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: '#CBD5E1', fontWeight: 500 }}>{lvl.label}</span>
                  <span style={{ fontSize: 13, color: '#94A3B8' }}>{pct}%</span>
                </div>
                <div style={{ height: 10, backgroundColor: '#1E293B', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, backgroundColor: lvl.color, borderRadius: 6, transition: 'width 0.5s ease' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top Performers & Needs Attention */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        <div style={cardStyle}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#F1F5F9', margin: '0 0 12px' }}>Top 5 Performers</h3>
          {topPerformers.length === 0 ? (
            <p style={{ color: '#475569', fontStyle: 'italic', fontSize: 13 }}>No data available yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {topPerformers.slice(0, 5).map((s: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', backgroundColor: '#1E293B', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: '#2563EB', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{i + 1}</span>
                    <span style={{ fontSize: 14, fontWeight: 500, color: '#E2E8F0' }}>{s.name || s.student_name}</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#2563EB' }}>{s.xp ?? s.total_xp ?? 0} XP</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#F1F5F9', margin: '0 0 12px' }}>Needs Attention</h3>
          {needsAttention.length === 0 ? (
            <p style={{ color: '#475569', fontStyle: 'italic', fontSize: 13 }}>All students are on track!</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {needsAttention.slice(0, 5).map((s: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', backgroundColor: '#1E293B', borderRadius: 8, borderLeft: '3px solid #EF4444' }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#E2E8F0' }}>{s.name || s.student_name}</span>
                  <span style={{ fontSize: 12, color: '#EF4444', fontWeight: 600 }}>{s.reason || `${s.mastery ?? 0}% mastery`}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Tab 2: Student Analysis ─── */
function StudentAnalysisTab({ students, teacherId }: { students: any[]; teacherId: string }) {
  const [selectedId, setSelectedId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const filtered = students.filter((s: any) =>
    (s.name || s.student_name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const loadProfile = useCallback(async (studentId: string) => {
    if (!studentId) return;
    setLoading(true);
    setError('');
    try {
      const data = await api('get_student_report', { teacher_id: teacherId, student_id: studentId });
      setProfile(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load student data');
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [teacherId]);

  useEffect(() => {
    if (selectedId) loadProfile(selectedId);
  }, [selectedId, loadProfile]);

  return (
    <div>
      {/* Search & Select */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#F1F5F9', margin: '0 0 12px' }}>Select Student</h3>
        <input
          type="text"
          placeholder="Search students..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ width: '100%', padding: '10px 12px', backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: 8, color: '#E2E8F0', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
        />
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          style={{ width: '100%', padding: '10px 12px', backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: 8, color: '#E2E8F0', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
        >
          <option value="">-- Choose a student --</option>
          {filtered.map((s: any) => (
            <option key={s.id || s.student_id} value={s.id || s.student_id}>
              {s.name || s.student_name}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: '#64748B' }}>
          <div style={spinnerStyle} />
          Loading student data...
        </div>
      )}

      {error && (
        <div style={{ ...cardStyle, borderColor: '#EF4444', color: '#FCA5A5', textAlign: 'center', fontSize: 14 }}>
          {error}
        </div>
      )}

      {!loading && !error && profile && (
        <div>
          {/* Performance Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Total XP', value: profile.xp ?? profile.total_xp ?? 0, color: '#2563EB' },
              { label: 'Streak', value: `${profile.streak ?? profile.current_streak ?? 0} days`, color: '#D97706' },
              { label: 'Accuracy', value: `${profile.accuracy ?? profile.avg_accuracy ?? 0}%`, color: '#059669' },
            ].map((s, i) => (
              <div key={i} style={statCardStyle}>
                <p style={{ color: '#64748B', fontSize: 11, margin: 0, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</p>
                <p style={{ color: s.color, fontSize: 24, fontWeight: 700, margin: '4px 0 0' }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Subject-wise Mastery */}
          <div style={cardStyle}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#F1F5F9', margin: '0 0 14px' }}>Subject-wise Mastery</h3>
            {(profile.subjects || profile.subject_mastery || []).length === 0 ? (
              <p style={{ color: '#475569', fontStyle: 'italic', fontSize: 13 }}>No subject data available.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(profile.subjects || profile.subject_mastery || []).map((subj: any, i: number) => {
                  const pct = subj.mastery ?? subj.percent ?? 0;
                  const level = subj.level || (pct >= 80 ? 'mastered' : pct >= 60 ? 'proficient' : pct >= 40 ? 'familiar' : 'developing');
                  return (
                    <div key={i}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 13, color: '#CBD5E1', fontWeight: 500 }}>{subj.subject || subj.name}</span>
                        <span style={{ fontSize: 12, color: getMasteryColor(level), fontWeight: 600 }}>{getMasteryLabel(level)} ({pct}%)</span>
                      </div>
                      <div style={{ height: 8, backgroundColor: '#1E293B', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, backgroundColor: getMasteryColor(level), borderRadius: 6, transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Strengths & Weaknesses */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 16 }}>
            <div style={cardStyle}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#16A34A', margin: '0 0 10px' }}>Strengths</h3>
              {(profile.strengths || []).length === 0 ? (
                <p style={{ color: '#475569', fontStyle: 'italic', fontSize: 13 }}>No strengths identified yet.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                  {(profile.strengths || []).map((s: any, i: number) => (
                    <li key={i} style={{ color: '#CBD5E1', fontSize: 13, marginBottom: 4 }}>
                      {typeof s === 'string' ? s : s.topic || s.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div style={cardStyle}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#EF4444', margin: '0 0 10px' }}>Weaknesses</h3>
              {(profile.weaknesses || []).length === 0 ? (
                <p style={{ color: '#475569', fontStyle: 'italic', fontSize: 13 }}>No weaknesses identified.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                  {(profile.weaknesses || []).map((w: any, i: number) => (
                    <li key={i} style={{ color: '#CBD5E1', fontSize: 13, marginBottom: 4 }}>
                      {typeof w === 'string' ? w : w.topic || w.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Recommendations */}
          {(profile.recommendations || profile.recommendation) && (
            <div style={{ ...cardStyle, borderLeft: '3px solid #2563EB' }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#2563EB', margin: '0 0 8px' }}>Recommendations</h3>
              {typeof (profile.recommendations || profile.recommendation) === 'string' ? (
                <p style={{ color: '#CBD5E1', fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  {profile.recommendations || profile.recommendation}
                </p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                  {(profile.recommendations || []).map((r: any, i: number) => (
                    <li key={i} style={{ color: '#CBD5E1', fontSize: 13, marginBottom: 4 }}>
                      {typeof r === 'string' ? r : r.text || r.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {!loading && !error && !profile && selectedId === '' && (
        <div style={{ textAlign: 'center', padding: 40, color: '#475569', fontStyle: 'italic' }}>
          Select a student above to view their detailed analysis.
        </div>
      )}
    </div>
  );
}

/* ─── Tab 3: Trends ─── */
function TrendsTab({ data }: { data: any }) {
  const weeklyProgress: any[] = data?.weekly_progress || [];
  const activityHeatmap: any[][] = data?.activity_heatmap || [];
  const mostImproved: any[] = data?.most_improved || [];

  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekLabels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];

  // Build a 7x4 grid: if API doesn't supply it, generate placeholder
  const heatmapGrid: number[][] = activityHeatmap.length > 0
    ? activityHeatmap
    : Array.from({ length: 4 }, () => Array.from({ length: 7 }, () => 0));

  return (
    <div>
      {/* Weekly Progress */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#F1F5F9', margin: '0 0 14px' }}>Weekly Progress</h3>
        {weeklyProgress.length === 0 ? (
          <p style={{ color: '#475569', fontStyle: 'italic', fontSize: 13 }}>No weekly progress data yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {weeklyProgress.slice(0, 4).map((w: any, i: number) => {
              const pct = w.progress ?? w.percent ?? w.completion ?? 0;
              return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: '#CBD5E1', fontWeight: 500 }}>{w.label || w.week || `Week ${i + 1}`}</span>
                    <span style={{ fontSize: 13, color: '#94A3B8' }}>{pct}%</span>
                  </div>
                  <div style={{ height: 12, backgroundColor: '#1E293B', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, backgroundColor: '#2563EB', borderRadius: 6, transition: 'width 0.5s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Activity Heatmap */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#F1F5F9', margin: '0 0 14px' }}>Activity Heatmap</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 4 }}>
            <thead>
              <tr>
                <th style={{ width: 60 }} />
                {dayLabels.map((d) => (
                  <th key={d} style={{ color: '#64748B', fontSize: 11, fontWeight: 500, textAlign: 'center', padding: '0 2px' }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmapGrid.map((row, wi) => (
                <tr key={wi}>
                  <td style={{ color: '#64748B', fontSize: 11, fontWeight: 500, paddingRight: 8 }}>{weekLabels[wi] || `Wk ${wi + 1}`}</td>
                  {row.map((val: number, di: number) => (
                    <td key={di}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 6,
                          backgroundColor: heatCellColor(val),
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          fontWeight: 600,
                          color: val > 0 ? '#fff' : '#334155',
                        }}
                        title={`${dayLabels[di]}, ${weekLabels[wi]}: ${val} activities`}
                      >
                        {val > 0 ? val : ''}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 11, color: '#64748B', alignItems: 'center' }}>
          <span>Less</span>
          {[0, 1, 3, 5, 8].map((v) => (
            <div key={v} style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: heatCellColor(v) }} />
          ))}
          <span>More</span>
        </div>
      </div>

      {/* Most Improved */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#F1F5F9', margin: '0 0 12px' }}>Most Improved Students</h3>
        {mostImproved.length === 0 ? (
          <p style={{ color: '#475569', fontStyle: 'italic', fontSize: 13 }}>No improvement data available yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mostImproved.map((s: any, i: number) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', backgroundColor: '#1E293B', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: '#059669', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{i + 1}</span>
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#E2E8F0' }}>{s.name || s.student_name}</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>+{s.improvement ?? s.delta ?? 0}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Main Page ─── */
export default function TeacherReportsPage() {
  const { teacher, isLoading: authLoading, isLoggedIn, activeRole } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<'overview' | 'student' | 'trends'>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [overviewData, setOverviewData] = useState<any>(null);
  const [studentsList, setStudentsList] = useState<any[]>([]);
  const [trendsData, setTrendsData] = useState<any>(null);

  const teacherId = teacher?.id || '';

  // Auth guard
  useEffect(() => {
    if (!authLoading && (!isLoggedIn || (activeRole !== 'teacher' && !teacher))) {
      router.replace('/');
    }
  }, [authLoading, isLoggedIn, activeRole, teacher, router]);

  // Load data
  const loadData = useCallback(async () => {
    if (!teacherId) return;
    setLoading(true);
    setError('');
    try {
      const [overview, students, trends] = await Promise.all([
        api('get_class_overview', { teacher_id: teacherId }),
        api('get_students_list', { teacher_id: teacherId }),
        api('get_trends', { teacher_id: teacherId }),
      ]);
      setOverviewData(overview);
      setStudentsList(students?.students || students || []);
      setTrendsData(trends);
    } catch (err: any) {
      setError(err.message || 'Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, [teacherId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Loading state
  if (authLoading || (loading && !error)) {
    return (
      <div style={pageStyle}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ textAlign: 'center', padding: 80, color: '#64748B' }}>
          <div style={spinnerStyle} />
          Loading reports...
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'overview' as const, label: 'Class Overview' },
    { id: 'student' as const, label: 'Student Analysis' },
    { id: 'trends' as const, label: 'Trends' },
  ];

  return (
    <div style={pageStyle}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #1E293B' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#F8FAFC', margin: 0 }}>Performance Reports</h1>
          <p style={{ fontSize: 14, color: '#64748B', margin: '4px 0 0' }}>
            Student performance analytics and insights
          </p>
        </div>
        <button
          onClick={loadData}
          style={{ padding: '8px 16px', background: 'transparent', color: '#2563EB', border: '1px solid #2563EB', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
        >
          Refresh
        </button>
      </header>

      {/* Error Banner */}
      {error && (
        <div style={{ ...cardStyle, borderColor: '#EF4444', color: '#FCA5A5', textAlign: 'center', fontSize: 14, marginBottom: 16 }}>
          {error}
          <button
            onClick={loadData}
            style={{ display: 'block', margin: '10px auto 0', padding: '6px 16px', backgroundColor: '#2563EB', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={tabBarStyle}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1,
              padding: '10px 8px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              backgroundColor: tab === t.id ? '#2563EB' : 'transparent',
              color: tab === t.id ? '#fff' : '#64748B',
              transition: 'all 0.2s ease',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'overview' && <ClassOverviewTab data={overviewData} />}
      {tab === 'student' && <StudentAnalysisTab students={studentsList} teacherId={teacherId} />}
      {tab === 'trends' && <TrendsTab data={trendsData} />}
    </div>
  );
}
