/**
 * agents/runtime/layers/l2-orchestrator.ts — real L2 Task Orchestrator
 * worker.
 *
 * Takes a CycleGoal and produces a TaskAssignment via a single Sonnet
 * call with structured `submit_task` tool use. Phase β scope:
 *
 *   - Produces exactly ONE task per cycle (single-task DAG). Real
 *     multi-task decomposition is a Phase γ concern; for now any cycle
 *     needing more than one task should be split into multiple
 *     inbox goals.
 *   - Defaults agent_role to 'code_agent' (the only real L4 worker
 *     shipped today). The model may suggest 'schema_agent' or other
 *     roles, but the orchestrator will downgrade to code_agent + flag
 *     a follow-up if no real worker exists for the suggested role.
 *   - Enforces the canonical 4 evaluator defaults (unit_tests,
 *     type_check, lint, tenant_isolation) by appending them to
 *     whatever the model returns.
 *   - Path scoping: trusts the model's allowed_paths but always merges
 *     the canonical forbidden_paths defaults (migrations, prompts,
 *     contracts, governance) — these are blast-radius firewalls the
 *     model cannot weaken.
 *
 * Deterministic post-guards (the model cannot bypass these):
 *   - forbidden_paths ⊇ canonical defaults
 *   - evaluators_required ⊇ canonical 4
 *   - agent_role must be one with a real L4 worker → code_agent fallback
 *   - allowed_paths must be non-empty
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  assertAnthropicReady,
  createMessage,
  extractToolUses,
  type Model,
  type SystemBlock,
  type ToolDef,
} from '../anthropic';

const ROLE_PROMPT_FILE = 'agents/prompts/l2-task-orchestrator.md';
const L2_MAX_OUTPUT_TOKENS = 2048;

const CANONICAL_REQUIRED_EVALUATORS = [
  'unit_tests',
  'type_check',
  'lint',
  'tenant_isolation',
] as const;

// Files no role except schema_agent / evolution_agent may touch. Merged
// into every TaskAssignment.forbidden_paths regardless of the model's call.
const CANONICAL_FORBIDDEN_DEFAULTS = [
  'supabase/migrations/**',
  'agents/prompts/**',
  'agents/contracts/**',
  'governance/**',
  '.github/workflows/mesh-cron.yml', // the cron itself — agents shouldn't edit their own scheduler
];

const ROLES_WITH_REAL_WORKER = new Set(['code_agent']);

// ─── Types ───────────────────────────────────────────────────────────

export interface L2CycleGoalInput {
  goal: string;
  goal_rationale: string | null;
  signal_source: 'ceo' | 'feedback' | 'evolution' | 'incident' | 'ad-hoc';
  risk_tier: number;
  budget_tokens: number;
  tenant_scope: 'house' | 'pilot' | 'all';
  non_goals: string[];
  constraints: string[];
  lessons_to_respect: string[];
}

export interface L2TaskAssignment {
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
  l2_notes: string;
}

// ─── Tool definition handed to Sonnet ────────────────────────────────

const SUBMIT_TASK_TOOL: ToolDef = {
  name: 'submit_task',
  description:
    'Submit the single decomposed TaskAssignment for this CycleGoal. Phase β only supports one task per cycle. Required fields are enforced server-side — your call.',
  input_schema: {
    type: 'object',
    properties: {
      agent_role: {
        type: 'string',
        description: 'One of: code_agent (default). schema_agent, content_agent, ux_agent, etc. will be downgraded to code_agent + flagged for follow-up.',
      },
      title: { type: 'string', description: 'One-line task title (~8-80 chars).' },
      objective: { type: 'string', description: 'What the agent should accomplish. Concrete enough that two engineers would build the same thing.' },
      definition_of_done: {
        type: 'array',
        items: { type: 'string' },
        description: 'Bullet checklist the agent must satisfy before opening a PR.',
      },
      allowed_paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Glob list the agent may edit. Must be non-empty. Be specific — over-broad allowed_paths weaken the blast-radius firewall.',
      },
      forbidden_paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Glob list the agent MUST NOT touch. The runtime appends canonical defaults (migrations, prompts, contracts, governance) regardless of what you specify here.',
      },
      model_hint: { type: 'string', enum: ['opus', 'sonnet', 'haiku'], description: 'Suggested model tier for L4.' },
      max_tokens: { type: 'integer', description: 'Per-task token budget. Hard stop.' },
      l2_notes: { type: 'string', description: 'One-paragraph rationale for the decomposition — what trade-offs you made, why this scope, anything L6 should see.' },
    },
    required: ['agent_role', 'title', 'objective', 'definition_of_done', 'allowed_paths', 'model_hint', 'max_tokens', 'l2_notes'],
  },
};

// ─── User-turn assembly ──────────────────────────────────────────────

function buildUserTurn(goal: L2CycleGoalInput): string {
  return [
    '# CycleGoal to decompose',
    '',
    `**signal_source:** ${goal.signal_source}`,
    `**risk_tier:** ${goal.risk_tier}`,
    `**tenant_scope:** ${goal.tenant_scope}`,
    `**budget_tokens:** ${goal.budget_tokens}`,
    '',
    '## Goal',
    goal.goal,
    '',
    goal.goal_rationale ? `## Rationale\n${goal.goal_rationale}\n` : '',
    '## Non-goals',
    ...goal.non_goals.map(g => `- ${g}`),
    '',
    '## Constraints',
    ...goal.constraints.map(c => `- ${c}`),
    '',
    goal.lessons_to_respect.length
      ? `## Lessons to respect\n${goal.lessons_to_respect.map(id => `- ${id}`).join('\n')}\n`
      : '',
    '',
    'Decompose into ONE TaskAssignment. Call submit_task with the structured fields.',
  ].join('\n');
}

// ─── Deterministic post-guards ───────────────────────────────────────

export interface ApplyGuardsArgs {
  modelOutput: {
    agent_role?: string;
    title?: string;
    objective?: string;
    definition_of_done?: string[];
    allowed_paths?: string[];
    forbidden_paths?: string[];
    model_hint?: 'opus' | 'sonnet' | 'haiku';
    max_tokens?: number;
    l2_notes?: string;
  };
  goalText: string;
}

export function applyL2Guards(args: ApplyGuardsArgs): L2TaskAssignment {
  const m = args.modelOutput;

  // 1. agent_role: downgrade unknown roles to code_agent.
  let role = (m.agent_role ?? 'code_agent').toLowerCase();
  let roleNote = '';
  if (!ROLES_WITH_REAL_WORKER.has(role)) {
    roleNote = ` [L2 GUARD: downgraded agent_role from '${role}' to code_agent — no real worker for that role in Phase β]`;
    role = 'code_agent';
  }

  // 2. allowed_paths: must be non-empty. If empty, fall back to runtime
  //    folder only (very conservative).
  const allowed = (m.allowed_paths ?? []).filter(p => typeof p === 'string' && p.length > 0);
  const allowedFinal = allowed.length > 0 ? allowed : ['agents/runtime/**'];

  // 3. forbidden_paths: union with canonical defaults.
  const forbiddenSet = new Set<string>([
    ...(m.forbidden_paths ?? []).filter(p => typeof p === 'string'),
    ...CANONICAL_FORBIDDEN_DEFAULTS,
  ]);

  // 4. evaluators_required: always include the canonical 4.
  const evaluators = [...CANONICAL_REQUIRED_EVALUATORS];

  // 5. definition_of_done: ensure non-empty.
  const dod = (m.definition_of_done ?? []).filter(s => typeof s === 'string' && s.length > 0);
  const dodFinal = dod.length > 0 ? dod : [`Satisfy the goal: ${args.goalText.slice(0, 120)}`];

  return {
    agent_role: role,
    title: (m.title ?? args.goalText.slice(0, 80)).slice(0, 120),
    objective: m.objective ?? args.goalText,
    definition_of_done: dodFinal,
    allowed_paths: allowedFinal,
    forbidden_paths: [...forbiddenSet],
    context_scopes: ['code_index'],
    model_hint: m.model_hint ?? 'sonnet',
    max_tokens: Math.min(Math.max(m.max_tokens ?? 100_000, 10_000), 1_000_000),
    evaluators_required: evaluators,
    l2_notes: (m.l2_notes ?? 'No notes from model.') + roleNote,
  };
}

// ─── The L2 worker ────────────────────────────────────────────────────

export interface RunOrchestratorArgs {
  repoRoot: string;
  goal: L2CycleGoalInput;
  model?: Model;
}

export async function runOrchestrator(args: RunOrchestratorArgs): Promise<L2TaskAssignment> {
  assertAnthropicReady();
  const rolePrompt = await fs.readFile(path.join(args.repoRoot, ROLE_PROMPT_FILE), 'utf8');

  const system: SystemBlock[] = [
    { type: 'text', text: rolePrompt, cache_control: { type: 'ephemeral' } },
  ];

  const response = await createMessage({
    model: args.model ?? 'claude-sonnet-4-6',
    max_tokens: L2_MAX_OUTPUT_TOKENS,
    system,
    messages: [{ role: 'user', content: buildUserTurn(args.goal) }],
    tools: [SUBMIT_TASK_TOOL],
  });

  const toolUses = extractToolUses(response.content);
  const submission = toolUses.find(t => t.name === 'submit_task');
  if (!submission) {
    // Fall back to a conservative auto-decomposition rather than failing
    // the cycle. The l2_notes makes this visible to L6.
    return applyL2Guards({
      modelOutput: {
        agent_role: 'code_agent',
        title: args.goal.goal.slice(0, 80),
        objective: args.goal.goal,
        definition_of_done: [`Address: ${args.goal.goal.slice(0, 120)}`],
        allowed_paths: ['agents/runtime/**'],
        forbidden_paths: [],
        model_hint: 'sonnet',
        max_tokens: 100_000,
        l2_notes: 'L2 model did not call submit_task; using conservative fallback decomposition.',
      },
      goalText: args.goal.goal,
    });
  }

  return applyL2Guards({
    modelOutput: submission.input as ApplyGuardsArgs['modelOutput'],
    goalText: args.goal.goal,
  });
}
