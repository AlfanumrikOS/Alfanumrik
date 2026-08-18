# RAG Math/Science Coverage & Tuning — 2026-08-13

Tier: **T2** (operator machine — `.env.local` present with `SUPABASE_SERVICE_ROLE_KEY`,
`VOYAGE_API_KEY`, `ANTHROPIC_API_KEY`; egress confirmed live)
Q1 rows: **18** (expected 18) — scope lock CONFIRMED
Project: `shktyoxqhundlvkiwguu` (prod, matches golden-set `corpus_ref.project_ref`)
Requested focus: *"fine tune the RAG for holistic concept explanations with diagrams and
various examples which relate to day-to-day life."*

> **Tier note — the skill's T0 default did not apply.** SKILL.md Phase 0 assumes the
> sandbox has no egress (HTTP 000). Measured here: `api.voyageai.com` -> 405,
> project `supabase.co` -> 401 (both reachable), and `.env.local` exists. This ran as a
> genuine T2 audit, so the numbers below are measured, not `UNMEASURED`.

## 1. Verdict

Coverage: **BLIND** — 0/18 cells READY
Tuning: **NOT ATTEMPTED** — blocked at the Phase 3 gate, and separately the request is
not reachable by the tuning knobs at all (see section 6)

NOTE: CELL_READY means the retriever can see the text. It does NOT mean the chapter is
reachable in /quiz — the picker `available_chapters_for_student_subject_v2` additionally
requires `is_in_scope = TRUE AND rag_status IN ('partial','ready')`, and `rag_status`
DOES depend on `verified_question_count`.

**Headline:** the corpus is far healthier than the registry says, but **no chapter in the
entire keep-set can ever reach `rag_status='ready'`** — the maximum
`verified_question_count` anywhere in scope is **19**, against a bar of 40. That single
fact makes `ready` structurally unreachable platform-wide for math+science.

## 2. Per-cell coverage (all 18 rows)

`reg` = in-scope registry chapters · `cov` = chapters with >=1 active chunk ·
`absent` = registry chapters with 0 active chunks · `>=50` = chapters clearing the
text-only readiness bar (`cbse_syllabus_rag_ready`) · `diag%` = share of active chunks
carrying `media_type='diagram'`

| cell | reg | cov | absent | >=50ch | chunks | diag% | cell verdict |
|---|---|---|---|---|---|---|---|
| 6/math | 10 | 10 | 0 | 1 | 346 | 43.6% | CELL_BLIND |
| 6/science | 12 | 12 | 0 | 0 | 353 | 42.2% | CELL_BLIND |
| 7/math | 15 | 15 | 0 | 6 | 593 | 46.0% | CELL_BLIND |
| 7/science | 12 | 12 | 0 | 0 | 347 | 47.6% | CELL_BLIND |
| 8/math | 14 | 14 | 0 | 7 | 559 | 46.0% | CELL_BLIND |
| 8/science | 13 | 13 | 0 | 0 | 434 | 47.5% | CELL_BLIND |
| 9/math | 13 | 8 | **5** | 2 | 349 | **0.0%** | CELL_BLIND |
| 9/science | 14 | 13 | 1 | 4 | 573 | **0.0%** | CELL_BLIND |
| 10/math | 15 | 14 | 1 | 1 | 399 | 47.9% | CELL_BLIND |
| 10/science | 16 | 13 | 3 | 1 | 450 | 46.7% | CELL_BLIND |
| 11/biology | 22 | 19 | 3 | 0 | 465 | 47.7% | CELL_BLIND |
| 11/chemistry | 14 | 9 | **5** | 6 | 758 | 39.4% | CELL_BLIND |
| 11/math | 16 | 14 | 2 | 6 | 604 | 47.4% | CELL_BLIND |
| 11/physics | 15 | 15 | 0 | 7 | 765 | 36.1% | CELL_BLIND |
| 12/biology | 16 | 13 | 3 | 2 | 419 | 46.3% | CELL_BLIND |
| 12/chemistry | 16 | 14 | 2 | 5 | 618 | 40.1% | CELL_BLIND |
| 12/math | 13 | 13 | 0 | 6 | 782 | 47.8% | CELL_BLIND |
| 12/physics | 15 | 14 | 1 | 6 | 737 | 45.0% | CELL_BLIND |

Registry reconciliation: **261** in-scope keep-set chapters live vs the skill's 282
seed-manifest expectation. The delta is fully explained — exactly **21** keep-set rows
carry `is_in_scope = false` (deliberately retired). 282 - 21 = 261. **No registry drift.**

## 3. Chapter exceptions

**26 chapters have zero active chunks** (ABSENT_CANDIDATE, confirmed against Q8 — see
below). Q7 found **0 orphan coordinates**, so there is **no COORDINATE_DRIFT** in the
keep-set: the `20260814000013` reconciliation migration appears to have done its job.

| grade/subject | chapters with no active chunks |
|---|---|
| 9/math | 9, 10, 11, 12, 13 |
| 9/science | 14 |
| 10/math | 15 |
| 10/science | 14, 15, 16 (Sources of Energy, Our Environment, Sustainable Management of Natural Resources) |
| 11/biology | 20, 21, 22 (Transport in Plants, Mineral Nutrition, Digestion and Absorption) |
| 11/chemistry | 10, 11, 12, 13, 14 (s-Block, p-Block 13&14, Environmental Chemistry, States of Matter, Hydrogen) |
| 11/math | 15, 16 (Mathematical Reasoning, Principle of Mathematical Induction) |
| 12/biology | 14, 15, 16 |
| 12/chemistry | 15, 16 |
| 12/physics | 15 |

**ABSENT gate satisfied:** Q8 measured `is_active IS NULL` = **0** across the whole table,
so none of these 26 is a free INACTIVE backfill. They are genuine state 4 `ABSENT` —
**re-ingestion spends Voyage credits and needs CEO approval.**

**Registry mislabelling (new finding, not in the skill's state table):** only **13**
chapters carry `rag_status='missing'`, but **26** have zero active chunks. So **13
chapters advertise `partial` while serving no NCERT text at all** — and `partial` is a
value the /quiz chapter picker treats as servable. Those chapters can be selected by a
student and have nothing behind them. Owner: architect (`recompute_syllabus_status()`
re-run, plus investigate why the trigger did not fire).

## 4. Scope-wide embedding health

Keep-set, active: **9,551** chunks (of 27,778 in the whole table; 9,835 keep-set
attributed, 284 of those inactive).

| metric | value | source |
|---|---|---|
| active keep-set chunks | 9,551 | Q4 |
| `embedding IS NULL` | **125** | Q4 |
| `embedding_model = 'mistral-embed'` | **125** | Q4 |
| overlap of the two | **125 (identical set)** | Q4 |
| `embedding_model = 'voyage-3'` | 5,593 | Q4 |
| `embedding_model = 'voyage/voyage-3'` | 3,833 | Q4 |
| unattributed (NULL `subject_code`/`grade_short`) | **0** | Q5 |
| `is_active IS NULL` | **0** | Q8 |
| `is_active = false` | 550 (whole table) | Q8 |

**Rule 9 vindicated exactly.** The 125 `mistral-embed` rows are not mistral-embedded —
they are the stale column DEFAULT sitting on rows that were **never embedded at all**
(`embedding IS NULL` on precisely the same 125). Classifying them from the model label
alone would have hidden a real state 6 `UNEMBEDDED` gap.

**Two Voyage labels for one model.** `voyage-3` (5,593) and `voyage/voyage-3` (3,833) are
the same model written by two different writers. Not a correctness bug, but any future
audit keying on the literal `voyage-3` alone will under-count by 40%.

## 5. Eval evidence

Harness: **NOT RUN.** Phase 3 forbids it — every cell is `CELL_BLIND`, and Phase 4 golden
set binds only 4 of 18 cells. Running it would have produced a number that could not
support a claim.
Baseline: `eval/rag/baseline/ncert-baseline-v1.json`, captured 2026-06-14 against the
pre-#1394 `p_min_quality` gate — stale, must be re-captured before any comparison.
Golden-set coverage: 4/18 cells bound, 5 items/cell (>=10 required for per-cell claims).

## 6. Tuning outcome — the requested goal is NOT reachable by tuning

Requested: holistic concept explanations, with diagrams, and everyday-life examples.
Measured against the corpus and the live retrieval path:

| # | Finding | Measurement |
|---|---|---|
| F1 | **Retrieval has no lever for content type.** The RPC `match_rag_chunks_ncert` accepts `p_content_type` and `p_concept`, but `supabase/functions/_shared/rag/retrieve.ts` never sends either. Diagrams and examples are retrieved only incidentally, by text similarity. | grep: `p_content_type` absent from `retrieve.ts` |
| F2 | **Diagrams exist and are plentiful — except at grade 9.** 3,833 of 9,551 keep-set chunks (40%) carry `media_type='diagram'`, 36-48% in every cell **except 9/math and 9/science, which have exactly ZERO.** | Q4 per-cell |
| F3 | **Every diagram is a dead link to the model.** `media_description` is NULL on **all 3,833** diagram chunks, while `media_url` is populated on all 3,833. A retrieved diagram contributes a URL and no describable content — an LLM cannot explain a picture it cannot read. | Q4 |
| F4 | **The corpus has no pedagogical dimensions to tune on.** `chunk_type` is `concept_explanation` for **all 9,551**; `content_layer` is `foundation` for **all 9,551**; `content_type='qa'` is **0**. There is no example, application or real-life label anywhere. | Q4 |
| F5 | **Enrichment metadata exists only on diagram rows.** `topic`, `concept` and `bloom_level` are non-NULL on exactly 3,833 rows — the diagram set — and NULL on all 5,718 text chunks. | Q4 |
| F6 | **Everyday-life framing is present but thin.** In keep-set active `chunk_text`: "for example" 1,355 (14%), "such as" 1,103, "activity" 1,223, "everyday" 150, "daily life" 87, "in our daily" 35, "real life"/"real-life" 50, "have you ever" 124, "day-to-day" 19. Explicit day-to-day framing is roughly **3%** of the corpus. | ilike counts |

**Conclusion.** No value of the three tunable knobs (cosine floor, fetch-N, MMR-lambda)
can raise the rank of everyday-life example content, because (a) nothing labels it,
(b) the retrieval path cannot filter on the labels that do exist, and (c) at ~3% density
the material is largely not in the corpus to begin with. This is a **content-and-plumbing
workstream, not a retrieval-tuning one.** Per Absolute Rule 4 and the Phase 3 gate, no
tuning was run and no tuning claim is made.

### Ranked remediation

| # | Action | Owner | Spends Voyage credits |
|---|---|---|---|
| S1 | Populate `media_description` for the 3,833 diagram chunks (vision captioning). Highest leverage: converts 40% of the corpus from a dead URL into explainable content. | ai-engineer | yes (captioning); re-embed optional |
| S2 | Pass `p_content_type`/`p_concept` from `retrieve.ts`, or add a diagram-aware boost. Production edit, so ai-engineer implements and assessment + testing review (P14). | ai-engineer | no |
| S3 | Re-run `recompute_syllabus_status()` for the 13 chapters mislabelled `partial` with zero active chunks. | architect | no |
| S4 | Extract diagrams for 9/math and 9/science (`extract-diagrams` / `embed-diagrams`). | ai-engineer | yes |
| S5 | Embed the 125 chunks with `embedding IS NULL`. Smallest paid item; closes state 6. | ai-engineer | yes (small) |
| S6 | Decide whether the 26 ABSENT chapters get ingested — includes whole senior blocks (11/chemistry s-Block, p-Block, States of Matter, Hydrogen). | CEO decision | yes |
| S7 | Introduce a real `content_layer`/`chunk_type` taxonomy so example and application become retrievable at all. Prerequisite for ever measuring this goal. | assessment (taxonomy) + architect (schema) | no |
| S8 | Question verification: max `verified_question_count` in scope is 19 against a bar of 40, so `ready` is unreachable; 157 chapters sit at 0. | assessment | no |

## 7. Provenance

All figures measured 2026-08-13 at tier T2 against prod `shktyoxqhundlvkiwguu` via
read-only PostgREST SELECTs with `Prefer: count=exact` and full pagination
(27,778/27,778 chunk rows read; 1,148/1,148 syllabus rows; 18/18 `grade_subject_map`
rows). Zero writes, zero RPC calls, no paid API calls. `.env.local` confirmed gitignored
(`.gitignore:70`); no secret value was printed at any point.
Harness metrics: NOT MEASURED (not run, per the Phase 3 gate). Baseline figures quoted
from the committed JSON are provenance-tagged as stale, not re-measured.

---

## CORRECTION — 2026-08-13, same day, after S1/S2 scoping

**Findings F2, F3 and F5 above are WRONG, and recommendation S1 was built on the error.**
Corrected here rather than edited away, so the mistake stays visible.

**What I claimed:** 3,833 keep-set chunks (40%) are diagrams, all missing captions, so
captioning them was the highest-leverage fix.

**What is actually true:** `media_type='diagram'` marks nothing. Measured:

| Probe | Result | Implication |
|---|---|---|
| `media_url` file extensions, whole table | **8,880 `.pdf`, 0 `.png`/`.jpg`/`.svg`/`.webp`** | No image asset exists anywhere |
| Distinct `media_url` per 1,000 diagram rows | **195** (~5 rows share one URL) | The URL is the whole chapter PDF, not a figure |
| Storage bucket `ncert-books` | PDFs only; no `diagrams/`, `figures/`, `images/` prefix | Nothing to fetch |
| `page_number` non-NULL, whole table | **0** of 27,778 | Cannot even locate a figure inside the PDF |
| `chunk_text ILIKE 'Diagram:%'` (the `embed-diagrams` insert signature) | **0** | **`embed-diagrams` has never run in production** |
| `media_type='diagram'` with `word_count >= 60` | **8,863 of 8,880** | These are full prose chunks, not figure records |
| Diagram-tagged chunks mentioning "Fig" | 1,146 / 3,833 = **30%** | — |
| **Untagged** chunks mentioning "Fig" | 1,961 / 5,718 = **34%** | The tag is *negatively* correlated with referencing a figure — **zero signal** |

`media_type='diagram'` was applied by a bulk update that stamped ordinary text chunks with
the source-PDF URL (`embed-diagrams/index.ts:513-516` mutates the source chunk's
`media_url`). The rows it was meant to create were never created.

**Corrected findings:**
- **F2 (corrected):** there are **zero diagrams in the RAG corpus** — not "diagrams
  lacking captions". The 9/math and 9/science "zero diagrams" result is not a gap
  relative to other cells; no cell has diagrams.
- **F3 (corrected):** `media_description` is NULL because no diagram entity was ever
  created, not because a captioning step was skipped.
- **F5 (corrected):** `topic`/`concept`/`bloom_level` are non-NULL on those 3,833 rows
  because `scripts/backfill-rag-metadata.sql` heuristically filled them. Sampling shows
  `concept` values are page-header noise — `"202 BIOLOGY"`, `"126"`, `"114 MATHEMATICS"`.
  This metadata is not usable as a retrieval signal.
- **S1 (withdrawn):** "caption the 3,833 diagrams" is not executable. There is nothing to
  caption.

**What did survive:** F1 (retrieval has no content-type lever), F4 (no pedagogical
dimensions) and F6 (everyday-life framing ~3%) are unaffected — all three were measured
independently of the diagram question. Sections 1-5 of this audit (coverage, the 26 ABSENT
chapters, the 13 mislabelled chapters, the 125 unembedded chunks, `ready` being
unreachable) are also unaffected.

**Also found, worth its own ticket:** `content_type` and `media_type` disagree on **7,347
rows table-wide** (2,696 in keep-set). `content_type` was backfilled once by
`_legacy/timestamped/20260403400000_rag_three_categories.sql` and no live writer maintains
it. Both columns are unreliable; neither is safe as a retrieval predicate today.
