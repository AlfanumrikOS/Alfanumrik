'use client';

/**
 * MasterySnapshot — three glanceable mastery buckets for the Alfa OS dashboard
 * (ff_student_os_v1): Mastered ✓ / Learning / Needs Revision.
 *
 * Pure presentation over the existing `useMasteryOverview` (get_mastery_overview
 * RPC) — it re-presents the engine's per-topic mastery_level + due_for_review
 * decisions as bucket counts. It does NOT define what "mastery" means (that's
 * assessment's get_mastery_overview). Each bucket shows a MasteryRing plus a
 * NUMERIC count, so meaning is never carried by colour alone (WCAG 1.4.1).
 */

import { useMasteryOverview } from '@/lib/swr';
import { MasteryRing, Skeleton } from '@/components/ui';
import {
  countBuckets,
  type MasteryOverviewRow,
  type BucketCounts,
} from '@/lib/dashboard/mastery-buckets';

interface MasterySnapshotProps {
  isHi: boolean;
  studentId: string | undefined;
}

interface BucketDef {
  key: keyof BucketCounts;
  glyph: string;
  labelEn: string;
  labelHi: string;
  color: string;
  /** Ring fill heuristic: share of total this bucket represents. */
}

const BUCKETS: BucketDef[] = [
  { key: 'mastered', glyph: '✓', labelEn: 'Mastered', labelHi: 'महारत', color: 'var(--green, #16A34A)' },
  { key: 'learning', glyph: '◑', labelEn: 'Learning', labelHi: 'सीख रहे', color: 'var(--orange, #E8581C)' },
  { key: 'needsRevision', glyph: '↻', labelEn: 'Needs revision', labelHi: 'दोहराओ', color: '#8B5CF6' },
];

export default function MasterySnapshot({ isHi, studentId }: MasterySnapshotProps) {
  const { data, isLoading, error } = useMasteryOverview(studentId);

  const rows: MasteryOverviewRow[] = Array.isArray(data) ? (data as MasteryOverviewRow[]) : [];
  const counts = countBuckets(rows);
  const total = counts.mastered + counts.learning + counts.needsRevision;

  // Loading state
  if (isLoading && !data) {
    return (
      <section
        className="rounded-3xl p-5"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        aria-busy="true"
        aria-label={isHi ? 'महारत लोड हो रही है' : 'Loading mastery'}
      >
        <Skeleton width="40%" height={14} className="mb-4" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={96} rounded="rounded-2xl" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-3xl p-5"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      aria-label={isHi ? 'महारत का सारांश' : 'Mastery snapshot'}
    >
      <h2
        className="text-sm font-bold uppercase tracking-wider mb-4"
        style={{ color: 'var(--text-3)' }}
      >
        {isHi ? 'महारत का सारांश' : 'Mastery snapshot'}
      </h2>

      {error && !isLoading ? (
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-3)' }}
          role="status"
        >
          {isHi
            ? 'अभी लोड नहीं हो पाया — रीफ़्रेश करके फिर देखो।'
            : "Couldn't load right now — pull to refresh."}
        </div>
      ) : total === 0 ? (
        <div
          className="rounded-2xl p-4 text-center"
          style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}
        >
          <div className="text-2xl mb-2" aria-hidden="true">🎯</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-1)' }}>
            {isHi
              ? 'अभी तक कोई क्विज़ नहीं दी'
              : 'No quizzes taken yet'}
          </p>
          <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
            {isHi
              ? 'पहली क्विज़ दो और अपनी महारत यहाँ देखो।'
              : 'Take your first quiz to see your mastery here.'}
          </p>
          <a
            href="/quiz"
            className="inline-block rounded-xl px-4 py-2 text-sm font-semibold bg-orange-500 text-white hover:bg-orange-600 transition-colors"
          >
            {isHi ? 'पहली क्विज़ शुरू करें →' : 'Start your first quiz →'}
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {BUCKETS.map((b) => {
            const value = counts[b.key];
            const ringPct = total > 0 ? Math.round((value / total) * 100) : 0;
            const label = isHi ? b.labelHi : b.labelEn;
            return (
              <div
                key={b.key}
                className="rounded-2xl p-3 flex flex-col items-center text-center"
                style={{ background: 'var(--surface-2)', minHeight: 96 }}
                role="group"
                aria-label={`${label}: ${value}`}
              >
                <MasteryRing value={ringPct} size={48} strokeWidth={4} color={b.color}>
                  <span
                    className="text-base font-extrabold"
                    style={{ color: b.color, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}
                  >
                    {value}
                  </span>
                </MasteryRing>
                <span
                  className="mt-2 text-xs font-semibold leading-tight"
                  style={{ color: 'var(--text-2)' }}
                >
                  <span aria-hidden="true" className="mr-0.5">{b.glyph}</span>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}