/**
 * L5 Evaluator — tenant_isolation
 *
 * Implements the canonical `tenant_isolation` evaluator referenced by:
 *   - /agents/contracts/evaluation.schema.json
 *   - /governance/rubric.md  (R3.* — Tenant isolation)
 *   - /agents/prompts/l6-critic.md  (Always-Escalate list)
 *
 * The heavy lifting lives in scripts/audit-tenant-isolation.ts (a mature
 * static heuristic over src/app/api/**\/route.ts). This file wraps it and
 * turns the audit output into an EvaluationVerdict that:
 *
 *   (a) fails CI on REGRESSIONS — a route that moved to a worse bucket than
 *       the committed baseline (eval/tenant-isolation/baseline.json), OR a
 *       brand-new route that lands in NO_AUTH / NO_TENANT_SCOPING; and
 *   (b) optionally writes the verdict to public.cycle_evaluations when run
 *       under the agent mesh (with --task-id / --cycle-id).
 *
 * Why a baseline:
 *   The underlying audit reports findings against the entire API surface.
 *   On a fresh run there will already be REVIEW/NO_AUTH rows for legacy
 *   endpoints. Failing CI on those would block every PR. The baseline file
 *   captures "what is known and accepted today"; only deltas worse than the
 *   baseline are treated as failures by this evaluator.
 *
 * Severity ordering (strict — a regression is any move up this list):
 *
 *   SAFE  <  REVIEW  <  NO_TENANT_SCOPING  <  NO_AUTH
 *
 * Exit codes:
 *   0  pass / warn
 *   1  fail (regression detected; tenant_isolation is always blocking per R3.4)
 *   2  internal error
 *
 * Usage:
 *   # CI mode (no mesh write):
 *   npx tsx eval/tenant-isolation/run.ts
 *
 *   # Mesh mode (writes a row to public.cycle_evaluations):
 *   npx tsx eval/tenant-isolation/run.ts \
 *     --task-id  <uuid> \
 *     --cycle-id <uuid>
 *   # Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.
 *
 *   # Regenerate the committed baseline (review the diff before committing):
 *   npx tsx eval/tenant-isolation/run.ts --regenerate-baseline
 *
 *   # Machine-readable verdict to stdout:
 *   npx tsx eval/tenant-isolation/run.ts --json
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { audit, type Bucket, type RouteFinding } from '../../scripts/audit-tenant-isolation';

// ─── Types matching agents/contracts/evaluation.schema.json ────────────

type Verdict = 'pass' | 'fail' | 'warn' | 'skipped';

interface EvaluationVerdict {
  task_id: string | null;
  cycle_id: string | null;
  evaluator: 'tenant_isolation';
  verdict: Verdict;
  blocking: true;                 // tenant_isolation is always blocking (R3.4)
  evidence_url: string | null;
  evidence: {
    baseline_path: string;
    total_routes: number;
    baseline_route_count: number;
    regressions: Regression[];
    new_safe_routes: string[];
  };
  notes: string;
  evaluated_at: string;
}

interface BaselineEntry {
  routePath: string;
  bucket: Bucket;
}

interface Regression {
  routePath: string;
  baseline_bucket: Bucket | 'ABSENT';
  current_bucket: Bucket;
  reason: string;
}

// ─── Severity helper ──────────────────────────────────────────────────

const SEVERITY: Record<Bucket, number> = {
  SAFE: 0,
  REVIEW: 1,
  NO_TENANT_SCOPING: 2,
  NO_AUTH: 3,
};

function isRegression(baseline: Bucket | undefined, current: Bucket): boolean {
  // New route landing as anything worse than SAFE = regression.
  if (baseline === undefined) return SEVERITY[current] > SEVERITY.SAFE;
  // Existing route moving to a strictly worse bucket = regression.
  return SEVERITY[current] > SEVERITY[baseline];
}

// ─── Baseline I/O ─────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(REPO_ROOT, 'eval', 'tenant-isolation', 'baseline.json');

async function readBaseline(): Promise<Map<string, Bucket>> {
  try {
    const raw = await fs.readFile(BASELINE_PATH, 'utf8');
    const entries: BaselineEntry[] = JSON.parse(raw);
    const map = new Map<string, Bucket>();
    for (const e of entries) map.set(e.routePath, e.bucket);
    return map;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Treat absent baseline as empty. Every non-SAFE finding will look
      // like a new regression — that's intentional, forces the team to
      // regenerate the baseline as the first step.
      return new Map();
    }
    throw err;
  }
}

async function writeBaseline(findings: RouteFinding[]): Promise<void> {
  const entries: BaselineEntry[] = findings
    .map(f => ({ routePath: f.routePath, bucket: f.bucket }))
    .sort((a, b) => a.routePath.localeCompare(b.routePath));
  const json = JSON.stringify(entries, null, 2) + '\n';
  await fs.mkdir(path.dirname(BASELINE_PATH), { recursive: true });
  await fs.writeFile(BASELINE_PATH, json, 'utf8');
}

// ─── Verdict computation ──────────────────────────────────────────────

export function computeVerdict(
  current: RouteFinding[],
  baseline: Map<string, Bucket>,
  taskId: string | null,
  cycleId: string | null,
): EvaluationVerdict {
  const regressions: Regression[] = [];
  const currentByPath = new Map<string, Bucket>();

  for (const f of current) {
    currentByPath.set(f.routePath, f.bucket);
    const baseBucket = baseline.get(f.routePath);
    if (isRegression(baseBucket, f.bucket)) {
      regressions.push({
        routePath: f.routePath,
        baseline_bucket: baseBucket ?? 'ABSENT',
        current_bucket: f.bucket,
        reason:
          baseBucket === undefined
            ? `New route landed in ${f.bucket} (must be SAFE on introduction).`
            : `Severity increased from ${baseBucket} to ${f.bucket}.`,
      });
    }
  }

  // Surface routes that IMPROVED — good news. Doesn't affect verdict, but
  // makes the next baseline regen obvious.
  const newSafeRoutes: string[] = [];
  for (const [p, b] of baseline.entries()) {
    const now = currentByPath.get(p);
    if (now === 'SAFE' && b !== 'SAFE') newSafeRoutes.push(p);
  }

  const blockingFailures = regressions.filter(
    r => r.current_bucket === 'NO_AUTH' || r.current_bucket === 'NO_TENANT_SCOPING',
  );

  let verdict: Verdict;
  let notes: string;
  if (blockingFailures.length > 0) {
    verdict = 'fail';
    notes =
      `${blockingFailures.length} regression(s) in NO_AUTH or NO_TENANT_SCOPING — blocking per rubric R3.4.\n` +
      blockingFailures
        .map(r => `  - ${r.routePath}: ${r.baseline_bucket} → ${r.current_bucket}`)
        .join('\n');
  } else if (regressions.length > 0) {
    verdict = 'warn';
    notes =
      `${regressions.length} regression(s) into REVIEW — non-blocking but require human read.\n` +
      regressions
        .map(r => `  - ${r.routePath}: ${r.baseline_bucket} → ${r.current_bucket}`)
        .join('\n');
  } else {
    verdict = 'pass';
    notes =
      `No regressions against baseline (${baseline.size} routes tracked). ` +
      `Current audit covers ${current.length} routes.` +
      (newSafeRoutes.length > 0
        ? `\nImprovements (consider regenerating baseline): ${newSafeRoutes.join(', ')}`
        : '');
  }

  return {
    task_id: taskId,
    cycle_id: cycleId,
    evaluator: 'tenant_isolation',
    verdict,
    blocking: true,
    evidence_url: null,
    evidence: {
      baseline_path: path.relative(REPO_ROOT, BASELINE_PATH).replace(/\\/g, '/'),
      total_routes: current.length,
      baseline_route_count: baseline.size,
      regressions,
      new_safe_routes: newSafeRoutes,
    },
    notes,
    evaluated_at: new Date().toISOString(),
  };
}

// ─── Supabase write (mesh mode) ───────────────────────────────────────

async function writeToCycleEvaluations(v: EvaluationVerdict): Promise<void> {
  if (!v.task_id || !v.cycle_id) return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Mesh mode (--task-id / --cycle-id) requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.',
    );
  }
  // Lazy require so CI mode doesn't pay the import cost.
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await sb.from('cycle_evaluations').upsert(
    {
      task_id: v.task_id,
      cycle_id: v.cycle_id,
      evaluator: v.evaluator,
      verdict: v.verdict,
      blocking: v.blocking,
      evidence_url: v.evidence_url,
      evidence: v.evidence,
      notes: v.notes,
      evaluated_at: v.evaluated_at,
    },
    { onConflict: 'task_id,evaluator' },
  );
  if (error) {
    throw new Error(`cycle_evaluations upsert failed: ${error.message}`);
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────

function parseFlag(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const regenerate = hasFlag('--regenerate-baseline');
  const json = hasFlag('--json');
  const taskId = parseFlag('--task-id');
  const cycleId = parseFlag('--cycle-id');

  if ((taskId && !cycleId) || (cycleId && !taskId)) {
    process.stderr.write('--task-id and --cycle-id must be provided together.\n');
    process.exit(2);
  }

  const findings = await audit();

  if (regenerate) {
    await writeBaseline(findings);
    process.stdout.write(
      `tenant_isolation: baseline regenerated with ${findings.length} routes → ` +
        `${path.relative(REPO_ROOT, BASELINE_PATH).replace(/\\/g, '/')}\n` +
        'Review the diff and commit it.\n',
    );
    return;
  }

  const baseline = await readBaseline();
  const verdict = computeVerdict(findings, baseline, taskId, cycleId);

  if (taskId && cycleId) {
    await writeToCycleEvaluations(verdict);
  }

  if (json) {
    process.stdout.write(JSON.stringify(verdict, null, 2) + '\n');
  } else {
    const icon = verdict.verdict === 'pass' ? '✅' : verdict.verdict === 'warn' ? '🟡' : '🔴';
    process.stdout.write(
      `${icon} tenant_isolation: ${verdict.verdict.toUpperCase()}\n` +
        `   ${verdict.notes}\n` +
        `   Baseline: ${verdict.evidence.baseline_path} (${verdict.evidence.baseline_route_count} routes)\n` +
        `   Current scan: ${verdict.evidence.total_routes} routes\n` +
        (taskId
          ? `   Mesh: wrote row to cycle_evaluations for task ${taskId}\n`
          : '   Mesh: no --task-id; verdict not persisted\n'),
    );
  }

  if (verdict.verdict === 'fail') process.exit(1);
}

// Only run the CLI when invoked directly — not when imported by tests.
if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`tenant_isolation evaluator: fatal error: ${err?.message ?? err}\n`);
    process.exit(2);
  });
}
