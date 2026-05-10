'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import StatCard from '../_components/StatCard';
import StatusBadge from '../_components/StatusBadge';
import { VALID_GRADES } from '@/lib/identity';

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
const secondaryBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: '1px solid #E5E7EB',
  background: '#FFFFFF',
  color: '#111827',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

const StrategicReportsTab = dynamic(() => import('./_components/StrategicReportsTab'), {
  loading: () => <div style={{ color: '#9CA3AF', padding: 40, textAlign: 'center' }}>Loading strategic reports...</div>,
});

interface AnalyticsData {
  engagement: { date: string; signups: number; quizzes: number; chats: number }[];
  popular_subjects: { subject: string; count: number }[];
  content_stats: { chapters: number; topics: number; questions: number };
  top_students: { id: string; name: string; email: string; grade: string; xp_total: number; streak_days: number }[];
  retention: { period: string; count: number }[];
  content_coverage?: { grade: string; subject: string; count: number }[];
}

interface SystemStats {
  totals: Record<string, number>;
  last_24h: Record<string, number>;
  last_7d?: Record<string, number>;
}

interface ObsData {
  content: { topics: number; questions: number };
  activity_24h: { quizzes: number; chats: number; admin_actions: number };
}

type TabId = 'engagement' | 'strategic';

function LearningContent() {
  const { apiFetch } = useAdmin();
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [obsData, setObsData] = useState<ObsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('engagement');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [aRes, sRes, oRes] = await Promise.all([
      apiFetch('/api/super-admin/analytics'),
      apiFetch('/api/super-admin/stats'),
      apiFetch('/api/super-admin/observability'),
    ]);
    if (aRes.ok) setAnalytics(await aRes.json());
    if (sRes.ok) setStats(await sRes.json());
    if (oRes.ok) setObsData(await oRes.json());
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading && !analytics) {
    return <div style={{ color: '#9CA3AF', padding: 40, textAlign: 'center' }}>Loading learning intelligence...</div>;
  }

  const totalQuizzes = stats?.totals.quiz_sessions ?? 0;
  const totalChats = stats?.totals.chat_sessions ?? 0;
  const quizzes24h = stats?.last_24h.quizzes ?? 0;
  const chats24h = obsData?.activity_24h.chats ?? 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 className="text-xl font-bold text-foreground" style={{ marginBottom: 4 }}>Learning Intelligence</h1>
          <p style={{ fontSize: 13, color: '#9CA3AF', margin: 0 }}>Quiz, Foxy AI, content coverage, and XP oversight</p>
        </div>
        <button onClick={fetchAll} className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2">Refresh</button>
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #E5E7EB', marginBottom: 24 }}>
        {([
          { id: 'engagement' as TabId, label: 'Engagement & Content' },
          { id: 'strategic' as TabId, label: 'Strategic Reports' },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 700 : 500,
              color: activeTab === tab.id ? '#111827' : '#9CA3AF',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #111827' : '2px solid transparent',
              marginBottom: -2,
              cursor: 'pointer',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Strategic Reports Tab */}
      {activeTab === 'strategic' && <StrategicReportsTab />}

      {/* Engagement & Content Tab */}
      {activeTab === 'engagement' && <>

      {/* KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatCard label="Total Quizzes" value={totalQuizzes} accentColor="#D97706" icon="⚡" />
        <StatCard label="Quizzes (24h)" value={quizzes24h} accentColor="#2563EB" />
        <StatCard label="Total Foxy Chats" value={totalChats} accentColor="#EC4899" icon="🦊" />
        <StatCard label="Chats (24h)" value={chats24h} accentColor="#16A34A" />
        {analytics && <>
          <StatCard label="Chapters" value={analytics.content_stats.chapters} accentColor="#9CA3AF" />
          <StatCard label="Topics" value={analytics.content_stats.topics} accentColor="#9CA3AF" />
          <StatCard label="Questions" value={analytics.content_stats.questions} accentColor="#9CA3AF" />
        </>}
      </div>

      {/* Popular Subjects */}
      {analytics && analytics.popular_subjects.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 12 }}>Subject Popularity (by quiz count)</h2>
          <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
            {analytics.popular_subjects.slice(0, 12).map(s => {
              const maxCount = analytics.popular_subjects[0]?.count || 1;
              return (
                <div key={s.subject} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: '#6B7280', width: 120, textTransform: 'capitalize', flexShrink: 0 }}>{s.subject}</span>
                  <div style={{ flex: 1, height: 20, background: '#F9FAFB', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(s.count / maxCount) * 100}%`, height: '100%', background: '#2563EB', borderRadius: 4, opacity: 0.7 }} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#111827', width: 50, textAlign: 'right' }}>{s.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* Engagement Trend */}
        {analytics && analytics.engagement.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 12 }}>30-Day Quiz & Chat Trend</h2>
            <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
              <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 100 }}>
                {analytics.engagement.map(day => {
                  const maxTotal = Math.max(...analytics.engagement.map(d => d.quizzes + d.chats), 1);
                  return (
                    <div key={day.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center' }}
                      title={`${day.date}: ${day.quizzes} quizzes, ${day.chats} chats`}>
                      <div style={{ width: '100%', background: '#D97706', borderRadius: '2px 2px 0 0', height: `${(day.quizzes / maxTotal) * 100}%`, minHeight: day.quizzes > 0 ? 1 : 0, opacity: 0.8 }} />
                      <div style={{ width: '100%', background: '#EC4899', borderRadius: '0 0 2px 2px', height: `${(day.chats / maxTotal) * 100}%`, minHeight: day.chats > 0 ? 1 : 0, opacity: 0.6 }} />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <span style={{ fontSize: 10, color: '#9CA3AF' }}>{analytics.engagement[0]?.date}</span>
                <span style={{ fontSize: 10, color: '#9CA3AF' }}>{analytics.engagement[analytics.engagement.length - 1]?.date}</span>
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                <span style={{ fontSize: 11, color: '#9CA3AF' }}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#D97706', marginRight: 4 }} />Quizzes</span>
                <span style={{ fontSize: 11, color: '#9CA3AF' }}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#EC4899', marginRight: 4 }} />Chats</span>
              </div>
            </div>
          </div>
        )}

        {/* Retention */}
        {analytics && analytics.retention.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 12 }}>Student Retention</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              {analytics.retention.map(r => (
                <div key={r.period} className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: '#6B7280' }}>Active {r.period}</span>
                  <span style={{ fontSize: 22, fontWeight: 800, color: '#111827' }}>{r.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Top Students by XP */}
      {analytics && analytics.top_students.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 12 }}>XP Leaderboard</h2>
          <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Rank</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Grade</th>
                  <th style={thStyle}>XP</th>
                  <th style={thStyle}>Streak</th>
                  <th style={thStyle}>Assessment</th>
                </tr>
              </thead>
              <tbody>
                {analytics.top_students.map((s, i) => {
                  const xpAnomaly = s.xp_total > 10000;
                  return (
                    <tr key={s.id}>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 700, color: i < 3 ? '#D97706' : '#6B7280' }}>
                          {i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `#${i + 1}`}
                        </span>
                      </td>
                      <td style={tdStyle}><strong>{s.name}</strong></td>
                      <td style={tdStyle}>{s.grade || '—'}</td>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 700, color: xpAnomaly ? '#DC2626' : '#111827' }}>{s.xp_total.toLocaleString()}</span>
                        {xpAnomaly && <StatusBadge label="High XP" variant="warning" />}
                      </td>
                      <td style={tdStyle}><span style={{ color: '#6B7280' }}>{s.streak_days}d</span></td>
                      <td style={tdStyle}>
                        {xpAnomaly ? (
                          <StatusBadge label="Review" variant="warning" />
                        ) : s.streak_days > 30 ? (
                          <StatusBadge label="Consistent" variant="success" />
                        ) : (
                          <StatusBadge label="Normal" variant="neutral" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ LEARNING OUTCOMES ═══ */}
      {analytics && stats && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 0 }}>Learning Outcomes &amp; Health</h2>
            <button
              onClick={() => {
                // Export top students as CSV
                if (!analytics?.top_students?.length) return;
                const rows = analytics.top_students.map((s, i) => `${i + 1},${s.name},${s.grade},${s.xp_total},${s.streak_days}`);
                const csv = 'Rank,Name,Grade,XP,Streak\n' + rows.join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'alfanumrik-top-students.csv'; a.click();
                URL.revokeObjectURL(url);
              }}
              style={{ ...secondaryBtnStyle, fontSize: 11 }}
            >
              📥 Export CSV
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {(() => {
              const totalStudents = stats.totals?.students || 0;
              const totalQuizzesAll = stats.totals?.quiz_sessions || 0;
              const avgQuizzesPerStudent = totalStudents > 0 ? (totalQuizzesAll / totalStudents).toFixed(1) : '0';
              const topStudents = analytics.top_students || [];
              const avgXpTop = topStudents.length > 0 ? Math.round(topStudents.reduce((s, t) => s + t.xp_total, 0) / topStudents.length) : 0;
              const avgStreakTop = topStudents.length > 0 ? Math.round(topStudents.reduce((s, t) => s + t.streak_days, 0) / topStudents.length) : 0;
              const highXpCount = topStudents.filter(s => s.xp_total > 10000).length;
              const consistentCount = topStudents.filter(s => s.streak_days > 7).length;

              return [
                { label: 'Avg Quizzes/Student', value: avgQuizzesPerStudent, color: Number(avgQuizzesPerStudent) > 5 ? '#16A34A' : '#D97706', detail: `${totalQuizzesAll} total across ${totalStudents} students` },
                { label: 'Avg XP (Top 10)', value: avgXpTop.toLocaleString(), color: '#2563EB', detail: `${highXpCount} flagged for high XP review` },
                { label: 'Avg Streak (Top 10)', value: `${avgStreakTop}d`, color: avgStreakTop > 7 ? '#16A34A' : '#D97706', detail: `${consistentCount} students with 7+ day streaks` },
                { label: 'Content Coverage', value: `${analytics.content_stats.questions}`, color: analytics.content_stats.questions > 500 ? '#16A34A' : '#D97706', detail: `across ${analytics.content_stats.topics} topics, ${analytics.content_stats.chapters} chapters` },
              ].map(item => (
                <div key={item.label} style={{ ...cardStyle, borderLeft: `3px solid ${item.color}`, padding: '14px 16px' }}>
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>{item.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: item.color }}>{item.value}</div>
                  <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>{item.detail}</div>
                </div>
              ));
            })()}
          </div>

          {/* Subject popularity with quiz count — actionable bar chart */}
          {analytics.popular_subjects.length > 0 && (
            <div style={{ marginTop: 16, ...cardStyle }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Subject Activity Distribution</div>
              <div style={{ display: 'grid', gap: 4 }}>
                {analytics.popular_subjects.slice(0, 8).map(s => {
                  const maxC = analytics.popular_subjects[0]?.count || 1;
                  const pct = Math.round((s.count / maxC) * 100);
                  const isLow = pct < 20;
                  return (
                    <div key={s.subject} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: '#6B7280', width: 100, textTransform: 'capitalize', flexShrink: 0 }}>{s.subject}</span>
                      <div style={{ flex: 1, height: 18, background: '#F9FAFB', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: isLow ? '#D97706' : '#2563EB', borderRadius: 4, opacity: 0.7 }} />
                        <span style={{ position: 'absolute', right: 6, top: 1, fontSize: 10, fontWeight: 600, color: '#111827' }}>{s.count}</span>
                      </div>
                      {isLow && <StatusBadge label="Low" variant="warning" />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Content Coverage Heatmap */}
      {analytics?.content_coverage && analytics.content_coverage.length > 0 && (() => {
        const grades = VALID_GRADES;
        const subjects = Array.from(new Set(analytics.content_coverage.map(c => c.subject))).sort();
        const lookup = new Map<string, number>();
        for (const c of analytics.content_coverage) {
          lookup.set(`${c.grade}::${c.subject}`, c.count);
        }
        const getCount = (grade: string, subject: string) => lookup.get(`${grade}::${subject}`) ?? 0;
        const getCellBg = (count: number) => {
          if (count >= 50) return 'rgba(34,197,94,0.15)';
          if (count >= 20) return 'rgba(245,158,11,0.15)';
          if (count > 0) return 'rgba(239,68,68,0.15)';
          return '#f1f5f9';
        };
        const gapCount = grades.reduce((acc, g) => acc + subjects.filter(s => getCount(g, s) < 20).length, 0);

        return (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 0 }}>Content Coverage by Grade &times; Subject</h2>
              {gapCount > 5 && <StatusBadge label={`${gapCount} Gaps`} variant="warning" />}
              {gapCount > 0 && gapCount <= 5 && <StatusBadge label={`${gapCount} Gaps`} variant="info" />}
              {gapCount === 0 && <StatusBadge label="Full Coverage" variant="success" />}
            </div>
            <div style={{ ...cardStyle, overflowX: 'auto' }}>
              <table style={{ ...tableStyle, width: '100%' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Grade</th>
                    {subjects.map(s => (
                      <th key={s} style={{ ...thStyle, textTransform: 'capitalize' as const }}>{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grades.map(g => (
                    <tr key={g}>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{g}</td>
                      {subjects.map(s => {
                        const count = getCount(g, s);
                        return (
                          <td key={s} style={{ ...tdStyle, background: getCellBg(count), textAlign: 'center' }}>
                            <span style={{ fontWeight: 700, fontSize: 13 }}>{count}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 10, fontSize: 11, color: '#9CA3AF' }}>
                {'\u{1F7E2}'} {'\u2265'}50 questions {'  '}{'\u{1F7E1}'} 20-49 {'  '}{'\u{1F534}'} 1-19 {'  '}{'\u2B1C'} No questions
              </div>
            </div>
          </div>
        );
      })()}

      {/* Marking Authenticity Path Mix — Wave 4 placeholder.
          Backend has not built a dedicated PostHog HogQL endpoint for the
          `quiz_graded` group-by `marking_authenticity_path` aggregation in this
          parallel wave. Frontend chose option (a) per the runbook: render a
          placeholder linking to PostHog and to the existing oracle-health page
          so ops still has a single discovery surface, and document option (b)
          (`/api/super-admin/marking-path-mix/route.ts`) as a follow-up. */}
      <div style={{ marginBottom: 24 }}>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 12 }}>Marking Authenticity Path Mix</h2>
        <div style={{ ...cardStyle, borderLeft: '3px solid #D97706' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
            Coming soon
          </div>
          <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5 }}>
            <p style={{ margin: 0, marginBottom: 6 }}>
              <strong>Goal:</strong> 100% of <code style={{ background: '#F9FAFB', padding: '1px 5px', borderRadius: 3 }}>quiz_graded</code> events on path <code style={{ background: '#F9FAFB', padding: '1px 5px', borderRadius: 3 }}>oracle_v2</code>. Current mix indicates which deprecation cutovers are still pending (<code style={{ background: '#F9FAFB', padding: '1px 5px', borderRadius: 3 }}>client_fallback</code>, <code style={{ background: '#F9FAFB', padding: '1px 5px', borderRadius: 3 }}>foxy_freetext</code>, <code style={{ background: '#F9FAFB', padding: '1px 5px', borderRadius: 3 }}>oracle_v1_legacy</code>).
            </p>
            <p style={{ margin: 0, color: '#9CA3AF', fontSize: 11 }}>
              Awaiting backend endpoint <code>GET /api/super-admin/marking-path-mix</code> (PostHog HogQL proxy, server-cached). Until then, query directly in PostHog. See <a href="/super-admin/oracle-health" style={{ color: '#2563EB' }}>Oracle Health</a> for adjacent signals.
            </p>
          </div>
        </div>
      </div>

      {/* Content Coverage Signals */}
      {analytics && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 12 }}>Content Health Signals</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <div style={{ ...cardStyle, borderLeft: `3px solid ${analytics.content_stats.questions > 0 ? '#16A34A' : '#DC2626'}` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Question Bank</div>
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                {analytics.content_stats.questions} questions across {analytics.content_stats.topics} topics
              </div>
              <div style={{ marginTop: 8 }}>
                <StatusBadge label={analytics.content_stats.questions > 100 ? 'Healthy' : analytics.content_stats.questions > 0 ? 'Growing' : 'Empty'} variant={analytics.content_stats.questions > 100 ? 'success' : analytics.content_stats.questions > 0 ? 'warning' : 'danger'} />
              </div>
            </div>
            <div style={{ ...cardStyle, borderLeft: `3px solid ${totalChats > 0 ? '#16A34A' : '#D97706'}` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Foxy AI (RAG/Chat)</div>
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                {totalChats} total chat sessions, {chats24h} in last 24h
              </div>
              <div style={{ marginTop: 8 }}>
                <StatusBadge label={totalChats > 50 ? 'Active' : totalChats > 0 ? 'Low Usage' : 'No Data'} variant={totalChats > 50 ? 'success' : totalChats > 0 ? 'warning' : 'neutral'} />
              </div>
            </div>
            <div style={{ ...cardStyle, borderLeft: '3px solid #2563EB' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Quiz Engine</div>
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                {totalQuizzes} total sessions, {quizzes24h} in last 24h
              </div>
              <div style={{ marginTop: 8 }}>
                <StatusBadge label={totalQuizzes > 50 ? 'Active' : totalQuizzes > 0 ? 'Low Usage' : 'No Data'} variant={totalQuizzes > 50 ? 'success' : totalQuizzes > 0 ? 'warning' : 'neutral'} />
              </div>
            </div>
          </div>
        </div>
      )}

      </>}
    </div>
  );
}

export default function LearningPage() {
  return <AdminShell><LearningContent /></AdminShell>;
}
