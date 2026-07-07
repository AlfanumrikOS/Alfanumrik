/**
 * Pedagogy v2 — Wave 1B
 * GET /api/rhythm/today
 *
 * Returns today's daily-rhythm queue for the authenticated student:
 *   5 SRS reviews + 1 ZPD problem + 1 reflection
 *
 * Gating: ff_pedagogy_v2_daily_rhythm. When off, returns 404.
 *
 * Pre-flight audit (encoded; verify against canonical before each rebuild):
 *   A1 goal_code ........ students.academic_goal column
 *   A2 grade ............ students.grade column (string per P5)
 *   A3 IRT ability ...... not needed; get_adaptive_questions handles internally
 *   A4 due reviews ...... RPC get_due_reviews(p_student_id, p_subject_code, p_limit)
 *                         → (topic_id, mastery_probability, last_attempted_at, ...)
 *   A5 ZPD pool ......... RPC get_adaptive_questions(p_student_id, p_subject,
 *                              p_limit, p_include_review, p_mode)
 *                         → (question_id, bloom_level, priority_score, source, ...)
 *
 * Wave 1C ZPD targeting (Phase 3): real ability + per-question difficulty now
 * feed the orchestrator. `studentAbility` is the student's `irt_theta` (logit
 * scale) from student_learning_profiles; candidate `difficulty` is each
 * question's `question_bank.irt_difficulty` (theta scale, [-4,4]) mapped onto
 * the orchestrator's 0..1 axis via the SAME sigmoid the orchestrator uses to
 * derive its target (`1/(1+e^-x)`), so "closest difficulty to target" is a
 * true same-axis ZPD match. Both signals are non-fatal: a missing/failed theta
 * defaults to 0 (sigmoid → 0.5), and a question with no difficulty signal
 * defaults to 0.5 — exactly the prior placeholder behaviour, so the queue can
 * never regress (same item count / shape; SRS slots untouched).
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import {
  isFeatureEnabled,
  PEDAGOGY_V2_FLAGS,
  ADAPTIVE_REMEDIATION_FLAGS,
} from '@alfanumrik/lib/feature-flags';
import {
  composeDailyRhythm,
  type CandidateProblem,
} from '@alfanumrik/lib/learn/daily-rhythm-orchestrator';
import {
  dueReviewsToCards,
  type DueReviewRow,
} from '@alfanumrik/lib/learn/due-reviews-adapter';
import {
  ADAPTIVE_REMEDIATION_RULES,
  compareBySeverity,
  type RemediationCard,
} from '@alfanumrik/lib/learn/remediation-queue-adapter';
import { resolveGoalProfile, type GoalCode } from '@alfanumrik/lib/goals/goal-profile';
import { logger } from '@alfanumrik/lib/logger';
import { cacheFetchAsync, CACHE_TTL, cacheInvalidatePrefixAsync } from '@alfanumrik/lib/cache';

export const dynamic = 'force-dynamic';

interface AdaptiveQuestionRow {
  question_id: string;
  question_type: string | null;
  bloom_level: string | null;
  priority_score: number | null;
  source: string | null;
  board_year: number | null;
  paper_section: string | null;
}

const VALID_BLOOM = new Set([
  'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create',
]);

const FALLBACK_PERSONA: GoalCode = 'pass_comfortably';

/**
 * Map an adaptive_questions `source` field to the orchestrator's three flag
 * dimensions. The classifier is intentionally substring-based so future
 * additions to the source taxonomy don't require this code to change. New
 * source values just default to all-flags-false (intuition_led-eligible).
 */
function classifyFlags(source: string | null): {
  isBoardPattern: boolean;
  isOlympiad: boolean;
  isJeeNeet: boolean;
} {
  const s = (source ?? '').toLowerCase();
  return {
    isBoardPattern: s.includes('pyq') || s.includes('board'),
    isOlympiad: s.includes('olympiad'),
    isJeeNeet: s.includes('jee') || s.includes('neet'),
  };
}

function normalizeBloom(b: string | null): CandidateProblem['bloomLevel'] {
  return (b && VALID_BLOOM.has(b))
    ? (b as CandidateProblem['bloomLevel'])
    : 'understand';
}

/**
 * Default candidate difficulty on the orchestrator's 0..1 axis. sigmoid(0) =
 * 0.5; this is the EXACT value the route previously hardcoded, so any question
 * with no usable difficulty signal degrades gracefully to the old behaviour.
 */
const DEFAULT_DIFFICULTY_0_1 = 0.5;

/**
 * Map a question's raw difficulty signal onto the orchestrator's 0..1
 * `CandidateProblem.difficulty` axis.
 *
 * Primary source: `question_bank.irt_difficulty` — the 2PL `b` parameter on the
 * SAME logit/theta scale as `studentAbility` (DB CHECK bounds it to [-4, 4]).
 * The orchestrator derives its ZPD target as `targetDifficulty = sigmoid(theta)`
 * (daily-rhythm-orchestrator.ts pickZpdItem, line ~159), so we push irt_difficulty
 * through the IDENTICAL sigmoid to land on the same axis — then "closest
 * difficulty to target" is a genuine same-scale ZPD match. (An uncalibrated
 * irt_difficulty of 0.0 → sigmoid(0) = 0.5, the neutral midpoint.)
 *
 * Fallback source: the legacy integer `difficulty` column (1=easy, 2=medium,
 * 3=hard) mapped onto {0.25, 0.5, 0.75}. Final fallback: 0.5 (= prior default).
 */
function mapDifficultyTo01(
  irtDifficulty: number | null | undefined,
  intDifficulty: number | null | undefined,
): number {
  if (typeof irtDifficulty === 'number' && Number.isFinite(irtDifficulty)) {
    return 1 / (1 + Math.exp(-irtDifficulty));
  }
  if (typeof intDifficulty === 'number' && Number.isFinite(intDifficulty)) {
    if (intDifficulty <= 1) return 0.25;
    if (intDifficulty >= 3) return 0.75;
    return 0.5;
  }
  return DEFAULT_DIFFICULTY_0_1;
}

export async function GET(_request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  // Flag gate.
  const flagOn = await isFeatureEnabled(PEDAGOGY_V2_FLAGS.DAILY_RHYTHM, {
    userId,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Phase 5 perf: the daily-rhythm composition below issues ~5 Supabase reads
  // (student row, due reviews, question_bank, curriculum_topics, ZPD pool) and
  // fires on dashboard mount alongside the other per-student aggregate calls.
  // Collapse repeat reads within a 30s window with a SERVER-SIDE cache keyed by
  // userId + day bucket (the reflection prompt + queue rotate daily, so the day
  // belongs in the key). The key includes userId so students NEVER collide
  // (P13: per-student data must never be shared). This is a server cache, NOT a
  // CDN/`s-maxage` header — Vercel's edge does not vary by auth, so a public
  // cache would leak one student's queue to another. This handler has no writes
  // (all reads + read RPCs), so it is safe to cache. The 404 "no profile" path
  // stays OUTSIDE the cache via a sentinel so a transient lookup miss is never
  // pinned.
  const dayKey = Math.floor(Date.now() / 86_400_000);
  let cached: unknown;
  try {
    cached = await cacheFetchAsync<unknown>(
      `rhythm:today:${userId}:${dayKey}`,
      CACHE_TTL.USER,
      async () => {
        const built = await buildRhythmQueue(supabase, userId);
        // A null build (missing profile) is wrapped in a sentinel so the 404
        // branch is reproduced on cache hits without caching a transient miss.
        return built ?? { __noProfile: true };
      },
    );
  } catch (err) {
    // Transient student-lookup failure — surfaced as 500, never cached.
    logger.error('rhythm/today: build failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      userId,
    });
    return NextResponse.json({ error: 'student_lookup_failed' }, { status: 500 });
  }
  if (cached && (cached as { __noProfile?: boolean }).__noProfile) {
    return NextResponse.json({ error: 'no_student_profile' }, { status: 404 });
  }
  return NextResponse.json(cached, {
    headers: { 'Cache-Control': 'private, max-age=0, must-revalidate' },
  });
}

/**
 * Builds the daily-rhythm queue for a student. Returns null when the student
 * row is missing (handler maps to 404). All reads/read-RPCs — no writes — so
 * the result is safe to memoize in the per-student server cache above.
 */
async function buildRhythmQueue(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
): Promise<unknown | null> {
  // Load student row (A1 + A2 audit findings encoded here). students.id is a
  // surrogate uuid distinct from the auth uid — resolve it via auth_user_id
  // (same pattern as /api/dive/state, /api/dive/history, /api/synthesis/state).
  const { data: studentRow, error: studentErr } = await supabase
    .from('students')
    .select('id, grade, academic_goal, preferred_subject')
    .eq('auth_user_id', userId)
    .maybeSingle();

  if (studentErr) {
    logger.error('rhythm/today: students fetch failed', {
      error: new Error(studentErr.message),
      userId,
    });
    throw new Error('student_lookup_failed'); // do NOT cache transient failures
  }
  if (!studentRow) {
    return null;
  }

  const goalProfile = resolveGoalProfile(studentRow.academic_goal);
  const persona: GoalCode = goalProfile?.code ?? FALLBACK_PERSONA;
  const studentGrade: string = String(studentRow.grade ?? '');

  // Pick a subject for the ZPD pool. Prefer the student's preferred subject;
  // fall back to the first active subject if not set.
  let subjectCode: string | null = studentRow.preferred_subject ?? null;
  if (!subjectCode) {
    const { data: subj } = await supabase
      .from('subjects')
      .select('code')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .limit(1)
      .maybeSingle();
    subjectCode = subj?.code ?? null;
  }

  // ── Real student ability (A3) ───────────────────────────────────────────
  // Fetch this student's calibrated IRT theta (logit scale) from
  // student_learning_profiles. The table is keyed (student_id, subject), so we
  // scope to the ZPD subject when one is resolved; otherwise we take any row.
  // The orchestrator maps theta → target difficulty via sigmoid, so theta is
  // exactly the scale it expects. NON-FATAL: any miss/error defaults to 0
  // (sigmoid(0) = 0.5 neutral target = prior hardcoded behaviour).
  let studentAbility = 0;
  try {
    let thetaQuery = supabase
      .from('student_learning_profiles')
      .select('irt_theta')
      .eq('student_id', studentRow.id);
    if (subjectCode) {
      thetaQuery = thetaQuery.eq('subject', subjectCode);
    }
    const { data: profileRow } = await thetaQuery
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const theta = (profileRow as { irt_theta?: number | null } | null)?.irt_theta;
    if (typeof theta === 'number' && Number.isFinite(theta)) {
      studentAbility = theta;
    }
  } catch (err) {
    // Non-fatal: leave studentAbility = 0 (neutral target).
    logger.error('rhythm/today: irt_theta fetch failed', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Load due reviews (A4). RPC returns rows already filtered to due-for-review.
  // concept_mastery.student_id FKs students.id (the surrogate), not the auth
  // uid — pass the resolved studentRow.id, same as /api/dive/state.
  const { data: dueRowsRaw, error: dueErr } = await supabase.rpc('get_due_reviews', {
    p_student_id: studentRow.id,
    p_subject_code: null,
    p_limit: 20,
  });
  if (dueErr) {
    logger.error('rhythm/today: get_due_reviews RPC failed', {
      error: new Error(dueErr.message),
      userId,
    });
  }
  const dueRows: DueReviewRow[] = (dueRowsRaw ?? []).map((r: Record<string, unknown>) => ({
    topic_id: String(r.topic_id ?? ''),
    mastery_probability: typeof r.mastery_probability === 'number' ? r.mastery_probability : null,
    last_attempted_at: typeof r.last_attempted_at === 'string' ? r.last_attempted_at : null,
    review_interval_days: typeof r.review_interval_days === 'number' ? r.review_interval_days : 0,
  }));

  // Build conceptToQuestion map: one active question per due topic.
  const dueTopicIds = dueRows.map((r) => r.topic_id).filter(Boolean);
  const conceptToQuestion = new Map<string, string>();
  if (dueTopicIds.length > 0) {
    const { data: qbRows } = await supabase
      .from('question_bank')
      .select('id, topic_id')
      .in('topic_id', dueTopicIds)
      .eq('is_active', true);
    // First question per topic_id wins (Postgres returns rows in undefined order;
    // for deterministic picks the route can later sort by IRT info, but for v1
    // any active question is sufficient since the SRS slot is about retention,
    // not novelty).
    for (const r of qbRows ?? []) {
      const tid = String((r as { topic_id?: string }).topic_id ?? '');
      if (tid && !conceptToQuestion.has(tid)) {
        conceptToQuestion.set(tid, String((r as { id: string }).id));
      }
    }
  }

  // Compute aheadOfGradeConceptIds: any due topic whose curriculum grade is
  // numerically greater than the student's grade.
  const aheadOfGradeConceptIds = new Set<string>();
  if (dueTopicIds.length > 0 && studentGrade) {
    const studentGradeNum = parseInt(studentGrade, 10);
    if (Number.isFinite(studentGradeNum)) {
      const { data: ctRows } = await supabase
        .from('curriculum_topics')
        .select('id, grade')
        .in('id', dueTopicIds);
      for (const t of ctRows ?? []) {
        const tGradeNum = parseInt(String((t as { grade?: string }).grade ?? ''), 10);
        if (Number.isFinite(tGradeNum) && tGradeNum > studentGradeNum) {
          aheadOfGradeConceptIds.add(String((t as { id: string }).id));
        }
      }
    }
  }

  const dueSm2Cards = dueReviewsToCards({
    rows: dueRows,
    conceptToQuestion,
    aheadOfGradeConceptIds,
  });

  // Load ZPD candidate pool (A5). Subject is required by the RPC; if no
  // subject is resolved, skip the call and let the orchestrator emit a
  // placeholder ZPD item.
  let candidatePool: CandidateProblem[] = [];
  if (subjectCode) {
    // Pass the resolved surrogate students.id, not the auth uid — same
    // dual-key mismatch class as get_due_reviews above.
    const { data: zpdRows, error: zpdErr } = await supabase.rpc('get_adaptive_questions', {
      p_student_id: studentRow.id,
      p_subject: subjectCode,
      p_limit: 50,
      p_include_review: false,
      p_mode: 'cognitive',
    });
    if (zpdErr) {
      logger.error('rhythm/today: get_adaptive_questions RPC failed', {
        error: new Error(zpdErr.message),
        userId,
        subjectCode,
      });
    }
    const adaptiveRows = (zpdRows ?? []) as AdaptiveQuestionRow[];

    // ── Real per-question difficulty (Phase 3) ────────────────────────────
    // The RPC's RETURNS TABLE contract is frozen (7 cols, other callers depend
    // on it), so we do NOT change it. Instead we batch-fetch the difficulty
    // signal for exactly the candidate ids it returned. NON-FATAL: on any
    // error the map stays empty and every candidate falls back to 0.5 (= prior
    // placeholder), so the queue is identical to before.
    const difficultyById = new Map<string, number>();
    const candidateIds = adaptiveRows
      .map((q) => String(q.question_id))
      .filter(Boolean);
    if (candidateIds.length > 0) {
      try {
        const { data: diffRows } = await supabase
          .from('question_bank')
          .select('id, irt_difficulty, difficulty')
          .in('id', candidateIds);
        for (const r of diffRows ?? []) {
          const row = r as {
            id: string;
            irt_difficulty?: number | null;
            difficulty?: number | null;
          };
          difficultyById.set(
            String(row.id),
            mapDifficultyTo01(row.irt_difficulty, row.difficulty),
          );
        }
      } catch (err) {
        logger.error('rhythm/today: question difficulty fetch failed', {
          userId,
          subjectCode,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    candidatePool = adaptiveRows.map((q) => {
      const flags = classifyFlags(q.source);
      const qid = String(q.question_id);
      return {
        questionId: qid,
        difficulty: difficultyById.get(qid) ?? DEFAULT_DIFFICULTY_0_1,
        bloomLevel: normalizeBloom(q.bloom_level),
        topicId: '',     // not surfaced by the RPC; only the orchestrator's
                         // flavor filter uses CandidateProblem.topicId today,
                         // and that filter is currently a no-op against ''.
        isAheadOfGrade: false, // not exposed by RPC; ahead-of-grade enrichment
                               // for ZPD slot is a follow-on (Wave 1C).
        isBoardPattern: flags.isBoardPattern,
        isOlympiad: flags.isOlympiad,
        isJeeNeet: flags.isJeeNeet,
      };
    });
  }

  // Reflection prompt rotates by day-of-year so a student sees a different
  // prompt each day for at least a week before repeating.
  const reflectionPromptIndex = Math.floor(Date.now() / 86_400_000) % 7;

  const queue = composeDailyRhythm({
    persona,
    studentAbility, // Phase 3: real IRT theta (logit scale) from
                    // student_learning_profiles. Defaults to 0 (sigmoid → 0.5
                    // neutral target) when uncalibrated/missing, which is the
                    // prior hardcoded behaviour — so a missing theta can never
                    // regress the queue.
    dueSm2Cards,
    candidateProblemPool: candidatePool,
    reflectionPromptIndex,
  });

  // ── Phase A Loop A — adaptive remediation lane ──────────────────────────
  // Cards are MATERIALIZED AT READ TIME from this student's active
  // adaptive_interventions rows (spec Decision 5 — nothing is stored). The
  // lane sits AFTER the SRS block and BEFORE the ZPD problem (warm-up →
  // targeted repair → stretch). `kind: 'remediation_review'` is disjoint
  // from the existing RhythmItem kinds, so the items union extends without
  // touching the orchestrator and old clients that switch on known kinds are
  // unaffected. Flag OFF (kill switch) ⇒ empty lane, base 7-item queue
  // unchanged. Lane failures are swallowed — remediation is an enhancement,
  // never a reason to 500 the daily queue.
  const remediationCards = await buildRemediationLane(
    supabase,
    studentRow.id,
    userId,
    queue.items.length,
  );
  if (remediationCards.length === 0) {
    return queue;
  }
  const SRS_BLOCK_SIZE = 5;
  return {
    ...queue,
    items: [
      ...queue.items.slice(0, SRS_BLOCK_SIZE),
      ...remediationCards,
      ...queue.items.slice(SRS_BLOCK_SIZE),
    ],
  };
}

// ─── Phase A Loop A lane builder ─────────────────────────────────────────────

interface ActiveInterventionRow {
  id: string;
  subject_code: string;
  chapter_number: number;
  trigger_snapshot: Record<string, unknown> | null;
}

/**
 * Read this student's active adaptive_interventions (RLS-scoped client: the
 * student-SELECT-own policy is the boundary — P8) and compose ≤3 remediation
 * cards under the ratified caps:
 *
 *   lane capacity = min(max_remediation_cards_per_day,
 *                       max_daily_queue_total − base queue size)
 *
 * Severity-ordered: deepest trigger_snapshot.largestDrop first (nulls last),
 * deterministic tie-break by subject then chapter — the same ordering the
 * adapter's bySeverity uses. Returns [] when the flag is off, on any error,
 * or when no active interventions exist.
 */
async function buildRemediationLane(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  studentId: string,
  userId: string,
  baseQueueSize: number,
): Promise<RemediationCard[]> {
  try {
    const flagOn = await isFeatureEnabled(ADAPTIVE_REMEDIATION_FLAGS.V1, {
      userId,
      role: 'student',
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    });
    if (!flagOn) return [];

    const capacity = Math.min(
      ADAPTIVE_REMEDIATION_RULES.max_remediation_cards_per_day,
      ADAPTIVE_REMEDIATION_RULES.max_daily_queue_total - baseQueueSize,
    );
    if (capacity <= 0) return [];

    const { data, error } = await supabase
      .from('adaptive_interventions')
      .select('id, subject_code, chapter_number, trigger_snapshot')
      .eq('student_id', studentId)
      .eq('status', 'active');
    if (error) {
      logger.error('rhythm/today: remediation lane fetch failed', {
        userId, error: error.message,
      });
      return [];
    }
    const rows = (data ?? []) as ActiveInterventionRow[];
    if (rows.length === 0) return [];

    // Severity ordering comes from the adapter's exported comparator (Round 2,
    // assessment cond 4) — the SAME `compareBySeverity` the injection planner
    // uses, so the lane can never drift from the planner's ordering.
    const dropOf = (r: ActiveInterventionRow): number | null => {
      const d = (r.trigger_snapshot ?? {})['largestDrop'];
      return typeof d === 'number' && Number.isFinite(d) ? d : null;
    };
    const ordered = rows
      .map((r) => ({
        row: r,
        rank: {
          subjectCode: r.subject_code,
          chapterNumber: r.chapter_number,
          dropMagnitude: dropOf(r),
        },
      }))
      .sort((a, b) => compareBySeverity(a.rank, b.rank));

    return ordered.slice(0, capacity).map(({ row: r }, i) => ({
      kind: 'remediation_review' as const,
      subjectCode: r.subject_code,
      chapterNumber: r.chapter_number,
      interventionId: r.id,
      priority: i + 1,
    }));
  } catch (err) {
    logger.error('rhythm/today: remediation lane failed', {
      userId, error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * POST /api/rhythm/today
 *
 * Cache-bust endpoint: invalidates this student's rhythm queue from both
 * in-memory L1 and Redis L2. Called by quiz/page.tsx after quiz submission
 * so the next GET /api/rhythm/today returns a fresh queue reflecting the
 * student's updated chapter progress.
 *
 * Auth: same as GET — requires authenticated Supabase session.
 * No body required. Returns { ok: true } on success.
 */
export async function POST(_request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  // Invalidate both L1 and L2 cache for this student's rhythm key.
  // Uses prefix-match so all dayKey variants are busted (handles edge case
  // where POST fires at midnight boundary and GET uses next day's key).
  await cacheInvalidatePrefixAsync(`rhythm:today:${userId}:`);

  return NextResponse.json({ ok: true });
}
