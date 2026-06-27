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
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  logLearningEvent,
  logSystemMetric,
  generateCorrelationId,
  generateSessionId,
} from '@/lib/monitoring/log-event';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { validateSubjectWrite } from '@/lib/subjects';
import {
  EMPTY_LONG_MEMORY,
  type LongMemorySnapshot,
  buildLongMemoryPromptSection,
  loadLongMemorySnapshot,
} from '@/lib/learn/foxy-long-memory';
import { callGroundedAnswer, callGroundedAnswerStream, type GroundedRequest, type Citation, type SuggestedAlternative, type AbstainReason } from '@/lib/ai/grounded-client';
import { PER_PLAN_TIMEOUT_MS, SOFT_CONFIDENCE_BANNER_THRESHOLD } from '@/lib/grounding-config';
import { classifyIntent, routeIntent } from '@/lib/ai';
import { QUIZ_PATTERNS, classifyMathSolve } from '@/lib/ai/workflows/foxy-router';
import {
  runMathSolvePipeline,
  type MathPipelineResult,
} from '@/lib/ai/math/solve-pipeline';
import { isMathPipelineEnabled, isCurriculumGuardEnabled } from '@/lib/foxy/math-flag';
import {
  validateCurriculumScope,
  type CurriculumScopeResult,
} from '@/lib/foxy/curriculum-scope';
import { buildTenantOverrideSection } from '@/lib/ai/prompts/tenant-overrides';
import { FoxyResponseSchema, type FoxyResponse } from '@/lib/foxy/schema';
import { normalizeFoxyResponseInline } from '@/lib/foxy/normalize-inline';
import { recoverFoxyResponseFromText } from '@/lib/foxy/recover-from-text';
import { denormalizeFoxyResponse } from '@/lib/foxy/denormalize';
import { gateQuizMeMcq, findSingleMcqBlock } from '@/lib/foxy/quiz-me-oracle-gate';
import { resolveFoxyEnrollmentScope } from '@/lib/foxy-scope';
import {
  resolveLeadConceptId,
  serveEvidentialItem,
  payloadFromMcqBlock,
} from '@/lib/foxy/evidential-quiz';
import { parseFoxyChapterNumber } from '@/lib/foxy/chapter-parser';
// Re-export the chapter-parser helper so test modules can import it from the
// route's public surface (parity with mapFoxyModeToEventMode). chapter-parser.ts
// remains the single source of truth — this is plumbing only, no behavior change.
export { parseFoxyChapterNumber };
import { detectStruggleSignal } from '@/lib/foxy/struggle-detection';
import type { LlmGrader } from '@/lib/ai/validation/quiz-oracle';
import { parseLlmGraderResponse } from '@/lib/ai/validation/quiz-oracle';
import {
  QUIZ_ORACLE_GRADER_SYSTEM_PROMPT,
  buildQuizOracleGraderUserPrompt,
} from '@/lib/ai/validation/quiz-oracle-prompts';
import { callClaude } from '@/lib/ai';
import { buildExpandedGoalSection } from '@/lib/goals/goal-personas';
import { fetchRecentLabContext, type LabContextEntry } from '@/lib/foxy/recent-lab-context';
import { buildLabContextSection } from '@/lib/foxy/foxy-lab-prompt';
import { maybeBuildFoxyContextBlock } from '@/lib/state/context/foxy-context-bridge';
import { randomUUID } from 'node:crypto';
import { publishEvent } from '@/lib/state/events/publish';
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
} from '@/lib/learn/foxy-expectations';
// Digital Twin + Knowledge Graph (Slice 1). Flag-gated by ff_digital_twin_v1
// (default OFF); helpers are pure imports so OFF stays byte-identical to legacy.
import {
  buildTwinContext,
  renderTwinPromptSection,
  type TwinContext,
  type TwinMemoryHighlightInput,
  type TwinSnapshotInput,
} from '@/lib/learn/build-twin-context';
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
  DAILY_QUOTA,
  DEFAULT_QUOTA,
  UPGRADE_PROMPTS,
  type RagSource,
  type DiagramRef,
  type ChatMessage,
  type CognitiveContext,
  EMPTY_COGNITIVE_CONTEXT,
  errorJson,
  mapFoxyModeToEventMode,
} from './_lib/constants';
// Re-export the symbols that test modules import from the route's public
// surface. The new _lib/constants.ts module is the single source of truth —
// this is plumbing only, no behavior change. (parseFoxyChapterNumber above is
// re-exported the same way.)
export type { CognitiveContext };
export { EMPTY_COGNITIVE_CONTEXT, mapFoxyModeToEventMode };
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
// Re-export resolveSession from the route's public surface — the M4 module is
// the single source of truth, but two test modules import resolveSession from
// '@/app/api/foxy/route'. This is plumbing only, no behavior change.
export { resolveSession };

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_MESSAGE_LENGTH = 1000;
const RAG_MATCH_COUNT = 5;
// MAX_HISTORY_TURNS + SESSION_IDLE_MINUTES moved to ./_lib/session (H1
// REFACTOR M4) alongside the session/history helpers that are their only
// consumers.

// ─── Helper: structured-payload extraction (defense-in-depth) ───────────────
//
// The grounded-answer Edge Function may include a `structured` field on
// successful responses (a `FoxyResponse` per src/lib/foxy/schema.ts). The
// service-side already validates the payload, but we re-validate at this API
// boundary because the JSONB column we are about to write is trusted by every
// downstream reader (renderer, analytics, parent portal). A bug on the Edge
// Function side must NOT poison the database.
//
// Behavior:
//   - upstream returned no `structured` field          → returns null (legacy path)
//   - upstream returned a valid FoxyResponse           → returns the parsed value
//   - upstream returned a malformed `structured` field → returns null AND logs
//     `foxy.structured.invalid_payload` so ops can detect Edge Function drift.
//
// The route never throws on a bad structured payload — the legacy `response`
// (string) is always populated so the student still sees an answer.
function extractValidatedStructured(
  upstream: unknown,
  ctx: {
    traceId: string;
    studentId: string;
    subject: string;
    grade: string;
    /**
     * Optional fallback text searched for an inline FoxyResponse when the
     * upstream `structured` field is missing or invalid. In production we
     * observed the model emitting the structured-output JSON inline in
     * `answer` (often inside a ```json fence) instead of on a separate
     * `structured` field — without this fallback the raw JSON leaked into
     * the chat bubble via the markdown renderer. See PR description for
     * the screenshot that triggered this fix.
     */
    fallbackText?: string;
  },
): FoxyResponse | null {
  // Read defensively: until grounded-client.ts adds the field to its type,
  // TypeScript doesn't know about it. The runtime shape is what matters.
  const candidate = (upstream as { structured?: unknown } | null | undefined)
    ?.structured;

  // Mechanical, in-process normalizer for the structured payload's text/label
  // fields. Canonicalises `$`/`$$` inline math to the `\(`/`\[` form the
  // renderer + prompt standardise on, and strips stray markdown emphasis the
  // prompt already forbids. No LLM call, no network. Re-validates against the
  // schema and falls back to the already-valid input if (defensively) the
  // re-validation ever fails — normalization only shrinks/holds field length,
  // so a valid payload stays valid. P12: never lowers the validation bar.
  const normalizeAndRevalidate = (valid: FoxyResponse): FoxyResponse => {
    const normalized = normalizeFoxyResponseInline(valid);
    const reparsed = FoxyResponseSchema.safeParse(normalized);
    return reparsed.success ? reparsed.data : valid;
  };

  if (candidate !== undefined && candidate !== null) {
    const parsed = FoxyResponseSchema.safeParse(candidate);
    if (parsed.success) return normalizeAndRevalidate(parsed.data);

    // P12 defense-in-depth: never write malformed JSON into the JSONB column.
    // We log the issue but continue — recovery from `fallbackText` below may
    // still produce a valid payload, and even if it doesn't, the legacy
    // `response` string still populates `content` so the student turn is
    // preserved.
    logger.error('foxy.structured.invalid_payload', {
      traceId: ctx.traceId,
      // Intentionally NOT logging studentId at error-level (P13). Subject +
      // grade are non-PII context for ops triage.
      subject: ctx.subject,
      grade: ctx.grade,
      // First 3 issues only, to bound log size.
      issueCount: parsed.error.issues.length,
      issuePreview: parsed.error.issues.slice(0, 3).map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }

  // Fallback: extract a FoxyResponse from inline text when the upstream
  // `structured` field is absent/malformed. Recovers from the prod regression
  // where the model wrote ```json {...}``` into `answer` and the structured
  // payload was therefore missing from the upstream envelope.
  if (ctx.fallbackText) {
    const recovered = recoverFoxyResponseFromText(ctx.fallbackText);
    if (recovered) {
      logger.info('foxy.structured.recovered_from_text', {
        traceId: ctx.traceId,
        subject: ctx.subject,
        grade: ctx.grade,
        // Telemetry only — lets ops measure how often the Edge Function
        // drops `structured` so the upstream fix can be prioritised.
      });
      return normalizeAndRevalidate(recovered);
    }
  }

  return null;
}

// ─── Session + history helpers (resolveSession, loadHistory,
//     loadPriorSessionContext, buildPriorSessionPromptSection) moved to
//     ./_lib/session (H1 REFACTOR M4). Imported above; resolveSession is
//     re-exported there for its two test modules. ────────────────────────────

// ─── Phase 3 helper: classify lifecycle outcome of a prior open expectation ──

// Acknowledgment signals — Foxy explicitly accepted/closed the answer.
// English + Hinglish forms; Devanagari handled via Hindi keywords below.
const FOXY_ACK_PATTERNS: RegExp[] = [
  /\b(correct|right answer|exactly right|exactly|well done|good job|good work|nicely done|nice work|spot on|perfect)\b/i,
  /\b(bilkul sahi|bilkul|sahi|shabash|wah|ekdum sahi)\b/i,
  /\b(that's it|that is it|you got it|you've got it|you nailed it)\b/i,
  /\b(close|almost|not quite|partly right|partially correct|good try|nice try)\b/i,
  /\b(actually|the answer is|in fact)\b.{0,80}\b(is|are|equals?)\b/i,
];

const HINDI_ACK_RE = /(सही|बिल्कुल|शाबाश|बहुत बढ़िया|वाह)/;

/**
 * Classify what happened to a prior open expectation after Foxy's next reply.
 *   - 'answered'   → Foxy explicitly acknowledged / addressed the answer
 *   - 'abandoned'  → Foxy moved on with a new question and no acknowledgment
 *   - 'unresolved' → ambiguous; leave OPEN so we re-inject next turn
 *
 * Heuristic by design — we accept some misclassification because the safety
 * net is the 24h expires_at sweep. Tracked as `expectation_abandoned_rate`
 * for future tuning.
 */
// Progression expectation kinds whose ladder anchor must SURVIVE an ack-only
// reply (Part 2C). For 'choose_topic'/'next_topic' an acknowledgment alone
// ("Correct! / Bilkul sahi!") must NOT close the anchor — the student hasn't
// actually picked/engaged the next ladder step, so we keep the row OPEN
// ('unresolved') and re-inject it next turn. Other kinds keep the legacy
// ack → 'answered' behaviour.
const PROGRESSION_LIFECYCLE_KINDS = new Set<OpenExpectation['kind']>([
  'choose_topic',
  'next_topic',
]);

function classifyExpectationLifecycle(
  assistantReply: string,
  prior: OpenExpectation,
): 'answered' | 'abandoned' | 'unresolved' {
  const text = (assistantReply ?? '').trim();
  if (!text) return 'unresolved';

  const ack = FOXY_ACK_PATTERNS.some((re) => re.test(text)) || HINDI_ACK_RE.test(text);

  // Did Foxy ask a new question? "-> " marker is the strongest signal.
  // Any `?` in the reply is a weaker signal.
  const hasArrowPrompt = /^->\s+/m.test(text);
  const hasAnyQuestion = text.includes('?');

  // Progression ladder anchors (choose_topic / next_topic): an ack-only reply
  // does NOT close the ladder. Keep it OPEN ('unresolved') so the next turn
  // re-anchors and the chapter progression is never silently dropped.
  if (PROGRESSION_LIFECYCLE_KINDS.has(prior.kind)) {
    return 'unresolved';
  }

  if (ack) {
    // Acknowledged: counts as answered even if a new question follows.
    return 'answered';
  }
  if (hasArrowPrompt || hasAnyQuestion) {
    // New question without acknowledgment → Foxy moved on.
    return 'abandoned';
  }
  // No acknowledgment, no new question. Could be a clarifying statement
  // mid-thread — leave open.
  return 'unresolved';
}

// ─── Helper: load cognitive context from CME tables ─────────────────────────

async function loadCognitiveContext(
  studentId: string,
  subject: string,
  grade: string,
  chapter: string | null = null,
): Promise<CognitiveContext> {
  void grade; // reserved for future grade-scoped mastery lookups
  try {
    const { data: subjectRow } = await supabaseAdmin
      .from('subjects')
      .select('id')
      .ilike('code', subject)
      .maybeSingle();
    const subjectId = subjectRow?.id ?? null;

    // Resolve chapter id when caller passed a chapter (number or title) so we
    // can scope the per-LO skill query down to that chapter; otherwise fall
    // back to the subject-wide weakest LOs.
    let chapterId: string | null = null;
    if (chapter && subjectId) {
      try {
        const chapterNum = parseFoxyChapterNumber(chapter);
        let chQuery = supabaseAdmin
          .from('chapters')
          .select('id')
          .eq('subject_id', subjectId)
          .eq('grade', grade);
        if (chapterNum !== null) {
          chQuery = chQuery.eq('chapter_number', chapterNum);
        } else {
          chQuery = chQuery.ilike('title', chapter);
        }
        const { data: chRow } = await chQuery.limit(1).maybeSingle();
        chapterId = chRow?.id ?? null;
      } catch {
        // Non-fatal — fall back to subject-wide LO scope.
      }
    }

    const [masteryRes, gapsRes, revisionRes, errorsRes, loSkillsRes, misconceptionsRes] = await Promise.all([
      supabaseAdmin
        .from('concept_mastery')
        .select('mastery_probability, mastery_level, attempts, topic_id, curriculum_topics(title, subject_id)')
        .eq('student_id', studentId)
        .order('mastery_probability', { ascending: true })
        .limit(30),

      supabaseAdmin
        .from('knowledge_gaps')
        .select('topic_id, prerequisite_topic_id, gap_type, is_resolved, description, curriculum_topics!knowledge_gaps_topic_id_fkey(title), prereq:curriculum_topics!knowledge_gaps_prerequisite_topic_id_fkey(title)')
        .eq('student_id', studentId)
        .eq('is_resolved', false)
        .limit(5),

      supabaseAdmin
        .from('concept_mastery')
        .select('mastery_probability, next_review_date, topic_id, curriculum_topics(title)')
        .eq('student_id', studentId)
        .not('next_review_date', 'is', null)
        .lte('next_review_date', new Date().toISOString().split('T')[0])
        .order('next_review_date', { ascending: true })
        .limit(5),

      supabaseAdmin
        .from('cme_error_log')
        .select('error_type')
        .eq('student_id', studentId)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),

      // Phase 2: per-LO BKT skill state (top 10 weakest by p_know). Joined to
      // learning_objectives so we can render the LO statement + chapter scope.
      // chapter_id filter is applied client-side after the join because the
      // PostgREST !inner join requires the filter on the joined alias.
      (() => {
        let q = supabaseAdmin
          .from('student_skill_state')
          .select('p_know, p_slip, theta, learning_objectives!inner(code, statement, chapter_id, chapters!inner(subject_id))')
          .eq('student_id', studentId)
          .order('p_know', { ascending: true })
          .limit(50);
        if (chapterId) {
          q = q.eq('learning_objectives.chapter_id', chapterId);
        } else if (subjectId) {
          q = q.eq('learning_objectives.chapters.subject_id', subjectId);
        }
        return q;
      })(),

      // Phase 2: recent (30d) wrong-answer misconceptions for this student.
      // Join quiz_responses → question_misconceptions on
      // (question_id, distractor_index = selected_option). Filter is_correct=false.
      // We pull both the misconception code/label and the remediation text
      // from the wrong_answer_remediations cache (best-effort).
      supabaseAdmin
        .from('quiz_responses')
        .select('question_id, selected_option, is_correct, created_at, question_misconceptions!inner(misconception_code, misconception_label, distractor_index, remediation_chunk_id)')
        .eq('student_id', studentId)
        .eq('is_correct', false)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .limit(200),
    ]);

    const subjectMastery = (masteryRes.data ?? []).filter((m: any) => {
      if (!subjectId) return true;
      return m.curriculum_topics?.subject_id === subjectId;
    });

    const weakTopics = subjectMastery
      .filter((m: any) => (m.mastery_probability ?? 0) < 0.6)
      .slice(0, 5)
      .map((m: any) => ({
        title: m.curriculum_topics?.title ?? 'Unknown topic',
        mastery: Math.round((m.mastery_probability ?? 0) * 100),
        attempts: m.attempts ?? 0,
      }));

    const strongTopics = subjectMastery
      .filter((m: any) => (m.mastery_probability ?? 0) >= 0.8)
      .slice(-3)
      .map((m: any) => ({
        title: m.curriculum_topics?.title ?? 'Unknown topic',
        mastery: Math.round((m.mastery_probability ?? 0) * 100),
      }));

    const knowledgeGaps = (gapsRes.data ?? []).map((g: any) => ({
      target: g.curriculum_topics?.title ?? g.description ?? '',
      prerequisite: g.prereq?.title ?? '',
      gapType: g.gap_type ?? '',
    }));

    const revisionDue = (revisionRes.data ?? []).map((r: any) => ({
      title: r.curriculum_topics?.title ?? 'Unknown',
      lastReviewed: r.next_review_date ?? '',
      mastery: Math.round((r.mastery_probability ?? 0) * 100),
    }));

    const errorCounts: Record<string, number> = {};
    for (const e of errorsRes.data ?? []) {
      errorCounts[e.error_type] = (errorCounts[e.error_type] || 0) + 1;
    }
    const recentErrors = Object.entries(errorCounts)
      .map(([errorType, count]) => ({ errorType, count }))
      .sort((a, b) => b.count - a.count);

    // Phase 2: Process per-LO skill state — keep at most 10 weakest LOs.
    // The PostgREST !inner join filter on chapters.subject_id may not narrow
    // perfectly when chapterId is null (PostgREST sometimes ignores nested
    // filters silently); we double-filter client-side as a defense.
    // PostgREST returns nested joins as either an object (when the FK is
    // unique) or an array (when ambiguous). We normalize both shapes.
    type LoSkillRow = {
      p_know: number | string | null;
      p_slip: number | string | null;
      theta: number | string | null;
      learning_objectives:
        | {
            code: string;
            statement: string;
            chapter_id: string;
            chapters: { subject_id: string } | Array<{ subject_id: string }> | null;
          }
        | Array<{
            code: string;
            statement: string;
            chapter_id: string;
            chapters: { subject_id: string } | Array<{ subject_id: string }> | null;
          }>
        | null;
    };
    const loSkillsRaw = (loSkillsRes.data ?? []) as unknown as LoSkillRow[];
    const loSkills = loSkillsRaw
      .map((row) => {
        const lo = Array.isArray(row.learning_objectives)
          ? row.learning_objectives[0]
          : row.learning_objectives;
        if (!lo) return null;
        const chap = Array.isArray(lo.chapters) ? lo.chapters[0] : lo.chapters;
        return {
          row,
          loCode: lo.code,
          loStatement: lo.statement,
          chapterIdForRow: lo.chapter_id,
          subjectIdForRow: chap?.subject_id ?? null,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .filter((entry) => {
        if (chapterId) return entry.chapterIdForRow === chapterId;
        if (subjectId) return entry.subjectIdForRow === subjectId;
        return true;
      })
      .slice(0, 10)
      .map((entry) => ({
        loCode: entry.loCode,
        loStatement: entry.loStatement,
        pKnow: Number(entry.row.p_know ?? 0),
        pSlip: Number(entry.row.p_slip ?? 0),
        theta: Number(entry.row.theta ?? 0),
      }));

    // Phase 2: Process recent misconceptions — keep ones where the student's
    // selected_option matches the curated distractor_index, group by code,
    // count occurrences, take top 3, then enrich with cached remediation text.
    type MisconceptionJoinRow = {
      question_id: string;
      selected_option: number | null;
      question_misconceptions:
        | {
            misconception_code: string;
            misconception_label: string;
            distractor_index: number;
            remediation_chunk_id: string | null;
          }
        | Array<{
            misconception_code: string;
            misconception_label: string;
            distractor_index: number;
            remediation_chunk_id: string | null;
          }>
        | null;
    };
    const misconceptionRaw = (misconceptionsRes.data ?? []) as unknown as MisconceptionJoinRow[];
    const misconceptionAgg: Record<string, { code: string; label: string; count: number; questionIds: Set<string> }> = {};
    for (const row of misconceptionRaw) {
      const qm = Array.isArray(row.question_misconceptions)
        ? row.question_misconceptions
        : (row.question_misconceptions ? [row.question_misconceptions] : []);
      for (const m of qm) {
        if (m.distractor_index !== row.selected_option) continue;
        if (!misconceptionAgg[m.misconception_code]) {
          misconceptionAgg[m.misconception_code] = {
            code: m.misconception_code,
            label: m.misconception_label,
            count: 0,
            questionIds: new Set<string>(),
          };
        }
        misconceptionAgg[m.misconception_code].count += 1;
        misconceptionAgg[m.misconception_code].questionIds.add(row.question_id);
      }
    }
    const topMisconceptions = Object.values(misconceptionAgg)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // Enrich with remediation text. Best-effort lookup against the
    // wrong_answer_remediations cache for the question_ids that produced each
    // misconception. If no cached remediation exists, leave the field empty
    // (the prompt template handles empty gracefully).
    const recentMisconceptions: CognitiveContext['recentMisconceptions'] = [];
    for (const m of topMisconceptions) {
      let remediationText = '';
      try {
        const qIds = Array.from(m.questionIds);
        if (qIds.length > 0) {
          const { data: remRows } = await supabaseAdmin
            .from('wrong_answer_remediations')
            .select('remediation_text')
            .in('question_id', qIds)
            .limit(1);
          remediationText = remRows?.[0]?.remediation_text ?? '';
        }
      } catch {
        // non-fatal — empty remediation is acceptable
      }
      recentMisconceptions.push({
        code: m.code,
        label: m.label,
        count: m.count,
        remediationText: remediationText.slice(0, 200),
      });
    }

    // P13: do not log misconception code/label paired with student_id. Only
    // log a redacted preview (counts only, no codes/labels) for ops.
    if (recentMisconceptions.length > 0) {
      logger.info('foxy_misconception_context_loaded', {
        // intentionally NO studentId in this log line
        misconceptionCount: recentMisconceptions.length,
        topCount: recentMisconceptions[0]?.count ?? 0,
      });
    }

    const avgMastery = subjectMastery.length > 0
      ? subjectMastery.reduce((s: number, m: any) => s + (m.mastery_probability ?? 0), 0) / subjectMastery.length
      : 0.5;
    const masteryLevel: CognitiveContext['masteryLevel'] =
      avgMastery < 0.4 ? 'low' : avgMastery < 0.7 ? 'medium' : 'high';

    // CME next-action (non-blocking)
    let nextAction: CognitiveContext['nextAction'] = null;
    if (subjectId) {
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (supabaseUrl && serviceKey) {
          const cmeRes = await fetch(`${supabaseUrl}/functions/v1/cme-engine`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              action: 'get_next_action',
              student_id: studentId,
              subject_id: subjectId,
            }),
            signal: AbortSignal.timeout(3000),
          });
          if (cmeRes.ok) {
            const cmeData = await cmeRes.json();
            if (cmeData.type) {
              nextAction = {
                actionType: cmeData.type,
                conceptName: cmeData.title ?? cmeData.concept_id ?? '',
                reason: cmeData.reason ?? '',
              };
            }
          }
        }
      } catch {
        // CME failure is non-fatal — Foxy still works without next-action
      }
    }

    return {
      weakTopics,
      strongTopics,
      knowledgeGaps,
      revisionDue,
      recentErrors,
      nextAction,
      masteryLevel,
      loSkills,
      recentMisconceptions,
    };
  } catch (err) {
    logger.warn('foxy_cognitive_context_failed', {
      error: err instanceof Error ? err.message : String(err),
      studentId,
    });
    return EMPTY_COGNITIVE_CONTEXT;
  }
}

// ─── Helper: load digital-twin context (Slice 1, flag-gated) ─────────────────
//
// Reads the student's most-recent learner_twin_snapshots row plus the most
// recent learner_twin_memory highlights and folds them into a compact, PII-free
// TwinContext (see src/lib/learn/build-twin-context.ts). CALLED ONLY when
// ff_digital_twin_v1 is ON — when OFF the route never invokes this, so there is
// no extra DB round-trip and behavior is byte-identical to today.
//
// Best-effort: any failure returns null so Foxy continues exactly as before.
// P13: selects IDs + numbers + enum codes only; never names / emails / phones.
async function loadTwinContextForFoxy(studentId: string): Promise<TwinContext | null> {
  try {
    const { data: snapRow } = await supabaseAdmin
      .from('learner_twin_snapshots')
      .select(
        'snapshot_date, mastery_by_topic, decay_state, dominant_error_types, misconception_cluster_ids, cohort_percentile',
      )
      .eq('student_id', studentId)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!snapRow) return null;

    let highlights: TwinMemoryHighlightInput[] = [];
    try {
      const { data: memRows } = await supabaseAdmin
        .from('learner_twin_memory')
        .select('summary_code, concept_topic_id, misconception_id')
        .eq('student_id', studentId)
        .order('occurred_at', { ascending: false })
        .limit(10);
      highlights = (memRows ?? []) as TwinMemoryHighlightInput[];
    } catch {
      // Non-fatal — snapshot alone is enough to build context.
    }

    return buildTwinContext(snapRow as TwinSnapshotInput, highlights);
  } catch (err) {
    logger.warn('foxy_twin_snapshot_load_failed', {
      // P13: no studentId at warn-level here.
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── Helper: chapter topic-progression context (Part 2B) ─────────────────────
//
// Computes the chapter's ORDERED topic list + the student's position + the
// next unmastered topic, so Foxy can lead the student topic-to-topic instead
// of guessing. Reuses curriculum_topics (display_order) + concept_mastery —
// the same tables loadCognitiveContext already touches. Server-side
// (supabaseAdmin) twin of getChapterTopics/getNextTopics (which are RLS
// client-side); we query directly so this works on the service-role path.
//
// Best-effort: any failure returns an empty progression (all-null) so the
// prompt section is empty and Foxy behaves exactly as before. NEVER fabricates
// a next topic — `nextTopic` is null unless a real unmastered ordered topic
// exists.
interface ChapterTopicProgress {
  /** Ordered topic titles for (subject, grade, chapter) by display_order. */
  orderedTopics: string[];
  /** The topic the student is currently on (highest-ordered with any mastery), or null. */
  currentTopic: string | null;
  /** The next unmastered ordered topic (the ladder target), or null. */
  nextTopic: string | null;
  /** curriculum_topics.id of nextTopic when known (for expectation meta). */
  nextTopicId: string | null;
}

const EMPTY_TOPIC_PROGRESS: ChapterTopicProgress = {
  orderedTopics: [],
  currentTopic: null,
  nextTopic: null,
  nextTopicId: null,
};

// Mastery threshold above which a topic counts as "mastered" for the purpose
// of advancing the ladder. Mirrors the 0.6 weak/strong cut used throughout
// loadCognitiveContext so the progression view is consistent with the rest of
// the cognitive context.
const TOPIC_MASTERED_THRESHOLD = 0.6;

async function loadChapterTopicProgress(
  studentId: string,
  subject: string,
  grade: string,
  chapter: string | null,
): Promise<ChapterTopicProgress> {
  // No chapter → no ordered ladder to compute.
  if (!chapter) return EMPTY_TOPIC_PROGRESS;
  try {
    const { data: subjectRow } = await supabaseAdmin
      .from('subjects')
      .select('id')
      .ilike('code', subject)
      .maybeSingle();
    const subjectId = subjectRow?.id ?? null;
    if (!subjectId) return EMPTY_TOPIC_PROGRESS;

    const chapterNum = parseFoxyChapterNumber(chapter);

    // Ordered topics for this chapter. curriculum_topics.grade is stored
    // without a "Grade " prefix (see loadCognitiveContext); normalise.
    let topicsQuery = supabaseAdmin
      .from('curriculum_topics')
      .select('id, title, display_order')
      .eq('subject_id', subjectId)
      .eq('grade', grade)
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .limit(50);
    if (chapterNum !== null) {
      topicsQuery = topicsQuery.eq('chapter_number', chapterNum);
    }
    const { data: topicRows } = await topicsQuery;
    const topics = (topicRows ?? []) as Array<{
      id: string;
      title: string;
      display_order: number | null;
    }>;
    if (topics.length === 0) return EMPTY_TOPIC_PROGRESS;

    // Mastery for these topic ids (per-topic mastery_probability).
    const topicIds = topics.map((t) => t.id);
    const masteryByTopic = new Map<string, number>();
    try {
      const { data: masteryRows } = await supabaseAdmin
        .from('concept_mastery')
        .select('topic_id, mastery_probability')
        .eq('student_id', studentId)
        .in('topic_id', topicIds);
      for (const m of (masteryRows ?? []) as Array<{
        topic_id: string;
        mastery_probability: number | null;
      }>) {
        masteryByTopic.set(m.topic_id, m.mastery_probability ?? 0);
      }
    } catch {
      // Non-fatal — treat all topics as unmastered if mastery read fails.
    }

    const orderedTopics = topics.map((t) => t.title);

    // currentTopic = the LAST ordered topic the student has touched (any
    // mastery row), so Foxy knows where they are. nextTopic = the FIRST ordered
    // topic that is not yet mastered (>= threshold). Never fabricated.
    let currentTopic: string | null = null;
    let nextTopic: string | null = null;
    let nextTopicId: string | null = null;
    for (const t of topics) {
      const mastery = masteryByTopic.get(t.id);
      if (mastery !== undefined) currentTopic = t.title;
      if (nextTopic === null && (mastery ?? 0) < TOPIC_MASTERED_THRESHOLD) {
        nextTopic = t.title;
        nextTopicId = t.id;
      }
    }

    return { orderedTopics, currentTopic, nextTopic, nextTopicId };
  } catch (err) {
    logger.warn('foxy_topic_progress_failed', {
      error: err instanceof Error ? err.message : String(err),
      // P13: no studentId at warn level beyond the existing convention.
      subject,
    });
    return EMPTY_TOPIC_PROGRESS;
  }
}

/**
 * Render the chapter topic-progression prompt section (Part 2B). Empty string
 * when there's no ordered ladder (template-safe). Injects:
 *   "Topics in this chapter (in order): A; B; C. The student is on X.
 *    The next topic to teach is Y."
 * NEVER invents a next topic — when nextTopic is null we say the chapter is
 * complete rather than guessing.
 */
function buildTopicProgressSection(p: ChapterTopicProgress): string {
  if (p.orderedTopics.length === 0) return '';
  const lines: string[] = [
    '=== CHAPTER PROGRESSION (lead the student topic-to-topic, in order) ===',
    `Topics in this chapter (in order): ${p.orderedTopics.join('; ')}.`,
  ];
  if (p.currentTopic) {
    lines.push(`The student is currently on: ${p.currentTopic}.`);
  }
  if (p.nextTopic) {
    lines.push(
      `The NEXT topic to teach is: ${p.nextTopic}. When the student shows understanding of the current topic, proactively advance to "${p.nextTopic}" and end with ONE Socratic check question on it — do NOT ask a yes/no "shall we move on?"; advance by teaching plus a thinking question.`,
    );
  } else {
    lines.push(
      'The student has worked through all listed topics in this chapter — consolidate, then suggest the next chapter or a mixed review. Do NOT invent a new topic that is not in the list above.',
    );
  }
  return lines.join('\n');
}

// ─── Foxy Math Pipeline: verdict → display mapping (Part 1D, P12 fail-closed) ─
//
// The Solver -> Verifier -> verdict→display mapping orchestrator
// (`runMathSolvePipeline`), the `stripAnswerValue` fail-closed helper, the
// `MathPipelineResult` shape, and the `FoxyMathBadgeState` type now live in
// `@/lib/ai/math/solve-pipeline` so the P12-critical fail-closed mapping can be
// unit-tested directly (mocking solveMath + verifyMath) without going through
// this route's 503-before-pipeline auth/feature-flag gates. Behavior is
// logic-identical to the prior inline definitions.
//
// ASSESSMENT BINDING CONTRACT (enforced in the module, unchanged):
//   - verifier true            -> show answer + badge 'verified'.
//   - verifier false           -> escalate ONCE (Sonnet) + re-verify.
//                                   sonnet true  -> show + 'verified'.
//                                   else (false / null / timeout on retry) ->
//                                   STRIP the answer block value (neutral
//                                   "let's check this together" line), keep the
//                                   step/math working, badge 'check_manually'.
//   - verifier null            -> show + badge 'none', NO escalation
//                                   (unavailable != wrong).
//   - solver emitted 0 or >1 answer blocks -> treat as null (badge 'none',
//                                   no escalation; we can't isolate a single
//                                   claimed value to verify).
// Badge state is computed SERVER-SIDE in the pipeline and attached to the
// /api/foxy response envelope as `badgeState`; the renderer must NOT recompute
// it.

/**
 * Persist a completed math-solve turn EXACTLY like a normal blocking Foxy turn
 * and build the response envelope (with the server-computed `badgeState`).
 *
 * Mirrors the blocking grounded-path persistence + pending-expectations
 * lifecycle, minus the RAG-specific fields (sources/citations/grounding). The
 * assistant content is the denormalized structured payload so the GET-resume +
 * legacy-string clients render correctly. 0 XP, no mastery writes.
 *
 * NEVER throws — persistence failures log and continue (the student still gets
 * the response). Returns the NextResponse for the math branch.
 */
async function persistMathTurnAndRespond(params: {
  studentId: string;
  userId: string;
  resolvedSessionId: string;
  message: string;
  subject: string;
  grade: string;
  chapter: string | null;
  mode: string;
  quotaRemaining: number;
  pipeline: MathPipelineResult;
  traceId: string;
  usePendingExpectations: boolean;
  openExpectation: OpenExpectation | null;
  nextTopicId: string | null;
  nextTopicTitle: string | null;
}): Promise<Response> {
  const { pipeline } = params;
  const structured = pipeline.structured;
  const assistantContent = denormalizeFoxyResponse(structured);

  // Persist user + assistant rows (legacy INSERT path — the math branch does
  // not pre-insert). tokens_used is null: solveMath does not expose a token
  // count, and this turn does NOT flow through the grounded meta. XP is 0 by
  // construction (no submitQuizResults / atomic_quiz_profile_update anywhere).
  let assistantMessageId: string | null = null;
  const now = new Date().toISOString();
  try {
    const { data: insertedRows } = await supabaseAdmin
      .from('foxy_chat_messages')
      .insert([
        {
          session_id: params.resolvedSessionId,
          student_id: params.studentId,
          role: 'user',
          content: params.message,
          sources: null,
          tokens_used: null,
          created_at: now,
        },
        {
          session_id: params.resolvedSessionId,
          student_id: params.studentId,
          role: 'assistant',
          content: assistantContent,
          structured: structured ?? null,
          sources: null,
          tokens_used: null,
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
      '[foxy] math message save failed:',
      saveErr instanceof Error ? saveErr.message : String(saveErr),
    );
  }

  // Pending-expectations lifecycle (parity with the grounded blocking path).
  if (params.usePendingExpectations) {
    try {
      // Pass 1: resolve the prior open expectation. classifyExpectationLifecycle
      // keeps choose_topic/next_topic OPEN on ack-only replies (Part 2C).
      if (params.openExpectation) {
        const lifecycle = classifyExpectationLifecycle(assistantContent, params.openExpectation);
        if (lifecycle === 'answered') {
          void markExpectationAnswered(supabaseAdmin, params.openExpectation.id, assistantMessageId);
        } else if (lifecycle === 'abandoned') {
          void markExpectationAbandoned(supabaseAdmin, params.openExpectation.id);
        }
      }

      // Pass 2: extract the NEW expectation from the math reply. The math
      // solution always ends with a Socratic question block, so the extractor
      // anchors the follow-up. When the route knows the ordered next topic, we
      // carry it in meta so buildExpectationPromptSection can re-anchor the
      // ladder next turn (Part 2C).
      const newExpectation = extractExpectation(assistantContent, {
        structured: (structured ?? null) as StructuredAssistantPayload | null,
      });
      if (newExpectation) {
        if (params.nextTopicTitle) {
          newExpectation.meta = {
            ...(newExpectation.meta ?? {}),
            next_topic_title: params.nextTopicTitle,
            ...(params.nextTopicId ? { topic_id: params.nextTopicId } : {}),
          };
        }
        void writeExpectation(supabaseAdmin, {
          sessionId: params.resolvedSessionId,
          studentId: params.studentId,
          expectation: newExpectation,
          subject: params.subject,
          grade: params.grade,
          chapter: params.chapter ?? null,
          topicId: params.nextTopicId ?? null,
          askedMessageId: assistantMessageId,
        });
      }
    } catch (expErr) {
      console.warn(
        '[foxy] math pending-expectations post-persist failed:',
        expErr instanceof Error ? expErr.message : String(expErr),
      );
    }
  }

  // Audit (P13: verdict + badge + reason only — never the problem/answer).
  logAudit(params.userId, {
    action: 'foxy.chat',
    resourceType: 'foxy_sessions',
    resourceId: params.resolvedSessionId,
    details: {
      subject: params.subject,
      grade: params.grade,
      chapter: params.chapter,
      mode: params.mode,
      traceId: params.traceId,
      flow: 'math-pipeline',
      modelUsed: pipeline.modelUsed,
      badgeState: pipeline.badgeState,
      verifierVerdict: pipeline.verdict.is_correct,
      verifierReason: pipeline.verdict.reason ?? null,
      escalated: pipeline.escalated,
      structured_present: true,
      // 0 XP by construction; surfaced for audit clarity.
      xpAwarded: 0,
    },
  });

  // Response envelope — same shape as the grounded blocking path, PLUS the
  // server-computed `badgeState` next to `structured`. The renderer must NOT
  // recompute the badge.
  return NextResponse.json({
    success: true,
    response: assistantContent,
    sessionId: params.resolvedSessionId,
    quotaRemaining: params.quotaRemaining,
    tokensUsed: 0,
    // A verified/none math answer is fully grounded in the NCERT method prompt;
    // a stripped (check_manually) answer keeps the working but withholds the
    // value. Mark 'grounded' for verified/none, 'unverified' for check_manually
    // so legacy banner logic does not over-claim a stripped answer.
    groundingStatus:
      pipeline.badgeState === 'check_manually'
        ? ('unverified' as const)
        : ('grounded' as const),
    groundedFromChunks: false,
    citationsCount: 0,
    traceId: params.traceId,
    messageId: assistantMessageId,
    structured,
    // Server-side math-verifier badge state (Part 1D). Renderer renders this
    // verbatim; never recomputed client-side.
    badgeState: pipeline.badgeState,
  });
}

// ─── Helper: curriculum-out-of-scope reply (math pipeline pre-solve gate) ────
//
// Called when validateCurriculumScope returns inScope:false for a detected
// math-solve query. We DO persist the turn (so session history/continuity is
// consistent — the student asked, Foxy answered "out of scope") but we run NO
// solver/verifier and award NO XP / NO mastery (P2 — this is formative). The
// reply carries the bilingual scope message + the suggested action, plus a
// minimal valid FoxyResponse (single paragraph block) so the structured
// renderer has something to show. badgeState 'out_of_scope' is a NEW state the
// renderer treats as informational (not a verified/check-manually answer).
async function respondCurriculumOutOfScope(params: {
  studentId: string;
  userId: string;
  resolvedSessionId: string;
  message: string;
  subject: string;
  grade: string;
  chapter: string | null;
  quotaRemaining: number;
  scope: CurriculumScopeResult;
  traceId: string;
  // Optional already-loaded chapter-topic progression. When present we thread
  // the current chapter + the next ordered topic into the bilingual redirect so
  // the out-of-scope reply points the student back at what they ARE studying.
  // Falls back to the generic scope copy when these are null.
  topicProgress?: ChapterTopicProgress;
}): Promise<Response> {
  const { scope } = params;
  const suggestedAction = scope.suggestedActionEn ?? '';
  const messageEn = scope.messageEn ?? 'This question is outside your current scope.';

  // ── Personalized redirect tail (P7 bilingual) ─────────────────────────────
  // When we know the chapter and/or the next ordered topic, append a redirect
  // that names them ("You're currently studying <chapter>; let's continue with
  // <nextTopic>."). Each clause is emitted only when its field is non-null, so
  // a partial (chapter-only or topic-only) state still reads cleanly. When both
  // are null we add nothing — the generic scope copy stands alone.
  const chapterName =
    typeof params.chapter === 'string' && params.chapter.trim().length > 0
      ? params.chapter.trim()
      : null;
  const nextTopic = params.topicProgress?.nextTopic ?? null;

  let redirectEn = '';
  let redirectHi = '';
  if (chapterName && nextTopic) {
    redirectEn = `You're currently studying ${chapterName}; let's continue with ${nextTopic}.`;
    redirectHi = `आप अभी ${chapterName} पढ़ रहे हैं; चलिए ${nextTopic} के साथ आगे बढ़ते हैं।`;
  } else if (chapterName) {
    redirectEn = `You're currently studying ${chapterName}; let's continue there.`;
    redirectHi = `आप अभी ${chapterName} पढ़ रहे हैं; चलिए वहीं से आगे बढ़ते हैं।`;
  } else if (nextTopic) {
    redirectEn = `Let's continue with ${nextTopic}.`;
    redirectHi = `चलिए ${nextTopic} के साथ आगे बढ़ते हैं।`;
  }

  // Bilingual block text (EN + Hindi inline) so the structured renderer surfaces
  // both — P7. The plain `response` string carries EN + the suggested action +
  // (when available) the personalized redirect.
  const blockText = [
    messageEn,
    redirectEn,
    scope.suggestedActionEn,
    scope.messageHi,
    redirectHi,
    scope.suggestedActionHi,
  ]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(' ')
    .slice(0, 2000);
  const responseText = [messageEn, redirectEn, suggestedAction]
    .filter((s) => typeof s === 'string' && s.length > 0)
    .join(' ')
    .trim();

  // Minimal valid FoxyResponse: one paragraph block carrying the bilingual
  // message. subject 'general' — this is a meta reply, not subject content.
  const structured: FoxyResponse = {
    title: 'Outside the selected chapter',
    subject: 'general',
    blocks: [{ type: 'paragraph', text: blockText }],
  };

  // Persist user + assistant rows (mirrors persistMathTurnAndRespond's INSERT
  // path). tokens_used null; NO XP, NO mastery writes anywhere.
  let assistantMessageId: string | null = null;
  const now = new Date().toISOString();
  try {
    const { data: insertedRows } = await supabaseAdmin
      .from('foxy_chat_messages')
      .insert([
        {
          session_id: params.resolvedSessionId,
          student_id: params.studentId,
          role: 'user',
          content: params.message,
          sources: null,
          tokens_used: null,
          created_at: now,
        },
        {
          session_id: params.resolvedSessionId,
          student_id: params.studentId,
          role: 'assistant',
          content: responseText,
          structured,
          sources: null,
          tokens_used: null,
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
      '[foxy] math out-of-scope message save failed:',
      saveErr instanceof Error ? saveErr.message : String(saveErr),
    );
  }

  // Audit (P13: reason + scope metadata only — never the problem text). 0 XP.
  logAudit(params.userId, {
    action: 'foxy.chat',
    resourceType: 'foxy_sessions',
    resourceId: params.resolvedSessionId,
    details: {
      subject: params.subject,
      grade: params.grade,
      chapter: params.chapter,
      traceId: params.traceId,
      flow: 'math-pipeline-out-of-scope',
      curriculumScopeReason: scope.reason ?? null,
      enrolledGrade: scope.enrolledGrade,
      structured_present: true,
      xpAwarded: 0,
    },
  });

  return NextResponse.json({
    success: true,
    response: responseText,
    structured,
    badgeState: 'out_of_scope' as const,
    curriculum: {
      status: 'curriculum_out_of_scope' as const,
      message: scope.messageEn,
      suggestedAction: scope.suggestedActionEn,
    },
    verification_skipped: 'out_of_curriculum_scope' as const,
    sessionId: params.resolvedSessionId,
    quotaRemaining: params.quotaRemaining,
    messageId: assistantMessageId,
    traceId: params.traceId,
  });
}

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
  buildQuizMeLlmGrader,
  buildQuizMeFallbackResponse,
  isBareOpen,
  FOXY_SAFETY_RAILS,
  buildSystemPrompt,
  type CoachDirective,
  type CoachFeedbackSignal,
} from '@/lib/foxy/prompt-sections';
// Re-export the symbols that test modules / external callers import from the
// route's public surface (parity with the M1 constants re-export above).
export {
  buildColdStartPromptSection,
  buildCognitivePromptSection,
  selectLeadConcept,
  buildLeadConceptDirective,
  isBareOpen,
  VALID_COACH_DIRECTIVES,
  COACH_DIRECTIVE_SECTIONS,
  SINGLE_MCQ_DIRECTIVE,
} from '@/lib/foxy/prompt-sections';
export type { LeadConcept, CoachDirective } from '@/lib/foxy/prompt-sections';


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


// ─── Legacy-flow delegate (kill-switch path) ────────────────────────────────
//
// When `ff_grounded_ai_foxy` is OFF we still want a working Foxy. The inline
// Voyage+Claude pipeline has been deleted from this route; the fallback now
// delegates to the existing intent-router workflow (src/lib/ai/) which is
// independent of the grounded-answer service and has been the production path
// behind `ai_intent_router` for several weeks. If ops need to roll back
// further than the intent router (e.g., if the AI layer itself breaks), the
// foxy-tutor Edge Function can be re-invoked via the mobile/Flutter code path
// until Phase 4 deletion lands.

async function runLegacyFoxyFlow(params: {
  studentId: string;
  resolvedSessionId: string;
  message: string;
  subject: string;
  grade: string;
  chapter: string | null;
  board: string;
  mode: string;
  academicGoal: string | null;
  history: ChatMessage[];
}): Promise<{
  response: string;
  sources: RagSource[];
  diagrams: DiagramRef[];
  tokensUsed: number;
  model: string;
  traceId: string;
  intent: string;
}> {
  const [classification, tenantAi] = await Promise.all([
    classifyIntent(params.message, params.subject, params.grade, params.mode),
    resolveTenantAiOverrides(params.studentId),
  ]);
  const result = await routeIntent(classification.intent, params.message, {
    subject: params.subject,
    grade: params.grade,
    board: params.board,
    chapter: params.chapter,
    mode: params.mode,
    history: params.history,
    academicGoal: params.academicGoal,
    studentId: params.studentId,
    sessionId: params.resolvedSessionId,
    tenantPersonality: tenantAi.tenantPersonality,
    tenantTone: tenantAi.tenantTone,
    tenantPedagogy: tenantAi.tenantPedagogy,
  });

  const sources: RagSource[] = result.sources.map((c) => ({
    chunk_id: c.id,
    subject: c.subject,
    chapter: c.chapter,
    page_number: c.pageNumber,
    similarity: c.similarity,
    content_preview: c.content.slice(0, 150),
    media_url: c.mediaUrl || null,
  }));

  const diagrams: DiagramRef[] = result.sources
    .filter((c) => c.mediaUrl)
    .map((c) => ({
      url: c.mediaUrl!,
      title: c.chapter || params.subject,
      pageNumber: c.pageNumber,
      description: c.mediaDescription || `NCERT ${params.subject} ${c.chapter || ''}`.trim(),
    }));

  return {
    response: result.response,
    sources,
    diagrams,
    tokensUsed: result.tokensUsed,
    model: result.model,
    traceId: result.traceId,
    intent: classification.intent,
  };
}

async function persistLegacyFoxyResponse(params: {
  authUserId: string;
  studentId: string;
  resolvedSessionId: string;
  remaining: number;
  message: string;
  subject: string;
  grade: string;
  chapter: string | null;
  mode: string;
  legacy: Awaited<ReturnType<typeof runLegacyFoxyFlow>>;
  logFoxyAsk: (tokens: number | null) => void;
}): Promise<Response> {
  // Persist turns (non-fatal)
  const now = new Date().toISOString();
  try {
    await supabaseAdmin.from('foxy_chat_messages').insert([
      {
        session_id: params.resolvedSessionId,
        student_id: params.studentId,
        role: 'user',
        content: params.message,
        sources: null,
        tokens_used: null,
        created_at: now,
      },
      {
        session_id: params.resolvedSessionId,
        student_id: params.studentId,
        role: 'assistant',
        content: params.legacy.response,
        sources: params.legacy.sources.length > 0 ? params.legacy.sources : null,
        tokens_used: params.legacy.tokensUsed,
        created_at: new Date(Date.now() + 1).toISOString(),
      },
    ]);
  } catch (saveErr) {
    console.warn('[foxy] legacy message save failed:', saveErr instanceof Error ? saveErr.message : String(saveErr));
  }

  logAudit(params.authUserId, {
    action: 'foxy.chat',
    resourceType: 'foxy_sessions',
    resourceId: params.resolvedSessionId,
    details: {
      subject: params.subject,
      grade: params.grade,
      chapter: params.chapter,
      mode: params.mode,
      intent: params.legacy.intent,
      tokensUsed: params.legacy.tokensUsed,
      model: params.legacy.model,
      traceId: params.legacy.traceId,
      ragChunksFound: params.legacy.sources.length,
      flow: 'legacy-intent-router',
    },
  });

  // Phase 0: NCERT surfaces (sources, diagrams) are intentionally NOT
  // returned to the client. Retrieval still happens server-side and
  // citations are still injected into the system prompt for grounding,
  // but the student-facing wire shape no longer exposes the raw chunks.
  //
  // Phase 0 Fix 0.5: legacy intent-router path. groundedFromChunks is
  // approximated as `sources.length > 0` — the legacy path doesn't run
  // the soft-mode escape detection, so this is a conservative proxy
  // ("we retrieved chunks AND the LLM produced a response").
  try {
    params.logFoxyAsk(params.legacy.tokensUsed ?? null);
  } catch (telemetryErr) {
    logger.warn('foxy_ask_telemetry_failed', {
      error: telemetryErr instanceof Error ? telemetryErr.message : String(telemetryErr),
      studentId: params.studentId,
    });
  }
  return NextResponse.json({
    success: true,
    response: params.legacy.response,
    sessionId: params.resolvedSessionId,
    quotaRemaining: params.remaining,
    tokensUsed: params.legacy.tokensUsed,
    groundingStatus: 'grounded' as const,
    groundedFromChunks: params.legacy.sources.length > 0,
    citationsCount: params.legacy.sources.length,
    traceId: params.legacy.traceId,
  });
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  // TOP-LEVEL SAFETY NET — no unhandled exception can crash Foxy.
  try {
    return await handleFoxyPost(request);
  } catch (topLevelErr) {
    const diagMsg = topLevelErr instanceof Error ? topLevelErr.message : String(topLevelErr);
    console.error('[FOXY CRITICAL] Unhandled exception in POST handler:', diagMsg);
    try {
      const { logOpsEvent } = await import('@/lib/ops-events');
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

  // 5. Quota check
  const { allowed, remaining } = await checkAndIncrementQuota(studentId, plan);
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
  try {
    const [ctx, hist, prior, labs, prog] = await Promise.all([
      loadCognitiveContext(studentId, subject, grade, chapter),
      loadHistory(resolvedSessionId),
      loadPriorSessionContext(studentId, subject, grade, resolvedSessionId, chapter),
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
  try {
    const twinEnabled = await isFeatureEnabled('ff_digital_twin_v1', {
      role: 'student',
      userId: auth.userId!,
    });
    if (twinEnabled) {
      const twin = await loadTwinContextForFoxy(studentId);
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

  // history_messages is kept as a deprecated alias for one release so the
  // grounded-answer service can switch over without forcing a synchronized
  // deploy. The service now prefers conversation_turns when present.
  const historyMessagesAlias = JSON.stringify(history);

  const groundedRequest: GroundedRequest = {
    caller: 'foxy',
    student_id: studentId,
    query: message,
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
        mode_directive: isQuizMe ? SINGLE_MCQ_DIRECTIVE : (MODE_DIRECTIVES[mode] ?? ''),
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
        cognitive_context_section: buildCognitivePromptSection(cognitiveCtx) + twinPromptSection,
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
  if (wantsStream && !isQuizMe) {
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
  }

  // When `structured` is present, the canonical assistant text is the
  // denormalized rendering (title + blocks → flat string with `$$ ... $$`
  // wrappers around math). When absent (legacy/kill-switch/malformed), keep
  // the existing behavior of storing the raw `answer` string.
  const assistantContent = structured
    ? denormalizeFoxyResponse(structured)
    : grounded.answer;

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

  // Build soft upgrade prompt if quota near exhaustion
  const limit = DAILY_QUOTA[plan] ?? DEFAULT_QUOTA;
  const upgradeConfig = UPGRADE_PROMPTS[plan];
  let upgradePrompt: { message: string; messageHi: string; nextPlan: string; remaining: number } | null = null;
  if (upgradeConfig && typeof remaining === 'number' && remaining <= (limit - upgradeConfig.threshold)) {
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
    // Present ONLY on a "Quiz me" turn. `quizMe.evidential` tells the client
    // whether answering moves mastery: when true, the client POSTs
    // { served_item_id, chosen_index, attempt_id, response_time_ms } to
    // /api/foxy/quiz-answer to commit the graded result through the sanctioned
    // path. When false, the MCQ is practice-only (no mastery move) and the
    // client renders it without the served_item_id (no grade endpoint call).
    ...(isQuizMe
      ? {
          quizMe: quizMeEvidential
            ? { evidential: true as const, servedItemId: evidentialServedItemId }
            : { evidential: false as const, reason: quizMeNonEvidentialReason },
        }
      : {}),
  });
}

// ─── Streaming turn handler (Phase 1.1) ─────────────────────────────────────
//
// Pipes the upstream SSE stream from the grounded-answer Edge Function to the
// browser, while taking a side-channel tap so we can:
//   1. Persist the full assistant turn to foxy_chat_messages on `done`
//   2. Refund quota on `error` or premature stream end
//   3. Emit logAudit + analytics on completion
//
// Wire shape — each SSE event has a named `event:` and a JSON payload:
//   metadata → {groundingStatus, citations, traceId, confidence}  (once)
//   text     → {delta}                                             (N times)
//   done     → {tokensUsed, latencyMs, groundedFromChunks, claudeModel, answerLength}
//   abstain  → {abstainReason, suggestedAlternatives, traceId, latencyMs}
//   error    → {reason, traceId, latencyMs}
//
// We add ONE additional event we synthesize in this layer (so the browser
// has everything it needs without a follow-up REST call):
//   session  → {sessionId}                                         (first frame)
async function handleStreamingFoxyTurn(params: {
  groundedRequest: GroundedRequest;
  hopTimeoutMs: number;
  studentId: string;
  userId: string;
  resolvedSessionId: string;
  message: string;
  subject: string;
  grade: string;
  chapter: string | null;
  mode: string;
  cognitiveCtx: CognitiveContext;
  // B'-5: pass through so the streaming-path message insert can record
  // the coach mode used for this turn (parity with the blocking path at
  // line ~2185). NULL is acceptable for legacy callers / tests.
  coachMode?: CoachMode;
  // Phase 2 of Foxy continuity fix (2026-05-18): when these are non-null
  // the caller pre-inserted user + pending-assistant rows before the LLM
  // call. persistOnDone() UPDATEs rather than INSERTs in that case, and
  // failure paths leave the rows in place (UI renders pending state).
  preInsertedUserId?: string | null;
  preInsertedAssistantId?: string | null;
  // Phase 3 (2026-05-18): flag + open-row threading so streaming parity
  // with blocking. When `usePendingExpectations` is false, the lifecycle
  // hook below is skipped entirely (zero extra DB writes).
  usePendingExpectations?: boolean;
  openExpectation?: OpenExpectation | null;
}): Promise<Response> {
  const upstream = await callGroundedAnswerStream(params.groundedRequest, {
    hopTimeoutMs: params.hopTimeoutMs,
  });

  if (!upstream.ok) {
    // Hop failed (service down, network error, config). Refund quota and
    // surface a synthetic error event so the client can render the same
    // UI as a streamed error.
    await refundQuota(params.studentId, 'foxy_chat');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (eventName: string, payload: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`),
          );
        };
        send('session', { sessionId: params.resolvedSessionId });
        send('error', {
          reason: upstream.reason,
          traceId: 'pending',
          latencyMs: 0,
        });
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: streamingHeaders(),
    });
  }

  if (!upstream.response.body) {
    await refundQuota(params.studentId, 'foxy_chat');
    return new Response('upstream returned no body', { status: 502 });
  }

  // Transform stream that:
  //  (a) re-emits each frame to the client byte-for-byte (low-latency)
  //  (b) parses each frame so we can capture full text + done payload
  let accumulatedText = '';
  let parseBuffer = '';
  let doneSeen = false;
  let errorSeen = false;
  let lastTraceId = 'pending';
  let lastTokensUsed = 0;
  let lastClaudeModel = '';
  let lastGroundedFromChunks = false;
  let lastCitations: Citation[] = [];
  // Phase 2 (structured rendering): raw `structured` field from the SSE `done`
  // event. Captured here unvalidated; defense-in-depth validation runs inside
  // persistOnDone() via extractValidatedStructured() so the JSONB column we are
  // about to write cannot be poisoned by an upstream bug. Non-Foxy callers and
  // legacy/abstain paths leave this null → persistence falls back to writing
  // `accumulatedText` into `content` and `null` into `structured` (the existing
  // pre-structured behavior). See REG-50 (Foxy single-retrieval) and the
  // matching non-streaming branch around line 1700 for the contract pin.
  let lastStructuredRaw: unknown = null;
  // Synthesize a leading `session` event so the client knows the sessionId
  // up front (Edge Function doesn't know it).
  const encoder = new TextEncoder();
  const sessionFrame = encoder.encode(
    `event: session\ndata: ${JSON.stringify({ sessionId: params.resolvedSessionId })}\n\n`,
  );

  const finalizeOnError = async () => {
    if (errorSeen || doneSeen) return; // already handled
    await refundQuota(params.studentId, 'foxy_chat');
  };

  // B'-5 Phase 2: assistant-message UUID captured from the persistence
  // INSERT and emitted to the client via a synthesized `persisted` SSE
  // frame in flush(). Stays null when persistence fails — the client then
  // falls back to the legacy aggregate-only feedback path.
  let assistantMessageId: string | null = null;

  const persistOnDone = async () => {
    // ─── Boundary validation for the streaming `done.structured` payload ────
    // Mirrors the non-streaming path (around line 1700): re-validate the
    // upstream-supplied `structured` field at this API boundary so a malformed
    // payload from the Edge Function NEVER lands in the JSONB column. On any
    // failure we log `foxy.structured.invalid_payload` and fall back to the
    // legacy plain-text persistence (content = accumulatedText, structured =
    // null) so the student turn is still preserved.
    //
    // When `structured` is valid we ALSO denormalize it into `content` so the
    // TEXT column stays human-readable — without this, content would carry the
    // raw model-emitted JSON string (the structured-output prompt forces JSON),
    // and on session resume (GET) legacy fallback would render escaped JSON
    // to users. See `denormalizeFoxyResponse` in src/lib/foxy/denormalize.ts.
    const structured = extractValidatedStructured(
      { structured: lastStructuredRaw },
      {
        traceId: lastTraceId,
        studentId: params.studentId,
        subject: params.subject,
        grade: params.grade,
        // Streaming-path fallback: same recovery as the blocking branch but
        // sourced from `accumulatedText` (the concatenated `text.delta`
        // events). Catches the case where the streaming Edge Function emits
        // a JSON payload in deltas without a separate `done.structured`.
        fallbackText: accumulatedText,
      },
    );

    const assistantContent = structured
      ? denormalizeFoxyResponse(structured)
      : accumulatedText;

    const sourcesPayload =
      lastCitations.length > 0
        ? lastCitations.map((c) => ({
            chunk_id: c.chunk_id,
            subject: params.subject,
            chapter: c.chapter_title || (c.chapter_number ? `Chapter ${c.chapter_number}` : undefined),
            page_number: c.page_number ?? undefined,
            similarity: c.similarity,
            content_preview: c.excerpt.slice(0, 150),
            media_url: c.media_url,
          }))
        : null;

    if (params.preInsertedAssistantId) {
      // Phase 2 of Foxy continuity fix (2026-05-18): UPDATE rather than INSERT.
      // The user row was already inserted with pending=false; the assistant
      // row is the one we need to flip from pending=true → false + content.
      try {
        const { error: updateErr } = await supabaseAdmin
          .from('foxy_chat_messages')
          .update({
            content: assistantContent,
            structured: structured ?? null,
            sources: sourcesPayload,
            tokens_used: lastTokensUsed,
            pending: false,
          })
          .eq('id', params.preInsertedAssistantId);
        if (updateErr) {
          console.warn('[foxy] streaming message update failed:', updateErr.message);
        }
        assistantMessageId = params.preInsertedAssistantId;
      } catch (err) {
        console.warn(
          '[foxy] streaming message update threw:',
          err instanceof Error ? err.message : String(err),
        );
      }
    } else {
      // Legacy path (flag off, or pre-insert failed): INSERT both rows.
      try {
        const now = new Date().toISOString();
        const { data: insertedRows } = await supabaseAdmin
          .from('foxy_chat_messages')
          .insert([
            {
              session_id: params.resolvedSessionId,
              student_id: params.studentId,
              role: 'user',
              content: params.message,
              sources: null,
              tokens_used: null,
              created_at: now,
            },
            {
              session_id: params.resolvedSessionId,
              student_id: params.studentId,
              role: 'assistant',
              content: assistantContent,
              // CHECK constraint `structured_role_check` permits structured only
              // on assistant rows; the column is nullable so legacy/fallback writes
              // explicitly null. Migration: 20260430010000_foxy_chat_messages_add_structured.
              structured: structured ?? null,
              sources: sourcesPayload,
              tokens_used: lastTokensUsed,
              // B'-5: parity with the blocking path — record coach mode for
              // feedback correlation.
              coach_mode_used: params.coachMode ?? null,
              created_at: new Date(Date.now() + 1).toISOString(),
            },
          ])
          .select('id, role');
        if (insertedRows) {
          const assistantRow = insertedRows.find((r) => r.role === 'assistant');
          assistantMessageId = (assistantRow?.id as string | undefined) ?? null;
        }
      } catch (err) {
        console.warn(
          '[foxy] streaming message save failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Phase 3 (2026-05-18): pending-expectations lifecycle for streaming
    // path. Parity with the blocking flow at the same callsite. Best-effort.
    if (params.usePendingExpectations) {
      try {
        if (params.openExpectation) {
          const lifecycle = classifyExpectationLifecycle(
            assistantContent,
            params.openExpectation,
          );
          if (lifecycle === 'answered') {
            void markExpectationAnswered(
              supabaseAdmin,
              params.openExpectation.id,
              assistantMessageId,
            );
          } else if (lifecycle === 'abandoned') {
            void markExpectationAbandoned(supabaseAdmin, params.openExpectation.id);
          }
        }
        const newExpectation = extractExpectation(assistantContent, {
          structured: (structured ?? null) as StructuredAssistantPayload | null,
        });
        if (newExpectation) {
          void writeExpectation(supabaseAdmin, {
            sessionId: params.resolvedSessionId,
            studentId: params.studentId,
            expectation: newExpectation,
            subject: params.subject,
            grade: params.grade,
            chapter: params.chapter ?? null,
            askedMessageId: assistantMessageId,
          });
        }
      } catch (expErr) {
        console.warn(
          '[foxy] streaming pending-expectations failed:',
          expErr instanceof Error ? expErr.message : String(expErr),
        );
      }
    }

    try {
      logAudit(params.userId, {
        action: 'foxy.chat',
        resourceType: 'foxy_sessions',
        resourceId: params.resolvedSessionId,
        details: {
          subject: params.subject,
          grade: params.grade,
          chapter: params.chapter,
          mode: params.mode,
          tokensUsed: lastTokensUsed,
          model: lastClaudeModel,
          traceId: lastTraceId,
          ragChunksFound: lastCitations.length,
          masteryLevel: params.cognitiveCtx.masteryLevel,
          flow: 'grounded-answer-stream',
          groundedFromChunks: lastGroundedFromChunks,
          // Adoption telemetry parity with the non-streaming branch — `true`
          // only when the upstream emitted a structured payload AND it passed
          // boundary validation. Lets ops compare structured-rendering health
          // across the streaming and blocking flows.
          structured_present: structured !== null,
        },
      });
    } catch { /* audit log is non-critical */ }
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      controller.enqueue(sessionFrame);
    },
    transform(chunk, controller) {
      // Re-emit verbatim to client (preserves exact SSE formatting).
      controller.enqueue(chunk);
      // Parse for our side-channel tracking.
      parseBuffer += new TextDecoder().decode(chunk);
      let sepIdx: number;
      while ((sepIdx = parseBuffer.indexOf('\n\n')) !== -1) {
        const rawEvent = parseBuffer.slice(0, sepIdx);
        parseBuffer = parseBuffer.slice(sepIdx + 2);
        const eventLine = rawEvent.split('\n').find((l) => l.startsWith('event: '));
        const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data: '));
        if (!eventLine || !dataLine) continue;
        const eventName = eventLine.slice(7).trim();
        let payload: any = null;
        try {
          payload = JSON.parse(dataLine.slice(6));
        } catch {
          continue;
        }
        if (eventName === 'metadata') {
          if (payload?.traceId) lastTraceId = payload.traceId;
          if (Array.isArray(payload?.citations)) lastCitations = payload.citations;
        } else if (eventName === 'text') {
          if (typeof payload?.delta === 'string') accumulatedText += payload.delta;
        } else if (eventName === 'done') {
          doneSeen = true;
          if (typeof payload?.tokensUsed === 'number') lastTokensUsed = payload.tokensUsed;
          if (typeof payload?.claudeModel === 'string') lastClaudeModel = payload.claudeModel;
          if (typeof payload?.groundedFromChunks === 'boolean') {
            lastGroundedFromChunks = payload.groundedFromChunks;
          }
          // Capture the structured payload (FoxyResponse) emitted by the
          // grounded-answer pipeline-stream on `done`. We store the raw value
          // here and validate it inside persistOnDone() — keeping the parser
          // hot-path branch-free (the schema parse is non-trivial and we don't
          // want to run it inside a TransformStream `transform()`).
          if (payload && typeof payload === 'object' && 'structured' in payload) {
            lastStructuredRaw = (payload as { structured?: unknown }).structured ?? null;
          }
        } else if (eventName === 'abstain') {
          // Abstain → refund based on the same policy as the blocking path
          if (
            payload?.abstainReason &&
            REFUND_ABSTAIN_REASONS.includes(payload.abstainReason as AbstainReason)
          ) {
            // Fire-and-forget — we're inside transform(), can't await
            void refundQuota(params.studentId, 'foxy_chat');
          }
          errorSeen = true; // treat as terminal (not a `done`)
          if (payload?.traceId) lastTraceId = payload.traceId;
        } else if (eventName === 'error') {
          errorSeen = true;
          if (payload?.traceId) lastTraceId = payload.traceId;
        }
      }
    },
    async flush(controller) {
      if (doneSeen) {
        // B'-5 Phase 2: AWAIT the persistence so we know the assistant-row
        // UUID before the stream closes — then emit a synthesized `persisted`
        // SSE frame so the client can wire 👍/👎 to that DB row.
        // Trade-off: a small (~50-200ms) close-side latency in exchange for
        // closing the feedback loop. The student has already seen all the
        // text by this point; we're only delaying the connection close.
        await persistOnDone();
        if (assistantMessageId) {
          try {
            controller.enqueue(
              encoder.encode(
                `event: persisted\ndata: ${JSON.stringify({ messageId: assistantMessageId })}\n\n`,
              ),
            );
          } catch {
            // Controller closed (rare race) — no-op; client falls back to
            // legacy aggregate feedback path.
          }
        }
      } else {
        // Stream closed without a `done` event → refund (defensive).
        await finalizeOnError();
      }
    },
  });

  // Pipe upstream → transform → response
  const responseStream = upstream.response.body.pipeThrough(transform);

  return new Response(responseStream, {
    status: 200,
    headers: streamingHeaders(),
  });
}

function streamingHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

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
