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
// Auth is now delegated to verifyInternalCronRequest from
// _shared/security/internal-cron-auth.ts, which handles: CRON_SECRET env var,
// get_cron_secret() DB RPC fallback, constant-time comparison, and rejection
// responses (401/500). The handler checks auth.ok and bails before any cron work.

Deno.test('daily-cron contract 1a: auth delegated to verifyInternalCronRequest (shared internal-cron-auth module)', () => {
  // Auth is delegated to the shared verifyInternalCronRequest utility (not inlined).
  assertStringIncludes(HANDLER, 'verifyInternalCronRequest(');
  // The handler checks the returned auth.ok before ANY cron work.
  assertStringIncludes(HANDLER, 'if (!auth.ok)');
  // Unauthorized requests are rejected via internalCronUnauthorizedResponse.
  assertStringIncludes(HANDLER, 'internalCronUnauthorizedResponse(');
});

Deno.test('daily-cron contract 1b: auth is fail-closed — unauthorized requests exit before any cron work', () => {
  // The handler bails immediately on !auth.ok before reaching the step dispatch.
  assertStringIncludes(HANDLER, 'if (!auth.ok)');
  // Audit trails are emitted for BOTH rejected and accepted invocations.
  assert(
    (HANDLER.match(/auditInternalCronInvocation\(/g) ?? []).length >= 2,
    'expected auditInternalCronInvocation to be called for both rejected and accepted requests',
  );
});

Deno.test('daily-cron contract 1c: auth gate runs BEFORE any cron step dispatch', () => {
  const authGuardIdx = HANDLER.indexOf('verifyInternalCronRequest(');
  const actionsIdx = HANDLER.indexOf('createDailyCronActions(');
  const settleIdx = HANDLER.indexOf('Promise.allSettled(');
  assert(authGuardIdx > 0, 'verifyInternalCronRequest call not found in handler');
  assert(actionsIdx > 0, 'createDailyCronActions call not found in handler');
  assert(settleIdx > 0, 'Promise.allSettled dispatch not found in handler');
  assert(
    authGuardIdx < actionsIdx && authGuardIdx < settleIdx,
    'auth gate must precede createDailyCronActions AND Promise.allSettled dispatch (no work before the auth check)',
  );
});

// ─── 2. Critical steps present (no silent deletion/rename) ───────────────────
// Each entry below is a tuple of [step name registered in createDailyCronActions({...}),
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
  // Phase A Loop A — thin trigger to the Next.js adaptive-remediation worker.
  // Deliberately NOT flag-gated in Deno: the worker gates INJECT on
  // ff_adaptive_remediation_v1 and VERIFY on active rows existing, so the
  // kill switch drains mid-flight interventions instead of freezing them
  // (spec §9). Asserted thin below (contract 4c).
  ['adaptive_remediation_triggered', 'triggerAdaptiveRemediation'],
  ['purge_principal_ai', 'purgePrincipalAiTranscripts'],
];

for (const [stepName, fnName] of CRITICAL_STEPS) {
  Deno.test(`daily-cron contract 2: step '${stepName}' is registered and dispatches ${fnName}()`, () => {
    // The step is registered in createDailyCronActions({...}) as an object key.
    // New style: unquoted dict key `stepName: () => fn(sb)`.
    // Fallback: accept either quoted (`'stepName'`) or unquoted (`stepName:`) form.
    assert(
      HANDLER.includes(`${stepName}:`) || HANDLER.includes(`'${stepName}'`),
      `expected cron step name '${stepName}' to remain registered in createDailyCronActions`,
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
    /Promise\.allSettled\(\s*actions\.map\(/.test(HANDLER),
    'expected Promise.allSettled(actions.map(...)) — the per-step isolation primitive',
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

Deno.test('daily-cron contract 4c: adaptive-remediation trigger is THIN and ungated in Deno (drain semantics)', () => {
  // The step POSTs to the Next.js worker route with the cron secret — all
  // detection/verification math lives in Next.js (spec Decision 3). If
  // someone inlines threshold logic here, or flag-gates the trigger in Deno
  // (which would freeze mid-flight interventions when the kill switch flips),
  // these assertions turn red.
  const fnIdx = SRC.indexOf('async function triggerAdaptiveRemediation');
  assert(fnIdx > 0, 'expected triggerAdaptiveRemediation to remain defined');
  const body = SRC.slice(fnIdx, SRC.indexOf('\n}', fnIdx) + 2);
  // Thin fetch-out to the worker route, authenticated with the cron secret.
  assertStringIncludes(body, '/api/cron/adaptive-remediation');
  assertStringIncludes(body, "'x-cron-secret'");
  // NOT flag-gated in Deno: the worker owns both gates (inject=flag,
  // verify=active-rows). A feature_flags read inside this step is the
  // freeze-regression this pin guards against.
  assert(
    !body.includes('ff_adaptive_remediation_v1') && !body.includes("from('feature_flags')"),
    'triggerAdaptiveRemediation must stay ungated in Deno — the worker route gates inject (flag) and verify (active rows) so the kill switch drains, not freezes',
  );
  // No threshold logic in Deno (guardrail 6): the Deno side must never
  // reference the loop constants or pulse thresholds.
  assert(
    !body.includes('PULSE_THRESHOLDS') && !body.includes('ADAPTIVE_REMEDIATION_RULES'),
    'no cliff/recovery threshold logic may live in the Deno trigger',
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
