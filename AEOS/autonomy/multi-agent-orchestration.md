# Multi-Agent Orchestration

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v2.0
**Classification:** Autonomy/Governance Standard
**Priority:** P1 (Governs how multiple agents coordinate; subordinate to the live product invariants P1-P15, the Constitution, the MASTER_SYSTEM_PROMPT, and the EXECUTION_ENGINE)
**Applies To:** Every task executed by more than one agent on the Alfanumrik platform — whether routed through the interactive `.claude` 10-agent system or the root `agents/` L1-L6 layered mesh runtime.

---

# Purpose

AEOS v1.0 made a single agent behave like a disciplined Principal Engineer. AEOS v1.1 turned the standards into operational playbooks. AEOS v2.0 governs **multiple agents acting in concert** without losing the evidence discipline, architectural boundaries, and human-approval gates that the Constitution guarantees.

This document is the orchestration standard. It does not invent a new agent system — Alfanumrik already ships two real, complementary substrates. It defines how those substrates coordinate work: how a task is decomposed, how agents are dispatched in parallel or in sequence, how one agent hands off to the next under a hard contract, and which review gates sit between every stage.

The governing principle is unchanged: a multi-agent system may move faster than a single agent, but it may never move past a product invariant, a human-approval gate, or an unverified claim.

---

# The Two Real Substrates

Alfanumrik runs two orchestration substrates today. Both are real and in-tree. v2.0 governs both; it replaces neither.

## Substrate A — The interactive `.claude` system (live, default)

The orchestrator is the default session agent (`.claude/settings.json: "agent": "orchestrator"`). Every user request enters through `.claude/agents/orchestrator.md`, which classifies the request, spawns the minimum set of specialist agents (`architect`, `frontend`, `backend`, `assessment`, `ai-engineer`, `mobile`, `testing`, `quality`, `ops`), enforces the six gates, and reports. The roster, ownership map, and routing table live in `.claude/agents/orchestrator.md` and the Domain Ownership table in `.claude/CLAUDE.md`. Mechanical enforcement is provided by four PreToolUse/PostToolUse hooks (`.claude/hooks/`).

## Substrate B — The root `agents/` L1-L6 layered mesh (Phase α/β, flag-gated OFF)

A self-improving layered runtime documented in `agents/README.md`. Eight layers (L0 signal intake through L8 evolution), communicating through six `service_role`-only Supabase tables (`cycles`, `tasks`, `cycle_evaluations`, `lessons_learned`, `outcome_metrics`, `agent_prompts`), gated entirely behind `ff_agent_mesh_v1` (default OFF; migration `supabase/migrations/20260511120000_agent_mesh_foundation.sql`). The hard interfaces between layers are JSON Schemas in `agents/contracts/`. Versioned prompts live in `agents/prompts/`. A Phase β runtime skeleton exists at `agents/runtime/tick.ts` with the sandbox firewall at `agents/runtime/sandbox.ts`.

## How they relate

Substrate A is the human-in-the-loop development system used right now. Substrate B is the autonomous build/evolve loop being brought up behind a flag. They share the same constitutional spine: ownership-by-path, a critic/quality veto, mandatory evaluators, and Always-Escalate paths for schema, billing, RBAC, AI, and pedagogy. v2.0 binds both to the same rules so that flipping `ff_agent_mesh_v1` ON never lowers a governance bar.

---

# The Layered Mesh (L1-L6 and beyond)

The root mesh assigns one responsibility per layer. The flow, end-to-end, is documented in `agents/README.md`; the binding interfaces are the contracts.

| Layer | Role | Source of truth | Output contract |
|---|---|---|---|
| L1 | Meta-Orchestrator — picks one CycleGoal | `agents/prompts/l1-meta-orchestrator.md` | `agents/contracts/cycle-goal.schema.json` |
| L2 | Task Orchestrator — decomposes goal into a TaskAssignment DAG | `agents/prompts/l2-task-orchestrator.md` | `agents/contracts/task-assignment.schema.json` |
| L3 | Context Manager — hydrates agents with scoped context | `agents/README.md` (context_scopes) | n/a (hydration) |
| L4 | Execution Swarm — one PR per task (`code_agent`, `schema_agent`, etc.) | `agents/prompts/l4-code-agent.md` | `agents/contracts/completed-task.schema.json` |
| L5 | Evaluation Layer — deterministic + soft evaluators | `agents/README.md` (evaluator table) | `agents/contracts/evaluation.schema.json` |
| L6 | Critic — approve / request_changes / reject / escalate | `agents/prompts/l6-critic.md` | `agents/contracts/critic-verdict.schema.json` |
| L7 | Deploy + Feedback — canary, telemetry | `agents/runtime/layers/l7-deploy.ts` | n/a |
| L8 | Learning + Evolution — lessons, prompt/rubric evolution (human-approved) | `agents/README.md` §L8 | `lessons_learned`, `agent_prompts` |

L1 is the strategic counterpart to Substrate A's orchestrator classification step; L2 is the counterpart to the orchestrator's decompose step; L4 maps to the specialist builders; L5 maps to the `testing` agent and CI gates; L6 maps to the `quality` agent and Gate 5. The mapping is intentional: the same engineering judgment, expressed in two runtimes.

---

# Task Decomposition

Decomposition is owned by the orchestrator (Substrate A) or L2 (Substrate B). The rules are identical:

1. **One owner per sub-task.** Each atomic unit has exactly one owning agent (Substrate A routing table; L2 `agent_role`). Two agents must never claim the same file — the orchestrator resolves ownership before execution starts.
2. **One PR per task.** If an agent would naturally open more than one PR, the task is too big and must be split (`agents/prompts/l2-task-orchestrator.md`).
3. **One critic decision per task.** A change needing independent approvals on independent slices is two tasks.
4. **Reversible.** A single revert restores prior state.
5. **Blast radius declared up front.** Every task carries a non-empty `allowed_paths` and `forbidden_paths` (TaskAssignment schema requires both). "I don't know" is not an answer; an undecidable scope means a mis-shaped task.

A decomposition that produces a long serial chain is a signal the goal is too big — return to L1 / re-scope rather than power through.

---

# Parallel vs Sequential Dispatch

Default to parallel; sequence only true dependencies.

**Parallel (independent agents, same step).** When sub-tasks touch disjoint files, dispatch their owning agents simultaneously. In Substrate A this is multiple `Agent` tool calls in one message (orchestrator §Parallel Foreground); in Substrate B it is sibling `tasks` rows with no `parent_task_id`. Example: `architect` creates a migration while `frontend` updates an unrelated page.

**Sequential (`parent_task_id` / blocking handoff).** Use a dependency edge only for genuine ordering: a `pedagogy_agent` spec before its `code_agent` implementation; a `schema_agent` migration before code that reads the new column; evaluator scaffolding before the change it evaluates. Substrate A expresses this as a foreground handoff; Substrate B as `parent_task_id`.

**Foreground vs background (Substrate A).** Read-only research (codebase scans, regression-catalog audits, content-gap analysis) runs in the background; any write to application code, any result that gates the next step, and any high-risk task runs in the foreground (orchestrator §Foreground vs Background Execution Model).

**Cost and circuit-breaker (Substrate B).** Per-cycle token budgets are enforced in `cycles.budget_tokens`; repeated retries of the same task trip a circuit breaker (3 strikes → cycle aborts), per `agents/README.md` §Cost & safety guardrails.

---

# Handoff Contracts

A handoff is a contract, not a conversation. Drift between what one agent claims and what it delivered is the single largest cause of bad merges, and it is rejected mechanically.

**Substrate A handoff format** (orchestrator §Handoff Format): from → to, one-sentence task, what was completed, the specific next action, the file list, and open questions. The receiving agent reads the changed files before acting; a review where the reviewer did not read the files does not count (review-chains SKILL §What Counts as a Completed Review).

**Substrate B handoffs are typed JSON Schemas** validated at the layer boundary:
- L1 → L2: `cycle-goal.schema.json` (goal, rationale, risk_tier, budget, target_metric, tenant_scope, non_goals, constraints).
- L2 → L4: `task-assignment.schema.json` (objective, definition_of_done, allowed_paths, forbidden_paths, model_hint, evaluators_required).
- L4 → L5: `completed-task.schema.json` (result, branch, summary, files_changed). The `summary` is read verbatim by L6; words like "robust" or "production-ready" trip the sycophancy filter (`agents/prompts/l4-code-agent.md`).
- L5 → L6: `evaluation.schema.json`, one verdict per evaluator.
- L6 output: `critic-verdict.schema.json` (decision, reasoning, rubric_version, rubric_clauses_invoked, human_reviewer_required).

The blast-radius firewall is enforced in code at `agents/runtime/sandbox.ts`: every file op resolves under the worktree root and must match an `allowed_paths` glob and no `forbidden_paths` glob, or it throws a `SandboxError`. The agent gives up on that path immediately; it never works around the restriction, because the restriction is the point.

---

# Review Gates Between Stages

Every stage boundary carries a gate. No stage advances on an unverified claim (EXECUTION_ENGINE failure sub-loop).

**Substrate A — six gates** (release-gates skill + orchestrator §Task Protocol):
1. Type compilation (`npm run type-check`).
2. Lint (`npm run lint`).
3. Unit tests (`npm test`), with honest regression-catalog gap reporting.
4. Build (`npm run build`) within P10 bundle limits.
5. Review-chain completeness (P14) — every mandatory downstream reviewer invoked and returning APPROVE / APPROVE WITH CONDITIONS.
6. Pre-push — no secrets staged, conventional commit message.

**Substrate B — evaluator set + critic decision tree.** L5 runs the required evaluators (`unit_tests`, `type_check`, `lint`, `tenant_isolation` always; plus `learning_eval`, `pedagogy_eval`, `accessibility`, `red_team`, `bundle_size`, `i18n_coverage` as the change demands). L6 then applies its decision tree literally and in order (`agents/prompts/l6-critic.md`): any blocking evaluator failure → reject; observed risk more than one tier above declared → escalate; an Always-Escalate path touched → escalate regardless of evaluators; summary↔diff mismatch → reject; otherwise → approve. Skipping a step is itself a critic failure.

The two gate systems are the same discipline: deterministic checks first, then a reasoning veto, then human escalation for the highest-blast-radius changes.

---

# Mapping the Mesh Onto the AEOS Execution Loop

The mesh does not bypass the EXECUTION_ENGINE loop (UNDERSTAND → PLAN → RISK/APPROVAL → IMPLEMENT → STATIC VERIFY → DYNAMIC VERIFY → REGRESSION → DOCUMENT → REPORT). It distributes it:

- **UNDERSTAND / PLAN** are L1 (which problem) plus L2 (which tasks).
- **RISK / APPROVAL** is `risk_tier` on the CycleGoal plus the Always-Escalate routing in L6.
- **IMPLEMENT** is L4, incrementally, one PR per task, no placeholders (Prime Directive 5 + `l4-code-agent.md`).
- **STATIC + DYNAMIC + REGRESSION VERIFY** are the L5 evaluators producing executed evidence (Prime Directive 1).
- **DOCUMENT / REPORT** are the CompletedTask summary and the auditable CriticVerdict, with `rubric_version` and `rubric_clauses_invoked` recorded for replay.

Evidence classification (Verified / Observed / Inferred / Unknown) still applies: an evaluator that did not actually run is `skipped`, not `pass`, and a `skipped` blocking evaluator forces a reject in `tick.ts`'s critic logic.

---

# Orchestration Checklist

Confirm each item before reporting a multi-agent task complete. Use '-' for each check.

- The substrate in use (A interactive, B mesh, or both) was identified and its rules applied.
- The task was decomposed with one owner per sub-task and no contested file ownership.
- Every task declared non-empty `allowed_paths` and `forbidden_paths`.
- Independent agents ran in parallel; only true dependencies were sequenced.
- Each handoff used the contract (Substrate A handoff format or the JSON Schema at the layer boundary) and the receiver read the changed files.
- Every stage gate was satisfied with executed evidence, not assumption.
- Substrate A: all six gates passed, including Gate 5 review-chain completeness (P14).
- Substrate B: the required evaluator set ran and L6 applied its decision tree in order.
- No Always-Escalate path was merged without the named human reviewer's approval.
- Token budgets and the retry circuit-breaker were respected; no runaway cycle.
- Every product invariant P1-P15 governing the change was preserved.
- The completion report classified each claim by evidence and disclosed any coverage gap.

If any item fails, the task is not complete.

---

# References

**Core AEOS documents (by number and name):**
- `docs/00_AI_CONSTITUTION.md` — Supreme charter; creed, Prime Directives, conflict-resolution rule.
- `docs/01_ROLE_DEFINITION.md` — Engineering identity each agent enacts.
- `docs/10_VERIFICATION_ENGINE.md` — Normative evidence-based verification protocol the L5 layer satisfies.
- `MASTER_SYSTEM_PROMPT.md` — Authority Level 2 operating charter.
- `EXECUTION_ENGINE.md` — Authority Level 3 canonical execution loop the mesh distributes.

**Relevant v1.1 playbooks and runbooks:**
- `AEOS/playbooks/ai-workflows.md` — multi-step AI workflow composition.
- `AEOS/playbooks/ai-evaluation.md` — evaluator design feeding the L5 layer.
- `AEOS/playbooks/prompt-engineering.md` — versioned prompt discipline behind `agents/prompts/`.
- `AEOS/runbooks/supabase-operations.md` — operating the `service_role`-only substrate tables.

**Companion v2.0 autonomy documents:**
- `AEOS/autonomy/specialized-agents.md` — the agent roster, ownership, tools, and spawn criteria.
- `AEOS/autonomy/agent-governance.md` — ownership boundaries, P14 enforcement, the four hooks, approval gates.

**The real substrate (in-tree paths):**
- `agents/README.md`, `agents/prompts/{l1-meta-orchestrator,l2-task-orchestrator,l4-code-agent,l6-critic}.md`.
- `agents/contracts/{cycle-goal,task-assignment,completed-task,evaluation,critic-verdict}.schema.json`.
- `agents/runtime/tick.ts`, `agents/runtime/sandbox.ts`.
- `.claude/agents/orchestrator.md`, `.claude/CLAUDE.md` (Domain Ownership + P14 matrix), `.claude/skills/review-chains/SKILL.md`, `.claude/skills/release-gates/SKILL.md`.
- `supabase/migrations/20260511120000_agent_mesh_foundation.sql` (substrate + `ff_agent_mesh_v1`).

---

# Final Directive

Two real substrates orchestrate work on Alfanumrik: the live `.claude` orchestrator-plus-specialists system, and the flag-gated L1-L6 mesh in `agents/`. v2.0 governs both with one rule set. Decompose to one owner per task. Dispatch in parallel where independent, in sequence only where dependent. Hand off on a contract, never a vibe. Gate every stage with executed evidence. Escalate every high-blast-radius path to the named human.

A multi-agent system earns trust the same way a single engineer does: by never claiming done without proof, and by never moving past a product invariant. Orchestrate accordingly.

**End of Document**
