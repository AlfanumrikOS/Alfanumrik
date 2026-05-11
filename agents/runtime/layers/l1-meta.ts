/**
 * agents/runtime/layers/l1-meta.ts — real L1 Meta-Orchestrator worker.
 *
 * Replaces the hardcoded stub in tick.ts when called with --real-l1.
 * Reads from public.cycle_goal_inbox, picks the highest-priority
 * pending goal, marks it in_progress, and returns a CycleGoal matching
 * /agents/contracts/cycle-goal.schema.json.
 *
 * Deliberately simple at Phase β:
 *   - Pulls the next pending row (priority DESC, created_at ASC).
 *   - Marks status='in_progress' atomically (race-safe via UPDATE
 *     RETURNING with a WHERE status='pending' clause).
 *   - Reads recent cycles + lessons_learned (cap 5 + 20 respectively)
 *     so the cycle row can record what L1 knew at decision time.
 *   - Returns null if the inbox is empty (the orchestrator then exits
 *     cleanly with "no work to do" — saves Anthropic tokens vs running
 *     a no-op cycle).
 *
 * What this does NOT do (yet):
 *   - No LLM call. L1's decision is rule-based ("oldest highest-priority
 *     pending row wins"). The L1 PROMPT's 4-axis scoring is a human
 *     concern — when a human seeds a row, they set the priority. When
 *     L8 evolution seeds a row, it computes priority from cycle outcome
 *     deltas. The L1 worker just picks.
 *   - No re-prioritization based on recent outcomes. A future iteration
 *     could re-score pending rows when a cycle finishes; not today.
 *
 * Output contract: /agents/contracts/cycle-goal.schema.json
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PickedGoal {
  inbox_id: string;
  goal: string;
  goal_rationale: string | null;
  signal_source: 'ceo' | 'feedback' | 'evolution' | 'incident' | 'ad-hoc';
  risk_tier: number;
  budget_tokens: number;
  target_metric: string;
  target_delta: number;
  tenant_scope: 'house' | 'pilot' | 'all';
  non_goals: string[];
  constraints: string[];
  deadline: string | null;
  lessons_to_respect: string[];
}

export interface PickGoalResult {
  picked: PickedGoal | null;
  reason?: string;
}

const DEFAULT_BUDGET_TOKENS = 500_000;
const DEFAULT_RISK_TIER = 2;
const DEFAULT_TARGET_METRIC = 'mesh_cycle_completion';
const DEFAULT_TARGET_DELTA = 1;

/**
 * Pure logic for shaping an inbox row into a CycleGoal. Exposed so unit
 * tests can pin the contract-shape mapping without a live database.
 */
export function shapePickedGoal(row: {
  id: string;
  goal: string;
  goal_rationale: string | null;
  signal_source: 'ceo' | 'feedback' | 'evolution' | 'incident' | 'ad-hoc';
  risk_tier_hint: number | null;
  target_metric: string | null;
  target_delta: number | null;
  tenant_scope: 'house' | 'pilot' | 'all';
  non_goals: unknown;
  constraints: unknown;
  deadline: string | null;
}, lessonsToRespect: string[]): PickedGoal {
  // jsonb fields land as parsed JS; constrain shape conservatively.
  const nonGoals = Array.isArray(row.non_goals) ? row.non_goals.map(String) : [];
  const constraints = Array.isArray(row.constraints) ? row.constraints.map(String) : [];
  return {
    inbox_id: row.id,
    goal: row.goal,
    goal_rationale: row.goal_rationale,
    signal_source: row.signal_source,
    risk_tier: row.risk_tier_hint ?? DEFAULT_RISK_TIER,
    budget_tokens: DEFAULT_BUDGET_TOKENS,
    target_metric: row.target_metric ?? DEFAULT_TARGET_METRIC,
    target_delta: row.target_delta ?? DEFAULT_TARGET_DELTA,
    tenant_scope: row.tenant_scope,
    non_goals: nonGoals,
    constraints: constraints,
    deadline: row.deadline,
    lessons_to_respect: lessonsToRespect,
  };
}

export async function pickNextGoal(sb: SupabaseClient): Promise<PickGoalResult> {
  // Atomic pick: UPDATE the highest-priority pending row to in_progress and
  // RETURN it. The WHERE status='pending' clause is the race guard — two
  // workers running concurrently each see one row at most.
  //
  // Postgres doesn't support ORDER BY in plain UPDATE; we use a CTE-based
  // approach via a Supabase RPC would be cleanest, but to avoid an extra
  // migration we do a two-step: SELECT the candidate id, then UPDATE with
  // WHERE id=... AND status='pending'. The WHERE clause keeps it race-safe
  // even though it's two round-trips.

  const { data: candidates, error: selErr } = await sb
    .from('cycle_goal_inbox')
    .select('id')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1);
  if (selErr) throw new Error(`L1 inbox select failed: ${selErr.message}`);
  if (!candidates || candidates.length === 0) {
    return { picked: null, reason: 'inbox empty (no pending goals)' };
  }
  const candidateId = candidates[0].id as string;

  const { data: claimed, error: updErr } = await sb
    .from('cycle_goal_inbox')
    .update({
      status: 'in_progress',
      picked_at: new Date().toISOString(),
    })
    .eq('id', candidateId)
    .eq('status', 'pending') // race guard
    .select('id, goal, goal_rationale, signal_source, risk_tier_hint, target_metric, target_delta, tenant_scope, non_goals, constraints, deadline')
    .maybeSingle();
  if (updErr) throw new Error(`L1 inbox claim failed: ${updErr.message}`);
  if (!claimed) {
    // Another worker claimed it between our SELECT and UPDATE. Retry once.
    return { picked: null, reason: 'race lost on claim; another worker took it' };
  }

  // Fetch active (non-retired) lessons_learned so L1 can declare which
  // ones the downstream layers must respect. We cap to recent + high-
  // confidence to keep context bounded.
  const { data: lessons } = await sb
    .from('lessons_learned')
    .select('id')
    .is('retired_at', null)
    .in('confidence', ['medium', 'high'])
    .order('created_at', { ascending: false })
    .limit(20);
  const lessonsToRespect = (lessons ?? []).map(l => l.id as string);

  return { picked: shapePickedGoal(claimed as Parameters<typeof shapePickedGoal>[0], lessonsToRespect) };
}

/** Mark an inbox row resolved when its cycle ends. */
export async function resolveInboxRow(
  sb: SupabaseClient,
  inboxId: string,
  cycleId: string,
  decision: 'approve' | 'request_changes' | 'reject' | 'escalate_to_human' | 'aborted',
): Promise<void> {
  // Map cycle outcome → inbox status.
  const status =
    decision === 'approve'
      ? 'done'
      : decision === 'escalate_to_human'
        ? 'needs_human'
        : 'abandoned';
  const { error } = await sb
    .from('cycle_goal_inbox')
    .update({
      status,
      cycle_id: cycleId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', inboxId);
  if (error) throw new Error(`L1 inbox resolve failed: ${error.message}`);
}
