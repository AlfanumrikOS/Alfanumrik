'use client';

import StatCard from '../StatCard';
import { colors, S } from '../admin-styles';
import { StalenessTag } from '../StalenessTag';
import type { SystemStats, AnalyticsData, FeatureFlag } from './control-room-types';

interface LiveStatusProps {
  stats: SystemStats | null;
  flags: FeatureFlag[];
  analytics: AnalyticsData | null;
  toggleFlag: (flag: FeatureFlag) => void;
  lastUpdated: Date | null;
}

export default function LiveStatus({ stats, flags, analytics, toggleFlag, lastUpdated }: LiveStatusProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1.5 }}>Live Status</div>
        <StalenessTag lastUpdated={lastUpdated} thresholdMinutes={2} />
      </div>

      {/* Platform Metrics */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <StatCard label="Students" value={stats.totals.students} accentColor={colors.accent} />
          <StatCard label="Teachers" value={stats.totals.teachers} accentColor={colors.success} />
          <StatCard label="Parents" value={stats.totals.parents} accentColor="#8B5CF6" />
        </div>
      )}

      {/* Activity Panel */}
      {stats && (
        <div style={{ ...S.card, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Activity</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
            <div style={{ borderRight: `1px solid ${colors.border}`, paddingRight: 12 }}>
              <div style={{ fontSize: 10, color: colors.text3, fontWeight: 600, marginBottom: 4 }}>LAST 24H</div>
              {Object.entries(stats.last_24h).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                  <span style={{ color: colors.text2, textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
                  <span style={{ fontWeight: 700, color: colors.text1 }}>{v >= 0 ? v : '\u2014'}</span>
                </div>
              ))}
            </div>
            {stats.last_7d && (
              <div style={{ paddingLeft: 12 }}>
                <div style={{ fontSize: 10, color: colors.text3, fontWeight: 600, marginBottom: 4 }}>LAST 7D</div>
                {Object.entries(stats.last_7d).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                    <span style={{ color: colors.text2, textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
                    <span style={{ fontWeight: 700, color: colors.text1 }}>{v >= 0 ? v : '\u2014'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Inline metrics */}
          <div style={{ display: 'flex', gap: 12, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${colors.borderLight}` }}>
            <StatCard label="Quiz Sessions" value={stats.totals.quiz_sessions} accentColor={colors.warning} />
            <StatCard label="Chat Sessions" value={stats.totals.chat_sessions} accentColor="#EC4899" />
          </div>
        </div>
      )}

      {/* Feature Flags Quick Toggle */}
      <div style={{ ...S.card, padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1 }}>Feature Flags</div>
          <a href="/super-admin/flags" style={{ fontSize: 11, color: colors.accent, textDecoration: 'none' }}>Manage</a>
        </div>
        {flags.slice(0, 8).map(flag => (
          <div key={flag.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${colors.borderLight}` }}>
            <code style={{ fontSize: 11, color: colors.text1 }}>{flag.name}</code>
            <button onClick={() => toggleFlag(flag)} style={{
              padding: '2px 12px', borderRadius: 12, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 700,
              background: flag.enabled ? colors.success : colors.border,
              color: flag.enabled ? '#fff' : colors.text3,
            }}>{flag.enabled ? 'ON' : 'OFF'}</button>
          </div>
        ))}
        {flags.length === 0 && <div style={{ fontSize: 11, color: colors.text3 }}>No flags configured</div>}
      </div>

      {/* Subscription Breakdown */}
      {analytics && analytics.revenue.length > 0 && (
        <div style={{ ...S.card, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Subscription Plans</div>
          {analytics.revenue.map(r => {
            const maxCount = Math.max(...analytics.revenue.map(x => x.count), 1);
            return (
              <div key={r.plan} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: colors.text2, width: 100, textTransform: 'capitalize', flexShrink: 0 }}>{r.plan.replace(/_/g, ' ')}</span>
                <div style={{ flex: 1, height: 14, background: colors.surface, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${(r.count / maxCount) * 100}%`, height: '100%', background: colors.accent, borderRadius: 3, opacity: 0.6, minWidth: r.count > 0 ? 3 : 0 }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: colors.text1, width: 30, textAlign: 'right' }}>{r.count}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
