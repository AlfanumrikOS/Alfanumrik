/**
 * /api/foxy — M6b extracted terminal responders (P12-critical surface).
 *
 * H1 REFACTOR Step 7 (behavior-preserving). These three functions were lifted
 * verbatim out of `src/app/api/foxy/route.ts`. The route imports them and calls
 * them identically at the same call sites; zero behavior change.
 *
 *  - `extractValidatedStructured` — structured-output defense-in-depth
 *    validation/extraction (P12: never write malformed JSON into the trusted
 *    JSONB column; legacy `response` string always populated).
 *  - `persistMathTurnAndRespond` — math-solve terminal response + persistence
 *    (0 XP, no mastery writes by construction; pinned by
 *    math-solve-no-xp-no-mastery.test.ts).
 *  - `respondCurriculumOutOfScope` — the P12 fail-closed out-of-scope reply,
 *    including the bilingual (Hindi/English) refusal message (P7).
 *
 * The validation rules, the bilingual scope strings, and the math-turn response
 * shape are byte-identical to the prior inline route code. No symbol here is
 * imported by any test from the route's public surface, so no re-export is
 * required.
 */

import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { FoxyResponseSchema, type FoxyResponse } from '@/lib/foxy/schema';
import { normalizeFoxyResponseInline } from '@/lib/foxy/normalize-inline';
import { recoverFoxyResponseFromText } from '@/lib/foxy/recover-from-text';
import { denormalizeFoxyResponse } from '@/lib/foxy/denormalize';
import { type MathPipelineResult } from '@/lib/ai/math/solve-pipeline';
import { type CurriculumScopeResult } from '@/lib/foxy/curriculum-scope';
import {
  extractExpectation,
  writeExpectation,
  markExpectationAnswered,
  markExpectationAbandoned,
  type OpenExpectation,
  type StructuredAssistantPayload,
} from '@/lib/learn/foxy-expectations';
import {
  classifyExpectationLifecycle,
  type ChapterTopicProgress,
} from './cognitive-context';

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
export function extractValidatedStructured(
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
export async function persistMathTurnAndRespond(params: {
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
export async function respondCurriculumOutOfScope(params: {
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
