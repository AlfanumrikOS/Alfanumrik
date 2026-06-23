# AI Evaluation Methodology

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v1.1
**Classification:** Operational Playbook
**Priority:** P0 (Critical — the regression gate that protects retrieval and answer quality before any prompt/model change ships)
**Applies To:** Every change that could move AI output quality at Alfanumrik — RAG retrieval logic, prompt templates, model selection, reranking, and the cognitive engines that feed adaptive learning.

---

# Purpose

You cannot improve what you cannot measure, and you must never ship an AI change on a measurement you do not trust. AEOS v1.0 set the principle (evidence over confidence); this v1.1 playbook is the methodology: how Alfanumrik builds golden sets, runs the offline eval harness, computes retrieval and answer-quality metrics, and gates prompt/model changes on a deterministic verdict before they reach a student.

The reference implementation is the real RAG retrieval-quality eval-harness under `eval/rag/` — a deliberately **offline, read-only measurement tool**, never imported by production or client code. This document treats it as the canonical example of how AI quality is governed at Alfanumrik.

Where this playbook and a product invariant disagree, the invariant wins. AEOS describes how to measure quality well; the constitution describes what must never break.

---

# Why offline evaluation exists

Tuning retrieval or prompts by eyeballing a few answers is not engineering — it is guessing. A change that "looks better" on three queries can silently regress recall on the long tail. Offline evaluation closes that gap: a fixed golden set, a deterministic metric pipeline, and a committed baseline turn "this feels better" into "nDCG@10 held within band and groundedness-rate improved 4pp".

The harness is a **measurement tool, not a CI pass/fail process.** The CLI (`eval/rag/harness/cli.ts`) always exits 0 on a completed run — PASS, REGRESS, and INCONCLUSIVE alike — and reserves a non-zero exit only for an operator error that prevented a run (no creds, no golden set, malformed baseline). The signal a tuning decision reads is the **verdict field of the written report artifact**, not the process exit code.

---

# Golden sets

A golden set is a curated list of representative queries, each labeled with the chunk(s) that *should* be retrieved and graded by relevance.

- Seed queries live in `eval/rag/golden/seed-queries.json`; the resolved, validated golden set is `eval/rag/golden/ncert-golden-v1.json`, validated by `eval/rag/harness/golden-schema.ts` (`validateGoldenSet`).
- Each item carries its relevant chunks with graded relevance (`0` not relevant, `1` relevant, `2` primary/required) so the metrics can compute nDCG and multi-hop coverage, not just a binary hit.
- The golden set must span the curriculum surface that matters — grades, subjects, chapters, and query types (single-hop vs multi-hop) — so a metric average is representative, not biased toward one easy band.
- Golden labels are **human-curated and review-owned.** They are not auto-generated from the system under test, because a golden set derived from current output cannot detect a regression in current output.

---

# The offline eval harness

The harness is a pure assembler fed injected dependencies, so the same core runs against real modules (the live-DB integration test and the operator CLI) or against fixtures (unit tests).

- `eval/rag/harness/run-eval.ts` — the runner: takes injected `retrieve`, `groundingCheck`, `golden`, `baseline`, and `voyageKeyPresent`, executes each golden query, computes metrics, and writes the report.
- `eval/rag/harness/cli.ts` — the operator entrypoint (`npm run eval:rag:harness`). It wires the **real** deps: a service-role Supabase client, the real `retrieve()` from `_shared/rag/`, and the real `runGroundingCheck` from `grounded-answer/grounding-check.ts`, then runs once and prints the verdict.
- **AI-boundary discipline:** the harness never statically imports an AI SDK, never references an `api.*.com` URL, and never calls `match_rag_chunks*` directly. It dynamic-imports the two allowlisted internal modules and is enforced offline-only by an import-boundary test.

A run is **degraded** when it did not use the full embeddings+rerank path — e.g. FTS-only because `VOYAGE_API_KEY` was absent. A degraded run can never be trusted to declare a pass or a regression.

---

# Retrieval & answer-quality metrics

The metric functions (`eval/rag/harness/metrics.ts`) are pure, rank-based, and scale-independent — they consume the system's ranked list of `chunk_id`s plus the golden labels, and never the RRF fused similarity score (which lives on a `[0, ~0.033]` scale and would corrupt the math). The ranked list is deduped by `chunk_id` (keeping the earliest rank) before any computation, so every metric is `<= 1.0` by construction.

The five **primary gate metrics** (`PRIMARY_METRICS` in `verdict.ts`):

| Metric | Meaning |
|---|---|
| `nDCG@10` | Ranked relevance quality of the top 10 (graded gain, log discount). |
| `recall@10` | Fraction of relevant chunks retrieved in the top 10. |
| `MRR` | 1 / rank of the first relevant chunk. |
| `hit-rate@10` | 1 if any relevant chunk is in the top 10. |
| `groundedness-rate` | Fraction of answers the grounding-check verifies as supported. |

Unmeasurable cells (empty relevant set, zero window, missing groundedness sample) return `null` — "not measurable" — and are excluded and flagged by the aggregator rather than averaged in as a spurious `0`. Multi-hop full-coverage is reported per-cell but is **not** a primary gate metric in this harness (too noisy on small per-band counts).

---

# Regression gates before shipping

A prompt/model/retrieval change must clear the gate (`eval/rag/harness/verdict.ts` → `evaluateVerdict`) before it ships. The gate is a deterministic three-state machine:

- **INCONCLUSIVE** — the run was degraded, OR any primary metric is unmeasurable on either side (current or baseline missing/null). INCONCLUSIVE **dominates** a would-be REGRESS: you cannot trust a degraded or incomplete run to declare PASS *or* REGRESS. An INCONCLUSIVE run does not clear the gate.
- **REGRESS** — the run was full-path and complete AND any single primary metric crossed its A7 band vs the committed baseline.
- **PASS** — full-path, complete, and every primary metric within band (or improved).

The A7 per-metric regress bands are carried **inside the committed baseline** (`eval/rag/baseline/ncert-baseline-v1.json`), assessment-reviewed and never auto-refreshed, so moving a band requires a reviewed baseline change:

| Metric | Band |
|---|---|
| `nDCG@10` | 2% relative |
| `recall@10` | 2% relative |
| `MRR` | 3% relative |
| `hit-rate@10` | 2pp absolute |
| `groundedness-rate` | 3pp absolute |

The band test is strict (`> band`, with a `1e-9` epsilon to absorb IEEE-754 noise): a drop landing exactly on the floor is not a regression.

**Gate rule:** a prompt or retrieval change ships only on a PASS. A REGRESS blocks it. An INCONCLUSIVE means re-run on the full path (or fix the baseline) before any verdict can be trusted — never ship through an INCONCLUSIVE.

---

# Human review

Offline metrics measure retrieval and groundedness; they do not fully measure tone, age-appropriateness, or pedagogy. Every material AI change pairs the harness numbers with a human pass:

- Sample a spread of golden queries and read the actual answers for CBSE-scope correctness, grade-appropriate language, and Foxy persona (an AI tutor, never a human teacher).
- Confirm abstains fire where they should (no supporting chunk → `{{INSUFFICIENT_CONTEXT}}` → clean abstain) and that refusals are helpful, not bare errors.
- Confirm no PII appears in any traced prompt or response and that citations point at real NCERT chunks.

A PASS verdict with a failed human review does **not** ship. The metric gate is necessary, not sufficient.

---

# Evaluating the algorithmic engines

`quiz-generator` and `cme-engine` call no model, but their quality is still gated:

- **Quiz generation** — candidate questions pass the deterministic quiz oracle (`_shared/quiz-oracle.ts`, `runDeterministicChecks`) plus an LLM-grader before they can be served (P6: 4 distinct options, valid `correct_answer_index`, non-empty explanation, valid difficulty/Bloom). The oracle is the regression gate for question quality.
- **cme-engine** — BKT/IRT mastery math is rule-defined by assessment and unit-tested (see `src/lib/cognitive-engine.ts` coverage targets). Changing a BKT/IRT parameter requires assessment confirmation that mastery thresholds still match the rules.

---

# The user-approval gate for model/provider changes

Some changes cannot be self-approved no matter how green the eval.

- **Changing the AI model or provider is a user-approval change** (P12 / AEOS agent system). Pinned model IDs (`claude-haiku-4-5-20251001`, `claude-sonnet-4-20250514`) appear across `claude.ts`, `_shared/mol/router.ts`, route admission profiles, and `_shared/security/quota.ts`; they move together, with user approval, and the change is re-evaluated against the golden set + baseline afterward.
- **Changing prompt templates or RAG retrieval logic** routes to **assessment** review (curriculum scope, age-appropriateness, retrieval correctness) and must clear the regression gate.
- **Moving a regress band or the baseline** is an assessment-reviewed change to the committed baseline file — never an autonomous refresh from the current run.

---

# Readiness checklist

- [ ] Golden set is human-curated, schema-valid, graded-relevance-labeled, and representative of grade/subject/chapter and query types.
- [ ] Eval run uses the full embeddings+rerank path (not degraded / FTS-only); otherwise the verdict is INCONCLUSIVE and the change does not ship.
- [ ] Verdict read from the report artifact, not the process exit code; the change ships only on PASS.
- [ ] A REGRESS blocks; an INCONCLUSIVE is re-run on the full path before any decision.
- [ ] Regress bands and baseline values are read from the committed, assessment-reviewed baseline — never auto-refreshed.
- [ ] Human review on a sample confirms scope, age-appropriateness, persona, abstain behavior, and no PII.
- [ ] Algorithmic engines gated by their own oracles/tests (quiz oracle, cme unit tests).
- [ ] Any model/provider change has explicit user approval and is re-evaluated against the golden set.

---

# References

- Core: `08_TESTING_PROTOCOL.md` (test discipline, coverage, regression catalog), `10_VERIFICATION_ENGINE.md` (verify with evidence before claiming done)
- Product constitution: **P6** (question quality), **P12** (AI safety), **P13** (data privacy), and the user-approval gate for AI model/provider changes in `.claude/CLAUDE.md`
- Extensions: `extensions/anthropic.md` (model pinning + review routing for prompt/model changes)
- Sibling playbooks: `ai-workflows.md` (the lifecycle under measurement), `prompt-engineering.md` (the changes this gate protects)
- Repo: `eval/rag/harness/{cli,run-eval,metrics,verdict,golden-schema,relevance-judge,baseline}.ts`, `eval/rag/golden/{seed-queries,ncert-golden-v1}.json`, `eval/rag/baseline/ncert-baseline-v1.json`, `grounded-answer/grounding-check.ts`, `_shared/rag/`, `_shared/quiz-oracle.ts`, `src/lib/cognitive-engine.ts`; run via `npm run eval:rag:harness`

---

# Final Directive

Never ship an AI change on a feeling. Curate a golden set you trust, measure on the full path, read the verdict from the artifact, and ship only on a PASS reviewed by a human. Treat INCONCLUSIVE as a hard stop, not a soft pass — a measurement you cannot trust is worse than none. Keep the baseline and its bands under assessment review, keep model and provider changes behind the user-approval gate, and re-measure after every change. Evidence over confidence is not a slogan here; it is the gate.

**End of Document**
