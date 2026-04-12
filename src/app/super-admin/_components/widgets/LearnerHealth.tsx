'use client';

import { colors, S } from '../admin-styles';
import { StalenessTag } from '../StalenessTag';
import type { SystemStats, AnalyticsData, ObsData } from './control-room-types';

interface LearnerHealthProps {
  analytics: AnalyticsData;
  stats: SystemStats;
  obsData: ObsData;
  lastUpdated: Date | null;
}

export default function LearnerHealth({ analytics, stats, obsData, lastUpdated }: LearnerHealthProps) {
  const totalStudents = stats.totals?.students || 0;
  const activeToday = obsData.users.active_24h || 0;
  const quizzesToday = obsData.activity_24h.quizzes || 0;
  const chatsToday = obsData.activity_24h.chats || 0;
  const engagementRate = totalStudents > 0 ? Math.round((activeToday / totalStudents) * 100) : 0;
  const avgQuizzesPerActive = activeToday > 0 ? (quizzesToday / activeToday).toFixed(1) : '0';
  const topStudents = analytics.top_students || [];
  const avgXp = topStudents.length > 0 ? Math.round(topStudents.reduce((s, t) => s + t.xp_total, 0) / topStudents.length) : 0;

  const items = [
    {
      label: 'Daily engagement',
      value: `${engagementRate}%`,
      detail: `${activeToday}/${totalStudents} students active today`,
      color: engagementRate >= 30 ? colors.success : engagementRate >= 10 ? colors.warning : colors.danger,
    },
    {
      label: 'Quiz activity',
      value: `${quizzesToday}`,
      detail: `${avgQuizzesPerActive} quizzes per active student`,
      color: quizzesToday > 0 ? colors.success : colors.warning,
    },
    {
      label: 'AI tutor usage',
      value: `${chatsToday}`,
      detail: 'Foxy sessions today',
      color: chatsToday > 0 ? colors.accent : colors.text3,
    },
    {
      label: 'Top learner XP',
      value: avgXp.toLocaleString(),
      detail: `avg of top ${topStudents.length} students`,
      color: colors.accent,
    },
  ];

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1.5 }}>Learner Health</div>
        <StalenessTag lastUpdated={lastUpdated} thresholdMinutes={5} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
        {items.map(item => (
          <div key={item.label} style={{ ...S.card, padding: '12px 14px', borderLeft: `3px solid ${item.color}` }}>
            <div style={{ fontSize: 11, color: colors.text3, marginBottom: 2 }}>{item.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: item.color }}>{item.value}</div>
            <div style={{ fontSize: 10, color: colors.text3, marginTop: 2 }}>{item.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
