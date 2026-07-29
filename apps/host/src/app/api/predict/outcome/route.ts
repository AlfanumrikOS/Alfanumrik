/**
 * GET /api/predict/outcome — read-only Outcome Prediction Agent (GenAI Phase 5a).
 *
 * Projects a learner's likely CBSE outcome from EXISTING signals by feeding
 * already-read data into the PURE composer `composeOutcomePrediction`
 * (packages/lib/src/predict/outcome-prediction.ts, assessment-owned). This route
 * invents NO prediction math — it only READS sources and hands them to the
 * composer, which fails soft to `insufficient_data` when signals are thin.
 *
 * ── STRICTLY READ-ONLY ───────────────────────────────────────────────────────
 * No writes of any kind. In particular this route NEVER writes
 * `board_score_predictions` / `cme_exam_readiness` (owned by cron/edge) nor any
 * mastery/progression table — every DB call is a `.select(...)`.
 *
 * ── FLAG GATE (default OFF) ──────────────────────────────────────────────────
 * `ff_outcome_prediction_v1` (imported from the flags REGISTRY module, not the
 * barrel). When OFF the endpoint short-circuits with a 404-style disabled
 * response BEFORE touching any data source — a true no-op.
 *
 * ── AUTH + READ PATTERN (architect ruling B1 / the Pulse precedent) ──────────
 * The endpoint serves many audiences (student self, parent, teacher, admin), so
 * — exactly like the sanctioned `/api/pulse/student/[id]` route — it authenticates
 * via `authorizeRequest(request)` (loads roles/permissions + resolves the caller's
 * own studentId), then enforces a viewing-permission gate via `hasAnyPermission`.
 * Hard-requiring a single permission would break the mandated cross-student path.
 *
 *   • SELF path  (caller reads own prediction): all raw-table reads go through the
 *     RLS-scoped server client — RLS already fences to the caller's own student_id
 *     (no IDOR), so no service role is used for self.
 *   • CROSS path (teacher/parent/admin reading another student's ?studentId):
 *     `canAccessStudent(callerId, studentId)` is enforced FIRST (403, no payload);
 *     only then are raw tables read via the service-role client with the resolved
 *     studentId explicitly bound. This is required because `cme_exam_readiness`
 *     (student-self-only RLS) and `board_score_predictions` (no teacher policy)
 *     would otherwise return empty for a legitimate teacher/parent. RLS on those
 *     tables is NEVER widened.
 *
 * The concept-level memory slice is read via `getStudentMemory` (a sanctioned
 * service-role reader whose contract requires upstream authorization — satisfied
 * here for both paths, own-student for self and canAccessStudent for cross).
 *
 * P5: grades are STRINGS. P13: no PII in logs. Fail-soft: any optional sub-read
 * failure passes null/undefined to the composer rather than 500-ing the route.
 */
import { NextRequest } from 'next/server';
import {
  authorizeRequest,
  canAccessStudent,
  hasAnyPermission,
  logAudit,
} from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { v2Success, v2Error } from '@alfanumrik/lib/api/v2/envelope';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { OUTCOME_PREDICTION_FLAGS } from '@alfanumrik/lib/flags/registries/foxy';
import { isValidUUID } from '@alfanumrik/lib/sanitize';
import { buildSingleStudentPulse } from '@alfanumrik/lib/pulse/pulse-server';
import {
  composeOutcomePrediction,
  type OutcomePredictionInputs,
  type BoardScorePredictionRow,
  type CmeExamReadinessRow,
  type MemoryDerivedInputs,
} from '@alfanumrik/lib/predict/outcome-prediction';
import type { ExamChapter } from '@alfanumrik/lib/cognitive-engine';
import type { PulseSignals } from '@alfanumrik/lib/pulse/signals';
import { getStudentMemory } from '@/lib/memory/student-memory';
import type { SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/predict/outcome';

/**
 * Viewing permissions — holding ANY one (with a valid relationship, enforced by
 * the flow below) is required. Mirrors the Pulse route's VIEW_PERMISSIONS.
 */
const VIEW_PERMISSIONS = [
  'progress.view_own', // student (self)
  'child.view_progress', // parent
  'class.view_analytics', // teacher
  'report.view_class', // teacher / coordinator
  'institution.view_analytics', // principal / institution_admin
];

/** Coerce a possibly-string numeric column to a finite number, else null. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract a human chapter label from one `cme_exam_readiness.weakest_chapters`
 * element. Today the `cme-engine` edge function writes a `text[]` of scalar
 * strings (`"Chapter 3"`), but be defensive: the column could drift to a jsonb
 * array of objects (`{chapter, score}` / `{chapter, title}`), so also read the
 * common object keys. Fail-soft: a malformed element yields null (skipped by the
 * caller) and never throws or emits `"[object Object]"`.
 */
function weakestChapterLabel(c: unknown): string | null {
  if (c === null || c === undefined) return null;
  if (typeof c === 'string') {
    const s = c.trim();
    return s.length > 0 ? s : null;
  }
  if (typeof c === 'number') return Number.isFinite(c) ? String(c) : null;
  if (typeof c === 'object') {
    const o = c as Record<string, unknown>;
    const candidate =
      o.chapter ?? o.title ?? o.chapter_title ?? o.chapter_name ?? o.name;
    if (typeof candidate === 'string') {
      const s = candidate.trim();
      return s.length > 0 ? s : null;
    }
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return String(candidate);
    }
    return null;
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    // ── 0. FLAG GATE (default OFF) — short-circuit before any auth/DB work ──
    // Read roles/userId lazily only after we know the flag might be on; the flag
    // check itself needs no context for a globally-disabled flag, so evaluate it
    // first and cheaply.
    const flagEnabled = await isFeatureEnabled(OUTCOME_PREDICTION_FLAGS.V1);
    if (!flagEnabled) {
      // 404-style disabled response — no prediction is ever computed or surfaced.
      return v2Error('Not found', 404, 'NOT_FOUND');
    }

    // ── 1. Authenticate (load roles/perms; resolve caller's own studentId) ──
    const auth = await authorizeRequest(request, undefined, {
      requireStudentId: true,
    });
    if (!auth.authorized) return auth.errorResponse!;
    const callerId = auth.userId!;

    // Re-evaluate the flag WITH role/user context (role/rollout scoping) now that
    // we know who the caller is. Still a no-op when globally OFF (handled above).
    const scopedEnabled = await isFeatureEnabled(OUTCOME_PREDICTION_FLAGS.V1, {
      role: auth.roles[0],
      userId: callerId,
    });
    if (!scopedEnabled) {
      return v2Error('Not found', 404, 'NOT_FOUND');
    }

    // ── 2. Resolve the target student ──
    const { searchParams } = new URL(request.url);
    const requestedId = searchParams.get('studentId');
    if (requestedId && !isValidUUID(requestedId)) {
      return v2Error('Valid studentId is required', 400, 'INVALID_STUDENT_ID');
    }
    const targetStudentId = requestedId ?? auth.studentId;
    if (!targetStudentId) {
      return v2Error('No student profile found for this account', 404, 'NO_STUDENT_PROFILE');
    }

    const isSelf = auth.studentId != null && targetStudentId === auth.studentId;

    // ── 3. Viewing-permission gate (relationship alone is not sufficient) ──
    const canView = await hasAnyPermission(callerId, VIEW_PERMISSIONS);
    if (!canView) {
      logAudit(callerId, {
        action: 'predict.outcome_viewed',
        resourceType: 'students',
        resourceId: targetStudentId,
        status: 'denied',
        details: { reason: 'no_view_permission' },
      });
      return v2Error('You do not have permission to view outcome predictions', 403, 'PERMISSION_DENIED');
    }

    // ── 4. Cross-student HARD boundary FIRST (no payload on deny) ──
    // Choose the read client: RLS-scoped server client for self, service-role for
    // an authorized cross-student read (board/cme have no teacher/parent policy).
    let db: SupabaseClient;
    if (isSelf) {
      db = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    } else {
      const allowed = await canAccessStudent(callerId, targetStudentId);
      if (!allowed) {
        logAudit(callerId, {
          action: 'predict.outcome_viewed',
          resourceType: 'students',
          resourceId: targetStudentId,
          status: 'denied',
          details: { reason: 'no_relationship' },
        });
        return v2Error('Access denied to this student', 403, 'RESOURCE_ACCESS_DENIED');
      }
      db = getSupabaseAdmin();
    }

    // ── 5. Resolve identity keys: enrolled grade (P5 string) + auth_user_id ──
    // Self path reads own row through RLS; cross path binds the explicit id via
    // the service-role client (already gated by canAccessStudent above).
    let grade: string | null = null;
    let targetAuthUserId: string | null = isSelf ? callerId : null;
    try {
      const { data: studentRow } = await db
        .from('students')
        .select('grade, auth_user_id')
        .eq('id', targetStudentId)
        .maybeSingle();
      if (studentRow) {
        grade = (studentRow as { grade?: string | null }).grade ?? null;
        targetAuthUserId =
          (studentRow as { auth_user_id?: string | null }).auth_user_id ?? targetAuthUserId;
      }
    } catch {
      // fall through — grade may still be recovered from the board row below
    }

    // ── 6. Read the precomputed board-score prediction (tier 1) ──
    // Latest row for the student, optionally filtered by the requested subject.
    // Doubles as the subject/grade default source when the query omits `subject`.
    const subjectParam = (searchParams.get('subject') ?? '').trim().toLowerCase() || null;

    let boardRow: Record<string, unknown> | null = null;
    try {
      let q = db
        .from('board_score_predictions')
        .select(
          'subject_code, grade, predicted_pct, confidence_band_low, confidence_band_high, coverage_pct, recovery_plan, max_score, score_date',
        )
        .eq('student_id', targetStudentId)
        .order('score_date', { ascending: false })
        .limit(1);
      if (subjectParam) q = q.eq('subject_code', subjectParam);
      const { data } = await q.maybeSingle();
      boardRow = (data as Record<string, unknown> | null) ?? null;
    } catch {
      boardRow = null; // fail-soft: composer degrades to a lower tier
    }

    // Resolve the effective subject (required by the composer).
    const subject =
      subjectParam ?? (boardRow?.subject_code ? String(boardRow.subject_code) : null);
    if (!subject) {
      // No subject given and none inferable — require it explicitly.
      return v2Error(
        'A subject query parameter is required (no recent prediction to infer one)',
        400,
        'SUBJECT_REQUIRED',
      );
    }

    // Grade: enrolled grade (P5 string) is authoritative; fall back to the board
    // row's grade only if the student row lacked one.
    if (!grade && boardRow?.grade) grade = String(boardRow.grade);
    if (!grade) {
      return v2Error('Could not resolve the student grade', 404, 'NO_GRADE');
    }

    // ── 7. Read the remaining optional sources in parallel (all fail-soft) ──
    const totalBoardMarksFromBoard = num(boardRow?.max_score);

    // 7a. CBSE chapter weights (tier-2 marks distribution) + per-chapter mastery.
    const weightsP = (async () => {
      try {
        const { data } = await db
          .from('cbse_chapter_weights')
          .select('chapter_number, chapter_name, marks_allocated, total_marks')
          .eq('board', 'CBSE')
          .eq('grade', grade!)
          .eq('subject_code', subject)
          .eq('is_active', true);
        return (data as Array<Record<string, unknown>> | null) ?? [];
      } catch {
        return [];
      }
    })();

    // 7b. Per-chapter mastery from learner_mastery (keyed by auth_user_id).
    const masteryP = (async () => {
      if (!targetAuthUserId) return [] as Array<Record<string, unknown>>;
      try {
        const { data } = await db
          .from('learner_mastery')
          .select('chapter_number, mastery')
          .eq('auth_user_id', targetAuthUserId)
          .eq('subject_code', subject);
        return (data as Array<Record<string, unknown>> | null) ?? [];
      } catch {
        return [];
      }
    })();

    // 7c. cme_exam_readiness (tier-2′ point estimate).
    const cmeP = (async () => {
      try {
        const { data } = await db
          .from('cme_exam_readiness')
          .select('overall_score, predicted_marks, weakest_chapters, computed_at')
          .eq('student_id', targetStudentId)
          .order('computed_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        return (data as Record<string, unknown> | null) ?? null;
      } catch {
        return null;
      }
    })();

    // 7d. Concept-level memory slice (weakTopics / knowledgeGaps).
    const memoryP = (async (): Promise<MemoryDerivedInputs | undefined> => {
      try {
        const mem = await getStudentMemory(targetStudentId, { subject, grade: grade! });
        return {
          weakTopics: mem.cognitive.weakTopics.map((t) => ({
            title: t.title,
            mastery: t.mastery,
            attempts: t.attempts,
          })),
          knowledgeGaps: mem.cognitive.knowledgeGaps.map((g) => ({
            target: g.target,
            prerequisite: g.prerequisite,
            gapType: g.gapType,
          })),
        };
      } catch {
        return undefined;
      }
    })();

    // 7e. Pulse at-risk signals (fail-soft to null).
    const pulseP = (async (): Promise<PulseSignals | null> => {
      if (!targetAuthUserId) return null;
      try {
        const pulse = await buildSingleStudentPulse(db, targetAuthUserId);
        return pulse.signals ?? null;
      } catch {
        return null;
      }
    })();

    const [weights, mastery, cmeRow, memory, pulseSignals] = await Promise.all([
      weightsP,
      masteryP,
      cmeP,
      memoryP,
      pulseP,
    ]);

    // ── 8. Assemble the composer inputs ──

    // tier-1 board row → BoardScorePredictionRow (read verbatim).
    let boardScorePrediction: BoardScorePredictionRow | null = null;
    const predictedPct = num(boardRow?.predicted_pct);
    if (boardRow && predictedPct !== null) {
      const recovery = Array.isArray(boardRow.recovery_plan)
        ? (boardRow.recovery_plan as Array<Record<string, unknown>>)
        : [];
      boardScorePrediction = {
        predictedPct,
        confidenceBandLow: num(boardRow.confidence_band_low) ?? predictedPct,
        confidenceBandHigh: num(boardRow.confidence_band_high) ?? predictedPct,
        coveragePct: num(boardRow.coverage_pct) ?? 0,
        recoveryPlan: recovery.map((r) => ({
          chapter:
            (r.chapter_number as string | number | undefined) ??
            (r.chapter_name as string | undefined) ??
            '',
          action: (r.action_label as string | undefined) ?? undefined,
        })),
      };
    }

    // tier-2′ cme row → CmeExamReadinessRow.
    let cmeExamReadiness: CmeExamReadinessRow | null = null;
    const overallScore = num(cmeRow?.overall_score);
    if (cmeRow && overallScore !== null) {
      const weakest = Array.isArray(cmeRow.weakest_chapters)
        ? (cmeRow.weakest_chapters as unknown[])
        : [];
      cmeExamReadiness = {
        overallScore,
        predictedMarks: num(cmeRow.predicted_marks) ?? 0,
        weakestChapters: weakest
          .map((c) => {
            const label = weakestChapterLabel(c);
            return label === null ? null : { chapter: label, title: label };
          })
          .filter(
            (w): w is { chapter: string; title: string } => w !== null,
          ),
      };
    }

    // tier-2 chapters: join cbse_chapter_weights × learner_mastery on chapter_number.
    let chapters: ExamChapter[] | undefined;
    let totalBoardMarks: number | undefined = totalBoardMarksFromBoard ?? undefined;
    if (weights.length > 0) {
      const masteryByChapter = new Map<number, number>();
      for (const m of mastery) {
        const ch = num(m.chapter_number);
        const val = num(m.mastery);
        if (ch !== null && val !== null) masteryByChapter.set(ch, val);
      }
      chapters = weights.map((w) => {
        const chapterNumber = num(w.chapter_number) ?? 0;
        return {
          chapterNumber,
          chapterTitle: String(w.chapter_name ?? `Chapter ${chapterNumber}`),
          marksWeightage: num(w.marks_allocated) ?? 0,
          difficultyWeight: 1, // neutral — predictExamScore does not use this field
          studentMastery: masteryByChapter.get(chapterNumber) ?? 0,
          isCovered: masteryByChapter.has(chapterNumber),
        };
      });
      // Prefer the board row's max_score; else the CBSE weight table's total_marks.
      if (totalBoardMarks === undefined) {
        totalBoardMarks = num(weights[0].total_marks) ?? undefined;
      }
    }

    const inputs: OutcomePredictionInputs = {
      subject,
      grade,
      totalBoardMarks,
      boardScorePrediction,
      cmeExamReadiness,
      chapters,
      memory,
      pulseSignals,
      learningVelocity: null,
    };

    const prediction = composeOutcomePrediction(inputs);

    // Successful view audit (fire-and-forget; metadata only, no PII / P13).
    logAudit(callerId, {
      action: 'predict.outcome_viewed',
      resourceType: 'students',
      resourceId: targetStudentId,
      status: 'success',
      details: { subject, source: prediction.source, self: isSelf },
    });

    return v2Success(
      { schemaVersion: 1 as const, ...prediction },
      { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' } },
    );
  } catch (err) {
    logger.error('predict_outcome_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: ROUTE,
    });
    return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
  }
}
