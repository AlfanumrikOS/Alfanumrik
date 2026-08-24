'use client';

/**
 * RevisionRail — the SECONDARY spaced-repetition surface of the Alfa OS
 * dashboard (ff_student_os_v1).
 *
 * ONE number, ONE source (defect #7). This card used to show two contradictory
 * counts side by side:
 *   - the badge came from `useReviewCards` → get_review_cards →
 *     `spaced_repetition_cards`, a table nothing writes from quizzes (19 rows
 *     platform-wide), so it read 0 for essentially every student; while
 *   - the nested <ReviewsDueCard> came from /api/dashboard/reviews-due →
 *     `concept_mastery.next_review_at`, a real number.
 * A student could see the badge missing and the card announcing "6 reviews
 * due" in the same 200px of screen.
 *
 * Both the badge and the CTA now derive from a SINGLE payload:
 * GET /api/revision/overview (the same contract the live /revision page reads),
 * bucketed off `concept_mastery.next_review_at` — the real SM-2 schedule, not
 * the deprecated `next_review_date` ghost column. `dueNow = overdue + dueToday`
 * is handed to <ReviewsDueCard> as props, so the badge and the card can no
 * longer disagree and the dashboard makes one request instead of two.
 *
 * The CTA target moved too: /review?due_only=1 was a dead end (301 → /refresh
 * ?tab=flashcards, which drops the query and reads the same empty
 * spaced_repetition_cards → "Nothing to refresh right now"). It now goes to
 * /revision, which is live at 100% and renders these exact items.
 *
 * Bilingual via isHi.
 */

import dynamic from 'next/dynamic';
import { useRevisionOverview } from '@alfanumrik/ui/review/os/useRevisionOverview';
import { WARM, WARM_10 } from '@alfanumrik/ui/dashboard/os/palette';

const ReviewsDueCard = dynamic(() => import('@alfanumrik/ui/dashboard/ReviewsDueCard'), {
  ssr: false,
  loading: () => null,
});

interface RevisionRailProps {
  isHi: boolean;
  studentId: string | undefined;
}

export default function RevisionRail({ isHi, studentId }: RevisionRailProps) {
  // Single reader. `enabled` waits for a student id so the OFF/logged-out path
  // issues zero requests.
  const { data: overview, isLoading, error } = useRevisionOverview(Boolean(studentId));

  // `loaded` = the fetch genuinely resolved with a payload. dueCount falls back
  // to 0 while loading / on error, so the reassuring "nothing due" copy below
  // MUST additionally require `loaded && !error` — otherwise a failed fetch (or
  // the initial pre-data render) would masquerade as "all caught up".
  const loaded = Boolean(overview);
  const dueCount = overview ? overview.overdue.count + overview.dueToday.count : 0;
  const estimatedMinutes = overview?.estimatedMinutes ?? 0;

  return (
    <section
      className="rounded-3xl p-4"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      aria-label={isHi ? 'दोहराव' : 'Revision'}
    >
      <div className="flex items-center justify-between mb-3">
        {/* Section eyebrow — the ONE shared treatment across every dashboard
            card (was text-sm/tracking-wider here, text-xs/tracking-widest on
            MasterySnapshot and an 11px one-off on the hero: three different
            eyebrows on one screen). */}
        <h2
          className="text-fluid-2xs font-bold uppercase tracking-widest"
          style={{ color: 'var(--text-3)' }}
        >
          {isHi ? 'दोहराव' : 'Revision'}
        </h2>
        {dueCount > 0 && (
          <span
            className="text-fluid-2xs font-bold font-data tabular-nums px-2 py-0.5 rounded-full shrink-0"
            style={{ background: WARM_10, color: WARM }}
          >
            {dueCount}
          </span>
        )}
      </div>

      {error && !isLoading ? (
        <p className="text-fluid-xs leading-relaxed" style={{ color: 'var(--text-3)' }} role="status">
          {isHi
            ? 'अभी लोड नहीं हो पाया — रीफ़्रेश करके फिर देखो।'
            : "Couldn't load right now — pull to refresh."}
        </p>
      ) : (
        <>
          {/* ReviewsDueCard renders the CTA or null (when 0 due). It reads the
              count from THIS payload — it does not fetch its own. */}
          <ReviewsDueCard dueCount={dueCount} estimatedMinutes={estimatedMinutes} />

          {/* Only assert "nothing due — nice work" on a genuine success
              (fetch resolved, no error, zero due). Never let a failed or
              in-flight fetch look like the student is all caught up. */}
          {!error && loaded && dueCount === 0 && (
            <p className="text-fluid-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
              {isHi
                ? 'अभी कोई दोहराव बाकी नहीं — बढ़िया! नए पाठ पर ध्यान दो।'
                : 'Nothing due right now — nice work. Focus on a fresh lesson.'}
            </p>
          )}
        </>
      )}
    </section>
  );
}
