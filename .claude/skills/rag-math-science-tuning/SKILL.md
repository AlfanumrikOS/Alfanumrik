---
name: rag-math-science-tuning
description: Assess whether the Voyage-embedded NCERT corpus covers the full CBSE syllabus for the 18 CEO-locked math/science cells (grades 6-12 math, science, physics, chemistry, biology), then gate and run RAG retrieval tuning against the B1 eval harness. Use for RAG coverage audits, syllabus completeness checks, embedding-health probes, and retrieval fine-tuning requests.
---

# Skill: RAG Math/Science Coverage & Tuning

Read-only by default. Produces a per-cell Voyage coverage verdict, then gates every retrieval-tuning claim behind a non-degraded, noise-aware measurement.

**Owning agent**: ai-engineer. **assessment** **owns** golden-set seed authoring (CBSE content — see Phase 4) and **reviews** retrieval correctness. **testing** reviews regressions. **architect** owns any migration. P14 applies to every production edit — `.claude/hooks/review-chain.sh:65` already fires an ai-engineer + testing chain on any `supabase/functions/_shared/` edit, which is where `rag/retrieve.ts` lives.

## Scope: 18 cells, ~282 chapters expected (verify — never quote)

Locked by migrations `20260814000007_subject_catalogue_restrict_math_science.sql` and `20260814000008_grade_subject_map_restrict_and_destream.sql`.

| Grades | `subject_code` values | Cells |
|---|---|---|
| 6, 7, 8, 9, 10 | `math`, `science` | 10 |
| 11, 12 | `math`, `physics`, `chemistry`, `biology` (deliberately **no** `science` row) | 8 |

Grades are STRINGS `'6'`..`'12'` (P5). Subject codes are snake_case — `math`, never `Mathematics`.

**282 chapters is a registry-seed *expectation*, not a measurement.** It is the keep-set subtotal of the seed manifest `20260624000100_seed_cbse_syllabus_manifest.sql`, and that is its only in-repo source. Absolute rule 1 forbids quoting a count from this file, so **treat 282 as a number to verify against, never to report**: if the live total diverges, the registry drifted and that is itself a finding. The report's per-cell `chapters` column must come from Q2 at runtime — never from this heading, and at T0 it reads `UNMEASURED`.

## Phases

### Phase 0 — Establish the access tier FIRST

| Tier | Available | May do |
|---|---|---|
| **T0 sandbox** (default) | repo files only; `api.voyageai.com` and `*.supabase.co` both return **HTTP 000** | read code/migrations/golden set; emit a report with every cell `UNMEASURED`; **never estimate a count** |
| **T1 Supabase MCP** | `execute_sql` on prod | all of Phase 2 (Q1-Q8 are SELECT-only). No Voyage means no harness and no tuning claim |
| **T2 operator machine** | `.env.local` via `vercel env pull` plus `VOYAGE_API_KEY` | everything |
| **T3 GitHub Actions** | new `workflow_dispatch` job modelled on `.github/workflows/rag-cosine-replay.yml` | same as T2, auditable |

A verdict produced at T0 is `UNMEASURED`, never `READY`.

### Phase 1 — Lock scope from the database

Run **Q1** (`references/coverage-sql.md`). Expect exactly **18** rows. Any other count is scope drift — STOP and report.

### Phase 2 — Assess Voyage coverage (Q2-Q8)

Classify every in-scope chapter into exactly one state. First match wins.

| # | State | Detected by | Means | Fix owner | Spends credits |
|---|---|---|---|---|---|
| 1 | `REGISTRY_MISSING` | Q7 | corpus has chunks at a coordinate `cbse_syllabus` does not list | architect (migration) | no |
| 2 | `COORDINATE_DRIFT` | Q6, `corpus_ch` non-NULL | NCERT-2025 renumbering; content exists at a different `chapter_number` | architect (cf. `20260814000013`) | no |
| 3 | `INACTIVE` | Q8, `is_active_true = 0` | chunks exist at the coordinate but none are active — invisible to every other query here and to retrieval. Two sub-cases, two different remedies (below) | ai-engineer/architect (NULL sub-case); **assessment** owns the `false` sub-case | no |
| 4 | `ABSENT` | Q6 `ABSENT_CANDIDATE`, confirmed against Q8 | genuinely not ingested | ai-engineer + CEO approval | **yes** |
| 5 | `UNATTRIBUTED` | Q5 | chunks exist under legacy `subject`/`grade` but NULL `subject_code`/`grade_short` — **invisible to `match_rag_chunks_ncert`, so invisible to every student** | ai-engineer (attribution backfill) | no |
| 6 | `UNEMBEDDED` | Q4 `unembedded > 0` | `embedding IS NULL`; FTS-only | ai-engineer via `generate-embeddings` | **yes** |
| 7 | `WRONG_DIM` | Q4 `wrong_dim > 0` | `vector_dims(embedding) <> 1024`; corrupt | ai-engineer | **yes** |
| 8 | `WRONG_MODEL` | Q4 `non_voyage > 0` | embedded by the OpenAI `text-embedding-3-small` fallback in `resolveProvider()` (`supabase/functions/_shared/embeddings.ts`) — **also 1024-d**, so dimension checks cannot detect it; mixed vector space | ai-engineer | **yes** |
| 9 | `BELOW_FLOOR` | Q4 `active_chunks < 50` | fails `cbse_syllabus_rag_ready(grade, subject_code, chapter)`, which returns TRUE only at >=50 active chunks | ai-engineer | **yes** |
| 10 | `READY` | all clear | Voyage has it | — | — |

**State 3 `INACTIVE` has two sub-cases that must NOT share a remedy.**
- `is_active IS NULL` — an **omission**. The column carries `DEFAULT true`, so NULL means a writer bypassed the default; nobody decided to hide this content. Safe to activate. Owner: ai-engineer or architect. The fix is an activation write **plus** a `recompute_syllabus_status()` call, because that function wrote `rag_status='missing'` while the rows were dark — the registry itself now carries the wrong verdict.
- `is_active = false` — a **decision**; someone wrote it. `rag_content_chunks` carries `version` and `previous_chunk_id` (`00000000000000_baseline_from_prod.sql:10151-10152`), so `false` is most likely the routine retired-prior-version marker left by a re-ingest. **Do NOT blind-reactivate** — that could push superseded or quality-rejected text (bad OCR, garbled chapter) back into student-facing retrieval, a P6/P12 risk. Before any reactivation, cross-read Q6's `corpus_ch` (renumbering) and Q7 (orphan coordinates): if a re-ingest superseded these rows, the correct fix is registry/coordinate work, not reactivation. The content call — "should this text be visible to students again" — is **assessment-owned**.

**Before writing `ABSENT` (state 4) for any chapter, cross-read Q8.** Q6's `live` CTE filters `is_active = true`, so a chapter whose chunks are all NULL-`is_active` surfaces there as `ABSENT_CANDIDATE`; if Q8 shows `is_active_null > 0` at that coordinate, the true state is `INACTIVE` — a **free** activation/attribution backfill, not the one state that spends credits. Q8 groups by `(grade_short, subject_code, chapter_number)`, so read it at the chapter coordinate the rule actually operates on; a cell-level reading only **defers** an `ABSENT`, it never cancels one.

**`is_active = false` must NOT be added to the `ABSENT` gate as a blocker.** The gate is exactly "`ABSENT_CANDIDATE` in Q6 **and** `is_active_null = 0` in Q8" — nothing more. If it became "absent AND no NULL AND no false", routine retired-version rows would make `ABSENT` practically unreachable and a genuine content gap would never get funded. `is_active_false > 0` alongside a healthy `is_active_true` is normal and says nothing.

Reuse, do not rebuild: **Q2** reads `cbse_syllabus_rag_diagnostic` (trust `actual_chunk_count` over the cached `chunk_count`; `sync_state='STALE'` is the cache-drift detector). **Q3** reads `ingestion_gaps` (severity plus affected students). Only Q4-Q8 are new logic.

`rag_content_chunks.is_active` is NULLABLE and every count except **Q8** filters `is_active = true`, which silently drops NULL rows. Q4's `is_active_null_seen` and Q5 are both structurally blind to them and read 0 by construction — **Q8 is the only query that can count them**, because it carries no `is_active` predicate. Run it and report the measured number; a `0` copied from Q4 is false reassurance, not a measurement.

Q6 and Q7 both filter `cbse_syllabus` to `board = 'CBSE'`. The table is UNIQUE on `(board, grade, subject_code, chapter_number)` and holds non-CBSE rows, so dropping that predicate manufactures spurious `ABSENT_CANDIDATE` rows in Q6 and suppresses genuine `REGISTRY_MISSING` rows in Q7.

### Phase 3 — Coverage gate (hard)

Per cell: `CELL_READY` (all chapters READY) / `CELL_DEGRADED` (worst state 8-9) / `CELL_BLIND` (any chapter in states 1-7) / `UNMEASURED` (tier T0).

**You may not tune a `CELL_BLIND` or `UNMEASURED` cell.** No cosine floor, fetch-N or MMR-lambda value recovers content the retriever cannot see; measuring one launders a content gap into a retrieval number. States 1, 2 and 5 — plus the `is_active IS NULL` sub-case of state 3 — are **free** to fix; exhaust them before proposing any spend. State 3's `is_active = false` sub-case is free of Voyage credits but is **not** free of an assessment content decision.

### Phase 4 — Golden-set gate

The golden set currently binds **4 of 18** cells. Before any **per-cell** tuning claim: drop the two out-of-scope cells; add seeds to `eval/rag/golden/seed-queries.json` for the **14 missing cells** (math 6, 8, 9, 10, 11, 12 / science 6, 8, 9 / physics 12 / chemistry 11, 12 / biology 11, 12); reach **>=10 bound items per cell** (B2 found 5 is under-powered — one item flipping moves a cell metric ~0.20); bind with `npx tsx eval/rag/harness/bind-corpus.ts --print`; validate with `npx tsx eval/rag/harness/verify-golden.ts` (enforces `CANONICAL_SUBJECT_CODES` and the P13 recursive PII-key ban). Seeds are **assessment-owned**; procedure is `eval/rag/golden/README.md`, section "Task 10 binding procedure".

The golden set is **prod-bound** (`corpus_ref.project_ref = shktyoxqhundlvkiwguu`), so binding requires prod credentials. Until this gate passes, only an **overall** claim is permitted, and only on a PASS run.

Record the granularity mismatch in the report: the harness aggregates at **(grade-band x subject)** — `GRADE_BANDS = ['6-8','9-10','11-12']` (`eval/rag/harness/metrics.ts:77`) — which is **8** report cells for the keep-set, while coverage is **18** cells across the whole in-scope chapter registry (count it with Q2; the 282 above is an expectation, not a measurement). Never equate the two.

### Phase 5 — Re-capture the baseline before comparing anything

The committed baseline `eval/rag/baseline/ncert-baseline-v1.json` was captured 2026-06-14 against the old `p_min_quality` gate; PR #1394 replaced it with a real cosine floor (`NCERT_MIN_COSINE_SIMILARITY = 0.22`). Every delta against it is currently meaningless.

From `apps/host`: `npm run eval:rag:harness`. It takes **no arguments** — scope comes entirely from the hardcoded `GOLDEN_PATH`/`BASELINE_PATH` at `eval/rag/harness/cli.ts:68-69`. The report lands in `eval/rag/reports/`.

**Exit code is 0 for PASS, REGRESS AND INCONCLUSIVE.** Read the report's `verdict` field, never `$?`. Exit 2 means operator/config error only.

**INCONCLUSIVE dominates and forbids every claim.** It is forced by a missing `VOYAGE_API_KEY` (FTS-only run), any unmeasurable primary metric, or a placeholder baseline.

### Phase 6 — Sweep, and respect the noise band

`npx tsx eval/rag/harness/b2-sweep.ts <mode>` — modes are `floor` (cosine 0.15/0.22/0.30), `fetchn` (30/40/60), `mmr` (0.5/0.7/0.85), `validate-replica`, `rrfk`, default `all` (`b2-sweep.ts:396,412-447,456-460`). Use those exact strings: an unrecognised mode matches no branch, runs zero sweeps, still writes a results file and **still exits 0** (`:456-460`) — a silent no-op that reads like a clean run. **RRF-k is not measurable**: `v_k := 60` is a SQL constant inside the RPC and the `rrfk` mode prints that refusal rather than measuring (`b2-sweep.ts:446-453`); sweeping it needs a parameterized measurement RPC first (architect).

A7 regress bands, breaching any one is REGRESS: nDCG@10 2% rel / recall@10 2% rel / MRR 3% rel / hit-rate@10 2pp abs / groundedness-rate 3pp abs.

**Noise band: below ~0.02 overall or ~0.04 per cell is not signal.** Voyage `voyage-3` embeddings are not bit-deterministic. Iteration 1 found no knob beat baseline — KEEP CURRENT CONFIG. `6-8/math` is the priority target (nDCG@10 0.3750 / hit-rate@10 0.80 vs 0.6617 / 0.9667 overall), but treat it as a **coverage** hypothesis first: run Phase 2 on it before assuming the retriever is at fault.

### Phase 7 — Route any production edit

A winning knob changes constants in `supabase/functions/_shared/rag/retrieve.ts` (`NCERT_MIN_COSINE_SIMILARITY` 0.22 with a hard ceiling of 0.35, `RERANK_DEFAULT_FETCH` 40, `applyMMR(..., 0.7)`, `DEFAULT_LIMIT` 8). The edit is made by **ai-engineer**, reviewed by **assessment** and **testing**, validated at orchestrator Gate 5. This skill never makes it.

Three traps to state explicitly in the report:
- Always send **both** `p_quality_score_gate` and `p_min_similarity`, or you silently bind the old floor-less RPC overload.
- `mode:'soft'` (what Foxy chat uses) disables rerank entirely (`grounded-answer/pipeline.ts:204`), so a soft-mode measurement says nothing about the reranked path.
- The rerank model is `rerank-2`. The string `voyage-rerank-2` returns HTTP 400 and **silently** disables reranking.

## Report template

Write to `docs/audits/YYYY-MM-DD-rag-math-science-coverage.md`:

```
# RAG Math/Science Coverage & Tuning — <YYYY-MM-DD>
Tier: T0 | T1 | T2 | T3    Q1 rows: <n> (expected 18)

## 1. Verdict
Coverage: READY | DEGRADED | BLIND | UNMEASURED   (<n>/18 cells READY)
Tuning:   NOT ATTEMPTED | INCONCLUSIVE | NO-CHANGE | CHANGE PROPOSED
NOTE: CELL_READY means the retriever can see the text. It does NOT mean the
chapter is reachable in /quiz — the picker available_chapters_for_student_subject_v2
additionally requires is_in_scope = TRUE AND rag_status IN ('partial','ready')
(20260814000014_tiered_verification_serving_and_truthful_picker.sql), and
rag_status DOES depend on verified_question_count. A cell can be CELL_READY here
while every chapter in it is invisible to students.

## 2. Per-cell coverage (all 18 rows, none omitted)
| grade | subject_code | chapters | READY | worst state | cell verdict |
(`chapters` comes from Q2 at runtime — never from this skill's 282 expectation.)

## 3. Chapter exceptions
| grade | subject | ch | state | evidence (query id) | fix owner | spends credits |

## 4. Scope-wide embedding health
active chunks | unembedded | wrong_dim | non_voyage | model distribution observed
| unattributed (NULL subject_code or grade_short)
is_active NULL rows excluded: <n>   <- from Q8 ONLY (Q4/Q5 read 0 by construction)

## 5. Eval evidence
Harness report: <path>   Verdict: PASS | REGRESS | INCONCLUSIVE
Baseline provenance: <path>, captured <date>, settings <note>
| metric | baseline | current | delta | A7 band | inside noise band? |
Golden-set coverage: <n>/18 cells bound, <n> items/cell

## 6. Tuning outcome
Knob | value tried | delta | verdict | proposed? (y/n, with reviewer chain)

## 7. Provenance
Every number above maps to a query id + UTC timestamp + tier, or a report path.
A number with no provenance row is DELETED, not estimated.
```

## Absolute rules

1. Never quote a metric, chunk count or coverage number from memory, from this file, or from a prior audit. Unmeasurable means `UNMEASURED`.
2. Never run `ncert:embed`, `ncert:ingest` or `generate-embeddings` from this skill — they spend real Voyage credits. Propose with a per-chapter estimate and STOP for approval.
3. Never re-baseline to erase a REGRESS. Re-capture is legitimate only in Phase 5, before the comparison, for the documented staleness reason.
4. Never claim a tuning result from an INCONCLUSIVE run, or from a run without `VOYAGE_API_KEY`.
5. Never widen scope beyond the 18 cells. `scripts/check-content-gaps.ts` carries 13 subjects — its first five entries are the keep-set; the rest are out of scope here.
6. Never write a chapter-renumbering migration off a title match alone — confirm against `chunk_text`, which is authoritative over garbled `chapter_title` metadata.
7. Never edit `supabase/functions/_shared/rag/retrieve.ts` from this skill.
8. Never treat `rag_status='partial'` as missing content. `recompute_syllabus_status()` returns `missing` only at chunks=0; `partial` when chunks<50 **OR** verified_questions<40; else `ready`. A fully embedded chapter reads `partial` purely because its questions are unverified.
9. Never assert the embedding model from the column default. `rag_content_chunks.embedding_model` carries a stale column DEFAULT of `'mistral-embed'` while live writers write `'voyage-3'` — report the observed distribution, paired with `embedding IS NOT NULL`.
10. Read-only: Q1-Q8 are SELECT-only and safe against production.

## Follow-ups this skill surfaces but must NOT perform

1. **No CI path runs the B1 harness.** `.github/workflows/rag-eval.yml` runs `scripts/rag-eval.mjs`, not `eval/rag/harness/cli.ts`, and passes no `VOYAGE_API_KEY`. A T3 workflow modelled on `rag-cosine-replay.yml` (dispatch-only, `dry_run_only` default true, bounded `limit`, fail-loud on missing secrets) is an **architect** change under the deployment-config chain.
2. **Golden-set widening from 4 to 18 cells at >=10 items each** (~180 items) is assessment-owned CBSE content work and is the single largest prerequisite before any per-cell tuning claim is defensible.
