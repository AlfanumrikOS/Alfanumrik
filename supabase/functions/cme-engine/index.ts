// ─────────────────────────────────────────────────────────────────────────────
// cme-engine — TOMBSTONE (structured 410)
//
// RETIRED 2026-08-05 (Foxy North-Star Phase 2 wave 2b, tracker E1/E3),
// following the quiz-generator-v2 tombstone precedent documented in
// docs/runbooks/edge-function-drift-report.md.
//
// Why: the last two callers — packages/lib/src/supabase.ts's
// processAdaptiveLearning() (record_response fan-out) and getCmeNextAction()
// (get_next_action) — were verified dead and deleted in the same PR. The
// function's write target, cme_concept_state, is COMMENT-tombstoned as
// RETIRED (migration 20260808000100); canonical learner state is
// concept_mastery, written solely by the update_learner_state_post_quiz SQL
// RPC inside the atomic submit chain, and read via the
// @alfanumrik/lib/learner-model facade (deriveNextAction replaces
// get_next_action; topic_mastery_rollup replaces state reads).
//
// This tombstone is REVERSIBLE (git history holds the full implementation;
// redeploy to restore) and fails LOUDLY: every hit is a structured 410 that
// shows up in edge logs. Live steps (ops, post-merge):
//   1. supabase functions deploy cme-engine   (ship the tombstone)
//   2. supabase functions list                (verify deployed version)
//   3. 30-day invocation-log watch for 410s
//   4. supabase functions delete cme-engine   (only after a clean window)
// ─────────────────────────────────────────────────────────────────────────────
import { getCorsHeaders } from '../_shared/cors.ts'

const TOMBSTONE = {
  error: 'gone',
  code: 'cme_engine_retired',
  replacement: '/api + learner-model facade',
  detail:
    'cme-engine was retired 2026-08-05. Mastery is written only by the ' +
    'update_learner_state_post_quiz SQL RPC in the atomic quiz-submit chain; ' +
    'reads go through the @alfanumrik/lib/learner-model facade ' +
    '(deriveNextAction / getMasteryState) and the topic_mastery_rollup view.',
} as const

Deno.serve((req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'))
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  // Preserve the function's pinned 'jwt-user' auth posture (P9 auth-guard
  // sweep: edge-function-auth-guard-sweep.test.ts): unauthenticated probes
  // still get 401; the legacy authenticated callers get the loud 410.
  if (!req.headers.get('Authorization')) {
    return new Response(JSON.stringify({ error: 'Authorization required' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  return new Response(JSON.stringify(TOMBSTONE), {
    status: 410,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
