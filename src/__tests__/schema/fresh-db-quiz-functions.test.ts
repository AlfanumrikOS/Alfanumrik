import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';

/**
 * Fresh-DB bootstrap probe for the quiz-submit functions that the pg_dump
 * baseline silently OMITTED. Catalogued as REG-144 (P1 score accuracy / P4
 * atomic quiz submission).
 *
 * BACKGROUND (see .claude/regression-catalog.md §REG-144):
 *   The pg_dump-derived baseline
 *   (`supabase/migrations/00000000000000_baseline_from_prod.sql`) dropped THREE
 *   `public` functions, and verifying them against the LINKED Supabase project
 *   (`shktyoxqhundlvkiwguu`) on 2026-06-15 returned 0 rows for all three — they
 *   were absent from the live project too, not just the baseline:
 *     - update_learner_state_post_quiz  (P0 — quiz-submit BKT update)
 *     - reset_demo_student              (P2/P3 — demo/seed tooling)
 *     - compute_post_quiz_action        (P1 — CME next-action; DEFERRED)
 *   `update_learner_state_post_quiz` is PERFORM'd UNGUARDED inside
 *   `submit_quiz_results_v2`, so on a fresh DB its absence raises
 *   `undefined_function` and rolls back the ENTIRE atomic submission (no score,
 *   no XP) the instant quiz traffic with a non-null `topic_id` arrives.
 *
 * Fix: compensating migration
 *   `supabase/migrations/20260615142552_restore_missing_quiz_functions.sql`
 *   restores 2 of 3 (`update_learner_state_post_quiz`, `reset_demo_student`).
 *
 * INTENTIONAL EXCLUSION — `compute_post_quiz_action` is DEFERRED by design and is
 * NOT asserted present here. Its legacy body hit irreconcilable schema drift
 * (`chapter_topics` → `curriculum_topics`; `error_count_conceptual` /
 * `current_retention` no longer on `concept_mastery`) and a redesign is required
 * before restore (`docs/architecture/cme-post-quiz-action-redesign.md`). Crucially
 * its call site IS exception-guarded inside `submit_quiz_results_v2`, so its
 * continued absence degrades SILENTLY (next-action no-ops) and does NOT break quiz
 * submit — which is exactly why deferring it is safe and why asserting its
 * presence would (correctly) fail. The count test below therefore probes the
 * 3-name set and expects exactly 2 present.
 *
 * WHY THIS IS LIVE-ONLY (skipIf no TEST_SUPABASE_URL):
 *   "does a function EXIST in pg_proc" cannot be proven by reading SQL text — the
 *   whole point of REG-144 is that the baseline's TEXT was wrong while the live DB
 *   was missing the function. So this probe queries pg_proc on a real database and
 *   skips cleanly in the normal unit lane (no DB), mirroring the live-DB skipIf
 *   gate in `src/__tests__/monitoring/learning-events-rls.test.ts`.
 *
 * HOW pg_proc IS READ FROM THE JS CLIENT:
 *   PostgREST does NOT expose `pg_catalog.pg_proc` via `.from(...)` — the Supabase
 *   JS client cannot `.from('pg_proc')`. There is also no generic SQL-exec RPC in
 *   the baseline. The canonical mechanism the repo's own production code uses to
 *   distinguish "function absent" from "function present" is the PostgREST RPC
 *   resolution error: calling a function that is NOT in pg_proc returns a
 *   "missing object" error (PGRST202 / 42883 / "could not find the function" /
 *   "schema cache") — see `isMissingObjectError()` in
 *   `src/app/api/school-admin/ai-assistant/route.ts:128`. A function that DOES
 *   exist in pg_proc resolves: it either succeeds, or fails with a DIFFERENT error
 *   (runtime / argument / permission), NEVER a missing-object error. So:
 *     missing-object error  ⇒ NOT in pg_proc  (count 0)
 *     anything else         ⇒ IS  in pg_proc  (count 1)
 *   This is exactly the `SELECT proname FROM pg_proc … IN (…)` row-count
 *   invariant REG-144 specifies, expressed through the only pg_proc-existence
 *   channel the JS client has.
 */

// -----------------------------------------------------------------------------
// Live-DB gate (real database). Skipped unless TEST_SUPABASE_URL is set —
// same gate as the monitoring RLS suite.
// -----------------------------------------------------------------------------

const LIVE_DB = process.env.TEST_SUPABASE_URL !== undefined;
const SUPABASE_URL = process.env.TEST_SUPABASE_URL;
const SERVICE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

const COMPENSATING_MIGRATION =
  'supabase/migrations/20260615142552_restore_missing_quiz_functions.sql';

// The 3-name set REG-144 probes. Exactly TWO are RESTORED;
// compute_post_quiz_action is intentionally DEFERRED (excluded by design).
const RESTORED_FUNCTIONS = [
  'update_learner_state_post_quiz',
  'reset_demo_student',
] as const;
const DEFERRED_FUNCTION = 'compute_post_quiz_action';
const THREE_NAME_SET = [...RESTORED_FUNCTIONS, DEFERRED_FUNCTION] as const;

// The RPC that PERFORMs update_learner_state_post_quiz. Its own presence is the
// upstream half of the REG-144 hazard (a fresh DB missing it scores nothing).
const QUIZ_SUBMIT_RPC = 'submit_quiz_results_v2';

// -----------------------------------------------------------------------------
// pg_proc existence probe via PostgREST RPC resolution (see file header).
// -----------------------------------------------------------------------------

/** True when the error means PostgREST could not resolve the function in
 *  pg_proc — i.e. the function does NOT exist. Mirrors the repo's own
 *  `isMissingObjectError()` (ai-assistant/route.ts:128). */
function isMissingFunctionError(
  err: Pick<PostgrestError, 'code' | 'message'> | null | undefined,
): boolean {
  if (!err) return false;
  // PGRST202 = RPC not found in schema cache; 42883 = undefined_function.
  if (err.code === 'PGRST202' || err.code === '42883') return true;
  const m = (err.message || '').toLowerCase();
  return (
    m.includes('could not find the function') ||
    m.includes('does not exist') ||
    m.includes('schema cache')
  );
}

/** Resolves to 1 if the named function EXISTS in public.pg_proc, else 0.
 *  Calls the RPC with an empty arg object: a present function resolves (and
 *  fails on args/runtime — NOT a missing-object error), an absent function
 *  returns a missing-object error. */
async function procExists(
  client: SupabaseClient,
  proname: string,
): Promise<0 | 1> {
  const { error } = await client.rpc(proname as never, {} as never);
  if (error && isMissingFunctionError(error)) return 0;
  // No error, or a non-missing error (wrong args / runtime / permission) ⇒
  // the function is resolvable in pg_proc.
  return 1;
}

// -----------------------------------------------------------------------------
// STRUCTURAL assertion — always run (no DB needed). Guards against the
// compensating migration being removed/renamed, which would silently green the
// live block below. Mirrors the always-on migration-locatable guard in
// learning-events-rls.test.ts.
// -----------------------------------------------------------------------------

describe('REG-144 — compensating migration must be locatable', () => {
  it('20260615142552_restore_missing_quiz_functions.sql is present', () => {
    const candidates = [
      path.resolve(process.cwd(), COMPENSATING_MIGRATION),
      path.resolve(process.cwd(), '..', COMPENSATING_MIGRATION),
    ];
    const found = candidates.some((c) => fs.existsSync(c));
    expect(found).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// LIVE assertions — real database. Skipped in the normal unit lane (no
// TEST_SUPABASE_URL), so `npm test` must report these as SKIPPED, never failed.
// -----------------------------------------------------------------------------

describe.skipIf(!LIVE_DB)('fresh-DB quiz functions (REG-144)', () => {
  let admin: SupabaseClient; // service role — needed to resolve SECURITY DEFINER fns

  beforeAll(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    admin = createClient(SUPABASE_URL!, SERVICE_KEY!, {
      auth: { persistSession: false },
    });
  });

  // [REG-144] update_learner_state_post_quiz — the P0 quiz-submit BKT update.
  // PERFORM'd UNGUARDED inside submit_quiz_results_v2; its absence on a fresh DB
  // rolls back the whole submission (no score, no XP).
  it('REG-144: update_learner_state_post_quiz must exist', async () => {
    expect(await procExists(admin, 'update_learner_state_post_quiz')).toBe(1);
  });

  // [REG-144] reset_demo_student — demo/seed tooling, restored verbatim
  // (question_responses.session_id repointed to quiz_session_id for the live schema).
  it('REG-144: reset_demo_student must exist', async () => {
    expect(await procExists(admin, 'reset_demo_student')).toBe(1);
  });

  // [REG-144] Of the 3-name set, EXACTLY 2 are restored. compute_post_quiz_action
  // is intentionally DEFERRED (schema drift; redesign required; absence is
  // exception-guarded inside submit_quiz_results_v2 so it does NOT break quiz
  // submit). Asserting its presence would fail by design — so the count is 2.
  it('REG-144: exactly 2 of 3 restored (compute_post_quiz_action deferred)', async () => {
    const flags = await Promise.all(
      THREE_NAME_SET.map((name) => procExists(admin, name)),
    );
    const presentCount = flags.reduce<number>((sum, f) => sum + f, 0);
    expect(presentCount).toBe(2);

    // And specifically: the two restored ones present, the deferred one absent.
    const byName = Object.fromEntries(
      THREE_NAME_SET.map((name, i) => [name, flags[i]]),
    ) as Record<(typeof THREE_NAME_SET)[number], 0 | 1>;
    expect(byName.update_learner_state_post_quiz).toBe(1);
    expect(byName.reset_demo_student).toBe(1);
    expect(byName.compute_post_quiz_action).toBe(0);
  });

  // [REG-144] The upstream half of the hazard: the RPC that PERFORMs
  // update_learner_state_post_quiz must itself resolve. A fresh DB missing the
  // quiz-submit RPC scores nothing regardless of the BKT function.
  it('structural: submit_quiz_results_v2 must exist (the RPC that calls update_learner_state_post_quiz)', async () => {
    expect(await procExists(admin, QUIZ_SUBMIT_RPC)).toBe(1);
  });
});
