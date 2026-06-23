# Agent Governance

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v2.0
**Classification:** Autonomy/Governance Standard
**Priority:** P0 (Governs autonomous agent behavior and the limits of autonomy; subordinate only to the live product invariants P1-P15 and the Constitution)
**Applies To:** Every autonomous and semi-autonomous action taken by any agent on the Alfanumrik platform — interactive `.claude` agents and the flag-gated L1-L8 mesh alike.

---

# Purpose

Autonomy is only safe when it is bounded. This document defines the bounds. It states the ownership boundaries every agent must respect, the Review Chain matrix (P14) and how it is enforced, the four mechanical enforcement hooks, the approval gates, how conflicts between agents are resolved, and — most importantly — the exhaustive list of actions that ALWAYS require human approval and can never be taken autonomously.

The constitutional rule is the spine of everything below: **when an AEOS rule and a product invariant conflict, the invariant wins; and when any change touches a human-approval gate, the human decides.** No agent, no orchestrator, no mesh cycle, and no feature flag may relax this. Governance is the reason autonomy is allowed to exist at all.

---

# Ownership Boundaries

Every critical file has exactly one owning agent. Ownership is not a suggestion; it is enforced at write time.

The authoritative map is the Domain Ownership table in `.claude/CLAUDE.md` (30+ domains → 9 agents, each with owner/reviewer/approver) and the per-agent definitions in `.claude/agents/`. In the mesh, ownership is the `agent_role` field on each TaskAssignment plus the role table in `agents/README.md` §"The execution swarm (L4) roles", where each role is granted a narrow blast radius and a `NEVER touches` column.

Boundary rules that admit no exception:
1. **Migrations are architect / `schema_agent` only.** No other agent or L4 role may write `supabase/migrations/**`. This is the project's blast-radius firewall (`l2-task-orchestrator.md` hard rule; `guard.sh` Rule 1; `sandbox.ts`).
2. **Auth/RBAC/middleware are architect only.** A bug here exposes data to the wrong role (`guard.sh` Rules 2-3).
3. **Scoring/XP/exam logic is assessment only** (P1-P4; `guard.sh` Rule 4).
4. **AI Edge Functions are ai-engineer only** (P12; `guard.sh` Rule 5).
5. **Payment code is backend only** (P11; `guard.sh` Rule 6).
6. **Deployment config is architect only** (`guard.sh` Rule 7).
7. **Agent-system files (`.claude/agents/`, `.claude/CLAUDE.md`, `.claude/skills/`) are orchestrator-only and changes are human-approved** (`guard.sh` Rule 8). In the mesh, `agents/prompts/**`, `agents/contracts/**`, and `governance/**` are `evolution_agent`-proposal-only, and every such change routes through `escalate_to_human`.
8. **Mobile (`mobile/**`) is mobile-agent only** (`guard.sh` Rule 9).

The Least-Privilege Prime Directive (PD6) applies to agents themselves: an agent uses the minimum capability for its task and never widens its own path scope for convenience.

---

# The Review Chain Matrix (P14)

P14 — Review Chain Completeness — is a product invariant: when a critical file is modified, the mandatory downstream reviewers must be invoked before the task can be marked complete. The full matrix is `.claude/skills/review-chains/SKILL.md`; the summary lives in `.claude/CLAUDE.md` §P14.

Representative chains (making agent → mandatory reviewers):
- Grading/XP constants (assessment) → testing, ai-engineer, backend, frontend, mobile.
- Learner-state rules (assessment) → ai-engineer, frontend, testing.
- AI tutor behavior / RAG / quiz generation (ai-engineer) → assessment, testing.
- RBAC/auth (architect) → backend, frontend, ops, testing.
- Onboarding/signup flow (architect) → backend, frontend, testing (E2E for all three roles).
- Payment flow (backend) → architect, testing, mobile.
- Deployment config (architect) → ops, testing.
- Anti-cheat thresholds (assessment + architect) → backend, testing.

**What counts as a completed review** (review-chains SKILL §): the downstream agent was actually invoked, read the changed files, produced structured output in its agent format, and gave a verdict of APPROVE / APPROVE WITH CONDITIONS / REJECT. A review is NOT complete if the agent was never invoked, did not read the files, produced no structured output, or gave REJECT on an unaddressed issue.

**Enforcement path:** the `review-chain.sh` PostToolUse hook injects the required-reviewer reminder the moment a critical file is written; the orchestrator validates completeness at Gate 5 (orchestrator §Step 5); the quality agent rejects at final review if any chain is incomplete. In the mesh, the L6 Critic enforces the equivalent — its Always-Escalate list routes schema, billing, RBAC, AI, and pedagogy changes to named human reviewers regardless of evaluator verdicts (`l6-critic.md`).

---

# The Four Enforcement Hooks

Governance is mechanical first, advisory second. Four hooks in `.claude/hooks/` cannot be bypassed by an agent:

| Hook | Event | File | Enforces |
|---|---|---|---|
| Write Guard | PreToolUse (Edit/Write) | `guard.sh` | Ownership-by-path: 9 blocking + 5 warning rules. A subagent writing outside its domain is denied. |
| Bash Guard | PreToolUse (Bash) | `bash-guard.sh` | Blocks `sed`/`awk`/`echo >`/`tee`/`cp`/`mv` edits to protected files, destructive git ops (`push --force`, `reset --hard`, `clean -f`), secret exposure, and warns on direct deploys. |
| Review Chain | PostToolUse (Edit/Write) | `review-chain.sh` | Injects the mandatory downstream-reviewer reminder for ~20 critical file patterns. |
| Content Check | PostToolUse (Edit/Write) | `post-edit-check.sh` | Flags hardcoded secrets, `NEXT_PUBLIC_` secret exposure, `console.log` in prod, hardcoded XP, integer grades, new tables missing RLS, and `DROP TABLE`/`DROP COLUMN`. |

Two design facts matter for governance. First, when `agent_type` is empty the user is driving directly and writes are allowed — enforcement targets subagents, not the human. Second, the guards are defense-in-depth: `bash-guard.sh` exists specifically to stop an agent from using a shell to do what the Write Guard would block, so the firewall holds across tools. The mesh has its own code-level firewall in `agents/runtime/sandbox.ts`, which rejects any file op outside the worktree root or matching a `forbidden_paths` glob with a `SandboxError`.

---

# Approval Gates

Two complementary gate systems run on the two substrates; both end at the same human-approval boundary.

**Interactive — six gates** (release-gates skill): type-check → lint → unit tests (with honest catalog-gap reporting) → build (within P10 limits) → review-chain completeness (Gate 5, P14) → pre-push (no secrets, conventional commit). Gates 1-4 are run by quality; Gate 5 by the orchestrator; domain reviews by the owning agents.

**Mesh — evaluators + critic** (`agents/README.md`, `l6-critic.md`): L5 runs the required evaluator set (`unit_tests`, `type_check`, `lint`, `tenant_isolation` always; conditional ones as the change demands); L6 applies its decision tree literally — blocking evaluator fail → reject; observed risk more than one tier above declared → escalate; Always-Escalate path touched → escalate; summary↔diff mismatch → reject; else approve. Auto-merge is limited by phase: `risk_tier=1` in Phase β, expanding only as the mesh proves itself.

Every gate produces evidence; "passed" is a claim of fact governed by Prime Directive 1. A gate that did not run is reported as not-run, never assumed passed.

---

# Conflict Resolution

When agents disagree, resolution is deterministic, not negotiated (orchestrator §Conflict Resolution):

1. **The owning agent for the concern has final say** (Domain Ownership table). Architect decides schema; assessment decides scoring; ai-engineer decides AI safety; and so on.
2. **If ownership is ambiguous, the orchestrator decides** based on which domain is most affected.
3. **Product invariants P1-P15 override all agents — no negotiation.** No agent verdict can stand against an invariant.
4. **If agents disagree on a product question, escalate to the user.** Two irreconcilable recommendations are a human decision, not a coin flip.

In the mesh, the same hierarchy is encoded: L6 is adversarial and its verdict gates the merge; a `request_changes` sends a new task to L4 via L2; a `reject` aborts the task; an `escalate_to_human` pauses the cycle until a named reviewer signs off, and no auto-merge can occur while paused.

---

# What ALWAYS Requires Human Approval

These actions are non-autonomous by definition. No agent, orchestrator, mesh cycle, or flag may perform them without explicit human approval. The list is the union of the MASTER_SYSTEM_PROMPT approval list, the `.claude/CLAUDE.md` "User Approval Required For" list, and the mesh Always-Escalate list:

1. **Any change to a product invariant P1-P15** — scoring, XP, anti-cheat, atomic submission, grade format, question quality, bilingual UI, RLS boundary, RBAC enforcement, bundle budget, payment integrity, AI safety, data privacy, review-chain completeness, onboarding integrity.
2. **Pricing or subscription-plan changes** (Razorpay / billing) — Always-Escalate to `ceo`.
3. **AI model or provider changes** — Always-Escalate (model provenance is invariant-adjacent; see P12).
4. **Schema-destructive operations** — `DROP TABLE`, `DROP COLUMN`, or any irreversible data operation. The Content Check hook flags these; the architect requires a compensating-migration plan; the human approves.
5. **RBAC role or permission additions** — any new role/permission, or change to RLS policies or auth middleware. Always-Escalate to `security_lead`.
6. **New CBSE subject additions.**
7. **Changes to the AEOS governance system or the agent system itself** — including `.claude/agents/`, `.claude/CLAUDE.md`, `.claude/skills/`, and the mesh's `agents/prompts/**`, `agents/contracts/**`, `governance/**`.
8. **Production deployment and release tagging**, except where a runbook explicitly authorizes an autonomous step.
9. **Enabling a feature flag for a non-house tenant** (mesh Always-Escalate to `ceo`); flipping `ff_agent_mesh_v1` itself is a governance act.
10. **Pedagogy-logic and learner-facing emotional/ability/socio-economic copy changes** — Always-Escalate to `pedagogy_lead`.
11. **Writing to `lessons_learned`** — only the L8 Memory Curator flow with human approval may.

Autonomous, by contrast, are: bug fixes within existing behavior, test additions, behavior-preserving refactors, documentation updates, feature-flag toggles (house scope), and performance optimizations within the existing architecture — always inside the verification loop and always inside the invariants.

---

# Auditability

Every governed decision must be replayable. The mesh records, on every CriticVerdict, the `rubric_version`, the `rubric_clauses_invoked`, and the full `reasoning` (`critic-verdict.schema.json`); combined with the immutable `cycles` / `tasks` / `cycle_evaluations` tables, any past decision — "why did we approve PR Y in cycle X?" — returns a definitive answer. In the interactive system, the orchestrator's Gate 5 status report and the quality verdict serve the same role, and sensitive operations are written to `audit_logs` (architect security checklist). Auditability is the operational form of Prime Directive 1: trust requires a trail.

---

# Governance Checklist

Confirm each item before reporting any autonomous or multi-agent task complete. Use '-' for each check.

- No agent wrote outside its `guard.sh`-enforced ownership boundary.
- No Bash command was used to bypass a protected-path write.
- The P14 review chain for every changed critical file is complete (every reviewer invoked, read files, gave a verdict).
- All applicable approval gates passed with executed evidence (six gates interactive; evaluators + critic in the mesh).
- No action on the "ALWAYS Requires Human Approval" list was taken without explicit human sign-off.
- Any inter-agent conflict was resolved by the owner / orchestrator / user, never by negotiation against an invariant.
- No product invariant P1-P15 was weakened, bypassed, or reinterpreted.
- Schema-destructive changes, if any, carry user approval and a compensating-migration plan.
- The decision trail is auditable (CriticVerdict rubric stamp, or Gate 5 report + audit_logs).
- `ff_agent_mesh_v1` was not relied upon to lower any governance bar.

If any item fails, the task is not complete and the failure is disclosed.

---

# References

**Core AEOS documents (by number and name):**
- `docs/00_AI_CONSTITUTION.md` — Supreme charter; the rule that invariants and human approval always win.
- `docs/09_SECURITY_PROTOCOL.md` — Least-privilege and security controls the boundaries enforce.
- `docs/25_ARCHITECTURE_DECISIONS.md` — ADR practice for governed architectural change.
- `MASTER_SYSTEM_PROMPT.md` — The "What Requires User Approval" authority list.
- `EXECUTION_ENGINE.md` — RISK/APPROVAL stage and the failure sub-loop.

**Relevant v1.1 playbooks and runbooks:**
- `AEOS/playbooks/ai-evaluation.md` — evaluator design behind the L5 gates.
- `AEOS/runbooks/disaster-recovery.md` — rollback posture for governed-but-failed changes.
- `AEOS/runbooks/supabase-operations.md` — operating the `service_role`-only substrate and migrations.

**Companion v2.0 autonomy documents:**
- `AEOS/autonomy/multi-agent-orchestration.md` — coordination, decomposition, dispatch, gates.
- `AEOS/autonomy/specialized-agents.md` — the roster, ownership, tools, spawn criteria.

**The real substrate (in-tree paths):**
- `.claude/hooks/{guard,bash-guard,review-chain,post-edit-check}.sh` — the four enforcement hooks.
- `.claude/skills/review-chains/SKILL.md` — the full P14 matrix and review-completeness definition.
- `.claude/CLAUDE.md` — Domain Ownership table, P14 summary, "User Approval Required For".
- `.claude/agents/orchestrator.md` — Gate 5 validation, conflict resolution, escalation.
- `agents/README.md` §"Cost & safety guardrails", `agents/prompts/l6-critic.md` (Always-Escalate list), `agents/contracts/critic-verdict.schema.json`, `agents/runtime/sandbox.ts`.
- `supabase/migrations/20260511120000_agent_mesh_foundation.sql` (`ff_agent_mesh_v1`).

---

# Final Directive

Autonomy on Alfanumrik is bounded autonomy. Boundaries are owned by one agent each and enforced in code by four hooks and a sandbox. Review chains are a product invariant, validated at Gate 5 and by the critic. And a fixed list of high-blast-radius actions — invariant changes, pricing, AI model/provider, schema drops, RBAC changes, agent-system edits, production releases — never happens without a human.

Move fast inside the boundaries. Stop at every gate. Escalate every action on the list. When an AEOS rule and a product invariant conflict, the invariant wins; when autonomy reaches a human-approval gate, the human decides. Govern every agent accordingly.

**End of Document**
