/**
 * ALFANUMRIK — Diagnostic EVIDENCE rules (PURE, dependency-free leaf).
 *
 * Owner: assessment. Two things live here, both of which are assessment
 * rulings rather than implementation details, and both of which the
 * `/api/diagnostic/complete` route and its tests must read from ONE place so
 * they cannot drift (same reason `placement.ts` exists — see its header).
 *
 *   1. `DIAGNOSTIC_BKT_PARAMS` — the damped Bayesian-Knowledge-Tracing priors
 *      the diagnostic passes to `update_learner_state_post_quiz`, so a
 *      cold-start placement check seeds `concept_mastery` WITHOUT claiming the
 *      confidence of sustained practice evidence.
 *   2. `aggregateDiagnosticTopics()` — how per-response correctness becomes the
 *      student-visible "Areas to strengthen" / "Strong areas" labels.
 *
 * ─── RULING 1: DIAGNOSTIC-VS-QUIZ MASTERY WEIGHTING ───────────────────────
 *
 * A diagnostic is a COLD-START ESTIMATE, not a practice attempt. It must seed
 * the mastery spine (otherwise the dashboard, /revision, /practice and Foxy's
 * cognitive context are all empty for a brand-new student) but it must not
 * speak with the authority of a real quiz. The damping is applied to the BKT
 * parameters themselves — NOT to `p_hint_level` — for a measured reason:
 *
 *   `update_learner_state_post_quiz` (migration 20260807000400) exposes
 *   `p_hint_level` as an evidence-weight dial (0→1.0, 1→0.7, 2→0.45, 3→0.25).
 *   It is tempting to reuse it. It is the WRONG dial here on two counts:
 *     (a) it routes the attempt into `hinted_attempts` / `hinted_correct`,
 *         which would be a semantic falsehood — the diagnostic shows no hints;
 *     (b) the columns it moves (`evidence_quality`, `mastery_variance`,
 *         the independent/hinted counters) have ZERO readers today, whereas
 *         `mastery_probability` / `p_know` — the BKT posterior — are read by
 *         the twin snapshot builder, the adaptive-remediation cron, the
 *         reviews-due endpoint, /dive and exam mastery sync. Damping a column
 *         nobody reads is not damping.
 *   So the diagnostic passes the SAME `p_hint_level` as a normal independent
 *   attempt (omitted → NULL → treated as independent, weight 1.0) and damps
 *   the posterior directly.
 *
 * Per-parameter justification (defaults in the RPC are 0.2 / 0.1 / 0.25):
 *
 *   p_learn 0.20 → 0.05
 *     p_learn is P(not-knowing → knowing AS A RESULT OF THIS ATTEMPT). The
 *     diagnostic is measurement, not instruction: no worked solution is shown
 *     mid-test and no remediation is delivered before the next item. At the
 *     RPC's defaults this term is large enough that a WRONG answer on a fresh
 *     topic still RAISES mastery 0.10 → 0.21 — i.e. failing a question would
 *     look like progress. 0.05 (not 0) keeps the model non-degenerate while
 *     removing that spurious "learned by being tested" bump.
 *
 *   p_slip 0.10 → 0.25
 *     p_slip is P(wrong | knows it). Cold start maximises slip: unfamiliar UI,
 *     no warm-up, zero stakes (the diagnostic is XP-neutral so there is no
 *     incentive to invest effort), and the 5/6/4 blueprint deliberately serves
 *     hard items above the student's demonstrated band. A wrong answer here is
 *     therefore weaker evidence of not-knowing than a wrong quiz answer.
 *
 *   p_guess 0.25 → 0.40
 *     p_guess is P(right | does not know it). A four-option MCQ has a 0.25
 *     floor from chance alone; with plausible-distractor elimination on an
 *     effortless-to-skim cold-start form the effective rate sits above chance.
 *     A lone correct answer is therefore weaker evidence of knowing.
 *
 * NET EFFECT, computed from the same update the RPC runs (prior P = 0.1):
 *     correct — quiz 0.10 → 0.43   |   diagnostic 0.10 → 0.21
 *     wrong   — quiz 0.10 → 0.21   |   diagnostic 0.10 → 0.09
 * One diagnostic item therefore carries roughly a THIRD of the posterior
 * movement of one quiz item, and a wrong diagnostic answer no longer moves
 * mastery upward. Two subsequent full-strength quiz attempts on the same topic
 * dominate the entire diagnostic prior — which is exactly the dominance
 * ordering we want: seed the spine, then get out of the way.
 *
 * The damping is monotone and additive, so it can never BLOCK later evidence.
 *
 * ─── RULING 2: LOW-CONFIDENCE PLACEMENT WRITES NOTHING ────────────────────
 * `/api/diagnostic/complete`'s C2 guard already disarms `recommended_difficulty`
 * when the student averages < 3s per question. The same run is equally
 * worthless as mastery evidence and as topic-level analysis, so the route
 * suppresses BOTH the mastery write and the weak/strong labels on a low-
 * confidence run. Per-question EXPLANATIONS are still shown: an explanation is
 * ground truth about the question, not an inference about the student.
 *
 * ─── RULING 3: TOPIC LABEL BANDS ──────────────────────────────────────────
 * Reuses `DIAGNOSTIC_PLACEMENT_THRESHOLDS` rather than inventing a third pair
 * of cuts, so a topic can never be called "weak" while the whole-form score at
 * the same percentage is called "medium". The 50-79% middle band is
 * DELIBERATELY unlabelled — if every topic landed in one list or the other the
 * lists would carry no information.
 */

import { DIAGNOSTIC_PLACEMENT_THRESHOLDS } from './placement';

/**
 * Damped BKT priors for a diagnostic attempt. Keys are the
 * `update_learner_state_post_quiz` argument names so the call site is a
 * spread, not a hand-transcription.
 *
 * Changing these is an assessment decision (learner-state rules, P14 chain:
 * ai-engineer, frontend, testing).
 */
export const DIAGNOSTIC_BKT_PARAMS = {
  p_p_learn: 0.05,
  p_p_slip: 0.25,
  p_p_guess: 0.4,
} as const;

/** The RPC's own defaults, kept here purely so a test can assert we damped. */
export const QUIZ_BKT_PARAM_DEFAULTS = {
  p_p_learn: 0.2,
  p_p_slip: 0.1,
  p_p_guess: 0.25,
} as const;

/** At most this many labels per list — a wall of chips is not actionable. */
export const DIAGNOSTIC_TOPIC_MAX_LABELS = 5;

/** One answered, topic-resolved diagnostic response. */
export interface DiagnosticTopicOutcome {
  topicId: string;
  /** `curriculum_topics.title`. Never a UUID — untitled topics are dropped. */
  title: string;
  /** `curriculum_topics.title_hi`; null falls back to `title` (P7 rule for untranslated terms). */
  titleHi: string | null;
  isCorrect: boolean;
}

export interface DiagnosticTopicLabel {
  title: string;
  titleHi: string;
}

export interface DiagnosticTopicLabels {
  weak: DiagnosticTopicLabel[];
  strong: DiagnosticTopicLabel[];
}

interface TopicTally {
  topicId: string;
  title: string;
  titleHi: string;
  attempted: number;
  correct: number;
}

/**
 * Derive the student-visible weak/strong topic labels from per-response
 * correctness.
 *
 * Contract:
 *  - Outcomes with an empty `topicId` or an empty `title` are OMITTED, never
 *    fabricated and never rendered as a raw UUID. (~9.5% of reachable
 *    `question_bank` rows still carry a NULL `topic_id`.)
 *  - Per-topic accuracy uses the P1 shape: `Math.round((correct/attempted)*100)`.
 *  - weak   = accuracy <  DIAGNOSTIC_PLACEMENT_THRESHOLDS.medium (50)
 *  - strong = accuracy >= DIAGNOSTIC_PLACEMENT_THRESHOLDS.hard   (80)
 *  - the 50-79 middle band is intentionally unlabelled.
 *  - Ordering is fully deterministic (accuracy, then evidence volume, then
 *    title) so the same submission always renders the same list.
 */
export function aggregateDiagnosticTopics(
  outcomes: readonly DiagnosticTopicOutcome[],
): DiagnosticTopicLabels {
  const byTopic = new Map<string, TopicTally>();

  for (const o of outcomes) {
    if (!o || typeof o.topicId !== 'string' || o.topicId.length === 0) continue;
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    if (title.length === 0) continue;

    let tally = byTopic.get(o.topicId);
    if (!tally) {
      const hi = typeof o.titleHi === 'string' ? o.titleHi.trim() : '';
      tally = {
        topicId: o.topicId,
        title,
        titleHi: hi.length > 0 ? hi : title,
        attempted: 0,
        correct: 0,
      };
      byTopic.set(o.topicId, tally);
    }
    tally.attempted += 1;
    if (o.isCorrect === true) tally.correct += 1;
  }

  const weak: Array<TopicTally & { accuracy: number }> = [];
  const strong: Array<TopicTally & { accuracy: number }> = [];

  for (const tally of byTopic.values()) {
    if (tally.attempted === 0) continue;
    const accuracy = Math.round((tally.correct / tally.attempted) * 100);
    if (accuracy < DIAGNOSTIC_PLACEMENT_THRESHOLDS.medium) {
      weak.push({ ...tally, accuracy });
    } else if (accuracy >= DIAGNOSTIC_PLACEMENT_THRESHOLDS.hard) {
      strong.push({ ...tally, accuracy });
    }
  }

  weak.sort(
    (a, b) =>
      a.accuracy - b.accuracy ||
      b.attempted - a.attempted ||
      a.title.localeCompare(b.title),
  );
  strong.sort(
    (a, b) =>
      b.accuracy - a.accuracy ||
      b.attempted - a.attempted ||
      a.title.localeCompare(b.title),
  );

  const toLabel = (t: TopicTally): DiagnosticTopicLabel => ({
    title: t.title,
    titleHi: t.titleHi,
  });

  return {
    weak: weak.slice(0, DIAGNOSTIC_TOPIC_MAX_LABELS).map(toLabel),
    strong: strong.slice(0, DIAGNOSTIC_TOPIC_MAX_LABELS).map(toLabel),
  };
}
