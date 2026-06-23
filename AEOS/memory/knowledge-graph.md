# Knowledge Graph

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v2.0
**Classification:** Autonomy / Knowledge Standard
**Priority:** P0 (Critical — the structured grounding layer that keeps autonomous reasoning anchored to platform reality and explainable after the fact)
**Applies To:** Every autonomous and human-supervised engineering session that must reason about the Alfanumrik platform — its features, modules, invariants, owners, dependencies, decisions, and the regressions that pin them.

---

# Purpose

An autonomous agent decides from what it can retrieve. Durable engineering memory (`AEOS/memory/engineering-memory.md`) says what to persist and where; this document defines the **knowledge graph** — the structured map of platform entities and relationships that an agent queries to ground a decision before it acts.

The knowledge graph answers the questions an autonomous loop must answer correctly every time: *What does this module depend on? Which invariant governs this change? Who owns this file and who must review it? Which ADR decided this, and which regression test will break if I get it wrong?* Without a structured answer, the agent guesses — and a guess is a fabrication waiting to reach a student.

This standard is to engineering decisions what the platform's RAG pipeline is to student answers: a grounding substrate that turns "I think" into "the graph says, and here is the edge." It binds to `00_AI_CONSTITUTION`, to `24_MEMORY_AND_CONTEXT`, and to the real RAG/pgvector retrieval and offline-eval substrate already in the repository. Where this document and a product invariant disagree, the invariant wins.

---

# Engineering Philosophy

1. **Ground before you decide.** An autonomous decision unbacked by a graph edge is an opinion. The graph converts opinion into a traceable claim.
2. **Relationships are the knowledge.** A list of modules is inert; the edges — *depends-on*, *governed-by*, *owned-by*, *pinned-by*, *decided-by* — are what let an agent reason about blast radius and obligation.
3. **Explainability is mandatory.** Every autonomous decision must be reconstructable after the fact from the entities and edges it traversed. A decision that cannot be explained from the graph cannot be trusted.

The graph is not a new database. It is a disciplined, queryable view assembled from artifacts the platform already maintains — the constitution, the ownership matrix, the ADR set, the regression catalog, and the `docs/superpowers/` knowledge layout. Its authority derives from those sources; it never restates a fact those sources own (source-of-truth discipline, doc 24).

---

# Entities

The graph's nodes are the things an autonomous agent reasons about. Each entity has a canonical home (the source of truth) that the graph references, never duplicates.

| Entity Type | What It Is | Canonical Home |
|---|---|---|
| **Feature** | A product capability (Foxy tutor, NCERT solver, adaptive quiz, Student Pulse, Curiosity Dive, Synthesis, adaptive loops A/B/C) | `docs/superpowers/specs/`, `.claude/CLAUDE.md` file map |
| **Module** | A code unit: an Edge Function, a `src/lib/` module, an API route, a migration | The file itself + the critical-file map |
| **Product Invariant** | P1–P15 — the rules that cannot break (score accuracy, XP economy, anti-cheat, atomic submission, grade format, question quality, bilingual UI, RLS, RBAC, bundle budget, payment integrity, AI safety, data privacy, review-chain completeness, onboarding integrity) | `.claude/CLAUDE.md` |
| **Owner** | The agent that owns a subsystem (ai-engineer, assessment, architect, backend, frontend, mobile, ops, testing, quality, orchestrator) | Domain-ownership matrix in `.claude/CLAUDE.md` |
| **Dependency** | An external or internal thing a module relies on (pgvector, Voyage rerank-2, Claude Haiku, an RPC, a feature flag) | The module's imports + migration set |
| **ADR** | A recorded architectural decision | `25_ARCHITECTURE_DECISIONS` / the ADR directory |
| **Regression** | A catalogued test that pins behavior (REG-NN, SG-N) | `.claude/regression-catalog.md` |
| **Term** | A glossary entity (mastery, Bloom level, ZPD, groundedness-rate, degraded run) | The glossary |

Entities are versioned by their canonical home. The graph is a point-in-time view; counts and inventories (29 Edge Functions, 102 catalogued regressions) are reconciled per release.

---

# Relationships

The edges are where reasoning happens. The core edge types:

- **`module --depends-on--> dependency`** — e.g. `grounded-answer --depends-on--> pgvector`, `--depends-on--> Voyage rerank-2`, `--depends-on--> Claude Haiku`. Lets an agent compute blast radius before a change.
- **`module --governed-by--> invariant`** — e.g. `foxy/grounded-answer --governed-by--> P12 (AI safety)` and `--governed-by--> P13 (data privacy)`; `quiz-generator --governed-by--> P6 (question quality)`; `atomic_quiz_profile_update --governed-by--> P1, P2, P4`. Lets an agent know which rule it must not break.
- **`module --owned-by--> owner`** and **`change --reviewed-by--> owner`** — e.g. `foxy-tutor --owned-by--> ai-engineer`, and an AI-tutor or RAG change `--reviewed-by--> assessment, testing` (P14). Lets an agent honor boundaries and review chains.
- **`decision --decided-by--> ADR`** and **`module --constrained-by--> ADR`** — links the why to the code.
- **`behavior --pinned-by--> regression`** — e.g. the single-retrieval Foxy contract `--pinned-by--> REG-50`; the AI quiz-generator validation oracle `--pinned-by--> REG-54`; the grade-string contract `--pinned-by--> SG-1..SG-6`; the marking-authenticity hash `--pinned-by--> REG-51..REG-53`. Lets an agent predict which test breaks if it gets the change wrong.
- **`ADR --supersedes--> ADR`** — preserves decision history so the path not taken is never accidentally re-taken.

A worked example an autonomous agent traverses before touching RAG retrieval: `grounded-answer --depends-on--> _shared/rag/retrieve.ts --depends-on--> match_rag_chunks_ncert (RRF k=60) --governed-by--> P12, P13 --owned-by--> ai-engineer --reviewed-by--> assessment, testing --pinned-by--> REG-37, REG-50`. From that single traversal the agent knows the dependency chain, the invariants in play, the owner, the mandatory reviewers, and the tests that gate the change — all grounded, all explainable.

---

# How Agents Query the Graph

The graph is queried at session start (per the load sequence in `engineering-memory.md`) and again before any decision with blast radius. Typical queries:

1. **Blast-radius query** — "What depends on the module I am about to change?" Traverse inbound `depends-on` edges to find every affected caller (e.g. who consumes `_shared/rag/retrieve.ts`).
2. **Obligation query** — "Which invariants govern this file, who owns it, and who must review the change?" Traverse `governed-by`, `owned-by`, and `reviewed-by`.
3. **Decision-provenance query** — "Why is this the way it is?" Traverse `constrained-by` to the governing ADR, and `supersedes` to the decision history.
4. **Regression-impact query** — "Which catalogued tests pin the behavior I am changing?" Traverse `pinned-by` to the REG-NN entries that must still pass.
5. **Term-resolution query** — "What does this domain term precisely mean?" Resolve against the glossary entity before reasoning on it.

The graph never authorizes a change on its own; it surfaces the obligations the agent must then satisfy. An autonomous agent that skips the obligation query and proceeds is operating ungrounded, which the constitution prohibits.

---

# Relationship to RAG Retrieval and the Eval Harness

The knowledge graph is the engineering-decision analogue of the platform's student-facing grounding stack, and it reuses the same discipline rather than inventing a parallel one.

- **Shared substrate.** Student-facing grounding runs on pgvector hybrid retrieval — `supabase/functions/_shared/rag/retrieve.ts` over the `match_rag_chunks_ncert` RRF (k=60) RPC, with Voyage rerank-2 — and verifies answers with `supabase/functions/grounded-answer/grounding-check.ts`. The knowledge graph governs how an *agent* grounds an engineering decision with the same posture: retrieve the relevant entities, ground the claim on real edges, and abstain (ask, do not guess) when the supporting edge is missing — the engineering twin of the `{{INSUFFICIENT_CONTEXT}}` clean-abstain.
- **Eval-harness analogy.** The offline RAG eval harness (`eval/rag/harness/`, golden set `eval/rag/golden/ncert-golden-v1.json`, committed baseline `eval/rag/baseline/ncert-baseline-v1.json`) gates retrieval/prompt/model changes on a deterministic verdict — PASS, REGRESS, or INCONCLUSIVE — read from the report artifact, never from a feeling (`ai-evaluation` playbook). The knowledge graph applies the same rule to autonomous reasoning: a decision grounded on a degraded or incomplete traversal is the engineering INCONCLUSIVE — a hard stop, not a soft pass. Re-ground on the full path before deciding.
- **No production coupling.** Like the eval harness, the knowledge graph is a reasoning and measurement aid. It is never imported by production or client code, and it carries no PII — entities are modules, invariants, owners, ADRs, and regressions, never students. A graph node never holds a name, email, or phone (P13).

The graph and the RAG stack are siblings: both exist so that what reaches its consumer — a student answer, or an autonomous engineering decision — is grounded, explainable, and gated against regression.

---

# Keeping Autonomous Reasoning Grounded and Explainable

Two properties make autonomy safe; the graph supplies both.

**Grounded.** Before acting, the agent retrieves the in-scope entities and confirms its plan against the `governed-by`, `owned-by`, `reviewed-by`, and `pinned-by` edges. A plan that violates an edge — touches a subsystem it does not own, breaks an invariant it is governed by, or skips a mandatory reviewer — is rejected before any code is written. Grounding is the brake that stops an autonomous loop from compounding a wrong assumption.

**Explainable.** Every autonomous decision must be reconstructable from the entities and edges it traversed. The decision record (the ADR, the handoff note, the catalog entry) cites those edges, so a human auditor — or the next loop — can replay the reasoning. A decision that cannot be explained from the graph is treated as ungrounded and is not trusted, regardless of how confident the agent was.

The graph is kept honest by the same staleness/reconciliation loop that governs all durable memory: when an edge no longer reflects reality (a module deleted, an owner reassigned, an ADR superseded, a regression renumbered), reality wins and the graph's references are corrected. Pruned examples already in the record: `quiz-generator-v2/` never existed on disk; `foxy-tutor/` is frozen and deprecated in favor of the `grounded-answer`/`src/app/api/foxy/route.ts` path. A stale edge is a defect, because an autonomous agent that traverses it grounds on a fact that is no longer true.

---

# Knowledge-Graph Checklist

An autonomous session satisfies this standard only when every item holds.

- The in-scope entities (modules, invariants, owners, dependencies, ADRs, regressions) were retrieved before any decision with blast radius.
- The blast-radius query was run: every inbound `depends-on` caller of a changed module is known.
- The obligation query was run: governing invariants, owner, and mandatory reviewers are known and honored.
- The decision-provenance query was run for any change that touches an ADR-governed area.
- The regression-impact query was run: every `pinned-by` test for the changed behavior is identified and kept green.
- Domain terms were resolved against the glossary, not assumed.
- The grounding was full-path, not degraded; an incomplete traversal was treated as a hard stop, not a soft pass.
- The decision is explainable: the traversed entities and edges are cited in the ADR, handoff note, or catalog entry.
- The graph carries no PII; no node holds a student name, email, or phone (P13).
- Any edge found stale was corrected (reality wins), not traversed.

---

# References

- `00_AI_CONSTITUTION` — Supreme AEOS charter; the no-fabrication and ground-before-you-decide posture this graph enforces.
- `24_MEMORY_AND_CONTEXT` — The memory and source-of-truth discipline the graph references and never duplicates.
- Sibling: `AEOS/memory/engineering-memory.md` — what is persisted and where; this graph is the queryable view over it.
- `25_ARCHITECTURE_DECISIONS` — The ADR entities and `supersedes` edges the graph links.
- v1.1 playbooks: `AEOS/playbooks/ai-evaluation.md` (the PASS/REGRESS/INCONCLUSIVE gate this graph mirrors for reasoning), `AEOS/playbooks/ai-workflows.md`, `AEOS/playbooks/prompt-engineering.md`.
- RAG / eval substrate (real paths): `supabase/functions/_shared/rag/retrieve.ts` (unified retrieval contract over `match_rag_chunks_ncert`, RRF k=60, Voyage rerank-2), `supabase/functions/grounded-answer/grounding-check.ts` (answer grounding), `supabase/functions/_shared/rag/{mmr,sanitize}.ts`, `eval/rag/harness/{cli,run-eval,metrics,verdict,golden-schema}.ts`, `eval/rag/golden/ncert-golden-v1.json`, `eval/rag/baseline/ncert-baseline-v1.json`.
- Entity sources: `.claude/CLAUDE.md` (invariants P1–P15, critical-file map, domain-ownership matrix), `.claude/regression-catalog.md` (regression entities REG-NN / SG-N), `docs/superpowers/{specs,plans,runbooks}/` (feature entities and their provenance).

---

# Final Directive

An autonomous agent that decides without grounding is guessing, and a guess at the keyboard is a fabrication on its way to a student.

Before you decide, retrieve the entities and traverse the edges: what this change depends on, which invariant governs it, who owns it, who must review it, and which regression pins it. Ground the decision on real edges or do not make it. Treat an incomplete traversal as a hard stop, the way the eval harness treats INCONCLUSIVE. Keep every decision explainable from the graph it traversed, keep the edges honest against reality, and keep the graph free of any student PII.

The knowledge graph is to engineering decisions what RAG is to student answers — the difference between a grounded truth and a confident hallucination. Use it accordingly.

**End of Document**
