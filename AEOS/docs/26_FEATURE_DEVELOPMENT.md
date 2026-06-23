# 26_FEATURE_DEVELOPMENT.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Mandatory Feature Development Standard
**Priority:** P0 (Critical)
**Applies To:** Every new feature, enhancement, and user-facing capability delivered to the Alfanumrik platform.

---

# Purpose

This document defines the lifecycle that every feature must follow from initial idea to monitored production behavior.

A feature is not a code change. A feature is a complete unit of value that has been specified, designed, implemented, tested, reviewed, released, and observed in production. Code that compiles is not a feature; it is one stage of one.

Claude Code shall treat feature development as a disciplined lifecycle with explicit entry and exit criteria at each stage, not as an open-ended coding activity.

---

# Engineering Philosophy

Features exist to deliver measurable value. A feature without measurable value should not be built.

Every feature must increase one or more of: learning effectiveness, teacher productivity, student engagement, operational efficiency, decision intelligence, or scalability.

A feature is built in thin vertical slices that each deliver working, verifiable value, not in horizontal layers that deliver nothing until the last one lands.

A feature is complete only when it is observable in production and known to behave correctly there.

---

# The Feature Lifecycle

Every feature flows through the following stages in order:

```
idea
  v
requirements / spec
  v
design
  v
implementation
  v
test
  v
review
  v
release
  v
monitor
```

A stage may not be skipped. A stage may loop back to an earlier stage when new information invalidates prior assumptions. Progress is gated by explicit criteria, not by elapsed effort.

---

# Stage 1: Idea

Every feature begins as a problem statement, not a solution.

Capture:

- the user or business problem,
- the affected user persona (student, parent, teacher, administrator),
- the value hypothesis (what improves and how it is measured),
- the rough scope and the explicit non-goals.

Reject ideas that duplicate existing functionality, add maintenance burden without measurable value, or weaken reliability or security.

---

# Stage 2: Requirements And Specification

The idea is converted into a written specification before any design or code.

A specification states:

- the problem and the value hypothesis,
- functional requirements,
- non-functional requirements (performance, security, accessibility, bilingual support),
- acceptance criteria,
- explicit out-of-scope items,
- affected product invariants,
- required approvals.

A feature that touches a product invariant (score accuracy, XP economy, anti-cheat, grade format, payment integrity, data privacy, and the rest) must name the invariant and confirm it is preserved. Changes to an invariant require explicit user approval before the feature proceeds.

---

# Definition Of Ready

A feature may not enter implementation until it is Ready. The Definition of Ready is satisfied when:

- The problem and value hypothesis are written.
- Acceptance criteria are explicit and testable.
- Affected product invariants are identified and confirmed preserved.
- Cross-functional impact is identified (API, data, UI, docs, tests).
- Required schema or RBAC changes are identified and routed to the owning domain.
- Required approvals are obtained for any invariant, pricing, RBAC, or subject change.
- The vertical slices are defined.

A feature that is not Ready is sent back to specification, not started.

---

# Stage 3: Design

Design establishes how the feature will be built within existing architectural boundaries.

Design considers:

- the API contract (request and response shapes, errors, versioning),
- the data model (tables, columns, indexes, RLS policies),
- the UI surface and its states (loading, empty, error, success),
- backward compatibility,
- failure modes and graceful degradation,
- observability (what will be logged and measured).

Significant design decisions are captured as ADRs per `25_ARCHITECTURE_DECISIONS`. Design must respect the architecture standards in `05_ARCHITECTURE_STANDARDS`; it may not bypass service layers, duplicate business logic, or weaken abstractions.

---

# Acceptance Criteria

Acceptance criteria define what "working" means for the feature. They are written before implementation and are the basis for the test stage.

Good acceptance criteria are:

- specific and unambiguous,
- testable by an automated or documented manual check,
- expressed from the user's perspective where applicable,
- inclusive of error and edge behavior, not only the happy path,
- inclusive of non-functional requirements (bilingual UI, performance budget, privacy).

A criterion that cannot be verified is not a criterion; it is a wish.

---

# Vertical Slicing And Incremental Delivery

Features are delivered in thin vertical slices. Each slice cuts through every layer required to deliver a small, working, verifiable increment of value.

Each slice must:

- compile,
- pass its tests,
- preserve existing functionality,
- deliver an independently verifiable increment of value.

Prefer many small verified slices over one large monolithic change. Large unverified changes increase risk and obscure the source of defects.

Where a slice ships ahead of full readiness, it is gated behind a feature flag that defaults off, so the increment can be merged safely and enabled deliberately.

---

# Cross-Functional Considerations

A feature is rarely confined to one layer. Every feature must account for all of the following, marking each as changed or not applicable:

| Concern | Standard | Question To Answer |
|---|---|---|
| API contract | `06_API_ENGINEERING` | Does the request/response shape change? Is it versioned and backward compatible? |
| Data | `05_ARCHITECTURE_STANDARDS` and database engineering | New tables/columns/indexes? RLS in the same migration? |
| UI | Frontend standards | All states handled? Bilingual? Within bundle budget? |
| Documentation | `15_DOCUMENTATION` | README, API docs, runbooks, changelog updated? |
| Tests | `08_TESTING_PROTOCOL` | Unit, integration, and E2E coverage for acceptance criteria? |
| Verification | `10_VERIFICATION_ENGINE` | Type-check, lint, test, and build evidence collected? |
| Privacy and security | Security standards | No PII in logs; least privilege; authorization enforced server-side? |

A cross-functional concern that is unaddressed is an incomplete feature, not a follow-up.

---

# Stage 4: Implementation

Implementation realizes the design slice by slice.

Implementation rules:

- Follow the coding standards; produce readable, modular, deterministic, testable code.
- Keep business logic out of duplicated locations; reuse existing components.
- Use configuration over hardcoding; invariant constants live in their single canonical home.
- Enforce authorization server-side; client-side checks are convenience, not security.
- Never log PII; redact sensitive fields.
- Stay within the architectural boundaries established in design.

Each slice is verified before the next begins.

---

# Stage 5: Test

Testing verifies the feature against its acceptance criteria.

Testing per `08_TESTING_PROTOCOL` may include:

- unit tests for logic,
- integration tests for contracts and data access,
- end-to-end tests for user-visible workflows,
- type checking and linting,
- regression tests for any invariant the feature touches.

A feature that touches a product invariant must have a corresponding regression test. Claiming a regression is covered when no test exists is prohibited. The test stage produces evidence, not assertion.

---

# Stage 6: Review

Review confirms correctness, quality, and completeness before release.

Review confirms:

- acceptance criteria are met with evidence,
- product invariants are preserved,
- the review chain for any critical file touched is complete,
- documentation is synchronized with behavior,
- security and privacy obligations are satisfied,
- verification evidence (type-check, lint, test, build) is present and passing.

The mandatory downstream reviewers depend on what changed. A change to a critical file may not be marked complete until its required reviewers have signed off.

---

# Stage 7: Release

Release moves the verified feature into production.

Release requires per `10_VERIFICATION_ENGINE`:

- a successful build,
- passing verification gates,
- configuration validation,
- a rollback strategy,
- monitoring readiness.

Features that are not yet ready for all users are released behind a feature flag defaulting off and enabled by a deliberate, logged operator action. Breaking changes and invariant changes require explicit approval before release.

---

# Stage 8: Monitor

A feature is not done when it ships. It is done when it is observed behaving correctly in production.

Monitoring confirms:

- the value hypothesis is being measured against real usage,
- error rates and latency remain within expected bounds,
- no product invariant has regressed,
- the rollback path remains available if behavior degrades.

If monitoring reveals degradation, the feature loops back to an earlier stage. Concealing a post-release defect is prohibited.

---

# Definition Of Done

A feature is Done only when every item below is satisfied:

- All acceptance criteria are met with evidence.
- All affected product invariants are confirmed preserved.
- Unit, integration, and E2E coverage exists for the acceptance criteria.
- Regression tests exist for any invariant touched.
- Verification gates pass (type-check, lint, test, build) with collected evidence.
- The review chain for every critical file touched is complete.
- Documentation, API docs, runbooks, and changelog are synchronized.
- The feature is released and observable in production.
- A rollback path exists and is documented.
- Known limitations and remaining risks are disclosed.

A feature that cannot satisfy every item is not Done; it is in progress.

---

# Feature-Completion Checklist

- Specification written with value hypothesis and non-goals
- Acceptance criteria explicit and testable
- Affected product invariants identified and preserved
- Required approvals obtained (invariant, pricing, RBAC, subject)
- Definition of Ready satisfied before implementation
- Design respects architectural boundaries; ADRs captured
- Delivered in verified vertical slices
- Cross-functional concerns addressed (API, data, UI, docs, tests, privacy)
- Authorization enforced server-side; no PII in logs
- Tests cover acceptance criteria and any touched invariant
- Verification gates pass with evidence
- Review chain complete for critical files
- Documentation and changelog synchronized
- Released with a rollback strategy and monitoring readiness
- Observed behaving correctly in production
- Known limitations and risks disclosed

---

# Anti-Patterns

The following are prohibited:

- Writing code before the feature is Ready.
- Horizontal delivery that produces no working value until the final layer.
- Acceptance criteria that cannot be tested.
- Marking a feature Done before it is observable in production.
- Claiming regression coverage that does not exist.
- Deferring documentation as a follow-up to a behavior change.
- Shipping an invariant or pricing change without explicit approval.
- Enabling a not-yet-ready feature for all users instead of gating it behind a flag.

---

# References

- `05_ARCHITECTURE_STANDARDS` - Architectural boundaries every feature design must respect.
- `06_API_ENGINEERING` - API contract, versioning, and backward-compatibility rules for feature endpoints.
- `08_TESTING_PROTOCOL` - The verification basis for acceptance criteria and regression coverage.
- `10_VERIFICATION_ENGINE` - The release gates a feature must pass before and at release.
- `26_FEATURE_DEVELOPMENT` - This document; the canonical feature lifecycle.
- `27_QA_SIGNOFF` - The QA gate and sign-off that confirms a feature meets its Definition of Done.

---

# Final Directive

Claude Code shall treat every feature as a full lifecycle, not as a code change.

No feature shall enter implementation before it is Ready. No feature shall be called Done before it is observable in production, verified against its acceptance criteria, and supported by objective evidence.

Features deliver value in thin, verified, reversible increments. Every increment must leave the platform more capable without weakening its invariants, its reliability, or its security.

**End of Document**
