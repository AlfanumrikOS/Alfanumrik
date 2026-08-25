-- Migration: 20260825160000_retire_withdrawn_ncert_math_science_chapters.sql
-- Purpose: Stop advertising - and stop quizzing on - 26 math/science chapters
--          that NCERT no longer publishes.
--
-- ── THE FINDING ────────────────────────────────────────────────────────────
-- `cbse_syllabus` carries 26 math/science chapters flagged is_in_scope = true
-- with text_coverage_status = 'missing'. They were read as a content gap: the
-- corpus was assumed incomplete and the ingestion assumed to have truncated.
-- Neither is true.
--
-- Evidence gathered 2026-08-25, against the live NCERT site and storage:
--
--  1. Ingestion is complete. Counting real chapter PDFs in the `ncert-books`
--     bucket (excluding prelims/answers/appendix/cover) against chapters that
--     hold chunks, 14 of the 18 math/science cells match EXACTLY. Every PDF
--     present was ingested; nothing was dropped.
--
--  2. The "missing" chapters have no PDF because NCERT has withdrawn them.
--     Sampled directly from https://ncert.nic.in/textbook/pdf/<code>.pdf:
--
--       iemh101  200  1,497,655 bytes   (storage: 1463 KB - byte-match)
--       iemh108  200  2,726,466 bytes   (storage: 2663 KB - byte-match)
--       iemh109  404      <- Class 9 Maths ships 8 chapters, not 12
--       kech110  404      <- s-Block Elements
--       kemh115  404      <- Mathematical Reasoning
--       lech115  404      <- Polymers
--       leph115  404      <- Communication Systems
--       lebo114  404      <- Environmental Issues
--       jesc114  404      <- Sources of Energy
--       jemh115  404      <- Constructions
--       iesc114  404      <- Natural Resources
--
--     Every sampled withdrawn chapter 404s; the retained ones serve and match
--     storage byte-for-byte. These are 2023-rationalisation removals plus the
--     newer NCF replacements (Ganita Prakash, Curiosity), not gaps.
--
--  3. 21 sibling rows in the same tables are ALREADY is_in_scope = false with
--     coverage 'missing' - the same retirement, applied before and never
--     finished. This completes it.
--
-- ── WHY IT MATTERS MORE THAN AN EMPTY CHAPTER ──────────────────────────────
-- 281 active, published questions target these withdrawn chapters. Question
-- selection filters on grade / subject / is_active / content_status /
-- verification_state - NOT on chapter scope (see
-- packages/lib/src/adaptive/select-adaptive-questions.ts). So retiring the
-- syllabus row alone would leave every one of those questions servable.
-- Students are being examined on syllabus NCERT has deleted, which is exactly
-- the "never serve outdated NCERT content" rule this platform holds.
--
-- Both halves are therefore applied together. Per-cell impact, measured:
--
--     9/math          96 of 273   35.2%   <- largest, and correct: these test
--                                            Circles, Heron's Formula, Surface
--                                            Areas, Statistics and ch 13-15,
--                                            none of which exist in the current
--                                            8-chapter book
--    11/chemistry     55 of 360   15.3%
--    10/science       40 of 547    7.3%
--    11/biology       30 of 624    4.8%
--    11/math          30 of 462    6.5%
--    10/math          16 of 466    3.4%
--    12/biology        8 of 329    2.4%
--    12/chemistry      2 of 297    0.7%
--    12/physics        2 of 358    0.6%
--     9/science        2 of 340    0.6%
--
-- 9/math retains 177 questions across its 8 live chapters (~22/chapter), which
-- stays workable. No cell is emptied.
--
-- ── SCOPE ──────────────────────────────────────────────────────────────────
-- Math and science only (grades 6-12), as directed. Other subjects carry the
-- same class of stale row and are deliberately NOT touched here - they need
-- the same NCERT-vs-storage check run against their own books first.
--
-- The 26 tuples are listed EXPLICITLY rather than selected by
-- text_coverage_status, so re-running cannot widen the blast radius if that
-- column changes. Nothing is deleted: rows are flagged, questions are
-- deactivated, and both are one UPDATE from restoration.
--
-- Rollback:
--   update public.cbse_syllabus set is_in_scope = true where ... (same tuples)
--   update public.question_bank  set is_active  = true where ... (same tuples)

do $migration_body$
declare
  v_chapters integer;
  v_questions integer;
begin
  create temporary table _withdrawn (grade text, subject_code text, chapter_number integer)
    on commit drop;

  insert into _withdrawn (grade, subject_code, chapter_number) values
    -- Class 9 Maths ships 8 chapters (iemh109+ = 404).
    ('9','math',9), ('9','math',10), ('9','math',11), ('9','math',12),
    ('9','math',13),                       -- placeholder row titled "Chapter 13"
    ('9','science',14),                    -- Natural Resources
    ('10','math',15),                      -- Constructions
    ('10','science',14), ('10','science',15), ('10','science',16),
    ('11','biology',20), ('11','biology',21), ('11','biology',22),
    ('11','chemistry',10), ('11','chemistry',11), ('11','chemistry',12),
    ('11','chemistry',13), ('11','chemistry',14),
    ('11','math',15), ('11','math',16),
    ('12','biology',14), ('12','biology',15), ('12','biology',16),
    ('12','chemistry',15), ('12','chemistry',16),
    ('12','physics',15);

  -- Guard: the list is fixed at 26. If it ever drifts, stop rather than apply
  -- a partial or widened retirement.
  if (select count(*) from _withdrawn) <> 26 then
    raise exception 'expected 26 withdrawn chapters, got %', (select count(*) from _withdrawn);
  end if;

  update public.cbse_syllabus s
  set is_in_scope = false,
      notes = coalesce(nullif(s.notes, '') || ' | ', '')
              || 'Retired 2026-08-25: NCERT no longer publishes this chapter '
              || '(verified 404 at ncert.nic.in). Not a content gap.',
      updated_at = now()
  from _withdrawn w
  where s.grade::text = w.grade
    and s.subject_code = w.subject_code
    and s.chapter_number = w.chapter_number
    and s.is_in_scope is distinct from false;
  get diagnostics v_chapters = row_count;

  -- Deactivate questions on withdrawn chapters. Question selection does not
  -- consult chapter scope, so without this they keep serving.
  update public.question_bank q
  set is_active = false,
      updated_at = now()
  from _withdrawn w
  where q.grade = w.grade
    and q.subject = w.subject_code
    and q.chapter_number = w.chapter_number
    and q.is_active is distinct from false;
  get diagnostics v_questions = row_count;

  raise notice
    'Retired % syllabus chapters and deactivated % questions on withdrawn NCERT chapters.',
    v_chapters, v_questions;

  -- Post-condition: nothing in scope may still point at a withdrawn chapter.
  if exists (
    select 1 from public.cbse_syllabus s join _withdrawn w
      on s.grade::text = w.grade and s.subject_code = w.subject_code
     and s.chapter_number = w.chapter_number
    where s.is_in_scope
  ) then
    raise exception 'a withdrawn chapter is still is_in_scope=true';
  end if;
end $migration_body$;
