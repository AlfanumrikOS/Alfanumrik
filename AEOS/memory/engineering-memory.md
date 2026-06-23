# Engineering Memory

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v2.0
**Classification:** Autonomy / Knowledge Standard
**Priority:** P0 (Critical — without durable memory, an autonomous agent rediscovers settled decisions, re-litigates trade-offs, and reintroduces fixed defects)
**Applies To:** Every autonomous and human-supervised engineering session on the Alfanumrik platform — every agent that reads, reasons, decides, writes, verifies, or hands off work.

---

# Purpose

AEOS v1.0 and v1.1 established the discipline; document `24_MEMORY_AND_CONTEXT` set the principle that conversation is volatile and artifacts are durable. v2.0 governs **governed autonomy** — agents that run with less human-in-the-loop supervision across many sessions. That magnifies the stakes of memory: an autonomous loop with amnesia does not merely slow down, it actively degrades the platform by re-deriving context wrong, drifting from settled decisions, and silently violating boundaries it cannot remember.

This document is the operational standard for **durable cross-session engineering memory**. It defines what an autonomous agent MUST persist, where each kind of knowledge lives, how memory is loaded at session start, the source-of-truth discipline that prevents drift, and the staleness/reconciliation loop that keeps memory trustworthy. It builds directly on doc 24 and binds to the documentation, ADR, and content-QA standards.

Its companion, `AEOS/memory/knowledge-graph.md`, defines the structured grounding layer — entities and relationships — that this memory feeds. Memory is what an agent persists; the knowledge graph is how an agent queries and grounds on it.

---

# Engineering Philosophy

Three sentences govern everything below.

1. **Conversation is volatile; artifacts are durable.** An autonomous agent's working context is discarded between runs. Anything that matters must land in a version-controlled artifact before the session ends, or it is lost.
2. **Agents reason from what is loaded, not from what is true.** Unloaded knowledge is invisible, and invisible knowledge gets fabricated. Durable memory exists so the next session reasons from fact, not from guess.
3. **Memory is infrastructure, not a byproduct.** It is engineered, reviewed, reconciled, and pruned with the same discipline as source code (doc 15: documentation is part of the software).

The test of complete memory: a future agent, with zero knowledge of this session, can understand why a decision was made, reproduce a convention, avoid a prior incident, resolve a term without guessing, locate the owner of a subsystem, and continue the work without re-deriving context from scratch.

---

# Why Durable Memory Matters More Under Autonomy

Governed autonomy removes the human who, in a supervised session, silently carried context between runs. Under v2.0 that carrier is gone, so the durable substrate must carry everything:

- **Sessions are stateless and unsupervised.** No human re-explains the system between runs; the artifacts must.
- **Loops compound their own errors.** An autonomous loop that misremembers a threshold re-applies the wrong threshold every cycle. Memory is the brake on compounding drift.
- **Multiple agents share no working memory.** The orchestrator, ai-engineer, assessment, architect, and the rest coordinate only through durable artifacts — the ownership matrix, the regression catalog, the ADRs.
- **Grounding suppresses fabrication.** An autonomous agent with retrievable memory grounds its claims; one without it hallucinates file paths, APIs, and metrics. This mirrors the RAG groundedness discipline the platform already enforces on student-facing AI (`grounded-answer/grounding-check.ts`).

Durable memory converts one-time reasoning into a permanent platform asset. The platform must get smarter across sessions, never relearn the same lesson twice.

---

# What MUST Be Persisted

Each category below is mandatory durable memory. None may live solely in a chat transcript. Each has exactly one canonical home (see Source-Of-Truth Discipline).

### Decisions and ADRs

Every significant, hard-to-reverse decision is an Architecture Decision Record per `25_ARCHITECTURE_DECISIONS`: context, problem, options, decision, trade-offs, consequences, alternatives rejected. An autonomous agent that makes such a decision MUST write the ADR in the same task, not as a follow-up. Superseded ADRs are marked superseded and cross-linked, never deleted — the path not taken must stay readable so it is never accidentally re-taken.

### Incidents and Root-Cause Analyses

Production incidents, their root causes (doc 23), and corrective actions. The executable form of incident memory is a regression test plus a catalog entry — that is how the platform already remembers, for example, the 2026-04-27 RAG retrieval-RPC drift (F10), the silent-zero marking footprint (REG-51..REG-53), and the single-retrieval contract that caps Foxy at one retrieval per turn (REG-50). An incident without a regression test will recur.

### Conventions and Invariants

Coding conventions, naming patterns, directory rules, and the invariant formulas that cannot drift: grades are strings `"6"`–`"12"` (P5); the score formula `Math.round((correct/total)*100)` (P1); XP constants live only in `src/lib/xp-rules.ts` (P2). A convention not written down will be violated by the next agent.

### Ownership and Review Chains

Which agent owns each subsystem, who reviews changes, who approves breaking changes. An autonomous agent MUST read the ownership matrix before touching a subsystem it does not own, and MUST record (not silently cross fix) any issue it discovers across a boundary. Review-chain obligations are themselves memory: an AI-tutor or RAG change permanently carries the obligation to route to assessment and testing (P14).

### The Regression Catalog

`.claude/regression-catalog.md` is the durable, append-mostly ledger of every regression test that must exist and pass before release (102 entries at the v2.0 reconciliation point). It is incident memory in executable form. Removing an entry requires explicit user approval. An autonomous agent fixing a bug adds the catalog entry that prevents its return.

### Glossary

Domain terminology with precise meaning: mastery (BKT P(known)), Bloom level, XP velocity, ZPD, groundedness-rate, degraded run, the names and numbers of product invariants P1–P15. Ambiguous terms cause defects; the glossary is their single source of truth.

### Handoff Notes

The bridge between a closing session and the next. State: what was done, what was verified (with evidence), what remains, open risks, and which artifacts were touched. Under autonomy this is the only briefing the next loop receives.

---

# Where Memory Lives — Durable Artifacts, Not Chat

Knowledge is routed to the correct durable artifact by kind. The mapping is fixed (extends doc 24):

| Knowledge Kind | Canonical Durable Home |
|---|---|
| A significant technical decision | ADR (`25_ARCHITECTURE_DECISIONS`) |
| A behavior change | Changelog + synchronized docs (`15_DOCUMENTATION`) |
| An operational procedure | Runbook under `docs/runbooks/` or `docs/superpowers/runbooks/` |
| An incident and its fix | Regression test + `.claude/regression-catalog.md` entry |
| A convention, pattern, or invariant | The relevant AEOS doc, `.claude/CLAUDE.md`, or repository standard |
| A term definition | The glossary (`AEOS/memory/knowledge-graph.md` carries the entity-level glossary) |
| An ownership / review-chain rule | The ownership matrix and `.claude/skills/review-chains/SKILL.md` |
| A platform entity / relationship | `AEOS/memory/knowledge-graph.md` |

The Alfanumrik knowledge layout these route into is real and stable: strategic intent in `docs/superpowers/specs/`, executable plans in `docs/superpowers/plans/`, operational procedure in `docs/superpowers/runbooks/`, executable incident memory in `.claude/regression-catalog.md`, and the live product constitution in `.claude/CLAUDE.md`. Chat is never a durable artifact. A statement made only in conversation is not captured.

---

# How Memory Is Loaded at Session Start

A session is not ready to perform engineering work until memory has been loaded. Loading is the first action, before any code is read or written, and it is deliberately scoped — load the constitution plus the task-relevant subset, never all thirty docs at once.

The required load sequence for an autonomous session:

1. Read the project-root constitution (`.claude/CLAUDE.md`) and its product invariants P1–P15. This establishes what must never break.
2. Read `00_AI_CONSTITUTION`, the supreme AEOS charter.
3. Identify the task domain and load only the task-relevant AEOS docs. Every change loads `10_VERIFICATION_ENGINE` and `08_TESTING_PROTOCOL`; an AI/RAG change additionally loads the `ai-evaluation`, `ai-workflows`, and `prompt-engineering` playbooks.
4. Load the relevant ADRs, runbooks, and prior incident records for the subsystem in scope.
5. Query the knowledge graph (`AEOS/memory/knowledge-graph.md`) for the entities in scope — their owners, dependencies, governing invariants, and the regressions that pin them.
6. Confirm ownership and review-chain obligations for every file in scope.
7. Read the prior session's handoff note, if one exists.

Loading everything wastes the context budget and buries the relevant facts. Scoped, deliberate loading is the discipline.

---

# Source-Of-Truth Discipline

Every fact has exactly one canonical home. Duplicated knowledge drifts, and drift is a defect. Rules:

- Each fact has one canonical home; other locations reference it, never restate it.
- When two sources disagree, the higher-authority source wins and the lower is corrected.
- Point-in-time values — counts, inventories, metrics — are labeled point-in-time and reconciled per release (for example, the 102-entry catalog count and the 29-Edge-Function count are point-in-time).

The fixed authority hierarchy:

```
project-root constitution (.claude/CLAUDE.md, invariants P1-P15)
        v
AEOS/MASTER_SYSTEM_PROMPT.md
        v
AEOS/EXECUTION_ENGINE.md
        v
AEOS docs 00-29
        v
extensions (AEOS/docs/extensions/)
        v
current task
```

When AEOS guidance and a product invariant disagree, the invariant wins and the discrepancy is logged for reconciliation — never silently resolved. AEOS describes how to engineer well; the constitution describes what must never break.

---

# Staleness and Reconciliation

Stale memory is worse than no memory, because it is trusted while being wrong. An autonomous loop trusting a stale threshold is more dangerous than one with no memory at all, because it acts with false confidence.

Hygiene practices (extends doc 24, fed by `29_CONTINUOUS_IMPROVEMENT`):

- Outdated documentation is a defect and is fixed, not tolerated. When AEOS and reality diverge, reality wins and the document is corrected.
- Superseded ADRs are marked superseded and linked to their replacement, never deleted.
- Point-in-time figures are reconciled on a defined cadence (per release, or via the production-readiness audit).
- Duplicated facts are collapsed to a single source.
- Dead references to removed files or systems are pruned — for example, the corrected record that `quiz-generator-v2/` never existed on disk, and that `foxy-tutor/` is frozen and deprecated in favor of the `grounded-answer`/`src/app/api/foxy/route.ts` path.
- An autonomous agent that relies on a fact MUST first confirm its source of truth; a fact taken from conversation alone is not memory.

---

# Multi-Agent Shared Memory

Specialist agents do not share working memory; they share durable artifacts. For coordination to hold under autonomy:

- An agent records its decisions where other agents will load them.
- An agent reads the ownership matrix before touching a subsystem it does not own.
- An agent that discovers a cross-domain issue records it for the owning domain rather than silently fixing across a boundary — for example, ai-engineer records a BKT/IRT threshold concern for assessment rather than changing the rule.
- Review-chain obligations are treated as permanent memory attached to critical files.

Shared durable memory is the only reliable coordination mechanism between stateless agents.

---

# Memory Checklist

A session satisfies the memory standard only when every item holds.

- Constitution, invariants P1–P15, and `00_AI_CONSTITUTION` were loaded before any code was read or written.
- Task-relevant AEOS docs were loaded (scoped, not all thirty).
- Subsystem ADRs, runbooks, and incident records were reviewed.
- The knowledge graph was queried for in-scope entities, owners, dependencies, and pinning regressions.
- Ownership and review-chain obligations were confirmed for every file in scope.
- The prior handoff note was read, if one existed.
- Every significant decision was captured as an ADR in the same task.
- Every behavior change was reflected in the changelog and synchronized docs.
- Every incident was captured as a regression test plus a catalog entry.
- New conventions, terms, and ownership rules landed in their canonical homes.
- Source-of-truth discipline was preserved — no fact restated in two places.
- A handoff note was written: done, verified (with evidence), remaining, risks, artifacts touched.

A session that cannot check every box has not finished capturing its memory.

---

# Anti-Patterns

Prohibited:

- Treating chat history as a source of truth.
- Ending a session without capturing decisions into durable artifacts.
- Restating a fact in multiple locations instead of referencing one source.
- Loading no context and writing code from assumption.
- Trusting stale documentation without verifying against reality.
- Fixing a cross-domain issue silently without recording it for the owning domain.
- Removing a regression-catalog entry without user approval.
- Acting on an autonomous loop's earlier conclusion that was never written down.

---

# References

- `00_AI_CONSTITUTION` — Supreme AEOS charter; the posture all memory discipline serves.
- `15_DOCUMENTATION` — Documentation engineering standard; home of the changelog, runbooks, and synchronized docs.
- `24_MEMORY_AND_CONTEXT` — The principle this document operationalizes for governed autonomy.
- `25_ARCHITECTURE_DECISIONS` — ADR practice; the durable home of every significant decision.
- `29_CONTINUOUS_IMPROVEMENT` — How AEOS evolves; the loop that staleness/reconciliation feeds.
- Sibling: `AEOS/memory/knowledge-graph.md` — the structured grounding layer this memory feeds.
- v1.1 playbooks: `AEOS/playbooks/ai-evaluation.md` (the regression gate on AI quality), `AEOS/playbooks/ai-workflows.md`, `AEOS/playbooks/prompt-engineering.md`.
- Real substrate: `.claude/CLAUDE.md` (live constitution + invariants P1–P15), `.claude/regression-catalog.md` (executable incident memory), `.claude/skills/review-chains/SKILL.md` (ownership/review obligations), `docs/superpowers/{specs,plans,runbooks}/` (knowledge layout), `eval/rag/{harness,golden,baseline}/` (the groundedness discipline mirrored here), `supabase/functions/grounded-answer/grounding-check.ts`, `supabase/functions/_shared/rag/retrieve.ts`.

---

# Final Directive

Under governed autonomy, the agent that remembers nothing is not autonomous — it is a hazard that re-derives the platform wrong on every run.

Load memory before you reason. Persist every decision, incident, convention, ownership rule, and term into its one canonical durable home. Never trust chat as memory, never trust stale memory, and never act on a conclusion that was never written down. Leave the platform's durable memory more complete and more accurate than you found it.

Knowledge that lives only in conversation does not exist. Make it exist, or it dies with the session.

**End of Document**
