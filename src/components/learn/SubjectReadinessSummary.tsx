'use client';

/**
 * SubjectReadinessSummary — Phase 3 of "Exam-Ready 360°".
 *
 * Compact banner at the top of the /learn chapter list showing how many
 * chapters in this subject the student is ready / almost / building /
 * not_yet on. Tells the student "you've conquered 3 of 12 chapters" at a
 * glance instead of forcing them to scan badges.
 *
 * Hides itself when the API hasn't loaded yet — no skeleton flicker.
 */

import { memo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useSubjectReadiness } from '@/lib/useSubjectReadiness';

export interface SubjectReadinessSummaryProps {
  subjectCode: string;
  subjectColor?: string;
}

interface BucketStyle {
  fg: string;
  bg: string;
  icon: string;
  labelEn: string;
  labelHi: string;
}

const BUCKETS: Record<'ready' | 'almost' | 'building' | 'not_yet', BucketStyle> = {
  ready:    { fg: '#027A48', bg: '#ECFDF3', icon: '✅', labelEn: 'Ready',    labelHi: 'तैयार' },
  almost:   { fg: '#175CD3', bg: '#EFF8FF', icon: '⚡', labelEn: 'Almost',   labelHi: 'लगभग' },
  building: { fg: '#B54708', bg: '#FFFAEB', icon: '🛠', labelEn: 'Building', labelHi: 'बन रहा' },
  not_yet:  { fg: '#B42318', bg: '#FEF3F2', icon: '🌱', labelEn: 'Not Yet',  labelHi: 'अभी नहीं' },
};

function SubjectReadinessSummaryInner({
  subjectCode,
  subjectColor,
}: SubjectReadinessSummaryProps) {
  const { isHi } = useAuth();
  const { readiness } = useSubjectReadiness(subjectCode);

  if (!readiness) return null;

  const total =
    readiness.summary.ready +
    readiness.summary.almost +
    readiness.summary.building +
    readiness.summary.not_yet;

  if (total === 0) return null;

  const readyPct = Math.round((readiness.summary.ready / total) * 100);

  return (
    <div
      data-testid="subject-readiness-summary"
      className="rounded-2xl p-4 mb-4"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? '📊 परीक्षा तैयारी' : '📊 Exam Readiness'}
        </h3>
        <span className="text-[11px] font-semibold tabular-nums" style={{ color: subjectColor ?? 'var(--text-3)' }}>
          {readiness.summary.ready}/{total} {isHi ? 'अध्याय तैयार' : 'chapters ready'}
        </span>
      </div>

      {/* Stacked progress bar — proportions of each bucket */}
      <div
        className="w-full rounded-full overflow-hidden flex"
        style={{ background: 'var(--surface-2)', height: 8 }}
        aria-label={isHi ? 'अध्याय तैयारी विवरण' : 'Chapter readiness breakdown'}
      >
        {readiness.summary.ready > 0 && (
          <div
            style={{
              width: `${(readiness.summary.ready / total) * 100}%`,
              background: BUCKETS.ready.fg,
            }}
            title={`${readiness.summary.ready} ${BUCKETS.ready.labelEn}`}
          />
        )}
        {readiness.summary.almost > 0 && (
          <div
            style={{
              width: `${(readiness.summary.almost / total) * 100}%`,
              background: BUCKETS.almost.fg,
            }}
            title={`${readiness.summary.almost} ${BUCKETS.almost.labelEn}`}
          />
        )}
        {readiness.summary.building > 0 && (
          <div
            style={{
              width: `${(readiness.summary.building / total) * 100}%`,
              background: BUCKETS.building.fg,
            }}
            title={`${readiness.summary.building} ${BUCKETS.building.labelEn}`}
          />
        )}
        {readiness.summary.not_yet > 0 && (
          <div
            style={{
              width: `${(readiness.summary.not_yet / total) * 100}%`,
              background: BUCKETS.not_yet.fg,
            }}
            title={`${readiness.summary.not_yet} ${BUCKETS.not_yet.labelEn}`}
          />
        )}
      </div>

      {/* Bucket counts row — only shows non-zero buckets to keep it compact */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {(['ready', 'almost', 'building', 'not_yet'] as const).map((bucket) => {
          const count = readiness.summary[bucket];
          if (count === 0) return null;
          const style = BUCKETS[bucket];
          return (
            <span
              key={bucket}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{
                background: style.bg,
                color: style.fg,
                border: `1px solid ${style.fg}25`,
              }}
            >
              <span aria-hidden="true">{style.icon}</span>
              {count} {isHi ? style.labelHi : style.labelEn}
            </span>
          );
        })}
      </div>

      {readyPct === 100 && (
        <p className="text-[11px] text-[var(--text-3)] mt-2 font-medium">
          {isHi
            ? '🎉 शानदार! इस विषय के सभी अध्याय परीक्षा-तैयार हैं।'
            : '🎉 Brilliant! Every chapter in this subject is exam-ready.'}
        </p>
      )}
    </div>
  );
}

export const SubjectReadinessSummary = memo(SubjectReadinessSummaryInner);
export default SubjectReadinessSummary;
