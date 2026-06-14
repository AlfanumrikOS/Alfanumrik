# B1 RAG eval-harness — Golden query set

This directory holds the **assessment-owned** CBSE/NCERT golden query content for the
B1 retrieval-quality eval harness (spec
`docs/superpowers/specs/2026-06-13-rag-retrieval-quality-design.md`,
plan `docs/superpowers/plans/2026-06-13-rag-eval-harness.md`).

## Two files, two stages

| File | Stage | Owner | Contains |
|---|---|---|---|
| `seed-queries.json` | **Task 9 (this asset)** | assessment | The durable intellectual asset: real, natural CBSE student **queries** stratified by grade band x core subject x query type, each with a `target` describing what a relevance=2 chunk MUST contain. **No chunk UUIDs.** |
| `ncert-golden-v1.json` | **Task 10 (operator step)** | operator + assessment | The schema-valid fixture (`eval/rag/harness/golden-schema.ts`) where each query is **bound** to real `rag_content_chunks.id` UUIDs with graded `relevance` (2/1/0) + the `off_grade_scope` flag. Produced from `seed-queries.json` against the live `ncert_2025` corpus. |

### Why the split

This authoring environment has **NO live staging-corpus access**, so real
`rag_content_chunks` chunk UUIDs cannot be resolved here. The durable IP is the
**query set with curriculum targets** — that survives any corpus re-ingest. The
mechanical UUID-binding + relevance labeling + baseline capture is the documented
operator step (Task 10), performed against the same DB CI reads (Q1 corpus-parity
condition). **`seed-queries.json` deliberately contains zero chunk UUIDs;** no
fake-but-real-looking UUID was fabricated as if resolved.

### Task 10 binding procedure (operator)

For each item in `seed-queries.json`:

1. Filter `rag_content_chunks` by `source = 'ncert_2025'`, `grade_short = <item.grade>`,
   `subject_code = <item.subject>`, and `chapter_number = <item.chapter_number>`
   (and/or `concept`/`topic` from the `target`).
2. Read `chunk_text`. Confirm the chunk genuinely answers the query per
   `target.relevance_2_description` (A3 — candidate-pool-independent: do NOT label
   from whatever `retrieve()` currently returns; that would score the system
   against itself).
3. Assign graded `relevance`: `2` = directly answers / primary source per the
   target; `1` = partial/useful context; chunks that do not answer are simply not
   listed (or labeled `0` when explicitly disambiguating). For `multi_hop` items,
   every concept in `target.multi_hop_required_concepts` needs its own `relevance=2`
   chunk (the A5 full-coverage metric requires the complete required-primary set).
4. Set `off_grade_scope` per chunk (A2 — right topic, wrong grade band is flagged
   separately from topical irrelevance).
5. Emit the bound item into `ncert-golden-v1.json` with `relevant_chunks[]` and run
   the live corpus-parity resolve check (Task 5 runner) so every chunk UUID resolves.

## Coverage decision (Q2, spec section B1.3)

- **Grade bands:** 6-8 (junior) / 9-10 (secondary) / 11-12 (senior). Grades are STRINGS.
- **2 core subjects per band**, canonical snake_case `subject_code` only.
  Grades 6-10 use the combined `science` + `social_studies` codes; grades 11-12
  **substitute** `physics` for combined `science` and `history_sr` for combined
  `social_studies` (those combined codes do not exist at senior-secondary).
- **All 4 query types** (`factual`, `conceptual`, `definition`, `multi_hop`)
  present in **every (band x subject) cell**.
- **>=2 items per (band x subject) cell**, and **>=1 `multi_hop` per cell**.
- **Total: 30 items** (within the 28-32 target).

## Coverage matrix (band x subject x query_type item counts)

Each cell shows the count of items of that query type in that (band x subject) cell.
`MH` = multi_hop. Every (band x subject) row has all 4 query types and >=1 multi_hop.

| Band | Subject | factual | conceptual | definition | multi_hop | Cell total |
|---|---|---|---|---|---|---|
| 6-8 (junior) | `science` | 1 | 2 | 1 | 1 | 5 |
| 6-8 (junior) | `math` | 2 | 1 | 1 | 1 | 5 |
| 9-10 (secondary) | `science` | 1 | 2 | 1 | 1 | 5 |
| 9-10 (secondary) | `social_studies` | 1 | 2 | 1 | 1 | 5 |
| 11-12 (senior) | `physics` | 1 | 2 | 1 | 1 | 5 |
| 11-12 (senior) | `history_sr` | 1 | 2 | 1 | 1 | 5 |
| **Totals** | **6 cells** | **7** | **11** | **6** | **6** | **30** |

- **6 (band x subject) cells**, each with **5 items** = **30 total**.
- Every cell: **all 4 query types present**, **>=2 items** (5 >= 2), **>=1 multi_hop** (exactly 1 each).
- Query-type totals: factual 7, conceptual 11, definition 6, multi_hop 6 (sum = 30).

## Corpus binding (Option-1: prod-bound) — live-DB CI skips corpus-parity on staging

`ncert-golden-v1.json` is **prod-bound**: its chunk UUIDs resolve only against the
project declared in `corpus_ref.project_ref` (`shktyoxqhundlvkiwguu` = prod). The
live-DB CI lane connects to **staging**, where those prod UUIDs don't exist, so the
`run-eval.integration.test.ts` corpus-parity check **skips loudly on staging by
design** (compares `corpus_ref.project_ref` to the connected project ref) rather
than false-failing. Corpus-parity is enforced wherever the harness runs against the
**bound** corpus — locally with prod creds, or the operator / scheduled prod-targeted
run. (A golden set without `corpus_ref.project_ref` keeps the old same-corpus
fail-loud behavior.)

## Subject-code discipline

Canonical snake_case `subject_code` only (matches
`eval/rag/harness/golden-schema.ts` `CANONICAL_SUBJECT_CODES`). NEVER `civics`,
NEVER `history`, NEVER `social science` / `social_science`. Senior History is
`history_sr`.

## Chapter grounding

`chapter_number` + `target.chapter_name` use real NCERT chapter
names/numbers for the stated grade (e.g. Grade 10 Social Studies ch.2
"Nationalism in India"; Grade 10 Science ch.11 "Electricity"; Grade 11 Physics
ch.4 "Laws of Motion"; Grade 11 History "Themes in World History Part 1 — The
Three Orders / Changing Cultural Traditions"). They are the lookup keys the Task
10 operator uses to find the relevant chunks. (Chapter numbering can vary by
NCERT edition; the operator confirms against the live corpus during binding —
the live `ncert_2025` edition is renumbered/retitled vs older editions, and
`chunk_text` is authoritative over chapter metadata.)

## Task 10 step B re-targets (assessment-validated, 2026-06-14)

During binding it emerged that the live `ncert_2025` g11/history_sr corpus is
**"Themes in World History Part 1"** (medieval/early-modern: The Three Orders /
feudalism, Changing Cultural Traditions / Renaissance, Confrontation of
Cultures, Paths to Modernisation) — **the French Revolution chapter is NOT in
the indexed corpus.** A query about content that does not exist can never be
measured, so the entire g11/history_sr cell (items 026-030) was **re-targeted**
to in-corpus content while preserving the cell's query-type matrix (1 factual /
1 definition / 2 conceptual / 1 multi_hop, multi_hop with full rel=2 coverage).
The g7-math-009 mean item was re-anchored from a phantom "Data Handling" chapter
to the real ch13 "Connecting the Dots" (which states the mean formula verbatim).
Full rationale + the structural old-NCERT-vs-NCERT-2025 drift findings are in
`eval/rag/golden/corpus-coverage-findings.md`. The coverage matrix below is
**unchanged** by the re-targets — only the underlying chapters/queries moved.
