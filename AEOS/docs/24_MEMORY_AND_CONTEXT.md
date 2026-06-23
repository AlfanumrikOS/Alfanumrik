# 24_MEMORY_AND_CONTEXT.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Mandatory Engineering Memory and Context Standard
**Priority:** P0 (Critical)
**Applies To:** Every Claude Code session, every engineering task, and every AI agent operating on the Alfanumrik platform.

---

# Purpose

This document defines how durable engineering memory and session context are established, preserved, and consumed across every engineering activity on the Alfanumrik platform.

An AI engineer has no persistent recollection between sessions. Each session begins with an empty working memory. Without a disciplined approach to memory and context, an AI agent will repeatedly rediscover the same decisions, re-litigate settled trade-offs, and reintroduce defects that were already resolved.

Claude Code shall treat engineering memory as infrastructure. Memory is not a transcript of conversation; it is a set of durable, version-controlled artifacts that survive the end of a session.

---

# Engineering Philosophy

Conversation is volatile. Artifacts are durable.

Anything that matters must be written into a durable artifact before the session ends, or it is effectively lost.

Engineering memory exists so that a future agent, with no knowledge of this session, can:

- understand why a decision was made,
- reproduce the reasoning behind a convention,
- avoid repeating a prior incident,
- resolve terminology without guessing,
- locate the owner of a subsystem,
- continue work without re-deriving context from scratch.

If knowledge lives only in a chat transcript, it does not exist as far as the next session is concerned.

---

# Why Durable Memory Matters For AI Agents

AI agents are uniquely dependent on durable memory for the following reasons:

- Sessions are stateless. Working context is discarded between runs.
- Context windows are finite. Not all history can be reloaded even within a single session.
- Agents reason from what is loaded, not from what is true. Unloaded knowledge is invisible.
- Multiple agents operate on the same platform. Shared memory is the only coordination substrate.
- Hallucination risk rises when context is missing. An agent without grounding will fabricate.

Durable memory converts one-time reasoning into a permanent platform asset. It is the mechanism by which the platform becomes more knowledgeable over time rather than repeatedly relearning the same lessons.

---

# What Must Be Remembered

The following categories of knowledge are mandatory durable memory. Each must live in a version-controlled artifact, never solely in conversation.

### Decisions and Architecture Decision Records

Every significant technical decision must be captured as an Architecture Decision Record. An ADR records context, problem, options considered, the decision, trade-offs, and consequences. ADR practice is governed by `25_ARCHITECTURE_DECISIONS`.

### Conventions

Coding conventions, naming patterns, directory structure rules, invariant formulas, and platform-specific patterns. A convention that is not written down will be violated by the next agent.

### Prior Incidents

Production incidents, root causes, and the corrective actions taken. An incident that is not recorded will recur. Regression tests are the executable form of incident memory.

### Glossary

Domain terminology and its precise meaning. On Alfanumrik this includes terms such as mastery, Bloom level, XP velocity, grade (always a string), and the names of the product invariants. Ambiguous terms cause defects.

### Ownership

Which agent or domain owns each subsystem, who reviews changes to it, and who approves breaking changes. Ownership memory prevents unauthorized boundary violations.

---

# Source-Of-Truth Discipline

Every category of knowledge has exactly one authoritative source. Duplicating knowledge across multiple locations creates drift, and drift creates defects.

Rules of source-of-truth discipline:

- Each fact has one canonical home.
- Other locations may reference the canonical home but must not restate it.
- When two sources disagree, the higher-authority source wins and the lower source is corrected.
- Point-in-time values (counts, inventories, metrics) are labeled as point-in-time and reconciled per release.

The authority hierarchy for governance is fixed:

```
project-root constitution
        v
AEOS/MASTER_SYSTEM_PROMPT.md
        v
AEOS/EXECUTION_ENGINE.md
        v
AEOS docs 00-29
        v
extensions
        v
current task
```

When AEOS guidance and a product invariant disagree, the product invariant wins. The discrepancy is logged for reconciliation, never silently resolved.

---

# How Context Is Loaded At Session Start

A session is not ready to perform engineering work until context has been loaded. Loading context is the first action of every session, before any code is read or written.

The required loading sequence:

1. Read the project-root constitution and its product invariants. This establishes what must never break.
2. Read `00_AI_CONSTITUTION`, the supreme AEOS governance document.
3. Identify the task domain and load only the task-relevant AEOS docs. API work loads `06_API_ENGINEERING`; schema work loads `07_DATABASE_ENGINEERING`; every change loads `10_VERIFICATION_ENGINE` and `08_TESTING_PROTOCOL`.
4. Load the relevant ADRs, runbooks, and prior incident records for the subsystem being touched.
5. Consult the applicable vendor extension for the technology in use.
6. Confirm ownership and review-chain requirements for the files in scope.

Do not load all documents at once. Load the constitution plus the task-relevant subset. Loading everything wastes context budget and buries the relevant facts.

---

# Avoiding Context Loss Across Sessions

Context is lost in three ways: it is never captured, it is captured in a volatile place, or it is captured but not reloaded.

To prevent each failure mode:

### Capture before ending

Before a session concludes, every decision, deviation, discovered constraint, and unresolved risk must be written into a durable artifact. A session that ends without capture has destroyed its own work product.

### Capture in durable places

Knowledge goes into ADRs, the changelog, runbooks, documentation, code comments, or tests. It does not go into a chat message and nowhere else.

### Reload deliberately

The next session must reload the captured artifacts. Capture without reload is wasted effort. The context-readiness checklist below enforces deliberate reload.

A handoff note at the end of a session should state: what was done, what was verified, what remains, and which artifacts were updated. This is the bridge between a closing session and the next one.

---

# Capturing Knowledge Into Durable Artifacts

Knowledge must be routed to the correct durable artifact based on its kind. The mapping is fixed:

| Knowledge Kind | Durable Artifact |
|---|---|
| A technical decision | ADR (`25_ARCHITECTURE_DECISIONS`) |
| A behavior change | Changelog and updated documentation (`15_DOCUMENTATION`) |
| An operational procedure | Runbook (`15_DOCUMENTATION`) |
| An incident and its fix | Regression test plus incident record |
| A convention or pattern | The relevant AEOS doc or repository standard |
| A term definition | The glossary |
| An ownership rule | The ownership matrix |

Chat is never a durable artifact. A statement made only in conversation is not captured.

When code behavior changes, the documentation change is part of the same task, not a follow-up. If implementation and documentation disagree, the discrepancy must be resolved before the task is considered complete.

---

# Memory Hygiene

Durable memory degrades if not maintained. Stale memory is worse than no memory because it is trusted while being wrong.

Hygiene practices:

- Outdated documentation is a defect and is fixed, not tolerated.
- Superseded ADRs are marked superseded and linked to their replacement, never deleted.
- Point-in-time figures are reconciled on a defined cadence.
- Duplicated facts are collapsed to a single source.
- Dead references to removed files or systems are pruned.

When AEOS and reality diverge, reality wins and the document is corrected.

---

# Multi-Agent Shared Memory

Multiple specialist agents operate on Alfanumrik. They do not share working memory; they share durable artifacts.

For coordination to work:

- An agent records its decisions where other agents will load them.
- An agent reads the ownership matrix before touching a subsystem it does not own.
- An agent that discovers a cross-domain issue records it for the owning domain rather than silently fixing across a boundary.
- Review-chain obligations are treated as memory: a change to a critical file carries a permanent record of who must review it.

Shared durable memory is the only reliable coordination mechanism between stateless agents.

---

# Context-Readiness Checklist

A session is not ready to perform engineering work until every item below is satisfied.

- Project-root constitution and product invariants loaded
- `00_AI_CONSTITUTION` loaded
- Task domain identified
- Task-relevant AEOS docs loaded (not all docs)
- `10_VERIFICATION_ENGINE` and `08_TESTING_PROTOCOL` loaded for any change
- Relevant ADRs reviewed for the subsystem in scope
- Relevant runbooks and prior incident records reviewed
- Applicable vendor extension consulted
- Ownership and review-chain requirements confirmed for files in scope
- Glossary terms for the domain confirmed, not assumed
- Source of truth identified for any fact about to be relied upon
- Handoff note from the prior session reviewed, if one exists

If any item is unsatisfied, complete it before writing code.

---

# Memory-Capture Checklist

Before a session ends, every item below must be satisfied.

- Decisions captured as ADRs
- Behavior changes reflected in documentation and changelog
- New or changed operational procedures captured as runbooks
- Incidents captured as regression tests and incident records
- New conventions written into the relevant standard
- New terms added to the glossary
- Source-of-truth discipline preserved (no duplicated facts)
- Handoff note written: done, verified, remaining, risks, artifacts touched

A session that cannot check every box has not finished capturing its memory.

---

# Anti-Patterns

The following are prohibited:

- Relying on chat history as a source of truth.
- Ending a session without capturing decisions into durable artifacts.
- Restating a fact in multiple locations instead of referencing one source.
- Loading no context and proceeding to write code from assumption.
- Trusting stale documentation without verifying against reality.
- Fixing a cross-domain issue silently without recording it for the owning domain.
- Treating a verbal decision as binding when it was never written down.

---

# Definition Of Context Complete

Context is complete only when:

- The constitution and product invariants are loaded.
- The task-relevant AEOS docs are loaded.
- Subsystem ADRs, runbooks, and incident records are reviewed.
- Ownership and review-chain obligations are known.
- The source of truth for every relied-upon fact is identified.
- No relied-upon fact is being taken from conversation alone.

# Definition Of Memory Complete

Memory is complete only when:

- Every decision, behavior change, incident, convention, and term from the session is captured in a durable artifact.
- Documentation is synchronized with implementation.
- A handoff note exists for the next session.
- No knowledge from the session lives solely in conversation.

---

# References

- `00_AI_CONSTITUTION` - Supreme AEOS governance; the posture all memory and context discipline serves.
- `15_DOCUMENTATION` - Documentation engineering standard; the home of changelog, runbooks, and synchronized docs.
- `25_ARCHITECTURE_DECISIONS` - ADR practice; the durable home of every significant technical decision.
- `29_CONTINUOUS_IMPROVEMENT` - How AEOS itself evolves; memory hygiene feeds the improvement loop.

---

# Final Directive

Claude Code shall treat memory and context as engineering infrastructure, not as a byproduct of conversation.

No session shall begin engineering work without loading the required context.

No session shall end without capturing its decisions, behavior changes, incidents, and conventions into durable, version-controlled artifacts.

Knowledge that lives only in conversation does not exist. Every session must leave the platform's durable memory more complete and more accurate than it found it.

**End of Document**
