'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import StatCard from '../_components/StatCard';
import StatusBadge from '../_components/StatusBadge';
import { colors, S } from '../_components/admin-styles';

interface AnalyticsData {
  engagement: { date: string; signups: number; quizzes: number; chats: number }[];
  popular_subjects: { subject: string; count: number }[];
  content_stats: { chapters: number; topics: number; questions: number };
  top_students: { id: string; name: string; email: string; grade: string; xp_total: number; streak_days: number }[];
  retention: { period: string; count: number }[];
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

function LearningContent() {
  const { apiFetch } = useAdmin();
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [obsData, setObsData] = useState<ObsData | null>(null);
  const [loading, setLoading] = useState(true);

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
    return <div style={{ color: colors.text3, padding: 40, textAlign: 'center' }}>Loading learning intelligence...</div>;
  }

  const totalQuizzes = stats?.totals.quiz_sessions ?? 0;
  const totalChats = stats?.totals.chat_sessions ?? 0;
  const quizzes24h = stats?.last_24h.quizzes ?? 0;
  const chats24h = obsData?.activity_24h.chats ?? 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={S.h1}>Learning Intelligence</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>Quiz, Foxy AI, content coverage, and XP oversight</p>
        </div>
        <button onClick={fetchAll} style={S.secondaryBtn}>Refresh</button>
      </div>

      {/* KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatCard label="Total Quizzes" value={totalQuizzes} accentColor={colors.warning} icon="⚡" />
        <StatCard label="Quizzes (24h)" value={quizzes24h} accentColor={colors.accent} />
        <StatCard label="Total Foxy Chats" value={totalChats} accentColor="#EC4899" icon="🦊" />
        <StatCard label="Chats (24h)" value={chats24h} accentColor={colors.success} />
        {analytics && <>
          <StatCard label="Chapters" value={analytics.content_stats.chapters} accentColor={colors.text3} />
          <StatCard label="Topics" value={analytics.content_stats.topics} accentColor={colors.text3} />
          <StatCard label="Questions" value={analytics.content_stats.questions} accentColor={colors.text3} />
        </>}
      </div>

      {/* Popular Subjects */}
      {analytics && analytics.popular_subjects.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={S.h2}>Subject Popularity (by quiz count)</h2>
          <div style={S.card}>
            {analytics.popular_subjects.slice(0, 12).map(s => {
              const maxCount = analytics.popular_subjects[0]?.count || 1;
              return (
                <div key={s.subject} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: colors.text2, width: 120, textTransform: 'capitalize', flexShrink: 0 }}>{s.subject}</span>
                  <div style={{ flex: 1, height: 20, background: colors.surface, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(s.count / maxCount) * 100}%`, height: '100%', background: colors.accent, borderRadius: 4, opacity: 0.7 }} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: colors.text1, width: 50, textAlign: 'right' }}>{s.count}</span>
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
            <h2 style={S.h2}>30-Day Quiz & Chat Trend</h2>
            <div style={S.card}>
              <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 100 }}>
                {analytics.engagement.map(day => {
                  const total = day.quizzes + day.chats;
                  const maxTotal = Math.max(...analytics.engagement.map(d => d.quizzes + d.chats), 1);
                  return (
                    <div key={day.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center' }}
                      title={`${day.date}: ${day.quizzes} quizzes, ${day.chats} chats`}>
                      <div style={{ width: '100%', background: colors.warning, borderRadius: '2px 2px 0 0', height: `${(day.quizzes / maxTotal) * 100}%`, minHeight: day.quizzes > 0 ? 1 : 0, opacity: 0.8 }} />
                      <div style={{ width: '100%', background: '#EC4899', borderRadius: '0 0 2px 2px', height: `${(day.chats / maxTotal) * 100}%`, minHeight: day.chats > 0 ? 1 : 0, opacity: 0.6 }} />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <span style={{ fontSize: 10, color: colors.text3 }}>{analytics.engagement[0]?.date}</span>
                <span style={{ fontSize: 10, color: colors.text3 }}>{analytics.engagement[analytics.engagement.length - 1]?.date}</span>
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                <span style={{ fontSize: 11, color: colors.text3 }}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: colors.warning, marginRight: 4 }} />Quizzes</span>
                <span style={{ fontSize: 11, color: colors.text3 }}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#EC4899', marginRight: 4 }} />Chats</span>
              </div>
            </div>
          </div>
        )}

        {/* Retention */}
        {analytics && analytics.retention.length > 0 && (
          <div>
            <h2 style={S.h2}>Student Retention</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              {analytics.retention.map(r => (
                <div key={r.period} style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: colors.text2 }}>Active {r.period}</span>
                  <span style={{ fontSize: 22, fontWeight: 800, color: colors.text1 }}>{r.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Top Students by XP */}
      {analytics && analytics.top_students.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={S.h2}>XP Leaderboard</h2>
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Rank</th>
                  <th style={S.th}>Name</th>
                  <th style={S.th}>Grade</th>
                  <th style={S.th}>XP</th>
                  <th style={S.th}>Streak</th>
                  <th style={S.th}>Assessment</th>
                </tr>
              </thead>
              <tbody>
                {analytics.top_students.map((s, i) => {
                  const xpAnomaly = s.xp_total > 10000;
                  return (
                    <tr key={s.id}>
                      <td style={S.td}>
                        <span style={{ fontWeight: 700, color: i < 3 ? colors.warning : colors.text2 }}>
                          {i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `#${i + 1}`}
                        </span>
                      </td>
                      <td style={S.td}><strong>{s.name}</strong></td>
                      <td style={S.td}>{s.grade || '—'}</td>
                      <td style={S.td}>
                        <span style={{ fontWeight: 700, color: xpAnomaly ? colors.danger : colors.text1 }}>{s.xp_total.toLocaleString()}</span>
                        {xpAnomaly && <StatusBadge label="High XP" variant="warning" />}
                      </td>
                      <td style={S.td}><span style={{ color: colors.text2 }}>{s.streak_days}d</span></td>
                      <td style={S.td}>
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

      {/* Content Coverage Signals */}
      {analytics && (
        <div>
          <h2 style={S.h2}>Content Health Signals</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <div style={{ ...S.card, borderLeft: `3px solid ${analytics.content_stats.questions > 0 ? colors.success : colors.danger}` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.text1 }}>Question Bank</div>
              <div style={{ fontSize: 12, color: colors.text2, marginTop: 4 }}>
                {analytics.content_stats.questions} questions across {analytics.content_stats.topics} topics
              </div>
              <div style={{ marginTop: 8 }}>
                <StatusBadge label={analytics.content_stats.questions > 100 ? 'Healthy' : analytics.content_stats.questions > 0 ? 'Growing' : 'Empty'} variant={analytics.content_stats.questions > 100 ? 'success' : analytics.content_stats.questions > 0 ? 'warning' : 'danger'} />
              </div>
            </div>
            <div style={{ ...S.card, borderLeft: `3px solid ${totalChats > 0 ? colors.success : colors.warning}` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.text1 }}>Foxy AI (RAG/Chat)</div>
              <div style={{ fontSize: 12, color: colors.text2, marginTop: 4 }}>
                {totalChats} total chat sessions, {chats24h} in last 24h
              </div>
              <div style={{ marginTop: 8 }}>
                <StatusBadge label={totalChats > 50 ? 'Active' : totalChats > 0 ? 'Low Usage' : 'No Data'} variant={totalChats > 50 ? 'success' : totalChats > 0 ? 'warning' : 'neutral'} />
              </div>
            </div>
            <div style={{ ...S.card, borderLeft: `3px solid ${colors.accent}` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.text1 }}>Quiz Engine</div>
              <div style={{ fontSize: 12, color: colors.text2, marginTop: 4 }}>
                {totalQuizzes} total sessions, {quizzes24h} in last 24h
              </div>
              <div style={{ marginTop: 8 }}>
                <StatusBadge label={totalQuizzes > 50 ? 'Active' : totalQuizzes > 0 ? 'Low Usage' : 'No Data'} variant={totalQuizzes > 50 ? 'success' : totalQuizzes > 0 ? 'warning' : 'neutral'} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LearningPage() {
  return <AdminShell><LearningContent /></AdminShell>;
}
