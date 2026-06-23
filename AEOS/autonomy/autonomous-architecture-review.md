# Autonomous Architecture Review

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v2.0
**Classification:** Autonomy Standard
**Priority:** Critical
**Applies To:** Every change an AEOS agent reviews for architectural conformance — code, schema, migrations, API contracts, dependency additions, and cross-domain interactions — across all repositories and environments.

---

# Purpose

This document defines how an AEOS agent reviews changes for **architectural conformance autonomously**: checking a change against the architecture standards (`05_ARCHITECTURE_STANDARDS.md`) and the accepted Architecture Decision Records (`25_ARCHITECTURE_DECISIONS.md`), detecting architectural drift and dependency-rule violations, and knowing exactly when to stop and escalate to a human architect.

Architecture is a strategic asset (`05_ARCHITECTURE_STANDARDS.md`). Prime Directive 7 of the Constitution (`00_AI_CONSTITUTION.md`) requires that architecture be preserved — boundaries respected, abstractions kept intact, business logic not duplicated, circular dependencies not introduced. Governed autonomy lets an agent enforce that preservation continuously, on every change, without waiting for a human architect to be in the room. What it does not do is let an agent unilaterally *change* the architecture: a genuine architectural change requires an ADR, and an ADR that touches a product invariant or security posture requires human approval.

The governing rule of autonomous architecture review:

> **An agent may detect, report, and block architectural drift on its own authority. It may never approve a deviation from an accepted standard or ADR on its own authority — every deviation requires either conformance or a new, approved ADR.**

---

# The Review Model

Autonomous architecture review runs as an independent conformance check on every change that touches structure, contracts, dependencies, or cross-domain boundaries. It is a specialization of the critic role in `autonomous-verification.md`, focused on architecture.

```text
CHANGE submitted
        v
identify architectural surface ( layers, domains, contracts, deps )
        v
check against doc 05 standards
        v
check against accepted ADRs ( doc 25 )
        v
detect drift + dependency-rule violations
        v
verdict: conformant | deviation-needs-ADR | escalate-to-human
```

The reviewer reasons from the standards and the ADRs as facts, not from preference. A finding is backed by the specific standard or ADR it violates, classified by evidence the way every AEOS claim is (`10_VERIFICATION_ENGINE.md`): a violation the reviewer has read in the diff is Observed; one it has confirmed by running a dependency or boundary check is Verified.

---

# Checking Against the Architecture Standards (Doc 05)

The reviewer checks every change against the binding principles of `05_ARCHITECTURE_STANDARDS.md`. The most load-bearing checks:

* **Layering.** Communication flows downward through defined interfaces — Presentation → API / Controllers → Application Services → Domain Services → Repositories / Data Access → Database / External Systems. No layer is bypassed for convenience.
* **Separation of concerns.** Business logic lives in application or domain services, never in controllers, UI components, database migrations, or infrastructure code. Controllers coordinate, services orchestrate, domain models enforce rules, repositories persist.
* **Domain boundaries.** Each domain owns its entities, services, repositories, rules, and data. One domain does not reach into another domain's data directly; cross-domain interaction flows through services or events. Cross-domain coupling stays minimal.
* **External-integration isolation.** Payment gateways, AI providers, email, and messaging sit behind adapter interfaces. Business logic does not depend directly on vendor SDKs, so a provider can be replaced with minimal impact.
* **API boundary integrity.** External interactions occur through explicit interfaces; internal implementation detail is not exposed; an internal change does not force a public-contract change unless behavior changes.
* **Security in every layer.** Authentication and authorization are both enforced; least privilege holds; no privileged or service-role credential crosses into a client-facing surface (Prime Directive 6).

A change that satisfies these is conformant. A change that violates one is reported with the specific principle it breaks.

---

# Checking Against Accepted ADRs (Doc 25)

Standards define the general law; ADRs record the specific, binding decisions the platform has committed to. The reviewer checks every change against the **accepted** ADRs that govern the affected area.

* **An accepted ADR is binding.** A change that contradicts an Accepted ADR is a deviation, even if it satisfies the general standards. The reviewer cites the ADR by number.
* **Code-to-ADR linkage is verified.** Where code implements or is constrained by a decision, the governing ADR should be discoverable (`25_ARCHITECTURE_DECISIONS.md`). A change that silently undoes a recorded decision without a superseding ADR is drift, not evolution.
* **A deviation requires a new ADR.** If a change genuinely needs to depart from an accepted decision, the correct path is a new ADR that supersedes the old one — never a quiet contradiction. The reviewer is entitled to reject a deviation that lacks one.
* **Superseded decisions are not silently re-litigated.** A change that re-introduces an approach a prior ADR explicitly rejected is flagged; the rejected-alternatives section of the old ADR is the evidence.

The reviewer never accepts an ADR or approves a deviation on its own authority. Acceptance of an ADR that touches a product invariant, security posture, or breaking contract requires human approval, and where an ADR would conflict with a product invariant, the invariant wins and the ADR must be redesigned.

---

# Detecting Architectural Drift

Drift is the slow erosion of architecture by changes that each look harmless but cumulatively weaken the design. The reviewer actively looks for it:

* **Duplicated business logic** — the same rule implemented in two places instead of extracted to a shared service.
* **Leaked abstractions** — internal implementation detail surfacing across a boundary it should not cross.
* **Bypassed layers** — a controller or UI component reaching a repository or the database directly.
* **Vendor coupling creep** — a vendor SDK call appearing in business logic instead of behind an adapter.
* **Boundary blurring** — a domain quietly reading or writing another domain's data.
* **Undocumented debt** — a temporary solution that was never time-boxed, risk-assessed, or recorded, drifting toward permanence (`05_ARCHITECTURE_STANDARDS.md` allows debt only when explicitly documented, time-bound, risk-assessed, and approved).

Each drift finding cites the principle or ADR it erodes and is classified by evidence. Drift is reported even when no single rule is outright broken, because the cumulative cost is the harm.

---

# Detecting Dependency-Rule Violations

The dependency rule of `05_ARCHITECTURE_STANDARDS.md` is non-negotiable: **dependencies always point inward toward business logic.** Business rules must not depend on UI frameworks, databases, cloud providers, third-party SDKs, or HTTP implementations — those are implementation details.

The reviewer checks the direction of every new dependency a change introduces:

* A domain or application service that imports a UI framework, an HTTP client, or a vendor SDK directly is a violation.
* A business rule whose correctness depends on a database feature or a cloud-provider behavior is a violation — the rule belongs in the service layer, the persistence detail behind a repository.
* A circular dependency between modules or domains is a violation regardless of direction; modules must remain independently understandable and testable.
* A shared library that has accumulated business rules is a violation — shared packages hold reusable, framework-agnostic functionality only, and must not become dumping grounds.

Each violation is reported with the specific import or coupling that points the wrong way, so the producer can correct the direction rather than guess at the intent.

---

# When to Escalate to a Human Architect

Autonomy has a hard ceiling in architecture review. The reviewer **escalates to a human architect** — and does not proceed on its own authority — when a change:

* requires a **new or superseding ADR** that touches a product invariant (P1-P15), the security or authorization posture, or a breaking public/cross-domain contract,
* introduces, replaces, or removes a **major technology, framework, or external dependency**,
* changes how the system **scales, partitions data, or handles consistency**,
* establishes or changes a **cross-cutting pattern** (error handling, caching, eventing, retries) the whole platform inherits,
* proposes to **accept material technical debt** or a backward-incompatible change,
* would **amend the AEOS corpus or the agent system** itself.

The escalation is not a soft suggestion. The reviewer halts the change at the architecture gate, records the specific decision that exceeds its authority, and surfaces it for human judgment. It does not pre-stage the deviation, route around the gate, or proceed assuming approval. This is the architecture-specific expression of the approval boundary in `EXECUTION_ENGINE.md` and the authority hierarchy in `00_AI_CONSTITUTION.md`: the agent owns conformance enforcement; the human owns the decision to change the architecture.

For changes below this ceiling — conformant refactors, implementation details fully contained in one module, easily reversible choices with no cross-cutting impact — no ADR and no escalation are required, and the reviewer proceeds autonomously.

---

# The Review Verdict

Every autonomous architecture review ends in one verdict, with the evidence supporting it:

* **Conformant** — the change respects the standards and the accepted ADRs; no drift, no dependency-rule violation. The change proceeds.
* **Deviation needs ADR** — the change departs from a standard or an accepted ADR; it is held until a new ADR is authored and, where required, human-approved.
* **Escalate to human architect** — the change crosses the autonomy ceiling; it is halted and surfaced for human judgment.

A verdict is backed by the specific standard, ADR, or dependency rule it rests on. A conformance claim made without that evidence is an assertion, not a review.

---

# Autonomous Architecture Review Checklist

Before issuing an architecture-review verdict, confirm each item. Use a dash for each check.

- The architectural surface of the change is identified: layers, domains, contracts, dependencies.
- The change is checked against the layering rule; no layer is bypassed.
- Business logic stays in services, not in controllers, UI, migrations, or infrastructure.
- Domain boundaries hold; no domain reaches into another domain's data directly.
- External integrations sit behind adapters; no vendor SDK leaks into business logic.
- Every accepted ADR governing the area is checked; no decision is silently contradicted.
- Dependencies point inward; no business rule depends on UI, DB, cloud, SDK, or HTTP detail.
- No circular dependency is introduced; shared libraries hold no business rules.
- Drift is reported even where no single rule is outright broken.
- Least privilege holds; no privileged or service-role credential reaches a client surface.
- Any genuine architectural change is held for a new, approved ADR — never approved autonomously.
- Any invariant-touching, security-posture, scaling, cross-cutting, or corpus change is escalated to a human architect.
- The verdict (conformant / deviation-needs-ADR / escalate) cites the specific standard, ADR, or rule.

If any item fails, the review is not complete.

---

# References

Read this document together with:

* `05_ARCHITECTURE_STANDARDS.md` — The binding architecture principles, the layering model, the dependency rule, and the architecture review checklist this document enforces autonomously.
* `25_ARCHITECTURE_DECISIONS.md` — The ADR practice: what an ADR is, when one is required, the lifecycle, and the rule that a deviation requires a new ADR and that invariant-touching ADRs need human approval.
* `00_AI_CONSTITUTION.md` — Prime Directive 7 (Preserve Architecture), Prime Directive 6 (Least Privilege), the authority hierarchy, and the rule that product invariants override every architectural decision.
* `EXECUTION_ENGINE.md` — The approval boundary that defines when an architectural change must pause for human judgment.
* `10_VERIFICATION_ENGINE.md` — The evidence classification every conformance finding is recorded under.
* `runbooks/sre.md` — v1.1 operational guidance for the reliability and scaling concerns an architecture review surfaces.
* `guides/performance-tuning.md` — v1.1 guidance for the performance and scalability trade-offs a review must weigh.

Where this document and a higher-authority source appear to conflict, the higher source prevails: the project-root constitution, then `MASTER_SYSTEM_PROMPT.md`, then `EXECUTION_ENGINE.md`, then the numbered AEOS documents, then extensions, then the task.

---

# Final Directive

Autonomous architecture review is how the platform's design survives a thousand small changes that no human reviewed individually.

Check every change against the standards and the decisions already made. Detect drift before it compounds. Hold the line on the dependency rule, because the moment business logic depends on a framework, the architecture has begun to die. Enforce conformance on your own authority — and escalate the moment a change asks you to *change* the architecture rather than respect it.

Architecture is the sum of decisions, and decisions decay into folklore the moment they go unrecorded. An agent that enforces conformance continuously, and escalates honestly when the design must change, is how that decay is prevented.

When convenience and architecture conflict, architecture wins. When an architectural change and a product invariant conflict, the invariant wins. Review every change accordingly.

**End of Document**
