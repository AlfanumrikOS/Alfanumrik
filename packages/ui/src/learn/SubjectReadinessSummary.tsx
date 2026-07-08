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
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useSubjectReadiness } from '@alfanumrik/lib/useSubjectReadiness';
import { Card, Badge } from '@alfanumrik/ui/ui/primitives';
import type { Tone } from '@alfanumrik/ui/ui/primitives';

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
  /** Canonical Badge tone for the recomposed count chip (Phase 5a). */
  tone: Tone;
}

// Status palette is mapped to cosmic-aware semantic tokens (no hardcoded brand/
// status hex). Foreground = the semantic token; background = a soft color-mix
// tint of the same token onto surface-1 so it adapts across light + cosmic.
const BUCKETS: Record<'ready' | 'almost' | 'building' | 'not_yet', BucketStyle> = {
  ready:    { fg: 'var(--green)', bg: 'color-mix(in srgb, var(--green) 12%, var(--surface-1))', icon: '✅', labelEn: 'Ready',    labelHi: 'तैयार',    tone: 'success' },
  almost:   { fg: 'var(--teal)',  bg: 'color-mix(in srgb, var(--teal) 12%, var(--surface-1))',  icon: '⚡', labelEn: 'Almost',   labelHi: 'लगभग',    tone: 'info' },
  building: { fg: 'var(--gold)',  bg: 'color-mix(in srgb, var(--gold) 14%, var(--surface-1))',  icon: '🛠', labelEn: 'Building', labelHi: 'बन रहा',   tone: 'warning' },
  not_yet:  { fg: 'var(--red)',   bg: 'color-mix(in srgb, var(--red) 10%, var(--surface-1))',   icon: '🌱', labelEn: 'Not Yet',  labelHi: 'अभी नहीं', tone: 'neutral' },
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
    <Card
      variant="flat"
      data-testid="subject-readiness-summary"
      className="mb-4 p-4"
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-fluid-sm font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? '📊 परीक्षा तैयारी' : '📊 Exam Readiness'}
        </h3>
        <span className="text-fluid-xs font-semibold tabular-nums" style={{ color: subjectColor ?? 'var(--text-3)' }}>
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

      {/* Bucket counts row — canonical Badge chips; only non-zero buckets. */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {(['ready', 'almost', 'building', 'not_yet'] as const).map((bucket) => {
          const count = readiness.summary[bucket];
          if (count === 0) return null;
          const style = BUCKETS[bucket];
          return (
            <Badge
              key={bucket}
              tone={style.tone}
              variant="soft"
              icon={<span aria-hidden="true">{style.icon}</span>}
            >
              {count} {isHi ? style.labelHi : style.labelEn}
            </Badge>
          );
        })}
      </div>

      {readyPct === 100 && (
        <p className="mt-2 text-fluid-xs font-medium text-muted-foreground">
          {isHi
            ? '🎉 शानदार! इस विषय के सभी अध्याय परीक्षा-तैयार हैं।'
            : '🎉 Brilliant! Every chapter in this subject is exam-ready.'}
        </p>
      )}
    </Card>
  );
}

export const SubjectReadinessSummary = memo(SubjectReadinessSummaryInner);
export default SubjectReadinessSummary;
