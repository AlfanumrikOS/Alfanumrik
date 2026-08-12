-- ═══════════════════════════════════════════════════════════════════════════
-- DRY RUN / PRE-FLIGHT INSPECTION
-- for migration 20260814000013_cbse_syllabus_corpus_reconciliation_math_science
-- ═══════════════════════════════════════════════════════════════════════════
--
-- READ ONLY. Every query below is a SELECT. Nothing here writes, creates,
-- alters, or deletes anything. Safe to run against production.
--
-- WHY THIS FILE EXISTS
--   The migration is self-reconciling: it derives the corrected chapter
--   coordinates by reading rag_content_chunks at migration time, because
--   nobody authoring it has live database access and a hand-written chapter
--   list would be invented numbers. That means NOBODY KNOWS EXACTLY WHAT IT
--   WILL DO until it runs against real data. These queries answer that
--   question BEFORE you apply anything, using the identical predicates and the
--   identical guard constants.
--
-- HOW TO USE
--   Run §A first and read the STOP CONDITION. If §A fails, do not proceed —
--   the migration will safely no-op, but you want to know that before a deploy
--   window rather than after. Then run §B..§H in order. §H is the one-page
--   summary; if you only run one query, run §H.
--
--   THEN RUN §E2. It is the blast-radius number: how many chapters that a
--   student can pick TODAY sit at a coordinate the corpus cannot confirm, and
--   are therefore in the path of Section 7's recompute. §E2 splits them into
--   the ones Section 7b protects (they have questions) and the ones that
--   genuinely go dark (no NCERT text, no questions — an empty quiz). §E3 lists
--   them row by row. Added 2026-08-14: the earlier revision of this file could
--   not surface that exposure at all, because §E asserted — wrongly — that
--   G3b-spared rows keep their rag_status. See the §E preamble.
--
-- GUARD CONSTANTS — these are duplicated from the migration ON PURPOSE so this
-- file is standalone and copy-pasteable into the Supabase SQL editor. They MUST
-- match Section 3b of the migration:
--     min_cell_chapters  = 3
--     min_cell_chunks    = 50
--     max_chapter_number = 30
--   If you change one, change both files.
--
-- Scope everywhere below is the CEO keep-set and nothing else:
--     grades 6-10  → math, science
--     grades 11-12 → math, physics, chemistry, biology   (no `science` at 11-12)


-- ═══════════════════════════════════════════════════════════════════════════
-- §A  THE STOP CONDITION — is the corpus metadata even usable?
-- ═══════════════════════════════════════════════════════════════════════════
-- This is the single most important query in the file.
--
-- scripts/ncert-ingestion/CLAUDE.md:15 records that the existing corpus was
-- built by "a legacy tool no longer present in the codebase". The migration
-- joins on rag_content_chunks.grade_short and .subject_code (the columns
-- match_rag_chunks_ncert and recompute_syllabus_status read). If those columns
-- are largely NULL, the corpus cannot be used as an authority at all.
--
-- STOP CONDITION:
--   If pct_usable is low (say < 80%), the migration's G1 guard will refuse
--   most cells and it will be a near-total no-op. That is the DESIGNED SAFE
--   behaviour — it will not damage anything — but the real fix in that case is
--   to backfill grade_short/subject_code first, which is a different task.
--   Investigate before scheduling a deploy.

SELECT
  count(*)                                                        AS total_active_chunks,
  count(*) FILTER (WHERE grade_short  IS NULL)                    AS null_grade_short,
  count(*) FILTER (WHERE subject_code IS NULL)                    AS null_subject_code,
  count(*) FILTER (WHERE chapter_number IS NULL)                  AS null_chapter_number,
  count(*) FILTER (
    WHERE grade_short IS NOT NULL
      AND subject_code IS NOT NULL
      AND chapter_number IS NOT NULL)                             AS fully_usable,
  round(100.0 * count(*) FILTER (
    WHERE grade_short IS NOT NULL
      AND subject_code IS NOT NULL
      AND chapter_number IS NOT NULL) / NULLIF(count(*), 0), 1)   AS pct_usable
FROM public.rag_content_chunks
WHERE is_active = true;


-- ═══════════════════════════════════════════════════════════════════════════
-- §B  THE TRUST DECISION — which cells will the migration act on, and which
--     will it refuse (G1 fail-closed)?
-- ═══════════════════════════════════════════════════════════════════════════
-- verdict = 'TRUSTED - will reconcile'  → the cell clears both floors
-- verdict = 'SKIPPED - left untouched'  → G1 refuses; NO insert, NO scope flip,
--                                          NO title change, NO recompute.
--
-- Expect all 18 keep-set cells (5 grades x 2 + 2 grades x 4) to be TRUSTED.
-- Any SKIPPED row is a cell where we cannot see content — investigate it
-- rather than assuming it has none.

WITH scope(grade, subject_code) AS (
  SELECT g.grade, s.code FROM (VALUES ('6'),('7'),('8'),('9'),('10')) g(grade)
   CROSS JOIN (VALUES ('math'),('science')) s(code)
  UNION ALL
  SELECT g.grade, s.code FROM (VALUES ('11'),('12')) g(grade)
   CROSS JOIN (VALUES ('math'),('physics'),('chemistry'),('biology')) s(code)
),
corpus AS (
  SELECT r.grade_short AS grade, r.subject_code, r.chapter_number,
         count(*)::int AS corpus_chunk_count
    FROM public.rag_content_chunks r
    JOIN scope sc ON sc.grade = r.grade_short AND sc.subject_code = r.subject_code
   WHERE r.is_active = true
     AND r.grade_short IS NOT NULL AND r.subject_code IS NOT NULL
     AND r.chapter_number IS NOT NULL
     AND r.chapter_number BETWEEN 1 AND 30
   GROUP BY 1, 2, 3
)
SELECT
  sc.grade,
  sc.subject_code,
  COALESCE(count(c.chapter_number), 0)          AS corpus_chapters,
  COALESCE(sum(c.corpus_chunk_count), 0)        AS corpus_chunks,
  COALESCE(min(c.chapter_number), 0)            AS lowest_chapter,
  COALESCE(max(c.chapter_number), 0)            AS highest_chapter,
  (SELECT count(*) FROM public.cbse_syllabus cs
    WHERE cs.board = 'CBSE' AND cs.grade = sc.grade
      AND cs.subject_code = sc.subject_code)    AS registry_rows_today,
  CASE
    WHEN count(c.chapter_number) >= 3 AND COALESCE(sum(c.corpus_chunk_count),0) >= 50
      THEN 'TRUSTED - will reconcile'
    ELSE 'SKIPPED - left untouched (G1 fail-closed)'
  END                                           AS verdict
FROM scope sc
LEFT JOIN corpus c
  ON c.grade = sc.grade AND c.subject_code = sc.subject_code
GROUP BY sc.grade, sc.subject_code
ORDER BY sc.grade::int, sc.subject_code;


-- ═══════════════════════════════════════════════════════════════════════════
-- §C  CHAPTERS THAT WILL GAIN A REGISTRY ROW
--     (indexed content that is currently unreachable by every surface)
-- ═══════════════════════════════════════════════════════════════════════════
-- These are corpus coordinates with real chunks and NO cbse_syllabus row.
-- Today they are invisible to the chapter picker, coverage, ingestion_gaps and
-- chapter-scoped retrieval. This is content already paid for and not served.
--
-- The migration creates one registry row per line below.

WITH scope(grade, subject_code) AS (
  SELECT g.grade, s.code FROM (VALUES ('6'),('7'),('8'),('9'),('10')) g(grade)
   CROSS JOIN (VALUES ('math'),('science')) s(code)
  UNION ALL
  SELECT g.grade, s.code FROM (VALUES ('11'),('12')) g(grade)
   CROSS JOIN (VALUES ('math'),('physics'),('chemistry'),('biology')) s(code)
),
corpus AS (
  SELECT r.grade_short AS grade, r.subject_code, r.chapter_number,
         count(*)::int AS corpus_chunk_count
    FROM public.rag_content_chunks r
    JOIN scope sc ON sc.grade = r.grade_short AND sc.subject_code = r.subject_code
   WHERE r.is_active = true
     AND r.grade_short IS NOT NULL AND r.subject_code IS NOT NULL
     AND r.chapter_number IS NOT NULL
     AND r.chapter_number BETWEEN 1 AND 30
   GROUP BY 1, 2, 3
),
trusted AS (
  SELECT grade, subject_code FROM corpus
   GROUP BY grade, subject_code
  HAVING count(*) >= 3 AND sum(corpus_chunk_count) >= 50
)
SELECT
  c.grade,
  c.subject_code,
  c.chapter_number,
  c.corpus_chunk_count,
  CASE WHEN c.corpus_chunk_count >= 50 THEN 'sufficient'
       WHEN c.corpus_chunk_count > 0   THEN 'thin'
       ELSE 'missing' END AS text_coverage_status_it_will_get,
  'INSERT' AS action
FROM corpus c
JOIN trusted t ON t.grade = c.grade AND t.subject_code = c.subject_code
WHERE NOT EXISTS (
  SELECT 1 FROM public.cbse_syllabus cs
   WHERE cs.board = 'CBSE' AND cs.grade = c.grade
     AND cs.subject_code = c.subject_code
     AND cs.chapter_number = c.chapter_number
)
ORDER BY c.grade::int, c.subject_code, c.chapter_number;


-- ═══════════════════════════════════════════════════════════════════════════
-- §D  CHAPTERS THAT WILL BE RETIRED (is_in_scope = FALSE) — AND THOSE SPARED
-- ═══════════════════════════════════════════════════════════════════════════
-- NOTHING IS DELETED. These rows are flipped is_in_scope = FALSE, which is
-- reversible and recorded row-by-row in the ledger.
--
-- planned_action = 'RETIRE (is_in_scope=FALSE)'
--     the corpus has no chunks at this coordinate and no live questions
--     reference it — a stale-numbering row or a CBSE-rationalised chapter
--     (e.g. G10 science "Periodic Classification of Elements").
--
-- planned_action = 'SPARED (G3b - has live questions)'
--     the corpus does not confirm it, BUT question_bank still has live
--     questions keyed to this old chapter number. Left in scope deliberately;
--     retiring it would hide content students are actively served. These are
--     exactly the rows the F1 follow-up (question_bank remap) must handle.
--     NOTE: "spared" means is_in_scope is preserved. That is only HALF of what
--     keeps a chapter in the picker — the other half is rag_status, which
--     Section 7's recompute would set to 'missing' for every row on this list
--     (they have no chunks at their coordinate, by definition). Section 7b.1
--     of the migration restores it. If the migration you are about to apply
--     has no Section 7b, every SPARED row below will disappear from the /quiz
--     picker anyway. See §E2.
--
-- A row can also be spared by G3c (its coordinate's chunks all carry
-- is_active IS NULL, so the is_active=true filter makes it look corpus-absent).
-- This query does not model G3c; the migration records those separately with
-- ledger action 'retain_ambiguous_chunks'. Expect the RETIRE list below to be
-- an upper bound on what is actually retired.
--
-- REVIEW THIS LIST. A chapter you know is genuinely in the CBSE syllabus
-- showing up as RETIRE means the corpus is missing that chapter — a content
-- gap to ingest, not a numbering error.

WITH scope(grade, subject_code) AS (
  SELECT g.grade, s.code FROM (VALUES ('6'),('7'),('8'),('9'),('10')) g(grade)
   CROSS JOIN (VALUES ('math'),('science')) s(code)
  UNION ALL
  SELECT g.grade, s.code FROM (VALUES ('11'),('12')) g(grade)
   CROSS JOIN (VALUES ('math'),('physics'),('chemistry'),('biology')) s(code)
),
corpus AS (
  SELECT r.grade_short AS grade, r.subject_code, r.chapter_number,
         count(*)::int AS corpus_chunk_count
    FROM public.rag_content_chunks r
    JOIN scope sc ON sc.grade = r.grade_short AND sc.subject_code = r.subject_code
   WHERE r.is_active = true
     AND r.grade_short IS NOT NULL AND r.subject_code IS NOT NULL
     AND r.chapter_number IS NOT NULL
     AND r.chapter_number BETWEEN 1 AND 30
   GROUP BY 1, 2, 3
),
trusted AS (
  SELECT grade, subject_code FROM corpus
   GROUP BY grade, subject_code
  HAVING count(*) >= 3 AND sum(corpus_chunk_count) >= 50
)
SELECT
  cs.grade,
  cs.subject_code,
  cs.chapter_number,
  cs.chapter_title,
  cs.rag_status,
  cs.chunk_count AS registry_chunk_count_today,
  (SELECT count(*) FROM public.question_bank qb
    WHERE qb.grade = cs.grade AND qb.subject = cs.subject_code
      AND qb.chapter_number = cs.chapter_number
      AND qb.is_active AND qb.deleted_at IS NULL) AS live_questions,
  CASE WHEN (SELECT count(*) FROM public.question_bank qb
              WHERE qb.grade = cs.grade AND qb.subject = cs.subject_code
                AND qb.chapter_number = cs.chapter_number
                AND qb.is_active AND qb.deleted_at IS NULL) > 0
       THEN 'SPARED (G3b - has live questions)'
       ELSE 'RETIRE (is_in_scope=FALSE)'
  END AS planned_action
FROM public.cbse_syllabus cs
JOIN trusted t ON t.grade = cs.grade AND t.subject_code = cs.subject_code
WHERE cs.board = 'CBSE'
  AND cs.is_in_scope = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM corpus c
     WHERE c.grade = cs.grade AND c.subject_code = cs.subject_code
       AND c.chapter_number = cs.chapter_number
  )
ORDER BY planned_action, cs.grade::int, cs.subject_code, cs.chapter_number;


-- ═══════════════════════════════════════════════════════════════════════════
-- §E  THE ITEM #11 PAYOFF — what the /quiz chapter picker shows, before/after
-- ═══════════════════════════════════════════════════════════════════════════
-- CORRECTED 2026-08-14 after the quality review. The previous version of this
-- query asserted, in a comment, that "Spared rows (G3b) keep whatever status
-- they have, so they are added only when already partial/ready." THAT WAS
-- FALSE and it mattered: Section 7 of the migration recomputes rag_status for
-- EVERY trusted-cell row, and a G3b-spared row has zero chunks at its
-- coordinate by definition, so the recompute pushed it to 'missing' and out of
-- the picker. The old query therefore counted those rows as still visible and
-- over-stated chapters_visible_after by exactly the set the migration was
-- silently about to hide — running the dry-run could not have surfaced the
-- defect. The migration now carries Section 7b (preserve + re-promote) and
-- this query models the real post-state, branch for branch.
--
-- available_chapters_for_student_subject_v2 filters
--   rag_status IN ('partial','ready') AND is_in_scope AND board='CBSE'
-- (20260605000000:208-209, unchanged by 20260814000014). BOTH conjuncts.
--
-- chapters_visible_today  = what a student can pick right now
-- chapters_visible_after  = what they will be able to pick after the migration
--
-- The three components of "after", matching the migration exactly:
--   (1) every corpus-confirmed coordinate in a trusted cell. It has chunks > 0,
--       so Section 7's recompute lands it on 'partial' at worst, and Section 4
--       has created a row if none existed. IN SCOPE unless it was already
--       out of scope before the run (this migration never un-retires) — so
--       out-of-scope pre-existing rows are subtracted in (1b).
--   (2) unconfirmed rows with LIVE questions: kept in scope by G3b and handed
--       their pre-run rag_status back by Section 7b.1 — so they count only
--       when they are reachable TODAY.
--   (3) unconfirmed rows with zero live questions but >0 VERIFIED questions is
--       an empty set (verified is a subset of live), so the only extra rows
--       Section 7b.2 promotes are ones that are currently at 'missing' WITH
--       verified questions. Those are NEW visibility — the item #11 payoff.
-- Everything else (unconfirmed, no chunks, no questions) becomes unreachable:
-- that is the deliberate, and only, loss. §E2 quantifies it.

WITH scope(grade, subject_code) AS (
  SELECT g.grade, s.code FROM (VALUES ('6'),('7'),('8'),('9'),('10')) g(grade)
   CROSS JOIN (VALUES ('math'),('science')) s(code)
  UNION ALL
  SELECT g.grade, s.code FROM (VALUES ('11'),('12')) g(grade)
   CROSS JOIN (VALUES ('math'),('physics'),('chemistry'),('biology')) s(code)
),
corpus AS (
  SELECT r.grade_short AS grade, r.subject_code, r.chapter_number,
         count(*)::int AS corpus_chunk_count
    FROM public.rag_content_chunks r
    JOIN scope sc ON sc.grade = r.grade_short AND sc.subject_code = r.subject_code
   WHERE r.is_active = true
     AND r.grade_short IS NOT NULL AND r.subject_code IS NOT NULL
     AND r.chapter_number IS NOT NULL
     AND r.chapter_number BETWEEN 1 AND 30
   GROUP BY 1, 2, 3
),
trusted AS (
  SELECT grade, subject_code FROM corpus
   GROUP BY grade, subject_code
  HAVING count(*) >= 3 AND sum(corpus_chunk_count) >= 50
),
-- Per-registry-row facts, evaluated exactly as the migration evaluates them.
reg AS (
  SELECT cs.grade,
         cs.subject_code,
         cs.chapter_number,
         cs.is_in_scope,
         cs.rag_status,
         EXISTS (SELECT 1 FROM corpus c
                  WHERE c.grade=cs.grade AND c.subject_code=cs.subject_code
                    AND c.chapter_number=cs.chapter_number)      AS corpus_confirmed,
         (SELECT count(*) FROM public.question_bank qb
           WHERE qb.grade=cs.grade AND qb.subject=cs.subject_code
             AND qb.chapter_number=cs.chapter_number
             AND qb.is_active AND qb.deleted_at IS NULL)         AS live_q,
         (SELECT count(*) FROM public.question_bank qb
           WHERE qb.grade=cs.grade AND qb.subject=cs.subject_code
             AND qb.chapter_number=cs.chapter_number
             AND qb.is_active AND qb.deleted_at IS NULL
             AND qb.verification_state='verified')               AS verified_q
    FROM public.cbse_syllabus cs
    JOIN trusted t ON t.grade=cs.grade AND t.subject_code=cs.subject_code
   WHERE cs.board='CBSE'
)
SELECT
  sc.grade,
  sc.subject_code,
  -- TODAY: in-scope rows already at partial/ready
  (SELECT count(*) FROM public.cbse_syllabus cs
    WHERE cs.board='CBSE' AND cs.grade=sc.grade AND cs.subject_code=sc.subject_code
      AND cs.is_in_scope AND cs.rag_status IN ('partial','ready'))
                                                    AS chapters_visible_today,
  -- (1) corpus-confirmed coordinates in a trusted cell -> recompute makes them
  --     'partial' at worst; Section 4 creates the row if missing.
  (SELECT count(*) FROM corpus c
    WHERE c.grade=sc.grade AND c.subject_code=sc.subject_code
      AND EXISTS (SELECT 1 FROM trusted t
                   WHERE t.grade=sc.grade AND t.subject_code=sc.subject_code))
  -- (1b) minus corpus-confirmed coordinates whose EXISTING row is already
  --      out of scope: the migration never un-retires, so they stay hidden.
  - (SELECT count(*) FROM reg r
      WHERE r.grade=sc.grade AND r.subject_code=sc.subject_code
        AND r.corpus_confirmed AND NOT r.is_in_scope)
  -- (2) G3b-spared rows (unconfirmed, live questions): kept in scope, and
  --     Section 7b.1 restores their pre-run status -> visible iff visible today.
  + (SELECT count(*) FROM reg r
      WHERE r.grade=sc.grade AND r.subject_code=sc.subject_code
        AND NOT r.corpus_confirmed AND r.live_q > 0
        AND r.is_in_scope AND r.rag_status IN ('partial','ready'))
  -- (3) Section 7b.2 promotions: unconfirmed, in scope, NOT visible today,
  --     but carrying verified questions -> 'missing' becomes 'partial'.
  + (SELECT count(*) FROM reg r
      WHERE r.grade=sc.grade AND r.subject_code=sc.subject_code
        AND NOT r.corpus_confirmed AND r.verified_q > 0
        AND r.is_in_scope AND r.rag_status NOT IN ('partial','ready'))
                                                    AS chapters_visible_after
FROM scope sc
ORDER BY sc.grade::int, sc.subject_code;


-- ═══════════════════════════════════════════════════════════════════════════
-- §E2  BLAST RADIUS — the exposure Section 7's recompute creates
-- ═══════════════════════════════════════════════════════════════════════════
-- THIS IS THE NUMBER TO READ BEFORE APPROVING THE DEPLOY.
--
-- exposed_rows counts, inside trusted cells, the rows that are REACHABLE today
-- (is_in_scope AND rag_status IN ('partial','ready')) while the CORPUS holds
-- zero active chunks at their coordinate. Every one of them is a row Section
-- 7's recompute will drive to 'missing'. They exist because 20260621000700
-- promoted them on 2026-06-21 and the 2026-06-24 manifest's ON CONFLICT DO
-- NOTHING could not undo it.
--
-- NOTE ON WHY THE PREDICATE IS "NOT corpus_confirmed" AND NOT "chunk_count=0".
-- cbse_syllabus.chunk_count is a DENORMALIZED cache, and
-- cbse_syllabus_rag_diagnostic exists precisely because it goes STALE. What
-- Section 7 acts on is the live count from rag_content_chunks, so the exposure
-- must be measured there too. registry_chunk_count is still displayed in §E3,
-- where a non-zero value next to a corpus-absent coordinate IS the staleness.
--
-- Of those:
--   protected_by_7b_preserve = has live questions -> Section 7b.1 hands its
--                              status back. Stays reachable. No student loses
--                              anything.
--   would_be_lost_no_questions = zero live questions AND zero chunks -> becomes
--                              unreachable. This is the intended, and the ONLY,
--                              loss: a chapter with no NCERT text and no
--                              questions, i.e. one that hands the student an
--                              empty quiz.
-- gained_by_7b_promote counts rows going the other way: currently hidden at
-- 'missing' but carrying verified questions, which Section 7b.2 makes
-- reachable.
--
-- If protected_by_7b_preserve is > 0 and the migration you are about to run
-- does NOT contain a Section 7b, STOP: that is precisely the defect this
-- number exists to expose.

WITH scope(grade, subject_code) AS (
  SELECT g.grade, s.code FROM (VALUES ('6'),('7'),('8'),('9'),('10')) g(grade)
   CROSS JOIN (VALUES ('math'),('science')) s(code)
  UNION ALL
  SELECT g.grade, s.code FROM (VALUES ('11'),('12')) g(grade)
   CROSS JOIN (VALUES ('math'),('physics'),('chemistry'),('biology')) s(code)
),
corpus AS (
  SELECT r.grade_short AS grade, r.subject_code, r.chapter_number,
         count(*)::int AS corpus_chunk_count
    FROM public.rag_content_chunks r
    JOIN scope sc ON sc.grade = r.grade_short AND sc.subject_code = r.subject_code
   WHERE r.is_active = true
     AND r.grade_short IS NOT NULL AND r.subject_code IS NOT NULL
     AND r.chapter_number IS NOT NULL
     AND r.chapter_number BETWEEN 1 AND 30
   GROUP BY 1, 2, 3
),
trusted AS (
  SELECT grade, subject_code FROM corpus
   GROUP BY grade, subject_code
  HAVING count(*) >= 3 AND sum(corpus_chunk_count) >= 50
),
reg AS (
  SELECT cs.grade, cs.subject_code, cs.chapter_number, cs.chapter_title,
         cs.rag_status, cs.chunk_count, cs.is_in_scope,
         EXISTS (SELECT 1 FROM corpus c
                  WHERE c.grade=cs.grade AND c.subject_code=cs.subject_code
                    AND c.chapter_number=cs.chapter_number)  AS corpus_confirmed,
         (SELECT count(*) FROM public.question_bank qb
           WHERE qb.grade=cs.grade AND qb.subject=cs.subject_code
             AND qb.chapter_number=cs.chapter_number
             AND qb.is_active AND qb.deleted_at IS NULL)   AS live_q,
         (SELECT count(*) FROM public.question_bank qb
           WHERE qb.grade=cs.grade AND qb.subject=cs.subject_code
             AND qb.chapter_number=cs.chapter_number
             AND qb.is_active AND qb.deleted_at IS NULL
             AND qb.verification_state='verified')         AS verified_q
    FROM public.cbse_syllabus cs
    JOIN trusted t ON t.grade=cs.grade AND t.subject_code=cs.subject_code
   WHERE cs.board='CBSE'
)
SELECT
  grade,
  subject_code,
  count(*) FILTER (WHERE is_in_scope
                     AND rag_status IN ('partial','ready')
                     AND NOT corpus_confirmed)                AS exposed_rows,
  count(*) FILTER (WHERE is_in_scope
                     AND rag_status IN ('partial','ready')
                     AND NOT corpus_confirmed
                     AND live_q > 0)                          AS protected_by_7b_preserve,
  count(*) FILTER (WHERE is_in_scope
                     AND rag_status IN ('partial','ready')
                     AND NOT corpus_confirmed
                     AND live_q = 0)                          AS would_be_lost_no_questions,
  count(*) FILTER (WHERE is_in_scope
                     AND rag_status NOT IN ('partial','ready')
                     AND NOT corpus_confirmed
                     AND verified_q > 0)                      AS gained_by_7b_promote,
  -- Denormalization drift, shown for context: rows claiming chunks the corpus
  -- does not have at that coordinate (cbse_syllabus_rag_diagnostic territory).
  count(*) FILTER (WHERE NOT corpus_confirmed
                     AND chunk_count > 0)                     AS stale_chunk_count_rows
FROM reg
GROUP BY grade, subject_code
ORDER BY grade::int, subject_code;


-- ═══════════════════════════════════════════════════════════════════════════
-- §E3  BLAST RADIUS, ROW BY ROW — read this if §E2 shows anything non-zero
-- ═══════════════════════════════════════════════════════════════════════════
-- Same population as §E2, one line per chapter, so a human can sanity-check
-- the titles. verdict tells you what the migration will do to each row.

WITH scope(grade, subject_code) AS (
  SELECT g.grade, s.code FROM (VALUES ('6'),('7'),('8'),('9'),('10')) g(grade)
   CROSS JOIN (VALUES ('math'),('science')) s(code)
  UNION ALL
  SELECT g.grade, s.code FROM (VALUES ('11'),('12')) g(grade)
   CROSS JOIN (VALUES ('math'),('physics'),('chemistry'),('biology')) s(code)
),
corpus AS (
  SELECT r.grade_short AS grade, r.subject_code, r.chapter_number,
         count(*)::int AS corpus_chunk_count
    FROM public.rag_content_chunks r
    JOIN scope sc ON sc.grade = r.grade_short AND sc.subject_code = r.subject_code
   WHERE r.is_active = true
     AND r.grade_short IS NOT NULL AND r.subject_code IS NOT NULL
     AND r.chapter_number IS NOT NULL
     AND r.chapter_number BETWEEN 1 AND 30
   GROUP BY 1, 2, 3
),
trusted AS (
  SELECT grade, subject_code FROM corpus
   GROUP BY grade, subject_code
  HAVING count(*) >= 3 AND sum(corpus_chunk_count) >= 50
)
SELECT
  cs.grade, cs.subject_code, cs.chapter_number, cs.chapter_title,
  cs.rag_status,
  cs.chunk_count                                            AS registry_chunk_count,
  0                                                         AS corpus_chunk_count,
  (SELECT count(*) FROM public.question_bank qb
    WHERE qb.grade=cs.grade AND qb.subject=cs.subject_code
      AND qb.chapter_number=cs.chapter_number
      AND qb.is_active AND qb.deleted_at IS NULL)          AS live_q,
  CASE WHEN (SELECT count(*) FROM public.question_bank qb
              WHERE qb.grade=cs.grade AND qb.subject=cs.subject_code
                AND qb.chapter_number=cs.chapter_number
                AND qb.is_active AND qb.deleted_at IS NULL) > 0
       THEN 'PRESERVED by 7b.1 - stays pickable'
       ELSE 'LOST - no NCERT text and no questions (empty quiz)'
  END                                                       AS verdict
FROM public.cbse_syllabus cs
JOIN trusted t ON t.grade=cs.grade AND t.subject_code=cs.subject_code
WHERE cs.board='CBSE'
  AND cs.is_in_scope
  AND cs.rag_status IN ('partial','ready')
  -- corpus-absent at this coordinate: what Section 7 actually reacts to.
  -- registry_chunk_count > 0 on any line here is denormalization drift.
  AND NOT EXISTS (
    SELECT 1 FROM corpus c
     WHERE c.grade=cs.grade AND c.subject_code=cs.subject_code
       AND c.chapter_number=cs.chapter_number)
ORDER BY cs.grade::int, cs.subject_code, cs.chapter_number;


-- ═══════════════════════════════════════════════════════════════════════════
-- §F  TITLE PROVENANCE — which new rows get a real name, which need a human
-- ═══════════════════════════════════════════════════════════════════════════
-- The migration will NOT take a title from the public.chapters catalog for a
-- new coordinate, because that catalog was backfilled from question_bank
-- (_legacy/timestamped/20260415000014) and therefore carries the SAME legacy
-- numbering being corrected — it would supply the OLD chapter's name.
--
-- title_source = 'corpus title (clean)'   → gets a real name automatically
-- title_source = 'PLACEHOLDER - needs F2' → will read
--                 "Chapter N (title unverified)" until a human names it
--
-- The synthetic-title predicate below is inlined to match
-- is_synthetic_chapter_title() in the migration, which does not exist yet when
-- you run this file.

WITH scope(grade, subject_code) AS (
  SELECT g.grade, s.code FROM (VALUES ('6'),('7'),('8'),('9'),('10')) g(grade)
   CROSS JOIN (VALUES ('math'),('science')) s(code)
  UNION ALL
  SELECT g.grade, s.code FROM (VALUES ('11'),('12')) g(grade)
   CROSS JOIN (VALUES ('math'),('physics'),('chemistry'),('biology')) s(code)
),
raw AS (
  SELECT r.grade_short AS grade, r.subject_code, r.chapter_number, r.chapter_title,
         -- inlined is_synthetic_chapter_title()
         (r.chapter_title IS NULL
          OR btrim(r.chapter_title) = ''
          OR btrim(r.chapter_title) ~* 'chapter[[:space:]]*[0-9]+[[:space:]]*$'
          OR btrim(r.chapter_title) ~* '(^|[^[:alpha:]])ch[[:space:]]*[0-9]+[[:space:]]*$'
          OR r.chapter_title ~* '\.pdf'
          OR btrim(r.chapter_title) ~ '^[0-9]+$'
          OR btrim(r.chapter_title) ~* '\(title unverified\)$'
          OR (SELECT count(*) FROM regexp_split_to_table(btrim(r.chapter_title),'[[:space:]]+') t
               WHERE length(t)=1 AND t ~ '[[:alpha:]]') >= 3
         ) AS is_synthetic
    FROM public.rag_content_chunks r
    JOIN scope sc ON sc.grade = r.grade_short AND sc.subject_code = r.subject_code
   WHERE r.is_active = true
     AND r.grade_short IS NOT NULL AND r.subject_code IS NOT NULL
     AND r.chapter_number IS NOT NULL
     AND r.chapter_number BETWEEN 1 AND 30
)
SELECT
  grade, subject_code, chapter_number,
  count(*)                                              AS chunks,
  count(*) FILTER (WHERE NOT is_synthetic)              AS clean_title_chunks,
  (ARRAY_AGG(chapter_title ORDER BY chapter_title)
     FILTER (WHERE NOT is_synthetic))[1]                AS title_it_would_use,
  CASE WHEN count(*) FILTER (WHERE NOT is_synthetic) > 0
       THEN 'corpus title (clean)'
       ELSE 'PLACEHOLDER - needs F2 human pass' END     AS title_source
FROM raw
WHERE NOT EXISTS (
  SELECT 1 FROM public.cbse_syllabus cs
   WHERE cs.board='CBSE' AND cs.grade=raw.grade
     AND cs.subject_code=raw.subject_code
     AND cs.chapter_number=raw.chapter_number
)
GROUP BY grade, subject_code, chapter_number
ORDER BY title_source, grade::int, subject_code, chapter_number;


-- ═══════════════════════════════════════════════════════════════════════════
-- §G  THE ITEM #14 PAYOFF — how many chapters does ingestion_gaps mislabel?
-- ═══════════════════════════════════════════════════════════════════════════
-- recompute_syllabus_status() marks a chapter 'partial' when chunks < 50 OR
-- verified questions < 40. So a chapter with plenty of NCERT text but no
-- verified quizzes is reported as a CONTENT gap when it is nothing of the
-- sort. mislabelled_as_content_gap counts exactly those rows — they are what
-- the new text_coverage_status column separates out.
--
-- Run this BEFORE and AFTER for the honest delta.

SELECT
  cs.grade,
  cs.subject_code,
  count(*)                                                        AS in_scope_chapters,
  count(*) FILTER (WHERE cs.rag_status = 'ready')                 AS rag_ready,
  count(*) FILTER (WHERE cs.rag_status = 'partial')               AS rag_partial,
  count(*) FILTER (WHERE cs.rag_status = 'missing')               AS rag_missing,
  count(*) FILTER (WHERE cs.chunk_count >= 50)                    AS text_sufficient,
  count(*) FILTER (WHERE cs.chunk_count >= 50
                     AND cs.rag_status <> 'ready')                AS mislabelled_as_content_gap
FROM public.cbse_syllabus cs
WHERE cs.board = 'CBSE'
  AND cs.is_in_scope = TRUE
  AND (   (cs.grade IN ('6','7','8','9','10') AND cs.subject_code IN ('math','science'))
       OR (cs.grade IN ('11','12') AND cs.subject_code IN ('math','physics','chemistry','biology')))
GROUP BY cs.grade, cs.subject_code
ORDER BY cs.grade::int, cs.subject_code;


-- ═══════════════════════════════════════════════════════════════════════════
-- §H  ONE-PAGE SUMMARY — the whole change in a single row
-- ═══════════════════════════════════════════════════════════════════════════
-- If you run only one query, run this one.

WITH scope(grade, subject_code) AS (
  SELECT g.grade, s.code FROM (VALUES ('6'),('7'),('8'),('9'),('10')) g(grade)
   CROSS JOIN (VALUES ('math'),('science')) s(code)
  UNION ALL
  SELECT g.grade, s.code FROM (VALUES ('11'),('12')) g(grade)
   CROSS JOIN (VALUES ('math'),('physics'),('chemistry'),('biology')) s(code)
),
corpus AS (
  SELECT r.grade_short AS grade, r.subject_code, r.chapter_number,
         count(*)::int AS corpus_chunk_count
    FROM public.rag_content_chunks r
    JOIN scope sc ON sc.grade = r.grade_short AND sc.subject_code = r.subject_code
   WHERE r.is_active = true
     AND r.grade_short IS NOT NULL AND r.subject_code IS NOT NULL
     AND r.chapter_number IS NOT NULL
     AND r.chapter_number BETWEEN 1 AND 30
   GROUP BY 1, 2, 3
),
trusted AS (
  SELECT grade, subject_code FROM corpus
   GROUP BY grade, subject_code
  HAVING count(*) >= 3 AND sum(corpus_chunk_count) >= 50
),
unconfirmed AS (
  SELECT cs.id, cs.grade, cs.subject_code, cs.chapter_number,
         (SELECT count(*) FROM public.question_bank qb
           WHERE qb.grade=cs.grade AND qb.subject=cs.subject_code
             AND qb.chapter_number=cs.chapter_number
             AND qb.is_active AND qb.deleted_at IS NULL) AS live_q
    FROM public.cbse_syllabus cs
    JOIN trusted t ON t.grade=cs.grade AND t.subject_code=cs.subject_code
   WHERE cs.board='CBSE' AND cs.is_in_scope = TRUE
     AND NOT EXISTS (SELECT 1 FROM corpus c
                      WHERE c.grade=cs.grade AND c.subject_code=cs.subject_code
                        AND c.chapter_number=cs.chapter_number)
)
SELECT
  (SELECT count(*) FROM scope)                                     AS keep_set_cells,
  (SELECT count(*) FROM trusted)                                   AS cells_trusted,
  (SELECT count(*) FROM scope) - (SELECT count(*) FROM trusted)    AS cells_skipped_g1,
  (SELECT count(*) FROM corpus c JOIN trusted t
     ON t.grade=c.grade AND t.subject_code=c.subject_code
    WHERE NOT EXISTS (SELECT 1 FROM public.cbse_syllabus cs
                       WHERE cs.board='CBSE' AND cs.grade=c.grade
                         AND cs.subject_code=c.subject_code
                         AND cs.chapter_number=c.chapter_number))  AS rows_to_insert,
  (SELECT count(*) FROM unconfirmed WHERE live_q = 0)              AS rows_to_retire,
  (SELECT count(*) FROM unconfirmed WHERE live_q > 0)              AS rows_spared_g3b,
  (SELECT count(*) FROM public.cbse_syllabus cs
    WHERE cs.board='CBSE' AND cs.is_in_scope
      AND ((cs.grade IN ('6','7','8','9','10') AND cs.subject_code IN ('math','science'))
        OR (cs.grade IN ('11','12') AND cs.subject_code IN ('math','physics','chemistry','biology'))))
                                                                   AS in_scope_rows_today,
  0                                                                AS rows_deleted_always_zero;


-- ═══════════════════════════════════════════════════════════════════════════
-- §I  POST-APPLY VERIFICATION (run these AFTER the migration, not before)
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The drift canary should report aligned = true for the keep-set:
--      SELECT public.assert_syllabus_corpus_alignment();
--
-- 2. Everything the run did, with before-values, for rollback:
--      SELECT action, count(*)
--        FROM public.cbse_syllabus_corpus_reconciliation_ledger
--       GROUP BY action ORDER BY action;
--
--      SELECT * FROM public.cbse_syllabus_corpus_reconciliation_ledger
--       ORDER BY created_at DESC, grade, subject_code, chapter_number;
--
-- 3. The summary audit row:
--      SELECT details FROM public.admin_audit_log
--       WHERE action = 'cbse_syllabus.corpus_reconciled_math_science'
--       ORDER BY created_at DESC LIMIT 1;
--
-- 4. Genuine content gaps, no longer conflated with quiz verification:
--      SELECT * FROM public.content_coverage_gaps ORDER BY content_severity;
--
-- 5. Rows still needing the F2 human title pass:
--      SELECT grade, subject_code, chapter_number, chapter_title
--        FROM public.cbse_syllabus
--       WHERE chapter_title ~* '\(title unverified\)$'
--       ORDER BY grade::int, subject_code, chapter_number;
--
-- 6. Rows the F1 question_bank remap must handle (G3b-spared):
--      SELECT grade, subject_code, chapter_number, live_question_count
--        FROM public.cbse_syllabus_corpus_reconciliation_ledger
--       WHERE action = 'retain_has_questions'
--       ORDER BY grade, subject_code, chapter_number;
--
-- 7. THE G8 CHECK — chapters the recompute would have hidden and did not.
--    status_preserved is the count of students-facing chapters this migration
--    saved from Section 7. Compare it against §E2's protected_by_7b_preserve:
--    they must agree. If status_preserved is 0 while §E2 showed a non-zero
--    protected_by_7b_preserve, Section 7b did not run — investigate before
--    anyone touches the picker.
--      SELECT action, count(*)
--        FROM public.cbse_syllabus_corpus_reconciliation_ledger
--       WHERE action IN ('rag_status_preserved','rag_status_promoted',
--                        'rag_status_recomputed','retain_ambiguous_chunks')
--       GROUP BY action ORDER BY action;
--
--    Per-cell reachability, before vs after, straight from the audit row:
--      SELECT jsonb_pretty(details->'reachability_by_cell')
--        FROM public.admin_audit_log
--       WHERE action = 'cbse_syllabus.corpus_reconciled_math_science'
--       ORDER BY created_at DESC LIMIT 1;
--
-- 8. Independent re-derivation of the invariant (does not trust the ledger).
--    Must return ZERO rows. Any row is a chapter with live questions that the
--    picker can no longer serve.
--      SELECT cs.grade, cs.subject_code, cs.chapter_number, cs.chapter_title,
--             cs.rag_status, cs.is_in_scope
--        FROM public.cbse_syllabus cs
--       WHERE cs.board = 'CBSE'
--         AND NOT (cs.is_in_scope AND cs.rag_status IN ('partial','ready'))
--         AND EXISTS (SELECT 1 FROM public.question_bank qb
--                      WHERE qb.grade = cs.grade
--                        AND qb.subject = cs.subject_code
--                        AND qb.chapter_number = cs.chapter_number
--                        AND qb.is_active AND qb.deleted_at IS NULL)
--         AND (   (cs.grade IN ('6','7','8','9','10')
--                  AND cs.subject_code IN ('math','science'))
--              OR (cs.grade IN ('11','12')
--                  AND cs.subject_code IN ('math','physics','chemistry','biology')))
--       ORDER BY cs.grade::int, cs.subject_code, cs.chapter_number;
--    (Strictly this is a SUPERSET of the migration's own A1 assertion: it also
--    catches chapters that were ALREADY unreachable-with-questions before the
--    run, which the migration does not claim to fix — cross-check any hits
--    against §E2 before treating them as a regression. Chapters whose rows sit
--    in a G1-untrusted cell are in that category by construction.)
--
-- 9. ROLLBACK, if the reachability numbers are not what you accepted. Run all
--    four inside ONE transaction, with <run> = the run_id from the audit row:
--      BEGIN;
--      UPDATE public.cbse_syllabus cs SET rag_status = l.rag_status_before,
--                                         updated_at = now()
--        FROM public.cbse_syllabus_corpus_reconciliation_ledger l
--       WHERE l.run_id = '<run>'
--         AND l.action IN ('rag_status_recomputed','rag_status_promoted',
--                          'rag_status_preserved')
--         AND l.rag_status_before IS NOT NULL
--         AND cs.id = l.syllabus_id;
--      UPDATE public.cbse_syllabus cs SET is_in_scope = l.is_in_scope_before
--        FROM public.cbse_syllabus_corpus_reconciliation_ledger l
--       WHERE l.run_id = '<run>' AND l.action = 'flip_out_of_scope'
--         AND cs.id = l.syllabus_id;
--      UPDATE public.cbse_syllabus cs SET chapter_title = l.title_before
--        FROM public.cbse_syllabus_corpus_reconciliation_ledger l
--       WHERE l.run_id = '<run>' AND l.action = 'title_upgrade'
--         AND cs.id = l.syllabus_id;
--      UPDATE public.cbse_syllabus cs SET is_in_scope = FALSE
--        FROM public.cbse_syllabus_corpus_reconciliation_ledger l
--       WHERE l.run_id = '<run>' AND l.action = 'insert_chapter'
--         AND cs.id = l.syllabus_id;   -- hide, never DELETE
--      COMMIT;
--    Do NOT re-run recompute_syllabus_status() afterwards on those coordinates
--    — it will immediately undo statement 1 (that is bug F4). chunk_count /
--    verified_question_count are left at their recomputed values on purpose:
--    they are derived facts and are now MORE accurate than before the run;
--    chunk_count_before is on the same ledger rows if an exact restore is
--    required.
