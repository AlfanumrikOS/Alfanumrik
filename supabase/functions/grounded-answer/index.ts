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

  try {
    ensureSb();
    const response = await runPipeline(
      request as GroundedRequest,
      started,
      anthropicKey,
      voyageKey,
    );
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

Deno.serve(handleRequest);

// Expose for tests that inspect the live client.
export { getSb as __sbForTests };