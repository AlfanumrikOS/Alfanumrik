/**
 * POST /api/diagnostic/complete
 *
 * Records all diagnostic responses into diagnostic_responses and marks the
 * diagnostic_assessments row complete, computing the summary server-side.
 *
 * Note: `session_id` in the request/response is the diagnostic_assessments.id
 * UUID — the name is kept for backward compatibility with the /diagnostic
 * page contract.
 *
 * Request body:
 * {
 *   session_id: string,
 *   responses: Array<{
 *     question_id: string,
 *     selected_answer_index: number,
 *     is_correct?: boolean,     // ACCEPTED FOR WIRE-COMPAT, NEVER READ — see C1
 *     time_taken_seconds: number,
 *     topic: string | null,
 *     difficulty: number,
 *     bloom_level: string,
 *   }>
 * }
 *
 * Response: {
 *   success: true,
 *   data: {
 *     session_id, score_percent, correct_answers, total_questions,
 *     weak_topics, weak_topics_hi, strong_topics, strong_topics_hi,
 *     recommended_difficulty, placement_confidence, question_results
 *   }
 * }
 *
 * `question_results` carries ONLY the bits the client cannot be trusted to
 * know: the server-derived `is_correct` and the authoritative `correct_index`.
 * Question text, options and explanations are NOT re-sent — the client already
 * holds them from `/api/diagnostic/start` (whose `CLIENT_QUESTION_FIELDS`
 * includes `explanation` + `explanation_hi`) and joins on `question_id`. This
 * keeps the review screen honest (correctness comes from one place, exactly as
 * P1 requires for the score) without paying to ship the same payload twice.
 *
 * Correctness contract — spec
 * `docs/superpowers/specs/2026-07-29-diagnostic-cold-start-correctness.md` §7A:
 *
 *  - C1: correctness is ALWAYS re-derived server-side from
 *    `question_bank.correct_answer_index`. The client-sent `is_correct` is
 *    never read — not for `diagnostic_responses.is_correct`, and not for the
 *    `score_percent` numerator. A missing bank row scores as incorrect and is
 *    logged as `diagnostic_answer_unresolvable`.
 *  - C2: a speed-run (< 3s average per question) still stores and scores
 *    normally (the diagnostic is XP-neutral, there is nothing to reject), but
 *    the placement output is forced to 'medium' and flagged
 *    `placement_confidence: 'low'`. This is a placement-validity rule, not an
 *    anti-cheat change — P3's three checks live on the XP-bearing quiz path
 *    and are neither removed nor weakened here.
 *  - P1 is unchanged: `score_percent = Math.round((correct / total) * 100)`
 *    over the SERVER-derived correct count, at every form length.
 *
 * Phase 5 (2026-08-24) — the diagnostic now FEEDS the adaptive spine:
 *
 *  - C3 (5C): `weak_topics` / `strong_topics` are DERIVED, never the hardcoded
 *    `[]` they used to be. Per-topic accuracy is aggregated from the same
 *    server-derived correctness computed for C1, keyed on the authoritative
 *    `question_bank.topic_id` (NOT the client's `topic` field), and resolved to
 *    display titles via `curriculum_topics`. A NULL/unresolvable topic is
 *    OMITTED — never fabricated, never rendered as a UUID. Banding rules live
 *    in `@alfanumrik/lib/diagnostic/evidence`.
 *
 *  - C4 (5D): every answered, topic-resolved response is written into the
 *    canonical mastery spine via `update_learner_state_post_quiz` — the same
 *    RPC `submit_quiz_results_v2` uses — with DAMPED BKT priors
 *    (`DIAGNOSTIC_BKT_PARAMS`). A diagnostic is a cold-start estimate, not a
 *    practice attempt; the full reasoning for each damped parameter is in the
 *    header of `@alfanumrik/lib/diagnostic/evidence`. This is what makes the
 *    dashboard, /revision, /practice and Foxy's cognitive context non-empty for
 *    a brand-new student.
 *
 *    P2 is untouched: this RPC writes `concept_mastery` only. It awards no XP,
 *    touches no `students` row and creates no `quiz_sessions` row — the
 *    diagnostic remains XP-neutral (AC-32).
 *
 *    P4-style resilience: the mastery write is fire-and-forget and fully
 *    error-isolated. A failing or slow RPC can never fail, delay past its own
 *    await, or alter the student's completion response.
 *
 *  - C5: on a C2 low-confidence (speed-run) placement, BOTH the mastery write
 *    and the weak/strong labels are SUPPRESSED. The same run that makes the
 *    placement meaningless makes its topic-level inference meaningless too.
 *    Per-question explanations are still returned: an explanation is ground
 *    truth about the question, not an inference about the student.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { calculateScorePercent } from '@alfanumrik/lib/scoring';
import { DIAGNOSTIC_PLACEMENT_THRESHOLDS } from '@alfanumrik/lib/diagnostic/placement';
import {
  DIAGNOSTIC_BKT_PARAMS,
  aggregateDiagnosticTopics,
  type DiagnosticTopicOutcome,
} from '@alfanumrik/lib/diagnostic/evidence';
import { getTopicTitlesByIds } from '@/lib/curriculum/cached-taxonomy';

interface DiagnosticResponseItem {
  question_id: string;
  selected_answer_index: number;
  /**
   * C1: accepted on the wire for backward compatibility with shipped clients
   * (web + any older mobile build) but DELIBERATELY NEVER READ. Correctness is
   * re-derived from `question_bank.correct_answer_index` below. Do not
   * reintroduce a read of this field.
   */
  is_correct?: boolean;
  time_taken_seconds: number;
  topic: string | null;
  difficulty: number;
  bloom_level: string;
}

/**
 * §7.5a boundaries live in `@alfanumrik/lib/diagnostic/placement` — the SAME
 * export the client results screen reads (via `apps/host/src/app/diagnostic/
 * copy.ts`'s `RESULT_THRESHOLDS`), so server placement and client encouragement
 * cannot drift apart.
 *
 * They are DELIBERATELY not re-exported from this route module: a Next.js 16
 * App Router `route.ts` may export only handlers + the fixed segment-config
 * keys, and a stray `export const` here fails `next build`. Import the lib
 * module directly (tests included).
 */

/** C2 — below this average seconds-per-question the placement signal is noise. */
const MIN_AVG_SECONDS_PER_QUESTION = 3;

function placementFromScore(scorePercent: number): 'easy' | 'medium' | 'hard' {
  if (scorePercent < DIAGNOSTIC_PLACEMENT_THRESHOLDS.medium) return 'easy';
  if (scorePercent < DIAGNOSTIC_PLACEMENT_THRESHOLDS.hard) return 'medium';
  return 'hard';
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authorize — requires 'diagnostic.complete' permission (P9: RBAC enforcement)
    const auth = await authorizeRequest(request, 'diagnostic.complete');
    if (!auth.authorized) return auth.errorResponse!;
    const userId = auth.userId!;

    // 2. Parse body
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', code: 'INVALID_BODY' },
        { status: 400 }
      );
    }

    const { session_id, responses } = body as {
      session_id?: string;
      responses?: DiagnosticResponseItem[];
    };

    // 3. Validate required fields
    if (!session_id || typeof session_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'session_id is required.', code: 'MISSING_SESSION_ID' },
        { status: 400 }
      );
    }

    if (!Array.isArray(responses) || responses.length === 0) {
      return NextResponse.json(
        { success: false, error: 'responses array is required and must not be empty.', code: 'MISSING_RESPONSES' },
        { status: 400 }
      );
    }

    // 4. Resolve student and verify assessment ownership via admin client
    const admin = getSupabaseAdmin();

    const { data: student, error: studentError } = await admin
      .from('students')
      .select('id')
      .eq('auth_user_id', userId)
      .single();

    if (studentError || !student) {
      return NextResponse.json(
        { success: false, error: 'Student profile not found.', code: 'NO_STUDENT' },
        { status: 404 }
      );
    }

    // 5. Verify the assessment belongs to this student
    const { data: session, error: sessionError } = await admin
      .from('diagnostic_assessments')
      .select('id, is_completed')
      .eq('id', session_id)
      .eq('student_id', student.id)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { success: false, error: 'Diagnostic session not found.', code: 'SESSION_NOT_FOUND' },
        { status: 404 }
      );
    }

    if (session.is_completed === true) {
      return NextResponse.json(
        { success: false, error: 'This diagnostic session is already completed.', code: 'ALREADY_COMPLETED' },
        { status: 409 }
      );
    }

    // 6. Look up the authoritative question rows. This serves two purposes:
    //    (a) filling the NOT NULL diagnostic_responses.question_text column, and
    //    (b) C1 — supplying `correct_answer_index`, the ONLY source of truth for
    //        correctness. The client's `is_correct` is never consulted.
    const questionIds = Array.from(
      new Set(
        responses
          .map((r) => r.question_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );

    // C3/C4: `topic_id` and `bloom_level` come from the BANK, never from the
    // client's `topic` / `bloom_level` wire fields. Those are advisory metadata
    // echoed back by the page and are no more trustworthy than `is_correct`.
    type BankRow = {
      id: string;
      question_text: string;
      options: unknown;
      correct_answer_index: number | null;
      topic_id: string | null;
      bloom_level: string | null;
      difficulty: number | null;
    };
    const bankById = new Map<string, BankRow>();

    if (questionIds.length > 0) {
      const { data: bankRows, error: bankError } = await admin
        .from('question_bank')
        .select(
          'id, question_text, options, correct_answer_index, topic_id, bloom_level, difficulty'
        )
        .in('id', questionIds);

      if (bankError) {
        logger.warn('diagnostic_question_lookup_failed', {
          route: '/api/diagnostic/complete',
          studentId: student.id,
          session_id,
          error: bankError.message,
        });
      } else {
        for (const row of (bankRows ?? []) as BankRow[]) {
          bankById.set(row.id, row);
        }
      }
    }

    // 7. Replace any prior responses for this assessment (makes a retry after
    //    a partial failure safe — there is no unique constraint to upsert on),
    //    then insert all responses into diagnostic_responses.
    const { error: deleteError } = await admin
      .from('diagnostic_responses')
      .delete()
      .eq('assessment_id', session_id);

    if (deleteError) {
      logger.warn('diagnostic_responses_cleanup_failed', {
        route: '/api/diagnostic/complete',
        studentId: student.id,
        session_id,
        error: deleteError.message,
      });
      // Continue — on a first attempt there is nothing to delete anyway.
    }

    // C1: re-derive correctness for every response. `r.is_correct` is not read
    // anywhere in this function — the only inputs are the student's submitted
    // index and the bank row's `correct_answer_index`.
    let unresolvableCount = 0;

    /**
     * The single server-derived record per response. Everything downstream —
     * the persisted `diagnostic_responses` row, the P1 numerator, the
     * `question_results` review payload, the topic aggregation and the mastery
     * write — reads THIS array, so all five can never disagree with each other.
     */
    interface DerivedResponse {
      questionNumber: number;
      questionId: string;
      studentIndex: number | null;
      correctIndex: number | null;
      isCorrect: boolean;
      responseTimeMs: number | null;
      topicId: string | null;
      bloomLevel: string | null;
      difficulty: number | null;
      questionText: string;
      options: unknown;
      /** Client-supplied `topic` echo — persisted as-is for wire compat only. */
      conceptCode: string;
    }

    const derived: DerivedResponse[] = responses.map((r, idx) => {
      const bank = bankById.get(r.question_id);
      const timeSeconds = Number(r.time_taken_seconds);
      const studentIndex = Number.isInteger(r.selected_answer_index)
        ? r.selected_answer_index
        : null;
      const correctIndex =
        typeof bank?.correct_answer_index === 'number' ? bank.correct_answer_index : null;
      const bankDifficulty = typeof bank?.difficulty === 'number' ? bank.difficulty : null;

      // A missing bank row (deleted/renamed question, or a forged question_id)
      // resolves to incorrect — never to the client's claim.
      const serverIsCorrect =
        correctIndex !== null && studentIndex !== null && studentIndex === correctIndex;
      if (correctIndex === null) unresolvableCount++;

      return {
        questionNumber: idx + 1,
        questionId: typeof r.question_id === 'string' ? r.question_id : '',
        studentIndex,
        correctIndex,
        isCorrect: serverIsCorrect,
        responseTimeMs: Number.isFinite(timeSeconds)
          ? Math.max(0, Math.round(timeSeconds * 1000))
          : null,
        topicId: typeof bank?.topic_id === 'string' && bank.topic_id ? bank.topic_id : null,
        bloomLevel:
          typeof bank?.bloom_level === 'string' && bank.bloom_level ? bank.bloom_level : null,
        difficulty: bankDifficulty !== null && Number.isFinite(bankDifficulty)
          ? Math.trunc(bankDifficulty)
          : null,
        questionText: bank?.question_text ?? '',
        options: bank?.options ?? null,
        conceptCode: typeof r.topic === 'string' && r.topic ? r.topic : 'unknown',
      };
    });

    const responseRows = derived.map((d) => ({
      assessment_id: session_id,
      student_id: student.id,
      question_number: d.questionNumber,
      concept_code: d.conceptCode,
      layer: 1,
      question_text: d.questionText,
      options: d.options ?? null,
      correct_index: d.correctIndex,
      student_index: d.studentIndex,
      is_correct: d.isCorrect,
      response_time_ms: d.responseTimeMs,
    }));

    if (unresolvableCount > 0) {
      logger.warn('diagnostic_answer_unresolvable', {
        route: '/api/diagnostic/complete',
        studentId: student.id,
        session_id,
        unresolvable: unresolvableCount,
        total: responseRows.length,
      });
    }

    const { error: insertError } = await admin
      .from('diagnostic_responses')
      .insert(responseRows);

    if (insertError) {
      logger.error('diagnostic_insert_responses_failed', {
        error: new Error(insertError.message),
        route: '/api/diagnostic/complete',
        studentId: student.id,
        session_id,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to save responses. Please try again.', code: 'INSERT_ERROR' },
        { status: 500 }
      );
    }

    // 8. Compute summary server-side and mark the assessment complete.
    //    P1: score_percent = Math.round((correct / total) * 100) — computed over
    //    the SERVER-derived correctness in `responseRows`, never over the client
    //    payload (C1).
    const totalQuestions = responseRows.length;
    const correctCount = responseRows.filter((r) => r.is_correct === true).length;
    const scorePercent = calculateScorePercent(correctCount, totalQuestions);
    const actualTimeSeconds = Math.max(
      0,
      Math.round(
        responses.reduce((sum, r) => {
          const t = Number(r.time_taken_seconds);
          return sum + (Number.isFinite(t) ? t : 0);
        }, 0)
      )
    );

    // §7.5a — recalibrated 50 / 80 boundaries.
    let recommendedDifficulty = placementFromScore(scorePercent);

    // C2 — a speed-run produces a meaningless theta. Score and responses are
    // still stored and shown (XP-neutral surface, nothing to reject), but the
    // platform must not act on the placement.
    const avgSecondsPerQuestion =
      totalQuestions > 0 ? actualTimeSeconds / totalQuestions : 0;
    const placementConfidence: 'low' | 'normal' =
      avgSecondsPerQuestion < MIN_AVG_SECONDS_PER_QUESTION ? 'low' : 'normal';
    if (placementConfidence === 'low') {
      recommendedDifficulty = 'medium';
      logger.info('diagnostic_placement_low_confidence', {
        route: '/api/diagnostic/complete',
        studentId: student.id,
        session_id,
        avgSecondsPerQuestion: Math.round(avgSecondsPerQuestion * 100) / 100,
        totalQuestions,
      });
    }

    const { error: updateError } = await admin
      .from('diagnostic_assessments')
      .update({
        is_completed: true,
        completed_at: new Date().toISOString(),
        total_questions: totalQuestions,
        correct_answers: correctCount,
        raw_score_pct: scorePercent,
        actual_time_seconds: actualTimeSeconds,
        // ─── `next_path` — KEEP, DELIBERATELY WRITE-ONLY (assessment ruling,
        //     2026-08-24, revisited after Phase 5D landed) ───────────────────
        //
        // Verified again after 5D: `next_path` still has ZERO readers repo-wide
        // (grep across apps/, packages/, mobile/, supabase/functions/ finds only
        // this write and its own tests). That was the right question to ask —
        // and the answer is NOT "add a reader".
        //
        // Adaptation now flows through `concept_mastery` (seeded below), which
        // every existing ZPD / SRS / remediation consumer already reads. A
        // second "read next_path to choose difficulty" path would be a
        // COMPETING source of truth for the same decision and would drift from
        // the mastery spine the moment the student takes one real quiz. Do not
        // build one.
        //
        // It is not dead weight either: this is the only durable record of what
        // the platform CONCLUDED at placement time. `concept_mastery` records
        // what the student did; `next_path` records the verdict we drew from it,
        // including whether we trusted the run at all. Without it, "why was this
        // student placed at hard?" is unanswerable after the fact. Reclassified
        // from "the adaptive hand-off" to "the placement audit record" —
        // written every time, read by humans during investigation.
        next_path: {
          recommended_difficulty: recommendedDifficulty,
          placement_confidence: placementConfidence,
        },
      })
      .eq('id', session_id)
      .eq('student_id', student.id);

    if (updateError) {
      // Responses are saved; do not fail the student's submission over the
      // summary write. The assessment stays incomplete, and step 7's
      // delete-then-insert makes a later retry safe.
      logger.error('diagnostic_complete_update_failed', {
        error: new Error(updateError.message),
        route: '/api/diagnostic/complete',
        studentId: student.id,
        session_id,
      });
    }

    // ── C3 — derive weak/strong topics (was a hardcoded `[]`) ───────────────
    //
    // C5: a speed run's topic-level inference is as meaningless as its
    // placement, so both lists stay empty and the page keeps rendering its
    // honest "analysis not available" empty state.
    let weakTopics: string[] = [];
    let weakTopicsHi: string[] = [];
    let strongTopics: string[] = [];
    let strongTopicsHi: string[] = [];

    const topicIds = Array.from(
      new Set(derived.map((d) => d.topicId).filter((id): id is string => !!id))
    );

    if (placementConfidence === 'normal' && topicIds.length > 0) {
      try {
        // ADR-007 / `alfanumrik/no-inline-taxonomy-reads`: go through the shared
        // `syllabus`-tagged cached taxonomy reader rather than an inline
        // `.from('curriculum_topics')`. `getTopicTitlesByIds` is deliberately
        // NOT is_active-filtered, which is what we want here — a topic
        // deactivated by a curriculum edit after the student answered its
        // question should still show its name, not silently vanish from the
        // analysis. It gained `title_hi` for this caller (P7).
        const topicRows = await getTopicTitlesByIds(topicIds);

        const titleById = new Map<string, { title: string; title_hi: string | null }>();
        for (const row of topicRows) {
          if (typeof row.title === 'string' && row.title.trim().length > 0) {
            titleById.set(row.id, { title: row.title, title_hi: row.title_hi ?? null });
          }
        }

        const outcomes: DiagnosticTopicOutcome[] = [];
        for (const d of derived) {
          if (!d.topicId) continue; // NULL topic_id — omit, never fabricate
          const t = titleById.get(d.topicId);
          if (!t) continue; // unresolvable title — omit
          outcomes.push({
            topicId: d.topicId,
            title: t.title,
            titleHi: t.title_hi,
            isCorrect: d.isCorrect,
          });
        }

        const labels = aggregateDiagnosticTopics(outcomes);
        weakTopics = labels.weak.map((l) => l.title);
        weakTopicsHi = labels.weak.map((l) => l.titleHi);
        strongTopics = labels.strong.map((l) => l.title);
        strongTopicsHi = labels.strong.map((l) => l.titleHi);
      } catch (topicErr) {
        // Non-fatal: the student still gets the score AND the per-question
        // explanations. `getTopicTitlesByIds` throws on a genuine DB error;
        // both lists stay empty and the page shows its honest empty state.
        logger.warn('diagnostic_topic_aggregation_failed', {
          route: '/api/diagnostic/complete',
          studentId: student.id,
          session_id,
          error: topicErr instanceof Error ? topicErr.message : String(topicErr),
        });
      }
    }

    // ── C4 — seed the canonical mastery spine ───────────────────────────────
    //
    // Same RPC `submit_quiz_results_v2` uses, with DAMPED BKT priors (see
    // `@alfanumrik/lib/diagnostic/evidence` for the per-parameter ruling).
    // One call per answered, topic-resolved response.
    //
    // P4-style resilience: awaited so ordering is deterministic in tests, but
    // EVERY call is individually try/caught and the whole block is wrapped, so
    // no mastery failure can change the student's response. P2: this RPC writes
    // `concept_mastery` only — no XP, no `students` row, no `quiz_sessions`.
    if (placementConfidence === 'normal') {
      let masteryFailures = 0;
      let masteryWrites = 0;
      for (const d of derived) {
        if (!d.topicId) continue; // no topic → nothing to attribute mastery to
        try {
          const { error: masteryError } = await admin.rpc(
            'update_learner_state_post_quiz',
            {
              p_student_id: student.id,
              p_topic_id: d.topicId,
              p_is_correct: d.isCorrect,
              p_bloom_level: d.bloomLevel,
              // The diagnostic delivers no per-item error classification.
              p_error_type: null,
              p_response_time_ms: d.responseTimeMs,
              // question_bank.difficulty is an INTEGER column — passing the
              // categorical 'medium'-style string here would 42883 before the
              // function body runs. Keep this numeric.
              p_difficulty: d.difficulty,
              ...DIAGNOSTIC_BKT_PARAMS,
            }
          );
          if (masteryError) {
            masteryFailures++;
          } else {
            masteryWrites++;
          }
        } catch {
          masteryFailures++;
        }
      }

      if (masteryFailures > 0) {
        // P13: topic UUIDs and counts only — never question or answer text.
        logger.warn('diagnostic_mastery_seed_partial', {
          route: '/api/diagnostic/complete',
          studentId: student.id,
          session_id,
          written: masteryWrites,
          failed: masteryFailures,
        });
      } else if (masteryWrites > 0) {
        logger.info('diagnostic_mastery_seeded', {
          route: '/api/diagnostic/complete',
          studentId: student.id,
          session_id,
          written: masteryWrites,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        session_id,
        score_percent: scorePercent,
        correct_answers: correctCount,
        total_questions: totalQuestions,
        weak_topics: weakTopics,
        weak_topics_hi: weakTopicsHi,
        strong_topics: strongTopics,
        strong_topics_hi: strongTopicsHi,
        recommended_difficulty: recommendedDifficulty,
        placement_confidence: placementConfidence,
        // 5A — the authoritative per-question verdict the review screen renders
        // alongside the explanation it already holds from /api/diagnostic/start.
        question_results: derived.map((d) => ({
          question_id: d.questionId,
          question_number: d.questionNumber,
          is_correct: d.isCorrect,
          selected_index: d.studentIndex,
          correct_index: d.correctIndex,
        })),
      },
    });
  } catch (err) {
    logger.error('diagnostic_complete_unexpected', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/diagnostic/complete',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
