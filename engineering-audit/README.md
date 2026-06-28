# Engineering Audit Program

An append-only, traceable knowledge base for taking the Alfanumrik Learning OS to
**enterprise / production quality**. This program audits the **workflows that already
exist** in the platform — it does **not** build new features. Every existing
user-facing and operational workflow is walked through a disciplined lifecycle until
it provably meets a defined completion gate.

This directory complements — and never duplicates — the existing governance assets:

- `.claude/CLAUDE.md` — the 15 product invariants (P1–P15) and the 10-agent system.
- `.claude/regression-catalog.md` — the authoritative regression catalog (142 entries).
- `vitest.config.ts` — authoritative coverage thresholds.
- CI (`.github/workflows/ci.yml`) — the mechanical release gates.

Where those documents are authoritative, this program **references** them rather than
restating them. The audit's job is to find the gap between "exists" and
"enterprise-grade", record it traceably, fix it, and prove the fix.

---

## Purpose

1. Inventory every existing workflow by role (see `feature-inventory/`).
2. Walk each workflow through the per-workflow lifecycle below.
3. Produce traceable artifacts (one folder per workflow cycle under `cycles/`).
4. Drive the codebase toward the completion gate: no broken/empty states, security
   (RLS/RBAC) enforced, invariants P1–P15 upheld, green type-check/lint/test/build,
   quality APPROVE, P14 review chain complete, regression sweep green.

This is a **continuous, session-driven loop**. It is designed to be paused and
resumed across sessions by reading `STATE.md`.

---

## Per-Workflow Lifecycle

Each workflow flows through these phases. Each phase emits an artifact (templates in
`templates/`) into that workflow's cycle folder (`cycles/<cycle>/<workflow>/`).

| # | Phase | Output artifact | Owning squad |
|---|---|---|---|
| 1 | **DISCOVER** | route/feature list confirmed | orchestrator |
| 2 | **UNDERSTAND** | business purpose + user journeys captured | orchestrator + assessment |
| 3 | **MAP** | `01-map.md` — files, APIs, DB tables, data flow | architect + backend |
| 4 | **IDENTIFY GAPS** | `02-gap-analysis.md` — ranked gap table | quality + owning squad |
| 5 | **ROOT CAUSE** | `03-root-cause.md` — why each gap exists | architect + owning squad |
| 6 | **DESIGN** | `04-solution-design.md` — proposed fix per gap | owning squad |
| 7 | **IMPLEMENT** | `05-implementation.md` — change log (links to PRs) | builder squad |
| 8 | **SELF-REVIEW** | `06-self-review.md` — author's own checklist | builder squad |
| 9 | **INDEPENDENT VALIDATION** | `07-validation.md` — separate reviewer verdict | quality |
| 10 | **REGRESSION** | `08-regression.md` — sweep + new catalog entries | testing |
| 11 | **COMPLETE** | `STATUS.md` set to COMPLETE when gate passes | orchestrator |

A workflow is **not** complete until every box on the completion gate
(`templates/STATUS.template.md`) is checked.

---

## Session-Driven Continuous Loop

The program runs as a resumable loop:

```
read STATE.md
  → resume Current workflow at Current phase
  → execute next phase, write its artifact
  → update STATE.md (phase, last session, next action)
  → if workflow COMPLETE → advance to next PRIORITY-BACKLOG item, new cycle entry
  → repeat
```

**How to resume:** open `STATE.md`, read "Next action", continue. That single file is
the loop's program counter. Never rely on memory between sessions — `STATE.md` and the
`cycles/` artifacts are the source of truth.

---

## Squad → Existing Agent Mapping

The audit "squads" are not new agents — they map onto the existing 10-agent system
defined in `.claude/CLAUDE.md`. No new ownership is created.

| Audit squad | Existing agent | Responsibility in audit |
|---|---|---|
| Coordinator | **orchestrator** | Drives the loop, classifies, sequences, owns STATE.md |
| UI squad | **frontend** | Page/component gaps, empty/broken states, a11y, i18n |
| Service squad | **backend** | API routes, queries, webhooks, payment/notification logic |
| Platform squad | **architect** | Schema, RLS, RBAC, auth, middleware, deploy, perf-infra |
| Verification squad | **testing** | Regression sweeps, coverage, E2E, catalog entries |
| Review squad | **quality** | Independent validation, type/lint/build, UX audit, verdict |
| AI squad | **ai-engineer** | Foxy/RAG/LLM workflow correctness, P12 safety |
| Pedagogy squad | **assessment** | Learner-metric correctness, P1–P6 scoring/XP, content QA |
| Operations squad | **ops** | Super-admin, analytics, flags, observability, docs, support |

Review-chain obligations (P14) are unchanged: when a cycle touches a critical file,
the mandatory downstream reviewers from `.claude/skills/review-chains/SKILL.md` still
apply.

---

## Completion-Gate Definition

A workflow cycle reaches **COMPLETE** only when all of the following hold (full
checklist in `templates/STATUS.template.md`):

- [ ] Business goal of the workflow is demonstrably met end-to-end.
- [ ] No broken links, dead buttons, or empty/placeholder states on any path.
- [ ] Accessibility: keyboard nav, labels, contrast, focus states on touched UI.
- [ ] Security: RLS (P8) and RBAC (P9) enforced on every data path touched.
- [ ] Product invariants P1–P15 upheld (no regression introduced).
- [ ] `npm run type-check`, `npm run lint`, `npm test`, `npm run build` all green.
- [ ] Quality agent verdict = **APPROVE**.
- [ ] P14 review chain complete for every critical file touched.
- [ ] Regression sweep green; new catalog entries filed for any new invariant surface.

---

## Index

- [`STATE.md`](./STATE.md) — live loop state (resume here).
- [`PRIORITY-BACKLOG.md`](./PRIORITY-BACKLOG.md) — ranked workflow domains.
- Feature inventory
  - [`feature-inventory/INDEX.md`](./feature-inventory/INDEX.md)
  - [student](./feature-inventory/student.md) ·
    [parent](./feature-inventory/parent.md) ·
    [teacher](./feature-inventory/teacher.md) ·
    [school-admin](./feature-inventory/school-admin.md) ·
    [super-admin](./feature-inventory/super-admin.md) ·
    [cross-cutting](./feature-inventory/cross-cutting.md)
- Templates
  - [`templates/01-map.template.md`](./templates/01-map.template.md)
  - [`templates/02-gap-analysis.template.md`](./templates/02-gap-analysis.template.md)
  - [`templates/03-root-cause.template.md`](./templates/03-root-cause.template.md)
  - [`templates/04-solution-design.template.md`](./templates/04-solution-design.template.md)
  - [`templates/05-implementation.template.md`](./templates/05-implementation.template.md)
  - [`templates/06-self-review.template.md`](./templates/06-self-review.template.md)
  - [`templates/07-validation.template.md`](./templates/07-validation.template.md)
  - [`templates/08-regression.template.md`](./templates/08-regression.template.md)
  - [`templates/STATUS.template.md`](./templates/STATUS.template.md)
- Metrics
  - [`metrics/coverage-trend.md`](./metrics/coverage-trend.md)
- [`cycles/`](./cycles/) — one folder per workflow cycle (artifacts).
- [`workflows/`](./workflows/) — reusable runbooks/automation for the loop.
