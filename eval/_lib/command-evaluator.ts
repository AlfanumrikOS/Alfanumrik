/**
 * eval/_lib/command-evaluator.ts — the "command wrapper" L5 evaluator pattern.
 *
 * Many useful evaluators are just "run this command and tell me if it
 * exits zero" — npm test, tsc --noEmit, eslint, bundle-size budgets, etc.
 * This module turns any such command into a contract-shaped
 * EvaluationVerdict so it slots into the agent mesh on equal footing
 * with bespoke evaluators like tenant_isolation.
 *
 * Usage from a thin evaluator script (see eval/unit-tests/run.ts for the
 * canonical example):
 *
 *   import { runCommandEvaluator } from '../_lib/command-evaluator';
 *   runCommandEvaluator({
 *     evaluator: 'unit_tests',
 *     command: 'npm',
 *     args: ['test'],
 *     blocking: true,
 *   });
 *
 * CLI args the wrapper accepts (forwarded from the thin wrapper's process.argv):
 *   --task-id <uuid>   together with --cycle-id, upserts a row into
 *   --cycle-id <uuid>  public.cycle_evaluations.
 *   --json             machine-readable verdict to stdout.
 *
 * Exit codes:
 *   0  pass
 *   1  fail (the wrapped command exited non-zero, OR a contract write failed)
 *   2  internal error in the wrapper itself
 *
 * Why a wrapper instead of N bespoke scripts:
 *   - Consistency. Every evaluator emits the same verdict shape, so the
 *     L6 critic and the cycle_evaluations table never need special-casing.
 *   - Truncation. Test/lint output is enormous; the wrapper takes the
 *     last NOTES_LINES of combined stdout+stderr so the notes field stays
 *     inside the contract's maxLength=4000.
 *   - Mesh integration. Adding cycle_evaluations write is one place, not N.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { loadDotenv } from '../../agents/runtime/env';

// Self-loading .env.local. When evaluators run inside a `mesh:tick` cycle
// the parent process passes env via spawnSync, but on Windows with
// `shell:true` that handoff doesn't always reach the child. Loading
// .env.local here makes the evaluator robust whether invoked from the
// tick, from CI, or from a developer's shell.
loadDotenv(path.resolve(__dirname, '..', '..'));

const NOTES_LINES = 50;
const NOTES_MAX_CHARS = 3800; // a little under the contract's 4000 to leave room for trimming markers

export interface CommandEvaluatorConfig {
  /** Canonical evaluator slug (must match agents/contracts/evaluation.schema.json). */
  evaluator: 'unit_tests' | 'type_check' | 'lint' | 'bundle_size';
  /** Command to run, e.g. 'npm', 'npx'. */
  command: string;
  /** Args after the command, e.g. ['test'], ['run', 'type-check']. */
  args: string[];
  /** Whether a failure here should block the L6 critic from approving. */
  blocking: boolean;
  /**
   * Optional override for repo root resolution. Default is two levels up
   * from this file (eval/_lib/.. → repo root) which matches the layout
   * shipped today.
   */
  cwd?: string;
}

type Verdict = 'pass' | 'fail' | 'warn' | 'skipped';

interface EvaluationVerdict {
  task_id: string | null;
  cycle_id: string | null;
  evaluator: CommandEvaluatorConfig['evaluator'];
  verdict: Verdict;
  blocking: boolean;
  evidence_url: string | null;
  evidence: {
    command: string;
    args: string[];
    exit_code: number | null;
    duration_ms: number;
  };
  notes: string;
  evaluated_at: string;
}

function parseFlag(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

/** Keep the last N lines of `combined`, then cap to NOTES_MAX_CHARS. */
function tailForNotes(combined: string): string {
  const lines = combined.split(/\r?\n/);
  const tail = lines.slice(-NOTES_LINES).join('\n');
  if (tail.length <= NOTES_MAX_CHARS) return tail;
  const trimmed = tail.slice(-NOTES_MAX_CHARS);
  return `… [output truncated to last ${NOTES_MAX_CHARS} chars] …\n${trimmed}`;
}

async function writeToCycleEvaluations(v: EvaluationVerdict): Promise<void> {
  if (!v.task_id || !v.cycle_id) return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      `Mesh mode requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env (evaluator: ${v.evaluator}).`,
    );
  }
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
    throw new Error(`cycle_evaluations upsert failed for ${v.evaluator}: ${error.message}`);
  }
}

/**
 * Pure verdict computation — exported so unit tests can pin down the
 * pass/fail/truncation behaviour without spawning processes.
 */
export function buildVerdict(
  cfg: CommandEvaluatorConfig,
  taskId: string | null,
  cycleId: string | null,
  result: { status: number | null; stdout: string; stderr: string; durationMs: number },
): EvaluationVerdict {
  const exitCode = result.status;
  const combined = `${result.stdout}\n${result.stderr}`.trim();
  const verdict: Verdict = exitCode === 0 ? 'pass' : 'fail';

  let notes: string;
  if (verdict === 'pass') {
    notes =
      `Command \`${cfg.command} ${cfg.args.join(' ')}\` exited 0 in ${result.durationMs}ms.\n` +
      (combined ? tailForNotes(combined) : '(no output)');
  } else {
    notes =
      `Command \`${cfg.command} ${cfg.args.join(' ')}\` FAILED with exit code ${exitCode ?? '(killed)'} after ${result.durationMs}ms.\n` +
      'Tail of combined stdout+stderr:\n' +
      (combined ? tailForNotes(combined) : '(no output)');
  }

  return {
    task_id: taskId,
    cycle_id: cycleId,
    evaluator: cfg.evaluator,
    verdict,
    blocking: cfg.blocking,
    evidence_url: null,
    evidence: {
      command: cfg.command,
      args: cfg.args,
      exit_code: exitCode,
      duration_ms: result.durationMs,
    },
    notes,
    evaluated_at: new Date().toISOString(),
  };
}

export async function runCommandEvaluator(cfg: CommandEvaluatorConfig): Promise<void> {
  const json = hasFlag('--json');
  const taskId = parseFlag('--task-id');
  const cycleId = parseFlag('--cycle-id');

  if ((taskId && !cycleId) || (cycleId && !taskId)) {
    process.stderr.write('--task-id and --cycle-id must be provided together.\n');
    process.exit(2);
  }

  const repoRoot = cfg.cwd ?? path.resolve(__dirname, '..', '..');
  const t0 = Date.now();
  const res = spawnSync(cfg.command, cfg.args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32',
    // Capture but don't inherit — we control output via --json or pretty path.
  });
  const durationMs = Date.now() - t0;

  const verdict = buildVerdict(cfg, taskId, cycleId, {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    durationMs,
  });

  if (taskId && cycleId) {
    try {
      await writeToCycleEvaluations(verdict);
    } catch (err: unknown) {
      process.stderr.write(`${cfg.evaluator}: ${(err as Error).message}\n`);
      process.exit(1);
    }
  }

  if (json) {
    process.stdout.write(JSON.stringify(verdict, null, 2) + '\n');
  } else {
    const icon = verdict.verdict === 'pass' ? '✅' : '🔴';
    process.stdout.write(
      `${icon} ${cfg.evaluator}: ${verdict.verdict.toUpperCase()} ` +
        `(exit=${verdict.evidence.exit_code}, ${verdict.evidence.duration_ms}ms)\n`,
    );
    if (verdict.verdict !== 'pass') {
      process.stdout.write(verdict.notes + '\n');
    }
  }

  if (verdict.verdict === 'fail') process.exit(1);
}
