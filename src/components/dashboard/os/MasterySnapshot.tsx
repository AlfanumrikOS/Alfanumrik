'use client';

/**
 * MasterySnapshot — three glanceable mastery buckets for the Alfa OS dashboard
 * (ff_student_os_v1): Mastered / Learning / Needs Revision.
 *
 * Redesigned 2026-06-24: vertical-row layout replaces the cramped 3-column
 * ring grid. Works at any container width: narrow rail (~200 px) through full
 * mobile content column (375 px+) through wide desktop panels.
 *
 * Visual hierarchy:
 *   1. Proportion bar  — instant distribution glance (no interaction needed)
 *   2. Count number    — hero stat, text-2xl, tabular mono, colour-coded
 *   3. Label           — clear, never truncated
 *   4. Review now CTA  — only on Needs Revision when count > 0
 *
 * Accessibility: colour is never the sole carrier of meaning — numbers and
 * labels duplicate every colour signal (WCAG 1.4.1). role="list" / role="listitem"
 * give screen-readers a structured bucket enumeration.
 */

import { useMasteryOverview } from '@/lib/swr';
import { Skeleton } from '@/components/ui';
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
  /** Optional CTA shown only on needsRevision when count > 0 */
  ctaEn?: string;
  ctaHi?: string;
  /** Brand hex — proportion bar segment, left border accent, number colour, bg tint */
  hex: string;
}

const BUCKETS: BucketDef[] = [
  {
    key: 'mastered',
    glyph: '✓',
    labelEn: 'Mastered',
    labelHi: 'महारत हासिल',
    hex: '#16A34A',
  },
  {
    key: 'learning',
    glyph: '◑',
    labelEn: 'Learning',
    labelHi: 'सीख रहे हैं',
    hex: '#E8581C',
  },
  {
    key: 'needsRevision',
    glyph: '↻',
    labelEn: 'Needs Revision',
    labelHi: 'दोहराना जरूरी',
    ctaEn: 'Review now →',
    ctaHi: 'अभी दोहराओ →',
    hex: '#8B5CF6',
  },
];

export default function MasterySnapshot({ isHi, studentId }: MasterySnapshotProps) {
  const { data, isLoading, error } = useMasteryOverview(studentId);

  const rows: MasteryOverviewRow[] = Array.isArray(data) ? (data as MasteryOverviewRow[]) : [];
  const counts = countBuckets(rows);
  const total = counts.mastered + counts.learning + counts.needsRevision;

  /* ── Loading skeleton ── */
  if (isLoading && !data) {
    return (
      <section
        className="rounded-2xl p-4"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        aria-busy="true"
        aria-label={isHi ? 'महारत लोड हो रही है' : 'Loading mastery'}
      >
        <div className="flex items-center justify-between mb-3">
          <Skeleton width="50%" height={11} />
          <Skeleton width="22%" height={20} rounded="rounded-full" />
        </div>
        <Skeleton height={6} className="mb-4 rounded-full" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={54} rounded="rounded-xl" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      aria-label={isHi ? 'महारत का सारांश' : 'Mastery snapshot'}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-3">
        <h2
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color: 'var(--text-3)' }}
        >
          {isHi ? 'महारत' : 'Mastery'}
        </h2>
        {total > 0 && (
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
          >
            {total}&thinsp;{isHi ? 'विषय' : 'topics'}
          </span>
        )}
      </div>

      {/* ── Error state ── */}
      {error && !isLoading ? (
        <div
          className="rounded-xl p-3 text-center text-sm"
          style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
          role="status"
        >
          {isHi
            ? 'लोड नहीं हो पाया — रीफ़्रेश करें।'
            : "Couldn't load — try refreshing."}
        </div>
      ) : total === 0 ? (
        /* ── Empty / zero-quiz state ── */
        <div
          className="rounded-xl p-4 text-center"
          style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}
        >
          <div className="text-2xl mb-2" aria-hidden="true">🎯</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-1)' }}>
            {isHi ? 'अभी तक कोई क्विज़ नहीं' : 'No quizzes yet'}
          </p>
          <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
            {isHi
              ? 'पहली क्विज़ दो और महारत यहाँ देखो।'
              : 'Take a quiz to see your mastery here.'}
          </p>
          <a
            href="/quiz"
            className="inline-block rounded-xl px-4 py-2 text-sm font-semibold transition-colors hover:opacity-90"
            style={{ background: '#F97316', color: '#fff' }}
          >
            {isHi ? 'क्विज़ शुरू करें →' : 'Start a quiz →'}
          </a>
        </div>
      ) : (
        <>
          {/*
            Proportion bar — segmented strip encoding the three bucket shares.
            No gap between segments: the boundary itself is informative.
            Animates width on data load via CSS transition.
          */}
          <div
            className="flex rounded-full overflow-hidden mb-4"
            style={{ height: 6 }}
            role="presentation"
            aria-hidden="true"
          >
            {BUCKETS.map((b) => {
              const pct = total > 0 ? (counts[b.key] / total) * 100 : 0;
              return (
                <div
                  key={b.key}
                  style={{
                    width: `${pct}%`,
                    background: b.hex,
                    minWidth: pct > 0 ? 4 : 0,
                    transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1)',
                  }}
                />
              );
            })}
          </div>

          {/*
            Stat rows — vertical list so labels never truncate at any container width.
            Left border accent (3 px solid) carries the per-bucket colour identity.
            Hero count is 1.5 rem (24 px) for immediate scannability in the narrow rail.
            Responsive by nature: the row fills the container width automatically.
          */}
          <div className="flex flex-col gap-2" role="list">
            {BUCKETS.map((b) => {
              const value = counts[b.key];
              const label = isHi ? b.labelHi : b.labelEn;
              const hasCta = Boolean(b.ctaEn && value > 0);
              return (
                <div
                  key={b.key}
                  className="flex items-center gap-3 rounded-xl px-3"
                  style={{
                    background: `${b.hex}0e`,
                    borderLeft: `3px solid ${b.hex}`,
                    paddingTop: hasCta ? '8px' : '10px',
                    paddingBottom: hasCta ? '8px' : '10px',
                  }}
                  role="listitem"
                  aria-label={`${label}: ${value} ${isHi ? 'विषय' : 'topics'}`}
                >
                  {/* Hero count number — primary data point */}
                  <span
                    className="shrink-0 font-extrabold tabular-nums leading-none"
                    style={{
                      color: b.hex,
                      fontSize: '1.5rem',
                      lineHeight: 1,
                      minWidth: '2rem',
                      textAlign: 'right',
                      fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                    }}
                    aria-hidden="true"
                  >
                    {value}
                  </span>

                  {/* Label + optional CTA */}
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-semibold leading-snug"
                      style={{ color: 'var(--text-1)' }}
                    >
                      {b.glyph}&ensp;{label}
                    </p>
                    {hasCta && (
                      <a
                        href="/quiz"
                        className="text-xs font-semibold mt-0.5 inline-block transition-opacity hover:opacity-70"
                        style={{ color: b.hex }}
                      >
                        {isHi ? b.ctaHi : b.ctaEn}
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
