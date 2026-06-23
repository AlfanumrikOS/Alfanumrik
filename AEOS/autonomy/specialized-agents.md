# Specialized Agents

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v2.0
**Classification:** Autonomy/Governance Standard
**Priority:** P1 (Defines the agent roster and spawn criteria; subordinate to the live product invariants P1-P15, the Constitution, the MASTER_SYSTEM_PROMPT, and the EXECUTION_ENGINE)
**Applies To:** Every agent that builds, verifies, or operates the Alfanumrik platform under AEOS — the 10 interactive `.claude` agents and the L4 execution-swarm roles in the root `agents/` mesh.

---

# Purpose

This document is the roster. It names every specialized engineering agent on the Alfanumrik platform, states what each owns, what tools each holds, and the exact criteria that trigger spawning it. It binds the abstract role identity in `docs/01_ROLE_DEFINITION.md` to the concrete `.claude` agent definitions and the Domain Ownership table in `.claude/CLAUDE.md`, and it maps those onto the L4 swarm roles enumerated in `agents/README.md`.

The roster is not advisory. Ownership-by-path is enforced mechanically by `.claude/hooks/guard.sh` (Write Guard) and `.claude/hooks/bash-guard.sh` (Bash Guard). An agent that writes outside its domain is blocked, not warned. This document explains who owns what and why, so that the orchestrator spawns the minimum correct set and no agent reaches past its boundary.

---

# Roster Overview

Ten interactive agents, grouped by function. The orchestrator is the default session agent; it never writes application code, only routes and gates.

| Group | Agents |
|---|---|
| Coordinator | orchestrator |
| Builders | architect, frontend, backend, assessment, ai-engineer, mobile |
| Verifiers | testing, quality |
| Operator | ops |

Each agent definition lives at `.claude/agents/<name>.md` and declares its `tools` and `skills` in front-matter. The Domain Ownership table (`.claude/CLAUDE.md`) maps 30+ engineering domains onto these agents with explicit owner/reviewer/approver columns.

---

# The Coordinator

## orchestrator
- **Definition:** `.claude/agents/orchestrator.md` · **Tools:** Read, Glob, Grep, Bash, Agent · **Skills:** release-gates, review-chains, architecture.
- **Owns:** Classification, decomposition, dispatch, gate enforcement, status reporting, and cross-portal contract validation. Owns nothing in `src/` — it delegates all writes.
- **Spawn criteria:** Always. It is the default session agent (`.claude/settings.json`). Every request enters here.
- **Mesh counterpart:** L1 Meta-Orchestrator (`agents/prompts/l1-meta-orchestrator.md`) for "which problem" and L2 Task Orchestrator (`agents/prompts/l2-task-orchestrator.md`) for "which tasks."

---

# The Builders

## architect
- **Definition:** `.claude/agents/architect.md` · **Tools:** Read, Glob, Grep, Bash, Edit, Write · **Skills:** supabase-patterns, release-gates.
- **Owns (exclusive):** `supabase/migrations/`, `src/middleware.ts` (a.k.a. `src/proxy.ts` under Next.js 16), `src/lib/rbac.ts`, `src/lib/admin-auth.ts`, `src/lib/supabase-admin.ts`, `src/lib/supabase-server.ts`, `.github/workflows/`, `vercel.json`, `next.config.js`.
- **Spawn criteria:** task mentions database, migration, schema, RLS, RBAC, auth, middleware, deploy, or CI (`.claude/CLAUDE.md` Agent Selection table).
- **Mesh counterpart:** `schema_agent` — the ONLY L4 role whose `allowed_paths` may include `supabase/migrations/**`; every other role lists it in `forbidden_paths` (`agents/prompts/l2-task-orchestrator.md` hard rule). The blast-radius firewall is `agents/runtime/sandbox.ts`.

## frontend
- **Definition:** `.claude/agents/frontend.md` · **Tools:** Read, Glob, Grep, Bash, Edit, Write.
- **Owns:** `src/app/*/page.tsx`, `src/components/`, `src/lib/AuthContext.tsx`, `src/lib/swr.tsx`, `src/lib/types.ts`, `public/`. Coordinates on `mobile/` (but does not own Dart).
- **Spawn criteria:** task mentions page, component, UI, styling, layout, Tailwind, loading state, or i18n.
- **Mesh counterpart:** `ux_agent` (components, tokens, Tailwind) and the `code_agent` for non-schema app code.

## backend
- **Definition:** `.claude/agents/backend.md` · **Tools:** Read, Glob, Grep, Bash, Edit, Write.
- **Owns:** `src/app/api/`, `src/lib/razorpay.ts`, non-AI Edge Functions (`supabase/functions/{daily-cron,queue-consumer,send-*,session-guard,scan-ocr,export-report}/`).
- **Spawn criteria:** task mentions API route, endpoint, webhook, payment, Razorpay, notification, or cron.
- **Mesh counterpart:** `code_agent` (API routes) and `devops_agent` (CI / flags / observability wiring) for the non-AI server surface. Payment code is guarded to `backend` only (`guard.sh` Rule 6, P11).

## assessment
- **Definition:** `.claude/agents/assessment.md` · **Tools:** Read, Glob, Grep, Bash, Edit, Write.
- **Owns:** `src/lib/xp-rules.ts`, `src/lib/exam-engine.ts`, `src/lib/cognitive-engine.ts`, `src/lib/feedback-engine.ts`, and question-bank quality.
- **Spawn criteria:** task mentions score, XP, quiz logic, Bloom's, CBSE, exam, grading, mastery, or question bank.
- **Mesh counterpart:** `pedagogy_agent` (writes specs in `docs/architecture/`; `code_agent` implements) and `content_agent` (lesson/question/hint content). Scoring files are guarded to `assessment` only (`guard.sh` Rule 4, P1-P4).

## ai-engineer
- **Definition:** `.claude/agents/ai-engineer.md` · **Tools:** Read, Glob, Grep, Bash, Edit, Write.
- **Owns:** AI Edge Functions (`supabase/functions/{foxy-tutor,ncert-solver,quiz-generator,cme-engine}/`), `supabase/functions/_shared/`, RAG, prompts, BKT/IRT implementation.
- **Spawn criteria:** task mentions Foxy, AI tutor, NCERT solver, RAG, prompt, Claude API, or cme-engine.
- **Mesh counterpart:** the AI-surface slice of `code_agent` plus `content_agent` for AI-callable content. AI functions are guarded to `ai-engineer` (`guard.sh` Rule 5, P12); any AI-callable prompt change is Always-Escalate at L6.

## mobile
- **Definition:** `.claude/agents/mobile.md` · **Tools:** Read, Glob, Grep, Bash, Edit, Write.
- **Owns:** `mobile/` (all Flutter/Dart files), Riverpod state, Play Store compliance, and mobile-web API contract sync.
- **Spawn criteria:** task mentions mobile, Flutter, Dart, Play Store, or mobile sync; also spawned downstream whenever an XP/scoring/payment/schema change touches a mobile-dependent table.
- **Mesh counterpart:** no dedicated L4 role yet — mobile parity is a downstream review obligation enforced by the review chains. `mobile/` is guarded to `mobile` only (`guard.sh` Rule 9).

---

# The Verifiers

## testing
- **Definition:** `.claude/agents/testing.md` · **Tools:** Read, Glob, Grep, Bash, Edit, Write.
- **Owns:** `src/__tests__/`, `e2e/`, `vitest.config.ts`, `playwright.config.ts`, and the regression catalog gap accounting.
- **Spawn criteria:** spawned after every change (orchestrator §Step 2), and whenever a task mentions test, coverage, regression, E2E, Vitest, or Playwright.
- **Mesh counterpart:** the L5 Evaluation Layer (`unit_tests`, `type_check`, `lint`, and the conditional evaluators in `agents/README.md`). Evidence discipline: a test that did not run is reported as a gap, never as a pass (Prime Directive 1).

## quality
- **Definition:** `.claude/agents/quality.md` · **Tools:** Read, Glob, Grep, Bash.
- **Owns:** Code readability, duplication, type safety, lint/build health, architecture conformance, UX audit, and the final pre-commit verdict. Read-only — it reviews, it does not write application code.
- **Spawn criteria:** spawned before every commit (orchestrator §Step 2), and whenever a task mentions review, type-check, lint, build quality, code quality, or UX audit.
- **Mesh counterpart:** the L6 Critic (`agents/prompts/l6-critic.md`) — the adversarial reviewer that applies the decision tree and writes the auditable verdict.

---

# The Operator

## ops
- **Definition:** `.claude/agents/ops.md` · **Tools:** Read, Glob, Grep, Bash, Edit, Write.
- **Owns:** `src/app/super-admin/`, `src/app/api/super-admin/` (business requirements; backend implements queries), `src/lib/feature-flags.ts`, `src/lib/logger.ts`, `src/lib/analytics.ts`, `docs/`, and Sentry configs.
- **Spawn criteria:** task mentions super admin, analytics, feature flag, monitoring, docs, or support ticket.
- **Mesh counterpart:** `devops_agent` (CI, feature flags, canary, observability) and the L7 Deploy + Feedback / L8 outcome-analysis surfaces. Super-admin pages/APIs carry a shared-ownership warning (`guard.sh` Rules 10a/10b): frontend/backend implement, ops reviews.

---

# Ownership-to-Mesh Crosswalk

The interactive roster and the L4 swarm are two expressions of one ownership model. The crosswalk:

| Interactive agent | L4 swarm role(s) | Hard boundary |
|---|---|---|
| architect | `schema_agent` | Only role allowed in `supabase/migrations/**` |
| frontend | `ux_agent`, `code_agent` (UI) | No logic/data-layer/migration edits from `ux_agent` |
| backend | `code_agent` (API), `devops_agent` | No migration edits; payment is backend-only |
| assessment | `pedagogy_agent`, `content_agent` | Pedagogy specs precede implementation, never bundled |
| ai-engineer | `code_agent` (AI), `content_agent` | AI-callable change is Always-Escalate |
| mobile | (downstream review) | `mobile/**` mobile-only |
| testing | L5 evaluators | A non-run evaluator is `skipped`, not `pass` |
| quality | L6 Critic | Adversarial; reads the diff, never approves on summary alone |
| ops | `devops_agent`, L7/L8 surfaces | Flag/doc/monitoring ownership |
| orchestrator | L1 + L2 | Routes and gates; writes no app code |

`evolution_agent` (owner of `agents/prompts/**`, `agents/contracts/**`, `governance/**`) and `i18n_agent` (Hindi/regional parity) are mesh-only roles with no standalone interactive counterpart; in Substrate A their concerns are handled by the orchestrator (agent-system changes, always human-approved) and frontend/assessment (bilingual parity, P7).

---

# Spawn Discipline

The orchestrator spawns the **minimum** correct set, never the maximum convenient one (least privilege, Prime Directive 6 applied to agent dispatch).

1. **Classify against the routing table** (`.claude/agents/orchestrator.md`). One primary owner per affected path; reviewers added per the P14 matrix.
2. **Parallelize independents.** Disjoint-file builders run in one message; only dependencies are sequenced.
3. **Background read-only research; foreground all writes** and any result that gates the next step.
4. **Never let two agents claim one file.** Resolve ownership before execution; the owning agent in `.claude/CLAUDE.md` has final say.
5. **Spawn the downstream reviewers the change requires** — testing appears in every chain; mobile, frontend, backend, assessment, ai-engineer, ops as the matrix dictates.
6. **Do not invent a role.** If a new specialist seems needed, raise it (L2 → L1 memo in the mesh; orchestrator → user for the interactive system). Dispatching to a role with no prompt is forbidden.

---

# Agent Roster Checklist

Before execution begins, confirm each item. Use '-' for each check.

- The correct primary owner was selected for every affected path.
- No path has two claimed owners; contested ownership was resolved first.
- Only the minimum required agents were spawned (least privilege).
- Independent builders were parallelized; dependents were sequenced.
- testing is queued after the builders; quality is queued before commit.
- Every P14 downstream reviewer required by the changed files was spawned.
- Mobile was added downstream if an XP/scoring/payment/schema change touches a mobile table.
- For mesh work: each L4 task names exactly one `agent_role` with non-empty allowed/forbidden paths.
- No agent was asked to write outside its `guard.sh`-enforced domain.
- No new role was invented without escalation.

If any item fails, fix the dispatch plan before writing code.

---

# References

**Core AEOS documents (by number and name):**
- `docs/00_AI_CONSTITUTION.md` — Creed, Prime Directives, least-privilege.
- `docs/01_ROLE_DEFINITION.md` — Engineering identity each agent enacts.
- `docs/03_REPOSITORY_RULES.md` — Repository structure and ownership conventions.
- `MASTER_SYSTEM_PROMPT.md` — Principal-Engineer persona and approval gates.

**Relevant v1.1 playbooks and runbooks:**
- `AEOS/playbooks/prompt-engineering.md` — versioned prompt discipline for `agents/prompts/`.
- `AEOS/playbooks/ai-workflows.md` — composing AI-surface agent work.
- `AEOS/runbooks/sre.md` — operational ownership for the ops/devops surface.

**Companion v2.0 autonomy documents:**
- `AEOS/autonomy/multi-agent-orchestration.md` — how the roster coordinates.
- `AEOS/autonomy/agent-governance.md` — boundary enforcement, hooks, and approval gates.

**The real substrate (in-tree paths):**
- `.claude/agents/{orchestrator,architect,frontend,backend,assessment,ai-engineer,mobile,testing,quality,ops}.md`.
- `.claude/CLAUDE.md` — Domain Ownership table (30+ domains → 9 agents) and Agent Selection table.
- `.claude/hooks/guard.sh`, `.claude/hooks/bash-guard.sh` — mechanical ownership enforcement.
- `agents/README.md` §"The execution swarm (L4) roles" and §"The evaluators (L5)".
- `agents/prompts/{l1-meta-orchestrator,l2-task-orchestrator,l4-code-agent,l6-critic}.md`, `agents/contracts/task-assignment.schema.json`, `agents/runtime/sandbox.ts`.

---

# Final Directive

The roster exists so that work always lands with the agent who owns it and the judgment that goes with it. Ten interactive agents and the L4 swarm are two faces of one ownership model, enforced in code by `guard.sh` and `sandbox.ts`. Spawn the minimum set. Respect every boundary. Add the reviewers the change demands. Never invent a role to route around a rule.

Right agent, right path, right review — every time.

**End of Document**
