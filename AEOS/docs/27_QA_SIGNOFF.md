# 27_QA_SIGNOFF.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Mandatory Quality Assurance Sign-Off Standard
**Priority:** Critical
**Applies To:** Every release, deployment, and merge to a protected branch, and every change that requires a formal quality decision before it reaches users.

---

# Purpose

This document establishes the mandatory quality gate and sign-off protocol that governs whether work is permitted to reach production.

Its objective is to ensure that every release is:

- gated by objective, repeatable checks,
- judged against explicit release-readiness criteria,
- recorded in an auditable sign-off,
- free of unresolved blocking defects,
- approved on the basis of evidence rather than optimism.

QA sign-off is the final quality decision before users are affected. It is the moment where engineering claims are required to become trustworthy.

These standards apply regardless of language, framework, repository, or runtime.

---

# QA Philosophy

QA sign-off is governed by one principle above all others:

Sign-off is an evidence-based decision, not a formality.

A sign-off is a statement that the work has been verified against objective criteria and is fit for release. It is not a courtesy, a rubber stamp, or a box to be ticked under deadline pressure.

The person or process that signs off accepts responsibility for the claim that the work is ready. That claim must be supportable by evidence that another engineer could independently reproduce.

Sign-off is never optional. Work that has not been signed off has not been cleared for release, regardless of how confident anyone feels about it. Confidence is not evidence, and evidence is the only acceptable basis for a sign-off.

---

# The QA Gate

The QA gate is the boundary between work that is in progress and work that is permitted to reach users.

Nothing crosses the gate until every applicable quality check has passed and the sign-off record is complete.

The gate is binary. Either all blocking conditions are satisfied and the work is cleared, or one or more are not and the work is held. There is no partial passage. A release that is mostly ready is not ready.

---

# Mandatory Quality Gates

The following gates apply to every release-bound change. A gate that is not applicable to a particular change must be explicitly marked not applicable with a reason, never silently skipped.

Each gate produces evidence. The evidence, not the assertion that the gate ran, is what permits the gate to be marked passed.

## Build

The artifact compiles and builds successfully. Dependencies resolve. The build is reproducible. A broken build is an absolute release blocker.

## Type Check

Static type checking passes with no errors. New code introduces no type holes, no suppressed type errors without a recorded justification.

## Lint

Static analysis and linting pass. Style and correctness rules are satisfied. Warnings are investigated rather than ignored.

## Unit Tests

All unit tests pass. Business rules are covered. No test has been skipped or weakened to obtain a green result without a recorded justification.

## Integration Tests

All integration tests pass. The interactions between services, repositories, data stores, and external providers behave as specified.

## End-to-End Tests

The critical user journeys pass automated end-to-end verification. The journeys reflect real user behavior, not synthetic shortcuts around the parts that matter.

## Security Checks

Authentication, authorization, input validation, and data-exposure protections are verified. No secret is exposed. No new vulnerability is introduced. A security regression is an absolute release blocker.

## Performance Checks

The change remains within its declared performance budgets. Bundle, latency, and throughput targets are met. A budget breach is treated as a failed gate.

## Documentation

Documentation affected by the change is updated in the same change. Operational runbooks, interface contracts, and user-facing guidance reflect the new state.

---

# Defect Severity Classification

Defects are classified by severity so that release decisions are consistent and proportionate. Severity determines whether a defect blocks sign-off.

## Critical

The system is unusable, data is corrupted or lost, a security boundary is breached, or a core user journey is broken. Critical defects block sign-off unconditionally.

## Major

A significant feature is broken or behaves incorrectly, with no acceptable workaround. Major defects block sign-off unless an explicit, recorded, time-bound exception is granted by an accountable owner.

## Minor

A feature behaves incorrectly in a limited way, or an acceptable workaround exists. Minor defects do not block sign-off but must be recorded and scheduled.

## Trivial

A cosmetic or low-impact issue with no functional consequence. Trivial defects are recorded and do not block sign-off.

The classification is made on impact to users and to the system, not on the effort required to fix. A small code change can carry a critical defect, and a large change can carry only trivial ones.

---

# Release-Readiness Criteria

Work is release-ready only when every one of the following holds:

- all mandatory quality gates have passed or are justifiably not applicable,
- no critical or major defect remains open,
- every applicable product invariant is preserved,
- the change has been verified against realistic conditions, not only ideal ones,
- a rollback path exists and is documented,
- the evidence supporting each gate is available and reproducible,
- the sign-off record is complete.

Release readiness is an objective state defined by these criteria. It is not a judgment call that can be made by feel. If a criterion is unmet, the work is not ready, and no amount of schedule pressure changes that fact.

---

# The Sign-Off Record

Every sign-off produces a durable record. The record is the auditable artifact that proves the quality decision was made deliberately and on the basis of evidence.

The sign-off record shall capture:

## Who

The identity of the person or process that performed the sign-off, and the accountable owner of the release.

## What

The precise scope of the change: the commit or release identifier, the affected systems, and the boundary of what was reviewed.

## Evidence

The concrete results that support each gate: build output, type-check result, lint result, test summaries, security validation, performance measurements, and documentation status. The evidence must be specific enough that another engineer could reproduce it.

## Outstanding Issues

Any known defects that remain open at sign-off, each with its severity classification and its disposition. Open critical and major defects are incompatible with sign-off and must be resolved or formally excepted before the record is completed.

## Date

The date and time of the sign-off, establishing when the quality decision was made and against which state of the work.

A sign-off record that omits the evidence is not a sign-off. It is an assertion, and assertions are not the currency of this system.

---

# Conditions That Block Sign-Off

Sign-off shall be withheld whenever any of the following is true:

- the build, type check, or lint fails,
- any test fails,
- a required test was skipped or weakened without recorded justification,
- a critical or major defect is open and unresolved,
- a security check fails or a secret is exposed,
- a declared performance budget is breached,
- a product invariant is violated,
- required documentation has not been updated,
- the evidence for any gate is missing or cannot be reproduced,
- the sign-off record is incomplete.

When a blocking condition is present, the correct action is to hold the release and resolve the condition. A blocking condition is never waived by deadline. The role of the gate is precisely to hold firm when pressure is highest.

A claim of readiness that is not backed by evidence is itself a blocking condition. Sign-off cannot proceed on confidence alone.

---

# Failure Handling

When a gate fails during the sign-off process:

1. Stop.
2. Preserve and capture the evidence of the failure.
3. Identify the root cause.
4. Implement the correction.
5. Re-run the affected gate and the regression suite.
6. Update the sign-off record with the new evidence.

A failed gate is never suppressed to produce a clean record. Suppressing a failure to obtain sign-off defeats the entire purpose of the gate and converts the record from an asset into a liability.

---

# Independence of the QA Decision

The quality decision must be made against the evidence, not against the wishes of any stakeholder.

The sign-off must not be granted by someone who is unable to evaluate the evidence objectively, and it must not be coerced by schedule, by sunk cost, or by the desire to declare a task finished. The gate exists precisely to be the one place in the process that does not bend to those pressures.

The accountable owner of a release may differ from the author of the change. Where that separation exists, it strengthens the decision: a second set of eyes is more likely to question a missing piece of evidence than the author who already believes the work is done. Self-review is permitted where independent review is not available, but it carries a higher obligation to apply the criteria with discipline rather than charity.

---

# Evidence Discipline

Each gate is marked passed only on the strength of evidence that an independent engineer could reproduce.

The following are acceptable forms of gate evidence:

- recorded build output demonstrating a successful build,
- the type-check command result showing no errors,
- the lint result showing no violations,
- unit, integration, and end-to-end test summaries with pass counts,
- security validation output,
- performance measurements compared against declared budgets,
- a record of which documentation was updated.

The following are never acceptable as evidence:

- a statement that a check would pass if it were run,
- a recollection that a check passed previously,
- an assumption that an unchanged area is unaffected,
- confidence in the absence of a result.

Do not record All checks passed unless every check was actually executed and its result observed. A sign-off that overstates the evidence is worse than no sign-off, because it invites trust that the work has not earned.

---

# Exceptions

In rare cases a release may proceed with a known, non-critical defect open. This is an exception, and it is governed strictly.

An exception is permissible only when:

- the defect is classified minor or trivial, never critical and only major under explicit accountable approval,
- the accountable owner explicitly approves the exception,
- the defect, its impact, and the reason for proceeding are recorded in the sign-off record,
- a remediation plan with an owner and a target is captured.

An exception is a documented, deliberate decision to accept a known risk. It is never a quiet omission. A defect that is simply left out of the record is not an exception; it is a concealed defect, and concealing a defect is a violation of this standard.

Critical defects and security breaches are not eligible for exception under any circumstances.

---

# Post-Release Verification

Sign-off authorizes a release; it does not conclude it. After the change reaches production, the release is verified against reality.

Post-release verification confirms:

- application and dependency health,
- that the critical user journeys function in production,
- that error rates and latency remain within expected bounds,
- that monitoring and alerting are reporting correctly.

If post-release verification reveals a regression, the documented rollback path is exercised without hesitation, and the failure is captured as a defect with a regression test so the same fault cannot pass a future sign-off undetected. A release is not truly complete until production has confirmed it healthy.

---

# QA Sign-Off Checklist

Before sign-off is granted, verify:

- Did the build pass with reproducible output?
- Did type checking pass with no suppressed errors?
- Did linting and static analysis pass?
- Did all unit tests pass without skips or weakened assertions?
- Did all integration tests pass?
- Did the end-to-end critical journeys pass?
- Did the security checks pass with no exposed secrets?
- Does the change remain within all declared performance budgets?
- Was affected documentation updated in the same change?
- Are all open defects classified by severity?
- Are there zero open critical or major defects?
- Is every applicable product invariant preserved?
- Is a documented rollback path available?
- Is the evidence for every gate available and reproducible?
- Is the sign-off record complete with who, what, evidence, outstanding issues, and date?

If any answer is No, withhold sign-off until it is resolved.

---

# References

This document operates within the AEOS hierarchy and must be read together with:

- 08_TESTING_PROTOCOL - the testing philosophy, evidence requirements, and quality gates that the sign-off decision aggregates.
- 10_VERIFICATION_ENGINE - the evidence-over-confidence execution model that every gate result must satisfy.
- 17_PLAYWRIGHT_AUTOMATION - the end-to-end automation that supplies the critical-journey gate evidence.
- 20_DEPLOYMENT_PIPELINE - the deployment mechanism that a completed sign-off authorizes.
- 21_RELEASE_MANAGEMENT - the release and change-control process within which sign-off is the final quality decision.

Where this document and a higher-authority document appear to conflict, the higher-authority document prevails. The authority order is the project-root constitution, then AEOS/MASTER_SYSTEM_PROMPT.md, then AEOS/EXECUTION_ENGINE.md, then the numbered AEOS documents (00-29), then extensions, then the task.

---

# Final Directive

QA sign-off is the point at which engineering work earns the right to reach users.

Never sign off without evidence.

Never waive a blocking condition under pressure.

Never present confidence in place of verification.

A sign-off is a promise that the work is ready, backed by results that another engineer could reproduce. Make that promise only when the evidence allows you to keep it.

**End of Document**
