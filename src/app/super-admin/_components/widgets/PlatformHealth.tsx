'use client';

import { StatusBadge, StalenessTag } from '@/components/admin-ui';
import type { SystemStats, AnalyticsData, ObsData } from './control-room-types';

interface PlatformHealthProps {
  stats: SystemStats;
  obsData: ObsData;
  analytics: AnalyticsData | null;
  lastUpdated: Date | null;
}

export default function PlatformHealth({ stats, obsData, analytics, lastUpdated }: PlatformHealthProps) {
  void obsData; // accepted for API parity; not currently displayed
  const totalStudents = stats.totals?.students || 0;
  const totalParents = stats.totals?.parents || 0;
  const totalTeachers = stats.totals?.teachers || 0;
  const linkageRate = totalStudents > 0 ? Math.round((totalParents / totalStudents) * 100) : 0;
  const linkColor = linkageRate >= 60 ? '#16A34A' : linkageRate >= 30 ? '#D97706' : '#DC2626';
  const ratio = totalTeachers > 0 ? Math.round(totalStudents / totalTeachers) : 0;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <StalenessTag lastUpdated={lastUpdated} thresholdMinutes={5} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Parent-Student Linkage */}
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ borderLeft: '3px solid #2563EB' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>{'👨‍👧'} Parent-Student Linkage</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: linkColor }}>{linkageRate}%</span>
              <span style={{ fontSize: 11, color: '#9CA3AF' }}>linked</span>
            </div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
              {totalParents} parents · {totalStudents} students
            </div>
            <div style={{ marginTop: 6, height: 6, background: '#F9FAFB', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${linkageRate}%`, height: '100%', background: linkColor, borderRadius: 3 }} />
            </div>
          </div>
        </div>

        {/* Teacher-Class Coverage */}
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ borderLeft: '3px solid #D97706' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>{'👩‍🏫'} Teacher Coverage</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-1)' }}>{totalTeachers}</span>
              <span style={{ fontSize: 11, color: '#9CA3AF' }}>teachers</span>
            </div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
              {ratio > 0 ? `1:${ratio} teacher-student ratio` : 'No teachers registered'}
            </div>
            <div style={{ marginTop: 6 }}>
              <StatusBadge label={ratio > 0 && ratio <= 40 ? 'Healthy' : 'Stretched'} variant={ratio > 0 && ratio <= 40 ? 'success' : 'warning'} />
            </div>
          </div>
        </div>

        {/* Content Coverage */}
        {analytics && (
          <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ borderLeft: '3px solid #16A34A' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>{'📚'} Content Coverage</div>
              <StatusBadge
                label={analytics.content_stats.questions > 1000 ? 'Strong' : analytics.content_stats.questions > 500 ? 'Growing' : 'Needs Content'}
                variant={analytics.content_stats.questions > 1000 ? 'success' : analytics.content_stats.questions > 500 ? 'warning' : 'danger'}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)' }}>{analytics.content_stats.chapters}</div>
                <div style={{ fontSize: 10, color: '#9CA3AF' }}>Chapters</div>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)' }}>{analytics.content_stats.topics}</div>
                <div style={{ fontSize: 10, color: '#9CA3AF' }}>Topics</div>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)' }}>{analytics.content_stats.questions}</div>
                <div style={{ fontSize: 10, color: '#9CA3AF' }}>Questions</div>
              </div>
            </div>
          </div>
        )}

        {/* Simulation Health — live from stats route (Phase F.6 fix 2026-05-17) */}
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ borderLeft: '3px solid #8B5CF6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>{'🔬'} Simulation Lab</div>
            <StatusBadge
              label={(stats.totals?.simulations || 0) > 0 ? 'Active' : 'Empty'}
              variant={(stats.totals?.simulations || 0) > 0 ? 'success' : 'warning'}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 28, fontWeight: 800, color: '#8B5CF6' }}>{stats.totals?.simulations ?? 0}</span>
            <span style={{ fontSize: 11, color: '#9CA3AF' }}>built-in simulations</span>
          </div>
          <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
            Interactive: {stats.totals?.interactive_simulations ?? 0} · Exam: {stats.totals?.exam_simulations ?? 0}
          </div>
        </div>
      </div>
    </div>
  );
}
