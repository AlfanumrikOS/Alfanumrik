// supabase/functions/grounded-answer/index.ts
// HTTP entry point for the grounded-answer Edge Function.
//
// Responsibility: top-level Deno.serve handler + control flow only.
// The pipeline stages (Voyage, retrieval, Claude, grounding check, trace,
// circuit breaker) live in sibling files and are wired in by later tasks.
//
// Contract: spec §6.1 request/response shape.
// Current state (Task 2.2): validates request → runs coverage precheck.
// If the chapter is not ready, returns abstain(chapter_not_ready) with up
// to 3 suggested alternatives. Valid+covered requests fall through to 501
// until Task 2.3+ wire in Voyage/Claude.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateRequest } from './validators.ts';
import { checkCoverage } from './coverage.ts';
import { buildAbstainResponse } from './abstain.ts';

// Service-role client: this function runs server-side only and needs to
// read cbse_syllabus regardless of the calling user's RLS context.
const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
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

  // Phase 2.2 — coverage precheck. Short-circuits before Voyage/Claude.
  const coverage = await checkCoverage(sb, {
    grade: request.scope.grade,
    subject_code: request.scope.subject_code,
    chapter_number: request.scope.chapter_number,
  });

  if (!coverage.ready) {
    // trace_id placeholder — Task 2.8 replaces with real trace write.
    return jsonResponse(
      200,
      buildAbstainResponse(
        coverage.abstain_reason!,
        coverage.alternatives,
        'pending',
        started,
      ),
    );
  }

  // TODO (subsequent tasks): dispatch to pipeline
  //   - Task 2.3: Voyage embedding
  //   - Task 2.4: retrieval + scope verification
  //   - Task 2.5: Claude call with model fallback
  //   - Task 2.6: grounding check (strict mode)
  //   - Task 2.7: confidence + citations
  //   - Task 2.8: trace write (replaces 'pending')
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