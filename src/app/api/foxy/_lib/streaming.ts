/**
 * /api/foxy — M6c streaming turn handler (H1 REFACTOR Step 8)
 *
 * Behavior-preserving extraction of the SSE streaming path from
 * `src/app/api/foxy/route.ts`. The handler pipes the upstream SSE stream from
 * the grounded-answer Edge Function to the browser while taking a side-channel
 * tap for persistence, quota refund-on-error, and audit logging.
 *
 * Contract pins that MUST remain byte-identical (do not refactor without the
 * reviewing agent's sign-off):
 *  - REG-50 (Foxy single-retrieval): exactly ONE `callGroundedAnswerStream`
 *    call per turn. The retrieval call below is the only one in this path.
 *  - Stream quota lifecycle: quota was deducted upstream (in the route spine);
 *    it is REFUNDED here on hop failure, on missing body, on abstain (per the
 *    REFUND_ABSTAIN_REASONS policy), and on premature stream end (no `done`).
 *    It is KEPT on `done`.
 *  - Structured-output defense-in-depth validation runs on stream complete via
 *    extractValidatedStructured() (shared with the non-streaming path).
 *
 * Pinned by `src/__tests__/api/foxy/streaming-structured-persistence.test.ts`,
 * `src/__tests__/foxy-streaming.test.ts`, and
 * `src/__tests__/foxy-streaming-json-fallback-abstain.test.ts`.
 *
 * The auth→grade→scope→quota→retrieval spine, the POST/GET handlers, and
 * selectFoxyPromptTemplate intentionally STAY in route.ts.
 */

import { logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
// FOX-1 (P12): deterministic output content backstop on the streaming path.
import { screenStudentFacingText } from '@/lib/ai/validation/output-screen';
import {
  callGroundedAnswerStream,
  type GroundedRequest,
  type Citation,
  type AbstainReason,
} from '@/lib/ai/grounded-client';
import { denormalizeFoxyResponse } from '@/lib/foxy/denormalize';
import {
  extractExpectation,
  writeExpectation,
  markExpectationAnswered,
  markExpectationAbandoned,
  type OpenExpectation,
  type StructuredAssistantPayload,
} from '@/lib/learn/foxy-expectations';
import {
  REFUND_ABSTAIN_REASONS,
  type CoachMode,
  type CognitiveContext,
} from './constants';
import { refundQuota } from './quota';
import { extractValidatedStructured } from './responders';
import { classifyExpectationLifecycle } from './cognitive-context';

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
export async function handleStreamingFoxyTurn(params: {
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

  // FOX-1 (P12): set when the completed, buffered answer fails the deterministic
  // content screen. Drives the synthesized `abstain` reconciliation frame +
  // quota refund in flush(), and forces a SAFE (empty) persisted record so no
  // non-streamed consumer (session-resume GET, parent portal, analytics) can
  // ever read the unsafe text.
  let safetyRedacted = false;

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

    // ── FOX-1 (P12): screen the COMPLETE buffered answer before commit ───────
    // True mid-stream blocking is infeasible (each delta is re-emitted verbatim
    // to the browser as it arrives). At MINIMUM we validate the complete
    // buffered output before the turn is persisted and before any non-streamed
    // consumer can read it. On a block we persist a SAFE (empty) record instead
    // of the unsafe text, and flush() emits a synthesized `abstain` frame so the
    // live client reconciles to the safe abstain UI. P13: category tags only.
    const screen = screenStudentFacingText(assistantContent, {
      grade: params.grade,
      subject: params.subject,
    });
    if (!screen.safe) {
      safetyRedacted = true;
      logger.warn('foxy.output.safety_blocked', {
        subject: params.subject,
        grade: params.grade,
        mode: params.mode,
        categories: screen.categories,
        traceId: lastTraceId,
        flow: 'grounded-answer-stream',
      });
      try {
        logAudit(params.userId, {
          action: 'foxy.chat.safety_blocked',
          resourceType: 'foxy_sessions',
          resourceId: params.resolvedSessionId,
          details: {
            subject: params.subject,
            grade: params.grade,
            mode: params.mode,
            categories: screen.categories,
            traceId: lastTraceId,
            flow: 'grounded-answer-stream',
          },
        });
      } catch { /* audit is non-critical */ }
    }
    // When redacted we persist an empty, structured-null assistant turn so the
    // unsafe text never lands in the DB; otherwise persist the validated answer.
    const persistContent = safetyRedacted ? '' : assistantContent;
    const persistStructured = safetyRedacted ? null : (structured ?? null);

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
            content: persistContent,
            structured: persistStructured,
            sources: safetyRedacted ? null : sourcesPayload,
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
              content: persistContent,
              // CHECK constraint `structured_role_check` permits structured only
              // on assistant rows; the column is nullable so legacy/fallback writes
              // explicitly null. Migration: 20260430010000_foxy_chat_messages_add_structured.
              structured: persistStructured,
              sources: safetyRedacted ? null : sourcesPayload,
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
    // FOX-1: skip entirely on a safety-redacted turn — we must NOT derive
    // next-turn anchors from blocked text.
    if (params.usePendingExpectations && !safetyRedacted) {
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

    // On a safety-redacted turn we already emitted `foxy.chat.safety_blocked`;
    // do not ALSO emit a normal completion audit.
    if (!safetyRedacted) {
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
    }
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
        if (safetyRedacted) {
          // FOX-1: the buffered answer failed the content screen AFTER the
          // upstream `text`/`done` frames were already re-emitted verbatim.
          // Emit a synthesized `abstain` frame so the live client reconciles to
          // the safe hard-abstain UI (onAbstain clears the streamed `content`),
          // and refund the quota — the student did not receive a usable answer.
          // We do NOT emit `persisted` (no feedback wiring to a redacted turn).
          // Residual: the live browser may have briefly shown the streamed
          // tokens before this frame lands; the PERSISTED record + every
          // non-streamed consumer are guaranteed safe (empty). See
          // 05-implementation.md "streaming residual".
          try {
            controller.enqueue(
              encoder.encode(
                `event: abstain\ndata: ${JSON.stringify({
                  abstainReason: 'upstream_error',
                  suggestedAlternatives: [],
                  traceId: lastTraceId,
                  latencyMs: 0,
                })}\n\n`,
              ),
            );
          } catch {
            /* controller closed (rare race) — persisted record is still safe */
          }
          await refundQuota(params.studentId, 'foxy_chat');
        } else if (assistantMessageId) {
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
