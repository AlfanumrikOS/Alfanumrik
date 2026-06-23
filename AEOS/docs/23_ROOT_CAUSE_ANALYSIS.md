# 23_ROOT_CAUSE_ANALYSIS.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Mandatory Incident Analysis & Systemic Prevention Standard
**Priority:** P0 (Highest Priority)
**Applies To:** Every incident, recurring defect, security event, data-integrity failure, and significant production disruption analyzed across the Alfanumrik platform.

---

# Purpose

This document establishes the mandatory methodology for Root Cause Analysis (RCA).

RCA is the discipline of understanding why a failure occurred at a systemic level, not merely what failed.

Its objective is to convert failures into durable improvements: regression tests, architectural decisions, and preventive controls.

A failure that is mitigated but not understood will return.

No incident of significant impact may be closed until its root cause has been identified and its preventive actions defined.

---

# RCA Philosophy

The objective of RCA is to make the same failure impossible, not to assign fault.

RCA shall:

* be blameless, focusing on systems and conditions rather than individuals,
* be systemic, treating failure as the outcome of a chain of conditions,
* be evidence-driven, grounded in observed facts rather than speculation,
* be preventive, producing concrete actions that reduce future risk,
* be durable, encoding lessons so they survive beyond the people involved.

Blame suppresses information.

Blamelessness surfaces the truth required to prevent recurrence.

---

# Fundamental Principle

**Failures are properties of systems, not of people.**

When a human action contributes to a failure, the question is never "who made the mistake."

The question is "what allowed the mistake to reach production and cause harm."

A robust system makes errors visible, contains their impact, and prevents their recurrence.

RCA exists to strengthen the system so that individual error cannot become systemic failure.

---

# Absolute Rules

During any RCA, Claude Code shall never:

* assign personal blame or frame findings around individuals,
* stop at the first plausible cause without confirming it,
* declare a single cause when multiple contributing factors exist,
* close an RCA without corrective and preventive actions,
* propose actions that cannot be verified or owned,
* fabricate a timeline, impact assessment, or evidence,
* conceal or minimize the severity of an incident.

If the root cause cannot be conclusively determined, state this explicitly and record the most probable causes with supporting and contradicting evidence.

Never replace analysis with assumption.

---

# When RCA Is Required

A formal RCA is mandatory for:

* production incidents affecting users, data, or availability,
* recurring defects that have appeared more than once,
* security events, suspected breaches, or data exposure,
* data-integrity failures, including incorrect scores, XP, or payments,
* failed deployments that required rollback,
* any defect involving a product invariant violation.

An RCA is recommended for near-misses, where a failure was narrowly avoided, because near-misses reveal latent weaknesses before they cause harm.

When in doubt, perform the RCA.

---

# Relationship to Debugging

Debugging locates and corrects a specific defect.

RCA explains why the defect was possible and prevents its class from recurring.

Debugging answers "what broke and how do I fix this instance."

RCA answers "why did the system permit this, and how do we eliminate the condition."

Every RCA builds on the evidence and reproduction produced during debugging. See 22_DEBUGGING_PROTOCOL.

---

# The RCA Lifecycle

Every RCA follows this lifecycle:

```text
Detect and Declare
        v
Stabilize and Mitigate
        v
Collect Evidence
        v
Reconstruct Timeline
        v
Identify Root Cause
        v
Identify Contributing Factors
        v
Define Corrective Actions
        v
Define Preventive Actions
        v
Capture Lessons
        v
Track to Closure
```

Mitigation restores service. RCA prevents recurrence. Both are required, in that order.

---

# Stage 1 - Detect and Declare

Acknowledge the failure and establish shared awareness.

Capture:

* what was observed,
* when it was first detected,
* who or what detected it,
* the initial severity assessment.

Declaration creates a single source of truth and prevents fragmented, duplicated investigation.

---

# Stage 2 - Stabilize and Mitigate

Restore safe operation before performing deep analysis.

Mitigation may include rollback, a feature-flag disable, or traffic isolation.

While stabilizing:

* preserve evidence before it is lost,
* record every action and its timestamp,
* distinguish mitigation from the eventual root-cause fix.

A mitigation that restores service is not a root-cause fix.

---

# Stage 3 - Collect Evidence

Gather the facts the analysis will rest upon.

Evidence includes:

* logs, traces, and request IDs,
* monitoring metrics and alerts,
* the reproduction produced during debugging,
* deployment and change history,
* database state and audit logs,
* communications and timestamps.

Evidence must be observed and preserved, never reconstructed from memory alone.

---

# Stage 4 - Reconstruct the Timeline

Build a precise sequence of events.

The timeline should record:

* when the contributing change or condition was introduced,
* when the failure began,
* when it was detected,
* when it was mitigated,
* when it was resolved.

The gap between failure and detection reveals weaknesses in observability.

The gap between detection and mitigation reveals weaknesses in response.

---

# Stage 5 - Identify the Root Cause

The root cause is the deepest condition that, if removed, would have prevented the failure.

Use systematic techniques to reach it:

* iterative questioning to move from symptom to underlying condition,
* causal-chain construction to trace the path from trigger to impact,
* separation of the triggering event from the conditions that allowed it.

A root cause is confirmed only when removing it, in principle, would have prevented the incident.

Stopping at the first plausible explanation is the most common RCA failure.

---

# The 5 Whys Technique

Ask "why" repeatedly until the systemic condition is reached.

Example progression:

```text
Symptom: Students saw an incorrect quiz score.
Why? The score was recomputed on the client.
Why? The component duplicated the scoring formula.
Why? No single source of truth was enforced for scoring.
Why? The invariant was documented but not test-guarded.
Why? No regression test pinned the formula across layers.
```

The final answer points to a systemic gap, not a single line of code.

The number five is a guideline, not a rule. Continue until the systemic cause is reached, and stop when further questions no longer yield actionable conditions.

---

# Causal Chains

Most incidents result from a chain of conditions rather than a single fault.

Construct the chain from triggering event to final impact, identifying each link that allowed the failure to propagate.

Each link is a candidate for a control:

* a validation that should have rejected the input,
* a test that should have caught the regression,
* an alert that should have fired sooner,
* a boundary that should have contained the blast radius.

Strengthening any single link can break the chain for an entire class of failures.

---

# Contributing Factors vs Root Causes

Distinguish clearly between the two.

The **root cause** is the condition whose removal would have prevented the incident.

**Contributing factors** made the incident more likely, more severe, or harder to detect, but were not sufficient alone.

Examples of contributing factors:

* insufficient test coverage in the affected area,
* missing or delayed monitoring,
* unclear ownership,
* time pressure or incomplete review.

Both must be recorded. Preventive actions address contributing factors so that the next incident is less likely and less severe.

---

# The Postmortem Document

Every RCA produces a written postmortem with this structure:

## Summary

A concise description of what happened and its overall impact.

## Timeline

The ordered sequence of events with timestamps, from introduction to resolution.

## Impact

Who and what were affected: users, data, revenue, availability, and duration.

## Root Cause

The confirmed deepest condition that caused the failure, supported by evidence.

## Contributing Factors

The conditions that increased likelihood, severity, or detection time.

## Corrective Actions

The actions that resolve this specific incident and its immediate cause.

## Preventive Actions

The systemic actions that prevent this class of failure from recurring.

## Lessons

What the organization learned about its systems, processes, and assumptions.

A postmortem without preventive actions and lessons is incomplete.

---

# Corrective vs Preventive Actions

Corrective and preventive actions serve different purposes and are both required.

**Corrective actions** resolve the immediate incident: deploy the fix, repair corrupted data, close the exposure.

**Preventive actions** eliminate the underlying condition: add the missing test, enforce the invariant, add the missing alert, redesign the fragile boundary.

Every action must have:

* a clear owner,
* a defined completion criterion,
* a means of verification.

Actions without owners are intentions, not commitments.

---

# Turning Findings Into Regression Tests

Every RCA must produce at least one regression test that encodes the failure.

The regression test must:

* fail against the conditions that produced the incident,
* pass once the corrective fix is in place,
* describe the incident in its name.

This guarantees the specific failure cannot silently recur and aligns the RCA with the testing standard. See 08_TESTING_PROTOCOL.

A regression test is the most durable lesson an RCA can produce.

---

# Turning Findings Into Architecture Decisions

When an RCA reveals a structural weakness, the correction must be recorded as an Architecture Decision Record (ADR).

Document an ADR when the preventive action involves:

* a change to a boundary, contract, or invariant enforcement,
* a new control that constrains future implementations,
* a deliberate trade-off accepted to reduce risk.

The ADR preserves the reasoning so future engineers do not reintroduce the same weakness.

Systemic lessons must be encoded in systemic artifacts, not left in a single document.

---

# Blameless Culture in Practice

A blameless RCA is achieved through deliberate language and framing.

In practice:

* describe actions and conditions, not personal failings,
* assume every actor did what seemed reasonable with the information available,
* focus on what the system allowed, not on who acted,
* treat honest disclosure as a contribution, never a liability.

Blamelessness is not the absence of accountability. The system is held accountable for permitting the failure, and the organization is accountable for the preventive actions.

---

# Severity and Prioritization

Calibrate RCA depth and action urgency to impact.

Consider:

* the number of users affected,
* the sensitivity of affected data,
* financial or trust impact,
* duration and detectability,
* the likelihood of recurrence.

Higher severity demands deeper analysis, faster preventive action, and broader review.

Security events and data-integrity failures are treated as high severity by default.

---

# RCA Completeness Checklist

Before closing an RCA, verify:

- Is the incident reliably reproduced or otherwise conclusively understood?
- Is there a complete, timestamped timeline?
- Is the impact quantified across users, data, and availability?
- Has the root cause been confirmed, not merely assumed?
- Are contributing factors distinguished from the root cause?
- Are corrective actions defined, owned, and verifiable?
- Are preventive actions defined, owned, and verifiable?
- Has at least one regression test been added for the failure?
- Has an ADR been created where a structural change is warranted?
- Are the lessons recorded in language that is blameless and systemic?
- Are all actions tracked to closure with completion criteria?

If any answer is "No," the RCA is not complete.

---

# Definition of RCA Completion

An RCA is complete only when:

* the root cause is identified with evidence,
* contributing factors are recorded,
* a postmortem document exists with all required sections,
* corrective and preventive actions are owned and tracked,
* a regression test prevents recurrence,
* structural lessons are encoded as ADRs where warranted,
* the analysis is blameless and systemic.

Anything else is work in progress.

---

# References

Related AEOS documents that govern and extend this methodology:

* 08_TESTING_PROTOCOL - The regression-testing requirement and evidence standards that every RCA finding must satisfy.
* 10_VERIFICATION_ENGINE - The evidence-over-confidence model and failure-handling sequence that underpins RCA conclusions.
* 22_DEBUGGING_PROTOCOL - The reproduction and root-cause-locating discipline that feeds the evidence consumed by RCA.
* 25_INCIDENT_RESPONSE - The operational response, escalation, and communication procedures that surround and trigger an RCA.

---

# Final Directive

Root Cause Analysis is the discipline of ensuring that a failure teaches more than it costs.

Never assign blame when you can strengthen a system.

Never stop at the symptom when the cause remains hidden.

Never close an incident that can silently return.

Every failure analyzed must leave the Alfanumrik platform more resilient than it was before.

**End of Document**
