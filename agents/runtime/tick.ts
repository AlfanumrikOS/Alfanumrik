/**
 * agents/runtime/tick.ts — Phase β skeleton of the mesh runtime.
 *
 * Runs ONE end-to-end cycle through all eight layers. Most layers are
 * stubs — they exercise the contracts and substrate without calling any
 * LLM. Each stub is sized for one drop-in replacement: when the real
 * worker for a layer ships, the corresponding `*_stub` function gets
 * replaced and the rest of this file stays the same.
 *
 * What this proves today (with stubs in place):
 *   1. The substrate migration is applied and the tables accept writes
 *      that conform to the contracts.
 *   2. The L4→L5 hand-off works: a CompletedTask in tasks.outputs is
 *      followed by an evaluator run that writes to cycle_evaluations
 *      via the unique (task_id, evaluator) constraint.
 *   3. The L6 critic can read the full evaluator set for a task and
 *      apply the rubric's decision tree.
 *   4. The whole thing is gated by ff_agent_mesh_v1 AND requires a
 *      `--commit` flag to write to the DB — dry-run is the default.
 *
 * What this does NOT do:
 *   - L1 stub picks a hardcoded test goal, not a real one from the
 *     Cycle Goal Inbox.
 *   - L2 stub produces exactly one task with a fixed allowed/forbidden
 *     path set, not a real DAG.
 *   - L4 stub does NOT modify any code or open a PR. It "completes"
 *     instantly with an empty diff. This proves the contract plumbing,
 *     not the execution.
 *   - L5 only dispatches the one evaluator that ships today
 *     (`tenant_isolation`). Other evaluators are noted as `skipped`.
 *   - L6 stub applies the literal decision tree from l6-critic.md but
 *     does not actually call an LLM — its reasoning is templated. The
 *     real critic worker will replace this.
 *
 * Usage:
 *   # Dry run — prints what would happen, no DB writes:
 *   npm run mesh:tick
 *
 *   # Real run against the configured Supabase project (requires the
 *   # migration applied and ff_agent_mesh_v1=true):
 *   npm run mesh:tick -- --commit
 *
 *   # Override the synthetic goal:
 *   npm run mesh:tick -- --commit --goal "Improve teacher widget render time"
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { loadDotenv } from './env';
import { getMeshSupabase, assertMeshFlagEnabled } from './supabase';
import { openWorktree, closeWorktree, commitAll, diffAgainstBaseline, type WorktreeHandle } from './worktree';
import { runCodeAgent } from './layers/l4-code-agent';
import { runCritic } from './layers/l6-critic';
import { pickNextGoal, resolveInboxRow, type PickedGoal } from './layers/l1-meta';
import { runOrchestrator, type L2TaskAssignment } from './layers/l2-orchestrator';
import { runDeploy } from './layers/l7-deploy';

// ─── Types (mirror the JSON Schema contracts) ──────────────────────────

type Verdict = 'pass' | 'fail' | 'warn' | 'skipped';
type CriticDecision = 'approve' | 'request_changes' | 'reject' | 'escalate_to_human';

interface CycleGoal {
  goal: string;
  goal_rationale: string;
  signal_source: 'ceo' | 'feedback' | 'evolution' | 'incident' | 'ad-hoc';
  risk_tier: number;
  budget_tokens: number;
  target_metric: string;
  target_delta: number;
  tenant_scope: 'house' | 'pilot' | 'all';
  non_goals: string[];
  constraints: string[];
  deadline?: string;
}

interface TaskAssignment {
  task_id: string;
  cycle_id: string;
  agent_role: string;
  title: string;
  objective: string;
  definition_of_done: string[];
  allowed_paths: string[];
  forbidden_paths: string[];
  context_scopes: string[];
  model_hint: 'opus' | 'sonnet' | 'haiku';
  max_tokens: number;
  evaluators_required: string[];
}

interface CompletedTask {
  task_id: string;
  cycle_id: string;
  agent_role: string;
  result: 'succeeded' | 'failed' | 'needs_replan';
  branch: string;
  pr_url: string | null;
  summary: string;
  files_changed: Array<{ path: string; change: string }>;
  constraints_respected: string[];
  lessons_applied: string[];
  open_questions: string[];
  blocker_note: string | null;
  tokens_spent: number;
}

interface CriticVerdict {
  task_id: string;
  cycle_id: string;
  decision: CriticDecision;
  reasoning: string;
  rubric_version: string;
  risk_tier_observed: number;
  rubric_clauses_invoked: string[];
  evaluator_summary: {
    passed: number;
    failed: number;
    warned: number;
    blocking_failures: string[];
  };
  human_reviewer_required: string | null;
  follow_up_lessons: Array<{ claim: string; applies_when: string; confidence: string }>;
  decided_at: string;
}

interface TickOptions {
  commit: boolean;
  realL1: boolean;
  realL2: boolean;
  realL4: boolean;
  realL6: boolean;
  realL7: boolean;
  goal: string | null;
}

// ─── CLI ──────────────────────────────────────────────────────────────

function parseArgs(): TickOptions {
  const argv = process.argv.slice(2);
  const commit = argv.includes('--commit');
  const realL1 = argv.includes('--real-l1');
  const realL2 = argv.includes('--real-l2');
  const realL4 = argv.includes('--real-l4');
  const realL6 = argv.includes('--real-l6');
  const realL7 = argv.includes('--real-l7');
  const goalIdx = argv.indexOf('--goal');
  const goal = goalIdx >= 0 ? argv[goalIdx + 1] ?? null : null;
  if ((realL2 || realL4 || realL6 || realL7) && !commit) {
    process.stderr.write(
      '[mesh:tick] --real-l2/--real-l4/--real-l6/--real-l7 require --commit (no LLM spend / no GitHub side effects in dry-run).\n',
    );
    process.exit(2);
  }
  return { commit, realL1, realL2, realL4, realL6, realL7, goal };
}

const log = (label: string, msg: string) =>
  process.stdout.write(`[mesh:tick] ${label} → ${msg}\n`);

// ─── L1 stub: pick a CycleGoal ─────────────────────────────────────────

function l1_stub_pickGoal(override: string | null): CycleGoal {
  // The real L1 reads the Cycle Goal Inbox, the last 5 cycles, lessons_learned,
  // and the PostHog feedback digest. The stub fabricates a minimal goal so we
  // can prove the rest of the loop.
  const goal =
    override ??
    'Phase β skeleton dry-run: verify the agent mesh substrate accepts a no-op cycle end-to-end.';
  return {
    goal,
    goal_rationale:
      'Stub L1. Selected solely to exercise the contract plumbing and the substrate. ' +
      'NOT a real lever; real L1 will read inbox/feedback/lessons.',
    signal_source: 'ad-hoc',
    risk_tier: 1,
    budget_tokens: 50000,
    target_metric: 'mesh_runtime_dry_run_completion',
    target_delta: 1,
    tenant_scope: 'house',
    non_goals: [
      'Do not modify any application code.',
      'Do not enable feature flags for non-house tenants.',
      'Do not open a real PR.',
    ],
    constraints: ['No schema changes.', 'No learner-facing copy changes.'],
  };
}

// ─── L2 stub: decompose into one TaskAssignment ───────────────────────

function l2_stub_decompose(cycleId: string, goal: CycleGoal): TaskAssignment {
  // The real L2 reads the goal + lessons and produces a DAG. The stub
  // produces exactly one task with the most restrictive allowed/forbidden
  // paths so the critic's R2 (blast-radius) check has something to verify.
  return {
    task_id: '00000000-0000-0000-0000-000000000000', // filled in when we insert
    cycle_id: cycleId,
    agent_role: 'code_agent',
    title: 'No-op skeleton task',
    objective:
      // If the cycle goal differs from the default skeleton goal, relay it
      // to the agent so --goal actually steers a real-L4 run. The narrow
      // allowed_paths below still cap the blast radius.
      goal.goal.startsWith('Phase β skeleton dry-run')
        ? 'Stub task: do nothing. The execution agent should return an empty CompletedTask. ' +
          'The point is to exercise the L4→L5→L6 chain end-to-end against the real substrate.'
        : goal.goal,
    definition_of_done: [
      'A CompletedTask is written to tasks.outputs with result=succeeded.',
      'No files are changed.',
      'tenant_isolation evaluator runs and writes a row to cycle_evaluations.',
    ],
    allowed_paths: ['agents/runtime/**'],
    forbidden_paths: [
      'supabase/migrations/**',
      'src/**',
      'agents/prompts/**',
      'agents/contracts/**',
      'governance/**',
    ],
    context_scopes: ['code_index'],
    model_hint: 'haiku',
    max_tokens: 10000,
    // The canonical "always-required" set per agents/prompts/l2-task-orchestrator.md.
    // Every real cycle will at minimum declare these; the stub follows the same rule
    // so dry-runs are representative.
    evaluators_required: ['unit_tests', 'type_check', 'lint', 'tenant_isolation'],
  };
}

// ─── L4 stub: no-op execution ─────────────────────────────────────────

// ─── L4 dispatcher ────────────────────────────────────────────────────

/**
 * L4 returns BOTH the CompletedTask and the open worktree (when in real
 * mode), because L5 evaluators need to run inside the worktree to see
 * the agent's diff. The orchestrator closes the worktree AFTER L5+L6
 * have finished reading from it.
 */
interface L4Result {
  completed: CompletedTask;
  worktree: WorktreeHandle | null;
}

async function l4_execute(task: TaskAssignment, opts: TickOptions): Promise<L4Result> {
  if (!opts.realL4) {
    return { completed: l4_stub_execute(task), worktree: null };
  }
  if (task.agent_role !== 'code_agent') {
    // Phase β only ships the code_agent prompt + worker. Other roles fall
    // back to the stub with a clear note in the summary; L2 (when real)
    // will eventually pick the right worker per role.
    const stub = l4_stub_execute(task);
    stub.blocker_note = `No real L4 worker for agent_role='${task.agent_role}' yet — only code_agent ships in Phase β. Stub used.`;
    return { completed: stub, worktree: null };
  }

  const repoRoot = path.resolve(__dirname, '..', '..');
  log('L4', `opening worktree for task ${task.task_id.slice(0, 8)}…`);
  const worktree = await openWorktree({
    repoRoot,
    taskId: task.task_id,
    cycleId: task.cycle_id,
    agentRole: task.agent_role,
  });
  log('L4', `worktree at ${path.relative(repoRoot, worktree.root)} on branch ${worktree.branch}`);

  try {
    const completed = await runCodeAgent({
      repoRoot,
      worktree,
      task: {
        task_id: task.task_id,
        cycle_id: task.cycle_id,
        agent_role: task.agent_role,
        title: task.title,
        objective: task.objective,
        definition_of_done: task.definition_of_done,
        allowed_paths: task.allowed_paths,
        forbidden_paths: task.forbidden_paths,
        model_hint: task.model_hint,
        max_tokens: task.max_tokens,
      },
    });

    if (completed.result === 'succeeded' && completed.files_changed.length > 0) {
      const author =
        process.env.MESH_GIT_AUTHOR ??
        'Alfanumrik Agent Mesh <mesh@alfanumrik.com>';
      const message =
        `[mesh] ${task.title}\n\n` +
        `Cycle: ${task.cycle_id}\nTask: ${task.task_id}\n\n` +
        completed.summary;
      const commit = commitAll(worktree, message, author);
      log('L4', `commit: ${commit.sha?.slice(0, 8) ?? '(none)'} (${commit.filesChanged} files)`);
    } else if (completed.result === 'succeeded' && completed.files_changed.length === 0) {
      // Agent said "succeeded" but produced no diff. The critic will catch
      // the contradiction via the summary/diff alignment check (R1.1).
      log('L4', 'WARNING: agent claimed succeeded with empty diff — critic should catch this');
    }
    return { completed, worktree };
  } catch (err) {
    // Close the worktree on hard failure so we don't leave junk on disk.
    try {
      await closeWorktree(worktree, { pruneEmptyBranch: true });
    } catch {
      /* swallow — the outer thrown error is what matters */
    }
    throw err;
  }
}

function l4_stub_execute(task: TaskAssignment): CompletedTask {
  // The real L4 worker opens a worktree, calls Claude with the role-specific
  // prompt, opens a PR. The stub fast-forwards to "succeeded" with no diff.
  return {
    task_id: task.task_id,
    cycle_id: task.cycle_id,
    agent_role: task.agent_role,
    result: 'succeeded',
    branch: `auto/${task.cycle_id.slice(0, 8)}/${task.agent_role}/${task.task_id.slice(0, 8)}`,
    pr_url: null,
    summary:
      'L4 stub. No files changed. This CompletedTask exists to exercise the substrate ' +
      'and the L5/L6 chain. A real execution agent will replace this stub.',
    files_changed: [],
    constraints_respected: task.forbidden_paths,
    lessons_applied: [],
    open_questions: [
      'The stub did not consult lessons_learned or the Context Manager.',
      'No real diff was produced; the Critic should still produce a valid verdict.',
    ],
    blocker_note: null,
    tokens_spent: 0,
  };
}

// ─── L5 dispatch: run the configured evaluators ───────────────────────

// Map from canonical evaluator slug → script path relative to repo root.
// To register a new evaluator: add the slug here, add it to
// agents/contracts/evaluation.schema.json, and add an `eval:<slug>`
// npm script for independent CI use.
const EVALUATOR_SCRIPTS: Record<string, string> = {
  tenant_isolation: 'eval/tenant-isolation/run.ts',
  unit_tests: 'eval/unit-tests/run.ts',
  type_check: 'eval/type-check/run.ts',
  lint: 'eval/lint/run.ts',
};

async function l5_runEvaluators(
  taskId: string,
  cycleId: string,
  evaluators: string[],
  commit: boolean,
  worktreeRoot: string | null,
): Promise<Array<{ evaluator: string; verdict: Verdict; blocking: boolean; notes: string }>> {
  const out: Array<{ evaluator: string; verdict: Verdict; blocking: boolean; notes: string }> = [];
  const repoRoot = path.resolve(__dirname, '..', '..');
  // Evaluators run in the worktree when a real-L4 produced a diff (so
  // unit_tests / type_check / lint / tenant_isolation see the agent's
  // actual changes). When there's no worktree (stub L4 mode), they run
  // against the host repo — which is on `main`, so the verdicts reflect
  // baseline state. The evaluator scripts themselves are loaded by
  // absolute path so they work from either cwd.
  const evalCwd = worktreeRoot ?? repoRoot;

  for (const evaluator of evaluators) {
    const scriptRel = EVALUATOR_SCRIPTS[evaluator];
    if (!scriptRel) {
      // Declared required but not wired into the runtime. Per the rubric,
      // a missing required evaluator is a blocking failure — the Critic
      // will reject. This is intentional: the stub L2 declared this slug
      // and the runtime is contracted to either run it or surface its
      // absence loudly.
      out.push({
        evaluator,
        verdict: 'skipped',
        blocking: true,
        notes: `Evaluator '${evaluator}' is declared required but has no runtime registration in EVALUATOR_SCRIPTS.`,
      });
      continue;
    }

    // Pass the full command as a single quoted string with shell:true.
    // shell:true uses cmd.exe on Windows; the absolute script path contains
    // a space (repo at "C:\Users\Bharangpur Primary\..."), so wrap it in
    // double-quotes to prevent word-splitting. Passing one string is
    // cmd.exe's well-behaved mode; arg arrays are where the splitting lives.
    const absScript = path.join(repoRoot, scriptRel);
    const taskArgs = commit ? ` --task-id ${taskId} --cycle-id ${cycleId}` : '';
    const cmdline = `npx tsx "${absScript}" --json${taskArgs}`;
    log('L5', `→ (cwd=${path.relative(repoRoot, evalCwd) || '.'}) ${cmdline}`);
    const result = spawnSync(cmdline, [], {
      cwd: evalCwd,
      encoding: 'utf8',
      env: process.env,
      shell: true,
    });

    if (result.error) {
      out.push({
        evaluator,
        verdict: 'skipped',
        blocking: true,
        notes: `Spawn failed: ${result.error.message}`,
      });
      continue;
    }

    if (result.status === 2) {
      out.push({
        evaluator,
        verdict: 'skipped',
        blocking: true,
        notes: `Evaluator errored: ${result.stderr?.trim() ?? 'unknown'}`,
      });
      continue;
    }

    // Parse the JSON verdict the evaluator printed.
    let parsed: { verdict: Verdict; blocking: boolean; notes: string } | null = null;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      out.push({
        evaluator,
        verdict: 'skipped',
        blocking: true,
        notes: `Evaluator output was not valid JSON: ${result.stdout.slice(0, 200)}`,
      });
      continue;
    }
    if (!parsed) continue;
    out.push({
      evaluator,
      verdict: parsed.verdict,
      blocking: parsed.blocking,
      notes: parsed.notes,
    });
  }

  return out;
}

// ─── L6 stub: apply the decision tree ─────────────────────────────────

function l6_stub_decide(
  task: TaskAssignment,
  done: CompletedTask,
  evals: Array<{ evaluator: string; verdict: Verdict; blocking: boolean; notes: string }>,
  riskTier: number,
): CriticVerdict {
  // Templated reasoning that mirrors the literal decision tree in
  // agents/prompts/l6-critic.md. The real critic will call Opus with the
  // diff + evals + rubric and produce richer reasoning.
  const passed = evals.filter(e => e.verdict === 'pass').length;
  const failed = evals.filter(e => e.verdict === 'fail').length;
  const warned = evals.filter(e => e.verdict === 'warn').length;
  const blockingFailures = evals
    .filter(e => e.blocking && (e.verdict === 'fail' || e.verdict === 'skipped'))
    .map(e => e.evaluator);

  let decision: CriticDecision;
  let humanReviewer: string | null = null;
  let reasoning: string;
  const clauses: string[] = [];

  if (blockingFailures.length > 0) {
    decision = 'reject';
    clauses.push('R3.4');
    reasoning =
      `DECISION: reject — blocking evaluator(s) ${blockingFailures.join(', ')} did not pass.\n` +
      `WHAT THE CHANGE DOES: ${done.summary}\n` +
      `WHAT I CHECKED: forbidden-paths (respected per constraints_respected), blocking failures listed above.\n` +
      `WHAT WORRIES ME: A blocking failure on the very first cycle means the L5 runtime is not yet complete for the declared evaluator set.\n` +
      `EVIDENCE: ${evals.map(e => `${e.evaluator}=${e.verdict}`).join(', ')}`;
  } else if (
    // Stub equivalent of the Always-Escalate check (path-prefix on files_changed).
    done.files_changed.some(f =>
      /^supabase\/migrations\/|^agents\/prompts\/|^agents\/contracts\/|^governance\//.test(f.path),
    )
  ) {
    decision = 'escalate_to_human';
    humanReviewer = 'ceo';
    clauses.push('R2.1', 'R2.2');
    reasoning =
      `DECISION: escalate_to_human — touched a path on the Always-Escalate list.\n` +
      `WHAT THE CHANGE DOES: ${done.summary}\n` +
      `EVIDENCE: ${done.files_changed.map(f => f.path).join(', ')}`;
  } else if (warned > 0) {
    decision = 'request_changes';
    reasoning =
      `DECISION: request_changes — ${warned} non-blocking warn(s) need addressing.\n` +
      `WHAT THE CHANGE DOES: ${done.summary}\n` +
      `EVIDENCE: ${evals.filter(e => e.verdict === 'warn').map(e => `${e.evaluator}: ${e.notes}`).join('; ')}`;
  } else {
    decision = 'approve';
    reasoning =
      `DECISION: approve — all required evaluators passed; no forbidden-path edits; summary aligns with empty diff.\n` +
      `WHAT THE CHANGE DOES: ${done.summary}\n` +
      `WHAT I CHECKED: forbidden-paths (empty diff is trivially compliant), evaluator results (${passed}/${evals.length} pass), risk tier (${riskTier}) matches declared.\n` +
      `EVIDENCE: ${evals.map(e => `${e.evaluator}=${e.verdict}`).join(', ')}`;
  }

  return {
    task_id: task.task_id,
    cycle_id: task.cycle_id,
    decision,
    reasoning,
    rubric_version: 'v1.0.0',
    risk_tier_observed: riskTier,
    rubric_clauses_invoked: clauses,
    evaluator_summary: {
      passed,
      failed,
      warned,
      blocking_failures: blockingFailures,
    },
    human_reviewer_required: humanReviewer,
    follow_up_lessons: [],
    decided_at: new Date().toISOString(),
  };
}

// ─── Orchestrator ─────────────────────────────────────────────────────

async function tick(opts: TickOptions): Promise<void> {
  // L0 → L1: pick a CycleGoal. Real mode pulls from cycle_goal_inbox;
  // stub fabricates the skeleton no-op goal (preserved for testing).
  let goal: CycleGoal;
  let inboxId: string | null = null;

  if (opts.realL1 && opts.commit) {
    await assertMeshFlagEnabled();
    const sbTemp = getMeshSupabase();
    const pickRes = await pickNextGoal(sbTemp);
    if (!pickRes.picked) {
      log('L1', `no work to do: ${pickRes.reason ?? 'inbox empty'}`);
      return; // saves Anthropic tokens on a no-op cycle
    }
    const picked: PickedGoal = pickRes.picked;
    inboxId = picked.inbox_id;
    goal = {
      goal: picked.goal,
      goal_rationale: picked.goal_rationale ?? 'Pulled from cycle_goal_inbox by real L1 worker.',
      signal_source: picked.signal_source,
      risk_tier: picked.risk_tier,
      budget_tokens: picked.budget_tokens,
      target_metric: picked.target_metric,
      target_delta: picked.target_delta,
      tenant_scope: picked.tenant_scope,
      non_goals: picked.non_goals,
      constraints: picked.constraints,
      ...(picked.deadline ? { deadline: picked.deadline } : {}),
    };
    log('L1', `picked from inbox ${inboxId.slice(0, 8)}…: "${goal.goal.slice(0, 80)}"`);
  } else {
    goal = l1_stub_pickGoal(opts.goal);
    log('L1', `picked goal (stub): "${goal.goal}"`);
  }

  if (!opts.commit) {
    log('dry-run', 'would assert ff_agent_mesh_v1=true (skipped in dry-run)');
    log('dry-run', `would insert cycle with goal "${goal.goal}" (risk_tier=${goal.risk_tier})`);
    // Mirror the stub L2's evaluator declaration so the dry-run preview
    // matches what --commit would actually dispatch.
    const previewTask = l2_stub_decompose('00000000-0000-0000-0000-000000000000', goal);
    const l1Label = opts.realL1 ? 'L1 REAL (inbox)' : 'L1 stub';
    const l2Label = opts.realL2 ? 'L2 REAL (sonnet)' : 'L2 stub';
    const l4Label = opts.realL4 ? 'L4 REAL (sonnet)' : 'L4 stub';
    const l6Label = opts.realL6 ? 'L6 REAL (opus)' : 'L6 stub';
    const l7Label = opts.realL7 ? ' → L7 push+PR (if approve)' : '';
    log(
      'dry-run',
      `would dispatch ${l1Label} → ${l2Label} → 1 task (${previewTask.agent_role}) → ${l4Label} → L5 [${previewTask.evaluators_required.join(', ')}] → ${l6Label}${l7Label}`,
    );
    log('dry-run', 'use --commit to write to the substrate; add --real-l1/--real-l2/--real-l4/--real-l6 to use the LLM workers');
    return;
  }

  if (!opts.realL1) {
    await assertMeshFlagEnabled();
  }
  log('flag', 'ff_agent_mesh_v1 is ON');

  const sb = getMeshSupabase();

  // L1 → insert cycle
  const { data: cycleRow, error: cErr } = await sb
    .from('cycles')
    .insert({
      goal: goal.goal,
      goal_rationale: goal.goal_rationale,
      signal_source: goal.signal_source,
      status: 'executing',
      risk_tier: goal.risk_tier,
      budget_tokens: goal.budget_tokens,
      target_metric: goal.target_metric,
      target_delta: goal.target_delta,
      goal_full: goal,
    })
    .select('id')
    .single();
  if (cErr || !cycleRow) throw new Error(`L1 insert failed: ${cErr?.message ?? 'no row'}`);
  const cycleId = cycleRow.id as string;
  log('L1', `cycle ${cycleId} created (status=executing)`);

  // Link inbox row to the cycle now that we have its id.
  if (inboxId) {
    await sb.from('cycle_goal_inbox').update({ cycle_id: cycleId }).eq('id', inboxId);
  }

  // L2 → real or stub decomposition.
  let task: TaskAssignment;
  if (opts.realL2) {
    log('L2', `→ real orchestrator (sonnet)`);
    const repoRoot = path.resolve(__dirname, '..', '..');
    const l2Out: L2TaskAssignment = await runOrchestrator({
      repoRoot,
      goal: {
        goal: goal.goal,
        goal_rationale: goal.goal_rationale,
        signal_source: goal.signal_source,
        risk_tier: goal.risk_tier,
        budget_tokens: goal.budget_tokens,
        tenant_scope: goal.tenant_scope,
        non_goals: goal.non_goals,
        constraints: goal.constraints,
        lessons_to_respect: (goal as CycleGoal & { lessons_to_respect?: string[] }).lessons_to_respect ?? [],
      },
    });
    task = {
      task_id: '00000000-0000-0000-0000-000000000000',
      cycle_id: cycleId,
      agent_role: l2Out.agent_role,
      title: l2Out.title,
      objective: l2Out.objective,
      definition_of_done: l2Out.definition_of_done,
      allowed_paths: l2Out.allowed_paths,
      forbidden_paths: l2Out.forbidden_paths,
      context_scopes: l2Out.context_scopes,
      model_hint: l2Out.model_hint,
      max_tokens: l2Out.max_tokens,
      evaluators_required: l2Out.evaluators_required,
    };
  } else {
    task = l2_stub_decompose(cycleId, goal);
  }

  const { data: taskRow, error: tErr } = await sb
    .from('tasks')
    .insert({
      cycle_id: cycleId,
      agent_role: task.agent_role,
      title: task.title,
      description: task.objective,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      inputs: { ...task, task_id: undefined }, // task_id is the row id; don't duplicate
    })
    .select('id')
    .single();
  if (tErr || !taskRow) throw new Error(`L2 insert failed: ${tErr?.message ?? 'no row'}`);
  task.task_id = taskRow.id as string;
  // Re-write inputs now that we know the row id, so anyone reading the row
  // gets a TaskAssignment whose task_id matches.
  await sb.from('tasks').update({ inputs: task }).eq('id', task.task_id);
  log('L2', `task ${task.task_id} created (agent=${task.agent_role})`);

  // L4 → execute (real or stub). Returns the worktree handle when in
  // real mode so L5 can run inside it and L6 can read the diff.
  const { completed: done, worktree } = await l4_execute(task, opts);
  const taskStatus =
    done.result === 'succeeded' ? 'succeeded' : done.result === 'failed' ? 'failed' : 'blocked';
  await sb
    .from('tasks')
    .update({
      status: taskStatus,
      branch: done.branch,
      outputs: { completed_task: done },
      completed_at: new Date().toISOString(),
      blocker_note: done.blocker_note ?? null,
    })
    .eq('id', task.task_id);
  log(
    'L4',
    `task ${task.task_id} → ${done.result} (files=${done.files_changed.length}, tokens=${done.tokens_spent})`,
  );

  // L5 → dispatch evaluators inside the worktree (when present) so they
  // see the agent's diff.
  const evals = await l5_runEvaluators(
    task.task_id,
    cycleId,
    task.evaluators_required,
    true,
    worktree ? worktree.root : null,
  );
  for (const e of evals) {
    log('L5', `${e.evaluator}: ${e.verdict}`);
  }

  // L6 → critic decision (real or stub)
  let verdict: CriticVerdict;
  if (opts.realL6) {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const diff = worktree ? diffAgainstBaseline(worktree) : '';
    log('L6', `→ real critic (opus, diff ${diff.split(/\r?\n/).length} lines)`);
    const real = await runCritic({
      repoRoot,
      task: {
        task_id: task.task_id,
        cycle_id: task.cycle_id,
        title: task.title,
        objective: task.objective,
        risk_tier_declared: goal.risk_tier,
      },
      completed: done,
      evals,
      diff,
    });
    verdict = real;
  } else {
    verdict = l6_stub_decide(task, done, evals, goal.risk_tier);
  }
  // Co-locate the CriticVerdict with the CompletedTask under tasks.outputs.
  await sb
    .from('tasks')
    .update({
      outputs: { completed_task: done, critic_verdict: verdict },
    })
    .eq('id', task.task_id);
  log('L6', `decision: ${verdict.decision}`);

  // Cycle wrap-up. For this skeleton, any non-approve decision aborts the
  // cycle so the next run starts clean.
  if (verdict.decision === 'approve') {
    await sb
      .from('cycles')
      .update({ status: 'complete', ended_at: new Date().toISOString(), ended_reason: 'shipped' })
      .eq('id', cycleId);
    log('L7', `cycle ${cycleId} → complete/shipped (skeleton: no real deploy)`);
  } else {
    await sb
      .from('cycles')
      .update({
        status: 'aborted',
        ended_at: new Date().toISOString(),
        ended_reason: verdict.decision === 'escalate_to_human' ? 'escalated' : 'aborted',
      })
      .eq('id', cycleId);
    log('L7', `cycle ${cycleId} → aborted (reason=${verdict.decision})`);
  }

  // Resolve the inbox row if one was picked. Mirrors the cycle status.
  if (inboxId) {
    try {
      await resolveInboxRow(sb, inboxId, cycleId, verdict.decision);
      log('L7', `inbox ${inboxId.slice(0, 8)}… → resolved (${verdict.decision})`);
    } catch (err: unknown) {
      log('L7', `WARNING: inbox resolve failed: ${(err as Error).message}`);
    }
  }

  // L7 deploy: push + open PR if approved AND non-empty diff. Requires
  // worktree (set by --real-l4) and explicit --real-l7 opt-in. We do
  // this BEFORE closeWorktree so the branch is still locally consistent
  // — git push works against the worktree's view.
  let l7PrUrl: string | null = null;
  if (opts.realL7 && worktree) {
    try {
      const deployRes = await runDeploy({
        worktree,
        cycleId,
        taskId: task.task_id,
        goalText: goal.goal,
        l4Summary: done.summary,
        l4FilesChanged: done.files_changed,
        l5Verdicts: evals.map(e => ({ evaluator: e.evaluator, verdict: e.verdict, blocking: e.blocking })),
        l6Decision: verdict.decision,
        l6Reasoning: verdict.reasoning,
        rubricVersion: verdict.rubric_version,
        tokensSpent: done.tokens_spent,
      });
      if (deployRes.skipped) {
        log('L7', `deploy skipped: ${deployRes.skipReason}`);
      } else {
        log('L7', deployRes.notes);
        l7PrUrl = deployRes.prUrl;
      }
    } catch (err: unknown) {
      log('L7', `WARNING: deploy failed: ${(err as Error).message}`);
    }
  } else if (worktree && verdict.decision === 'approve' && done.files_changed.length > 0) {
    log('L7', `deploy SKIPPED (--real-l7 not set; branch ${worktree.branch} preserved locally)`);
  }

  process.stdout.write('\n── Cycle summary ──────────────────────────────────────\n');
  process.stdout.write(`  cycle_id   : ${cycleId}\n`);
  process.stdout.write(`  task_id    : ${task.task_id}\n`);
  process.stdout.write(`  decision   : ${verdict.decision}\n`);
  process.stdout.write(`  evaluators : ${evals.map(e => `${e.evaluator}=${e.verdict}`).join(', ')}\n`);
  process.stdout.write(`  reasoning  : ${verdict.reasoning.split('\n')[0]}\n`);
  if (worktree) {
    process.stdout.write(`  branch     : ${worktree.branch} (worktree removed; branch preserved on host)\n`);
  }
  if (l7PrUrl) {
    process.stdout.write(`  pr         : ${l7PrUrl}\n`);
  }
  process.stdout.write('\n');

  // Close the worktree LAST — L5 and L6 needed it open. We keep the
  // branch in the host repo so the human can inspect, push, or discard.
  if (worktree) {
    try {
      await closeWorktree(worktree, { pruneEmptyBranch: true });
      log('L7', `worktree closed (branch ${worktree.branch} preserved on host)`);
    } catch (err: unknown) {
      log('L7', `WARNING: worktree cleanup failed: ${(err as Error).message}`);
    }
  }
}

// ─── Entry point ──────────────────────────────────────────────────────

if (require.main === module) {
  // Auto-load .env.local. Standard project workflow:
  //   vercel env pull .env.local --environment=development
  // After that, every tick run picks up ANTHROPIC_API_KEY / SUPABASE_* via
  // process.env without manual exports.
  const envResult = loadDotenv(path.resolve(__dirname, '..', '..'));
  if (envResult.loadedFrom) {
    process.stdout.write(
      `[mesh:tick] env → loaded ${envResult.varsSet} var(s) from ${path.basename(envResult.loadedFrom)}\n`,
    );
    if (envResult.parseErrors.length > 0) {
      for (const e of envResult.parseErrors) {
        process.stderr.write(`[mesh:tick] env → parse error: ${e}\n`);
      }
    }
  }
  tick(parseArgs()).catch(err => {
    process.stderr.write(`[mesh:tick] fatal: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
