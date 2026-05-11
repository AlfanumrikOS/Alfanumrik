/**
 * agents/runtime/layers/l6-critic.ts — real L6 critic worker.
 *
 * Replaces the templated `l6_stub_decide` from tick.ts when called with
 * --real-l6. Given a CompletedTask + the diff + every EvaluationVerdict
 * + the rubric, calls Opus and emits a CriticVerdict.
 *
 * Hard properties enforced by this module (not delegated to the model):
 *   - The decision is taken from a structured tool-use call, not parsed
 *     out of free text. The model literally cannot return "looks good"
 *     without populating the required structured fields.
 *   - Rubric_version is stamped from the live rubric.md (not from the
 *     model's claim) so the audit trail is reproducible.
 *   - "Always-Escalate" path-prefix is checked deterministically AFTER
 *     the model's decision — if the model said `approve` but the diff
 *     touches a sentinel path, we override to `escalate_to_human`. The
 *     model cannot bypass this rule.
 *   - The reasoning length floor (rubric R10.1) is enforced: a verdict
 *     for risk_tier ≥ 2 with reasoning < 200 words is upgraded to
 *     `request_changes` with a note.
 *   - Token budget: the critic is one round (no tool loop), bounded by
 *     CRITIC_MAX_TOKENS. If the diff is too big, we bail with
 *     `escalate_to_human` BEFORE calling the model.
 *
 * Cost: one Anthropic call per task. The system prompt (role + rubric +
 * decision tree) is marked ephemeral so it cache-hits across tasks
 * within the 5-minute TTL.
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

const ROLE_PROMPT_FILE = 'agents/prompts/l6-critic.md';
const RUBRIC_FILE = 'governance/rubric.md';
const CRITIC_MAX_OUTPUT_TOKENS = 4096;
const DIFF_LINE_LIMIT = 2000; // Per l6-critic.md: anything bigger → escalate.
const REASONING_WORD_FLOOR = 200; // Rubric R10.1.

const ALWAYS_ESCALATE_PATTERNS: Array<{ pattern: RegExp; reviewer: string; clauses: string[] }> = [
  { pattern: /^supabase\/migrations\//, reviewer: 'principal_engineer', clauses: ['R2.1'] },
  { pattern: /^agents\/prompts\//, reviewer: 'ceo', clauses: ['R2.2'] },
  { pattern: /^agents\/contracts\//, reviewer: 'ceo', clauses: ['R2.2'] },
  { pattern: /^governance\//, reviewer: 'ceo', clauses: ['R2.2'] },
  { pattern: /razorpay|billing|pricing/i, reviewer: 'ceo', clauses: ['R5.3'] },
  { pattern: /^src\/middleware\.ts$/, reviewer: 'security_lead', clauses: ['R3.*'] },
  { pattern: /^src\/lib\/rbac/, reviewer: 'security_lead', clauses: ['R3.*'] },
  { pattern: /^supabase\/functions\/foxy-tutor\//, reviewer: 'pedagogy_lead', clauses: ['R4.5'] },
  { pattern: /^supabase\/functions\/ncert-solver\//, reviewer: 'pedagogy_lead', clauses: ['R4.5'] },
  { pattern: /^supabase\/functions\/cme-engine\//, reviewer: 'pedagogy_lead', clauses: ['R4.5'] },
  { pattern: /foxy-pedagogy-method/, reviewer: 'pedagogy_lead', clauses: ['R4.1'] },
];

// ─── Types (mirror agents/contracts/critic-verdict.schema.json) ───────

export type CriticDecision = 'approve' | 'request_changes' | 'reject' | 'escalate_to_human';

export interface CompletedTaskInput {
  task_id: string;
  cycle_id: string;
  agent_role: string;
  result: 'succeeded' | 'failed' | 'needs_replan';
  branch: string;
  summary: string;
  files_changed: Array<{ path: string; change: string }>;
  open_questions?: string[];
  blocker_note?: string | null;
}

export interface EvaluationInput {
  evaluator: string;
  verdict: 'pass' | 'fail' | 'warn' | 'skipped';
  blocking: boolean;
  notes: string;
}

export interface CriticVerdictOutput {
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
  follow_up_lessons: Array<{ claim: string; applies_when: string; confidence: 'low' | 'medium' | 'high' }>;
  decided_at: string;
}

// ─── Tool definition ──────────────────────────────────────────────────

const SUBMIT_VERDICT_TOOL: ToolDef = {
  name: 'submit_verdict',
  description:
    'Submit your final critique. You MUST call this exactly once. The fields are structured so the audit trail is queryable.',
  input_schema: {
    type: 'object',
    properties: {
      decision: {
        type: 'string',
        enum: ['approve', 'request_changes', 'reject', 'escalate_to_human'],
      },
      reasoning: {
        type: 'string',
        description:
          'The case for the decision. Use the WHAT THE CHANGE DOES / WHAT I CHECKED / WHAT WORRIES ME / EVIDENCE structure from the role prompt. Minimum ~200 words for any risk_tier >= 2.',
      },
      risk_tier_observed: {
        type: 'number',
        description: '1=copy/UI; 2=non-schema code; 3=new feature; 4=tenant/billing; 5=schema/pedagogy/policy.',
      },
      rubric_clauses_invoked: {
        type: 'array',
        items: { type: 'string' },
        description: 'IDs of rubric clauses you relied on, e.g. ["R1.1", "R3.4"].',
      },
      human_reviewer_required: {
        type: 'string',
        description:
          'If decision=escalate_to_human, name the reviewer role: ceo, principal_engineer, pedagogy_lead, or security_lead. Otherwise omit.',
      },
      follow_up_lessons: {
        type: 'array',
        description:
          'Optional draft lessons_learned entries this cycle suggests. NOT auto-inserted; require human approval downstream.',
        items: {
          type: 'object',
          properties: {
            claim: { type: 'string' },
            applies_when: { type: 'string' },
            confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          },
          required: ['claim', 'applies_when', 'confidence'],
        },
      },
    },
    required: ['decision', 'reasoning', 'risk_tier_observed', 'rubric_clauses_invoked'],
  },
};

// ─── User-turn assembly ──────────────────────────────────────────────

function countDiffLines(diff: string): number {
  if (!diff) return 0;
  return diff.split(/\r?\n/).length;
}

function buildUserTurn(args: {
  task: { task_id: string; cycle_id: string; title: string; objective: string; risk_tier_declared: number };
  completed: CompletedTaskInput;
  evals: EvaluationInput[];
  diff: string;
}): string {
  const filesList =
    args.completed.files_changed.length === 0
      ? '(no files changed)'
      : args.completed.files_changed.map(f => `  - ${f.change}: ${f.path}`).join('\n');
  const evalsList =
    args.evals.length === 0
      ? '(no evaluators ran)'
      : args.evals
          .map(
            e =>
              `  - ${e.evaluator} → ${e.verdict.toUpperCase()} (blocking=${e.blocking})\n    ${e.notes.slice(0, 400).replace(/\n/g, '\n    ')}`,
          )
          .join('\n');

  return [
    `# Task to review`,
    ``,
    `**task_id:** ${args.task.task_id}`,
    `**cycle_id:** ${args.task.cycle_id}`,
    `**title:** ${args.task.title}`,
    `**declared risk_tier:** ${args.task.risk_tier_declared}`,
    ``,
    `## Objective from L2`,
    args.task.objective,
    ``,
    `## L4's CompletedTask`,
    `**result:** ${args.completed.result}`,
    `**branch:** ${args.completed.branch}`,
    ``,
    `**files_changed:**`,
    filesList,
    ``,
    `**summary (verbatim from L4):**`,
    args.completed.summary || '(empty)',
    ``,
    args.completed.open_questions && args.completed.open_questions.length > 0
      ? `**open_questions:**\n${args.completed.open_questions.map(q => `  - ${q}`).join('\n')}\n`
      : '',
    args.completed.blocker_note ? `**blocker_note:** ${args.completed.blocker_note}\n` : '',
    `## L5 evaluator verdicts`,
    evalsList,
    ``,
    `## Diff (\`${'```'}\` fenced)`,
    `\`\`\`diff`,
    args.diff || '(empty diff)',
    `\`\`\``,
    ``,
    `Apply the decision tree in your role prompt LITERALLY. Then call submit_verdict.`,
  ].join('\n');
}

// ─── Rubric version detection ─────────────────────────────────────────

function extractRubricVersion(rubricText: string): string {
  const m = rubricText.match(/^\*\*Version:\*\*\s*(v\d+\.\d+\.\d+)/m);
  return m?.[1] ?? 'unknown';
}

// ─── Always-Escalate override (deterministic) ─────────────────────────

function alwaysEscalateMatch(filesChanged: Array<{ path: string }>): {
  reviewer: string;
  clauses: string[];
} | null {
  for (const f of filesChanged) {
    for (const rule of ALWAYS_ESCALATE_PATTERNS) {
      if (rule.pattern.test(f.path)) return { reviewer: rule.reviewer, clauses: rule.clauses };
    }
  }
  return null;
}

// ─── Pure result builder (testable) ───────────────────────────────────

export interface BuildVerdictArgs {
  taskId: string;
  cycleId: string;
  riskTierDeclared: number;
  filesChanged: Array<{ path: string }>;
  evals: EvaluationInput[];
  rubricVersion: string;
  modelDecision: {
    decision: CriticDecision;
    reasoning: string;
    risk_tier_observed: number;
    rubric_clauses_invoked: string[];
    human_reviewer_required?: string | null;
    follow_up_lessons?: Array<{ claim: string; applies_when: string; confidence: 'low' | 'medium' | 'high' }>;
  };
}

export function applyDeterministicGuards(args: BuildVerdictArgs): CriticVerdictOutput {
  const passed = args.evals.filter(e => e.verdict === 'pass').length;
  const failed = args.evals.filter(e => e.verdict === 'fail').length;
  const warned = args.evals.filter(e => e.verdict === 'warn').length;
  const blockingFailures = args.evals
    .filter(e => e.blocking && (e.verdict === 'fail' || e.verdict === 'skipped'))
    .map(e => e.evaluator);

  let decision = args.modelDecision.decision;
  let reviewer = args.modelDecision.human_reviewer_required ?? null;
  let clauses = [...(args.modelDecision.rubric_clauses_invoked ?? [])];
  let reasoning = args.modelDecision.reasoning;

  // 1. Blocking-evaluator override (rubric R3.4 etc.): if anything blocking
  //    failed/skipped, force reject regardless of the model's call.
  if (blockingFailures.length > 0 && decision !== 'reject') {
    reasoning =
      `[GUARD: blocking-evaluator override] ${blockingFailures.length} required evaluator(s) failed/skipped (${blockingFailures.join(', ')}). ` +
      `Per rubric R3.4 and the evaluator-blocking flags, the critic cannot approve over these. Overriding model decision (${decision}) → reject.\n\n` +
      `Original model reasoning:\n${reasoning}`;
    decision = 'reject';
    reviewer = null;
    if (!clauses.includes('R3.4')) clauses.push('R3.4');
  }

  // 2. Always-Escalate path override.
  const ae = alwaysEscalateMatch(args.filesChanged);
  if (ae && decision !== 'escalate_to_human' && decision !== 'reject') {
    reasoning =
      `[GUARD: always-escalate override] diff touches a path on the Always-Escalate list — human reviewer ${ae.reviewer} required regardless of model call.\n\n` +
      `Original model reasoning:\n${reasoning}`;
    decision = 'escalate_to_human';
    reviewer = ae.reviewer;
    for (const c of ae.clauses) if (!clauses.includes(c)) clauses.push(c);
  }

  // 3. Reasoning-floor enforcement (R10.1) — only when risk_tier_observed
  //    is 2 or higher AND the model approved.
  const obsRisk = args.modelDecision.risk_tier_observed;
  const wordCount = reasoning.trim().split(/\s+/).filter(Boolean).length;
  if (
    decision === 'approve' &&
    obsRisk >= 2 &&
    wordCount < REASONING_WORD_FLOOR
  ) {
    reasoning =
      `[GUARD: reasoning-floor override] reasoning length (${wordCount} words) is below the R10.1 floor (${REASONING_WORD_FLOOR}) for risk_tier_observed=${obsRisk}. ` +
      `An approval this thin is treated as a request_changes — the critic must do the work.\n\n` +
      `Original model reasoning:\n${reasoning}`;
    decision = 'request_changes';
    if (!clauses.includes('R10.1')) clauses.push('R10.1');
  }

  return {
    task_id: args.taskId,
    cycle_id: args.cycleId,
    decision,
    reasoning,
    rubric_version: args.rubricVersion,
    risk_tier_observed: obsRisk,
    rubric_clauses_invoked: clauses,
    evaluator_summary: { passed, failed, warned, blocking_failures: blockingFailures },
    human_reviewer_required: reviewer,
    follow_up_lessons: args.modelDecision.follow_up_lessons ?? [],
    decided_at: new Date().toISOString(),
  };
}

// ─── The L6 worker ────────────────────────────────────────────────────

export interface RunCriticArgs {
  repoRoot: string;
  task: { task_id: string; cycle_id: string; title: string; objective: string; risk_tier_declared: number };
  completed: CompletedTaskInput;
  evals: EvaluationInput[];
  diff: string;
  model?: Model;
}

export async function runCritic(args: RunCriticArgs): Promise<CriticVerdictOutput> {
  assertAnthropicReady();

  // Defensive early-outs that don't need the LLM.
  const ae = alwaysEscalateMatch(args.completed.files_changed);
  const diffLines = countDiffLines(args.diff);

  // Load rubric + role prompt; the rubric version stamps the verdict.
  const rolePrompt = await fs.readFile(path.join(args.repoRoot, ROLE_PROMPT_FILE), 'utf8');
  const rubricText = await fs.readFile(path.join(args.repoRoot, RUBRIC_FILE), 'utf8');
  const rubricVersion = extractRubricVersion(rubricText);

  // If the diff is too big to read, force escalate WITHOUT calling the
  // model — the role prompt itself says "diff > 2000 lines → ask L2 to
  // split (request_changes)" but the safer default for the runtime is to
  // escalate to a human so nothing slips through.
  if (diffLines > DIFF_LINE_LIMIT) {
    return applyDeterministicGuards({
      taskId: args.task.task_id,
      cycleId: args.task.cycle_id,
      riskTierDeclared: args.task.risk_tier_declared,
      filesChanged: args.completed.files_changed,
      evals: args.evals,
      rubricVersion,
      modelDecision: {
        decision: 'escalate_to_human',
        reasoning:
          `Diff exceeds the ${DIFF_LINE_LIMIT}-line limit (${diffLines} lines). Per the role prompt, the critic cannot reliably review changes this large in a single pass; a human must split or sign off.`,
        risk_tier_observed: Math.max(args.task.risk_tier_declared, 3),
        rubric_clauses_invoked: ['R6.1', 'R7.1'],
        human_reviewer_required: ae?.reviewer ?? 'principal_engineer',
      },
    });
  }

  const system: SystemBlock[] = [
    { type: 'text', text: rolePrompt, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `# governance/rubric.md (version ${rubricVersion})\n\n${rubricText}`, cache_control: { type: 'ephemeral' } },
  ];

  const userText = buildUserTurn({
    task: args.task,
    completed: args.completed,
    evals: args.evals,
    diff: args.diff,
  });

  const response = await createMessage({
    model: args.model ?? 'claude-opus-4-7',
    max_tokens: CRITIC_MAX_OUTPUT_TOKENS,
    system,
    messages: [{ role: 'user', content: userText }],
    tools: [SUBMIT_VERDICT_TOOL],
    // Note: Opus 4.7 deprecated the temperature parameter — omitting it
    // here, the model uses its default (effectively deterministic for
    // structured-output tasks like this critic).
  });

  const toolUses = extractToolUses(response.content);
  const submission = toolUses.find(t => t.name === 'submit_verdict');
  if (!submission) {
    // Model emitted text only — treat as critic failure and force escalate.
    return applyDeterministicGuards({
      taskId: args.task.task_id,
      cycleId: args.task.cycle_id,
      riskTierDeclared: args.task.risk_tier_declared,
      filesChanged: args.completed.files_changed,
      evals: args.evals,
      rubricVersion,
      modelDecision: {
        decision: 'escalate_to_human',
        reasoning:
          'Critic did not call submit_verdict. The runtime treats this as a procedural failure of the critic, not the diff. Human review required to unblock.',
        risk_tier_observed: Math.max(args.task.risk_tier_declared, 3),
        rubric_clauses_invoked: ['R10.2'],
        human_reviewer_required: 'principal_engineer',
      },
    });
  }

  const m = submission.input as {
    decision: CriticDecision;
    reasoning: string;
    risk_tier_observed: number;
    rubric_clauses_invoked: string[];
    human_reviewer_required?: string;
    follow_up_lessons?: Array<{ claim: string; applies_when: string; confidence: 'low' | 'medium' | 'high' }>;
  };

  return applyDeterministicGuards({
    taskId: args.task.task_id,
    cycleId: args.task.cycle_id,
    riskTierDeclared: args.task.risk_tier_declared,
    filesChanged: args.completed.files_changed,
    evals: args.evals,
    rubricVersion,
    modelDecision: {
      decision: m.decision,
      reasoning: m.reasoning,
      risk_tier_observed: m.risk_tier_observed,
      rubric_clauses_invoked: m.rubric_clauses_invoked ?? [],
      human_reviewer_required: m.human_reviewer_required ?? null,
      follow_up_lessons: m.follow_up_lessons ?? [],
    },
  });
}
