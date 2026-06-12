// supabase/functions/daily-cron/__tests__/contract.test.ts
//
// Deno test runner (NOT Vitest — vitest.config.ts does not include this file,
// so the npm suite is unaffected). Run via:
//   cd supabase/functions/daily-cron && deno test --allow-read
//   (--allow-all also works; this test only reads the local file system.)
// CI invocation (matching the sibling parent-portal / teacher-dashboard
// canaries in the `edge-function-tests` job):
//   deno test --no-lock --allow-read --allow-env \
//     supabase/functions/daily-cron/__tests__/
//
// ── Approach: STATIC-SOURCE CONTRACT CANARY ──────────────────────────────────
// daily-cron/index.ts is a MONOLITHIC Deno.serve() handler: the request handler
// is passed inline to Deno.serve() at module top level and is NOT exported, and
// the service-role Supabase client is built from a top-level esm.sh import
// (`createClient`). There is no seam to inject a mocked Supabase client or to
// freeze the wall-clock, so the handler cannot be imported and invoked in a
// behavioral test. We therefore use the same strategy the sibling canaries use:
// read index.ts as TEXT and assert the load-bearing structural invariants exist.
// No execution, no network, deterministic.
//
// This canary's JOB is to turn RED if a future edit silently:
//   1. removes/weakens the cron auth gate (fail-OPEN regression — P9-adjacent),
//   2. deletes or renames a critical cron step (silent loss of streak resets,
//      leaderboards, parent digests, subscription-adjacent contract lifecycle,
//      monthly synthesis, etc.),
//   3. removes per-step error isolation (one step throwing aborts the rest),
//   4. ungated the feature-flagged steps (monthly synthesis / school contracts).
//
// Assertions are tied to REAL substrings/patterns in the source verified at
// authoring time (daily-cron v31). They are intentionally specific so the test
// is meaningful, not vacuous.

import {
  assert,
  assertStringIncludes,
} from 'https://deno.land/std@0.210.0/assert/mod.ts';

const INDEX_PATH = new URL('../index.ts', import.meta.url);
const SRC: string = Deno.readTextFileSync(INDEX_PATH);

// Scope the auth-ordering assertions to the top-level Deno.serve() handler body,
// not to the helper functions defined above it.
const SERVE_IDX = SRC.indexOf('Deno.serve(');
const HANDLER = SRC.slice(SERVE_IDX);

// ─── 0. File shape sanity (canary precondition) ──────────────────────────────

Deno.test('daily-cron: is a Deno.serve() Edge Function (canary precondition)', () => {
  assert(SERVE_IDX > 0, 'expected a top-level Deno.serve( handler');
  // The handler is NOT exported — this is WHY we use a static canary. If a
  // future refactor exports it, switch this file to a behavioral mock test.
  assert(
    !/export\s+(async\s+)?function\s+handle/.test(SRC),
    'handler appears to be exported now — prefer a behavioral mock test over the static canary',
  );
});

// ─── 1. Auth gate present and FAIL-CLOSED ────────────────────────────────────
// The cron secret is taken from the CRON_SECRET env var, with a get_cron_secret()
// DB RPC fallback. The provided `x-cron-secret` header is compared in CONSTANT
// TIME (a naive `!==` would short-circuit and leak the secret via response
// timing). A mismatch — or an unavailable secret — must reject with 401, BEFORE
// any cron work runs.

Deno.test('daily-cron contract 1a: secret sourced from CRON_SECRET env + get_cron_secret() fallback', () => {
  assertStringIncludes(HANDLER, "Deno.env.get('CRON_SECRET')");
  assert(
    /\.rpc\(\s*['"]get_cron_secret['"]\s*\)/.test(HANDLER),
    'expected the get_cron_secret() RPC fallback when CRON_SECRET env is unset',
  );
  // Missing secret (env AND rpc both unavailable) is a 500 misconfiguration —
  // it must NOT fall through to running the cron with no auth.
  assert(
    /Server misconfiguration[\s\S]{0,80}?status:\s*500/.test(HANDLER),
    'expected a 500 (not a fall-through) when the secret cannot be resolved',
  );
});

Deno.test('daily-cron contract 1b: x-cron-secret compared in CONSTANT TIME, 401 on mismatch', () => {
  // Header is read and constant-time-compared (defeats timing side-channel).
  assertStringIncludes(HANDLER, "req.headers.get('x-cron-secret')");
  assert(
    /constantTimeEqual\(\s*provided\s*,\s*secret\s*\)/.test(HANDLER),
    'expected constantTimeEqual(provided, secret) — a naive !== leaks the secret via timing',
  );
  // The guard is fail-closed: missing secret OR mismatch → 401 Unauthorized.
  assert(
    /if\s*\(\s*!secret\s*\|\|\s*!constantTimeEqual\([^)]*\)\s*\)\s*return[\s\S]{0,120}?status:\s*401/.test(
      HANDLER,
    ),
    'expected `if (!secret || !constantTimeEqual(...)) return ... 401` fail-closed guard',
  );
});

Deno.test('daily-cron contract 1c: auth gate runs BEFORE any cron step dispatch', () => {
  const authGuardIdx = HANDLER.indexOf('constantTimeEqual(provided');
  const stepsArrayIdx = HANDLER.indexOf('const steps');
  const settleIdx = HANDLER.indexOf('Promise.allSettled(');
  assert(authGuardIdx > 0, 'constant-time auth guard not found in handler');
  assert(stepsArrayIdx > 0, 'cron steps array not found in handler');
  assert(settleIdx > 0, 'Promise.allSettled dispatch not found in handler');
  assert(
    authGuardIdx < stepsArrayIdx && authGuardIdx < settleIdx,
    'auth guard must precede the steps array AND the Promise.allSettled dispatch (no work before the 401 check)',
  );
});

// ─── 2. Critical steps present (no silent deletion/rename) ───────────────────
// Each entry below is a tuple of [step name registered in the `steps[]` array,
// the helper function it dispatches to]. If anyone deletes or renames a step,
// the corresponding assertion turns RED. These are the load-bearing nightly
// jobs — losing one silently degrades streaks / leaderboards / digests /
// subscription-adjacent contract lifecycle / monthly synthesis without an error.

const CRITICAL_STEPS: ReadonlyArray<readonly [string, string]> = [
  ['streaks_reset', 'resetMissedStreaks'],
  ['leaderboard_entries', 'recalculateLeaderboards'],
  ['parent_digests_sent', 'generateParentDigests'],
  ['task_queue_rows_deleted', 'cleanupTaskQueue'],
  ['health_snapshot', 'recordHealthSnapshot'],
  ['education_intelligence_rollup', 'computeEducationIntelligenceRollup'],
  ['performance_scores_recalculated', 'recalculatePerformanceScores'],
  ['challenges_generated', 'generateDailyChallenges'],
  ['streaks_managed', 'manageChallengeStreaks'],
  // Subscription-adjacent: school-contract lifecycle (T-60..1 reminders →
  // expiry → grace audit). This is the revenue-relevant expiry path in this
  // function (there is NO separate check_expired_subscriptions step in v31 —
  // student subscriptions expire via the payments webhook/verify RPCs, not the
  // cron — so the contract steps are what this canary guards here).
  ['contract_reminders_sent', 'processContractReminders'],
  ['contracts_expired', 'expireContracts'],
  ['contract_grace_audited', 'auditContractGracePeriods'],
  // Pedagogy v2 Wave 3 — flag-gated monthly synthesis trigger (asserted gated below).
  ['monthly_synthesis_triggered', 'triggerMonthlySynthesis'],
  ['purge_principal_ai', 'purgePrincipalAiTranscripts'],
];

for (const [stepName, fnName] of CRITICAL_STEPS) {
  Deno.test(`daily-cron contract 2: step '${stepName}' is registered and dispatches ${fnName}()`, () => {
    // The step is registered in the steps[] array with its canonical name...
    assert(
      HANDLER.includes(`'${stepName}'`),
      `expected cron step name '${stepName}' to remain registered in the steps[] array`,
    );
    // ...and dispatches the real helper function.
    assert(
      HANDLER.includes(`${fnName}(sb)`),
      `expected step '${stepName}' to dispatch ${fnName}(sb) — deletion/rename of the step would break this`,
    );
    // The helper must still be defined in the module.
    assert(
      new RegExp(`function\\s+${fnName}\\b`).test(SRC),
      `expected helper function ${fnName} to remain defined`,
    );
  });
}

// ─── 3. Per-step error isolation ─────────────────────────────────────────────
// Every step runs under Promise.allSettled so one throwing step does NOT abort
// the rest; failed steps are reported in an `errors` map and the response is a
// 207 (multi-status), not a hard 500. This is the invariant that keeps a single
// flaky step from cancelling streak resets / leaderboards on the same night.

Deno.test('daily-cron contract 3a: steps run under Promise.allSettled (one failure does not abort the rest)', () => {
  assert(
    /Promise\.allSettled\(\s*steps\.map\(\s*\(\[?,?\s*fn\]?\)\s*=>\s*fn\(\)\s*\)\s*\)/.test(
      HANDLER,
    ),
    'expected Promise.allSettled(steps.map(([,fn]) => fn())) — the per-step isolation primitive',
  );
});

Deno.test('daily-cron contract 3b: failed steps surface in an errors map → 207, not a hard 500', () => {
  // Rejected settlements are collected into an errors map keyed by step name.
  assert(
    /status\s*===\s*['"]fulfilled['"][\s\S]{0,160}?errors\[name\]\s*=/.test(HANDLER),
    'expected fulfilled/rejected fan-out where rejected reasons populate errors[name]',
  );
  // Partial failure is reported as 207 (multi-status), success as 200 — a
  // single failed step must NOT collapse the whole run into a 5xx.
  assert(
    /status:\s*hasErr\s*\?\s*207\s*:\s*200/.test(HANDLER),
    'expected `status: hasErr ? 207 : 200` (partial failure = 207, not a hard 500)',
  );
});

// ─── 4. Feature-flag gating of the gated steps ───────────────────────────────
// The monthly-synthesis trigger and the three school-contract steps are gated
// behind feature flags. If the gate is removed, these would fire for everyone
// regardless of rollout state. Assert the flags are referenced by the gating
// helpers.

Deno.test('daily-cron contract 4a: monthly synthesis is gated behind ff_pedagogy_v2_monthly_synthesis', () => {
  assertStringIncludes(SRC, 'ff_pedagogy_v2_monthly_synthesis');
  // The flag is read inside triggerMonthlySynthesis and gates the per-student
  // fan-out (early-return when the flag row is missing / disabled).
  assert(
    /flag_name['"]\s*,\s*['"]ff_pedagogy_v2_monthly_synthesis['"]\s*\)[\s\S]{0,200}?if\s*\(\s*!flagRow\s*\|\|\s*!flagRow\.is_enabled\s*\)\s*return\s*0/.test(
      SRC,
    ),
    'expected triggerMonthlySynthesis to early-return 0 when the synthesis flag is missing/disabled',
  );
});

Deno.test('daily-cron contract 4b: contract-lifecycle steps are gated behind ff_school_contracts_v1', () => {
  assertStringIncludes(SRC, 'ff_school_contracts_v1');
  // The shared isContractFlagOn() gate is the early-return guard at the top of
  // all three contract steps.
  assert(
    /async\s+function\s+isContractFlagOn\b/.test(SRC),
    'expected the isContractFlagOn() shared flag gate to remain defined',
  );
  for (const fn of ['processContractReminders', 'expireContracts', 'auditContractGracePeriods']) {
    const fnIdx = SRC.indexOf(`async function ${fn}`);
    assert(fnIdx > 0, `expected ${fn} to remain defined`);
    // The flag gate must be the FIRST guard in each contract step.
    const body = SRC.slice(fnIdx, fnIdx + 400);
    assert(
      /if\s*\(\s*!\(await isContractFlagOn\(supabase\)\)\s*\)\s*return\s*0/.test(body),
      `expected ${fn} to early-return 0 when ff_school_contracts_v1 is OFF (gate must precede work)`,
    );
  }
});
