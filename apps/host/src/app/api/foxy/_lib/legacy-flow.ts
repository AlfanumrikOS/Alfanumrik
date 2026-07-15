/**
 * /api/foxy — M6a extracted legacy Foxy flow (kill-switch path).
 *
 * H1 REFACTOR Step 6a (behavior-preserving). These two functions were lifted
 * verbatim out of `src/app/api/foxy/route.ts`. They are the `ff_grounded_ai_foxy`
 * -OFF kill-switch path AND the grounded-service abstain fallback path. The
 * route imports them and calls them identically at the same two call sites;
 * zero behavior change.
 *
 * The legacy-AI call (classifyIntent + routeIntent), the response shape, and
 * the persistence are byte-identical to the prior inline route code. The
 * quota-refund-on-failure logic stays at the route call sites (it wraps these
 * functions in try/catch and refunds on throw) — it was never inside these two
 * functions.
 *
 * When `ff_grounded_ai_foxy` is OFF we still want a working Foxy. The inline
 * Voyage+Claude pipeline has been deleted from this route; the fallback now
 * delegates to the existing intent-router workflow (src/lib/ai/) which is
 * independent of the grounded-answer service and has been the production path
 * behind `ai_intent_router` for several weeks. If ops need to roll back
 * further than the intent router (e.g., if the AI layer itself breaks), the
 * foxy-tutor Edge Function can be re-invoked via the mobile/Flutter code path
 * until Phase 4 deletion lands.
 */

import { NextResponse } from 'next/server';
import { logAudit } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { classifyIntent, routeIntent } from '@alfanumrik/lib/ai';
import { screenStudentFacingText } from '@alfanumrik/lib/ai/validation/output-screen';
import { stripFakeQuizClaim } from '@alfanumrik/lib/foxy/anti-fake-quiz-claim';
import type { RagSource, DiagramRef, ChatMessage } from './constants';
import { refundQuota, resolveTenantAiOverrides } from './quota';

export async function runLegacyFoxyFlow(params: {
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

export async function persistLegacyFoxyResponse(params: {
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
  // ── Unconditional anti-fake backstop (P6 "fake action", flag-INDEPENDENT) ──
  // Both legacy call sites (ff_grounded_ai_foxy OFF kill-switch AND the
  // grounded-abstain fallback) flow through here, so this is the one deterministic
  // gate that runs on the legacy persist path regardless of ANY feature flag.
  // If the model/workflow produced a "generated / created / here are N questions"
  // claim NOT backed by real rendered questions, we replace the ENTIRE turn with
  // the graceful bilingual fallback — a claim-with-no-questions can never ship.
  // A turn that carries real rendered questions (AC1) passes through untouched.
  const antiFake = stripFakeQuizClaim(params.legacy.response);
  const responseText = antiFake.text;
  if (antiFake.claimOnly) {
    logger.warn('foxy.legacy.fake_quiz_claim_stripped', {
      // P13: scope + flow only — never the answer text or studentId.
      subject: params.subject,
      grade: params.grade,
      mode: params.mode,
      intent: params.legacy.intent,
      traceId: params.legacy.traceId,
      flow: 'legacy-intent-router',
    });
  }

  const outputScreen = screenStudentFacingText(responseText, {
    grade: params.grade,
    subject: params.subject,
  });
  if (!outputScreen.safe) {
    logger.warn('foxy.output.safety_blocked', {
      subject: params.subject,
      grade: params.grade,
      mode: params.mode,
      categories: outputScreen.categories,
      traceId: params.legacy.traceId,
      flow: 'legacy-intent-router',
    });
    logAudit(params.authUserId, {
      action: 'foxy.chat.safety_blocked',
      resourceType: 'foxy_sessions',
      resourceId: params.resolvedSessionId,
      details: {
        subject: params.subject,
        grade: params.grade,
        mode: params.mode,
        categories: outputScreen.categories,
        traceId: params.legacy.traceId,
        flow: 'legacy-intent-router',
      },
    });
    await refundQuota(params.studentId, 'foxy_chat');
    try {
      params.logFoxyAsk(0);
    } catch (telemetryErr) {
      logger.warn('foxy_ask_telemetry_failed', {
        error: telemetryErr instanceof Error ? telemetryErr.message : String(telemetryErr),
        studentId: params.studentId,
      });
    }
    return NextResponse.json({
      success: true,
      response: '',
      sessionId: params.resolvedSessionId,
      quotaRemaining: typeof params.remaining === 'number' ? params.remaining + 1 : params.remaining,
      tokensUsed: 0,
      groundingStatus: 'hard-abstain' as const,
      abstainReason: 'upstream_error' as const,
      suggestedAlternatives: [],
      traceId: params.legacy.traceId,
    });
  }

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
        content: responseText,
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
    response: responseText,
    sessionId: params.resolvedSessionId,
    quotaRemaining: params.remaining,
    tokensUsed: params.legacy.tokensUsed,
    groundingStatus: 'grounded' as const,
    groundedFromChunks: params.legacy.sources.length > 0,
    citationsCount: params.legacy.sources.length,
    traceId: params.legacy.traceId,
  });
}
