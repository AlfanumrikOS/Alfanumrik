# Alfanumrik Agent Mesh

A self-improving system of cooperating agents that build, evaluate, ship, and refine Alfanumrik. Documented end-to-end here so a new contributor — human or agent — can read this one file and know what's where.

**Status:** Phase α scaffolding (substrate + contracts + L1/L2/L6 prompts). Runtime not yet shipped.

**Gating flag:** `ff_agent_mesh_v1` — default OFF. Nothing in this folder runs until the flag is flipped. See migration `supabase/migrations/20260511120000_agent_mesh_foundation.sql`.

---

## The eight layers

```
L0  Signal intake          users · teachers · CEO · market · ops
 │
L1  Meta-Orchestrator      Picks the next CycleGoal               opus
 │
L2  Task Orchestrator      Decomposes goal into TaskAssignments   opus → sonnet
 │
L3  Context Manager        Hydrates agents with code/pedagogy/    sonnet
 │                          tenant context, lessons_learned
 │
L4  Execution Swarm        Code, schema, content, pedagogy,       sonnet / haiku
 │                          UX, i18n, devops — one PR per task
 │
L5  Evaluation Layer       Tests, learning evals, perf,           deterministic +
 │                          tenant isolation, red team             sonnet for soft evals
 │
L6  Critic                 Approve / request / reject /            opus
 │                          escalate per /governance/rubric.md
 │
L7  Deploy + Feedback      Vercel canary, PostHog, learner data    haiku
 │
L8  Learning + Evolution   Lessons, prompt evolution, rubric       opus + human approval
 │                          evolution, topology proposals
 │
 └────────────── feeds back into L1 ───────────────────────────────
```

## What lives where

```
agents/
├── README.md                            ← you are here
├── contracts/                           ← JSON Schemas; the hard interface between layers
│   ├── cycle-goal.schema.json           ← L1 → L2
│   ├── task-assignment.schema.json      ← L2 → L4
│   ├── completed-task.schema.json       ← L4 → L5
│   ├── evaluation.schema.json           ← L5 → L6 (one per evaluator)
│   └── critic-verdict.schema.json       ← L6 output; drives merge/escalate
└── prompts/                             ← Versioned agent prompts (source of truth in git)
    ├── l1-meta-orchestrator.md
    ├── l2-task-orchestrator.md
    └── l6-critic.md
governance/
└── rubric.md                            ← The law the Critic applies. Versioned.
supabase/migrations/
└── 20260511120000_agent_mesh_foundation.sql  ← State substrate (6 tables, RLS, flag)
```

The runtime — the worker processes that load these prompts, call Claude, and write to Supabase — is not yet shipped. Phase α implements it. See `docs/architecture/engineering-roadmap.md` (to be updated) for the rollout.

## The state substrate

Six tables, all `service_role` only, all under RLS:

| Table | One row per | Written by |
|---|---|---|
| `cycles` | Build/evolve cycle | L1, L2 |
| `tasks` | One task in a cycle DAG | L2; L4 updates status/outputs |
| `cycle_evaluations` | Evaluator verdict on a task | L5 evaluators |
| `lessons_learned` | Atomic semantic-memory claim | L8 (with human approval) |
| `outcome_metrics` | Per-cycle, per-tenant before/after | L8 Outcome Analyst |
| `agent_prompts` | Versioned prompt snapshot | L8 Evolution Agent |

The runtime communicates through these tables. We deliberately don't use a message broker — Postgres `LISTEN/NOTIFY` is sufficient until we outgrow it.

## The execution swarm (L4) roles

Each role is allowed a narrow blast radius. The `forbidden_paths` enforcement is in the Critic, not the runtime, so an agent that tries to wander gets caught at L6.

| Role | Owns | NEVER touches |
|---|---|---|
| `code_agent` | `src/**` Next.js app, API routes, tests | `supabase/migrations/**`, `agents/**`, `governance/**` |
| `schema_agent` | `supabase/migrations/**` only | `src/**`, anything else |
| `content_agent` | Lesson/question/hint content (DB rows + seed scripts) | App code, migrations |
| `pedagogy_agent` | `docs/architecture/foxy-pedagogy-method.md` and sibling specs | App code (writes specs only; `code_agent` implements) |
| `ux_agent` | `src/components/**`, design tokens, Tailwind config | Logic, data layer, migrations |
| `i18n_agent` | Hindi/regional content parity, glossary | Source-language content (English is canonical) |
| `devops_agent` | CI, feature flags, canary config, observability wiring | Application code |
| `evolution_agent` | `agents/prompts/**`, `agents/contracts/**`, `governance/**` (proposals only) | Anything else; all changes go through `escalate_to_human` |

## The evaluators (L5)

Canonical slugs (also enumerated in `agents/contracts/evaluation.schema.json`):

| Evaluator | What | Blocking? |
|---|---|---|
| `unit_tests` | Vitest + Playwright | Always |
| `type_check` | `tsc --noEmit` | Always |
| `lint` | ESLint + project's `eslint-plugin-alfanumrik` | Always |
| `learning_eval` | Synthetic-learner simulation on changed content/pedagogy | Always when content/pedagogy touched |
| `pedagogy_eval` | Golden-cohort mastery-curve regression | Always when pedagogy touched |
| `performance` | Lighthouse budgets, API p95 | Always for new surfaces |
| `accessibility` | axe-core, screen-reader trace | Always for UI |
| `tenant_isolation` | Cross-tenant data-leak harness | Always (no exceptions) |
| `red_team` | Prompt-injection, PII leak, age-appropriateness | Always for AI surfaces / content |
| `bundle_size` | Next.js bundle delta | Required for `code_agent` UI tasks |
| `i18n_coverage` | English/Hindi parity, missing keys | Required for `i18n_agent`, recommended for `code_agent` UI |

## The cycle, end-to-end (happy path)

```
1. L0 signal lands (PostHog digest, CEO inbox, incident, evolution proposal)
2. L1 reads open cycles + recent outcomes + lessons. Picks one goal.
3. L1 writes a row into `cycles` with status='planning'.
4. L2 wakes (LISTEN/NOTIFY). Reads the CycleGoal.
5. L2 decomposes → N rows into `tasks`, each with a TaskAssignment in `inputs`.
6. L4 agents wake per task. Run in their own git worktrees. Open PRs.
7. L4 writes back: `tasks.outputs` = CompletedTask JSON, `tasks.status` = succeeded.
8. L5 evaluators run (CI + agent-driven). Each writes a row to `cycle_evaluations`.
9. When the required evaluator set is complete for a task, L6 wakes.
10. L6 reads diff + evidence + rubric. Writes a CriticVerdict to `tasks.outputs.critic_verdict`.
11. Decision tree:
    - approve         → DevOps agent merges (canary first; flag-gated promotion).
    - request_changes → L2 spawns a follow-up task with the critic's notes.
    - reject          → Task marked failed; L2 re-decomposes or escalates to L1.
    - escalate        → Cycle pauses; CEO/lead approves manually.
12. When all tasks succeed and ship, L7 starts watching PostHog + learner telemetry.
13. After the cycle's measurement window, L8 writes outcome_metrics + draft lessons.
14. Human reviews drafts. Approved lessons land in `lessons_learned`. Memory updated.
15. The cycle ends. L1's next tick sees the new state.
```

## How the system gets better (L8)

Three concrete mechanisms — none of them magic:

1. **Prompt evolution.** When `agent_prompts.win_rate` for the live prompt for a role drops, the Evolution Agent forks the prompt (inserts a new row, same role, `version+1`, `shadow_mode=true`). It runs in shadow on N cycles; outputs are compared to the live prompt's outputs (critic-approval rate, eval pass rate, token cost). Only after a sustained win does it flip `is_active`. The unique index `uniq_agent_prompts_active_per_role` enforces one live prompt per role at a time.
2. **Rubric evolution.** When the Critic approves something that later causes a regression in production, the failure is encoded as a new clause in `governance/rubric.md`. The rubric is versioned (`v1.0.0`, …) and every CriticVerdict stamps the version it used. Clauses are only weakened with explicit human approval.
3. **Topology evolution.** When >30% of a category of work bounces at L6, the Evolution Agent proposes either splitting an agent role (too broad) or adding a pre-check (consistent specific failure). Topology changes always require human approval via `escalate_to_human`.

## Cost & safety guardrails

- **Per-cycle token budget** enforced in `cycles.budget_tokens`. R9.1 in the rubric forbids approving past it.
- **Circuit breaker** on repeated retries of the same task (3 strikes → cycle aborts).
- **Always-Escalate list** in `agents/prompts/l6-critic.md` and rubric R2/R4/R5 keeps schema, pedagogy, billing, and security changes in human hands.
- **`service_role`-only RLS** on substrate tables. Agents never receive end-user JWTs.
- **`ff_agent_mesh_v1=false`** is the master kill switch. Flipping it OFF stops L1 from creating new cycles immediately.

## Tracing & audit

Every `CriticVerdict` records:
- `rubric_version` → exact version of `governance/rubric.md`
- `rubric_clauses_invoked` → which clauses applied
- The full `reasoning` text

Combined with the immutable `cycles` / `tasks` / `cycle_evaluations` tables, any decision the mesh ever made can be replayed: "in cycle X, why did we approve PR Y?" returns a definitive answer.

## Phase rollout (recap)

- **Phase α** (current): substrate + contracts + L1/L2/L6 prompts. Runtime workers not yet shipped. Cycles can be created manually for dry runs.
- **Phase β**: build the L4 swarm (one role at a time, `code_agent` first), wire L5 to existing CI, light up the L6 runtime. Auto-merge limited to `risk_tier=1`.
- **Phase γ**: add `schema_agent`, `pedagogy_agent`, tenant-scoped canary path. Expand auto-merge to `risk_tier=2`.
- **Phase δ**: L8 evolution layer goes live in shadow mode. Lessons land. Prompts evolve.

## Open questions (resolve before turning on `ff_agent_mesh_v1`)

1. Where does the Cycle Goal Inbox live — Notion, a markdown file in the repo, or a Supabase table? L1 reads from it.
2. Who is the named `human_reviewer` for each Always-Escalate path? Names + on-call rotation.
3. How does the runtime authenticate? A long-lived service-account that can read/write the six substrate tables only, with no cross-row access to other tables, would be ideal.
4. What's the trigger for an L1 tick — cron, GitHub Action, manual `npm run mesh:tick`? Cron is cleanest; GitHub Action is easier to start.
