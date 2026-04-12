'use client';

import StatusBadge from '../StatusBadge';
import { colors, S } from '../admin-styles';
import { StalenessTag } from '../StalenessTag';
import type { SystemStats, AnalyticsData, ObsData } from './control-room-types';

interface PlatformHealthProps {
  stats: SystemStats;
  obsData: ObsData;
  analytics: AnalyticsData | null;
  lastUpdated: Date | null;
}

export default function PlatformHealth({ stats, obsData, analytics, lastUpdated }: PlatformHealthProps) {
  const totalStudents = stats.totals?.students || 0;
  const totalParents = stats.totals?.parents || 0;
  const totalTeachers = stats.totals?.teachers || 0;
  const linkageRate = totalStudents > 0 ? Math.round((totalParents / totalStudents) * 100) : 0;
  const linkColor = linkageRate >= 60 ? colors.success : linkageRate >= 30 ? colors.warning : colors.danger;
  const ratio = totalTeachers > 0 ? Math.round(totalStudents / totalTeachers) : 0;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <StalenessTag lastUpdated={lastUpdated} thresholdMinutes={5} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Parent-Student Linkage */}
        <div style={{ ...S.card, borderLeft: `3px solid ${colors.accent}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: colors.text1, marginBottom: 8 }}>{'\uD83D\uDC68\u200D\uD83D\uDC67'} Parent-Student Linkage</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: linkColor }}>{linkageRate}%</span>
              <span style={{ fontSize: 11, color: colors.text3 }}>linked</span>
            </div>
            <div style={{ fontSize: 11, color: colors.text3, marginTop: 4 }}>
              {totalParents} parents {'\u00B7'} {totalStudents} students
            </div>
            <div style={{ marginTop: 6, height: 6, background: colors.surface, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${linkageRate}%`, height: '100%', background: linkColor, borderRadius: 3 }} />
            </div>
          </div>
        </div>

        {/* Teacher-Class Coverage */}
        <div style={{ ...S.card, borderLeft: `3px solid ${colors.warning}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: colors.text1, marginBottom: 8 }}>{'\uD83D\uDC69\u200D\uD83C\uDFEB'} Teacher Coverage</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: colors.text1 }}>{totalTeachers}</span>
              <span style={{ fontSize: 11, color: colors.text3 }}>teachers</span>
            </div>
            <div style={{ fontSize: 11, color: colors.text3, marginTop: 4 }}>
              {ratio > 0 ? `1:${ratio} teacher-student ratio` : 'No teachers registered'}
            </div>
            <div style={{ marginTop: 6 }}>
              <StatusBadge label={ratio > 0 && ratio <= 40 ? 'Healthy' : 'Stretched'} variant={ratio > 0 && ratio <= 40 ? 'success' : 'warning'} />
            </div>
          </div>
        </div>

        {/* Content Coverage */}
        {analytics && (
          <div style={{ ...S.card, borderLeft: `3px solid ${colors.success}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: colors.text1 }}>{'\uD83D\uDCDA'} Content Coverage</div>
              <StatusBadge
                label={analytics.content_stats.questions > 1000 ? 'Strong' : analytics.content_stats.questions > 500 ? 'Growing' : 'Needs Content'}
                variant={analytics.content_stats.questions > 1000 ? 'success' : analytics.content_stats.questions > 500 ? 'warning' : 'danger'}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: colors.text1 }}>{analytics.content_stats.chapters}</div>
                <div style={{ fontSize: 10, color: colors.text3 }}>Chapters</div>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: colors.text1 }}>{analytics.content_stats.topics}</div>
                <div style={{ fontSize: 10, color: colors.text3 }}>Topics</div>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: colors.text1 }}>{analytics.content_stats.questions}</div>
                <div style={{ fontSize: 10, color: colors.text3 }}>Questions</div>
              </div>
            </div>
          </div>
        )}

        {/* Simulation Health */}
        <div style={{ ...S.card, borderLeft: `3px solid #8B5CF6` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.text1 }}>{'\uD83D\uDD2C'} Simulation Lab</div>
            <StatusBadge label="Active" variant="success" />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 28, fontWeight: 800, color: '#8B5CF6' }}>19</span>
            <span style={{ fontSize: 11, color: colors.text3 }}>built-in simulations</span>
          </div>
          <div style={{ fontSize: 11, color: colors.text3, marginTop: 4 }}>
            Physics: 8 {'\u00B7'} Chemistry: 4 {'\u00B7'} Math: 7
          </div>
        </div>
      </div>
    </div>
  );
}
