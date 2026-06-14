# RAG Eval-Harness (B1) — Operation Runbook

**Date:** 2026-06-14
**Status:** Built (Tasks 1–9 shipped). NOT yet gating. Baseline is a PLACEHOLDER → every run is INCONCLUSIVE by design until the operator procedure below is completed.
**CLI:** `npm run eval:rag:harness` (`eval/rag/harness/cli.ts`)
**Spec:** `docs/superpowers/specs/` (B1 RAG eval-harness design)
**Plan:** B1 RAG eval-harness plan, Task 10 (this runbook + CLI)
**Owner:** ai-engineer (harness + CLI) · assessment (golden labels, baseline values, regress bands) · ops/architect (CI secret, corpus parity, integration-lane health)

## What this is

B1 is the retrieval-quality measurement harness — the gate B2 (retrieval tuning) must beat. It runs the authored CBSE/NCERT golden set through the REAL `retrieve()` path over a live corpus, scores per-item + per-cell metrics, compares to a committed baseline, and emits a three-state machine **VERDICT** (`PASS | REGRESS | INCONCLUSIVE`) into its OWN report artifact under `eval/rag/reports/`.

The harness is OFFLINE tooling: never imported by production/client code (enforced by `src/__tests__/eval/rag/import-boundary.test.ts` + an ESLint `no-restricted-imports` rule), read-only against the DB (zero writes), and run by an operator or a CI lane, never in a shipped bundle.

### Verdict semantics (spec §B1.5)

| Verdict | Meaning |
|---|---|
| `PASS` | Full-path, complete run; every primary metric within its regress band (or improved) vs baseline. |
| `REGRESS` | Full-path, complete run; ANY single primary metric crossed its A7 band vs baseline. |
| `INCONCLUSIVE` | The run cannot be trusted to gate a decision: degraded (no Voyage / FTS-only / retrieve error / silent rerank-degradation), OR any primary metric unmeasurable, OR the baseline is a placeholder. Never PASS/REGRESS against an untrusted run. |

Primary gate metrics + A7 regress bands (assessment-reviewed, NEVER auto-refreshed — they live inline in the baseline JSON):

| Metric | Band | Type |
|---|---|---|
| nDCG@10 | 2% | relative |
| recall@10 | 2% | relative |
| MRR | 3% | relative |
| hit-rate@10 | 2pp | absolute |
| groundedness-rate | 3pp | absolute |

### CLI exit-code policy (documented choice)

The CLI is a MEASUREMENT tool, not a pass/fail CI gate. It exits **0 on every machine verdict** — `PASS`, `REGRESS`, and `INCONCLUSIVE` alike. A wrapping job's exit code is NOT the signal B2 reads; **B2 reads the `verdict` field of the written report artifact**, not the process exit status. The CLI reserves a non-zero exit **(2)** ONLY for an OPERATOR/CONFIG error that prevented a run from happening at all (no creds, no resolved golden set, malformed baseline). Smoke-running without creds is therefore a clean exit 2 with a clear message — it never crashes and never needs a live DB.

## Prerequisites (the 3 operational dependencies)

These must all be satisfied before B1 can gate B2. They are NOT code — they are operational.

1. **`VOYAGE_API_KEY` provisioned as a GitHub Actions secret.**
   Without it, `retrieve()` degrades to FTS-only (no embeddings/rerank stage). The runner detects this (`voyageKeyPresent === false`) and forces the verdict to **INCONCLUSIVE by design** — you cannot gate a tuning decision on a measurement that did not exercise the path B2 tunes. Provision the secret on the integration lane / staging job that runs the harness. (Locally: `vercel env pull .env.local` then run the CLI — it self-loads `.env.local`.)
   - Also recommended: `ANTHROPIC_API_KEY`, so groundedness runs. Absent, groundedness-rate is recorded `null` → INCONCLUSIVE via the verdict's unmeasurable-metric rule. (See the Known Limitation below — groundedness is currently a thin proxy regardless.)

2. **CORPUS PARITY — the CI/staging DB's `rag_content_chunks` must be the SAME `ncert_2025` ingest as prod.**
   The golden set binds each query to real `rag_content_chunks.id` UUIDs. If CI reads a different corpus (a re-ingest, a partial seed, a different snapshot), those UUIDs will NOT resolve and the run is meaningless. The integration test's `corpus-parity` assertion fails LOUDLY on any unresolved chunk-id once the golden set is seeded — that failure means the golden set was authored against a different corpus than CI reads. Confirm parity with ops/architect before authoring the golden set, and re-confirm after any corpus re-ingest.
   ```sql
   -- Spot-check: every relevant_chunk_id in ncert-golden-v1.json must resolve to an
   -- active ncert_2025 chunk in the env the harness runs against.
   SELECT id FROM rag_content_chunks
   WHERE id = ANY($1::uuid[]) AND is_active = true AND source = 'ncert_2025';
   ```

3. **The integration lane is currently RED on `main` for an UNRELATED reason** (`src/__tests__/lib/school-admin/seat-enforcement.test.ts`).
   B1's verdict lands in its OWN report artifact (B5 — `eval/rag/reports/*.json`), decoupled from the umbrella integration job's exit code precisely so it is readable while the umbrella lane is red. **B2 MUST read B1's report artifact, NOT the umbrella job exit code**, until the unrelated `seat-enforcement` failure is fixed or quarantined (ops/architect to triage). Do not block B1's verdict-read on the umbrella lane going green.

## Procedure: from "built" to "gating B2"

### Step A — Bind the golden set (assessment-owned, candidate-pool-independent)

Input: `eval/rag/golden/seed-queries.json` — 30 authored CBSE/NCERT queries, stratified by grade band × core subject × query type, each carrying a `target` curriculum descriptor (chapter, concept, and what a relevance=2 chunk MUST contain). This file deliberately carries NO chunk UUIDs — binding is THIS step.

For each seed query:

1. **Resolve candidate chunks against the LIVE corpus.** Filter `rag_content_chunks` by `(source='ncert_2025', grade, subject_code, chapter_number/concept)` per the query's `target`. Read the chunk text — A3 labeling is **candidate-pool-independent**: judge whether each chunk genuinely answers the query per the `target` description, NOT whether the current retriever happened to return it.
2. **Label graded relevance (2 / 1 / 0)** using the Task 3 relevance-judge (`eval/rag/harness/relevance-judge.ts`, Sonnet, temperature 0, rubric `rag-relevance-v1`) plus the Task 6 trace-mining tooling (`eval/rag/harness/trace-mining.ts`) to surface real candidate chunks from `retrieval_traces` / `grounded_ai_traces`.
3. **Set `off_grade_scope`** (A2) on any relevant chunk whose content is materially above/below the query's grade band.
4. **Assessment spot-check** — assessment reviews ≥ 20% of labeled items (random sample) AND 100% of any low-confidence labels the judge flags. This is the human gate on the durable intellectual asset.
5. **Emit `eval/rag/golden/ncert-golden-v1.json`** (NOT a mutation of seed-queries.json). It MUST pass `validateGoldenSet()` (`eval/rag/harness/golden-schema.ts`): P5 grade strings, canonical snake_case subject codes (incl. `social_studies`, NOT `civics`/`history`/`social science`), `relevance ∈ {0,1,2}`, valid-UUID chunk-ids, `corpus_ref.source === 'ncert_2025'`, and NO PII-shaped key at any depth.

Verify the seeded file resolves (corpus parity) by running the integration lane with creds — the `corpus-parity` test must be GREEN (every chunk-id resolves to an active `ncert_2025` chunk).

### Step B — Capture the baseline (reviewed action)

1. Run the harness full-path against the resolved golden set:
   ```bash
   # creds present: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
   # + VOYAGE_API_KEY (required for full path) + ANTHROPIC_API_KEY (for groundedness)
   npm run eval:rag:harness
   ```
   The CLI writes a timestamped report to `eval/rag/reports/` and prints the verdict + per-cell metrics. While the baseline is still a placeholder, the verdict will be INCONCLUSIVE — that is expected; you are capturing values, not gating.
2. **Review the per-cell (A4: grade-band × subject) metrics** with assessment. Confirm no cell is anomalously low because of a labeling error rather than a retrieval gap (a labeling bug surfaces as one bad cell; a retrieval gap is broader).
3. **Assessment approves the values.**
4. **Populate `eval/rag/baseline/ncert-baseline-v1.json`:** copy the approved per-metric values into `metrics`, and **flip `metrics_placeholder` from `true` to `false`**. Until that flip, the runner FORCES INCONCLUSIVE (the carry-forward condition — you can never declare PASS/REGRESS against a placeholder baseline).
   - The `bands` block is already real (shipped in Task 7). Do NOT change band values here without an explicit assessment review — bands are assessment-reviewed and NEVER auto-refreshed. A baseline refresh (re-run on current settings + re-commit values) is likewise an explicit, reviewed action so the gate can never silently rebaseline a regression away.

### Step C — B2 readiness gate

Only AFTER a non-placeholder baseline exists (`metrics_placeholder: false` with real values) can B2 tuning be gated:

- B2 runs the harness on each candidate retrieval setting and reads the report artifact's `verdict`.
- Any primary metric that regresses beyond its A7 band → `REGRESS` → B2 candidate rejected.
- `INCONCLUSIVE` is never a pass: if a B2 run comes back INCONCLUSIVE (degraded env, missing Voyage), fix the environment and re-run — do not promote on an INCONCLUSIVE.

## Known limitation (assessment S5.3)

The groundedness candidate-answer is currently a **thin proxy** — the harness feeds the top retrieved chunk's text (first ~400 chars) into `runGroundingCheck`, NOT a real generated answer. This **skews groundedness-rate HIGH** (a chunk trivially "grounds" in itself) and **must not be over-read** until a real answer-grounding step lands. Treat groundedness-rate as directional only in B1; the four retrieval metrics (nDCG@10, recall@10, MRR, hit-rate@10) are the trustworthy gate signals.

## Quick reference

| Item | Path |
|---|---|
| CLI entrypoint | `eval/rag/harness/cli.ts` (`npm run eval:rag:harness`) |
| Runner / verdict assembler | `eval/rag/harness/run-eval.ts` |
| Verdict logic + bands | `eval/rag/harness/verdict.ts` |
| Baseline loader | `eval/rag/harness/baseline.ts` |
| Golden-set validator | `eval/rag/harness/golden-schema.ts` |
| Relevance judge (Task 3) | `eval/rag/harness/relevance-judge.ts` |
| Trace-mining (Task 6) | `eval/rag/harness/trace-mining.ts` |
| Seed queries (binding SOURCE) | `eval/rag/golden/seed-queries.json` |
| Resolved golden set (Step A OUTPUT) | `eval/rag/golden/ncert-golden-v1.json` |
| Baseline (Step B OUTPUT) | `eval/rag/baseline/ncert-baseline-v1.json` |
| Report artifacts (B5) | `eval/rag/reports/*.json` |
| Live-DB integration lane | `src/__tests__/eval/rag/run-eval.integration.test.ts` (`RUN_INTEGRATION_TESTS=1`) |
| Import boundary guard | `src/__tests__/eval/rag/import-boundary.test.ts` |
