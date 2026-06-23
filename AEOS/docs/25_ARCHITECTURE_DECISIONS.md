# 25_ARCHITECTURE_DECISIONS.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Mandatory Architecture Governance Standard
**Priority:** Critical
**Applies To:** Every significant architectural decision made under the AEOS, including technology selection, structural design, contract changes, security posture, scaling strategy, and any deviation from established architecture standards.

---

# Purpose

This document defines the Architecture Decision Record (ADR) practice for the AEOS.

An ADR is the durable, versioned record of a significant architectural decision: what was decided, why, what was rejected, and what the decision costs. The ADR practice exists so that architectural knowledge lives in the repository, not in memory, chat history, or the heads of the engineers who happened to be present.

This document covers what an ADR is and why it matters, when one is required, the ADR template, the ADR lifecycle, numbering and storage conventions, how ADRs link to code and the changelog, and a review checklist.

This is a **core, platform-agnostic** standard. The content of any given ADR may reference concrete technologies (for the current project, a specific database, cloud, or model vendor), but the *practice* of recording decisions is universal. Vendor-specific decision templates or tooling, if any, belong in the AEOS extensions layer (`AEOS/docs/extensions/`).

---

# Decision-Record Philosophy

The governing principle of this document:

> **An architectural decision that is not recorded did not happen — it will be silently re-litigated, accidentally reversed, or quietly violated.**

Three corollaries:

1. **Decisions are facts, and facts need evidence.** The reasoning behind a decision is part of the system's design and must be preserved as carefully as the code.
2. **Trade-offs are the decision.** Recording only the chosen option hides the most valuable information: what it cost and what was given up.
3. **The record is alive.** Decisions are superseded as the system evolves; the practice tracks that evolution rather than freezing a snapshot.

The architecture standards (document 05) already require an ADR for significant architectural decisions. This document defines how that requirement is fulfilled.

---

# What an ADR Is, and Why

An ADR is a short, structured document capturing a single architectural decision and its context.

An ADR is **not**:

* a design document for an entire system,
* a task ticket,
* a status update,
* a place to record trivial or easily reversible choices.

An ADR **is**:

* a record of one consequential, hard-to-reverse decision,
* the reasoning that justified it at the time it was made,
* the alternatives that were weighed and why they lost,
* the consequences the team accepted by choosing it.

Why the practice matters:

* **Onboarding.** New engineers understand *why* the system is the way it is without archaeology.
* **Preventing regression.** A recorded decision is harder to undo by accident; a reviewer can point to the ADR.
* **Honest change.** When circumstances change, the team supersedes a decision deliberately rather than drifting away from it.
* **Constitutional alignment.** ADRs are how the architecture-preservation Prime Directive (document 00) becomes auditable: a change to architecture is legitimate only when it is recorded.

---

# When an ADR Is Required

An ADR is required when a decision is both **significant** and **costly to reverse**. Specifically, record an ADR when the decision:

* introduces, replaces, or removes a major technology, framework, or external dependency,
* changes a public or cross-domain contract (API shape, schema, data model, event format),
* alters the security or authorization posture of the system,
* changes how the system scales, partitions data, or handles consistency,
* establishes or changes a cross-cutting pattern (error handling, caching, eventing, retries),
* deviates from an established AEOS architecture standard or a prior ADR,
* accepts a material piece of technical debt or a backward-incompatible change,
* amends the AEOS Constitution or corpus (such amendments are recorded as ADRs per document 00).

An ADR is **not** required for:

* routine bug fixes within existing behavior,
* refactoring that preserves contracts and patterns,
* implementation details fully contained within a single module that no other code depends on,
* easily reversible choices with no cross-cutting impact.

When in doubt, ask: *if a future engineer reversed this without knowing why it was made, would something break or someone be surprised?* If yes, write an ADR.

---

# The ADR Template

Every ADR uses the following structure. Keep each section tight; an ADR is valuable because it is short.

```text
# ADR-NNNN: <short, decision-oriented title>

Status: <Proposed | Accepted | Superseded by ADR-MMMM | Deprecated>
Date: <YYYY-MM-DD>
Deciders: <names or roles>
Related: <ADR/doc/code links>

## Context
The forces at play: the situation, constraints, requirements, and
assumptions that make a decision necessary. State facts, not opinions.

## Problem
The specific question being decided, in one or two sentences.

## Options Considered
A list of the genuine candidate options. Each option gets a fair,
honest description - including the ones not chosen.

## Decision
The option chosen, stated unambiguously. "We will ..."

## Trade-offs
What this choice costs. What is gained and what is given up. The
explicit price of the decision.

## Consequences
What becomes true once this is adopted: new constraints, new
capabilities, follow-up work, and risks to monitor.

## Alternatives Rejected
For each option not chosen, the specific reason it lost. This is
where future engineers learn why the obvious-looking path was avoided.
```

Template rules:

* **Context before Decision.** A reader must understand the forces before reading the choice.
* **Honest options.** Do not strawman rejected alternatives. The record is only useful if the alternatives were considered fairly.
* **Trade-offs are mandatory.** An ADR with no stated cost is incomplete; every real decision has a price.
* **No placeholders.** Per the constitution, an ADR ships complete. Empty sections marked "TBD" are not permitted in an Accepted ADR.

---

# ADR Lifecycle

An ADR moves through a defined set of states. The status is always current at the top of the record.

```text
Proposed
        v
Accepted
        v
Superseded   (by a newer ADR)
        v
Deprecated   (no longer relevant, not replaced)
```

## Proposed

The decision is drafted and under review. The reasoning, options, and trade-offs are written out for others to evaluate. No code should depend on a merely proposed decision.

## Accepted

The decision is approved and in force. From this point it governs implementation, and deviations require either a new ADR or an amendment. Acceptance requires the appropriate approval (see Approval and Authority).

## Superseded

A later ADR replaces this one. The superseded ADR is **never deleted**; its status is updated to point at the ADR that replaces it, and the new ADR references the one it supersedes. The history of how the architecture evolved must remain readable.

## Deprecated

The decision is no longer relevant (the subsystem was removed, the constraint disappeared) but no replacement decision exists. Mark it deprecated rather than deleting it, so the record of why it once existed is preserved.

Lifecycle rules:

* ADRs are immutable in substance once Accepted. To change a decision, write a new ADR that supersedes it. Only the status line and cross-links of a superseded ADR are edited.
* Every status transition records its date.
* A superseded or deprecated ADR remains in the repository forever as part of the design history.

## Approval and Authority

Acceptance of an ADR requires approval proportional to its impact. An ADR that touches a live product invariant, security posture, or a breaking contract requires explicit human approval, consistent with the authority hierarchy in document 00 — and where an ADR would conflict with a product invariant, the invariant wins and the ADR must be redesigned.

---

# Numbering and Storage Conventions

ADRs are numbered and stored consistently so they are easy to find and reference.

* **Numbering.** ADRs are numbered sequentially with a zero-padded identifier: `ADR-0001`, `ADR-0002`, and so on. Numbers are never reused, even when an ADR is superseded or deprecated.
* **Filename.** One ADR per file, named by number and a slug of the title, for example `0007-adopt-event-driven-notifications.md`.
* **Location.** ADRs live in a single, well-known directory in the repository (an `adr/` or `docs/adr/` directory). The exact path is a project convention and, if it varies by project, is fixed in extensions.
* **Title.** The title states the decision, not the topic: "Adopt X for Y," not "Notifications."
* **One decision per ADR.** If a change bundles several independent decisions, split them into separate ADRs so each can be superseded independently.

---

# Linkage to Code and Changelog

An ADR is only valuable if the people changing the code can find it.

* **Code references the ADR.** Where code implements or is constrained by a decision, a comment or module-level note links to the governing ADR by number. This turns a "why is this like this?" moment into a one-click answer.
* **The ADR references the code.** The Related section links to the primary modules, migrations, or contracts the decision governs.
* **The changelog references the ADR.** Releases that implement or supersede an architectural decision cite the ADR in the changelog and release notes (document 21), so the version history and the decision history stay connected.
* **Reviews reference the ADR.** A pull request that deviates from established architecture must cite the new ADR authorizing the deviation; a reviewer is entitled to reject a deviation that lacks one.
* **Amendments reference the ADR.** Constitutional and corpus amendments (document 00) are recorded as ADRs, linking the rationale to the version change.

This bidirectional linkage is the mechanism that keeps architecture, code, and release history mutually consistent.

---

# ADR Review Checklist

Before accepting an ADR, confirm each item. Use '-' for each check.

- The decision is genuinely significant and costly to reverse (an ADR is warranted).
- The Context states the real forces, constraints, and assumptions as facts.
- The Problem is a single, clearly framed question.
- The Options Considered are real, fairly described, and include the rejected ones.
- The Decision is stated unambiguously as a commitment.
- The Trade-offs section names the explicit price of the decision.
- The Consequences section lists new constraints, capabilities, follow-ups, and risks.
- The Alternatives Rejected section gives a specific reason each loser lost.
- No section is empty, hand-waved, or marked TBD (no placeholder content).
- The decision does not violate any product invariant; if it touches one, the invariant prevails.
- Approval authority is appropriate to the impact; human approval is present where required.
- The ADR has a unique, non-reused number and a decision-oriented title.
- Bidirectional links exist: code to ADR, ADR to code, and changelog to ADR where applicable.
- Any decision this one replaces is marked Superseded and cross-linked, not deleted.

If any item fails, the ADR is not ready to accept.

---

# References

* `05_ARCHITECTURE_STANDARDS.md` — The architecture governance that requires an ADR for significant decisions; this document defines how that requirement is met.
* `15_DOCUMENTATION.md` — The documentation discipline ADRs are part of; ADRs are durable design documentation, not disposable notes.
* `29_CONTINUOUS_IMPROVEMENT.md` — Accepted technical debt is recorded and tracked; material debt acceptance is itself an ADR-worthy decision.
* `00_AI_CONSTITUTION.md` — The architecture-preservation Prime Directive and the rule that product invariants override any decision.
* `21_RELEASE_MANAGEMENT.md` — The changelog and release-notes linkage that ties decisions to versions.
* `AEOS/docs/extensions/` — Project-specific ADR directory paths and any vendor-specific decision templates.

---

# Final Directive

Architecture is the sum of decisions, and decisions decay into folklore the moment they go unrecorded.

Record every significant decision. State its cost honestly. Keep the rejected alternatives so the path not taken is never accidentally re-taken. Supersede deliberately; never drift.

A system whose decisions are written down can be understood, defended, and evolved. A system whose decisions live only in memory cannot be trusted to survive the people who built it.

**End of Document**
