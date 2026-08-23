/**
 * Production release gating — database-before-code (Wave 1, 2026-08-09).
 *
 * WHAT THIS PINS AND WHY
 * ----------------------
 * `.github/workflows/deploy-production.yml` had a structural hole that let the
 * migration lane sit broken from 2026-08-08 while every production deploy
 * reported green:
 *
 *   1. `production-release-completion-gate` asserted seven values about
 *      health-check / post-deploy-verify / release and NOTHING about the
 *      `migrations` job. GitHub reports a SKIPPED job as `skipped` and a
 *      cancelled one as `cancelled`; to a downstream job both read as "not a
 *      failure". A migration lane that never ran could therefore coexist with a
 *      green terminal gate.
 *   2. The `migrations` job skipped `supabase db push` ENTIRELY whenever a push
 *      carried no SQL, printed "skipped", and exited 0. A frontend-only release
 *      thus shipped application code against a database whose state nobody had
 *      verified — and out-of-band remote-ledger drift (the versions
 *      20260808085345 / 20260808085349 / 20260808085419) stayed invisible until
 *      the next migration-bearing deploy tripped over it.
 *   3. The release record named only the app SHA, so no artifact could later
 *      answer "was the schema ahead of, behind, or level with this code?".
 *
 * The fix: both `migrations` paths end in the same read-only migration-history
 * parity check that can FAIL; the terminal gate asserts the migration lane
 * directly; the release record is bound to the migration set.
 *
 * SCOPE NOTE — what this file does NOT claim. The Vercel web deploy is still not
 * interlocked with the migration lane: `vars.USE_CLI_DEPLOY` is `false`, so the
 * Actions `deploy` job (which IS ordered after `migrations`) is skipped and
 * Vercel's GitHub App deploys production independently. Closing that requires a
 * change OUTSIDE the repo — see `docs/runbooks/production-release-gating.md`.
 * These assertions pin the in-repo half only.
 *
 * Static file/YAML assertions only. NO network, NO Supabase, NO subprocess.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';

/**
 * Vitest may run with cwd at the repo root or at `apps/host/`; `.github/` lives
 * at the repo ROOT in either case. Same helper shape as the sibling migration
 * pins under `src/__tests__/migrations/`.
 */
function resolveRepo(rel: string): string | null {
  for (const c of [
    path.resolve(process.cwd(), rel),
    path.resolve(process.cwd(), '..', rel),
    path.resolve(process.cwd(), '..', '..', rel),
  ]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function readFile(rel: string): string {
  const resolved = resolveRepo(rel);
  if (!resolved) return '';
  return fs.readFileSync(resolved, 'utf-8');
}

const WORKFLOW_REL = '.github/workflows/deploy-production.yml';
const RUNBOOK_REL = 'docs/runbooks/production-release-gating.md';

const GATE_JOB = 'production-release-completion-gate';
const MIGRATIONS_JOB = 'migrations';

const workflowSource = readFile(WORKFLOW_REL);

interface WorkflowStep {
  id?: string;
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface WorkflowJob {
  needs?: string | string[];
  if?: string;
  outputs?: Record<string, string>;
  steps?: WorkflowStep[];
}

const workflow = workflowSource
  ? (parseYaml(workflowSource) as { jobs: Record<string, WorkflowJob> })
  : { jobs: {} };

function job(name: string): WorkflowJob {
  const j = workflow.jobs?.[name];
  if (!j) throw new Error(`job '${name}' not found in ${WORKFLOW_REL}`);
  return j;
}

function needsOf(name: string): string[] {
  const n = job(name).needs;
  if (!n) return [];
  return Array.isArray(n) ? n : [n];
}

function stepsOf(name: string): WorkflowStep[] {
  return job(name).steps ?? [];
}

/** Number of non-overlapping matches of `re` in `s`. */
function count(s: string, re: RegExp): number {
  return (s.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)) ?? [])
    .length;
}

/**
 * The gate reads job results/outputs through step-level `env` bindings, then
 * compares the shell variables. Resolve the binding by VALUE so a rename of the
 * variable cannot make an assertion vacuous — but a deletion of the binding, or
 * of the comparison, still fails.
 */
function envVarBoundTo(step: WorkflowStep, expressionFragment: RegExp): string | undefined {
  const entries = Object.entries(step.env ?? {});
  return entries.find(([, v]) => expressionFragment.test(String(v)))?.[0];
}

const gateStep = (): WorkflowStep => {
  const s = stepsOf(GATE_JOB).find((x) => typeof x.run === 'string' && x.run.includes('require_equal'));
  if (!s) throw new Error(`no require_equal step found in job '${GATE_JOB}'`);
  return s;
};

describe('production release gating: workflow is readable', () => {
  it('locates and parses .github/workflows/deploy-production.yml', () => {
    expect(resolveRepo(WORKFLOW_REL)).not.toBeNull();
    // Non-vacuity: a truncated/empty read would make every text assertion below
    // pass or fail for the wrong reason.
    expect(workflowSource.length).toBeGreaterThan(10_000);
    expect(Object.keys(workflow.jobs ?? {}).length).toBeGreaterThan(5);
  });

  it('the jobs this file pins all exist', () => {
    for (const name of [GATE_JOB, MIGRATIONS_JOB, 'release', 'deploy-functions', 'deploy']) {
      expect(Object.keys(workflow.jobs)).toContain(name);
    }
  });
});

// ── 1. The completion gate depends on the migration lane ────────────────────
describe('1. completion gate needs the migration lane', () => {
  it("`needs` includes `migrations`", () => {
    expect(needsOf(GATE_JOB)).toContain(MIGRATIONS_JOB);
  });

  it("`needs` also includes `deploy-functions`", () => {
    expect(needsOf(GATE_JOB)).toContain('deploy-functions');
  });

  it('the gate itself still runs unconditionally (always()), so it cannot be skipped away', () => {
    expect(String(job(GATE_JOB).if ?? '')).toMatch(/always\(\)/);
  });
});

// ── 2. A skipped/cancelled migration lane cannot pass ───────────────────────
describe('2. gate asserts needs.migrations.result == success', () => {
  it('binds needs.migrations.result into the gate step env', () => {
    expect(envVarBoundTo(gateStep(), /needs\.migrations\.result/)).toBeTruthy();
  });

  it('compares that binding against the LITERAL string "success"', () => {
    const step = gateStep();
    const v = envVarBoundTo(step, /needs\.migrations\.result/);
    expect(v).toBeTruthy();
    // require_equal is a string comparison. Asserting the literal 'success' is
    // exactly what makes 'skipped' and 'cancelled' fail here — anything looser
    // (e.g. != 'failure') would let a lane that never ran pass as green.
    const re = new RegExp(`require_equal\\s+"[^"]*"\\s+"\\$${v}"\\s+"success"`);
    expect(step.run ?? '').toMatch(re);
  });

  it('reuses the file\'s single existing require_equal helper (no second helper invented)', () => {
    const run = gateStep().run ?? '';
    expect(count(run, /require_equal\(\)\s*\{/)).toBe(1);
  });

  it('the helper still records failure and the step still exits non-zero', () => {
    const run = gateStep().run ?? '';
    expect(run).toMatch(/FAILED=1/);
    expect(run).toMatch(/if \[ "\$FAILED" -ne 0 \]; then[\s\S]*exit 1/);
  });

  it('also asserts the Edge Function deploy lane terminally', () => {
    const step = gateStep();
    const v = envVarBoundTo(step, /needs\.deploy-functions\.result/);
    expect(v).toBeTruthy();
    expect(step.run ?? '').toMatch(
      new RegExp(`require_equal\\s+"[^"]*"\\s+"\\$${v}"\\s+"success"`),
    );
  });
});

// ── 3. changed == 'false' still verifies database state, and can FAIL ───────
//
// P0-6 (2026-08-20) moved the parity comparison logic that this describe block
// pins OUT of the workflow step's inline `run:` and into a standalone,
// independently-testable script (`.github/scripts/verify-migration-ledger.sh`,
// called as `if bash .../verify-migration-ledger.sh; then … else … fi`). It
// also added a second unconditional post-parity step ("Assert live-database
// security invariants", delegating to `assert-db-security-invariants.sh`)
// that asserts OBSERVABLE EFFECT on the live DB, not ledger metadata.
//
// These assertions were rewritten (not just re-pointed) against the NEW
// architecture: each of the six guarantees the old inline-awk test pinned was
// re-verified by reading `verify-migration-ledger.sh`'s actual source, then
// asserted against THAT file where the logic now lives, rather than
// re-asserting stale literal strings from the step's `run:` block. See
// PARITY_SCRIPT_REL below — every guarantee still holds; none was weakened or
// dropped. (One guarantee changed MECHANISM, not strength: the old check read
// the rendered `supabase migration list --linked` CLI table, which the
// script's own header documents as the exact tautology bug being replaced —
// the new check SELECTs `supabase_migrations.schema_migrations` directly via
// psql, which is strictly more trustworthy since it reads the ledger table
// itself instead of parsing CLI-rendered output.)
describe("3. the no-SQL path runs a parity check that can fail (not a bare 'skipped' echo)", () => {
  const steps = () => stepsOf(MIGRATIONS_JOB);
  const parityStep = () => {
    const s = steps().find((x) => x.id === 'parity');
    if (!s) throw new Error("no step with id 'parity' in the migrations job");
    return s;
  };
  const securityStep = () => {
    const s = steps().find((x) => x.name === 'Assert live-database security invariants');
    if (!s) throw new Error("no step named 'Assert live-database security invariants' in the migrations job");
    return s;
  };

  const PARITY_SCRIPT_REL = '.github/scripts/verify-migration-ledger.sh';
  const parityScript = readFile(PARITY_SCRIPT_REL);

  // Match the COMMAND at the start of a line, not the words "db push" —
  // several steps mention the phrase in prose/summary text.
  const PUSH_CMD = /^\s*supabase db push\b/m;

  it('the parity delegate script is readable and non-trivial', () => {
    // Non-vacuity guard for every assertion below that reads parityScript
    // instead of the (now much thinner) workflow step body.
    expect(resolveRepo(PARITY_SCRIPT_REL)).not.toBeNull();
    expect(parityScript.length).toBeGreaterThan(1_000);
  });

  it('the db push step is still gated on changed == true', () => {
    const push = steps().find((s) => PUSH_CMD.test(s.run ?? ''));
    expect(push).toBeTruthy();
    expect(String(push?.if ?? '')).toMatch(/steps\.migration-diff\.outputs\.changed\s*==\s*'true'/);
  });

  it('the parity check AND the live-DB security-invariant check are both unconditional and are the LAST steps of the job — CI cannot silently no-op either database gate', () => {
    // This is the structural statement that closes the hole: with no `if` on
    // EITHER of the tail steps, both run on the changed=='false' path too, so
    // a frontend-only push can no longer terminate the job's DB interaction on
    // a "skipped" echo. We assert every step from 'parity' onward (not just
    // whichever happens to be literally last) is unconditional — pinning only
    // the final index would miss a regression that re-adds an `if:` to
    // 'parity' while leaving a later step unconditional, which would silently
    // reopen exactly the hole this file exists to keep closed.
    const all = steps();
    const parityIdx = all.findIndex((s) => s.id === 'parity');
    expect(parityIdx).toBeGreaterThan(-1);
    const tail = all.slice(parityIdx);
    // parity + at least the security-invariant step.
    expect(tail.length).toBeGreaterThanOrEqual(2);
    for (const step of tail) {
      expect(step.if, `step "${step.name ?? step.id}" must be unconditional`).toBeUndefined();
    }
    // The job's actual last step is specifically the live-DB security assertion.
    const last = all[all.length - 1];
    expect(last.name).toBe('Assert live-database security invariants');
    expect(last.run ?? '').toMatch(/assert-db-security-invariants\.sh/);
    // ...and both run AFTER the push, so a green push must leave both gates holding.
    const pushIdx = all.findIndex((s) => PUSH_CMD.test(s.run ?? ''));
    expect(pushIdx).toBeGreaterThan(-1);
    expect(parityIdx).toBeGreaterThan(pushIdx);
  });

  it('the security-invariant step runs strictly after the parity step (drift is caught before behavioural assertion)', () => {
    const all = steps();
    const parityIdx = all.findIndex((s) => s.id === 'parity');
    const securityIdx = all.findIndex((s) => s.name === 'Assert live-database security invariants');
    expect(parityIdx).toBeGreaterThan(-1);
    expect(securityIdx).toBeGreaterThan(parityIdx);
  });

  it('the parity step delegates to a script that performs a genuine SQL ledger read, not CLI-table parsing', () => {
    const run = parityStep().run ?? '';
    expect(run).toMatch(/supabase link --project-ref/);
    expect(run).toMatch(/if bash .*verify-migration-ledger\.sh; then/);
    // Guard against regressing to the exact tautology this replaced: the step
    // body itself must not re-implement `supabase migration list` parsing.
    expect(run).not.toMatch(/supabase migration list/);
    // The delegate script reads the ledger table directly.
    expect(parityScript).toMatch(/SELECT version FROM supabase_migrations\.schema_migrations/);
    expect(parityScript).toMatch(/psql/);
  });

  it('the delegate script scopes the committed set to top-level supabase/migrations (excludes _legacy/)', () => {
    expect(parityScript).toMatch(/find "?\$MIGRATIONS_DIR"? -maxdepth 1/);
    expect(parityScript).toMatch(/\[0-9\]\{14\}/);
  });

  it('the delegate script compares BOTH directions and names each failure mode', () => {
    // committed-but-not-remote and remote-but-not-committed.
    expect(parityScript).toMatch(/comm -23/);
    expect(parityScript).toMatch(/comm -13/);
    expect(parityScript).toMatch(/COMMITTED_NOT_REMOTE/);
    expect(parityScript).toMatch(/REMOTE_NOT_COMMITTED/);
  });

  it('has a real, reachable failure path — the step reports drift and exits non-zero, and the delegate script itself has multiple independent failure call-sites', () => {
    const run = parityStep().run ?? '';
    expect(run).toMatch(/migration_parity=drift/);
    expect(run).toMatch(/exit 1/);
    // The step's control flow must genuinely depend on the script's exit code
    // (an `if cmd; then … else … fi` is not short-circuited by `set -e`, so
    // this is what makes the drift branch reachable at all).
    expect(run).toMatch(/if bash .*verify-migration-ledger\.sh; then/);
    // The old inline-awk step had no shared helper, so its non-vacuity story
    // was "count literal `exit 1`". The new script centralizes every failure
    // through a single `fail()` helper (the same DRY pattern the gate step's
    // `require_equal` helper already uses, per describe block 2 above) — so
    // the equivalent guarantee is "the helper itself exits 1" (checked once)
    // PLUS "there are multiple distinct, reachable call-sites" (checked by
    // counting `fail` invocations, not `exit 1` occurrences).
    expect(parityScript).toMatch(/^fail\(\)\s*\{[\s\S]*?\bexit 1\b/m);
    expect(count(parityScript, /\bfail\(\)\s*\{/)).toBe(1);
    // Distinct, reachable failure call-sites: drift, unreadable ledger, empty
    // local scan, empty remote parse, missing required env, wrong linked ref.
    expect(count(parityScript, /\bfail\s+"/)).toBeGreaterThanOrEqual(4);
    // The drift branch itself must be the one that fails the script.
    const driftBranch = parityScript.slice(parityScript.indexOf('if [ -n "$COMMITTED_NOT_REMOTE" ]'));
    expect(driftBranch.length).toBeGreaterThan(0);
    expect(driftBranch).toMatch(/fail "Migration history parity FAILED/);
  });

  it('cannot pass vacuously on an empty scan or an unparseable ledger', () => {
    expect(parityScript).toMatch(/LOCAL_COUNT" -gt 0/);
    expect(parityScript).toMatch(/REMOTE_COUNT" -gt 0/);
  });

  it('surfaces the offending versions with a remediation pointer', () => {
    expect(parityScript).toMatch(/GITHUB_STEP_SUMMARY/);
    expect(parityScript).toMatch(/20260808085345/);
    expect(parityScript).toMatch(/migration repair --status reverted/);
    expect(parityScript).toMatch(/production-release-gating\.md/);
  });

  it('the detect step no longer advertises the old unconditional skip', () => {
    const detect = steps().find((s) => s.id === 'migration-diff');
    expect(detect).toBeTruthy();
    // The old wording was "None in this push; skipped db push" with nothing
    // following it. Whatever the wording, the no-SQL branch must point at the
    // parity check rather than terminate the job's DB interaction.
    expect(detect?.run ?? '').toMatch(/parity/i);
  });

  it('the live-DB security-invariant step fails closed and cannot pass vacuously if a listed RPC vanished', () => {
    // Companion guarantee added by P0-6 alongside the parity check: this is
    // the OTHER unconditional tail step, and it has its own non-vacuity story
    // (a removed/renamed RPC must fail loudly, not silently assert nothing).
    const run = securityStep().run ?? '';
    expect(run).toMatch(/assert-db-security-invariants\.sh/);
    const securityScriptRel = '.github/scripts/assert-db-security-invariants.sh';
    const securityScript = readFile(securityScriptRel);
    expect(securityScript.length).toBeGreaterThan(1_000);
    expect(securityScript).toMatch(/has_function_privilege\('anon'/);
    expect(securityScript).toMatch(/FAIL-CLOSED/);
  });
});

// ── 4. migration_parity output exists and is asserted ───────────────────────
describe('4. migration_parity job output exists and the gate asserts it', () => {
  it('the migrations job exposes migration_parity from the parity step', () => {
    const outputs = job(MIGRATIONS_JOB).outputs ?? {};
    expect(Object.keys(outputs)).toContain('migration_parity');
    expect(outputs.migration_parity).toMatch(/steps\.parity\.outputs\.migration_parity/);
  });

  it('the parity step writes verified on the clean path and drift otherwise', () => {
    const run = stepsOf(MIGRATIONS_JOB).find((s) => s.id === 'parity')?.run ?? '';
    expect(run).toMatch(/migration_parity=verified/);
    expect(run).toMatch(/migration_parity=drift/);
  });

  it('the gate requires migration_parity == "verified"', () => {
    const step = gateStep();
    const v = envVarBoundTo(step, /needs\.migrations\.outputs\.migration_parity/);
    expect(v).toBeTruthy();
    expect(step.run ?? '').toMatch(
      new RegExp(`require_equal\\s+"[^"]*"\\s+"\\$${v}"\\s+"verified"`),
    );
  });

  it('the gate requires the parity to have been proved against production', () => {
    const step = gateStep();
    const v = envVarBoundTo(step, /needs\.migrations\.outputs\.migration_target_environment/);
    expect(v).toBeTruthy();
    expect(step.run ?? '').toMatch(
      new RegExp(`require_equal\\s+"[^"]*"\\s+"\\$${v}"\\s+"production"`),
    );
  });
});

// ── 5. Release record is bound to the migration set ─────────────────────────
describe('5. the release record binds app commit to the migration set', () => {
  it('the release job needs `migrations` so it can read those outputs', () => {
    expect(needsOf('release')).toContain(MIGRATIONS_JOB);
  });

  it('the GitHub release body carries commit + versions + parity + environment', () => {
    const tagStep = stepsOf('release').find((s) => /github-script/.test(s.uses ?? ''));
    expect(tagStep).toBeTruthy();
    const script = String((tagStep?.with as Record<string, unknown> | undefined)?.script ?? '');
    expect(script).toMatch(/needs\.migrations\.outputs\.production_migrations_changed/);
    expect(script).toMatch(/needs\.migrations\.outputs\.production_migration_versions/);
    expect(script).toMatch(/needs\.migrations\.outputs\.migration_parity/);
    expect(script).toMatch(/needs\.migrations\.outputs\.migration_target_environment/);
    expect(script).toMatch(/\*\*App commit:\*\*/);
    // Both release bodies (existing-tag and new-tag branches) must include it —
    // binding only one of them would leave half the releases unlabelled.
    expect(count(script, /\.\.\.migrationNotes/)).toBe(2);
  });

  it('the deployment step summary carries the same binding', () => {
    const summary = stepsOf('release').find((s) => /GITHUB_STEP_SUMMARY/.test(s.run ?? ''));
    expect(summary).toBeTruthy();
    const run = summary?.run ?? '';
    expect(run).toMatch(/Migration versions applied/);
    expect(run).toMatch(/Migration history parity/);
    expect(run).toMatch(/Target environment/);
    expect(run).toMatch(/App commit/);
  });

  it('the versions output is derived from the committed migration filenames', () => {
    const detect = stepsOf(MIGRATIONS_JOB).find((s) => s.id === 'migration-diff');
    const run = detect?.run ?? '';
    expect(run).toMatch(/versions=/);
    // Top-level only: the `[^/]*` guard is what keeps `_legacy/…` out.
    expect(run).toMatch(/supabase\/migrations\/\(\[0-9\]\{14\}\)_\[\^\/\]\*\\\.sql/);
    expect(job(MIGRATIONS_JOB).outputs?.production_migration_versions).toMatch(
      /steps\.migration-diff\.outputs\.versions/,
    );
  });
});

// ── 6. NON-VACUITY: the pre-existing 7 gate assertions survive ──────────────
describe('6. non-vacuity: the seven pre-existing completion-gate assertions are intact', () => {
  // Verbatim, in order. If someone replaces the gate wholesale (or "simplifies"
  // it while adding the migration assertions), this notices — the new database
  // assertions must be ADDITIVE, never a rewrite that drops endpoint/release
  // evidence.
  const PRE_EXISTING = [
    'require_equal "Health check result" "$HEALTH_CHECK_RESULT" "success"',
    'require_equal "Health exact-SHA proof" "$HEALTH_EXACT_SHA_VERIFIED" "true"',
    'require_equal "Health verified SHA" "$HEALTH_VERIFIED_GITHUB_SHA" "$EXPECTED_SHA"',
    'require_equal "Post-deploy verification result" "$POST_DEPLOY_VERIFY_RESULT" "success"',
    'require_equal "Post-deploy exact-SHA proof" "$POST_EXACT_SHA_VERIFIED" "true"',
    'require_equal "Post-deploy verified SHA" "$POST_VERIFIED_GITHUB_SHA" "$EXPECTED_SHA"',
    'require_equal "Release result" "$RELEASE_RESULT" "success"',
  ];

  it.each(PRE_EXISTING)('still present: %s', (line) => {
    expect(gateStep().run ?? '').toContain(line);
  });

  it('they appear in their original relative order', () => {
    const run = gateStep().run ?? '';
    const positions = PRE_EXISTING.map((l) => run.indexOf(l));
    expect(positions.every((p) => p > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('the gate now carries strictly MORE assertions than before (7 + database lane)', () => {
    const run = gateStep().run ?? '';
    // 7 pre-existing + migrations.result + migration_parity + target env +
    // deploy-functions.result = 11.
    expect(count(run, /^\s*require_equal\s+"/m)).toBeGreaterThanOrEqual(11);
  });

  it('the three original needs are still present alongside the new ones', () => {
    const needs = needsOf(GATE_JOB);
    for (const n of ['health-check', 'post-deploy-verify', 'release']) {
      expect(needs).toContain(n);
    }
  });
});

// ── 7. The documented, still-open Vercel gap ────────────────────────────────
describe('7. the owner-side Vercel gap is documented, not silently assumed fixed', () => {
  const runbook = readFile(RUNBOOK_REL);

  it('the runbook exists', () => {
    expect(runbook.length).toBeGreaterThan(1_000);
  });

  it('names both settings that must change together', () => {
    expect(runbook).toMatch(/USE_CLI_DEPLOY/);
    expect(runbook).toMatch(/auto-deploy/i);
  });

  it('is explicitly marked as NOT APPLIED / requires owner action', () => {
    expect(runbook).toMatch(/NOT APPLIED/);
    expect(runbook).toMatch(/requires owner action/i);
  });

  it('states the double-deploy hazard and the ordering constraint', () => {
    expect(runbook).toMatch(/DOUBLE production deploys/i);
    expect(runbook).toMatch(/order/i);
  });

  it('the Actions-side deploy job is still gated on the repo variable (the gap is real)', () => {
    // If this ever stops matching, the gap description in the runbook is stale
    // and the runbook must be re-verified before anyone trusts it.
    expect(String(job('deploy').if ?? '')).toMatch(/vars\.USE_CLI_DEPLOY\s*==\s*'true'/);
    expect(needsOf('deploy')).toContain(MIGRATIONS_JOB);
  });
});
