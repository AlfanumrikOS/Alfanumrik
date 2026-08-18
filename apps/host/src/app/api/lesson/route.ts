/**
 * GET /api/lesson — student-facing Lesson Generation Agent (GenAI Phase 5b, v1).
 *
 * On-demand, NCERT-grounded, bilingual lesson notes for ONE chapter. This route
 * invents NO pedagogy and NO generation — it READS the caller's own grade +
 * learner-memory slice and hands them to the sanctioned grounded orchestrator
 * `generateLessonNotes` (packages/lib/src/lesson/generate-lesson.ts,
 * ai-engineer-owned). The orchestrator decides only HOW to present the chapter
 * and fails soft to an abstain envelope when grounding can't support it.
 *
 * ── STRICTLY READ-ONLY ───────────────────────────────────────────────────────
 * No writes of any kind. In particular this route NEVER writes any mastery /
 * progression table — every DB call is a `.select(...)`. The only ledger touched
 * is `audit_logs` (metadata-only view audit, P13). This is a LIVE registry agent
 * scanned by the registry conformance invariant (writes none of the 9 forbidden
 * mastery tables).
 *
 * ── FLAG GATE (default OFF) ──────────────────────────────────────────────────
 * `ff_lesson_generation_v1` (imported from the flags REGISTRY module, not the
 * barrel). When OFF the endpoint short-circuits with a 404-style disabled
 * response BEFORE touching any data source — a true no-op.
 *
 * ── AUTH + SCOPE (v1 = STUDENT-SELF ONLY) ────────────────────────────────────
 * `authorizeRequest(request, 'progress.view_own', { requireStudentId: true })`.
 * The route serves ONLY the caller's OWN lesson (`auth.studentId`); it does NOT
 * accept a `?studentId` for another learner. There is therefore NO cross-student
 * path, NO `canAccessStudent`, and NO service-role/admin client here — every read
 * flows through the RLS-scoped server client (fenced to the caller's own row) or
 * `getStudentMemory` called with the caller's OWN id. This keeps the route off
 * the admin-client allowlist / cross-tenant ledgers.
 *
 * P5: grades are STRINGS. P7: bilingual output (generator emits EN + Hindi per
 * section + bilingual abstain copy). P13: no PII in logs — audit metadata only.
 * Fail-soft: a learner-memory sub-read failure passes NEUTRAL memory to the
 * generator (which abstains if it must) rather than 500-ing the route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@alfanumrik/lib/rbac';
import { createSupabaseRouteClient } from '@alfanumrik/lib/supabase-route';
import { logger } from '@alfanumrik/lib/logger';
import { v2Success, v2Error } from '@alfanumrik/lib/api/v2/envelope';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { LESSON_GENERATION_FLAGS } from '@alfanumrik/lib/flags/registries/foxy';
import { BLOOM_ORDER, type BloomLevel } from '@alfanumrik/lib/cognitive-engine';
import { generateLessonNotes } from '@alfanumrik/lib/lesson/generate-lesson';
import type {
  LessonRequest,
  LessonMemoryInput,
  LessonDepth,
  LessonLanguage,
} from '@alfanumrik/lib/lesson/types';
import { getStudentMemory, type StudentMemory } from '@/lib/memory/student-memory';
import { withRoute } from '@alfanumrik/lib/api/v2/with-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/lesson';

const VALID_DEPTHS: ReadonlySet<LessonDepth> = new Set<LessonDepth>([
  'brief',
  'standard',
  'deep',
]);
const VALID_LANGUAGES: ReadonlySet<LessonLanguage> = new Set<LessonLanguage>([
  'en',
  'hi',
]);

/**
 * Neutral planner input used when the learner-memory read fails or is empty.
 * `masteryLevel: 'medium'` mirrors EMPTY_COGNITIVE_CONTEXT.masteryLevel — this is
 * the documented empty default, not a new threshold. With empty signal arrays the
 * generator still produces a grounded (unpersonalized) lesson, or abstains.
 */
const NEUTRAL_MEMORY_INPUT: LessonMemoryInput = {
  masteryLevel: 'medium',
  recentMisconceptions: [],
  weakTopics: [],
  knowledgeGaps: [],
  preferences: { learningStyle: null, preferredExplanationDepth: null },
};

function isBloomLevel(value: string): value is BloomLevel {
  return Object.prototype.hasOwnProperty.call(BLOOM_ORDER, value);
}

/**
 * Adapt the app-layer unified `StudentMemory` → the narrow `LessonMemoryInput`
 * the planner reads (the pass-through projection documented in lesson/types.ts).
 * No re-derivation of mastery — every field is copied verbatim from an existing
 * reader slice.
 */
function toLessonMemoryInput(memory: StudentMemory): LessonMemoryInput {
  return {
    masteryLevel: memory.cognitive.masteryLevel,
    recentMisconceptions: memory.cognitive.recentMisconceptions.map((m) => ({
      code: m.code,
      label: m.label,
      count: m.count,
      remediationText: m.remediationText,
    })),
    weakTopics: memory.cognitive.weakTopics.map((t) => ({
      title: t.title,
      mastery: t.mastery,
      attempts: t.attempts,
    })),
    knowledgeGaps: memory.cognitive.knowledgeGaps.map((g) => ({
      target: g.target,
      prerequisite: g.prerequisite,
      gapType: g.gapType,
    })),
    preferences: {
      learningStyle: memory.preferences.learningStyle,
      preferredExplanationDepth: memory.preferences.preferredExplanationDepth,
    },
  };
}

export const GET = withRoute(async (request: NextRequest) => {
  try {
    // ── 0. FLAG GATE (default OFF) — short-circuit before any auth/DB work ──
    const flagEnabled = await isFeatureEnabled(LESSON_GENERATION_FLAGS.V1);
    if (!flagEnabled) {
      // 404-style disabled response — no lesson is ever generated or surfaced.
      return v2Error('Not found', 404, 'NOT_FOUND');
    }

    // ── 1. Authenticate + authorize (student-self read; resolve own studentId) ──
    const auth = await authorizeRequest(request, 'progress.view_own', {
      requireStudentId: true,
    });
    if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;
    const callerId = auth.userId!;
    const studentId = auth.studentId;
    if (!studentId) {
      return v2Error('No student profile found for this account', 404, 'NO_STUDENT_PROFILE');
    }

    // Re-evaluate the flag WITH role/user context (role/rollout scoping) now that
    // we know who the caller is. Still a no-op when globally OFF (handled above).
    const scopedEnabled = await isFeatureEnabled(LESSON_GENERATION_FLAGS.V1, {
      role: auth.roles[0],
      userId: callerId,
    });
    if (!scopedEnabled) {
      return v2Error('Not found', 404, 'NOT_FOUND');
    }

    // ── 2. Parse + validate the WHAT (subject + chapter) and presentation hints ──
    const { searchParams } = new URL(request.url);

    const subject = (searchParams.get('subject') ?? '').trim().toLowerCase();
    if (!subject) {
      return v2Error('A subject query parameter is required', 400, 'SUBJECT_REQUIRED');
    }

    const chapterNumberRaw = (searchParams.get('chapterNumber') ?? '').trim();
    const chapterNumber = Number.parseInt(chapterNumberRaw, 10);
    if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) {
      return v2Error(
        'A positive integer chapterNumber query parameter is required',
        400,
        'CHAPTER_NUMBER_REQUIRED',
      );
    }

    const chapterTitle = (searchParams.get('chapterTitle') ?? '').trim();
    if (!chapterTitle) {
      return v2Error('A chapterTitle query parameter is required', 400, 'CHAPTER_TITLE_REQUIRED');
    }

    // Optional depth hint — reject a clearly-invalid enum, else pass through.
    let depth: LessonDepth | undefined;
    const depthRaw = searchParams.get('depth');
    if (depthRaw !== null && depthRaw !== '') {
      if (!VALID_DEPTHS.has(depthRaw as LessonDepth)) {
        return v2Error('depth must be one of: brief, standard, deep', 400, 'INVALID_DEPTH');
      }
      depth = depthRaw as LessonDepth;
    }

    // Optional targetBloom anchor — reject a clearly-invalid enum, else pass through.
    let targetBloom: BloomLevel | undefined;
    const bloomRaw = searchParams.get('targetBloom');
    if (bloomRaw !== null && bloomRaw !== '') {
      if (!isBloomLevel(bloomRaw)) {
        return v2Error('targetBloom is not a valid Bloom level', 400, 'INVALID_TARGET_BLOOM');
      }
      targetBloom = bloomRaw;
    }

    // Optional language — default 'en'; both languages are always populated (P7).
    const languageRaw = (searchParams.get('language') ?? 'en').trim().toLowerCase();
    if (!VALID_LANGUAGES.has(languageRaw as LessonLanguage)) {
      return v2Error('language must be one of: en, hi', 400, 'INVALID_LANGUAGE');
    }
    const language = languageRaw as LessonLanguage;

    // ── 3. Resolve the caller's OWN enrolled grade (P5 STRING) via RLS ──
    // The RLS-scoped route client fences this SELECT to the caller's own student
    // row, so no service role is needed for a self-only read. Bearer-AWARE: the
    // cookie-only createSupabaseServerClient() NULLed auth.uid() for
    // `Authorization: Bearer` callers (the entire Flutter app), so this SELECT
    // was RLS-denied, grade stayed null, and every mobile request 404'd NO_GRADE
    // even though the student's row was fine. Never service-role.
    let grade: string | null = null;
    try {
      const db = await createSupabaseRouteClient(request);
      const { data: studentRow } = await db
        .from('students')
        .select('grade')
        .eq('id', studentId)
        .maybeSingle();
      grade = (studentRow as { grade?: string | null } | null)?.grade ?? null;
    } catch {
      // fall through — a missing grade is a 404, never a 500.
    }
    if (!grade) {
      return v2Error('Could not resolve your enrolled grade', 404, 'NO_GRADE');
    }

    // ── 4. Read the caller's OWN learner-memory slice (self — RLS-safe) ──
    // getStudentMemory is itself fail-soft; wrap defensively and degrade to a
    // NEUTRAL memory input on any failure (the generator then abstains if it
    // cannot ground the chapter). Never 500 on a missing optional source.
    let memoryInput: LessonMemoryInput = NEUTRAL_MEMORY_INPUT;
    try {
      const memory = await getStudentMemory(studentId, {
        subject,
        grade,
        chapter: chapterTitle,
      });
      memoryInput = toLessonMemoryInput(memory);
    } catch {
      memoryInput = NEUTRAL_MEMORY_INPUT;
    }

    // ── 5. Build the LessonRequest and generate (grounded, never throws) ──
    const lessonRequest: LessonRequest = {
      studentId,
      subject,
      grade,
      chapter: { chapterNumber, chapterTitle },
      artifactType: 'lesson_notes',
      ...(targetBloom ? { targetBloom } : {}),
      ...(depth ? { depth } : {}),
      language,
    };

    const notes = await generateLessonNotes(lessonRequest, memoryInput);

    // Metadata-only view audit (fire-and-forget; no PII / P13). An abstain is a
    // normal 200, so both outcomes are audited identically.
    logAudit(callerId, {
      action: 'lesson.generated',
      resourceType: 'students',
      resourceId: studentId,
      status: 'success',
      details: { subject, chapterNumber, abstained: notes.abstained },
    });

    // Lesson notes are per-student personalized + freshly generated — do not
    // allow shared/stale caching (mirrors the generator's cache_scope:'none').
    return v2Success(
      { schemaVersion: 1 as const, ...notes },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    logger.error('lesson_generation_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: ROUTE,
    });
    return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
  }
});
