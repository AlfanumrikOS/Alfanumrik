# Coverage SQL — Q1..Q8

Eight audit queries backing Phases 1-2 of `.claude/skills/rag-math-science-tuning/SKILL.md`.

**All eight are read-only.** Every query begins with `SELECT` or `WITH`, and nothing in this file writes, creates, modifies or removes anything. Safe to run against production.

Scope everywhere below is the CEO keep-set and nothing else:
- grades `'6'`..`'10'` → `math`, `science`
- grades `'11'`,`'12'` → `math`, `physics`, `chemistry`, `biology` (no `science` at 11-12)

Grades are strings (P5). Subject codes are snake_case (`math`, not `Mathematics`).

## How to run

| Tier | How |
|---|---|
| **T1 Supabase MCP** | pass each query to `execute_sql` verbatim, one at a time. Read the returned rows; never summarise a count you did not receive. |
| **T2 operator machine** | `psql "$SUPABASE_DB_URL" -f -` with the query on stdin, or paste into the Supabase SQL editor. Both are copy-pasteable as written. |
| **T0 sandbox** | not runnable — `*.supabase.co` returns HTTP 000. Report every cell `UNMEASURED`; do not estimate. |

## Guard constants

Reused, not re-derived, from `docs/runbooks/2026-08-14-cbse-syllabus-corpus-reconciliation-dry-run.sql` (an 816-line read-only pre-flight already scoped to this exact keep-set, with stop-condition, trust-decision, blast-radius and one-page-summary sections). Its constants are duplicated here on purpose so this file is standalone:

```
min_cell_chapters  = 3
min_cell_chunks    = 50
max_chapter_number = 30
```

If you change one, change both files. `min_cell_chunks = 50` is the same floor `cbse_syllabus_rag_ready()` applies.

Two caveats that apply to every query below:
- `rag_content_chunks.is_active` is NULLABLE. Every count here except Q8 filters `is_active = true`, which silently excludes NULL rows. **Q8 is the only query that can see them** — it carries no `is_active` predicate at all.
- `rag_content_chunks.embedding_model` carries a stale column default of `'mistral-embed'` while live writers write `'voyage-3'`. Report the observed distribution (Q4 `model_variants` / `model_sample`); never assert the model from the column default alone.

---

## Q1 — Scope lock

Expect exactly **18** rows. Any other count is scope drift: STOP.

`grade_subject_map` **does have a `board` column** — added by `20260605000000_fix_board_subject_chapter_gaps.sql:9` (`ADD COLUMN IF NOT EXISTS board TEXT DEFAULT 'CBSE'`), so it is absent from the `00000000000000_baseline_from_prod.sql:11365-11376` table definition and present in the live schema. The unique index is `grade_subject_map_uniq (grade, subject_code, stream, board) NULLS NOT DISTINCT`, and `20260814000008` re-seeds grades 11-12 **once per `(grade, board)` pair**. A raw row count is therefore `18 x (number of distinct boards)`, not 18. Q1 aggregates over `board` so the 18-row expectation holds regardless; read `boards` to see whether more than one exists.

Full column list: `id, grade, subject_code, stream, is_core, min_questions_seeded, created_at, updated_at, board`.

```sql
SELECT
  gsm.grade,
  gsm.subject_code,
  min(s.name)                                   AS subject_name,
  bool_or(gsm.is_core)                          AS is_core,
  max(gsm.min_questions_seeded)                 AS min_questions_seeded,
  array_agg(DISTINCT COALESCE(gsm.stream, '<null>')) AS streams,
  array_agg(DISTINCT COALESCE(gsm.board,  '<null>')) AS boards,
  count(*)                                      AS raw_rows
FROM public.grade_subject_map gsm
JOIN public.subjects s
  ON s.code = gsm.subject_code
WHERE s.is_active = true
GROUP BY gsm.grade, gsm.subject_code
ORDER BY gsm.grade::int, gsm.subject_code;
```

A `streams` value other than `{<null>}` at grades 11-12 means `20260814000008`'s de-streaming did not fully apply — report it, do not work around it.

**Non-18 row count means:** the live catalogue no longer matches the CEO lock set by migrations `20260814000007` / `20260814000008`. Every downstream number in the audit is scoped wrong. Stop and escalate to architect.

---

## Q2 — Registry-vs-corpus cache drift

Thin read of `public.cbse_syllabus_rag_diagnostic`, scoped to the keep-set.

```sql
WITH scope(grade, subject_code) AS (
  SELECT g.grade, s.code
    FROM (VALUES ('6'),('7'),('8'),('9'),('10')) g(grade)
   CROSS JOIN (VALUES ('math'),('science')) s(code)
  UNION ALL
  SELECT g.grade, s.code
    FROM (VALUES ('11'),('12')) g(grade)
   CROSS JOIN (VALUES ('math'),('physics'),('chemistry'),('biology')) s(code)
)
SELECT
  d.grade,
  d.subject_code,
  d.chapter_number,
  d.chapter_title,
  d.rag_status,
  d.chunk_count            AS cached_chunk_count,
  d.actual_chunk_count,
  d.verified_question_count,
  d.sync_state
FROM public.cbse_syllabus_rag_diagnostic d
JOIN scope sc
  ON sc.grade = d.grade
 AND sc.subject_code = d.subject_code
WHERE d.sync_state = 'STALE'
ORDER BY d.grade::int, d.subject_code, d.chapter_number;
```

**A non-zero result means:** the denormalised `cbse_syllabus.chunk_count` disagrees with the live corpus — the maintenance trigger missed a write. Trust `actual_chunk_count`, never `cached_chunk_count`, for every downstream verdict. Reconciling the cache is `recompute_syllabus_status()`, which is an architect-owned production call, not part of this audit.

---

## Q3 — Severity-ranked gap ledger

Thin read of `public.ingestion_gaps`, scoped to the keep-set.

```sql
WITH scope(grade, subject_code) AS (
  SELECT g.grade, s.code
    FROM (VALUES ('6'),('7'),('8'),('9'),('10')) g(grade)
   CROSS JOIN (VALUES ('math'),('science')) s(code)
  UNION ALL
  SELECT g.grade, s.code
    FROM (VALUES ('11'),('12')) g(grade)
   CROSS JOIN (VALUES ('math'),('physics'),('chemistry'),('biology')) s(code)
)
SELECT
  ig.grade,
  ig.subject_code,
  ig.chapter_number,
  ig.chapter_title,
  ig.rag_status,
  ig.chunk_count,
  ig.verified_question_count,
  ig.severity,
  ig.potential_affected_students,
  ig.request_count
FROM public.ingestion_gaps ig
JOIN scope sc
  ON sc.grade = ig.grade
 AND sc.subject_code = ig.subject_code
ORDER BY
  CASE ig.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
  ig.potential_affected_students DESC,
  ig.grade::int,
  ig.subject_code,
  ig.chapter_number;
```

**A non-zero result means:** the chapter is not `rag_status='ready'`. It does **not** mean text is missing — `recompute_syllabus_status()` returns `partial` when `chunk_count < 50` **OR** `verified_question_count < 40`, so a fully embedded chapter reads `partial` purely because its questions are unverified. Cross-read `chunk_count` before concluding anything, and never fund re-ingestion off this query alone.

---

## Q4 — Embedding health per chapter (the core probe)

```sql
WITH scope(grade, subject_code) AS (
  SELECT g.grade, s.code
    FROM (VALUES ('6'),('7'),('8'),('9'),('10')) g(grade)
   CROSS JOIN (VALUES ('math'),('science')) s(code)
  UNION ALL
  SELECT g.grade, s.code
    FROM (VALUES ('11'),('12')) g(grade)
   CROSS JOIN (VALUES ('math'),('physics'),('chemistry'),('biology')) s(code)
)
SELECT
  r.grade_short                                            AS grade,
  r.subject_code,
  r.chapter_number,
  count(*)                                                 AS active_chunks,
  count(*) FILTER (WHERE r.embedding IS NULL)              AS unembedded,
  count(*) FILTER (
    WHERE r.embedding IS NOT NULL
      AND vector_dims(r.embedding) <> 1024
  )                                                        AS wrong_dim,
  count(*) FILTER (
    WHERE r.embedding IS NOT NULL
      AND r.embedding_model IS DISTINCT FROM 'voyage-3'
  )                                                        AS non_voyage,
  count(DISTINCT r.embedding_model)                        AS model_variants,
  string_agg(DISTINCT r.embedding_model, ', ')             AS model_sample,
  count(*) FILTER (WHERE r.is_active IS NULL)              AS is_active_null_seen
FROM public.rag_content_chunks r
JOIN scope sc
  ON sc.grade = r.grade_short
 AND sc.subject_code = r.subject_code
WHERE r.is_active = true
  AND r.chapter_number IS NOT NULL
  AND r.chapter_number BETWEEN 1 AND 30
GROUP BY r.grade_short, r.subject_code, r.chapter_number
ORDER BY r.grade_short::int, r.subject_code, r.chapter_number;
```

**A non-zero result means, per column:**
- `unembedded > 0` → state `UNEMBEDDED`: those chunks are reachable by full-text search only, never by vector similarity. Re-embedding spends Voyage credits.
- `wrong_dim > 0` → state `WRONG_DIM`: corrupt vectors in a 1024-d index.
- `non_voyage > 0` → state `WRONG_MODEL`, and this is the check most likely to be missed. `resolveProvider()` in `supabase/functions/_shared/embeddings.ts` falls back to OpenAI `text-embedding-3-small`, which is **also 1024-d** — so `wrong_dim` stays 0 while the vector space is silently mixed. Only `embedding_model` can detect the fallback.
- `active_chunks < 50` → state `BELOW_FLOOR`: fails `cbse_syllabus_rag_ready(grade, subject_code, chapter)`, which returns TRUE only at >=50 active chunks (a text-only bar that ignores questions entirely).
- `model_variants > 1` → the chapter spans more than one embedding model; quote `model_sample` verbatim in the report rather than naming a model from the column default.

The `is_active_null_seen` column reads 0 by construction (the `WHERE` clause already excludes NULL). It exists as a reminder that NULL-`is_active` rows are outside every count here — **never copy its `0` into the report.** Q5 cannot answer the question either (it also filters `is_active = true`); **run Q8**, the only query with no `is_active` predicate.

---

## Q5 — Unattributed chunks (invisible to every student)

```sql
SELECT
  r.grade                        AS legacy_grade,
  r.subject                      AS legacy_subject,
  count(*)                       AS chunks,
  count(*) FILTER (WHERE r.subject_code IS NULL) AS null_subject_code,
  count(*) FILTER (WHERE r.grade_short IS NULL)  AS null_grade_short,
  count(DISTINCT r.chapter_number)               AS distinct_chapters
FROM public.rag_content_chunks r
WHERE r.is_active = true
  AND (r.subject_code IS NULL OR r.grade_short IS NULL)
GROUP BY r.grade, r.subject
ORDER BY chunks DESC;
```

**A non-zero result means:** state `UNATTRIBUTED`. `rag_content_chunks` stores taxonomy twice — the canonical pair `subject_code` + `grade_short` (what the production RPC `match_rag_chunks_ncert` filters on) and the legacy pair `subject` + `grade`. A chunk with a NULL in either canonical column is invisible to every student query no matter how good the text is. This is a **free** fix (an attribution backfill migration, architect-authored), so exhaust it before proposing any re-ingestion spend.

Deliberately unscoped: keep-set filtering happens on the canonical columns, which are exactly the ones missing here.

---

## Q6 — Coordinate drift vs genuine absence

```sql
WITH scope(grade, subject_code) AS (
  SELECT g.grade, s.code
    FROM (VALUES ('6'),('7'),('8'),('9'),('10')) g(grade)
   CROSS JOIN (VALUES ('math'),('science')) s(code)
  UNION ALL
  SELECT g.grade, s.code
    FROM (VALUES ('11'),('12')) g(grade)
   CROSS JOIN (VALUES ('math'),('physics'),('chemistry'),('biology')) s(code)
),
registry AS (
  SELECT cs.grade, cs.subject_code, cs.chapter_number, cs.chapter_title
    FROM public.cbse_syllabus cs
    JOIN scope sc
      ON sc.grade = cs.grade
     AND sc.subject_code = cs.subject_code
   WHERE cs.is_in_scope = true
     AND cs.board = 'CBSE'
),
live AS (
  SELECT r.grade_short AS grade, r.subject_code, r.chapter_number,
         count(*)::int AS chunks,
         min(r.chapter_title) AS corpus_title
    FROM public.rag_content_chunks r
   WHERE r.is_active = true
     AND r.grade_short IS NOT NULL
     AND r.subject_code IS NOT NULL
     AND r.chapter_number BETWEEN 1 AND 30
   GROUP BY 1, 2, 3
)
SELECT
  reg.grade,
  reg.subject_code,
  reg.chapter_number      AS registry_ch,
  reg.chapter_title       AS registry_title,
  alt.chapter_number      AS corpus_ch,
  alt.corpus_title,
  alt.chunks              AS corpus_chunks,
  CASE WHEN alt.chapter_number IS NOT NULL
       THEN 'COORDINATE_DRIFT (free fix)'
       ELSE 'ABSENT_CANDIDATE (verify vs Q8 before funding)'
  END                     AS classification
FROM registry reg
LEFT JOIN live same
  ON same.grade = reg.grade
 AND same.subject_code = reg.subject_code
 AND same.chapter_number = reg.chapter_number
LEFT JOIN live alt
  ON alt.grade = reg.grade
 AND alt.subject_code = reg.subject_code
 AND alt.chapter_number <> reg.chapter_number
 AND lower(btrim(alt.corpus_title)) = lower(btrim(reg.chapter_title))
WHERE same.chapter_number IS NULL
ORDER BY reg.grade::int, reg.subject_code, reg.chapter_number;
```

**A non-zero result means:** the registry lists a chapter the corpus does not hold at that coordinate. Read `corpus_ch`:
- non-NULL → state `COORDINATE_DRIFT`. NCERT-2025 renumbering; the content exists at a different `chapter_number` and every surface joins on `(grade, subject_code, chapter_number)` with exact equality. Free to fix via an architect-authored renumbering migration, cf. `20260814000013_cbse_syllabus_corpus_reconciliation_math_science.sql`.
- NULL → `ABSENT_CANDIDATE`, **not** a final `ABSENT`. The label is deliberately provisional: this column alone must never be pasted into the report's §3 `state` column. Promotion to `ABSENT` — the one state that spends credits and needs CEO approval — happens only after the Q8 cross-read below.

**Cross-read Q8 before promoting any `ABSENT_CANDIDATE` to `ABSENT`.** The `live` CTE filters `is_active = true`, so a chapter whose chunks are *all* NULL-`is_active` is invisible to it and surfaces here as a candidate. If Q8 reports `is_active_null > 0` at that coordinate, the true state is `INACTIVE` — a **free** activation/attribution backfill — not `ABSENT`: the text exists and was already paid for. Only a chapter that is a candidate in Q6 **and** has no NULL-`is_active` rows in Q8 may be classified `ABSENT`. `is_active_false > 0` is **not** a blocker on that gate — see Q8's notes.

**The `cs.board = 'CBSE'` predicate in `registry` is load-bearing.** `cbse_syllabus` is UNIQUE on `(board, grade, subject_code, chapter_number)` and `20260814000008:190` explicitly reasons about ICSE/State-board rows, so multi-board is a supported state. Without the predicate one coordinate emits one row per board, and every non-CBSE duplicate arrives with a NULL `corpus_ch` — a spurious `ABSENT_CANDIDATE` that, if promoted, becomes the one state that spends credits and needs CEO approval. The corpus side is left board-blind deliberately: `rag_content_chunks` carries `CONSTRAINT rag_chunks_source_ncert_only CHECK (source = 'ncert_2025')` — though note it also has its own `board` column (NOT NULL DEFAULT `'CBSE'`, `00000000000000_baseline_from_prod.sql:10133`) and nothing forbids a `board='ICSE'` row with `source='ncert_2025'`. The residual failure mode is bounded and one-directional: a stray non-CBSE chunk could satisfy the join and mask a real gap here, or read as an orphan in Q7 — it errs toward over-reporting `REGISTRY_MISSING` (a free fix), never toward manufacturing spend.

**Never write a renumbering migration off this title match alone.** `chapter_title` metadata is frequently garbled; confirm the candidate against `chunk_text`, which is authoritative.

---

## Q7 — Registry incompleteness

```sql
WITH scope(grade, subject_code) AS (
  SELECT g.grade, s.code
    FROM (VALUES ('6'),('7'),('8'),('9'),('10')) g(grade)
   CROSS JOIN (VALUES ('math'),('science')) s(code)
  UNION ALL
  SELECT g.grade, s.code
    FROM (VALUES ('11'),('12')) g(grade)
   CROSS JOIN (VALUES ('math'),('physics'),('chemistry'),('biology')) s(code)
)
SELECT
  r.grade_short                    AS grade,
  r.subject_code,
  r.chapter_number,
  count(*)                         AS orphan_chunks,
  min(r.chapter_title)             AS corpus_title
FROM public.rag_content_chunks r
JOIN scope sc
  ON sc.grade = r.grade_short
 AND sc.subject_code = r.subject_code
WHERE r.is_active = true
  AND r.chapter_number BETWEEN 1 AND 30
  AND NOT EXISTS (
    SELECT 1
      FROM public.cbse_syllabus cs
     WHERE cs.grade = r.grade_short
       AND cs.subject_code = r.subject_code
       AND cs.chapter_number = r.chapter_number
       AND cs.board = 'CBSE'
  )
GROUP BY r.grade_short, r.subject_code, r.chapter_number
HAVING count(*) >= 1
ORDER BY orphan_chunks DESC, r.grade_short::int, r.subject_code, r.chapter_number;
```

**A non-zero result means:** state `REGISTRY_MISSING`. The corpus holds indexed, embedded, active content at a coordinate `cbse_syllabus` does not list — content already paid for and served to nobody, because the chapter picker, coverage endpoint, `ingestion_gaps` and chapter-scoped retrieval all read the registry. Free to fix: architect adds the registry rows. Rows at or above `min_cell_chunks = 50` are the highest-value ones; rows well below `min_cell_chapters = 3` per cell should be treated as noise until confirmed against `chunk_text`.

**The `cs.board = 'CBSE'` predicate inside `NOT EXISTS` is load-bearing.** The subquery is a suppressor: any matching registry row hides the coordinate. `cbse_syllabus` is UNIQUE on `(board, grade, subject_code, chapter_number)` and holds non-CBSE boards, so without the predicate an ICSE or State-board row at that coordinate silently suppresses a genuine `REGISTRY_MISSING` — the CBSE registry gap goes unreported while the corpus stays unserved. The corpus side is left board-blind deliberately: `rag_content_chunks` carries `CONSTRAINT rag_chunks_source_ncert_only CHECK (source = 'ncert_2025')` — though note it also has its own `board` column (NOT NULL DEFAULT `'CBSE'`, `00000000000000_baseline_from_prod.sql:10133`) and nothing forbids a `board='ICSE'` row with `source='ncert_2025'`. The residual failure mode errs toward over-reporting `REGISTRY_MISSING` — a free architect-side registry fix, confirmable against `chunk_text` — and never toward manufacturing an `ABSENT` that spends credits, which is why no board predicate is applied to `r`.

---

## Q8 — NULL `is_active` chunks (the rows every other query cannot see)

The only query in this file with **no** `is_active` predicate. Q4's `is_active_null_seen` and Q5 both filter `is_active = true`, so both are structurally blind to these rows; this is the single query that can fill the report's `is_active NULL rows excluded` slot with a measured number.

Grouped per **chapter**, not per cell. The `ABSENT` gate operates at `(grade, subject_code, chapter_number)`, and at cell granularity `is_active_true = 0` would essentially never hold — one healthy chapter anywhere in the cell hides a fully dark one. Roll the rows up yourself when the report needs a cell-level total.

```sql
SELECT
  c.grade_short                                AS grade,
  c.subject_code,
  c.chapter_number,
  count(*) FILTER (WHERE c.is_active IS NULL)  AS is_active_null,
  count(*) FILTER (WHERE c.is_active = false)  AS is_active_false,
  count(*) FILTER (WHERE c.is_active = true)   AS is_active_true
FROM public.rag_content_chunks c
WHERE c.subject_code IN ('math','science','physics','chemistry','biology')
  AND c.grade_short IN ('6','7','8','9','10','11','12')
GROUP BY 1, 2, 3
ORDER BY c.grade_short::int, c.subject_code, c.chapter_number NULLS LAST;
```

**A non-zero result means, per column:**
- `is_active_null > 0` → those chunks are silently excluded from every other query in this file **and** from `recompute_syllabus_status()`. The text exists and was paid for, but it is invisible to retrieval and invisible to the readiness maths that drives `rag_status`. Report the count verbatim; never write `0` into the report slot from Q4, which cannot observe these rows. Because `recompute_syllabus_status()` ran while these rows were dark, the registry's own `rag_status` for the chapter is wrong too — the remedy is an activation write **plus** a re-run of that function.
- `is_active_false > 0` → chunks somebody deliberately retired. `rag_content_chunks` carries `version` and `previous_chunk_id` (`00000000000000_baseline_from_prod.sql:10151-10152`), so this is most often the routine retired-prior-version marker from a re-ingest, not a defect. **Never blind-reactivate**: superseded or quality-rejected text (bad OCR, garbled chapter) flowing back into student-facing retrieval is a P6/P12 risk. Cross-read Q6's `corpus_ch` and Q7 first — if a re-ingest superseded these rows, the fix is registry/coordinate work. Whether the text should be student-visible again is an **assessment** call.
- `is_active_true` is the population every other query in this file operates on — use it to size how large the blind spot is relative to the measured corpus.
- `is_active_true = 0` at a coordinate → state `INACTIVE` (SKILL.md Phase 2, state 3). This is what blocks a Q6 `ABSENT_CANDIDATE` from being promoted.

**`is_active_false` is NOT part of the `ABSENT` gate.** The gate is `ABSENT_CANDIDATE` in Q6 **and** `is_active_null = 0` here — nothing more. Were it widened to "and no `false` rows either", routine retired-version rows would make `ABSENT` practically unreachable and a genuine content gap would never get funded. A healthy `is_active_true` sitting beside `is_active_false > 0` is the normal shape of a re-ingested chapter and says nothing.

A **cell-level** reading of this query defers an `ABSENT`, it does not cancel one — re-read at chapter granularity before either funding or dismissing. One stray NULL row anywhere in a cell over-blocks the whole cell if you roll up; that is acceptable, because it errs away from spend and is self-correcting: once the free backfill runs, the next audit sees `is_active_null = 0` and classifies `ABSENT` legitimately.

**Residual blind spot this query does not cover.** A chunk with NULL `is_active` **and** a NULL `subject_code` or `grade_short` is invisible to Q5 (its `is_active = true` filter, ~:210) **and** invisible to Q8 (the `subject_code IN (...)` / `grade_short IN (...)` predicates above drop NULLs), so it can still manufacture a spurious `ABSENT`. Q8's addition narrows the hole; it does not close it. The residual errs in the credit-spend direction — content that exists can still be classified as needing paid re-ingestion — so treat any cell where Q5 reports unattributed rows as an extra reason to hold funding.

Rows with a NULL `chapter_number` group on their own and sort last; they are a coordinate defect in their own right, not an `INACTIVE` finding.

Deliberately grade/subject-scoped rather than joined to `scope`: the keep-set cross-join would add no filtering here, and an inline `IN` list keeps this query runnable standalone when a chunk's coordinates are otherwise suspect.
