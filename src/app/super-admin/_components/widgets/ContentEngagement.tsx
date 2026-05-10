'use client';

import { StatCard, StalenessTag } from '@/components/admin-ui';
import type { AnalyticsData } from './control-room-types';

interface ContentEngagementProps {
  analytics: AnalyticsData;
  lastUpdated: Date | null;
}

export default function ContentEngagement({ analytics, lastUpdated }: ContentEngagementProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Content</div>
          <StalenessTag lastUpdated={lastUpdated} thresholdMinutes={5} />
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <StatCard label="Chapters" value={analytics.content_stats.chapters} accentColor="#2563EB" />
          <StatCard label="Topics" value={analytics.content_stats.topics} accentColor="#D97706" />
          <StatCard label="Questions" value={analytics.content_stats.questions} accentColor="#16A34A" />
        </div>
      </div>
      {analytics.engagement.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">30-Day Engagement</div>
            <StalenessTag lastUpdated={lastUpdated} thresholdMinutes={5} />
          </div>
          <div className="rounded-lg border border-surface-3 bg-surface-1 p-3">
            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 80 }}>
              {analytics.engagement.map(day => {
                const total = day.signups + day.quizzes + day.chats;
                const maxTotal = Math.max(...analytics.engagement.map(d => d.signups + d.quizzes + d.chats), 1);
                return (
                  <div key={day.date} style={{ flex: 1 }} title={`${day.date}: ${total}`}>
                    <div style={{ width: '100%', background: '#2563EB', borderRadius: 1, height: `${(total / maxTotal) * 100}%`, minHeight: total > 0 ? 2 : 0, opacity: 0.6 }} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ fontSize: 10, color: '#9CA3AF' }}>{analytics.engagement[0]?.date}</span>
              <span style={{ fontSize: 10, color: '#9CA3AF' }}>{analytics.engagement[analytics.engagement.length - 1]?.date}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
