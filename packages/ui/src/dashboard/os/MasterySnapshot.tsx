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
 *   2. Count number    — hero stat, fluid --text-2xl step, tabular Sora, colour-coded
 *   3. Label           — clear, never truncated
 *   4. Review now CTA  — the panel's ONE link, only on Needs Revision when
 *                        count > 0
 *
 * 2026-08-05 declutter: the empty state used to carry a second, generic
 * "Start a quiz →" anchor pointing at the SAME /quiz destination as the
 * contextual "Review now →". This panel is a glance surface, not an action
 * surface — the action for a zero-quiz student is already the dominant
 * TodaysMission hero on the same screen. Only the contextual link survives; the
 * empty state keeps its bilingual guidance copy.
 *
 * Subject scope: rows are restricted to the student's reachable subjects
 * (useAllowedSubjects → /api/student/subjects → grade_subject_map). This panel
 * previously counted every subject the RPC returned while the roadmap below it
 * showed a hardcoded two — two different answers to "which subjects?" on one
 * screen.
 *
 * Accessibility: colour is never the sole carrier of meaning — numbers and
 * labels duplicate every colour signal (WCAG 1.4.1). role="list" / role="listitem"
 * give screen-readers a structured bucket enumeration.
 */

import { useMasteryOverview } from '@alfanumrik/lib/swr';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';
import { Skeleton, StatRing } from '@alfanumrik/ui/ui';
import {
  countBuckets,
  filterRowsToAllowedSubjects,
  type MasteryOverviewRow,
  type BucketCounts,
} from '@alfanumrik/lib/dashboard/mastery-buckets';
import {
  MASTERY_STRONG,
  MASTERY_LEARNING,
  MASTERY_REVISE,
  tint,
} from '@alfanumrik/ui/dashboard/os/palette';

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
  /**
   * Semantic colour token from the shared dashboard palette (never a literal).
   *   mastered      → MASTERY_STRONG   (AA-safe green — see palette.ts for why
   *                                     this is NOT `--green`)
   *   learning      → MASTERY_LEARNING (the stable warm channel)
   *   needsRevision → MASTERY_REVISE   (deliberate violet accent)
   */
  color: string;
}

const BUCKETS: BucketDef[] = [
  {
    key: 'mastered',
    glyph: '✓',
    labelEn: 'Mastered',
    labelHi: 'महारत हासिल',
    color: MASTERY_STRONG,
  },
  {
    key: 'learning',
    glyph: '◑',
    labelEn: 'Learning',
    labelHi: 'सीख रहे हैं',
    color: MASTERY_LEARNING,
  },
  {
    key: 'needsRevision',
    glyph: '↻',
    labelEn: 'Needs Revision',
    labelHi: 'दोहराना जरूरी',
    ctaEn: 'Review now →',
    ctaHi: 'अभी दोहराओ →',
    color: MASTERY_REVISE,
  },
];

export default function MasterySnapshot({ isHi, studentId }: MasterySnapshotProps) {
  const { data, isLoading, error, coverage } = useMasteryOverview(studentId);
  // Same reachable-subject set the roadmaps and the progress page use
  // (/api/student/subjects = grade_subject_map ⋈ active subjects). Without it
  // this panel counted EVERY subject get_mastery_overview returned, so its
  // bucket totals disagreed with the roadmap directly below it on the same
  // screen. SWR-deduped — no extra request.
  const { subjects: allowedSubjects } = useAllowedSubjects();

  const allRows: MasteryOverviewRow[] = Array.isArray(data) ? (data as MasteryOverviewRow[]) : [];
  const rows = filterRowsToAllowedSubjects(allRows, allowedSubjects);
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
          <Skeleton width="50%" height={12} />
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

  // Mastered share drives the summary ring (deliberately the positive signal).
  const masteredPct = total > 0 ? Math.round((counts.mastered / total) * 100) : 0;

  /* W3 D2 (assessment sign-off 2026-08-06): the ring needs a sample-size floor
   * (N = 5). A percentage over fewer than N started topics reads as more certain
   * than it is — one started-and-mastered topic renders a hero "100%" ring that
   * is arithmetically correct but pedagogically false. Below N we suppress the
   * ring and let the segmented bar + counts carry the distribution instead. */
  const MIN_RING_TOPICS = 5;
  const showRing = total >= MIN_RING_TOPICS;

  /* W3 D3 (assessment sign-off 2026-08-06): `get_mastery_overview` can return
   * zero rows because the student has no attempts OR because the student's
   * grade has no curriculum topics at all (a platform gap). Only the former may
   * be presented as the student's inaction. `coverage` (undefined on legacy
   * callers/mocks) defaults to `no_activity` to preserve the historical copy. */
  const emptyKind: 'no_activity' | 'neutral' =
    coverage === 'no_curriculum' || coverage === 'not_tracked' ? 'neutral' : 'no_activity';

  return (
    <section
      className="os-reveal-card rounded-2xl p-4"
      style={{
        ['--reveal-i' as string]: '1',
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
      }}
      aria-label={isHi ? 'महारत का सारांश' : 'Mastery snapshot'}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-3">
        {/* Section eyebrow — the ONE shared treatment across every dashboard
            card (see RevisionRail / SubjectRoadmaps / BoardScoreWidget). */}
        <h2
          className="text-fluid-2xs font-bold uppercase tracking-widest"
          style={{ color: 'var(--text-3)' }}
        >
          {isHi ? 'महारत' : 'Mastery'}
        </h2>
        {total > 0 && (
          <span
            className="text-fluid-2xs font-semibold font-data tabular-nums px-2 py-0.5 rounded-full shrink-0"
            style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
          >
            {total}&thinsp;{isHi ? 'विषय' : 'topics'}
          </span>
        )}
      </div>

      {/* ── Error state ── */}
      {error && !isLoading ? (
        <div
          className="rounded-xl p-3 text-center text-fluid-sm"
          style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
          role="status"
        >
          {isHi
            ? 'लोड नहीं हो पाया — रीफ़्रेश करें।'
            : "Couldn't load — try refreshing."}
        </div>
      ) : total === 0 ? (
        emptyKind === 'neutral' ? (
          /* ── Empty / no-curriculum or unverifiable state (W3 D3) ──────────────
             No student attribution: zero rows here can mean the grade has no
             curriculum topics at all (a platform coverage gap) or the RPC
             failed. Only `no_activity` may carry the quiz prompt — a child
             must not be told to "take a quiz" because the platform has nothing
             for their grade. */
          <div
            className="rounded-xl p-4 text-center"
            style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}
          >
            <div className="text-2xl mb-2" aria-hidden="true">📭</div>
            <p className="text-fluid-sm font-semibold mb-1" style={{ color: 'var(--text-1)' }}>
              {isHi ? 'अभी यहाँ कुछ नहीं है' : 'Nothing to show here yet'}
            </p>
            <p className="text-fluid-xs" style={{ color: 'var(--text-3)' }}>
              {isHi
                ? 'आपकी कक्षा के लिए महारत अभी उपलब्ध नहीं है — जल्द देखें।'
                : "Mastery for your grade isn't set up yet — check back soon."}
            </p>
          </div>
        ) : (
          /* ── Empty / zero-quiz state ── */
          <div
            className="rounded-xl p-4 text-center"
            style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}
          >
            <div className="text-2xl mb-2" aria-hidden="true">🎯</div>
            <p className="text-fluid-sm font-semibold mb-1" style={{ color: 'var(--text-1)' }}>
              {isHi ? 'अभी तक कोई क्विज़ नहीं' : 'No quizzes yet'}
            </p>
            {/* Guidance copy only — no CTA here. The action for a student with
                zero quizzes is the TodaysMission hero on the same screen; a
                second /quiz link would be the redundant twin of the contextual
                "Review now →" below. */}
            <p className="text-fluid-xs" style={{ color: 'var(--text-3)' }}>
              {isHi
                ? 'पहली क्विज़ दो और महारत यहाँ देखो।'
                : 'Take a quiz to see your mastery here.'}
            </p>
          </div>
        )
      ) : (
        <>
          {/*
            Summary ring — the positive "mastered" share as a premium animated
            StatRing (Sora data-font center). Sits beside the segmented bar so the
            student gets one hero number plus the full distribution at a glance.
            The number duplicates the green segment (WCAG 1.4.1 — not colour-only).
            W3 D2: hidden below N = 5 started topics (see showRing above) so a
            tiny sample can't render a falsely certain hero percentage.
          */}
          <div className="flex items-center gap-3 mb-4">
            {showRing && (
              <StatRing value={masteredPct} size={56} strokeWidth={6} color={MASTERY_STRONG}>
                <div className="text-center leading-none">
                  <span
                    className="block text-fluid-sm font-extrabold font-data tabular-nums"
                    style={{ color: MASTERY_STRONG }}
                  >
                    {masteredPct}%
                  </span>
                </div>
              </StatRing>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-fluid-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                {isHi ? 'महारत हासिल' : 'Mastered'}
              </p>
              {/*
                Proportion bar — segmented strip encoding the three bucket shares.
                No gap between segments: the boundary itself is informative.
                Animates width on data load via CSS transition.
              */}
              <div
                className="flex rounded-full overflow-hidden mt-1.5"
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
                        background: b.color,
                        minWidth: pct > 0 ? 4 : 0,
                        transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1)',
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/*
            Stat rows — vertical list so labels never truncate at any container width.
            Left border accent (3 px solid) carries the per-bucket colour identity.
            Count uses the fluid --text-2xl step (24 → 30 px) for immediate
            scannability in the narrow rail.
            Vertical padding now comes off the shared 4 px spacing scale
            (Tailwind py-*) instead of inline pixel literals; the `hasCta` row is
            tighter because its CTA already carries a 44 px tap box of its own.
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
                  className={`flex items-center gap-3 rounded-xl px-3 transition-colors ${
                    hasCta ? 'pt-2 pb-1' : 'py-2.5'
                  }`}
                  style={{
                    background: tint(b.color, 6),
                    borderLeft: `3px solid ${b.color}`,
                  }}
                  role="listitem"
                  aria-label={`${label}: ${value} ${isHi ? 'विषय' : 'topics'}`}
                >
                  {/* Hero count number — primary data point.
                      `font-data` is the design system's declared numeric voice
                      (Sora). It used to read `var(--font-mono, …)`, but
                      `--font-mono` is only declared inside the
                      html[data-design="cosmic"] scope — which this surface
                      removes — so these three numbers were silently rendering
                      in the OS default monospace, the only monospaced type on
                      the whole dashboard. */}
                  <span
                    className="shrink-0 text-fluid-2xl font-extrabold font-data tabular-nums leading-none text-right"
                    style={{ color: b.color, minWidth: '2ch' }}
                    aria-hidden="true"
                  >
                    {value}
                  </span>

                  {/* Label + optional CTA. The glyph is a tinted chip in the
                      bucket's own hue: it is what makes the three segments of
                      the proportion bar above decodable without relying on
                      colour perception (WCAG 1.4.1), and it matches the status
                      chip idiom BoardScoreWidget already uses. */}
                  <div className="flex-1 min-w-0">
                    <p
                      className="flex items-center gap-2 text-fluid-sm font-semibold leading-snug"
                      style={{ color: 'var(--text-1)' }}
                    >
                      <span
                        className="inline-flex shrink-0 items-center justify-center w-5 h-5 rounded-full text-fluid-2xs font-bold leading-none"
                        style={{ background: tint(b.color, 14), color: b.color }}
                        aria-hidden="true"
                      >
                        {b.glyph}
                      </span>
                      <span className="min-w-0">{label}</span>
                    </p>
                    {hasCta && (
                      <a
                        /* "Review now" must land on the revision surface, not a
                           blank quiz setup. /revision (ff_revision_os_v1, ON)
                           reads the same due schedule this bucket counts. */
                        href="/revision"
                        className="inline-flex items-center min-h-tap-min text-fluid-xs font-semibold transition-opacity hover:opacity-70 focus:outline-none focus-visible:ring-2 rounded"
                        style={{ color: b.color }}
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
