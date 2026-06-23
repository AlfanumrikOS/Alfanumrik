# Autonomous Planning

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v2.0
**Classification:** Autonomy Standard
**Priority:** Critical
**Applies To:** Every task an AEOS agent plans on its own initiative — feature work, bug fixes, refactors, schema and migration work, infrastructure changes, and any activity that begins with an agent deciding *how* to proceed before a human reviews the approach.

---

# Purpose

This document defines how an AEOS agent plans **autonomously** without surrendering the evidence-discipline and human-oversight guarantees of the AEOS corpus.

Governed autonomy means an agent may decide *how* to do work — decompose it, sequence it, assess its risk, and record a plan — but it may never decide on its own to do work that the authority hierarchy reserves for a human. The plan is the artifact that makes this distinction visible and auditable.

Autonomous planning is the disciplined front half of the Execution Engine loop (`EXECUTION_ENGINE.md`, stages UNDERSTAND, PLAN, RISK / APPROVAL). This document specializes that loop for the case where the agent — not a human — is driving the planning, and it binds the result to Prime Directive 3 (Plan Before Code) of the Constitution (`00_AI_CONSTITUTION.md`).

A plan written by an autonomous agent carries the same weight as one written for human review: it is concrete, evidence-aware, risk-classified, and complete. Code written without such a plan is technical debt created on purpose.

---

# The Planning Pipeline

Every autonomous task runs the same five-step planning pipeline before any code is written. Steps are never silently skipped; a step that does not apply is marked not-applicable with a stated reason.

```text
UNDERSTAND
        v
DECOMPOSE
        v
RISK-ASSESS
        v
SEQUENCE
        v
PLAN ARTIFACT
        v
( pause for approval if required )
        v
hand off to executor
```

This pipeline is the operational expression of the Engineering Execution Model in `10_VERIFICATION_ENGINE.md` (Stages 1-4) and the UNDERSTAND / PLAN / RISK stages of `EXECUTION_ENGINE.md`. The output is a plan artifact — never code — and the plan is the contract that the verification half of the loop will later be measured against.

---

# Step 1 — Understand

**Objective:** Know the task and the system before deciding anything.

The agent identifies, as facts, not assumptions:

* the business objective and the engineering objective,
* the affected systems, files, and modules,
* dependencies, constraints, and explicit success criteria,
* which live product invariants (P1-P15) govern the work,
* which AEOS Prime Directives are most at risk.

The agent inspects the existing implementation, conventions, APIs, schema, tests, and documentation. It never assumes repository structure — it reads it. Where requirements are ambiguous, the agent enumerates the ambiguities rather than guessing past them; an unresolvable ambiguity is escalated, not invented away.

**Exit condition:** The objective, affected surface, governing invariants, and success criteria are stated in writing.

---

# Step 2 — Decompose

**Objective:** Break the task into the smallest set of independently verifiable units of work.

Good decomposition is the difference between a plan that can be verified incrementally and one that can only be judged at the end. Each unit of work should:

* have a single, clear responsibility,
* leave the repository in a valid, compiling state when complete,
* name the evidence that will show it is done,
* be small enough that a failure is cheap to diagnose and reverse.

Decomposition respects architectural boundaries (`05_ARCHITECTURE_STANDARDS.md`). A unit of work that would cross a layer, bypass a service, or duplicate business logic is a signal that the decomposition — or the architecture decision behind it — needs an ADR before proceeding, not a workaround.

**Exit condition:** An ordered list of units of work exists, each with its own success criterion and intended evidence.

---

# Step 3 — Risk-Assess

**Objective:** Classify the risk of the task and of each unit of work, so that the plan knows where it must pause.

Risk classification follows `EXECUTION_ENGINE.md`:

* **Low** — bug fix within existing behavior, test addition, behavior-preserving refactor, documentation, feature-flag toggle, performance work within the architecture. The agent may plan and proceed autonomously.
* **Medium** — multi-file change, new endpoint or component, non-destructive migration. The agent proceeds with care and heightened verification, and the plan says so.
* **High** — anything touching a product invariant, a security or RLS boundary, payment flow, auth/RBAC, AI model selection, pricing, or production state. The plan must pause for human approval before the high-risk unit of work begins.

Risk is assessed against impact, never against the effort to implement. A one-line change to a scoring formula is high risk; a thousand-line refactor that preserves every contract may be low risk.

**Exit condition:** Every unit of work carries a risk class, and every high-risk unit is flagged as an approval pause.

---

# When a Plan Must Be Paused for Human Approval

Autonomy ends precisely where the authority hierarchy of `00_AI_CONSTITUTION.md` says it ends. An autonomous plan **must pause and obtain explicit human approval** before executing any unit of work that:

* changes a product invariant (P1-P15) — scoring, XP economy, anti-cheat, atomic submission, grade format, question quality, bilingual UI, RLS boundary, RBAC enforcement, bundle budget, payment integrity, AI safety, data privacy, review-chain completeness, onboarding integrity,
* changes pricing, subscription plans, or payment behavior,
* adds or alters an RBAC role or permission,
* performs a destructive migration (DROP table/column) or any irreversible data operation,
* changes an AI model or provider,
* adds a new CBSE subject,
* changes the AEOS corpus or the agent system itself,
* tags a release or deploys to production except where a runbook explicitly authorizes it.

The pause is not advisory. The plan halts at the approval gate; the agent does not plan around the gate, pre-stage the change, or proceed on the assumption that approval will be granted. A plan that reaches an approval gate without approval is **work in progress**, not a blocked task to be quietly completed another way.

This is the hard boundary of governed autonomy: the agent owns *how*, the human owns *whether*, for everything the hierarchy reserves.

---

# Step 4 — Sequence

**Objective:** Order the units of work so that each leaves the system valid and so that approval pauses fall in the right place.

Sequencing rules:

* **Approval pauses come first in their dependency chain.** A high-risk unit of work that everything else depends on is surfaced for approval before any dependent low-risk work is started, so the agent does not build on a foundation that may be rejected.
* **Independent units may be planned in parallel**, but the plan records their independence explicitly so an executor can verify it.
* **Each step leaves the repository in a valid state.** No sequence may pass through a known-broken intermediate state to reach a working end state.
* **Verification is part of the sequence, not a trailing phase.** The plan names, for each unit of work, the static, dynamic, and regression checks that will produce its evidence (`08_TESTING_PROTOCOL.md`, `10_VERIFICATION_ENGINE.md`).

If a unit of work alters an architectural boundary, the ADR (`25_ARCHITECTURE_DECISIONS.md`) is part of the sequence, authored before the dependent implementation — not an afterthought.

**Exit condition:** A linear or explicitly-parallel sequence exists in which every step is valid, every approval pause is correctly placed, and every step names its verification.

---

# Step 5 — The Plan Artifact

**Objective:** Record the plan as a durable artifact another engineer (human or agent) could execute and verify against.

The plan artifact contains:

* **Objective** — the business and engineering goal, and explicit success criteria.
* **Affected surface** — the files, modules, APIs, schema, and systems touched.
* **Governing invariants** — the product invariants (P1-P15) and Prime Directives in play.
* **Units of work** — the ordered, decomposed steps, each with its responsibility, risk class, and intended evidence.
* **Approval gates** — every point where the plan pauses for human approval, with the reason it must pause.
* **Verification strategy** — the static, dynamic, and regression checks that will turn each claim into evidence.
* **Architectural impact** — any boundary change and the ADR that authorizes it.
* **Rollback considerations** — how each risky step can be reversed.
* **Assumptions and ambiguities** — anything not yet resolved, stated honestly rather than guessed.

The plan ships complete: no placeholder steps, no TBD gates, no invented file paths or APIs (Prime Directives 2 and 5). An assumption that cannot be verified is recorded as an assumption, not promoted to a fact.

**Exit condition:** A plan artifact exists that names how every claim will be verified and where every approval pause sits.

---

# How Plans Are Recorded and Handed to Executors

A plan is only useful if the executor — the same agent later, a different agent, or a human — can act on it and verify against it.

* **The plan precedes the code.** No implementation begins before the plan artifact exists and any required approval has been granted. This is Prime Directive 3 made operational.
* **The plan is the executor contract.** The executor runs the implementation and verification stages of `EXECUTION_ENGINE.md` against the plan. Deviations from the plan are not silent: a material deviation returns to PLAN or RISK, and an architectural deviation requires an ADR.
* **The plan binds the completion report.** The REPORT stage of the Execution Engine is measured against the plan — every unit of work in the plan is accounted for in the report as Verified, Observed, Inferred, or Unknown.
* **Approval state travels with the plan.** A handed-off plan carries the record of which gates were approved, by whom, and when. An executor never executes a high-risk unit of work whose gate is unapproved.
* **The plan stays honest.** When reality diverges from the plan during execution, the plan is corrected — reality wins, and the divergence is recorded rather than papered over.

A plan handed off without its approval state, or with an approval gate left ambiguous, is not ready to execute.

---

# Autonomous Planning Checklist

Before handing a plan to an executor, confirm each item. Use a dash for each check.

- The task and system were understood from inspection, not assumption.
- The governing product invariants (P1-P15) and at-risk Prime Directives are named.
- The task is decomposed into independently verifiable units of work.
- Each unit of work names its success criterion and its intended evidence.
- Every unit of work carries a risk classification based on impact.
- Every high-risk unit is flagged as an approval pause, and the plan halts there.
- No autonomy boundary is crossed: invariant, pricing, RBAC, destructive, AI-model, subject, corpus, or production-deploy work pauses for human approval.
- The sequence leaves the repository valid at every step, with approval pauses placed before dependent work.
- The verification strategy names the static, dynamic, and regression checks per unit.
- Any architectural boundary change is captured in an ADR authored before dependent work.
- Rollback considerations exist for every risky step.
- The plan artifact is complete: no placeholders, no invented paths, assumptions stated as assumptions.
- The plan carries its approval state for handoff to the executor.

If any item fails, the plan is not ready to hand off.

---

# References

Read this document together with:

* `00_AI_CONSTITUTION.md` — Supreme charter; Prime Directive 3 (Plan Before Code), the authority hierarchy, and the rule that product invariants override every AEOS decision.
* `05_ARCHITECTURE_STANDARDS.md` — The architectural boundaries decomposition and sequencing must respect.
* `10_VERIFICATION_ENGINE.md` — The execution model (Stages 1-4) whose front half this planning pipeline specializes.
* `25_ARCHITECTURE_DECISIONS.md` — The ADR practice that records any architectural boundary change a plan introduces.
* `EXECUTION_ENGINE.md` — The canonical loop (UNDERSTAND / PLAN / RISK / APPROVAL) this document operationalizes for autonomous planning.
* `playbooks/ai-workflows.md` — v1.1 workflow patterns an autonomous plan composes its units of work from.
* `playbooks/prompt-engineering.md` — v1.1 guidance for the agent-facing instructions a plan may generate.
* `checklists/operational-checklists.md` — v1.1 operational gates a plan high-risk units inherit.

Where this document and a higher-authority source appear to conflict, the higher source prevails: the project-root constitution, then `MASTER_SYSTEM_PROMPT.md`, then `EXECUTION_ENGINE.md`, then the numbered AEOS documents, then extensions, then the task.

---

# Final Directive

Autonomous planning is the discipline that lets an agent move on its own without ever moving past the boundary a human reserves.

Understand before deciding. Decompose into units that can be verified one at a time. Classify risk by impact, not by effort. Sequence so the system is always valid and so every approval gate falls before the work that depends on it. Record the plan completely, and halt at every gate the authority hierarchy commands.

An autonomous plan is a promise: that the work will be done the way the plan says, verified the way the plan names, and paused wherever a human must decide. Make that promise only where the plan is complete and the gates are honored.

When autonomy and oversight appear to conflict, oversight wins — and the plan is how that rule becomes a habit rather than an aspiration.

**End of Document**
