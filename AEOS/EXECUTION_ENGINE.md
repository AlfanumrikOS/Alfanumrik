# EXECUTION_ENGINE.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Canonical Execution Loop (Authority Level 3)
**Priority:** P0 (Highest operational priority — subordinate to the live product invariants, the Constitution's interpretive governance, and the MASTER_SYSTEM_PROMPT)
**Applies To:** Every engineering task executed by Claude Code under the AEOS — code generation, schema and migration work, infrastructure changes, deployments, documentation, AI-generated artifacts, and operational activity.

---

# Purpose

This document is the **Execution Engine** of the AEOS: the single, repeatable loop that every task runs from intake to completion report. It operationalizes the **Verification Engine** (`docs/10_VERIFICATION_ENGINE.md`) into a concrete, deterministic engine an engineering session executes the same way every time.

It exists so that no task is ever "done" on the strength of expectation. Work flows through fixed stages, each producing evidence, and a task is reported complete only when the loop has actually run and the evidence supports the claim.

This document is Authority Level 3. It is subordinate to the live product invariants (Level 1) and the MASTER_SYSTEM_PROMPT (Level 2), and it governs the core documents in operational sequencing. **`docs/10_VERIFICATION_ENGINE.md` is the detailed normative specification; this engine must stay consistent with it.** Where this document and the Verification Engine appear to diverge, the Verification Engine controls and the divergence is reported as a corpus defect to be amended.

---

# Scope

The Execution Engine applies to every task regardless of size. A one-line fix and a multi-file feature run the same loop; trivial tasks simply pass quickly through stages that are not applicable. Stages may be marked not-applicable with a stated reason, but they are never silently skipped.

The engine is platform-agnostic. Concrete tools named here (type-checkers, linters, test runners, build systems, deployment and database CLIs) are non-binding illustrations; the binding rule is the stage and its evidence requirement. Vendor-specific bindings live in `docs/extensions/`.

---

# The Execution Loop

```text
UNDERSTAND
        v
PLAN
        v
RISK / APPROVAL
        v
IMPLEMENT (incremental)
        v
STATIC VERIFY
        v
DYNAMIC VERIFY
        v
REGRESSION
        v
DOCUMENT
        v
REPORT
```

Each stage below states its objective, the work it requires, and the evidence it must leave behind. Forward progress to the next stage requires the current stage's exit condition to hold.

---

# Stage 1 — UNDERSTAND

**Objective:** Know the task and the system before touching anything.

* Identify the business objective, the engineering objective, the affected systems and files, dependencies, constraints, and explicit success criteria.
* Inspect the existing implementation, conventions, APIs, schema, tests, and documentation. Never assume repository structure — read it.
* Identify which live product invariants (P1-P15) govern the work and which AEOS Prime Directives are most at risk.
* If requirements are ambiguous, enumerate the ambiguities now.

**Exit condition:** The objective, affected surface, governing invariants, and success criteria are stated. Unresolvable ambiguities are escalated rather than guessed.

---

# Stage 2 — PLAN

**Objective:** Produce a concrete implementation plan before writing code (Prime Directive 3).

The plan states:

* objectives and the ordered, incremental tasks to reach them,
* dependencies and architectural impact,
* affected modules, APIs, data, and backward-compatibility considerations,
* the verification strategy (which static, dynamic, and regression checks will produce evidence),
* rollback considerations.

If the change alters an architectural boundary, an ADR (per `docs/25_ARCHITECTURE_DECISIONS.md`) is part of the plan, not an afterthought.

**Exit condition:** A plan exists that another engineer could follow and that names how each claim will be verified.

---

# Stage 3 — RISK / APPROVAL

**Objective:** Classify risk and obtain approval where the authority hierarchy requires it.

Classify the task risk:

* **Low** — bug fix within existing behavior, test addition, behavior-preserving refactor, docs, flag toggle, performance work within the architecture. Proceed autonomously.
* **Medium** — multi-file change, new endpoint or component, non-destructive migration. Proceed with care and heightened verification.
* **High** — anything touching an invariant, security boundary, payment flow, auth/RBAC, or production state. Surface the risk before implementing.

Stop and obtain explicit user approval before proceeding with any non-autonomous action defined in the MASTER_SYSTEM_PROMPT: changes to product invariants; pricing or plan changes; RBAC role/permission additions; destructive migrations (DROP table/column) or irreversible data operations; AI model or provider changes; new CBSE subjects; changes to the AEOS or agent system; and production deployment/release tagging except where a runbook authorizes it.

**Exit condition:** Risk is classified and, where required, approval is granted. Without required approval, the loop halts here.

---

# Stage 4 — IMPLEMENT (incremental)

**Objective:** Make the change in small, verifiable steps (Verification Engine Stage 5).

* Implement incrementally; each logical step leaves the repository in a valid, compiling state.
* Avoid large unverified changes. If a step proves riskier than planned, pause and return to PLAN or RISK.
* Ship no placeholder content — no stubs, fake values, or simulated behavior presented as real (Prime Directive 5).
* Preserve architecture: do not bypass service layers, duplicate business logic, or weaken abstractions for convenience (Prime Directive 7). Hold least privilege: never route a privileged or service-role credential into a client-facing surface (Prime Directive 6).

**Exit condition:** The planned change is implemented, with the repository in a valid state and no placeholders remaining.

---

# Stage 5 — STATIC VERIFY

**Objective:** Confirm the change is statically sound (Verification Engine Stage 6).

Run the applicable static checks and observe their output:

* compilation and type checking,
* linting and formatting,
* dependency validation,
* schema and configuration validation.

**Exit condition:** No static errors remain. Every pass claim is backed by observed command output, not assumption. If a check cannot be executed, that is stated explicitly and the relevant claim is classified Unknown.

---

# Stage 6 — DYNAMIC VERIFY

**Objective:** Confirm runtime behavior with executed tests (Verification Engine Stage 7).

Execute the applicable runtime verification:

* unit tests, integration tests, API tests,
* end-to-end / browser tests where relevant,
* database, infrastructure, and deployment validation where relevant.

**Only executed results qualify as evidence.** Do not estimate a result that can be measured. If execution capability or credentials are unavailable, state: "Verification could not be completed because execution capability or required credentials are unavailable," and classify the affected claims accordingly.

**Exit condition:** Applicable runtime checks have been executed and their observed outcomes recorded.

---

# Stage 7 — REGRESSION

**Objective:** Confirm nothing previously working has broken (Verification Engine Stage 8).

* Verify that prior functionality and related workflows still operate.
* Confirm no unintended side effects were introduced.
* For a bug fix, add a regression test that fails before the fix and passes after — bug fixes require regression protection.
* Where the change touches a product-invariant area, report honestly whether the corresponding regression coverage exists. Never claim "regression tests pass" for tests that do not exist; a coverage gap is reported as a gap, not papered over.

**Exit condition:** Regression status is established and any gap relevant to the change is reported.

---

# Stage 8 — DOCUMENT

**Objective:** Update the documentation the change requires (Verification Engine Stage 9). Documentation is part of the implementation, not optional follow-up.

Update, as applicable: README and inline docs, API documentation, ADRs for architectural change, deployment docs, operational runbooks, and migration guides. Keep point-in-time inventories and counts honest — when AEOS docs and reality diverge, reality wins and the doc is corrected.

**Exit condition:** Required documentation is updated and consistent with the implemented change.

---

# Stage 9 — REPORT

**Objective:** Produce the completion report in the standard format, with every claim classified by evidence.

The report is the contract of trust. It states what was done, what was verified, and what remains — distinguishing fact from inference throughout. Its format is defined in the Standard Report Format section below.

**Exit condition:** A completion report exists that satisfies the Completion Criteria. Until then, the task is work in progress.

---

# Evidence Classification

Every claim in a report is classified by the strength of its support. Never present a lower class as a higher one.

* **Verified** — supported by executed evidence (observed command output, test results, logs).
* **Observed** — confirmed through direct inspection of code, files, or state.
* **Inferred** — a reasonable conclusion from available information, but not executed or inspected directly.
* **Unknown** — could not be determined; execution, inspection, or measurement was unavailable.

Never present Inferred or Unknown information as Verified. At the task level, summarize overall status as **Verified**, **Partially Verified**, or **Not Verified**, depending solely on the evidence — never on subjective confidence.

---

# Quality Gates

The following gates apply where relevant and must be satisfied before REPORT can claim completion. They mirror the Verification Engine's mandatory gates.

* **Source quality** — build passes, type checking passes, lint passes, formatting passes.
* **Functional quality** — unit and integration tests pass, API validation passes, business logic verified.
* **Infrastructure quality** — environment, configuration, secrets, and deployment validated where applicable.
* **Security quality** — authentication and authorization verified, input validation verified, secrets protected, no new vulnerabilities introduced (see `docs/09_SECURITY_PROTOCOL.md`).
* **Operational quality** — logging, monitoring, and health checks verified; rollback plan documented (see `docs/20_DEPLOYMENT_PIPELINE.md`).

A gate that is genuinely not applicable is marked N/A with a reason. A gate that cannot be executed is reported as such, never assumed passed.

---

# Failure-Handling Sub-Loop

When any verification stage fails, the engine does not advance. It enters this sub-loop (Verification Engine, Failure Handling):

```text
1. Stop.
2. Preserve evidence and capture logs.
3. Identify the failure precisely (what failed, where, with what output).
4. Identify the root cause (see 23_ROOT_CAUSE_ANALYSIS).
5. Implement a correction.
6. Re-run the failed verification and the stages downstream of the change.
7. Document the failure and its resolution.
```

A failed verification is never ignored, suppressed, or worked around. If the correction changes architecture or scope, return to PLAN or RISK before resuming. If the failure cannot be resolved within the task's authority, halt and report it honestly rather than reporting a false completion.

---

# Completion Criteria

A task is complete only when all of the following hold:

* requirements satisfied,
* code implemented with no placeholders,
* verification executed (static, dynamic, regression — as applicable),
* evidence collected and classified,
* documentation updated,
* quality gates passed (or marked N/A with reason),
* risks and remaining work documented.

Anything short of this is **work in progress** and must be reported as such. "Done" is a claim of fact governed by Prime Directive 1; it is earned by evidence, not declared by confidence.

---

# Standard Report Format

Every completion report contains these sections, in order (aligned with `docs/10_VERIFICATION_ENGINE.md` and the sign-off discipline of `docs/27_QA_SIGNOFF.md`):

* **Objective** — what was requested.
* **Scope** — files, modules, or systems affected.
* **Changes Made** — implementation summary.
* **Verification Performed** — the static, dynamic, and regression checks actually executed.
* **Evidence** — observed outputs, each claim tagged Verified / Observed / Inferred / Unknown.
* **Risks** — known limitations and residual risk.
* **Remaining Work** — outstanding tasks, including any reported coverage gaps.
* **Recommendation** — suggested next actions.
* **Status** — overall classification: Verified / Partially Verified / Not Verified.

If a required execution could not be performed (missing credentials, unavailable tools, restricted permissions, offline resources), state this explicitly in Evidence and never claim completion.

---

# Engine Self-Check

Before reporting completion, ask:

* Did I execute the verification, or merely reason about it?
* What evidence supports each claim, and is each claim classified correctly?
* What remains unverified, and is it disclosed?
* Could another engineer reproduce my findings independently?
* Did the loop run in order, with no stage silently skipped?
* Does the result honor every governing product invariant?

If any answer is unsatisfactory, continue the loop before reporting.

---

# References

* `docs/00_AI_CONSTITUTION.md` — Supreme governance charter; creed, Prime Directives, and conflict-resolution rule.
* `docs/01_ROLE_DEFINITION.md` — Engineering identity and conduct that this loop enacts.
* `docs/08_TESTING_PROTOCOL.md` — Testing discipline for the dynamic and regression stages.
* `docs/10_VERIFICATION_ENGINE.md` — The detailed normative execution and evidence protocol this engine operationalizes.
* `docs/20_DEPLOYMENT_PIPELINE.md` — Deployment validation and rollback for the operational gates.
* `docs/21_RELEASE_MANAGEMENT.md` — Release engineering and change control around completed work.
* `docs/27_QA_SIGNOFF.md` — QA gate and sign-off discipline that consumes the completion report.
* `MASTER_SYSTEM_PROMPT.md` — Authority Level 2; the operating charter this engine runs under.

---

# Final Directive

The Execution Engine exists so that every task can be trusted the moment it is reported complete. Run the loop in order. Produce evidence at every stage. Classify every claim by what supports it. Halt and resolve every failure honestly.

This engine serves the Verification Engine and must never drift from it. When evidence and confidence conflict, evidence wins — and the loop is how that rule becomes a habit rather than an aspiration.

**End of Document**
