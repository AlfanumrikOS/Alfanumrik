// supabase/functions/grounded-answer/index.ts
import { validateRequest } from './validators.ts';
import { runPipeline, writeUpstreamErrorTrace } from './pipeline.ts';
import { runStreamingPipeline } from './pipeline-stream.ts';
import { ensureSb, getSb, setSbForTests } from './_sb.ts';
import type { GroundedRequest, GroundedResponse } from './types.ts';

export { runPipeline, writeUpstreamErrorTrace } from './pipeline.ts';
export { __resetFeatureFlagCacheForTests } from './pipeline.ts';

// deno-lint-ignore no-explicit-any
export function __setSupabaseClientForTests(client: any): void {
  setSbForTests(client);
}

/** CORS: required for browser invoke + preflight */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

// TODO(ai-engineer): re-enable truncation once the MoL grading pipeline
// confirms that capped responses do not lose scoring points. Until then,
// the cap is a no-op (students see the full answer; truncated=false).
const FOXY_WORD_SOFT_CAP = 180; // eslint-disable-line @typescript-eslint/no-unused-vars

export function applyFoxyWordCap(answer: string): {
  answer: string;
  truncated: boolean;
  originalWordCount: number;
} {
  const words = answer.split(/\s+/).filter((w) => w.length > 0);
  return { answer, truncated: false, originalWordCount: words.length };
}

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

  // ✅ Preflight support (fixes OPTIONS 405 from browser)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    });
  }

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
  const openaiKey = Deno.env.get('OPENAI_API_KEY') ?? '';

  if (wantsStream) {
    const r = request as GroundedRequest;
    if (r.mode === 'soft' && r.retrieve_only !== true) {
      try {
        ensureSb();
        return buildStreamingResponse(r, started, anthropicKey, voyageKey, openaiKey);
      } catch (err) {
        console.error(
          `grounded-answer: streaming setup threw — ${String(err instanceof Error ? err.stack ?? err.message : err)}`,
        );
        const traceId = await writeUpstreamErrorTrace(r, started);
        return jsonResponse(500, buildPanicResponse(traceId, Date.now() - started));
      }
    }
  }

  try {
    ensureSb();
    const response = await runPipeline(
      request as GroundedRequest,
      started,
      anthropicKey,
      voyageKey,
      openaiKey,
    );

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

function buildStreamingResponse(
  request: GroundedRequest,
  startedAt: number,
  anthropicKey: string,
  voyageKey: string,
  openaiKey: string,
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
          openaiKey,
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
      'X-Accel-Buffering': 'no',
      ...corsHeaders, // ✅ important for browser streaming
    },
  });
}

Deno.serve(handleRequest);

export { getSb as __sbForTests };
