/**
 * /api/foxy — Foxy AI Tutor Chat Endpoint
 *
 * Responsibilities that STAY in this route:
 *  1. RBAC auth guard (foxy.chat permission)
 *  2. Subject governance (validateSubjectWrite)
 *  3. Daily quota enforcement (atomic RPC + refund on upstream failures)
 *  4. Session continuity (foxy_sessions table)
 *  5. Cognitive context loading (CME tables) — not an AI concern
 *  6. Multi-turn history load (foxy_chat_messages)
 *  7. Persist turn to foxy_chat_messages + cognitive action logging
 *  8. Audit log
 *  9. Upgrade prompt computation
 *
 * Responsibilities that moved to supabase/functions/grounded-answer/ (Phase 2):
 *  - Voyage embedding generation
 *  - match_rag_chunks_ncert RPC
 *  - Claude call with model fallback
 *  - System prompt template resolution (foxy_tutor_v1)
 *  - Circuit breaker / cache / timeouts for Voyage+Claude
 *
 * This route shells out to that service via callGroundedAnswer(). The inline
 * legacy flow is preserved behind `ff_grounded_ai_foxy` as a kill switch for
 * the Phase 3 rollout window.
 *
 * POST /api/foxy
 * Body: { message, subject, grade, chapter?, board?, sessionId?, mode? }
 * Response (success):
 *   { success, response, sessionId, quotaRemaining, tokensUsed,
 *     confidence?, groundingStatus, traceId, upgradePrompt?,
 *     structured? }
 *   NOTE (Phase 0): NCERT `sources` and `diagrams` are intentionally NOT
 *   exposed on the wire. Retrieval still happens server-side, citations
 *   are injected into the system prompt, and `sources` is still persisted
 *   to foxy_chat_messages.sources for analytics/debug — but never echoed
 *   to the client.
 *
 *   `structured` (FoxyResponse, see src/lib/foxy/schema.ts) is the new
 *   block-shape rendering of the answer. Present ONLY when the upstream
 *   grounded-answer service returned a valid structured payload AND it
 *   passed defense-in-depth validation at this API boundary. If absent
 *   (legacy fallback path, kill-switch path, malformed upstream payload,
 *   or upstream that hasn't shipped structured yet) the client falls
 *   back to the legacy `response` string. The `response` (denormalized
 *   text) is ALWAYS populated so old clients keep working.
 * Response (abstain / hard-abstain):
 *   { success: true, response: '', groundingStatus: 'hard-abstain',
 *     abstainReason, suggestedAlternatives, traceId }
 *
 * GET /api/foxy?sessionId=<uuid>
 * Response:
 *   { success: true, session, messages: Array<{
 *       id, role, content, structured, tokens_used, created_at }> }
 *   `structured` (FoxyResponse|null) is the persisted block-shape rendering
 *   for assistant rows. NULL for user rows (DB CHECK constraint) and for
 *   legacy assistant rows persisted before the structured-output migration;
 *   the chat page falls back to `content` in that case.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import {
  logLearningEvent,
  logSystemMetric,
  generateCorrelationId,
  generateSessionId,
} from '@alfanumrik/lib/monitoring/log-event';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { validateSubjectWrite } from '@alfanumrik/lib/subjects';
import {
  EMPTY_LONG_MEMORY,
  type LongMemorySnapshot,
  buildLongMemoryPromptSection,
  loadLongMemorySnapshot,
} from '@alfanumrik/lib/learn/foxy-long-memory';
import { callGroundedAnswer, type GroundedRequest, type Citation, type SuggestedAlternative } from '@alfanumrik/lib/ai/grounded-client';
import { PER_PLAN_TIMEOUT_MS, SOFT_CONFIDENCE_BANNER_THRESHOLD } from '@alfanumrik/lib/grounding-config';
import { QUIZ_PATTERNS, classifyMathSolve } from '@alfanumrik/lib/ai/workflows/foxy-router';
import {
  runMathSolvePipeline,
} from '@alfanumrik/lib/ai/math/solve-pipeline';
import { isMathPipelineEnabled, isCurriculumGuardEnabled } from '@alfanumrik/lib/foxy/math-flag';
import {
  validateCurriculumScope,
} from '@alfanumrik/lib/foxy/curriculum-scope';
import { buildTenantOverrideSection } from '@alfanumrik/lib/ai/prompts/tenant-overrides';
import { type FoxyResponse } from '@alfanumrik/lib/foxy/schema';
import { denormalizeFoxyResponse } from '@alfanumrik/lib/foxy/denormalize';
import { stripFakeQuizClaim } from '@alfanumrik/lib/foxy/anti-fake-quiz-claim';
import {
  gateQuizMeMcq,
  findSingleMcqBlock,
  gatePracticeMcqs,
  buildGatedPracticeResponse,
} from '@alfanumrik/lib/foxy/quiz-me-oracle-gate';
import { resolveFoxyEnrollmentScope } from '@alfanumrik/lib/foxy-scope';
import {
  resolveLeadConceptId,
  serveEvidentialItem,
  payloadFromMcqBlock,
} from '@alfanumrik/lib/foxy/evidential-quiz';
import { parseFoxyChapterNumber } from '@alfanumrik/lib/foxy/chapter-parser';
// NOTE: this helper (and the other pure helpers below) used to be re-exported
// from this route file for test modules. Next.js 16 forbids non-handler exports
// from a route.ts, so the public test/helper surface now lives in
// ./_lib/test-surface.ts. chapter-parser.ts remains the single source of truth;
// this route imports it only for its own internal use below.
import { detectStruggleSignal } from '@alfanumrik/lib/foxy/struggle-detection';
// Foxy Perception (Phase 1C, 2026-07-15) — per-turn "sensor". Flag-gated by
// ff_foxy_perception_v1 (default OFF) AND dark when PYTHON_AI_BASE_URL is unset.
// classifyTurn is a PURE orchestrator around the Python MOL /v1/classify call;
// it returns null on ANY failure so the Foxy turn is never affected. The route
// fires it forget-and-forget in the post-response phase and publishes the
// resulting learner.turn_classified observability event (codes/ids/enums only).
import { classifyTurn } from '@alfanumrik/lib/foxy/perception';
import type { LlmGrader } from '@alfanumrik/lib/ai/validation/quiz-oracle';
import { parseLlmGraderResponse } from '@alfanumrik/lib/ai/validation/quiz-oracle';
import {
  QUIZ_ORACLE_GRADER_SYSTEM_PROMPT,
  buildQuizOracleGraderUserPrompt,
} from '@alfanumrik/lib/ai/validation/quiz-oracle-prompts';
// FOX-1 (P12): deterministic output content backstop on the LIVE grounded path.
import { screenStudentFacingText } from '@alfanumrik/lib/ai/validation/output-screen';
// Phase 0.2 (ff_foxy_answer_continuation_v1): clean, self-screening bilingual
// safe-abstain string reused to resolve a pre-inserted pending assistant row
// when the output-safety backstop hard-abstains (so it is never orphaned as an
// empty pending row that could later leak into cross-session prompt assembly).
import { SAFE_ABSTAIN_MESSAGE } from '@alfanumrik/lib/ai/validation/output-guard';
// FOX-2 (P12): student-message prompt-injection neutralizer (input-side).
import { neutralizeInjectionAttempt } from '@alfanumrik/lib/ai/validation/input-guard';
import { callClaude } from '@alfanumrik/lib/ai';
import { buildExpandedGoalSection } from '@alfanumrik/lib/goals/goal-personas';
import { fetchRecentLabContext, type LabContextEntry } from '@alfanumrik/lib/foxy/recent-lab-context';
import { buildLabContextSection } from '@alfanumrik/lib/foxy/foxy-lab-prompt';
import { maybeBuildFoxyContextBlock } from '@alfanumrik/lib/state/context/foxy-context-bridge';
import { randomUUID } from 'node:crypto';
import { publishEvent } from '@alfanumrik/lib/state/events/publish';
// Phase 3 of Foxy conversation continuity (2026-05-18) — "the moat".
// Server-side state for "Foxy asked X, expect answer to X". Flag-gated by
// ff_foxy_pending_expectations_v1 (default OFF); helpers are pure imports
// so OFF stays byte-identical to legacy.
import {
  extractExpectation,
  writeExpectation,
  loadOpenExpectation,
  markExpectationAnswered,
  markExpectationAbandoned,
  buildExpectationPromptSection,
  type OpenExpectation,
  type StructuredAssistantPayload,
} from '@alfanumrik/lib/learn/foxy-expectations';
// Digital Twin + Knowledge Graph (Slice 1). Flag-gated by ff_digital_twin_v1
// (default OFF); helpers are pure imports so OFF stays byte-identical to legacy.
// renderTwinPromptSection stays here (the prompt-injection call site lives in
// this route); buildTwinContext + the Twin*Input/TwinContext types moved with
// loadTwinContextForFoxy into ./_lib/cognitive-context (H1 REFACTOR M5).
import { renderTwinPromptSection } from '@alfanumrik/lib/learn/build-twin-context';
// H1 REFACTOR M1 — pure constants/types/helpers extracted to a co-located
// module. Imported and used identically here; zero behavior change.
import {
  VALID_GRADES,
  VALID_MODES,
  VALID_COACH_MODES,
  type CoachMode,
  FoxyRequestBodySchema,
  REFUND_ABSTAIN_REASONS,
  LEGACY_FALLBACK_ABSTAIN_REASONS,
  UNLIMITED_QUOTA,
  UPGRADE_PROMPTS,
  type RagSource,
  type DiagramRef,
  type ChatMessage,
  type CognitiveContext,
  EMPTY_COGNITIVE_CONTEXT,
  errorJson,
  mapFoxyModeToEventMode,
} from './_lib/constants';
// (These symbols are re-exported for tests/external callers from
// ./_lib/test-surface.ts — not from this route file. See the note at the
// chapter-parser import above.)
// H1 REFACTOR M3 — quota + tenant-AI-override helpers extracted to a
// co-located module. Imported and used identically here at the same call
// sites; zero behavior change. (Service-role Supabase I/O + the
// check_and_record_usage RPC live there now.)
import {
  checkAndIncrementQuota,
  refundQuota,
  resolveTenantAiOverrides,
} from './_lib/quota';
// H1 REFACTOR M4 — session + history helpers extracted to a co-located
// module. Imported and used identically here at the same call sites; zero
// behavior change. (Service-role Supabase I/O on foxy_sessions /
// foxy_chat_messages + the ai.foxy_session_started publish live there now.)
import {
  resolveSession,
  loadHistory,
  loadPriorSessionContext,
  buildPriorSessionPromptSection,
  type PriorSessionTurn,
} from './_lib/session';
// (resolveSession is re-exported for tests from ./_lib/test-surface.ts — not
// from this route file. See the note at the chapter-parser import above.)
// H1 REFACTOR M5 — cognitive-context + learner-state loaders extracted to a
// co-located module. Imported and used identically here at the same call
// sites; zero behavior change. (Service-role Supabase I/O on the CME tables,
// the digital-twin snapshot/memory tables, and the chapter topic-progression
// tables live there now, along with the prior-expectation lifecycle
// classifier.) Shared types/values (CognitiveContext, EMPTY_COGNITIVE_CONTEXT)
// remain in ./constants; the twin builder/types in @alfanumrik/lib/learn/build-twin-context.
import {
  classifyExpectationLifecycle,
  loadCognitiveContext,
  loadTwinContextForFoxy,
  loadChapterTopicProgress,
  buildTopicProgressSection,
  EMPTY_TOPIC_PROGRESS,
  type ChapterTopicProgress,
} from './_lib/cognitive-context';
// H1 REFACTOR M6a — legacy Foxy flow (the ff_grounded_ai_foxy-OFF kill-switch
// path + the grounded-service abstain fallback) extracted to a co-located
// module. Imported and called identically here at the same two call sites;
// zero behavior change. (The legacy-AI call via classifyIntent + routeIntent,
// the response shape, and the foxy_chat_messages persistence live there now;
// the quota-refund-on-failure logic stays at the call sites below.)
import {
  runLegacyFoxyFlow,
  persistLegacyFoxyResponse,
} from './_lib/legacy-flow';
// H1 REFACTOR M6b — P12-critical terminal responders extracted to a co-located
// module. Imported and called identically here at the same call sites; zero
// behavior change. (The structured-output defense-in-depth validation, the
// math-solve terminal response + persistence, and the fail-closed
// curriculum-out-of-scope bilingual reply live there now. No symbol is imported
// by a test from the route's public surface, so no re-export is needed.)
import {
  extractValidatedStructured,
  persistMathTurnAndRespond,
  respondCurriculumOutOfScope,
} from './_lib/responders';
// H1 REFACTOR M6c — the SSE streaming turn handler extracted to a co-located
// module. Imported and called identically here at the same call site (the
// handleFoxyPost streaming branch); zero behavior change. The single
// callGroundedAnswerStream retrieval (REG-50) + the refund-on-error quota
// coupling + the structured-validation-on-stream-complete are byte-identical
// to the originals. extractValidatedStructured / refundQuota /
// REFUND_ABSTAIN_REASONS / classifyExpectationLifecycle are imported there from
// their _lib homes — not duplicated. No symbol is imported by a test from the
// route's public surface, so no re-export is needed.
import { handleStreamingFoxyTurn } from './_lib/streaming';
// Phase 2.1 (ff_foxy_teaching_director_v1, default OFF) — Teaching Director
// wiring. Thin adapter around the PURE, assessment-owned composeTeachingPlan.
// When the flag is OFF none of these run and the turn is byte-identical to
// today. Helpers only ADD a directive string + two envelope fields; they never
// touch the RAG / grounding / abstain / structured-validation path.
import {
  isTeachingTurn,
  loadLessonStepState,
  maybeComposeTeachingPlan,
  buildTeachingDirectorSection,
  persistLessonProgress,
  type TeachingPlan,
} from './_lib/teaching-director';

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_MESSAGE_LENGTH = 1000;
const RAG_MATCH_COUNT = 5;
// MAX_HISTORY_TURNS + SESSION_IDLE_MINUTES moved to ./_lib/session (H1
// REFACTOR M4) alongside the session/history helpers that are their only
// consumers.

// ─── extractValidatedStructured (structured-output defense-in-depth
//     validation/extraction, P12) moved to ./_lib/responders (H1 REFACTOR
//     M6b). Imported above; called identically at the same call sites. ────────

// ─── Session + history helpers (resolveSession, loadHistory,
//     loadPriorSessionContext, buildPriorSessionPromptSection) moved to
//     ./_lib/session (H1 REFACTOR M4). Imported above; resolveSession is
//     re-exported there for its two test modules. ────────────────────────────

// ─── Cognitive-context + learner-state loaders (classifyExpectationLifecycle,
//     loadCognitiveContext, loadTwinContextForFoxy, loadChapterTopicProgress,
//     buildTopicProgressSection) moved to ./_lib/cognitive-context (H1
//     REFACTOR M5). Imported above; the learner-state query shapes +
//     CognitiveContext assembly are byte-identical to the originals. ─────────

// ─── persistMathTurnAndRespond (math-solve terminal response + persistence;
//     0 XP / no mastery by construction) and respondCurriculumOutOfScope (the
//     P12 fail-closed, P7 bilingual out-of-scope reply) moved to
//     ./_lib/responders (H1 REFACTOR M6b). Imported above; called identically
//     at the same call sites. The math-pipeline verdict→display mapping
//     orchestrator (runMathSolvePipeline) + ASSESSMENT BINDING CONTRACT remain
//     documented in @alfanumrik/lib/ai/math/solve-pipeline. ───────────────────────────

// H1 REFACTOR M2 — pure prompt-builder sections extracted to a co-located AI
// module (src/lib/foxy/prompt-sections.ts). Imported and used identically here;
// zero behavior change. That module is the single source of truth for the Foxy
// system-prompt assembly (FOXY_SAFETY_RAILS + buildSystemPrompt, P12).
// fetchCoachFeedbackSignal stays in this route (it does DB I/O) and consumes the
// shared CoachFeedbackSignal type + NO_FEEDBACK_SIGNAL imported below.
import {
  buildCognitivePromptSection,
  selectLeadConcept,
  buildLeadConceptDirective,
  buildAcademicGoalSection,
  buildMisconceptionPromptSection,
  resolveCoachMode,
  NO_FEEDBACK_SIGNAL,
  MODE_DIRECTIVES,
  MODE_MAX_TOKENS,
  VALID_COACH_DIRECTIVES,
  COACH_DIRECTIVE_SECTIONS,
  SINGLE_MCQ_DIRECTIVE,
  PRACTICE_MCQ_DIRECTIVE,
  PRACTICE_MCQ_COUNT,
  TEACH_THEN_STOP_DIRECTIVE,
  composeModeDirective,
  buildQuizMeLlmGrader,
  buildQuizMeFallbackResponse,
  isBareOpen,
  FOXY_SAFETY_RAILS,
  buildSystemPrompt,
  type CoachDirective,
  type CoachFeedbackSignal,
} from '@alfanumrik/lib/foxy/prompt-sections';
// (These prompt-builder helpers are re-exported for tests/external callers from
// ./_lib/test-surface.ts — not from this route file. prompt-sections.ts remains
// the single source of truth; this route imports them only for internal use.)


// B'-5 Phase 2: read the last 5 feedback rows for this student joined to
// the source message's `coach_mode_used`, walk them most-recent-first, and
// count the consecutive socratic-mode 👎 streak. The streak breaks at the
// first 👍, the first non-socratic mode, or a missing message row.
//
// Two queries instead of an embedded select to keep the typing simple and
// avoid relying on the FK relationship being auto-detected by supabase-js.
// Errors return the zero signal so this read can NEVER block a chat turn.
async function fetchCoachFeedbackSignal(studentId: string): Promise<CoachFeedbackSignal> {
  try {
    const { data: fbRows, error: fbErr } = await supabaseAdmin
      .from('foxy_message_feedback')
      .select('message_id, is_up, created_at')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false })
      .limit(5);
    if (fbErr || !fbRows || fbRows.length === 0) return NO_FEEDBACK_SIGNAL;

    const messageIds = fbRows.map((r) => r.message_id as string);
    const { data: msgRows, error: msgErr } = await supabaseAdmin
      .from('foxy_chat_messages')
      .select('id, coach_mode_used')
      .in('id', messageIds);
    if (msgErr || !msgRows) return NO_FEEDBACK_SIGNAL;

    const modeById = new Map<string, string | null>(
      msgRows.map((m) => [m.id as string, (m.coach_mode_used as string | null) ?? null]),
    );

    let streak = 0;
    for (const fb of fbRows) {
      const mode = modeById.get(fb.message_id as string) ?? null;
      if (mode === 'socratic' && fb.is_up === false) {
        streak += 1;
      } else {
        break;
      }
    }
    return { recentSocraticThumbsDownStreak: streak };
  } catch {
    return NO_FEEDBACK_SIGNAL;
  }
}

const COACH_MODE_INSTRUCTIONS: Record<CoachMode, string> = {
  answer:
    "Student appears confident. Answer the question concisely (3-5 sentences max) and end with ONE stretch question that is one Bloom's level higher than the original.",
  socratic:
    "Use Socratic scaffolding. Break the answer into 2-3 guided sub-questions, ask the student to attempt each, and only give the full explanation if they remain stuck after two scaffolds.",
  review:
    "Treat this as a quick recall check. Ask the student to state the key idea in their own words first; only confirm or correct after they answer.",
};


// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  // TOP-LEVEL SAFETY NET — no unhandled exception can crash Foxy.
  try {
    return await handleFoxyPost(request);
  } catch (topLevelErr) {
    const diagMsg = topLevelErr instanceof Error ? topLevelErr.message : String(topLevelErr);
    console.error('[FOXY CRITICAL] Unhandled exception in POST handler:', diagMsg);
    try {
      const { logOpsEvent } = await import('@alfanumrik/lib/ops-events');
      await logOpsEvent({
        category: 'ai',
        source: 'foxy-route',
        severity: 'critical',
        message: `Foxy unhandled crash: ${diagMsg.slice(0, 200)}`,
        context: { stack: topLevelErr instanceof Error ? topLevelErr.stack?.slice(0, 500) : undefined },
      });
    } catch { /* even ops logging failed — nothing more we can do */ }
    // Fire-and-forget error-rate signal. Only the genuine top-level exception
    // path emits this — expected business early-returns (429 quota,
    // 403/422 grade/subject denials) are NOT errors and never reach here.
    // P13: error_code only, no PII.
    void logSystemMetric({
      metric_name: 'error_rate',
      route: '/api/foxy',
      value: 1,
      tags: { error_code: (topLevelErr as { code?: string })?.code ?? 'unknown' },
    });
    return errorJson(
      'Foxy encountered an error. Please try again.',
      'Foxy mein error aaya. Dobara try karein.',
      503,
      { _diag: diagMsg.slice(0, 300) },
    );
  }
}

/**
 * RCA-FIX RC-1 (2026-06-26): Select the mode-specific Foxy prompt template.
 *
 * foxy_tutor_v1 contained THREE conflicting output-format sections
 * (Step Cards, CBSE board evaluator, structured JSON). Claude randomly
 * chose one per response — the #1 cause of inconsistent Foxy answers.
 *
 * Each new template has exactly ONE format section:
 *   learn / explain  → foxy_tutor_teach_v1  (Socratic Step Cards only)
 *   practice         → foxy_tutor_exam_v1   (CBSE marks-based format only)
 *   doubt / homework → foxy_tutor_doubt_v1  (direct Q&A only)
 *   default          → foxy_tutor_teach_v1  (safest default for unlisted modes)
 *
 * The legacy foxy_tutor_v1 is preserved as a registered fallback for any
 * caller that specifies it explicitly (e.g., non-Foxy grounded-answer callers).
 */
function selectFoxyPromptTemplate(mode: string): string {
  if (mode === 'practice') return 'foxy_tutor_exam_v1';
  if (mode === 'doubt' || mode === 'homework') return 'foxy_tutor_doubt_v1';
  return 'foxy_tutor_teach_v1';
}

async function handleFoxyPost(request: NextRequest): Promise<Response> {
  // 1. Auth
  const auth = await authorizeRequest(request, 'foxy.chat', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse!;

  // Fire-and-forget observability (additive, non-blocking). `startTime` and
  // `correlationId` are captured here so every terminal success/error path
  // below can emit latency + correlated events. These never affect the hot
  // path — the loggers are internally try/caught and `void`ed at each return.
  const startTime = Date.now();
  const correlationId = generateCorrelationId();

  // Capture the caller's bearer JWT (if any) for the math-verify hop. The
  // SymPy verifier endpoint authenticates as the STUDENT (it calls Supabase
  // Auth /auth/v1/user). When the client uses cookie auth (no Bearer header)
  // the token is null — the math-verify client then fail-softs to
  // is_correct=null (show without escalation), which is the correct
  // "unavailable != wrong" posture. This is read-only and additive.
  const callerBearerToken: string | null = (() => {
    const h = request.headers.get('Authorization');
    if (h?.startsWith('Bearer ')) {
      const t = h.slice(7).trim();
      return t.length > 0 ? t : null;
    }
    return null;
  })();

  // 1b. Global AI kill switch (ai_usage_global)
  // Seeded by 20260425160000_p0_launch_kill_switches_and_expiry_rpc.sql with
  // default true. Flip OFF in the super-admin console to halt ALL Claude
  // calls (foxy/ncert-solver/quiz-gen/scan-solve) without redeploying.
  // 503 + Retry-After=60 lets the client retry once the switch flips back on.
  if (!(await isFeatureEnabled('ai_usage_global'))) {
    logger.warn('foxy: ai_usage_global kill switch active');
    return new NextResponse(
      JSON.stringify({
        success: false,
        error: 'Foxy is temporarily unavailable. Please try again in a minute.',
        error_hi: 'Foxy abhi available nahi hai. Kripya thodi der baad try karein.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } },
    );
  }

  // 2. Parse body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorJson('Invalid request body.', 'Request body galat hai.', 400);
  }

  // 2a. P12 grade-spoof defense — Zod-validate the `grade` field is one of the
  // seven CBSE grade strings (P5) BEFORE any downstream use. We trim first
  // because the rest of the route already trimmed grade defensively. Other
  // fields are still validated by the hand-rolled checks below.
  const trimmedGradeForSchema =
    typeof body.grade === 'string' ? body.grade.trim() : body.grade;
  const parsedBody = FoxyRequestBodySchema.safeParse({
    ...body,
    grade: trimmedGradeForSchema,
  });
  if (!parsedBody.success) {
    return errorJson(
      'Valid grade (6–12) is required.',
      'Grade 6 se 12 ke beech hona chahiye.',
      400,
      { code: 'INVALID_GRADE' },
    );
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const grade = typeof body.grade === 'string' ? body.grade.trim() : '';
  const chapter = typeof body.chapter === 'string' ? body.chapter.trim() || null : null;
  const board = typeof body.board === 'string' ? body.board.trim() || 'CBSE' : 'CBSE';
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() || null : null;
  const requestedMode = typeof body.mode === 'string' && VALID_MODES.includes(body.mode) ? body.mode : 'learn';
  // Phase 1 post-answer learning actions: optional `coachDirective`. Used for
  // the "Explain simpler" / "Show example" re-teach buttons and the "Quiz me
  // on this" inline-MCQ button. The client re-sends the SAME question with one
  // of these directives. Unknown values are dropped silently — never trust the
  // client to set an arbitrary directive.
  //   'simplify' → simpler re-explanation of the previous answer
  //   'example'  → one worked example for the previous question
  //   'quiz_me'  → exactly one oracle-gated inline MCQ on the same concept
  const coachDirective: CoachDirective | null =
    typeof body.coachDirective === 'string'
      && (VALID_COACH_DIRECTIVES as readonly string[]).includes(body.coachDirective)
      ? (body.coachDirective as CoachDirective)
      : null;
  const isQuizMe = coachDirective === 'quiz_me';
  // The student's UI-selected mode is preserved for analytics/quota/persistence.
  // But for the LLM call we auto-promote to 'practice' when the message matches
  // quiz intent — without this, the foxy_tutor_v1 template emits the STEP CARDS
  // shape (intro paragraph then stops) for non-practice modes, leaving the
  // student with no actual MCQs. The MODE_DIRECTIVES.practice block is what
  // tells Claude to emit 5 mcq blocks instead of 2-4 step cards.
  //
  // "Quiz me" (coachDirective='quiz_me') ALSO routes through 'practice' so it
  // gets the larger token budget, but the mode_directive is swapped to
  // SINGLE_MCQ_DIRECTIVE below so the model emits exactly ONE mcq block (which
  // is then oracle-gated before the wire). The 'simplify'/'example' directives
  // keep the student's requested mode (they are re-teach prose, not quizzes).
  const isQuizIntent = QUIZ_PATTERNS.test(message);
  const mode =
    isQuizMe || (isQuizIntent && requestedMode !== 'practice')
      ? 'practice'
      : requestedMode;
  // Phase 2.2: optional coaching mode. If the client passes one, we honor
  // it. Otherwise we pick a default later, after mastery is known
  // (mastery < 0.6 → 'socratic', else → 'answer').
  const requestedCoachMode: CoachMode | null =
    typeof body.coachMode === 'string' && (VALID_COACH_MODES as readonly string[]).includes(body.coachMode)
      ? (body.coachMode as CoachMode)
      : null;
  // Phase 1.1: optional `stream:true` body param. Default false to preserve
  // backward compatibility with mobile, ncert-solver, and any non-Foxy callers.
  // The streaming path is gated by `ff_foxy_streaming` (DB feature flag).
  const wantsStream = body.stream === true;
  // P0 chip-action fix (2026-05-04): optional starter-chip intent. Used
  // below to inject student mastery context into the system prompt for
  // 'weak_areas' and 'study_today'. Unknown values are dropped silently
  // — never trust the client to set arbitrary intents.
  const VALID_INTENTS = new Set([
    'teach', 'study_today', 'quiz', 'explain_last', 'formulas',
    'weak_areas', 'experiment', 'real_world', 'diagram',
  ]);
  const intent: string | null =
    typeof body.intent === 'string' && VALID_INTENTS.has(body.intent)
      ? body.intent
      : null;

  // 3. Validate inputs
  if (!message) {
    return errorJson('Message is required.', 'Message likhna zaroori hai.', 400);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return errorJson(
      `Message too long (max ${MAX_MESSAGE_LENGTH} characters).`,
      `Message bahut lamba hai (max ${MAX_MESSAGE_LENGTH} characters).`,
      400,
    );
  }
  if (!subject) {
    return errorJson('Subject is required.', 'Subject batana zaroori hai.', 400);
  }
  if (!grade || !VALID_GRADES.includes(grade)) {
    return errorJson('Valid grade (6–12) is required.', 'Grade 6 se 12 ke beech hona chahiye.', 400);
  }

  // ── FOX-2 (P12): neutralize prompt-injection overrides in the student message ──
  // The retrieved RAG chunks are already sanitized server-side; the student's
  // own message was passed verbatim. We strip only assistant-directed override
  // phrases ("ignore your previous instructions", "reveal your system prompt",
  // "you are now a ...") — ordinary curriculum questions are left untouched.
  // `message` (original) is still what we PERSIST + show in the chat bubble;
  // `safeQuery` is what we send to the model as the user turn. Defense-in-depth
  // only — the output screen (FOX-1) is the hard backstop regardless of input.
  const injectionGuard = neutralizeInjectionAttempt(message);
  const safeQuery = injectionGuard.text;
  if (injectionGuard.neutralized) {
    // P13: boolean/category only — NEVER the student's message text or id.
    logger.warn('foxy.input.injection_neutralized', { subject, grade });
  }

  // 4. Resolve student ID and validate subject governance
  //
  // Subject governance (422) MUST run before the config/env validation (503)
  // below: a denied subject is a product-contract denial that is true
  // regardless of whether our backend is fully wired, and surfacing 503
  // instead of 422 would leak infra state to the client and flip the
  // C4/C5 governance regression catalog entries.
  const studentId = auth.studentId!;

  try {
    const subjectValidation = await validateSubjectWrite(studentId, subject, {
      supabase: supabaseAdmin,
    });
    if (!subjectValidation.ok) {
      return NextResponse.json(
        {
          error: subjectValidation.error.code,
          subject: subjectValidation.error.subject,
          reason: subjectValidation.error.reason,
          allowed: subjectValidation.error.allowed,
        },
        { status: 422 },
      );
    }
  } catch (govErr) {
    logger.warn('foxy_subject_governance_unavailable', {
      error: govErr instanceof Error ? govErr.message : String(govErr),
      subject,
      studentId,
      note: 'Proceeding without subject governance — migrations may not be applied',
    });
  }

  // 4a. Config validation — fail fast with clear diagnostic.
  // ANTHROPIC_API_KEY lives on the Edge Function side now, but the service-role
  // key MUST be set for callGroundedAnswer() to auth against the Edge Function.
  // Runs AFTER subject governance (see note above).
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    logger.error('foxy_config_missing', {
      variable: !process.env.SUPABASE_SERVICE_ROLE_KEY
        ? 'SUPABASE_SERVICE_ROLE_KEY'
        : 'NEXT_PUBLIC_SUPABASE_URL',
    });
    return errorJson(
      'Foxy is not configured. Please contact support.',
      'Foxy configure nahi hai. Support se sampark karein.',
      503,
      { _diag: 'Supabase env vars not set' },
    );
  }

  let plan = 'free';
  let academicGoal: string | null = null;
  // Phase 4 long-memory: stash the student name so we can scrub it from
  // monthly_synthesis_runs.summary_text_en before injecting into Foxy's
  // system prompt. The synthesis builder injects `${studentName}` into
  // its generation prompt, so the cached text often contains the name in
  // phrases like "Aarav showed strong progress…". P13 forbids forwarding
  // names into the model — see `scrubStudentName` in foxy-long-memory.ts.
  let studentName: string | null = null;
  // P12 grade-spoof defense (CEO decision D2, 2026-06-15): the enrolled grade
  // on the students row is authoritative. If the client-claimed `grade`
  // disagrees, we hard-block (403) BEFORE any prompt assembly, RAG scope,
  // chapter lookup, or LLM call. Runs unconditionally for ALL subjects
  // (independent of the existing flag-gated validateCurriculumScope STEM
  // path in src/lib/foxy/curriculum-scope.ts).
  let dbGrade: string | null = null;
  // P15 funnel-safety: legitimately-onboarding rows can have null grade until
  // the /onboarding page writes it. We gate the null-grade branch below on
  // this flag so that an ONBOARDED user with null grade (profile corruption
  // or deliberate anon-client bypass) gets the 403, while a pre-onboarding
  // user keeps the warn-and-proceed path.
  let dbOnboardingCompleted = false;
  try {
    const { data: studentRow } = await supabaseAdmin
      .from('students')
      .select('subscription_plan, account_status, academic_goal, name, grade, onboarding_completed')
      .eq('id', studentId)
      .single();
    const enrollmentScope = resolveFoxyEnrollmentScope(studentRow ?? null);
    plan = enrollmentScope.plan;
    if (studentRow?.academic_goal) academicGoal = studentRow.academic_goal;
    if (studentRow?.name) studentName = studentRow.name as string;
    // P12 string-format normalization: students.grade has two production
    // conventions — bootstrap writes BARE "6" (src/lib/identity/bootstrap-
    // profile.ts via normalizeGrade) while the onboarding page writes
    // PREFIXED "Grade 6" (src/app/onboarding/page.tsx). Normalize once in
    // the shared scope helper so every Foxy surface sees the same enrolled
    // grade.
    dbGrade = enrollmentScope.grade;
    dbOnboardingCompleted = studentRow?.onboarding_completed === true;
    if (studentRow?.account_status === 'suspended') {
      return errorJson('Your account is suspended.', 'Aapka account suspend hai.', 403);
    }
  } catch { /* Non-fatal — use default free plan */ }

  // P12 grade-spoof HARD BLOCK. Runs after the students fetch resolves and
  // BEFORE prompt assembly, RAG scope build, chapter/curriculum_topics
  // lookup, cognitive context load, or any LLM call. Independent of
  // ff_foxy_curriculum_guard_v1 — the flag-gated path stays as a second
  // layer for STEM subjects only.
  if (dbGrade !== null && dbGrade !== grade) {
    try {
      await logAudit(auth.userId!, {
        action: 'foxy.grade_spoof_attempt',
        resourceType: 'students',
        resourceId: studentId,
        details: {
          claimed_grade: grade,
          actual_grade: dbGrade,
          route: '/api/foxy',
        },
        status: 'denied',
      });
    } catch (auditErr) {
      logger.error('[foxy] audit write failed for grade_spoof_attempt', {
        err: String(auditErr),
      });
    }
    return errorJson(
      'Request grade does not match enrollment',
      'Aapki request ka grade aapke profile se match nahi karta.',
      403,
      { code: 'GRADE_MISMATCH' },
    );
  }
  if (dbGrade === null) {
    // P12 hardening: an ONBOARDED user with null grade is either profile
    // corruption or a deliberate anon-client patch (onboarding writes via the
    // anon client, so a student CAN set their own row's grade to null).
    // Either way, treat as a spoof — but still let pre-onboarding users
    // through so the P15 funnel keeps working.
    if (dbOnboardingCompleted) {
      try {
        await logAudit(auth.userId!, {
          action: 'foxy.grade_spoof_attempt',
          resourceType: 'students',
          resourceId: studentId,
          details: {
            claimed_grade: grade,
            actual_grade: null,
            route: '/api/foxy',
            reason: 'onboarded_null_grade',
          },
          status: 'denied',
        });
      } catch (auditErr) {
        logger.error('[foxy] audit write failed for grade_spoof_attempt (null-grade)', {
          err: String(auditErr),
        });
      }
      return errorJson(
        'Request grade does not match enrollment',
        'Aapki request ka grade aapke profile se match nahi karta.',
        403,
        { code: 'GRADE_MISMATCH' },
      );
    }
    // Legitimately-onboarding user — let the downstream flow proceed
    // (validateCurriculumScope still fails closed for STEM, and the rest of
    // the route handles missing grade gracefully via the hand-rolled
    // validators above).
    logger.warn('[foxy] student row has null grade (pre-onboarding)', { userId: auth.userId });
  }

  const enrolledGrade = dbGrade ?? grade;

  // P12 per-request observability marker. Placed AFTER the grade check so
  // spoof attempts are not counted as legitimate requests. Fire-and-forget;
  // the structured logger line is kept for log-search continuity, and the
  // metric is the queryable counterpart (now that log-event.ts has shipped).
  // P13: grade only, no PII.
  logger.info('foxy.request', { route: '/api/foxy', grade: enrolledGrade, userId: auth.userId });
  void logSystemMetric({
    metric_name: 'foxy_request',
    route: '/api/foxy',
    value: 1,
    tags: { grade: enrolledGrade },
  });

  // 5. Quota check. `limit` is the DB-authoritative daily cap the RPC enforced
  // against (UNLIMITED_QUOTA for the unlimited paid plans) — threaded through so
  // the upgrade-prompt logic below never guesses from a Node-side table.
  const { allowed, remaining, limit } = await checkAndIncrementQuota(studentId);
  if (!allowed) {
    return errorJson(
      'Daily Foxy chat limit reached. Upgrade your plan or try again tomorrow.',
      'Aaj ke Foxy chats khatam ho gaye. Kal dobara try karein ya plan upgrade karein.',
      429,
      { quotaRemaining: 0 },
    );
  }

  // 6. Resolve or create session
  let resolvedSessionId: string;
  try {
    resolvedSessionId = await resolveSession(
      studentId,
      subject,
      grade,
      chapter,
      mode,
      sessionId,
      auth.userId!,
      auth.schoolId ?? null,
    );
  } catch (err) {
    logger.error('foxy_session_create_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      studentId,
    });
    return errorJson(
      'Failed to start chat session. Please try again.',
      'Chat session shuru nahi ho paya. Dobara try karein.',
      500,
    );
  }

  // Fire-and-forget success logger. Called immediately before each terminal
  // SUCCESS return so the promise is initiated; never awaited in the hot path.
  // The loggers are internally try/caught and never throw, so a `void` is safe.
  //
  // CRITICAL: learning_events.student_id MUST be the auth UUID (auth.users.id),
  // NOT the students-table PK (`studentId`). `topic_id` is null because this
  // route works in free-form subject/grade/chapter strings (no verified
  // curriculum_topics.id in hand). `session_id` is the resolved Foxy session
  // uuid, with a defensive fallback that should never fire in practice.
  // P13: only non-PII fields (grade, token counts, correlation id) are logged.
  const logFoxyAsk = (tokens: number | null): void => {
    void logLearningEvent({
      student_id: auth.userId!,
      session_id: resolvedSessionId || generateSessionId(),
      event_type: 'foxy_ask',
      topic_id: null,
      verb: 'asked',
      object_type: 'foxy',
      result: { response_tokens: tokens ?? null },
      context: { grade, correlation_id: correlationId },
    });
    void logSystemMetric({
      metric_name: 'edge_fn_latency_ms',
      route: '/api/foxy',
      value: Date.now() - startTime,
      tags: { grade },
    });
  };

  // 7. Load cognitive context + history + prior-session context + lab context
  //    (parallel, non-fatal on failure)
  //
  // R6 Tier 2: lab context is ADDITIVE — it does NOT replace RAG retrieval
  // (which still happens server-side in grounded-answer). Failures here
  // MUST never block Foxy: fetchRecentLabContext is internally try/catch
  // and returns [] on any error. We additionally wrap the Promise.all in
  // a try/catch so a single rejection cannot poison the others.
  let cognitiveCtx: CognitiveContext = EMPTY_COGNITIVE_CONTEXT;
  let history: ChatMessage[] = [];
  let priorSessionTurns: PriorSessionTurn[] = [];
  let labEntries: LabContextEntry[] = [];
  // Part 2B: chapter topic-progression context (ordered topics + position +
  // next unmastered topic). Best-effort; empty when no ordered ladder exists.
  let topicProgress: ChapterTopicProgress = EMPTY_TOPIC_PROGRESS;
  // Phase 0.2 (ff_foxy_answer_continuation_v1): when ON, prior-session context
  // assembly excludes pending assistant rows (empty content awaiting an LLM
  // completion, or orphaned by a hard-abstain) so they never leak into the
  // cross-session prompt as empty `[previous · Foxy]` snippets. Evaluated ONCE
  // here with the SAME canonical { role:'student', userId: auth.userId }
  // context used by the safety-block write cleanup so the read filter and the
  // write cleanup agree during a partial rollout. When OFF: the read filter is
  // not applied and loadPriorSessionContext is byte-identical to today.
  const excludePendingPriorContext = await isFeatureEnabled('ff_foxy_answer_continuation_v1', {
    role: 'student',
    userId: auth.userId!,
  });
  try {
    const [ctx, hist, prior, labs, prog] = await Promise.all([
      loadCognitiveContext(studentId, subject, grade, chapter),
      loadHistory(resolvedSessionId),
      loadPriorSessionContext(
        studentId,
        subject,
        grade,
        resolvedSessionId,
        chapter,
        excludePendingPriorContext,
      ),
      fetchRecentLabContext(supabaseAdmin, studentId, 5),
      loadChapterTopicProgress(studentId, subject, grade, chapter),
    ]);
    cognitiveCtx = ctx;
    history = hist;
    priorSessionTurns = prior;
    labEntries = labs;
    topicProgress = prog;
  } catch (ctxErr) {
    logger.warn('foxy_context_load_failed', {
      error: ctxErr instanceof Error ? ctxErr.message : String(ctxErr),
      studentId,
    });
  }

  // 7b. Phase 4 — cross-session pedagogical memory (flag-gated).
  //
  // Loads the most recent monthly_synthesis_runs row + a high/low mastery
  // snapshot for the subject, projects existing recentMisconceptions, and
  // formats them into a LEARNER MEMORY prompt block. Default OFF via
  // `ff_foxy_long_memory_v1`; when OFF we skip the DB roundtrip entirely
  // and the prompt section is "" (template-safe).
  //
  // PII (P13): synthesis_text is scrubbed for studentName before injection.
  // Concept titles + curated misconception labels are content-only by
  // construction (editor-curated, no student data).
  //
  // Runs AFTER the cognitive-context Promise.all so we can reuse the
  // already-loaded misconception labels (saves a DB roundtrip).
  let longMemory: LongMemorySnapshot = EMPTY_LONG_MEMORY;
  try {
    const longMemoryEnabled = await isFeatureEnabled('ff_foxy_long_memory_v1', {
      role: 'student',
      userId: auth.userId!,
    });
    if (longMemoryEnabled) {
      longMemory = await loadLongMemorySnapshot(
        supabaseAdmin,
        studentId,
        subject,
        studentName,
        cognitiveCtx.recentMisconceptions.map((m) => m.label),
      );
    }
  } catch (lmErr) {
    // Non-fatal — Foxy works without long-memory.
    logger.warn('foxy_long_memory_load_failed', {
      error: lmErr instanceof Error ? lmErr.message : String(lmErr),
      // P13: no studentId at warn-level here.
    });
  }

  // 7c. Phase 3 (2026-05-18) — server-side pending-expectations state.
  //
  // Flag-gated: when OFF, no extra DB read happens and the prompt variable
  // resolves to empty string (template-safe). When ON, we look up the most
  // recent OPEN expectation for this session and inject it into the prompt
  // as an ANSWERING_NOW block so the model can't "forget" what it just
  // asked. See migration 20260528000013 + src/lib/learn/foxy-expectations.ts.
  //
  // Runs separately from the Promise.all because the flag check itself is
  // async and we want to skip the DB roundtrip entirely when OFF.
  const usePendingExpectations = await isFeatureEnabled(
    'ff_foxy_pending_expectations_v1',
    { role: 'student', userId: auth.userId! },
  );
  let openExpectation: OpenExpectation | null = null;
  if (usePendingExpectations) {
    openExpectation = await loadOpenExpectation(supabaseAdmin, resolvedSessionId);
  }

  // 7d. Digital Twin + Knowledge Graph (Slice 1) — flag-gated, default OFF.
  //
  // When `ff_digital_twin_v1` is OFF (the default) this is a STRICT no-op: no
  // DB read happens, `twinPromptSection` stays '' and the cognitive_context_
  // section below is byte-identical to today. When ON AND a snapshot exists, we
  // append a compact, PII-free LONGITUDINAL LEARNING SIGNALS block (decay,
  // error tendencies, misconception clusters, cohort percentile, episodic
  // highlights) to the existing cognitive context — same injection family as
  // buildCognitivePromptSection, so the P12 grounding/abstain rails are
  // untouched. P13: IDs / numbers / codes only — never names / emails / phones.
  let twinPromptSection = '';
  // Hoisted so the Phase 2.1 Teaching Director (below) can consume the SAME
  // loaded twin without a second read. Stays null when ff_digital_twin_v1 is
  // OFF or no snapshot exists; the Director tolerates a null/empty twin.
  let twinContext: Awaited<ReturnType<typeof loadTwinContextForFoxy>> = null;
  try {
    const twinEnabled = await isFeatureEnabled('ff_digital_twin_v1', {
      role: 'student',
      userId: auth.userId!,
    });
    if (twinEnabled) {
      const twin = await loadTwinContextForFoxy(studentId);
      twinContext = twin;
      if (twin && !twin.isEmpty) {
        twinPromptSection = `\n\n${renderTwinPromptSection(twin)}`;
        logger.info('foxy.twin_context.injected', {
          // P13: counts only — no studentId, no topic ids, no codes.
          weakCount: twin.weakTopics.length,
          decayedCount: twin.decayedTopics.length,
          highlightCount: twin.highlights.length,
        });
      }
    }
  } catch (twinErr) {
    // Non-fatal — Foxy works without twin context.
    logger.warn('foxy_twin_context_unavailable', {
      // P13: no studentId at warn-level here.
      error: twinErr instanceof Error ? twinErr.message : String(twinErr),
    });
  }

  // 8. Feature-flag gated: use grounded-answer service OR legacy inline flow.
  // `ff_grounded_ai_foxy` is the Phase 3 kill switch. When OFF we fall back to
  // the existing intent-router (src/lib/ai/workflows/*) which has been the
  // production path behind `ai_intent_router` and is independent of the new
  // Edge Function.
  const useGroundedService = await isFeatureEnabled('ff_grounded_ai_foxy', {
    role: 'student',
    userId: auth.userId!,
  });

  if (!useGroundedService) {
    // ─── Legacy flow (kill-switch path) ────────────────────────────────────
    try {
      const legacy = await runLegacyFoxyFlow({
        studentId,
        resolvedSessionId,
        message,
        subject,
        grade,
        chapter,
        board,
        mode,
        academicGoal,
        history,
      });
      return await persistLegacyFoxyResponse({
        authUserId: auth.userId!,
        studentId,
        resolvedSessionId,
        remaining,
        message,
        subject,
        grade,
        chapter,
        mode,
        legacy,
        logFoxyAsk,
      });
    } catch (legacyErr) {
      logger.error('foxy_legacy_flow_failed', {
        error: legacyErr instanceof Error ? legacyErr : new Error(String(legacyErr)),
        studentId,
      });
      // Refund quota — student didn't get a usable answer.
      await refundQuota(studentId, 'foxy_chat');
      return errorJson(
        'Foxy is temporarily unavailable. Please try again in a moment.',
        'Foxy abhi available nahi hai. Thodi der mein dobara try karein.',
        503,
      );
    }
  }

  // ─── Grounded-answer service path (default) ──────────────────────────────
  const chapterNum = parseFoxyChapterNumber(chapter);
  const chapterTitle: string | null =
    chapter && chapterNum === null ? chapter : null;

  // ─── STEM-only curriculum HARD pre-gate (CEO Decision A, flag-gated) ──────
  //
  // Problem this closes: out-of-grade CONCEPTUAL queries (e.g. a Grade 7 student
  // asking "Explain to me integration") never reach the math-SOLVE branch below
  // (they're not concrete solve queries), so the curriculum validator never ran
  // and the student got a full out-of-grade explanation. This pre-gate runs the
  // validator on ALL grounded STEM queries — not just solve queries — and HARD-
  // blocks TRULY out-of-grade topics.
  //
  // Mode 'grade_only': runs ONLY T1 (enrolled-grade authenticity) + T2 (subject)
  // + T4a (out-of-grade math lexicon). It SKIPS T3 (chapter) + T4b (LLM classify)
  // entirely — so there is NO extra LLM call here, and an in-grade DIFFERENT-
  // chapter query is NOT blocked (that remains a SOFT redirect handled later by
  // the prompt's topic-progression section). Only a truly higher-grade topic
  // (caught by the deterministic lexicon) is hard-blocked.
  //
  // STEM-only: the out-of-grade lexicon is math/science-shaped, so we only run
  // the gate for STEM subjects (matching foxy-router's STEM_SUBJECT_RE, which is
  // ai-engineer-owned and not exported — replicated locally). Non-STEM subjects
  // skip the pre-gate untouched.
  //
  // When the flag is OFF (ENV unset + DB off) this whole block is skipped and
  // the grounded path is byte-identical. validateCurriculumScope never throws
  // (P12 fail-closed); supabaseAdmin keeps the read server-side (P8); the reply
  // awards 0 XP / no mastery (P2) and is bilingual (P7).
  const STEM_SUBJECT_RE =
    /\b(math|maths|mathematics|physics|chemistry|chem|science|accountancy|accounts|economics|statistics)\b/i;
  // Hoisted so the math-solve branch below can REUSE the pre-gate's verdict and
  // skip a redundant re-validation. `preGateConfirmedInScope` is only true when
  // the guard actually ran this turn (flag ON + STEM subject) AND returned
  // inScope — i.e. grade authenticity (T1) + subject (T2) + out-of-grade lexicon
  // (T4a) are all already confirmed against the SERVER-fetched enrolled grade.
  let preGateConfirmedInScope = false;
  try {
    const curriculumGuardEnabled = await isCurriculumGuardEnabled({
      role: 'student',
      userId: auth.userId!,
    });
    if (curriculumGuardEnabled && STEM_SUBJECT_RE.test(subject)) {
      const guardScope = await validateCurriculumScope(
        {
          studentId,
          requestGrade: grade,
          subject,
          chapter,
          problem: message,
        },
        { supabaseAdmin },
        'grade_only',
      );
      if (!guardScope.inScope) {
        logger.info('foxy.curriculum_guard.out_of_scope', {
          grade,
          reason: guardScope.reason,
        });
        return await respondCurriculumOutOfScope({
          studentId,
          userId: auth.userId!,
          resolvedSessionId,
          message,
          subject,
          grade,
          chapter,
          quotaRemaining: remaining,
          scope: guardScope,
          traceId: randomUUID(),
          topicProgress,
        });
      }
      // In scope for the grade-only pre-gate. Record this so the math-solve
      // branch below can REUSE it (grade + subject + out-of-grade already
      // confirmed) instead of re-running the validator.
      preGateConfirmedInScope = true;
    }
  } catch (guardErr) {
    // Defense-in-depth (P12): validateCurriculumScope is fail-closed and never
    // throws, but if anything unexpected throws here we fall through to the
    // grounded path rather than break the turn.
    logger.warn('foxy.curriculum_guard.threw', {
      subject,
      grade,
      error: guardErr instanceof Error ? guardErr.message : String(guardErr),
    });
  }

  // ─── Foxy 3-Agent Math Pipeline branch (Part 1, flag-gated, ADDITIVE) ─────
  //
  // When ff_foxy_math_pipeline_v1 is ON *and* the message is a concrete
  // math-solve query, route through Classifier -> Solver(Haiku) -> SymPy
  // Verifier (with ONE Sonnet escalation on a confident mismatch), then persist
  // EXACTLY like a normal Foxy turn (foxy_chat_messages) so sessions/memory/
  // learning-actions/topic-progression still apply. On ANY pipeline failure we
  // FALL THROUGH to the existing grounded-answer path below (the turn is never
  // broken). When the flag is OFF, classifyMathSolve is never called and this
  // block is a no-op — the grounded path stays byte-identical.
  //
  // The math pipeline does NOT consume the grounded RAG path's quota refund
  // semantics specially: quota was already incremented in step 5 (same as every
  // turn). 0 XP, no mastery writes — this is formative only.
  try {
    const mathPipelineEnabled = await isMathPipelineEnabled({
      role: 'student',
      userId: auth.userId!,
    });
    if (mathPipelineEnabled) {
      const classification = await classifyMathSolve(message, subject, grade);
      if (classification.isMathSolve) {
        const traceId = randomUUID();

        // Curriculum-scope gate (runs BEFORE the solver/verifier LLM calls).
        // Anti-abuse: scope is decided against the SERVER-fetched enrolled
        // grade, never the message content or the client-claimed grade. On an
        // out-of-scope verdict we persist the turn + return a formative,
        // bilingual out-of-scope reply (NO XP, NO mastery) instead of solving.
        //
        // HOT-PATH OPTIMIZATION (latency, no accuracy change): this branch no
        // longer runs the EXPENSIVE 'full' validation. 'full' would re-run
        // T1 (grade DB) + T2 (subject DB) — already done by the grade-only
        // pre-gate this turn — PLUS T3 (chapter DB reads) and T4b (a FULL LLM
        // round-trip via classifyTopicInChapter). Chapter strictness is SOFT
        // (CEO Decision A), so T3/T4b are a chapter-scope nicety, not an
        // accuracy gate. SymPy verifyMath inside runMathSolvePipeline remains
        // the accuracy gate (untouched). We therefore:
        //   - If the grade-only pre-gate already ran this turn and confirmed
        //     in-scope (preGateConfirmedInScope), REUSE it — no re-validation.
        //     grade + subject + out-of-grade are already established.
        //   - Otherwise (guard flag OFF / non-STEM / pre-gate didn't run), run
        //     the CHEAP 'grade_only' mode here (T1 + T2 DB + T4a regex, NO LLM,
        //     NO chapter DB) so a truly out-of-grade query is still HARD-blocked
        //     deterministically before we spend solver/verifier calls.
        // Net: the solver's ONE LLM call (+ SymPy verify) is the only model work
        // on an in-scope solve; the T4b LLM call + T3 chapter reads + redundant
        // T1/T2 are eliminated from the hot path.
        if (!preGateConfirmedInScope) {
          const scope = await validateCurriculumScope(
            {
              studentId,
              requestGrade: grade,
              subject,
              chapter,
              problem: message,
            },
            { supabaseAdmin },
            'grade_only',
          );
          if (!scope.inScope) {
            logger.info('foxy.math.out_of_scope', {
              traceId,
              grade,
              reason: scope.reason,
            });
            return await respondCurriculumOutOfScope({
              studentId,
              userId: auth.userId!,
              resolvedSessionId,
              message,
              subject,
              grade,
              chapter,
              quotaRemaining: remaining,
              scope,
              traceId,
              topicProgress,
            });
          }
        }

        const pipeline = await runMathSolvePipeline({
          problem: message,
          grade,
          classifier: {
            topic: classification.topic,
            chapter: classification.chapter,
            difficulty: classification.difficulty,
          },
          chapter,
          nextTopic: topicProgress.nextTopic,
          jwt: callerBearerToken ?? '',
          traceId,
        });

        if (pipeline) {
          const mathResponse = await persistMathTurnAndRespond({
            studentId,
            userId: auth.userId!,
            resolvedSessionId,
            message,
            subject,
            grade,
            chapter,
            mode,
            quotaRemaining: remaining,
            pipeline,
            traceId,
            usePendingExpectations,
            openExpectation,
            nextTopicId: topicProgress.nextTopicId,
            nextTopicTitle: topicProgress.nextTopic,
          });
          // Math pipeline answers carry no Claude token count (solveMath does
          // not expose one); the response envelope is tokensUsed: 0.
          logFoxyAsk(0);
          return mathResponse;
        }
        // pipeline === null -> solver produced nothing usable; fall through to
        // the grounded path so the student still gets an answer.
        logger.info('foxy.math.pipeline_fallthrough', { traceId });
      }
    }
  } catch (mathErr) {
    // Defense-in-depth: the pipeline + persist helpers swallow their own
    // errors, but if anything unexpected throws here we fall through to the
    // grounded path rather than break the turn (P12).
    logger.warn('foxy.math.pipeline_threw', {
      subject,
      grade,
      error: mathErr instanceof Error ? mathErr.message : String(mathErr),
    });
  }

  // Phase 1 — Goal-Adaptive Foxy persona gate.
  //
  // `ff_goal_aware_foxy` is seeded by the architect (DISABLED by default in
  // both production and staging). When it's off, every downstream prompt
  // builder receives `useExpandedPersona: false` and produces output
  // byte-identical to the pre-Phase-1 path. Per-user deterministic rollout
  // is keyed off `studentId` so a given student gets a stable experience
  // through the rollout window.
  const useExpandedPersona = await isFeatureEnabled('ff_goal_aware_foxy', {
    role: 'student',
    environment:
      process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
    userId: studentId,
  });

  logger.info('foxy.persona_mode', {
    studentId,
    useExpandedPersona,
    hasGoal: !!academicGoal,
    mode,
  });

  // Resolve tenant AI overrides (ai.personality / tone / pedagogy) for the
  // school this student belongs to. Returns {} for B2C / unresolved schools
  // / fetch failure — never throws. Same helper the legacy flow uses (#569).
  // Cached 5 min downstream via the tenant_configs cache.
  const tenantAi = await resolveTenantAiOverrides(studentId);

  // Compose the safety-railed system prompt. The grounded-answer service has
  // its own template, but we pass ours as `foxy_safety_rails` so the final
  // rendered prompt includes the Next.js-side rails for defense-in-depth.
  let foxySystemPrompt = buildSystemPrompt({
    grade,
    subject,
    chapter,
    mode,
    academicGoal,
    cognitiveCtx,
    useExpandedPersona,
    tenantPersonality: tenantAi.tenantPersonality,
    tenantTone: tenantAi.tenantTone,
    tenantPedagogy: tenantAi.tenantPedagogy,
  });

  // ── Part A: proactive lead-concept directive (READ-ONLY, additive) ───────
  // When a session opens with NO specific question text (a bare greeting /
  // "what should I work on?") OR the client sends intent in
  // {weak_areas, study_today}, inject a single explicit directive naming the
  // deterministically-selected lead concept and instruct Foxy to OPEN by
  // targeting it (scaffolded by the weak-start rule). The selector is a PURE
  // function over the already-loaded cognitiveCtx — NO database reads, NO
  // mastery writes. When cognitiveCtx carries no signal the directive is the
  // no-fabrication rail (no named topic), so this is inert on cold-start.
  //
  // Gating: this block is only reachable when ff_grounded_ai_foxy is ON (the
  // legacy path returns early above), so it rides the existing Foxy flag with
  // no new flag. It is further gated on the bare-open / intent condition, so
  // normal topic-bearing Q&A turns are byte-identical to before.
  const leadConceptApplies =
    isBareOpen(message) || intent === 'weak_areas' || intent === 'study_today';
  if (leadConceptApplies) {
    const lead = selectLeadConcept(cognitiveCtx);
    foxySystemPrompt = `${foxySystemPrompt}\n\n${buildLeadConceptDirective(lead)}`;
    logger.info('foxy.lead_concept.injected', {
      // P13: scope + selector provenance only — NEVER the concept title or
      // studentId. `source: null` means the no-fabrication rail fired.
      subject,
      grade,
      source: lead?.source ?? null,
      reason: intent ?? 'bare_open',
    });
  }

  // ── Part 2B: chapter topic-progression context (additive) ───────────────
  // Inject the ordered topic list + the student's position + the next
  // unmastered topic so Foxy leads the student topic-to-topic. Empty string
  // when there's no ordered ladder (no chapter, no curriculum_topics) — a
  // no-op that keeps the prompt byte-identical for non-laddered turns.
  const topicProgressSection = buildTopicProgressSection(topicProgress);
  if (topicProgressSection) {
    foxySystemPrompt = `${foxySystemPrompt}\n\n${topicProgressSection}`;
    logger.info('foxy.topic_progress.injected', {
      // P13: counts + scope only, never the topic titles or studentId.
      subject,
      grade,
      orderedCount: topicProgress.orderedTopics.length,
      hasNext: topicProgress.nextTopic !== null,
    });
  }

  // ── Phase 1 re-teach directive (Explain simpler / Show example) ──────────
  // Appended at the END of the system prompt so it sits closest to the user
  // message in the model's attention and overrides the verbosity rules above.
  // Empty for quiz_me (its directive flows through mode_directive below) and
  // for the no-directive default, so this is a no-op on the normal path.
  if (coachDirective && COACH_DIRECTIVE_SECTIONS[coachDirective]) {
    foxySystemPrompt = `${foxySystemPrompt}\n\n${COACH_DIRECTIVE_SECTIONS[coachDirective]}`;
    logger.info('foxy.coach_directive.injected', {
      // P13: directive enum + scope only, never studentId/message.
      coachDirective,
      subject,
      grade,
    });
  }

  // ── R6 Tier 2: Lab-context awareness (additive — does NOT replace RAG) ──
  // Append the rendered lab section to the END of the system prompt so it
  // sits closer to the user message in the model's attention. The builder
  // returns "" when labEntries is empty, so this is a no-op for students
  // who haven't done any recent lab work. The "NEVER invent" guardrail
  // wording inside the section is the P12 safety contract.
  // P13: log only the COUNT of injected entries — never the observation
  // text or the studentId in plain.
  if (labEntries.length > 0) {
    const isHi = false; // legacy intent-router uses English template; the
    // grounded-answer service localizes downstream. Keeping
    // English here matches FOXY_SAFETY_RAILS above.
    const labSection = buildLabContextSection(labEntries, isHi);
    if (labSection) {
      foxySystemPrompt = `${foxySystemPrompt}\n\n${labSection}`;
      logger.info('foxy.lab_context.injected', {
        // Intentionally NO studentId in this log line (P13). Subject + grade
        // are non-PII context for ops triage.
        count: labEntries.length,
        subject,
        grade,
      });
    }
  }

  // ── P0 chip-action fix (2026-05-04): mastery context injection ──────────
  // When the student taps "My weak areas" or "What should I study today?",
  // the client sends `intent: 'weak_areas' | 'study_today'`. We pull a
  // small slice of `topic_mastery` (the canonical table — the audit doc
  // called it `student_topic_mastery`, which doesn't exist; see
  // `src/lib/domains/assessment.ts` for the real schema) and append a
  // grounding section to the system prompt. SAFE: every step is wrapped
  // in try/catch; a missing table or query failure is logged but never
  // blocks the chat. P13: only counts logged, never the topic strings.
  if (intent === 'weak_areas' || intent === 'study_today') {
    try {
      const { data: masteryRows, error: masteryErr } = await supabaseAdmin
        .from('topic_mastery')
        .select('topic, mastery_level, total_attempts, correct_attempts')
        .eq('student_id', studentId)
        .eq('subject', subject)
        .order('mastery_level', { ascending: true })
        .limit(5);

      if (masteryErr) {
        logger.warn('foxy_intent_mastery_fetch_failed', {
          intent,
          subject,
          grade,
          error: masteryErr.message,
        });
      }

      const rows = Array.isArray(masteryRows) ? masteryRows : [];
      const weakRows = rows.filter((r) => (r.mastery_level ?? 0) < 0.5);

      let masterySection = '';
      if (intent === 'weak_areas') {
        if (weakRows.length === 0) {
          masterySection = [
            '',
            '── STUDENT MASTERY CONTEXT (intent=weak_areas) ──',
            'No weak-area data is available yet for this student in this subject.',
            'Encourage them to take 1–2 quizzes so we can identify gaps.',
            'DO NOT invent topics they are weak in.',
          ].join('\n');
        } else {
          const lines = weakRows.map((r) => {
            const pct = Math.round((r.mastery_level ?? 0) * 100);
            return `  • ${r.topic} — ${pct}% mastery (${r.correct_attempts ?? 0}/${r.total_attempts ?? 0} correct)`;
          });
          masterySection = [
            '',
            '── STUDENT MASTERY CONTEXT (intent=weak_areas) ──',
            'These are the student\'s weakest topics in this subject (lowest mastery first):',
            ...lines,
            'Use this list to focus your answer. Pick ONE topic to start with.',
          ].join('\n');
        }
      } else {
        // study_today: lowest-mastery topic is the next-best thing to study.
        // Future enhancement: weight by CBSE exam-weight ranking.
        const target = rows[0];
        if (!target) {
          masterySection = [
            '',
            '── STUDENT MASTERY CONTEXT (intent=study_today) ──',
            'No mastery data is available yet. Suggest the student start with',
            'the first uncompleted chapter from the NCERT syllabus for this subject.',
            'DO NOT invent a personalized recommendation.',
          ].join('\n');
        } else {
          const pct = Math.round((target.mastery_level ?? 0) * 100);
          masterySection = [
            '',
            '── STUDENT MASTERY CONTEXT (intent=study_today) ──',
            `Next-best topic to study: ${target.topic} (${pct}% mastery).`,
            'Build today\'s study plan around this topic.',
          ].join('\n');
        }
      }

      if (masterySection) {
        foxySystemPrompt = `${foxySystemPrompt}\n${masterySection}`;
        logger.info('foxy.intent_mastery.injected', {
          // P13: counts + intent only, never the topic strings or studentId.
          intent,
          subject,
          grade,
          rowCount: rows.length,
          weakCount: weakRows.length,
        });
      }
    } catch (intentErr) {
      // SAFE addition — never block the chat on a mastery fetch failure.
      logger.warn('foxy_intent_mastery_unavailable', {
        intent,
        subject,
        error: intentErr instanceof Error ? intentErr.message : String(intentErr),
      });
    }
  }

  // ── Phase 3: unified-state AI context block (additive, flag-gated) ──────
  // When `ff_foxy_context_rich_v1` is OFF (the default), this is a no-op
  // and the system prompt is byte-identical to the legacy build. When ON,
  // we append a ~1500-token markdown block describing the learner's
  // identity, mastery, engagement, recent journey, and a suggested
  // teaching opportunity — built from StudentState + journey projection.
  // The bridge never throws; on any failure the block is empty and Foxy
  // continues exactly as before.
  try {
    const contextResult = await maybeBuildFoxyContextBlock({
      authUserId: auth.userId!,
      subjectCode: subject,
      chapterNumber: chapterNum,
      mode: 'tutor',
    });
    if (contextResult.block) {
      foxySystemPrompt = `${foxySystemPrompt}\n\n${contextResult.block}`;
      logger.info('foxy.unified_context.injected', {
        subject,
        grade,
        approxTokens: contextResult.approxTokens,
        reason: contextResult.reason,
      });
    }
  } catch (bridgeErr) {
    // Defense-in-depth — the bridge already swallows its errors, but
    // wrap the whole call too so a programming error here can never
    // break Foxy.
    logger.warn('foxy_unified_context_unavailable', {
      subject,
      error: bridgeErr instanceof Error ? bridgeErr.message : String(bridgeErr),
    });
  }

  // Phase 2.2 + B'-5 Phase 2: resolve the coaching mode from explicit
  // request + mastery + recent thumbs-feedback signal. Fetcher swallows
  // its own errors so a feedback-table read failure can never block chat.
  const coachFeedback = await fetchCoachFeedbackSignal(studentId);
  const coachMode = resolveCoachMode(requestedCoachMode, cognitiveCtx.masteryLevel, coachFeedback);

  // ── Phase 2 Foxy continuity fix (2026-05-18): native-turns + persist-before-LLM ──
  // When `ff_foxy_native_turns_v1` is ON:
  //   1. Pass history to grounded-answer as a native conversation_turns
  //      array (Anthropic messages[] shape) — much stronger multi-turn
  //      coherence than the legacy JSON-stringified template variable.
  //   2. Insert the user row + a pending-assistant row BEFORE the LLM call,
  //      then UPDATE the assistant row on completion. Survives stream
  //      death / partial failures.
  // OFF (default): byte-identical legacy behavior — history_messages
  // template var only, persistence happens AFTER the LLM call.
  const useNativeTurns = await isFeatureEnabled('ff_foxy_native_turns_v1', {
    role: 'student',
    userId: auth.userId!,
  });

  // ── Phase 0.3: real practice — INTERACTIVE, oracle-gated MCQs (flag-gated) ──
  // When `ff_foxy_real_practice_v1` is ON, a practice turn (UI-selected practice
  // OR quiz-intent auto-promotion, but NOT the single-MCQ "Quiz me" action) emits
  // real `mcq` blocks (interactive + gradable) instead of the legacy 5 markdown
  // pseudo-MCQs that render as non-interactive text. The flag is read ONLY for a
  // practice turn, so every other turn is byte-identical to today (no extra DB
  // roundtrip, no behavior change). When OFF (default) practice keeps the legacy
  // MODE_DIRECTIVES.practice shape verbatim.
  const isPracticeTurn = mode === 'practice' && !isQuizMe;
  const realPracticeEnabled = isPracticeTurn
    ? await isFeatureEnabled('ff_foxy_real_practice_v1', {
        role: 'student',
        userId: auth.userId!,
      })
    : false;
  // `isRealPractice` gates BOTH the mcq-emitting prompt directive and the
  // post-LLM multi-MCQ oracle gate / evidential serve below. Like "Quiz me", a
  // real-practice turn is forced off the streaming path (the mcqs must be
  // oracle-gated on the FULL structured payload BEFORE display — the SSE path
  // has no gate point).
  const isRealPractice = isPracticeTurn && realPracticeEnabled;

  // ── Phase 0.4: teach-then-stop (ff_foxy_learning_actions_v1) ────────────
  // When the redesigned post-answer action bar is live, the student's screen
  // already shows tappable buttons (Got it / Explain simpler / Show example /
  // Quiz me). So Foxy re-narrating that menu in prose ("Would you like me to
  // explain this more simply? I can also give you an example, or quiz you on
  // it — just let me know!") is redundant and un-teacherly. When ON, we inject
  // TEACH_THEN_STOP_DIRECTIVE so Foxy TEACHES cleanly and ends with at most ONE
  // substantive check question, WITHOUT enumerating the assistant's own menu of
  // next actions. The directive still REQUIRES a single Socratic check (that is
  // teaching, not a meta-offer), so genuine pedagogy is preserved.
  //
  // Reuses the EXISTING flag that renders those buttons (never creates/flips a
  // flag). Scoped to prose-teaching turns (mode !== 'practice'); practice /
  // quiz_me / real-practice emit MCQs and are unaffected — the read is skipped
  // entirely on those turns (no extra DB roundtrip, byte-identical). Flag OFF
  // (default) OR a practice turn → teachThenStopDirective = '' → mode_directive
  // is byte-identical to today. Threaded via the mode_directive template
  // variable below (the same channel as SINGLE_MCQ_DIRECTIVE /
  // PRACTICE_MCQ_DIRECTIVE); FOXY_SAFETY_RAILS + base persona are untouched.
  const teachThenStopEnabled =
    mode !== 'practice'
      ? await isFeatureEnabled('ff_foxy_learning_actions_v1', {
          role: 'student',
          userId: auth.userId!,
        })
      : false;
  const teachThenStopDirective = teachThenStopEnabled ? TEACH_THEN_STOP_DIRECTIVE : '';
  if (teachThenStopEnabled) {
    logger.info('foxy.teach_then_stop.injected', {
      // P13: mode + scope only — never studentId/message.
      mode,
      subject,
      grade,
    });
  }

  // history_messages is kept as a deprecated alias for one release so the
  // grounded-answer service can switch over without forcing a synchronized
  // deploy. The service now prefers conversation_turns when present.
  const historyMessagesAlias = JSON.stringify(history);

  // ── Phase 2.1: Foxy Teaching Director (ff_foxy_teaching_director_v1) ──────
  // On a TEACHING turn (learn/explain/revise/doubt/homework/explorer — NOT the
  // MCQ-emitting quiz_me / practice turns), compose an explicit, deterministic
  // teaching plan from the already-loaded learner state and inject it as an
  // ADDITIVE directive section. The plan also advances a per-session lesson
  // step (persisted to foxy_sessions) and supplies a context-aware button set
  // on the wire so the UI can render real, plan-driven action buttons.
  //
  // Default OFF via ff_foxy_teaching_director_v1: when OFF this whole block is
  // skipped, `teachingDirectorSection` stays '' and `teachingPlan` stays null,
  // so the grounded request + wire shape are BYTE-IDENTICAL to today.
  //
  // SAFETY: the Director ONLY adds a directive string (appended to the
  // cognitive_context_section template var below) + two wire fields. It does
  // NOT touch reference_material, the safety rails, the RAG/grounding/abstain
  // path, or structured validation. Every step is guarded so ANY Director
  // failure is a safe no-op (falls back to today's behavior). The compose is
  // pure/sync; it does not slow the turn.
  let teachingDirectorSection = '';
  let teachingPlan: TeachingPlan | null = null;
  // `mode` is already promoted to 'practice' for quiz_me upstream, so
  // isTeachingTurn(mode) alone excludes quiz_me + practice + real-practice; the
  // extra guards are belt-and-suspenders in case that promotion ever changes.
  const directorTeachingTurn = isTeachingTurn(mode) && !isQuizMe && !isRealPractice;
  if (directorTeachingTurn) {
    try {
      const directorEnabled = await isFeatureEnabled('ff_foxy_teaching_director_v1', {
        role: 'student',
        userId: auth.userId!,
      });
      if (directorEnabled) {
        const lessonStepState = await loadLessonStepState(resolvedSessionId);
        teachingPlan = maybeComposeTeachingPlan({
          cognitiveContext: cognitiveCtx,
          chapterProgress: topicProgress,
          persona: academicGoal,
          lessonStepState,
          twin: twinContext,
        });
        if (teachingPlan) {
          teachingDirectorSection = buildTeachingDirectorSection(teachingPlan);
          // FIX 2 (Phase 2.1 polish): the lesson step is NO LONGER advanced here
          // at compose time. Composing the plan only INJECTS the directive; the
          // step is persisted (persistLessonProgress) later, ONLY after a
          // successful, safety-screened teaching answer is produced — on the
          // blocking success return below AND inside handleStreamingFoxyTurn. An
          // abstain / grounding-fail / upstream error / safety block therefore
          // leaves the lesson step untouched (the student didn't get the teaching).
          logger.info('foxy.teaching_director.injected', {
            // P13: enums/scope only — never the concept title, ids, or studentId.
            subject,
            grade,
            whyNow: teachingPlan.currentObjective.whyNow,
            lessonStep: teachingPlan.lessonStep,
            targetBloom: teachingPlan.targetBloom,
            depthCeiling: teachingPlan.depthCeiling,
            buttonCount: teachingPlan.suggestedButtons.length,
          });
        }
      }
    } catch (dirErr) {
      // Non-fatal — Foxy works without the Director. Safe no-op: reset both so a
      // partial failure can never leak a half-built section onto the wire.
      teachingDirectorSection = '';
      teachingPlan = null;
      logger.warn('foxy_teaching_director_failed', {
        error: dirErr instanceof Error ? dirErr.message : String(dirErr),
      });
    }
  }

  const groundedRequest: GroundedRequest = {
    caller: 'foxy',
    student_id: studentId,
    // FOX-2: send the injection-neutralized message to the model (the original
    // `message` is still persisted + shown in the student's chat bubble).
    query: safeQuery,
    scope: {
      board: 'CBSE',
      grade,
      subject_code: subject,
      chapter_number: chapterNum,
      chapter_title: chapterTitle,
    },
    mode: 'soft',
    generation: {
      model_preference: 'auto',
      max_tokens: MODE_MAX_TOKENS[mode] ?? 1024,
      temperature: 0.3,
      // RCA-FIX RC-1 (2026-06-26): route to mode-specific prompt so Claude
      // receives exactly ONE output-format section per request.
      system_prompt_template: selectFoxyPromptTemplate(mode),
      // Phase 2 of Foxy continuity fix (2026-05-18): native multi-turn array.
      // When flag is OFF, leave undefined → grounded-answer falls back to
      // single-user-message body. When ON, prepend prior turns to messages[].
      ...(useNativeTurns && history.length > 0
        ? {
            conversation_turns: history.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }
        : {}),
      template_variables: {
        grade,
        subject,
        chapter: chapter ?? '',
        mode,
        // Per-request-mode directive. Overrides STEP CARDS for practice mode
        // (5 mcq blocks instead of 2-4 step cards). Empty string for other
        // modes preserves byte-identical legacy behavior.
        //
        // "Quiz me" (isQuizMe) routes through practice mode but swaps the
        // 5-question shape for SINGLE_MCQ_DIRECTIVE so the model emits EXACTLY
        // ONE mcq block — which is oracle-gated (P6 + REG-54) before the wire.
        //
        // Real practice (isRealPractice, ff_foxy_real_practice_v1 ON) swaps the
        // legacy 5-paragraph pseudo-MCQ shape for PRACTICE_MCQ_DIRECTIVE so the
        // model emits N real, interactive `mcq` blocks — each oracle-gated below
        // before display. Flag OFF → MODE_DIRECTIVES.practice verbatim.
        // Phase 0.4 (ff_foxy_learning_actions_v1): on prose-teaching turns the
        // teach-then-stop directive is composed onto the (usually empty) per-
        // mode directive so Foxy ends with ONE check question and stops
        // self-narrating the on-screen action menu. teachThenStopDirective is
        // '' when the flag is OFF or on a practice turn, and composeModeDirective
        // returns the base verbatim in that case → byte-identical to today.
        mode_directive: isQuizMe
          ? SINGLE_MCQ_DIRECTIVE
          : isRealPractice
            ? PRACTICE_MCQ_DIRECTIVE
            : composeModeDirective(MODE_DIRECTIVES[mode] ?? '', teachThenStopDirective),
        // Phase 2.2: coaching mode and its instruction line, consumed by
        // the rewritten foxy_tutor_v1 template.
        coach_mode: coachMode.toUpperCase(),
        coach_mode_instruction: COACH_MODE_INSTRUCTIONS[coachMode],
        // Phase 1: when `ff_goal_aware_foxy` is on AND the goal resolves,
        // this swaps the legacy single-line section for the multi-paragraph
        // expanded persona block. Off → byte-identical legacy output.
        academic_goal_section: buildAcademicGoalSection(academicGoal, mode, {
          useExpandedPersona,
        }),
        // Digital Twin Slice 1: when ff_digital_twin_v1 is ON and a snapshot
        // exists, `twinPromptSection` carries the LONGITUDINAL LEARNING SIGNALS
        // block appended to the cognitive context. When OFF (default) it is ''
        // → byte-identical to today.
        // Phase 2.1: the Teaching Director section (WHAT to teach + WHY now
        // bilingual + lesson step + Bloom/depth) is APPENDED to the cognitive
        // context — the SAME rendered channel the Digital Twin uses
        // (twinPromptSection above). {{cognitive_context_section}} is a real
        // slot in every foxy_tutor_* template (unlike {{foxy_system_prompt}}),
        // so the directive actually reaches the model WITHOUT adding a new
        // Edge-template slot or touching reference_material / the safety rails.
        // `teachingDirectorSection` is '' when ff_foxy_teaching_director_v1 is
        // OFF, on a non-teaching (quiz_me/practice) turn, or on ANY Director
        // failure → appends nothing → byte-identical to today.
        cognitive_context_section:
          buildCognitivePromptSection(cognitiveCtx) +
          twinPromptSection +
          (teachingDirectorSection ? `\n\n${teachingDirectorSection}` : ''),
        // Phase 2: curated misconception ontology — fires the
        // MISCONCEPTION_REPAIR branch in foxy_tutor_v1 with real data.
        // Empty string when no misconceptions observed (template-safe).
        misconception_section: buildMisconceptionPromptSection(cognitiveCtx.recentMisconceptions),
        // Phase 3 of Foxy continuity (2026-05-18): if Foxy asked a question
        // on the prior turn and the row is still OPEN, this renders an
        // ANSWERING_NOW block so the model evaluates the student's current
        // message AS THE ANSWER. Empty string when flag is OFF or no open
        // expectation exists (template-safe; missing vars resolve to '').
        pending_expectation: buildExpectationPromptSection(openExpectation),
        // Task 1.3: cross-session memory. Empty string when no prior sessions
        // (template handles missing variables as empty by design).
        previous_session_context: buildPriorSessionPromptSection(priorSessionTurns),
        // Phase 4 continuity: cross-session pedagogical memory. Empty string
        // when ff_foxy_long_memory_v1 is OFF or no synthesis/mastery data
        // exists yet (e.g. brand-new student). PII-scrubbed before injection.
        learner_memory_section: buildLongMemoryPromptSection(longMemory),
        // Part 2B: the EXACT next topic in the chapter ladder (or '' when the
        // chapter is complete / no ordered ladder exists). The foxy_tutor_v1
        // template accepts {{next_topic}}; empty string is template-safe. Never
        // fabricated — null becomes ''. The full ordered-topics directive is
        // already inside foxy_system_prompt via buildTopicProgressSection.
        next_topic: topicProgress.nextTopic ?? '',
        foxy_safety_rails: FOXY_SAFETY_RAILS,
        foxy_system_prompt: foxySystemPrompt,
        // Deprecated alias: kept populated for one release so the service can
        // switch over without a synchronized deploy. The Phase 2 grounded-
        // answer code prefers conversation_turns when present.
        history_messages: historyMessagesAlias,
        board,
      },
    },
    retrieval: { match_count: RAG_MATCH_COUNT },
    timeout_ms: PER_PLAN_TIMEOUT_MS[plan] ?? 20000,
  };

  // Phase 2 of Foxy continuity fix: pre-insert user + pending-assistant rows
  // when flag is ON. If both inserts succeed, downstream paths UPDATE rather
  // than INSERT. If the pre-insert itself fails (network blip, RLS misconfig)
  // we fall through to the legacy post-call INSERT path — the chat still
  // works, we just don't get the partial-failure-survival guarantee for this
  // one turn. preInsertedIds.assistantId / userId stay null in that case.
  const preInsertedIds: { userId: string | null; assistantId: string | null } = {
    userId: null,
    assistantId: null,
  };
  if (useNativeTurns) {
    try {
      const now = new Date().toISOString();
      const { data: inserted, error: preInsertErr } = await supabaseAdmin
        .from('foxy_chat_messages')
        .insert([
          {
            session_id: resolvedSessionId,
            student_id: studentId,
            role: 'user',
            content: message,
            sources: null,
            tokens_used: null,
            // user rows are never pending (the student already sent the
            // message). Persisting NOT pending means loadHistory will
            // include it on the very next turn even if this turn's LLM
            // call dies.
            pending: false,
            created_at: now,
          },
          {
            session_id: resolvedSessionId,
            student_id: studentId,
            role: 'assistant',
            content: '', // filled by UPDATE on LLM completion
            structured: null,
            sources: null,
            tokens_used: null,
            coach_mode_used: coachMode,
            // pending=true gates this row out of loadHistory's prompt
            // assembly until the LLM call returns and UPDATEs to false.
            pending: true,
            created_at: new Date(Date.now() + 1).toISOString(),
          },
        ])
        .select('id, role');
      if (preInsertErr) {
        logger.warn('foxy_pre_insert_failed', {
          error: preInsertErr.message,
          studentId,
        });
      } else if (inserted) {
        preInsertedIds.userId = (inserted.find((r) => r.role === 'user')?.id as string) ?? null;
        preInsertedIds.assistantId =
          (inserted.find((r) => r.role === 'assistant')?.id as string) ?? null;
      }
    } catch (err) {
      logger.warn('foxy_pre_insert_threw', {
        error: err instanceof Error ? err.message : String(err),
        studentId,
      });
    }
  }

  // Hop timeout = service timeout + 2s buffer so we let the service return its
  // own abstain payload rather than giving up at the transport layer.
  const hopTimeoutMs = (PER_PLAN_TIMEOUT_MS[plan] ?? 20000) + 2000;

  // ─── Phase 1.1: streaming branch (opt-in via body.stream + ff_foxy_streaming) ──
  // "Quiz me" MUST go through the blocking path: the inline MCQ is oracle-gated
  // (P6 + REG-54) on the FULL structured payload BEFORE it is shown, and the
  // streaming path emits text deltas to the browser before the payload is
  // complete (no gate point). Force quiz_me off the stream so a failing MCQ can
  // never reach the student. (simplify/example are prose and stream fine.)
  //
  // Real practice (isRealPractice) is forced off the stream for the SAME reason:
  // every emitted mcq is oracle-gated on the FULL structured payload before
  // display, so an ungated/garbage mcq can never reach the student mid-stream.
  if (wantsStream && !isQuizMe && !isRealPractice) {
    const streamingEnabled = await isFeatureEnabled('ff_foxy_streaming', {
      role: 'student',
      userId: auth.userId!,
    });
    if (streamingEnabled) {
      // The streaming pipeline writes to foxy_chat_messages once the stream
      // completes (server side, after capturing full text). Quota was already
      // incremented in step 5 above; if the stream fails BEFORE done arrives
      // we refund it. If the stream succeeds we keep the deduction.
      return await handleStreamingFoxyTurn({
        groundedRequest,
        hopTimeoutMs,
        studentId,
        userId: auth.userId!,
        resolvedSessionId,
        message,
        subject,
        grade,
        chapter,
        mode,
        cognitiveCtx,
        coachMode,
        // Phase 2 of Foxy continuity fix (2026-05-18): when these are set,
        // persistOnDone UPDATEs the existing rows rather than INSERTing.
        // When null (flag off or pre-insert failed), the legacy INSERT
        // path runs verbatim.
        preInsertedUserId: preInsertedIds.userId,
        preInsertedAssistantId: preInsertedIds.assistantId,
        // Phase 3 (2026-05-18): thread pending-expectations state so the
        // streaming-path post-persist can mark answered/abandoned AND
        // write the new expectation row. OFF → no-op in the helper.
        usePendingExpectations,
        openExpectation,
        // Phase 2.1 (FIX 1 + FIX 2): thread the composed teaching plan so the
        // streaming `done` event carries the same suggestedButtons + nextActions
        // the blocking path returns AND the lesson step advances only on a
        // successful, non-safety-blocked answer. Null (flag OFF / non-teaching /
        // Director failure) → done event unchanged + no persist.
        teachingPlan,
      });
    }
    // Streaming requested but flag off → silently fall through to blocking.
  }

  // Single retrieval: grounded-answer service handles embed+RRF+rerank. Audit 2026-04-27 F11.
  const grounded = await callGroundedAnswer(groundedRequest, { hopTimeoutMs });

  // ─── Handle abstain ──────────────────────────────────────────────────────
  if (!grounded.grounded) {
    if (LEGACY_FALLBACK_ABSTAIN_REASONS.includes(grounded.abstain_reason)) {
      logger.warn('foxy_grounded_service_fallback', {
        studentId,
        subject,
        grade,
        chapter,
        abstainReason: grounded.abstain_reason,
        traceId: grounded.trace_id,
        latencyMs: grounded.meta.latency_ms,
      });
      try {
        const legacy = await runLegacyFoxyFlow({
          studentId,
          resolvedSessionId,
          message,
          subject,
          grade,
          chapter,
          board,
          mode,
          academicGoal,
          history,
        });
        return await persistLegacyFoxyResponse({
          authUserId: auth.userId!,
          studentId,
          resolvedSessionId,
          remaining,
          message,
          subject,
          grade,
          chapter,
          mode,
          legacy,
          logFoxyAsk,
        });
      } catch (legacyErr) {
        logger.error('foxy_grounded_fallback_failed', {
          error: legacyErr instanceof Error ? legacyErr : new Error(String(legacyErr)),
          studentId,
        });
        await refundQuota(studentId, 'foxy_chat');
        return errorJson(
          'Foxy is temporarily unavailable. Please try again in a moment.',
          'Foxy abhi available nahi hai. Thodi der mein dobara try karein.',
          503,
        );
      }
    }
    if (REFUND_ABSTAIN_REASONS.includes(grounded.abstain_reason)) {
      await refundQuota(studentId, 'foxy_chat');
    }

    logger.info('foxy_grounded_abstain', {
      studentId,
      subject,
      grade,
      chapter,
      abstainReason: grounded.abstain_reason,
      traceId: grounded.trace_id,
      latencyMs: grounded.meta.latency_ms,
    });
    logAudit(auth.userId!, {
      action: 'foxy.chat.abstain',
      resourceType: 'foxy_sessions',
      resourceId: resolvedSessionId,
      details: {
        subject, grade, chapter, mode,
        abstainReason: grounded.abstain_reason,
        traceId: grounded.trace_id,
      },
    });

    const suggestedAlternatives: SuggestedAlternative[] = grounded.suggested_alternatives;

    // Compute a fresh quotaRemaining (if we refunded, the student gets the
    // message back; otherwise the existing `remaining` value is still correct
    // since check_and_record_usage returned post-increment count).
    const effectiveRemaining = REFUND_ABSTAIN_REASONS.includes(grounded.abstain_reason)
      ? remaining + 1
      : remaining;

    // Phase 0: do NOT echo sources/diagrams to the client.
    // Hard-abstain is a terminal success return (success: true) with no Claude
    // tokens; log it with tokens 0 so latency telemetry stays complete.
    logFoxyAsk(0);
    return NextResponse.json({
      success: true,
      response: '',
      sessionId: resolvedSessionId,
      quotaRemaining: effectiveRemaining,
      tokensUsed: 0,
      groundingStatus: 'hard-abstain' as const,
      abstainReason: grounded.abstain_reason,
      suggestedAlternatives,
      traceId: grounded.trace_id,
    });
  }

  // ─── Grounded response — normalize + persist ─────────────────────────────
  // The grounded-answer pipeline returns grounded:true for any successful
  // Claude call, but soft-mode answers can still fall back to "general CBSE
  // knowledge" when no chunks were retrieved or when Claude prefixes the
  // answer with the documented escape phrase. groundedFromChunks is the
  // honest signal: true when the answer was actually produced from NCERT
  // chunks. We surface the unverified banner exactly when this is false,
  // so students see a caution strip on general-knowledge responses instead
  // of being misled into treating them as curriculum-canon. Audit 2026-05-10.
  //
  // Pre-audit, this was hardcoded false on the assumption that a successful
  // grounded-answer call always meant chunks were used — that was wrong:
  // 287/309 foxy traces in the 30 days before the fix had grounded=true
  // with chunk_count=0, every one of which got a "grounded" UI badge.
  //
  // SOFT_CONFIDENCE_BANNER_THRESHOLD remains the honest mid-tier threshold
  // for partially-grounded answers (chunks present but low confidence).
  // Combined: any answer that is either not grounded-from-chunks OR has
  // confidence below the soft banner threshold gets flagged.
  const groundedFromChunksRaw = grounded.groundedFromChunks === true;
  const lowConfidence = typeof grounded.confidence === 'number'
    && grounded.confidence < SOFT_CONFIDENCE_BANNER_THRESHOLD;
  const isUnverified = !groundedFromChunksRaw || lowConfidence;

  // Convert Citation[] → RagSource[] for backward-compat with existing clients.
  const sources: RagSource[] = grounded.citations.map((c: Citation) => ({
    chunk_id: c.chunk_id,
    subject,
    chapter: c.chapter_title || (c.chapter_number ? `Chapter ${c.chapter_number}` : undefined),
    page_number: c.page_number ?? undefined,
    similarity: c.similarity,
    content_preview: c.excerpt.slice(0, 150),
    media_url: c.media_url,
  }));

  const diagrams: DiagramRef[] = grounded.citations
    .filter((c: Citation) => c.media_url)
    .map((c: Citation) => ({
      url: c.media_url!,
      title: c.chapter_title || subject,
      pageNumber: c.page_number ?? undefined,
      description: `NCERT ${subject} ${c.chapter_title || ''}`.trim(),
    }));

  // ─── Extract + validate structured payload (defense-in-depth) ──────────
  // The grounded-answer service may return a structured FoxyResponse alongside
  // the plain `answer` string. We validate at the API boundary so the JSONB
  // column we are about to write cannot be poisoned by an upstream bug. If
  // validation fails the helper returns null and logs once; the legacy
  // `answer` string is still persisted in `content` so the turn is preserved.
  let structured = extractValidatedStructured(grounded, {
    traceId: grounded.trace_id,
    studentId,
    subject,
    grade,
    // Recover from inline fenced JSON when the upstream `structured` field
    // is missing — keeps raw ```json {...}``` blobs out of the chat bubble.
    fallbackText: grounded.answer,
  });

  // ── Quiz-me inline-MCQ oracle gate (BINDING CONTRACT, P6 + REG-54) ───────
  // When the student tapped "Quiz me on this", the structured payload should
  // carry EXACTLY ONE mcq block. Before showing it we run the SAME oracle that
  // gates question_bank inserts: deterministic P6 checks + the Claude LLM
  // grader. A failing (or missing/duplicate) mcq is NEVER shown — we replace
  // the payload with a graceful bilingual fallback ("let me try a different
  // question") so the student never sees a broken MCQ (P12). On grader
  // unavailability the oracle fails CLOSED (rejects). The gate response field
  // text is overridden too so legacy/string-only clients also get the fallback.
  let quizMeWireText: string | null = null;
  // ── Part B1: evidential served-item wire fields ──────────────────────────
  // When a "Quiz me" MCQ passes the oracle gate AND resolves to a real
  // chapter_concepts.id, we INSERT a server-issued foxy_served_items row (the
  // verification anchor) so the answer can later move mastery through the
  // sanctioned tutor_commit_attempt path (/api/foxy/quiz-answer). When the
  // concept is unresolvable OR a second Quiz me fires on the same
  // (session, concept), the item is NON-evidential (cannot move mastery) and we
  // say so explicitly on the wire. P13: ids/scope only in logs.
  let evidentialServedItemId: string | null = null;
  let quizMeEvidential = false;
  let quizMeNonEvidentialReason: string | null = null;
  // Phase 0.3: set true when a real-practice turn produced >=1 oracle-passed mcq
  // block, so the wire emits the (single) evidential `quizMe` contract for the
  // FIRST mcq exactly like a "Quiz me" turn does. Stays false when we fell back
  // to the graceful message (no mcq → no quizMe contract, no fake claim).
  let realPracticeApplied = false;
  if (isQuizMe) {
    if (structured) {
      try {
        const gate = await gateQuizMeMcq(structured, {
          grade,
          subject,
          enableLlmGrader: true,
          llmGrade: buildQuizMeLlmGrader(),
        });
        if (!gate.ok) {
          logger.warn('foxy.quiz_me.oracle_rejected', {
            // P13: reason/category + scope only; never the mcq text or studentId.
            reason: gate.reason,
            subject,
            grade,
            llmCalls: gate.llm_calls,
          });
          structured = buildQuizMeFallbackResponse(subject);
          quizMeWireText = denormalizeFoxyResponse(structured);
        } else {
          logger.info('foxy.quiz_me.oracle_passed', {
            subject,
            grade,
            llmCalls: gate.llm_calls,
          });
          // ── Serve the evidential item (server-issued correct_index key) ──
          try {
            const found = findSingleMcqBlock(structured);
            if (found.ok) {
              const lead = selectLeadConcept(cognitiveCtx);
              const resolved = await resolveLeadConceptId(supabaseAdmin, {
                subject,
                grade,
                chapter,
                leadConceptTitle: lead?.title ?? null,
              });
              if (resolved.ok) {
                const { payload, correctIndex } = payloadFromMcqBlock(found.mcq);
                const serve = await serveEvidentialItem(supabaseAdmin, {
                  sessionId: resolvedSessionId,
                  studentId,
                  conceptId: resolved.concept.id,
                  payload,
                  correctIndex,
                });
                if (serve.evidential) {
                  evidentialServedItemId = serve.servedItemId;
                  quizMeEvidential = true;
                  logger.info('foxy.quiz_me.evidential_served', {
                    // P13: scope + provenance only — no concept title / studentId.
                    subject,
                    grade,
                    leadSource: lead?.source ?? null,
                  });
                } else {
                  // duplicate_in_session or insert_failed → NON-evidential.
                  quizMeNonEvidentialReason = serve.reason;
                  logger.info('foxy.quiz_me.non_evidential', {
                    subject,
                    grade,
                    reason: serve.reason,
                  });
                }
              } else {
                // Concept could not be bound to a chapter_concepts.id → the item
                // is shown as practice but CANNOT move mastery.
                quizMeNonEvidentialReason = resolved.reason;
                logger.info('foxy.quiz_me.non_evidential', {
                  subject,
                  grade,
                  reason: resolved.reason,
                });
              }
            }
          } catch (serveErr) {
            // Serving the evidential anchor is best-effort: a failure here must
            // NOT break the turn. The student still sees the (oracle-passed) MCQ;
            // it is simply non-evidential this turn.
            quizMeNonEvidentialReason = 'serve_threw';
            logger.warn('foxy.quiz_me.serve_threw', {
              subject,
              grade,
              error: serveErr instanceof Error ? serveErr.message : String(serveErr),
            });
          }
        }
      } catch (gateErr) {
        // Defense-in-depth: the gate already fails closed internally, but if
        // anything unexpected throws here we still refuse to show the mcq.
        logger.warn('foxy.quiz_me.oracle_threw', {
          subject,
          grade,
          error: gateErr instanceof Error ? gateErr.message : String(gateErr),
        });
        structured = buildQuizMeFallbackResponse(subject);
        quizMeWireText = denormalizeFoxyResponse(structured);
      }
    } else {
      // No structured payload at all (upstream malformed) — quiz_me cannot be
      // honored. Serve the graceful fallback rather than a raw text blob.
      structured = buildQuizMeFallbackResponse(subject);
      quizMeWireText = denormalizeFoxyResponse(structured);
    }
  } else if (isRealPractice) {
    // ── Real practice: multi-MCQ oracle gate + one evidential lead item ──────
    // (ff_foxy_real_practice_v1 ON.) The practice turn should carry N real `mcq`
    // blocks. Before showing ANY of them:
    //   1. Oracle-gate EVERY mcq (P6 + REG-54, deterministic + LLM grader; fails
    //      CLOSED per mcq). Failing mcqs are DROPPED, never shown (P12).
    //   2. Anti-fake guardrail: rebuild the turn to contain ONLY the oracle-passed
    //      mcq blocks (buildGatedPracticeResponse strips ALL prose), so a turn can
    //      never CLAIM questions it did not actually emit as gated mcqs.
    //   3. If NO mcq survives → graceful bilingual fallback (never a garbage mcq
    //      and never a false "I made a quiz" claim).
    //   4. Serve the FIRST surviving mcq as ONE evidential foxy_served_items row
    //      on the lead concept — identical to "Quiz me". Answering it moves
    //      mastery through the sanctioned /api/foxy/quiz-answer pipeline (3s floor
    //      + idempotency + XP-free). The remaining mcqs are real, answerable
    //      self-check (NON-evidential — no server-issued item, so quiz-answer
    //      refuses them; mastery can never be double-counted on one turn — P1/P2/P3).
    // The renderer wires the single `quizMe` contract to the FIRST mcq block and
    // renders every other mcq as self-check, so no client change is required.
    if (structured) {
      try {
        const gated = await gatePracticeMcqs(structured, {
          grade,
          subject,
          enableLlmGrader: true,
          llmGrade: buildQuizMeLlmGrader(),
          maxKeep: PRACTICE_MCQ_COUNT,
        });
        const rebuilt = buildGatedPracticeResponse(structured, gated.kept);
        if (!rebuilt) {
          // No mcq survived (all rejected, or none emitted). Never show a claim
          // without real questions — fall back to the graceful bilingual message.
          logger.warn('foxy.real_practice.all_rejected', {
            // P13: scope + counts only; never mcq text or studentId.
            subject,
            grade,
            totalMcqs: gated.totalMcqs,
            llmCalls: gated.llm_calls,
          });
          structured = buildQuizMeFallbackResponse(subject);
          quizMeWireText = denormalizeFoxyResponse(structured);
        } else {
          // Anti-fake: `structured` is now ONLY the oracle-passed mcq blocks.
          structured = rebuilt;
          quizMeWireText = denormalizeFoxyResponse(structured);
          realPracticeApplied = true;
          logger.info('foxy.real_practice.gated', {
            subject,
            grade,
            kept: gated.kept.length,
            dropped: gated.totalMcqs - gated.kept.length,
            llmCalls: gated.llm_calls,
          });
          // Serve ONE evidential item for the FIRST surviving mcq (lead concept).
          // UNIQUE(session_id, concept_id) guarantees at most one evidential serve
          // per (session, concept) — a repeat never double-moves mastery.
          try {
            const lead = selectLeadConcept(cognitiveCtx);
            const resolved = await resolveLeadConceptId(supabaseAdmin, {
              subject,
              grade,
              chapter,
              leadConceptTitle: lead?.title ?? null,
            });
            if (resolved.ok) {
              const { payload, correctIndex } = payloadFromMcqBlock(gated.kept[0]);
              const serve = await serveEvidentialItem(supabaseAdmin, {
                sessionId: resolvedSessionId,
                studentId,
                conceptId: resolved.concept.id,
                payload,
                correctIndex,
              });
              if (serve.evidential) {
                evidentialServedItemId = serve.servedItemId;
                quizMeEvidential = true;
                logger.info('foxy.real_practice.evidential_served', {
                  // P13: scope + provenance only — no concept title / studentId.
                  subject,
                  grade,
                  leadSource: lead?.source ?? null,
                });
              } else {
                // duplicate_in_session or insert_failed → NON-evidential (still
                // real + answerable, just no mastery move this turn).
                quizMeNonEvidentialReason = serve.reason;
                logger.info('foxy.real_practice.non_evidential', {
                  subject,
                  grade,
                  reason: serve.reason,
                });
              }
            } else {
              // Concept unresolvable → the mcqs stay real/answerable but the turn
              // is NON-evidential (cannot bind an evidential anchor).
              quizMeNonEvidentialReason = resolved.reason;
              logger.info('foxy.real_practice.non_evidential', {
                subject,
                grade,
                reason: resolved.reason,
              });
            }
          } catch (serveErr) {
            // Serving the evidential anchor is best-effort: a failure must NOT
            // break the turn. The student still sees the oracle-passed mcqs; they
            // are simply non-evidential this turn.
            quizMeNonEvidentialReason = 'serve_threw';
            logger.warn('foxy.real_practice.serve_threw', {
              subject,
              grade,
              error: serveErr instanceof Error ? serveErr.message : String(serveErr),
            });
          }
        }
      } catch (gateErr) {
        // Defense-in-depth: the gate fails closed internally per mcq, but if
        // anything unexpected throws here we refuse to show ungated mcqs and
        // serve the graceful fallback instead (P12).
        logger.warn('foxy.real_practice.gate_threw', {
          subject,
          grade,
          error: gateErr instanceof Error ? gateErr.message : String(gateErr),
        });
        structured = buildQuizMeFallbackResponse(subject);
        quizMeWireText = denormalizeFoxyResponse(structured);
      }
    } else {
      // No structured payload at all (upstream malformed) — real practice cannot
      // be honored. Serve the graceful fallback rather than a raw text blob.
      structured = buildQuizMeFallbackResponse(subject);
      quizMeWireText = denormalizeFoxyResponse(structured);
    }
  } else if (isPracticeTurn) {
    // ── Flag-OFF practice: unconditional anti-fake backstop (AC4, P6) ─────────
    // When ff_foxy_real_practice_v1 is OFF, a practice turn does NOT run the
    // oracle gate / mcq emission above — but it must STILL never ship a
    // claim-only turn (e.g. a token-truncated intro that says "Here are 5
    // questions" with no questions after it). Decoupled from isRealPractice ON
    // PURPOSE: run the SAME deterministic anti-fake strip the legacy path uses.
    // A turn carrying real questions (markdown (A)/(B)/(C)/(D) options) passes
    // through untouched; a claim with no questions is replaced by the graceful
    // bilingual fallback. No flag is read here, so flag-OFF practice is otherwise
    // byte-identical to today — only a genuinely claim-only turn is rewritten.
    const candidateText = structured ? denormalizeFoxyResponse(structured) : grounded.answer;
    const antiFake = stripFakeQuizClaim(candidateText);
    if (antiFake.claimOnly) {
      logger.warn('foxy.practice.fake_quiz_claim_stripped', {
        // P13: scope only — never the answer text or studentId.
        subject,
        grade,
        realPracticeEnabled,
      });
      structured = buildQuizMeFallbackResponse(subject);
      quizMeWireText = denormalizeFoxyResponse(structured);
    }
  }

  // When `structured` is present, the canonical assistant text is the
  // denormalized rendering (title + blocks → flat string with `$$ ... $$`
  // wrappers around math). When absent (legacy/kill-switch/malformed), keep
  // the existing behavior of storing the raw `answer` string.
  const assistantContent = structured
    ? denormalizeFoxyResponse(structured)
    : grounded.answer;

  // ── FOX-1 (P12): deterministic output content backstop ───────────────────
  // EVERY student-facing grounded answer passes through the deterministic
  // content screen before it is persisted or returned. The screen blocks only
  // on a high-precision profanity / self-harm / injection-token set (it does
  // NOT over-block legitimate CBSE curriculum — see output-screen.ts). On a
  // block (or a fail-safe screen error) we DO NOT persist or return the
  // unsafe text: we serve the existing hard-abstain envelope (response:'',
  // groundingStatus:'hard-abstain') exactly like a hard-abstain, refund the
  // quota, and emit category-only telemetry (P13: never the answer text).
  // We screen BOTH the denormalized rendering AND the raw `answer` (the legacy
  // string-only `response`), so neither surface can carry unscreened text.
  const outputScreen = screenStudentFacingText(assistantContent, { grade, subject });
  const rawAnswerScreen = screenStudentFacingText(grounded.answer, { grade, subject });
  if (!outputScreen.safe || !rawAnswerScreen.safe) {
    const screenCategories = [
      ...new Set([...outputScreen.categories, ...rawAnswerScreen.categories]),
    ];
    logger.warn('foxy.output.safety_blocked', {
      // P13: scope + stable category tags only — NEVER the answer text or id.
      subject,
      grade,
      mode,
      categories: screenCategories,
      traceId: grounded.trace_id,
    });
    logAudit(auth.userId!, {
      action: 'foxy.chat.safety_blocked',
      resourceType: 'foxy_sessions',
      resourceId: resolvedSessionId,
      details: {
        subject,
        grade,
        mode,
        categories: screenCategories,
        traceId: grounded.trace_id,
        flow: 'grounded-answer',
      },
    });
    // Refund the quota unit — the student did not receive a usable answer.
    await refundQuota(studentId, 'foxy_chat');

    // Phase 0.2 (ff_foxy_answer_continuation_v1): if the native-turns path
    // pre-inserted a pending assistant row (content='', pending=true) before
    // the LLM call, hard-abstaining here would leave it ORPHANED. loadHistory
    // already filters it out same-session, but an orphaned empty row would
    // otherwise linger and (pre-fix) leak into loadPriorSessionContext as an
    // empty `[previous · Foxy]` snippet. When the flag is ON, resolve the row
    // to the clean, self-screening bilingual SAFE_ABSTAIN_MESSAGE and clear
    // `pending` so it becomes a legitimate (safe) assistant turn rather than an
    // empty orphan. Best-effort — a failure here must NOT change the abstain
    // response the student receives. When OFF: byte-identical to today (the row
    // is left as-is; the read-side filter in loadPriorSessionContext is also
    // gated OFF). P13: category/scope-only failure log, never PII or answer text.
    if (preInsertedIds.assistantId) {
      const continuationEnabled = await isFeatureEnabled('ff_foxy_answer_continuation_v1', {
        role: 'student',
        userId: auth.userId!,
      });
      if (continuationEnabled) {
        try {
          const { error: cleanupErr } = await supabaseAdmin
            .from('foxy_chat_messages')
            .update({ content: SAFE_ABSTAIN_MESSAGE, pending: false })
            .eq('id', preInsertedIds.assistantId);
          if (cleanupErr) {
            logger.warn('foxy.output.safety_blocked_pending_cleanup_failed', {
              subject,
              grade,
              mode,
              error: cleanupErr.message,
            });
          }
        } catch (cleanupErr) {
          logger.warn('foxy.output.safety_blocked_pending_cleanup_threw', {
            subject,
            grade,
            mode,
            error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
          });
        }
      }
    }

    logFoxyAsk(0);
    return NextResponse.json({
      success: true,
      response: '',
      sessionId: resolvedSessionId,
      quotaRemaining: typeof remaining === 'number' ? remaining + 1 : remaining,
      tokensUsed: 0,
      groundingStatus: 'hard-abstain' as const,
      abstainReason: 'upstream_error' as const,
      suggestedAlternatives: [],
      traceId: grounded.trace_id,
    });
  }

  // Persist both turns. Capture the assistant row's id so we can return it
  // to the client for B'-5 feedback wiring (👍/👎 needs the DB UUID, not the
  // in-memory bubble id).
  //
  // Phase 2 of Foxy continuity fix (2026-05-18): when we pre-inserted the
  // rows before the LLM call (preInsertedIds.assistantId != null), UPDATE
  // the assistant row to clear `pending` and set content. The user row was
  // already inserted with pending=false so nothing to do there. Otherwise
  // (flag off, or pre-insert failed) run the legacy INSERT path verbatim.
  let assistantMessageId: string | null = null;
  if (preInsertedIds.assistantId) {
    try {
      const { error: updateErr } = await supabaseAdmin
        .from('foxy_chat_messages')
        .update({
          content: assistantContent,
          structured: structured ?? null,
          sources: sources.length > 0 ? sources : null,
          tokens_used: grounded.meta.tokens_used,
          pending: false,
        })
        .eq('id', preInsertedIds.assistantId);
      if (updateErr) {
        console.warn('[foxy] message update failed:', updateErr.message);
      }
      assistantMessageId = preInsertedIds.assistantId;
    } catch (saveErr) {
      console.warn(
        '[foxy] message update threw:',
        saveErr instanceof Error ? saveErr.message : String(saveErr),
      );
    }
  } else {
    const now = new Date().toISOString();
    try {
      const { data: insertedRows } = await supabaseAdmin
        .from('foxy_chat_messages')
        .insert([
          {
            session_id: resolvedSessionId,
            student_id: studentId,
            role: 'user',
            content: message,
            sources: null,
            tokens_used: null,
            created_at: now,
          },
          {
            session_id: resolvedSessionId,
            student_id: studentId,
            role: 'assistant',
            content: assistantContent,
            // CHECK constraint `structured_role_check` permits structured only on
            // assistant rows; the column is nullable so legacy/fallback writes
            // explicitly null. Migration: 20260430010000_foxy_chat_messages_add_structured.
            structured: structured ?? null,
            sources: sources.length > 0 ? sources : null,
            tokens_used: grounded.meta.tokens_used,
            // B'-5: persist the coach mode used for this turn so feedback rows
            // can be correlated with the pedagogical mode (socratic/answer/review).
            // Phase 2 read-path in resolveCoachMode reads recent feedback by
            // coach_mode_used to decide whether to keep or flip the mode.
            coach_mode_used: coachMode,
            created_at: new Date(Date.now() + 1).toISOString(),
          },
        ])
        .select('id, role');
      if (insertedRows) {
        const assistantRow = insertedRows.find((r) => r.role === 'assistant');
        assistantMessageId = (assistantRow?.id as string | undefined) ?? null;
      }
    } catch (saveErr) {
      console.warn(
        '[foxy] message save failed:',
        saveErr instanceof Error ? saveErr.message : String(saveErr),
      );
    }
  }

  // Phase 3 (2026-05-18): pending-expectations lifecycle (post-persist).
  //
  // Two passes:
  //   1. Resolve the PRIOR open expectation (if any): student's current
  //      message implicitly answered it. We mark it answered when the new
  //      reply acknowledges correctness, abandoned when it shifts topic.
  //   2. Extract the NEW expectation from the just-persisted assistant
  //      reply and persist it as the next-turn anchor.
  //
  // All best-effort. Flag-gated; OFF = byte-identical legacy.
  if (usePendingExpectations) {
    try {
      // ── Pass 1: resolve prior ─────────────────────────────────────────
      if (openExpectation) {
        const lifecycle = classifyExpectationLifecycle(assistantContent, openExpectation);
        if (lifecycle === 'answered') {
          // fire-and-forget; we already have assistantMessageId or null
          void markExpectationAnswered(supabaseAdmin, openExpectation.id, assistantMessageId);
        } else if (lifecycle === 'abandoned') {
          void markExpectationAbandoned(supabaseAdmin, openExpectation.id);
        }
        // 'unresolved' → leave row OPEN; next turn re-injects same prompt.
      }

      // ── Pass 2: extract new ───────────────────────────────────────────
      const newExpectation = extractExpectation(assistantContent, {
        structured: (structured ?? null) as StructuredAssistantPayload | null,
      });
      if (newExpectation) {
        void writeExpectation(supabaseAdmin, {
          sessionId: resolvedSessionId,
          studentId,
          expectation: newExpectation,
          subject,
          grade,
          chapter: chapter ?? null,
          askedMessageId: assistantMessageId,
        });
      }
    } catch (expErr) {
      // Helpers already swallow their own errors; this catch is just
      // defensive against extractor surprises.
      console.warn(
        '[foxy] pending-expectations post-persist failed:',
        expErr instanceof Error ? expErr.message : String(expErr),
      );
    }
  }

  // ── Part B2: chat-observed struggle detection (NON-MASTERY telemetry) ────
  // Detect confusion patterns in the student's message + recent session turns
  // and PUBLISH learner.struggle_observed (IDs/enums only). This NEVER writes
  // mastery — the registry forbids any subscriber from consuming this event to
  // move a mastery surface. Best-effort, fire-and-forget; flag-gated inside
  // publishEvent (no-op when ff_event_bus_v1 is OFF). P13: no student words on
  // the bus — only the studentId/sessionId/conceptId/subjectCode/signalType.
  try {
    const recentStudentMessages = [
      ...history.filter((m) => m.role === 'user').map((m) => m.content),
      message,
    ].slice(-8);
    const signalType = detectStruggleSignal({
      message,
      recentStudentMessages,
      coachDirective,
    });
    if (signalType) {
      // Bind a concept when this turn resolved one (evidential serve), else null.
      let struggleConceptId: string | null = null;
      try {
        const lead = selectLeadConcept(cognitiveCtx);
        const resolved = await resolveLeadConceptId(supabaseAdmin, {
          subject,
          grade,
          chapter,
          leadConceptTitle: lead?.title ?? null,
        });
        struggleConceptId = resolved.ok ? resolved.concept.id : null;
      } catch {
        struggleConceptId = null;
      }
      // Best-effort tenant scope (B2C → null).
      let struggleTenantId: string | null = null;
      try {
        const { data: schoolRow } = await supabaseAdmin
          .from('students')
          .select('school_id')
          .eq('id', studentId)
          .maybeSingle();
        struggleTenantId = (schoolRow as { school_id?: string | null } | null)?.school_id ?? null;
      } catch {
        struggleTenantId = null;
      }
      void publishEvent(supabaseAdmin, {
        kind: 'learner.struggle_observed',
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        actorAuthUserId: auth.userId!,
        tenantId: struggleTenantId,
        idempotencyKey: `struggle:${resolvedSessionId}:${signalType}:${Date.now()}`,
        payload: {
          studentId,
          sessionId: resolvedSessionId,
          conceptId: struggleConceptId,
          subjectCode: subject ? subject.toLowerCase() : subject,
          signalType,
          occurredAt: new Date().toISOString(),
        },
      });
      logger.info('foxy.struggle.signal_emitted', {
        // P13: enum + scope only, never the student's message or studentId.
        subject,
        grade,
        signalType,
        conceptBound: struggleConceptId !== null,
      });
    }
  } catch (struggleErr) {
    console.warn(
      '[foxy] struggle detection failed:',
      struggleErr instanceof Error ? struggleErr.message : String(struggleErr),
    );
  }

  // ── Phase 1C: per-turn PERCEPTION classifier (OBSERVABILITY telemetry) ─────
  // Turn this Foxy turn into structured, PII-free signal (topic / Bloom /
  // misconception / struggle / intent) and PUBLISH learner.turn_classified.
  //
  // FULLY DARK IN PRODUCTION until BOTH (a) ff_foxy_perception_v1 is ON AND (b)
  // PYTHON_AI_BASE_URL is wired in (callPythonMol returns null when it's empty).
  //
  // FIRE-AND-FORGET: the ENTIRE step — the flag read, the Python classification
  // call, AND the publish — runs inside a single `void`ed async IIFE. Nothing
  // here is awaited on the hot path, so the student's answer is returned below
  // with ZERO added latency, and a classifier failure can NEVER affect the turn.
  // When the flag is OFF the IIFE returns immediately (no classifier call, no
  // DB write) → the turn is byte-identical to today.
  //
  // OBSERVABILITY ONLY: this NEVER writes a mastery surface. It publishes to the
  // bus via publishEvent (itself a no-op when ff_event_bus_v1 is OFF). P13: the
  // event carries codes/ids/enums ONLY — the student's message text is sent to
  // the internal Python classifier but is never echoed onto the bus or logs.
  void (async () => {
    try {
      // Off-hot-path gate — awaited HERE (in the background), never above.
      const perceptionEnabled = await isFeatureEnabled('ff_foxy_perception_v1', {
        role: 'student',
        userId: auth.userId!,
      });
      // No assistant message id → no valid `messageId` for the event envelope
      // (the registry requires a UUID). Skip rather than emit an invalid event.
      if (!perceptionEnabled || !assistantMessageId) return;

      const classification = await classifyTurn({
        studentId,
        grade: enrolledGrade,
        subject,
        chapter,
        studentMessage: message,
        foxyAnswer: assistantContent,
        authToken: callerBearerToken,
        supabase: supabaseAdmin,
      });
      if (!classification) return;

      // Best-effort tenant scope (B2C → null), mirroring the struggle event.
      let perceptionTenantId: string | null = null;
      try {
        const { data: schoolRow } = await supabaseAdmin
          .from('students')
          .select('school_id')
          .eq('id', studentId)
          .maybeSingle();
        perceptionTenantId =
          (schoolRow as { school_id?: string | null } | null)?.school_id ?? null;
      } catch {
        perceptionTenantId = null;
      }

      await publishEvent(supabaseAdmin, {
        kind: 'learner.turn_classified',
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        actorAuthUserId: auth.userId!,
        tenantId: perceptionTenantId,
        idempotencyKey: `turn_classified:${resolvedSessionId}:${assistantMessageId}`,
        payload: {
          studentId,
          foxySessionId: resolvedSessionId,
          messageId: assistantMessageId,
          subjectCode: subject ? subject.toLowerCase() : subject,
          grade: enrolledGrade,
          chapterNumber: classification.chapterNumber,
          topicId: classification.topicId,
          bloomLevel: classification.bloomLevel,
          misconceptionCode: classification.misconceptionCode,
          struggleSignal: classification.struggleSignal,
          intent: classification.intent,
        },
      });
      logger.info('foxy.perception.turn_classified', {
        // P13: enums/booleans + scope only — never the student's message, id,
        // or the resolved topic id.
        subject,
        grade: enrolledGrade,
        bloomLevel: classification.bloomLevel,
        struggleSignal: classification.struggleSignal,
        misconceptionBound: classification.misconceptionCode !== null,
        topicBound: classification.topicId !== null,
      });
    } catch (perceptionErr) {
      console.warn(
        '[foxy] perception classify failed:',
        perceptionErr instanceof Error ? perceptionErr.message : String(perceptionErr),
      );
    }
  })();

  // Post-response cognitive logging (fire-and-forget)
  if (cognitiveCtx.nextAction) {
    Promise.resolve(
      supabaseAdmin
        .from('cme_action_log')
        .insert({
          student_id: studentId,
          action_type: cognitiveCtx.nextAction.actionType,
          concept_id: null,
          reason: cognitiveCtx.nextAction.reason,
          was_followed: true,
          outcome: 'foxy_responded',
        }),
    ).catch((err: unknown) => {
      console.warn('[foxy] cognitive action log failed:', err instanceof Error ? err.message : String(err));
    });
  }

  Promise.resolve(
    supabaseAdmin
      .from('foxy_sessions')
      .update({
        cognitive_context_loaded: true,
        last_cme_action: cognitiveCtx.nextAction?.actionType ?? null,
      })
      .eq('id', resolvedSessionId),
  ).catch((err: unknown) => {
    console.warn('[foxy] session cognitive update failed:', err instanceof Error ? err.message : String(err));
  });

  logAudit(auth.userId!, {
    action: 'foxy.chat',
    resourceType: 'foxy_sessions',
    resourceId: resolvedSessionId,
    details: {
      subject, grade, chapter, mode,
      tokensUsed: grounded.meta.tokens_used,
      model: grounded.meta.claude_model,
      traceId: grounded.trace_id,
      confidence: grounded.confidence,
      ragChunksFound: grounded.citations.length,
      cognitiveContextLoaded: true,
      masteryLevel: cognitiveCtx.masteryLevel,
      weakTopicCount: cognitiveCtx.weakTopics.length,
      knowledgeGapCount: cognitiveCtx.knowledgeGaps.length,
      revisionDueCount: cognitiveCtx.revisionDue.length,
      cmeAction: cognitiveCtx.nextAction?.actionType ?? null,
      flow: 'grounded-answer',
      // Adoption telemetry for the structured-rendering rollout. `true` only
      // when the upstream returned a structured payload AND it passed the
      // boundary validation. Helps ops measure (a) Edge Function rollout
      // progress and (b) malformed-payload rate (gap between
      // upstream-presence and persisted-presence).
      structured_present: structured !== null,
    },
  });

  // Build soft upgrade prompt if quota near exhaustion. `limit` is the same
  // DB-authoritative cap the quota RPC enforced against (returned by
  // checkAndIncrementQuota) — never a Node-side guess. The unlimited paid plans
  // return UNLIMITED_QUOTA, so `remaining` is astronomically large and no prompt
  // is ever shown; only the finite free tier has an UPGRADE_PROMPTS entry.
  // `plan` is already canonical (free|starter|pro|unlimited) via
  // resolveFoxyEnrollmentScope.
  const upgradeConfig = UPGRADE_PROMPTS[plan];
  let upgradePrompt: { message: string; messageHi: string; nextPlan: string; remaining: number } | null = null;
  if (
    upgradeConfig
    && limit < UNLIMITED_QUOTA
    && typeof remaining === 'number'
    && remaining <= upgradeConfig.showAtRemaining
  ) {
    upgradePrompt = {
      message: upgradeConfig.message.replace('{remaining}', String(remaining)),
      messageHi: upgradeConfig.messageHi.replace('{remaining}', String(remaining)),
      nextPlan: upgradeConfig.nextPlan,
      remaining,
    };
  }

  // Phase 0: NCERT surfaces (sources, diagrams) are NOT echoed to the client.
  // Server-side persistence and grounding still use them; this strip only
  // affects the wire shape so the student UI never displays raw NCERT
  // citations. `sources` is still computed above and saved to
  // foxy_chat_messages.sources for analytics/debug.
  void diagrams;

  // Phase 0 Fix 0.5: surface groundedFromChunks + citationsCount so the
  // client analytics layer can emit honest `was_grounded` telemetry.
  // Same value as `groundedFromChunksRaw` above; aliased here so the wire
  // shape stays identical to its pre-audit form.
  const groundedFromChunks = groundedFromChunksRaw;
  const citationsCount = grounded.citations.length;

  // ── Phase 2.1 (FIX 2): advance the per-session lesson step ─────────────────
  // Reached ONLY on a successful, safety-screened grounded teaching answer — the
  // abstain, legacy-fallback, out-of-scope, math-solve, and safety-block paths
  // all return earlier and never reach here, so they never advance the lesson.
  // `teachingPlan` is non-null only on a teaching turn with
  // ff_foxy_teaching_director_v1 ON and a successful compose. Best-effort /
  // fire-and-forget: persistLessonProgress is internally guarded and never
  // throws, and a persist failure never affects this turn's response.
  if (teachingPlan) {
    void persistLessonProgress(resolvedSessionId, teachingPlan);
  }

  logFoxyAsk(grounded.meta.tokens_used ?? null);
  return NextResponse.json({
    success: true,
    // `response` stays as the legacy plain string for backward compat. New
    // clients should prefer `structured` when present and fall back to
    // `response` only when `structured` is absent (legacy/kill-switch/
    // upstream-without-structured/malformed-payload paths).
    //
    // For a rejected/failed quiz_me, `quizMeWireText` is the denormalized
    // graceful-fallback text so string-only clients also avoid the broken MCQ.
    response: quizMeWireText ?? grounded.answer,
    sessionId: resolvedSessionId,
    quotaRemaining: remaining,
    tokensUsed: grounded.meta.tokens_used,
    confidence: grounded.confidence,
    groundingStatus: isUnverified ? ('unverified' as const) : ('grounded' as const),
    groundedFromChunks,
    citationsCount,
    traceId: grounded.trace_id,
    // B'-5 Phase 2: surface the persisted assistant-message UUID so the
    // client can call /api/foxy/feedback with it from the 👍/👎 buttons.
    // Null when the persistence write failed; client falls back to the
    // legacy track_ai_quality aggregate counter in that case.
    messageId: assistantMessageId,
    ...(upgradePrompt ? { upgradePrompt } : {}),
    // Only include `structured` when the helper produced a validated payload.
    // Omitting (vs. including null) keeps the wire shape backward-compatible
    // with clients that haven't been updated to read this field yet.
    ...(structured ? { structured } : {}),
    // ── Part B1: evidential quiz-me contract on the wire ───────────────────
    // Present on a "Quiz me" turn AND on a real-practice turn that produced >=1
    // oracle-passed mcq. `quizMe.evidential` tells the client whether answering
    // the FIRST mcq moves mastery: when true, the client POSTs
    // { served_item_id, chosen_index, attempt_id, response_time_ms } to
    // /api/foxy/quiz-answer to commit the graded result through the sanctioned
    // path. When false, the MCQ is practice-only (no mastery move) and the
    // client renders it without the served_item_id (no grade endpoint call).
    // (For real practice the renderer binds this to the FIRST mcq; every other
    // mcq renders as real self-check — no wire contract needed for those.)
    ...(isQuizMe || realPracticeApplied
      ? {
          quizMe: quizMeEvidential
            ? { evidential: true as const, servedItemId: evidentialServedItemId }
            : { evidential: false as const, reason: quizMeNonEvidentialReason },
        }
      : {}),
    // ── Phase 2.1: Teaching Director wire fields ───────────────────────────
    // Present ONLY on a teaching turn with ff_foxy_teaching_director_v1 ON AND
    // a successfully composed plan. `suggestedButtons` is the context-aware
    // subset of the four primary post-answer actions (got_it / explain_simpler
    // / show_example / quiz_me) the UI should render; `nextActions` is the
    // advisory follow-up list (bilingual labels, P7). When the flag is OFF or
    // the Director failed, both keys are OMITTED — the client falls back to the
    // static 4-button bar (ChatBubble treats an absent set as "render all").
    ...(teachingPlan
      ? {
          suggestedButtons: teachingPlan.suggestedButtons,
          nextActions: teachingPlan.recommendedNextActions,
        }
      : {}),
  });
}

// ─── Streaming turn handler (Phase 1.1) + streamingHeaders moved to
//     ./_lib/streaming (H1 REFACTOR M6c / Step 8). Imported below and called
//     identically at the same call site (handleFoxyPost streaming branch).
//     The single `callGroundedAnswerStream` retrieval (REG-50) + the
//     refund-on-error quota coupling are byte-identical to the originals.
//     extractValidatedStructured / refundQuota / REFUND_ABSTAIN_REASONS /
//     classifyExpectationLifecycle are imported there from their _lib homes —
//     not duplicated. ───────────────────────────────────────────────────────

// ─── GET: fetch chat history for a session ────────────────────────────────────

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await authorizeRequest(request, 'foxy.chat', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse!;

  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');

  if (!sessionId) {
    return errorJson('sessionId is required.', 'sessionId dena zaroori hai.', 400);
  }

  const studentId = auth.studentId!;

  const { data: session } = await supabaseAdmin
    .from('foxy_sessions')
    .select('id, subject, grade, chapter, mode, created_at')
    .eq('id', sessionId)
    .eq('student_id', studentId)
    .single();

  if (!session) {
    return errorJson('Session not found.', 'Session nahi mila.', 404);
  }

  // Phase 0: do NOT return persisted `sources` to the client. The column
  // remains populated server-side for analytics/debug, but the GET handler
  // intentionally excludes it from the SELECT so it cannot leak.
  //
  // Phase 2 (structured rendering): include the `structured` JSONB column so
  // the chat page can re-render historical assistant turns with the structured
  // renderer on session resume. NULL for legacy assistant rows persisted
  // before the structured-output migration; the renderer falls back to
  // `content` (TEXT) in that case. User rows are NULL by DB CHECK constraint
  // (`structured_role_check` in migration 20260430010000).
  const { data: messages } = await supabaseAdmin
    .from('foxy_chat_messages')
    .select('id, role, content, structured, tokens_used, coach_mode_used, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  return NextResponse.json({
    success: true,
    session,
    messages: messages ?? [],
  });
}
