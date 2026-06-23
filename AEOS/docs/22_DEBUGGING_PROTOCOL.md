# 22_DEBUGGING_PROTOCOL.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Mandatory Defect Investigation & Debugging Standard
**Priority:** P0 (Highest Priority)
**Applies To:** Every defect, regression, incident, anomaly, failing test, production error, and unexpected behavior investigated by Claude Code across the Alfanumrik platform.

---

# Purpose

This document establishes the mandatory debugging philosophy, investigation workflow, evidence requirements, and discipline for diagnosing and correcting defects.

Debugging is an engineering process, not an act of intuition.

A defect is not understood until it can be reproduced, explained, and prevented from recurring.

No fix may be applied until the underlying behavior has been observed and the cause has been located.

---

# Debugging Philosophy

The objective of debugging is to replace uncertainty with understanding.

Debugging shall:

* reproduce the defect before attempting any fix,
* locate the cause through evidence rather than speculation,
* correct the root cause rather than the symptom,
* prove the correction with verification,
* prevent recurrence through a regression test.

Never guess.

Never change code in the hope that it helps.

A fix that is not understood is not a fix.

---

# Fundamental Principle

**Reproduce first.**

A defect that cannot be reproduced cannot be reliably diagnosed or confirmed as fixed.

The first goal of every investigation is a deterministic, repeatable reproduction.

Once a defect reproduces on demand, every subsequent step has a measurable outcome.

If a defect cannot be reproduced, that fact must be stated explicitly, and the investigation must focus on collecting the evidence required to reproduce it.

---

# Absolute Rules

During any debugging activity, Claude Code shall never:

* claim a defect is fixed without reproducing it first,
* claim a defect is fixed without verifying the fix resolves the reproduction,
* apply random or speculative changes hoping the symptom disappears,
* change multiple unrelated things at once to "see what works,"
* suppress, comment out, or skip a failing test to obtain a green result,
* treat a symptom as resolved when the cause remains unknown,
* fabricate logs, traces, or reproduction steps.

If the cause cannot be located, state this explicitly and continue investigation.

Never replace understanding with optimism.

---

# The Debugging Loop

Every defect investigation follows this lifecycle:

```text
Reproduce
        v
Isolate
        v
Form Hypothesis
        v
Test Hypothesis
        v
Fix
        v
Verify
        v
Regression-Test
        v
Document
```

Each stage produces evidence that justifies entering the next.

Skipping stages is prohibited unless a stage is explicitly not applicable.

---

# Stage 1 - Reproduce

Establish a reliable, repeatable reproduction before changing any code.

Capture:

* exact steps to trigger the defect,
* environment (local, staging, production),
* inputs and preconditions,
* the role, plan, grade, or tenant context if relevant,
* the observed result,
* the expected result.

A reproduction is reliable only when it fails consistently under the same conditions.

If reproduction is intermittent, treat determinism itself as the first defect to investigate.

---

# Stage 2 - Isolate

Reduce the surface area of the problem.

Isolation narrows the search space until the fault is contained to the smallest possible region.

Techniques include:

* building a minimal reproduction free of unrelated code,
* removing variables one at a time,
* disabling features or flags to confirm involvement,
* separating client behavior from server behavior,
* separating data problems from logic problems.

The goal of isolation is a small, clear example that still exhibits the defect.

---

# Stage 3 - Form Hypothesis

State a specific, testable explanation for the defect.

A hypothesis must:

* describe the suspected cause,
* predict observable behavior,
* be falsifiable.

Avoid vague statements such as "something is wrong with the data."

Prefer precise statements such as "the score is recomputed in the component instead of using the server response, so a rounding difference appears."

A hypothesis that cannot be tested is not useful.

---

# Stage 4 - Test Hypothesis

Test one hypothesis at a time.

Use the minimal change or instrumentation required to confirm or reject it.

Acceptable methods include:

* adding a temporary log or trace at a decision point,
* inspecting a value at the boundary between two components,
* writing a failing test that encodes the expected behavior,
* querying the database to confirm stored state.

If the hypothesis is rejected, return to isolation with the new evidence.

Never proceed to a fix while the hypothesis remains unconfirmed.

---

# Stage 5 - Fix

Apply the smallest correct change that addresses the confirmed root cause.

The fix shall:

* address the cause, not the symptom,
* leave the codebase in a valid state,
* avoid introducing unrelated changes,
* respect every product invariant and architectural standard.

A fix that only hides the symptom is not acceptable.

If the true fix is large or risky, document the risk before proceeding.

---

# Stage 6 - Verify

Confirm the fix resolves the original reproduction.

Verification requires executing the exact reproduction steps and observing the corrected behavior.

Verify that:

* the defect no longer reproduces,
* the expected result now occurs,
* no new errors appear in logs or traces.

Only executed results qualify as evidence.

A fix is not verified until the reproduction that exposed the defect passes.

---

# Stage 7 - Regression-Test

Encode the defect as an automated test.

The regression test must:

* fail against the unfixed code,
* pass against the fixed code,
* describe the defective behavior in its name.

This guarantees the same defect cannot silently return.

Every bug fix must include a regression test. This requirement aligns with the testing standard.

---

# Stage 8 - Document

Record the investigation and its outcome.

Documentation should capture:

* the symptom and reproduction,
* the confirmed root cause,
* the correction applied,
* the regression test added,
* any follow-up risks.

For incidents and recurring defects, escalate to a full Root Cause Analysis.

Undocumented fixes lose the lessons they contain.

---

# Evidence Collection

Debugging is evidence-driven. Collect before concluding.

Acceptable evidence includes:

* structured logs,
* stack traces and error messages,
* distributed traces and request IDs,
* a minimal reproduction,
* database query results,
* network request and response payloads,
* monitoring metrics and dashboards,
* test execution output.

Evidence must be observed, not assumed.

A conclusion without evidence is a guess.

---

# Minimal Reproduction

A minimal reproduction is the most valuable artifact in debugging.

It should:

* contain only what is required to trigger the defect,
* remove unrelated features and data,
* be runnable on demand,
* produce the defect deterministically.

A minimal reproduction often reveals the cause before any fix is attempted.

It also becomes the seed of the regression test.

---

# Binary Search and Bisection

When the cause is hidden in a large space, search systematically.

Apply bisection to narrow the source of the defect:

* across history, identify the change that introduced the defect by repeatedly testing the midpoint between a known-good and a known-bad state,
* across code, disable half of a suspected region and observe whether the defect persists,
* across data, split the dataset and determine which half triggers the defect.

Each step should roughly halve the remaining search space.

Bisection replaces guessing with a finite, measurable process.

---

# Observability Use

Use observability tools before adding ad hoc instrumentation.

Consult:

* application and server logs,
* request tracing with correlation IDs,
* error monitoring and alerts,
* performance and latency metrics,
* database and query insights.

Correlate signals across layers using request IDs to follow a single transaction end to end.

Observability answers questions that local reasoning cannot.

---

# Avoiding Blind Retries

Re-running a failing operation without changing anything proves nothing.

A blind retry:

* wastes time,
* hides intermittent causes,
* creates false confidence when a flaky result happens to pass.

If an operation is retried, the retry must be accompanied by a hypothesis about why the outcome should differ.

Intermittent failures are defects in their own right and must be investigated, not retried away.

---

# Avoiding Shotgun Changes

A shotgun change alters many things at once in the hope that one of them helps.

Shotgun debugging is prohibited because it:

* obscures which change mattered,
* introduces new defects,
* destroys the chain of evidence,
* prevents a clean regression test.

Change one thing at a time.

Confirm the effect of each change before making the next.

---

# Root Cause, Not Symptom

The symptom is what is observed. The root cause is why it happened.

Treating symptoms produces recurring defects.

Before declaring a fix complete, ask:

* Why did this defect occur?
* Why was it not caught earlier?
* What allowed the defective state to exist?

If the answer to "why" is not understood, the root cause has not been found.

Defects of significant impact, recurrence, or risk must be escalated into a formal Root Cause Analysis. See 23_ROOT_CAUSE_ANALYSIS.

---

# Heisenbugs and Non-Determinism

Some defects change behavior when observed, or appear only intermittently.

Common sources include:

* race conditions and concurrency,
* timing and ordering assumptions,
* uninitialized or shared mutable state,
* dependence on external systems,
* environment differences between local and production.

For these defects, the first objective is to make the behavior deterministic.

A non-deterministic defect that cannot be made repeatable cannot be confidently confirmed as fixed.

---

# Production Debugging Discipline

Debugging in production requires additional care.

When investigating live systems:

* prefer read-only inspection of logs, traces, and metrics,
* never expose or log personally identifiable information,
* avoid changes that alter production data without approval,
* preserve evidence before applying any mitigation,
* distinguish immediate mitigation from the eventual root-cause fix.

A mitigation that restores service is not a substitute for the root-cause correction.

---

# Debugging Anti-Patterns

The following behaviors indicate a flawed investigation:

* fixing before reproducing,
* changing code without a hypothesis,
* multiple simultaneous unrelated changes,
* relying on "it works now" without explanation,
* removing assertions to silence failures,
* declaring success without verification,
* closing a defect without a regression test.

The presence of any of these is grounds to restart the investigation.

---

# Debugging Readiness Checklist

Before declaring a defect resolved, verify:

- Has the defect been reliably reproduced?
- Is there a minimal reproduction?
- Was the search narrowed through isolation or bisection?
- Was a specific, testable hypothesis formed?
- Was the hypothesis confirmed with evidence?
- Does the fix address the root cause rather than the symptom?
- Does the original reproduction now pass?
- Was a regression test added that fails without the fix?
- Do existing tests and regression suites still pass?
- Is the investigation and outcome documented?
- Was a Root Cause Analysis raised if the defect warrants it?

If any answer is "No," the defect is not resolved.

---

# Definition of Debugging Completion

A defect is resolved only when:

* it was reproduced before being fixed,
* the root cause was identified with evidence,
* the fix corrects the cause,
* the original reproduction passes,
* a regression test prevents recurrence,
* existing functionality remains intact,
* the investigation is documented.

Anything else is work in progress.

---

# References

Related AEOS documents that govern and extend this protocol:

* 08_TESTING_PROTOCOL - Regression testing requirements, evidence standards, and the failure investigation sequence that every fix must satisfy.
* 10_VERIFICATION_ENGINE - The evidence-over-confidence execution model and failure-handling stages that debugging conclusions must obey.
* 23_ROOT_CAUSE_ANALYSIS - The escalation path for defects requiring systemic, blameless analysis and the conversion of findings into preventive controls.

---

# Final Directive

Debugging is the discipline of converting confusion into understanding.

Never guess when you can reproduce.

Never fix what you have not located.

Never close a defect that can silently return.

Every defect resolved must leave the platform better understood and better protected than before.

**End of Document**
