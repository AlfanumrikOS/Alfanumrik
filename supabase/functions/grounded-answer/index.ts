// supabase/functions/grounded-answer/index.ts
// HTTP entry point for the grounded-answer Edge Function.
//
// Responsibility: Deno.serve handler + request validation + safety net.
// All pipeline orchestration lives in pipeline.ts (Q1 refactor). The shared
// Supabase service-role client lives in _sb.ts so both modules can share
// the singleton without a circular import.
//
// Contract: spec §6.1 request/response shape.
// Safety net (spec §3.8 "service never throws"): runPipeline is wrapped in
// try/catch so unexpected errors (missing prompt template, DB outage that
// throws at client-init, etc.) become a structured upstream_error abstain
// instead of an HTTP 500 with a Deno default page (C10 fix).

import { validateRequest } from './validators.ts';
import { runPipeline, writeUpstreamErrorTrace } from './pipeline.ts';
import { runStreamingPipeline } from './pipeline-stream.ts';
import { ensureSb, getSb, setSbForTests } from './_sb.ts';
import type { GroundedRequest, GroundedResponse } from './types.ts';

// Re-export pipeline hooks for tests. Conventional import path for tests
// is `../index.ts`; keeping these forwards avoids churn across every test
// file that already imports from here.
export { runPipeline, writeUpstreamErrorTrace } from './pipeline.ts';
export { __resetFeatureFlagCacheForTests } from './pipeline.ts';

// Test hook: inject a stub Supabase client. Forwarded to the shared holder
// so pipeline.ts picks up the same stub.
// deno-lint-ignore no-explicit-any
export function __setSupabaseClientForTests(client: any): void {
  setSbForTests(client);
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Foxy soft-cap enforcement (server-side guard for the prompt's 150-word
 * cap; we allow a 30-word grace window before truncating).
 *
 * The system prompt instructs Foxy to keep replies under ~150 words, but
 * the LLM occasionally overruns. We don't fail the request — we truncate
 * at the last sentence boundary at-or-before the 180-word point so the
 * student still gets a coherent reply, and we log the original count to
 * `foxy_word_cap_exceeded` for observability.
 *
 * Sentence-boundary detection: we scan backwards from the 180-word point
 * for the last `.`, `?`, or `!` followed by whitespace. If no boundary
 * exists in the window we fall back to a hard word-count truncation so
 * we never amplify a runaway response.
 */
const FOXY_WORD_SOFT_CAP = 180;

export function applyFoxyWordCap(answer: string): {
  answer: string;
  truncated: boolean;
  originalWordCount: number;
} {
  if (typeof answer !== 'string' || answer.length === 0) {
    return { answer, truncated: false, originalWordCount: 0 };
  }
  const words = answer.split(/\s+/).filter((w) => w.length > 0);
  const originalWordCount = words.length;
  if (originalWordCount <= FOXY_WORD_SOFT_CAP) {
    return { answer, truncated: false, originalWordCount };
  }

  // Reconstruct the prefix containing the first FOXY_WORD_SOFT_CAP words
  // by walking the original string so whitespace/punctuation is preserved.
  let wordsSeen = 0;
  let cutIndex = answer.length;
  // Match runs of non-whitespace followed by trailing whitespace.
  const re = /\S+\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    wordsSeen += 1;
    if (wordsSeen >= FOXY_WORD_SOFT_CAP) {
      cutIndex = m.index + m[0].length;
      break;
    }
  }
  const prefix = answer.slice(0, cutIndex);

  // Walk backwards looking for `. ` / `? ` / `! ` (or end-of-string
  // sentence terminator). Accept a terminator if it is followed by
  // whitespace OR is at the very end of the prefix.
  let boundary = -1;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const ch = prefix[i];
    if (ch === '.' || ch === '?' || ch === '!') {
      const next = prefix[i + 1];
      if (next === undefined || /\s/.test(next)) {
        boundary = i + 1;
        break;
      }
    }
  }
  const truncated = boundary > 0 ? prefix.slice(0, boundary).trimEnd() : prefix.trimEnd();
  return { answer: truncated, truncated: true, originalWordCount };
}

/**
 * Structured upstream_error response used as the try/catch fallback.
 * Shape matches the abstain branch of GroundedResponse so callers don't
 * have to special-case "Deno default 500 page" vs a normal abstain.
 * status=500 signals to clients that this is a server issue (not a
 * content/scope decision).
 */
function buildPanicResponse(
  traceId: string,
  latencyMs: number,
): GroundedResponse {
  return {
    grounded: false,
    abstain_reason: 'upstream_error',
    suggested_alternatives: [],
    trace_id: traceId,
    meta: { latency_ms: latencyMs },
  };
}

export async function handleRequest(req: Request): Promise<Response> {
  const started = Date.now();

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Streaming branch: opt-in via `?stream=1` query param. The body shape is
  // identical to the blocking POST. We use a query param (not a request body
  // field) so an HTTP middleware that doesn't parse JSON can still route on
  // streaming-vs-not. Phase 1.1 — soft-mode only (foxy-tutor).
  const url = new URL(req.url);
  const wantsStream = url.searchParams.get('stream') === '1';

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const { error, request } = validateRequest(body);
  if (error || !request) {
    return jsonResponse(400, { error: `invalid_request:${error!.field}` });
  }

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  const voyageKey = Deno.env.get('VOYAGE_API_KEY') ?? '';

  if (wantsStream) {
    // Streaming guards: only soft-mode + retrieve_only=false are supported.
    // Strict-mode requires post-hoc grounding-check on the full answer (would
    // defeat streaming). retrieve_only has no answer text. Both fall through
    // to the blocking path silently for compatibility.
    const r = request as GroundedRequest;
    if (r.mode === 'soft' && r.retrieve_only !== true) {
      try {
        ensureSb();
        return buildStreamingResponse(r, started, anthropicKey, voyageKey);
      } catch (err) {
        console.error(
          `grounded-answer: streaming setup threw — ${String(err instanceof Error ? err.stack ?? err.message : err)}`,
        );
        const traceId = await writeUpstreamErrorTrace(r, started);
        return jsonResponse(500, buildPanicResponse(traceId, Date.now() - started));
      }
    }
    // Else: silently fall through to the blocking path below.
  }

  try {
    ensureSb();
    const response = await runPipeline(
      request as GroundedRequest,
      started,
      anthropicKey,
      voyageKey,
    );
    // Server-side word-cap guard: enforce the foxy_tutor_v1 prompt's
    // 150-word soft cap (with a 30-word grace) before the response leaves
    // the service. Only grounded:true responses carry an `answer` field.
    // Abstain responses are unaffected.
    if (response.grounded && typeof response.answer === 'string') {
      const capped = applyFoxyWordCap(response.answer);
      if (capped.truncated) {
        console.log(
          JSON.stringify({
            event: 'foxy_word_cap_exceeded',
            original_word_count: capped.originalWordCount,
            soft_cap: FOXY_WORD_SOFT_CAP,
            caller: (request as GroundedRequest).caller,
            grade: (request as GroundedRequest).scope.grade,
            subject: (request as GroundedRequest).scope.subject_code,
            trace_id: response.trace_id,
          }),
        );
        response.answer = capped.answer;
      }
    }
    return jsonResponse(200, response);
  } catch (err) {
    // C10: spec §3.8 — service never throws. A thrown error here means
    // something deep in the pipeline blew up unexpectedly (most likely a
    // missing prompt template .txt file, a bad Supabase client, or a
    // Deno runtime error). Return a structured abstain so callers can
    // handle it the same way they handle any other upstream_error.
    console.error(
      `grounded-answer: runPipeline threw — ${String(err instanceof Error ? err.stack ?? err.message : err)}`,
    );
    const traceId = await writeUpstreamErrorTrace(
      request as GroundedRequest,
      started,
    );
    return jsonResponse(
      500,
      buildPanicResponse(traceId, Date.now() - started),
    );
  }
}

/**
 * Build an SSE Response that streams pipeline events to the client.
 * Each PipelineStreamEvent is serialized as one SSE frame with a named event
 * type so consumers can attach typed listeners. The cap-truncation logic from
 * applyFoxyWordCap CANNOT be applied mid-stream (we'd have to buffer the whole
 * answer); instead we rely on Claude's max_tokens setting + the prompt's
 * 150-word soft cap to keep responses bounded.
 */
function buildStreamingResponse(
  request: GroundedRequest,
  startedAt: number,
  anthropicKey: string,
  voyageKey: string,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (eventName: string, payload: unknown) => {
        const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
        controller.enqueue(encoder.encode(frame));
      };
      try {
        for await (const evt of runStreamingPipeline(
          request,
          startedAt,
          anthropicKey,
          voyageKey,
        )) {
          if (evt.kind === 'metadata') {
            send('metadata', {
              groundingStatus: evt.groundingStatus,
              citations: evt.citations,
              traceId: evt.traceId,
              confidence: evt.confidence,
            });
          } else if (evt.kind === 'text') {
            send('text', { delta: evt.delta });
          } else if (evt.kind === 'done') {
            send('done', {
              tokensUsed: evt.tokensUsed,
              latencyMs: evt.latencyMs,
              groundedFromChunks: evt.groundedFromChunks,
              claudeModel: evt.claudeModel,
              answerLength: evt.answerLength,
            });
          } else if (evt.kind === 'abstain') {
            send('abstain', {
              abstainReason: evt.abstainReason,
              suggestedAlternatives: evt.suggestedAlternatives,
              traceId: evt.traceId,
              latencyMs: evt.latencyMs,
            });
          } else if (evt.kind === 'error') {
            send('error', {
              reason: evt.reason,
              traceId: evt.traceId,
              latencyMs: evt.latencyMs,
            });
          }
        }
      } catch (err) {
        console.error(
          `grounded-answer(stream): generator threw — ${String(err instanceof Error ? err.stack ?? err.message : err)}`,
        );
        send('error', {
          reason: 'pipeline_threw',
          traceId: 'pending',
          latencyMs: Date.now() - startedAt,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // Disable nginx/CDN buffering so SSE frames arrive immediately.
      'X-Accel-Buffering': 'no',
    },
  });
}

Deno.serve(handleRequest);

// Expose for tests that inspect the live client.
export { getSb as __sbForTests };