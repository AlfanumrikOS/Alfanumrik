// supabase/functions/grounded-answer/index.ts
// HTTP entry point for the grounded-answer Edge Function.
//
// Responsibility: top-level Deno.serve handler + control flow only.
// The pipeline stages (Voyage, retrieval, Claude, grounding check, trace,
// circuit breaker) live in sibling files and are wired in by later tasks.
//
// Contract: spec §6.1 request/response shape.
// Current state (Task 2.1): validates request → returns 400 on bad input
// or 501 "not_implemented_yet" on valid input. Pipeline stages come next.

import { validateRequest } from './validators.ts';

Deno.serve(async (req) => {
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

  // TODO (subsequent tasks): dispatch to pipeline
  //   - Task 2.2: coverage precheck
  //   - Task 2.3: Voyage embedding
  //   - Task 2.4: retrieval + scope verification
  //   - Task 2.5: Claude call with model fallback
  //   - Task 2.6: grounding check (strict mode)
  //   - Task 2.7: confidence + citations
  //   - Task 2.8: trace write
  //   - Task 2.9: circuit breaker
  //   - Task 2.10: timeout budget + cache
  //   - Task 2.11: retrieve_only mode
  return jsonResponse(501, { error: 'not_implemented_yet' });
});

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}