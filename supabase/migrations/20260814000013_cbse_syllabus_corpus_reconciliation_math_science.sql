-- Migration: 20260814000013_cbse_syllabus_corpus_reconciliation_math_science.sql
-- Owner: architect. CEO-approved SEV1. Reviewers: assessment, ai-engineer, backend, testing.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE
-- ═══════════════════════════════════════════════════════════════════════════
-- Reconcile public.cbse_syllabus (the Layer-2 chapter registry) against
-- public.rag_content_chunks (the actually-indexed NCERT corpus) for the
-- CEO-locked keep-set ONLY:
--   grades 6-10  → math, science
--   grades 11-12 → math, physics, chemistry, biology   (deliberately NO
--                  `science` row at 11-12, per 20260814000008)
-- No other subject's rows are read, written, or considered by this file.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE DEFECT
-- ═══════════════════════════════════════════════════════════════════════════
-- 20260624000100_seed_cbse_syllabus_manifest.sql seeded 815 registry rows
-- labelled "NCERT 2025 edition". It is not that edition consistently:
--   * G6 math ch1-10 are Ganita Prakash 2024, ch11-14 are pre-2024 carry-overs
--   * G7 science is labelled "Curiosity 2025" but carries the pre-2025 list
--   * G10 science ch5 "Periodic Classification of Elements" was rationalised
--     out of the CBSE syllabus entirely
--
-- The committed 2026-06-14 live-corpus read
-- (eval/rag/golden/corpus-coverage-findings.md:26-36) shows the INDEXED corpus
-- uses different chapter numbers for the same content:
--   g7  science photosynthesis   registry ch1  vs corpus ch10
--   g7  math    integers         registry ch1  vs corpus ch10
--   g10 science electricity      registry ch12 vs corpus ch11
--   g10 science life processes   registry ch6  vs corpus ch5
--   g11 physics laws of motion   registry ch5  vs corpus ch4
--   g11 physics gravitation      registry ch8  vs corpus ch7
--
-- EVERYTHING keys on (grade, subject_code, chapter_number) with EXACT
-- equality: recompute_syllabus_status(), the ingestion_gaps view, the
-- cbse_syllabus_rag_diagnostic view, the grounded-answer strict-mode coverage
-- precheck, chapter-scoped retrieval, and available_chapters_for_student_
-- subject_v2 (the /quiz chapter picker). A registry↔corpus coordinate
-- disagreement therefore makes every one of those surfaces INDEPENDENTLY
-- conclude the content is missing.
--
--   The corpus exists (~16,006 chunks). We are failing to find content we
--   already paid to index.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS MIGRATION IS SELF-RECONCILING SQL AND NOT A HAND-WRITTEN LIST
-- ═══════════════════════════════════════════════════════════════════════════
-- Nobody authoring this change has live database access. A hand-written
-- corrected chapter list would be invented chapter numbers — the exact class
-- of error being fixed. This migration therefore DERIVES the correct
-- coordinates by reading rag_content_chunks at migration time. It hardcodes
-- no chapter number and no chapter title anywhere.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SAFETY GUARDS (each prevents a specific, named catastrophic outcome)
-- ═══════════════════════════════════════════════════════════════════════════
-- G1 FAIL CLOSED ON A THIN OR EMPTY CORPUS CELL.
--    scripts/ncert-ingestion/CLAUDE.md:15 records that the existing corpus was
--    built by "a legacy tool no longer present in the codebase", so the
--    population of rag_content_chunks.subject_code / .grade_short (the two
--    columns match_rag_chunks_ncert and recompute_syllabus_status join on) is
--    UNVERIFIED and may be NULL. If those columns are NULL for a cell, the
--    naive inference is "the corpus has no chapters, therefore the syllabus
--    has none" — which would blank the curriculum for every student in that
--    grade. A (grade, subject_code) cell is treated as authoritative ONLY when
--    it clears MIN_CELL_CHAPTERS and MIN_CELL_CHUNKS (Section 3b).
--    An untrusted cell is left BIT-FOR-BIT UNTOUCHED: no insert, no scope
--    flip, no title change, and NOT EVEN a recompute (a recompute on an
--    untrusted cell would zero its chunk_count and drive it to 'missing' —
--    the same catastrophe by a slower route). Every skipped cell is written
--    to the ledger with action 'cell_skipped_untrusted' so the fail-closed
--    path is loud rather than silent.
--
-- G2 NO DROP of any table, column, constraint, index, or policy. Additive and
--    idempotent only.
--
-- G3 NO DELETE of any cbse_syllabus row. Chapters the corpus does not confirm
--    are flipped is_in_scope = FALSE — reversible, auditable, and recorded
--    row-by-row in the ledger table this migration creates. This is also what
--    retires rationalised-out chapters such as G10 "Periodic Classification of
--    Elements" without destroying the historical row.
--
-- G3b CARVE-OUT ON G3: a chapter that has live questions is NEVER flipped out
--    of scope, even when the corpus does not confirm it. Hiding a chapter
--    students are actively being served questions from would be a content
--    regression. Those rows are recorded with action 'retain_has_questions'
--    so the exception is visible, not silent. This carve-out is also what
--    makes G4 safe: questions stay attached to a row that is still in scope.
--
--    WHAT G3b GUARANTEES, EXACTLY — corrected 2026-08-14 after quality review.
--    An earlier draft of this comment claimed G3b was what stops a chapter
--    with questions from being hidden. IT IS NOT, ON ITS OWN. The picker
--    requires BOTH halves of a conjunction:
--        available_chapters_for_student_subject_v2 (20260605000000:208-209,
--        carried over byte-for-byte by 20260814000014:373-374):
--            cs.rag_status IN ('partial','ready')  AND  cs.is_in_scope = TRUE
--    G3b preserves the SECOND half only. It says nothing about rag_status —
--    and Section 7's recompute sets rag_status='missing' whenever chunk_count
--    is 0, which is true BY DEFINITION for every row G3b spares (the corpus
--    does not confirm the coordinate, so there are no chunks there). A row
--    spared by G3b alone would keep is_in_scope=TRUE and still vanish from the
--    picker.
--    Reachability is guaranteed by G3b TOGETHER WITH G8/Section 7b, which
--    restores rag_status after the recompute. Neither half is sufficient
--    alone; the pairing is the guarantee.
--
-- G3c AMBIGUOUS-CHUNK CARVE-OUT ON G3: rag_content_chunks.is_active is
--    NULLABLE (baseline: `is_active boolean DEFAULT true`, no NOT NULL). The
--    corpus observation in 3d filters `is_active = true`, which silently drops
--    NULL rows — so a coordinate whose chunks all carry is_active IS NULL
--    reads as corpus-ABSENT and would be retired by Section 6 even though real
--    indexed text sits at it. That is a second NULL-metadata path into the
--    retire branch which G1's cell-level floors do not cover (G1 protects
--    whole cells; this is per-coordinate). A coordinate with any
--    is_active IS NULL chunk is therefore never retired; it is recorded with
--    action 'retain_ambiguous_chunks'. It is deliberately NOT counted as
--    corpus-confirmed for insert/title/recompute purposes: G6 says we join on
--    what the platform actually reads, and recompute_syllabus_status() itself
--    counts `is_active = true` only, so pretending otherwise here would put
--    the registry back out of step with the function.
--
-- G4 question_bank.chapter_number IS NOT REMAPPED HERE. Existing questions are
--    tagged to the OLD chapter numbers. Re-pointing them is a separate,
--    reversible mapping migration with its own review: getting it wrong
--    mis-files a student's mastery history, which is not recoverable from the
--    student's point of view. Explicitly out of scope. See FOLLOW-UPS.
--
-- G5 CORPUS TITLES ARE UNTRUSTED. The ingester writes synthetic titles
--    (storage-ingest.ts:637 → "Science (jesc) Ch 10"; ingest-local.ts:766 →
--    "<bookName> - Chapter N") and legacy rows carry garbled ones
--    ("P O W E R - S H A R I N G", "Arts XI · kehs104.pdf").
--    A GOOD EXISTING REGISTRY TITLE IS NEVER OVERWRITTEN — rows already
--    holding a real human title are excluded from the title pass by predicate,
--    not by convention.
--    Title resolution ladder for a row created AT a corpus coordinate:
--      1. a corpus title passing is_synthetic_chapter_title() = false (it came
--         from the same document that produced the chunks, so it is the only
--         source guaranteed to describe THAT chapter);
--      2. 'Chapter N (title unverified)', left visibly awaiting the F2 human
--         pass.
--    The curated public.chapters catalog is DELIBERATELY NOT rung 1, even
--    though it is human Title Case. Verified in _legacy/timestamped/
--    20260415000014_chapters_canonical_master.sql: `chapters` was backfilled
--    FROM question_bank and chapter_concepts, so it carries the SAME legacy
--    numbering this migration is correcting. Using it at a corpus coordinate
--    would stamp the old chapter's name onto the new coordinate — a
--    confidently-wrong title, which is worse than a visibly-absent one.
--    Section 4 suppresses that lookup explicitly; see the long note there.
--
-- G6 JOIN ON THE COLUMNS THE PLATFORM ACTUALLY READS. rag_content_chunks
--    stores grade and subject TWICE in two notations: grade ('Grade 10') +
--    grade_short ('10'), and subject ('Mathematics') + subject_code ('math').
--    match_rag_chunks_ncert and recompute_syllabus_status both read
--    grade_short/subject_code, so this migration joins on those and only
--    those. NULLs in either are handled by G1.
--
-- G7 CHAPTER-NUMBER SANITY CEILING. Only corpus chapter_number in
--    [1, MAX_CHAPTER_NUMBER] may create a registry row.
--    cbse_syllabus_chapter_number_check already requires > 0; the ceiling
--    additionally rejects PDF-artifact numbering (the g11 history corpus
--    carries ch103-ch107 from filename parsing). No CBSE math or science book
--    in grades 6-12 has more than 30 chapters.
--
-- G8 STATUS NON-REGRESSION. THE INVARIANT THIS MIGRATION MUST NOT BREAK:
--
--      No chapter that a student can reach TODAY and that carries live
--      questions may become unreachable because of this migration.
--
--    "Reachable" is the picker's exact conjunction:
--        is_in_scope = TRUE AND rag_status IN ('partial','ready').
--    Section 7's recompute attacks the second conjunct (chunk_count = 0 =>
--    'missing'), so G3b's protection of the first conjunct is not enough.
--    G8 is implemented in three parts, all of which must be present:
--      (i)   Section 3g snapshots the PRE-MIGRATION rag_status / chunk_count /
--            is_in_scope / question counts of every trusted-cell row into
--            _recon_pre_status. Nothing else in the file records that state,
--            so without the snapshot Section 7 is irreversible.
--      (ii)  Section 7b runs immediately after the recompute and (a) RESTORES
--            the snapshot rag_status of any row the recompute pushed to
--            'missing' that was reachable before and has live questions, and
--            (b) re-applies the 20260621000700 promotion (missing -> partial
--            where verified questions exist) inside the trusted cells.
--      (iii) Section 11 ASSERTS the invariant row-by-row and aborts the whole
--            transaction if a single row violates it. The assertion is the
--            proof; (i) and (ii) are merely the mechanism.
--    Consequence, stated so it can be checked rather than trusted: the ONLY
--    chapters this migration can remove from the picker are chapters with zero
--    NCERT chunks AND zero live questions - i.e. chapters that would hand the
--    student an empty quiz. Everything else is preserved or promoted.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ALSO FOLDED IN (both CEO-approved)
-- ═══════════════════════════════════════════════════════════════════════════
-- #11 rag_status='missing' hides chapters that have questions.
--     available_chapters_for_student_subject_v2 filters
--     `cs.rag_status IN ('partial','ready') AND cs.is_in_scope = TRUE`
--     (20260605000000:208-209; carried over byte-for-byte by
--     20260814000014:373-374). BOTH conjuncts, not either.
--
--     ── CORRECTED PREMISE (this paragraph replaces a FALSE one; the error is
--     ── recorded rather than quietly deleted, because it was load-bearing and
--     ── a future reader would otherwise re-derive the same wrong conclusion.)
--
--     The withdrawn argument: "the manifest seeded every row 'missing' on
--     2026-06-24; the only promotion migration ran 2026-06-21 — THREE DAYS
--     EARLIER — so it never touched them", concluding that no row is promoted
--     today and therefore that a blanket recompute can only improve things.
--
--     That is backwards. 20260624000100's seed is ON CONFLICT DO NOTHING (its
--     own footer says so), so it cannot overwrite, downgrade or un-promote any
--     row that already existed. Rows seeded BEFORE 2026-06-21 — e.g. the
--     20260605000000:319 seeds — were promoted 'missing' -> 'partial' by
--     20260621000700 wherever verified questions existed, and KEPT that
--     'partial'. Those rows carry chunk_count = 0 AND rag_status = 'partial'
--     and ARE REACHABLE IN THE PICKER TODAY. The 2026-06-24 manifest could
--     only add rows the promotion had not seen; it could not undo it.
--
--     Consequence for this migration: a blanket recompute over the trusted set
--     is NOT "no-op or improvement". For every one of those rows it is a
--     REGRESSION — chunk_count is still 0 at the old coordinate, so
--     recompute_syllabus_status() writes 'missing' and the chapter disappears
--     from the picker. The worse the corpus coverage in a cell, the more rows
--     this hits: a cell with 5 of 16 chapters ingested still clears the G1
--     trust floors, and the other 11 get recomputed to 'missing'.
--
--     So #11 is delivered by Section 7 AND Section 7b together:
--       Section 7  lands honest counts on the CORRECTED coordinates (the half
--                  that finds content we already paid to index);
--       Section 7b restores every status the recompute took away from a
--                  chapter with live questions, and re-applies the
--                  20260621000700 promotion inside the trusted cells (the half
--                  that stops hiding chapters that have questions).
--     Section 7 alone would ship the exact defect #11 exists to remove.
--
-- #14 readiness conflates "do we have the NCERT text" with "are the quizzes
--     verified". recompute_syllabus_status() (20260524110000:70-74) is:
--         WHEN v_chunks = 0                          THEN 'missing'
--         WHEN v_chunks < 50 OR v_questions < 40     THEN 'partial'
--         ELSE 'ready'
--     where v_questions counts verified_against_ncert = true. A chapter with
--     400 perfect chunks and zero verified quizzes reads 'partial' and appears
--     in ingestion_gaps as a CONTENT gap. That conflation produced a
--     documented self-confirming deadlock (production held ZERO 'ready' rows),
--     fixed serving-side on 2026-08-01 — but grounded-answer/coverage.ts:78-87
--     records that the REPORTING surface was deliberately left unfixed.
--     Section 8 adds a distinct, text-only content signal ALONGSIDE
--     rag_status. rag_status keeps its exact existing semantics and every
--     existing consumer (including the chapter picker) is untouched.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO (one variable at a time)
-- ═══════════════════════════════════════════════════════════════════════════
--   * does not alter recompute_syllabus_status() — it is CALLED (Section 7),
--     never redefined, and Section 7b never reimplements its arithmetic; 7b
--     only restores a value the function had already produced earlier, or
--     re-applies another migration's published rule
--   * does not alter available_chapters_for_student_subject_v2 — the picker's
--     DEFINITION is untouched. What a student sees changes for exactly two
--     reasons: corrected coordinates (the point of the fix) and Section 7b's
--     rag_status writes, which are bounded by G8 to "never fewer reachable
--     chapters-with-questions than before"
--   * does not alter the ingestion_gaps view
--   * does not alter or delete any rag_content_chunks row
--   * does not remap question_bank (G4)
--   * does not touch any subject outside the keep-set
--
-- ═══════════════════════════════════════════════════════════════════════════
-- IDEMPOTENCY
-- ═══════════════════════════════════════════════════════════════════════════
-- Section 4's INSERT is ON CONFLICT DO NOTHING against the unique constraint
-- (board, grade, subject_code, chapter_number) restored by 20260814000001, and
-- its plan additionally excludes coordinates that already have a row, so a
-- second run inserts zero. Sections 5 and 6 build their plans from predicates
-- that are already false after a successful first run (the title is no longer
-- synthetic; is_in_scope is already FALSE), and their UPDATEs additionally
-- carry `IS DISTINCT FROM <target>` guards, so both are no-ops on re-run.
-- Section 7's recompute is idempotent by construction (pure recomputation from
-- current data). Section 7b is idempotent on the SECOND run and after: its
-- promote branch only fires on rows still at 'missing' after the recompute,
-- and every row it promoted on run 1 is (verified questions being a subset of
-- live questions) protected by its own preserve branch on run 2, so run 2
-- promotes nothing and the net rag_status delta is zero. Section 8's DDL uses
-- ADD COLUMN IF NOT EXISTS; Sections 8-9 use CREATE OR REPLACE for every view
-- and function.
--
-- HONEST EXCEPTION — four ledger actions are OBSERVATIONS or net-zero repairs,
-- not net changes, and are deliberately re-emitted with a fresh run_id on every
-- run:
--   'cell_skipped_untrusted'   (which cells the G1 guard refused this time)
--   'retain_has_questions'     (which unconfirmed chapters G3b protected)
--   'retain_ambiguous_chunks'  (which unconfirmed chapters G3c protected)
--   'rag_status_preserved'     (which rows Section 7b handed their pre-run
--                               rag_status back after the recompute — an
--                               UPDATE that happens on every run but whose
--                               before-value and after-value are IDENTICAL, so
--                               it is net-zero against the pre-run state)
-- None of the four changes any curriculum row relative to how the run started.
-- Re-running therefore grows the ledger without changing the curriculum. The
-- Section 10 audit row is gated on the CHANGE actions only ('insert_chapter',
-- 'flip_out_of_scope', 'title_upgrade', 'rag_status_promoted',
-- 'rag_status_recomputed'), so a genuinely no-op re-run writes no second audit
-- record and the rollback record stays unique and authoritative.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK SOURCE OF TRUTH
-- ═══════════════════════════════════════════════════════════════════════════
-- public.cbse_syllabus_corpus_reconciliation_ledger — one row per decision,
-- carrying the run_id, the action, the coordinate, and the BEFORE value of
-- every field this migration changed. rag_status is included: every row whose
-- rag_status this run net-changed is recorded with its rag_status_before, so
-- Section 7's recompute is reversible too (before the 2026-08-14 quality
-- review it was NOT — nothing recorded the pre-recompute status of the trusted
-- set and the documented rollback restored is_in_scope and chapter_title only).
--
-- To roll a run back, in this order:
--   -- 1. rag_status (Sections 7 + 7b). One statement covers all three status
--   --    actions because each carries its own rag_status_before.
--   UPDATE public.cbse_syllabus cs SET rag_status = l.rag_status_before,
--                                      updated_at = now()
--     FROM public.cbse_syllabus_corpus_reconciliation_ledger l
--    WHERE l.run_id = '<run>'
--      AND l.action IN ('rag_status_recomputed','rag_status_promoted',
--                       'rag_status_preserved')
--      AND cs.id = l.syllabus_id
--      AND l.rag_status_before IS NOT NULL;
--   -- ('rag_status_preserved' rows are a no-op here by construction:
--   --  rag_status_before = rag_status_after. Included so the statement needs
--   --  no case analysis under pressure.)
--   -- NOTE: chunk_count / verified_question_count / last_verified_at are also
--   -- rewritten by the recompute. They are DERIVED facts, restorable at any
--   -- time by re-running recompute_syllabus_status(), and chunk_count_before
--   -- is recorded on the same ledger rows if an exact restore is wanted.
--   -- 2. scope flips (Section 6)
--   UPDATE public.cbse_syllabus cs SET is_in_scope = l.is_in_scope_before
--     FROM public.cbse_syllabus_corpus_reconciliation_ledger l
--    WHERE l.run_id = '<run>' AND l.action = 'flip_out_of_scope'
--      AND cs.id = l.syllabus_id;
--   -- 3. titles (Section 5)
--   UPDATE public.cbse_syllabus cs SET chapter_title = l.title_before
--     FROM public.cbse_syllabus_corpus_reconciliation_ledger l
--    WHERE l.run_id = '<run>' AND l.action = 'title_upgrade'
--      AND cs.id = l.syllabus_id;
--   -- 4. rows created by this run: action = 'insert_chapter'. Prefer flipping
--   --    them is_in_scope = FALSE over deleting them (house rule: no
--   --    destructive rollback in a panic).
-- Order matters only in that step 1 must precede any re-run of a recompute.
-- The single admin_audit_log row with action
-- 'cbse_syllabus.corpus_reconciled_math_science' carries the run_id and the
-- per-action counts. No other artifact records the pre-change state.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- FOLLOW-UPS THIS MIGRATION DOES NOT PERFORM (tracked, not forgotten)
-- ═══════════════════════════════════════════════════════════════════════════
--   F1 question_bank.chapter_number remap onto the corrected coordinates
--      (assessment-owned, reversible mapping migration, own review). Until F1
--      lands, questions authored against old numbers stay attached to the old
--      registry rows — which is exactly why G3b refuses to hide those rows.
--   F2 A human pass over any row this migration leaves at the
--      'Chapter N (title unverified)' placeholder — a corpus coordinate for
--      which no clean, non-synthetic title could be sourced. Query §F in the
--      dry-run companion lists them before the fact; §I.5 after.
--   F3 Repointing ingestion_gaps and the super-admin Grounding Coverage
--      dashboard onto the new text_coverage_status signal (ops + frontend).
--      Section 8 supplies the signal; it deliberately does not rewire the
--      consumers.
--   F4 PRE-EXISTING BUG, FOUND DURING THIS REVIEW, NOT CREATED BY THIS FILE
--      AND NOT FIXED BY IT — needs its own ticket (owner: architect +
--      assessment, since it straddles the registry and question_bank).
--      trg_question_bank_recompute (20260524110000:108-120) calls
--      recompute_syllabus_status() on EVERY question_bank INSERT, and on every
--      UPDATE that touches verified_against_ncert or deleted_at. That is the
--      same function Section 7 calls, with the same chunk_count = 0 =>
--      'missing' rule. So 20260621000700's promotion has been SILENTLY
--      SELF-REVERTING since 2026-06-21: any chapter it promoted to 'partial'
--      on zero chunks drops back to 'missing' the moment anyone writes a
--      question row at that coordinate. Adding or verifying questions for a
--      chapter is exactly what makes it disappear from the picker.
--      This migration does not create that bug; Section 7 universalises it by
--      driving the same recompute over ~800 coordinates at once, which is why
--      Section 7b exists. Section 7b is a repair AT MIGRATION TIME ONLY — it
--      does not immunise the platform against the trigger, so the promotion
--      can still erode again after this migration lands. A durable fix has to
--      change the readiness rule itself (e.g. treat "has live questions" as a
--      servable signal independent of chunk_count) rather than keep repainting
--      rag_status; deliberately out of scope here, one variable at a time.
--   F5 PRE-EXISTING, REPORT-ONLY — recompute_syllabus_status()'s UPDATE has no
--      `board` predicate (20260524110000:82-84). It is called with
--      (grade, subject_code, chapter_number) and rewrites EVERY cbse_syllabus
--      row at that coordinate regardless of board. Section 7 drives ~800 calls
--      through it, so any non-CBSE row sharing a coordinate is rewritten as a
--      side effect. This file WORKS AROUND it (the Section 3g snapshot, the
--      7b.1 preserve branch and the Section 11 A1 assertion are all
--      board-blind, so those rows are protected and reversible too) but does
--      NOT fix it - changing that function is a separate change with its own
--      blast radius, since the pg_cron/daily-cron and question_bank/rag-chunk
--      triggers all call it too.
--
-- Dry-run companion — run BEFORE applying, read-only, changes nothing:
--   docs/runbooks/2026-08-14-cbse-syllabus-corpus-reconciliation-dry-run.sql
-- Run §A (stop condition), §H (one-page summary) and §E2 (BLAST RADIUS) at
-- minimum. §E2 is the number that says how many chapters a student can pick
-- today sit in the path of Section 7's recompute, split into the ones Section
-- 7b protects and the ones that genuinely go dark. §E was corrected on
-- 2026-08-14: it previously modelled a post-state that could not occur, and
-- therefore could not have exposed this. §E3 lists the affected rows one by
-- one so the titles can be eyeballed before the deploy window opens.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 0 — Preconditions (fail loud, before any write)
-- ═══════════════════════════════════════════════════════════════════════════
-- Messages are assembled with explicit || into a variable rather than written
-- as adjacent string literals inside RAISE. PL/pgSQL's RAISE wants a single
-- format literal, and this file must not fail to apply over a lexer nicety.
DO $$
DECLARE
  v_msg text;
BEGIN
  IF to_regprocedure('public.recompute_syllabus_status(text,text,integer)') IS NULL THEN
    v_msg := 'Precondition failed: public.recompute_syllabus_status(text,text,integer) is absent. '
          || 'It is defined by 20260524110000_syllabus_triggers_reapply_v3.sql. Without it '
          || 'Section 7 cannot land corrected counts on the corrected coordinates, which is '
          || 'half the fix - refusing to apply a half fix.';
    RAISE EXCEPTION '%', v_msg;
  END IF;

  IF to_regclass('public.rag_content_chunks') IS NULL
     OR to_regclass('public.cbse_syllabus') IS NULL THEN
    RAISE EXCEPTION 'Precondition failed: cbse_syllabus and/or rag_content_chunks missing.';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Ledger table (rollback source of truth) + RLS (P8)
-- ═══════════════════════════════════════════════════════════════════════════
-- Curriculum coordinates only: no student data, no PII. RLS is still mandatory
-- on every new table (P8). The correct posture for a reconciliation forensic
-- record is service-role-only: no student, parent, or teacher has any reason
-- to read it, so the four-pattern policy set collapses to the admin /
-- service-role pattern BY DESIGN, not by omission — there is no student_id
-- column for a student/parent/teacher policy to key on.

CREATE TABLE IF NOT EXISTS public.cbse_syllabus_corpus_reconciliation_ledger (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id               UUID        NOT NULL,
  action               TEXT        NOT NULL,
  board                TEXT        NOT NULL DEFAULT 'CBSE',
  grade                TEXT        NOT NULL,
  subject_code         TEXT        NOT NULL,
  chapter_number       INTEGER     NOT NULL,
  syllabus_id          UUID,
  title_before         TEXT,
  title_after          TEXT,
  is_in_scope_before   BOOLEAN,
  is_in_scope_after    BOOLEAN,
  rag_status_before    TEXT,
  rag_status_after     TEXT,
  chunk_count_before   INTEGER,
  corpus_chunk_count   INTEGER,
  live_question_count  INTEGER,
  reason               TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- rag_status_after and the widened action set were added on 2026-08-14 after
-- the quality review that found Section 7 irreversible (nothing recorded the
-- pre-recompute rag_status of the trusted set). Applied as explicit,
-- IF-NOT-EXISTS / DROP-IF-EXISTS-then-ADD steps rather than only inside the
-- CREATE TABLE above, because CREATE TABLE IF NOT EXISTS is a silent no-op on
-- an environment where an earlier revision of this file already created the
-- table with the narrower shape — the column would be missing and every
-- Section 7b insert would fail.
-- This is NOT a G2 violation: G2 forbids destroying schema. Dropping a CHECK
-- this migration itself authored, purely to re-add a SUPERSET of the values it
-- allows, removes no data and rejects nothing that was previously accepted.
ALTER TABLE public.cbse_syllabus_corpus_reconciliation_ledger
  ADD COLUMN IF NOT EXISTS rag_status_after TEXT;

ALTER TABLE public.cbse_syllabus_corpus_reconciliation_ledger
  DROP CONSTRAINT IF EXISTS cbse_syllabus_recon_ledger_action_check;

ALTER TABLE public.cbse_syllabus_corpus_reconciliation_ledger
  ADD CONSTRAINT cbse_syllabus_recon_ledger_action_check CHECK (
    action = ANY (ARRAY[
      -- ── curriculum CHANGES (gate the Section 10 audit row) ──────────────
      'insert_chapter',          -- corpus coordinate had no registry row
      'flip_out_of_scope',       -- registry chapter the corpus does not confirm
      'title_upgrade',           -- placeholder title replaced from clean corpus
      'rag_status_recomputed',   -- Section 7 net-changed this row's rag_status
      'rag_status_promoted',     -- Section 7b re-applied the 20260621000700
                                 -- promotion: 'missing' -> 'partial' because
                                 -- verified questions exist at the coordinate
      -- ── OBSERVATIONS and net-zero repairs (do NOT gate the audit row) ───
      'rag_status_preserved',    -- G8/Section 7b handed a reachable chapter its
                                 -- pre-run rag_status back after the recompute
                                 -- (before = after; net-zero by construction)
      'retain_has_questions',    -- G3b carve-out: unconfirmed BUT has questions
      'retain_ambiguous_chunks', -- G3c carve-out: unconfirmed only because the
                                 -- coordinate's chunks carry is_active IS NULL
      'cell_skipped_untrusted'   -- G1: whole (grade,subject) cell left untouched
    ])
  );

ALTER TABLE public.cbse_syllabus_corpus_reconciliation_ledger
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cbse_syllabus_corpus_reconciliation_ledger FROM PUBLIC;
REVOKE ALL ON TABLE public.cbse_syllabus_corpus_reconciliation_ledger FROM anon, authenticated;
GRANT SELECT ON TABLE public.cbse_syllabus_corpus_reconciliation_ledger TO service_role;

DROP POLICY IF EXISTS cbse_syllabus_recon_ledger_service_only
  ON public.cbse_syllabus_corpus_reconciliation_ledger;
CREATE POLICY cbse_syllabus_recon_ledger_service_only
  ON public.cbse_syllabus_corpus_reconciliation_ledger
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_recon_ledger_run
  ON public.cbse_syllabus_corpus_reconciliation_ledger (run_id, action);
CREATE INDEX IF NOT EXISTS idx_recon_ledger_coord
  ON public.cbse_syllabus_corpus_reconciliation_ledger (grade, subject_code, chapter_number);

COMMENT ON TABLE public.cbse_syllabus_corpus_reconciliation_ledger IS
  'Rollback + forensic record for the cbse_syllabus <-> rag_content_chunks '
  'coordinate reconciliation (migration 20260814000013). One row per decision, '
  'carrying the BEFORE value of every field changed. Curriculum coordinates '
  'only - no PII. service_role only.';

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Synthetic-title detector (G5)
-- ═══════════════════════════════════════════════════════════════════════════
-- IMMUTABLE, SECURITY INVOKER (the default — no DEFINER, so no justification
-- comment is owed). Reads no tables, so it introduces no privilege surface.
-- Returns TRUE when a title must NOT be trusted as a human chapter name.

CREATE OR REPLACE FUNCTION public.is_synthetic_chapter_title(p_title TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    p_title IS NULL
    OR btrim(p_title) = ''
    -- "Chapter 7" / "<bookName> - Chapter 7"   (ingest-local.ts:766)
    OR btrim(p_title) ~* 'chapter[[:space:]]*[0-9]+[[:space:]]*$'
    -- "Science (jesc) Ch 10"                   (storage-ingest.ts:637)
    OR btrim(p_title) ~* '(^|[^[:alpha:]])ch[[:space:]]*[0-9]+[[:space:]]*$'
    -- "Arts XI - kehs104.pdf"                  (legacy filename titles)
    OR p_title ~* '\.pdf'
    -- bare numeric
    OR btrim(p_title) ~ '^[0-9]+$'
    -- "Chapter 11 (title unverified)" — the marker migration 20260814000013
    -- writes when it creates a row at a corpus coordinate for which no clean
    -- title could be sourced. Classified synthetic ON PURPOSE so that a later
    -- run (or a re-ingestion that lands a real title) can still upgrade it.
    OR btrim(p_title) ~* '\(title unverified\)$'
    -- "P O W E R - S H A R I N G"              (legacy letter-spaced garbage):
    -- three or more single-character alphabetic whitespace-delimited tokens.
    OR (
      SELECT count(*) FROM regexp_split_to_table(btrim(p_title), '[[:space:]]+') AS t
       WHERE length(t) = 1 AND t ~ '[[:alpha:]]'
    ) >= 3
$$;

COMMENT ON FUNCTION public.is_synthetic_chapter_title(TEXT) IS
  'TRUE when a chapter title is machine-generated or garbled and must not be '
  'trusted as a human chapter name. Patterns observed in rag_content_chunks: '
  '"<book> - Chapter N" (ingest-local.ts:766), "Science (jesc) Ch 10" '
  '(storage-ingest.ts:637), "*.pdf" filename titles, and letter-spaced legacy '
  'rows ("P O W E R - S H A R I N G"). Used by migration 20260814000013 to '
  'guarantee a good registry title is never overwritten by a corpus title.';

-- Least privilege, matching every other function in this file. Postgres grants
-- EXECUTE to PUBLIC by default on CREATE FUNCTION; nothing outside this
-- migration and the F2 title-audit query calls it, and it reads no tables, so
-- there is no reason for anon/authenticated to hold it. (Revoking here is safe
-- for the migration itself: the migration role owns the function.)
REVOKE ALL ON FUNCTION public.is_synthetic_chapter_title(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_synthetic_chapter_title(TEXT) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Scope, guard constants, corpus observation, trust decision
-- ═══════════════════════════════════════════════════════════════════════════

-- 3a. Run identity — one uuid stamps every ledger row from this execution.
CREATE TEMP TABLE _recon_run ON COMMIT DROP AS
SELECT gen_random_uuid() AS run_id;

-- 3b. Guard constants, declared exactly ONCE so they cannot drift in-file.
--     MIN_CELL_CHAPTERS / MIN_CELL_CHUNKS implement G1. Calibration: the
--     2026-07 audit reports ~16,006 chunks over ~750 chapters (~21 chunks per
--     chapter), and every real math/science cell in grades 6-12 has 10+
--     chapters. A cell presenting fewer than 3 distinct chapters or fewer than
--     50 total chunks is far likelier to be NULL/garbled metadata than a
--     genuine curriculum, so it is refused authority over the registry.
CREATE TEMP TABLE _recon_const ON COMMIT DROP AS
SELECT 3::int   AS min_cell_chapters,
       50::int  AS min_cell_chunks,
       30::int  AS max_chapter_number;   -- G7

-- 3c. THE KEEP-SET. Declared exactly ONCE, mirroring the CEO-locked set in
--     20260814000007 / 20260814000008. Grades 11-12 deliberately exclude
--     `science` (the UI presents physics+chemistry+biology as one "Science"
--     choice at senior secondary).
CREATE TEMP TABLE _recon_scope ON COMMIT DROP AS
SELECT g.grade, s.subject_code
  FROM (VALUES ('6'),('7'),('8'),('9'),('10')) AS g(grade)
 CROSS JOIN (VALUES ('math'),('science')) AS s(subject_code)
UNION ALL
SELECT g.grade, s.subject_code
  FROM (VALUES ('11'),('12')) AS g(grade)
 CROSS JOIN (VALUES ('math'),('physics'),('chemistry'),('biology')) AS s(subject_code);

-- 3d. Corpus observation. G6: joins on grade_short/subject_code, the columns
--     match_rag_chunks_ncert and recompute_syllabus_status actually read.
--     G7: chapter ceiling. Rows with NULL grade_short / subject_code /
--     chapter_number are excluded here and therefore make their cell look
--     empty, which G1 (3e) then refuses to act on.
CREATE TEMP TABLE _recon_corpus ON COMMIT DROP AS
SELECT
  r.grade_short                          AS grade,
  r.subject_code                         AS subject_code,
  r.chapter_number                       AS chapter_number,
  count(*)::int                          AS corpus_chunk_count,
  -- Best non-synthetic corpus title for this coordinate. Deterministic:
  -- ordered by frequency desc, then length desc, then alphabetically.
  (
    SELECT r2.chapter_title
      FROM public.rag_content_chunks r2
     WHERE r2.grade_short    = r.grade_short
       AND r2.subject_code   = r.subject_code
       AND r2.chapter_number = r.chapter_number
       AND r2.is_active = true
       AND NOT public.is_synthetic_chapter_title(r2.chapter_title)
     GROUP BY r2.chapter_title
     ORDER BY count(*) DESC, length(r2.chapter_title) DESC, r2.chapter_title ASC
     LIMIT 1
  )                                      AS corpus_title_candidate
FROM public.rag_content_chunks r
JOIN _recon_scope sc
  ON sc.grade = r.grade_short
 AND sc.subject_code = r.subject_code
CROSS JOIN _recon_const k
WHERE r.is_active = true
  AND r.grade_short    IS NOT NULL
  AND r.subject_code   IS NOT NULL
  AND r.chapter_number IS NOT NULL
  AND r.chapter_number BETWEEN 1 AND k.max_chapter_number
GROUP BY r.grade_short, r.subject_code, r.chapter_number;

CREATE INDEX ON _recon_corpus (grade, subject_code, chapter_number);

-- 3d2. G3c NULL-SAFE COORDINATE PRESENCE. rag_content_chunks.is_active is
--      NULLABLE (baseline: `is_active boolean DEFAULT true`), so the
--      `is_active = true` filter in 3d silently drops is_active IS NULL rows.
--      A coordinate whose chunks are ALL NULL-flagged therefore looks
--      corpus-absent to 3d and would be retired by Section 6 despite holding
--      real indexed text. This table records those ambiguous coordinates.
--      It is used ONLY to VETO retirement (Section 6), never to confirm a
--      coordinate: inserts, titles and recompute all stay aligned with
--      `is_active = true`, which is what recompute_syllabus_status() itself
--      counts (G6 — join on what the platform actually reads).
CREATE TEMP TABLE _recon_corpus_ambiguous ON COMMIT DROP AS
SELECT r.grade_short  AS grade,
       r.subject_code AS subject_code,
       r.chapter_number,
       count(*)::int  AS null_active_chunk_count
FROM public.rag_content_chunks r
JOIN _recon_scope sc
  ON sc.grade = r.grade_short
 AND sc.subject_code = r.subject_code
CROSS JOIN _recon_const k
WHERE r.is_active IS NULL
  AND r.grade_short    IS NOT NULL
  AND r.subject_code   IS NOT NULL
  AND r.chapter_number IS NOT NULL
  AND r.chapter_number BETWEEN 1 AND k.max_chapter_number
GROUP BY r.grade_short, r.subject_code, r.chapter_number;

CREATE INDEX ON _recon_corpus_ambiguous (grade, subject_code, chapter_number);

-- 3e. G1 TRUST DECISION. Only cells clearing BOTH floors are authoritative.
CREATE TEMP TABLE _recon_trusted_cells ON COMMIT DROP AS
SELECT c.grade,
       c.subject_code,
       count(*)::int                   AS corpus_chapters,
       sum(c.corpus_chunk_count)::int  AS corpus_chunks
  FROM _recon_corpus c
 CROSS JOIN _recon_const k
 -- _recon_const holds exactly one row, so the CROSS JOIN is a constant
 -- broadcast and grouping by its columns is a no-op that makes them
 -- referenceable in HAVING.
 GROUP BY c.grade, c.subject_code, k.min_cell_chapters, k.min_cell_chunks
HAVING count(*) >= k.min_cell_chapters
   AND sum(c.corpus_chunk_count) >= k.min_cell_chunks;

CREATE INDEX ON _recon_trusted_cells (grade, subject_code);

-- 3f. Record every SKIPPED cell so the fail-closed path is loud, not silent.
INSERT INTO public.cbse_syllabus_corpus_reconciliation_ledger
  (run_id, action, grade, subject_code, chapter_number, corpus_chunk_count, reason)
SELECT
  (SELECT run_id FROM _recon_run),
  'cell_skipped_untrusted',
  sc.grade,
  sc.subject_code,
  0,
  COALESCE((SELECT sum(c.corpus_chunk_count)::int FROM _recon_corpus c
             WHERE c.grade = sc.grade AND c.subject_code = sc.subject_code), 0),
  'G1 fail-closed: this cell did not clear min_cell_chapters(3)/'
  'min_cell_chunks(50). Cause is either NULL grade_short/subject_code from the '
  'legacy ingester or genuinely un-ingested content. Registry rows left '
  'untouched: no insert, no scope flip, no title change, no recompute.'
FROM _recon_scope sc
WHERE NOT EXISTS (
  SELECT 1 FROM _recon_trusted_cells t
   WHERE t.grade = sc.grade AND t.subject_code = sc.subject_code
);

-- 3g. G8 PRE-MIGRATION SNAPSHOT — the single source of truth for "what could a
--     student reach before this migration ran, and which of those chapters
--     have questions".
--
--     Taken HERE, before Section 4's first write to cbse_syllabus, so every
--     value in it is genuinely pre-migration. (Rows Section 4 creates are new
--     and cannot regress, so their absence from the snapshot is correct.)
--
--     Restricted to trusted cells because untrusted cells are never written,
--     never recomputed, and therefore cannot regress (G1).
--
--     Two question counts are kept, and the distinction matters:
--       live_question_count      — is_active AND deleted_at IS NULL. This is
--                                  the G3b/G8 population: questions a student
--                                  can actually be served. It is the set whose
--                                  reachability must be preserved.
--       verified_question_count  — the above AND verification_state='verified'.
--                                  This is 20260621000700's exact predicate,
--                                  re-applied by Section 7b's promote branch.
--     verified ⊆ live by construction, which is what makes Section 7b
--     idempotent (see the IDEMPOTENCY header note).
--
--     NOTE ON THE TWO "VERIFIED" COLUMNS IN THIS SCHEMA — they are different
--     columns and this is not a typo: 20260621000700 keys its promotion on
--     question_bank.verification_state = 'verified', while
--     recompute_syllabus_status() counts question_bank.verified_against_ncert.
--     This file mirrors each one where it belongs: verification_state here (we
--     are re-applying that migration's rule), verified_against_ncert nowhere
--     (we never reimplement the recompute — we call it).
--     WHY THIS ONE IS NOT FILTERED TO board='CBSE' (every other plan table in
--     this file is). recompute_syllabus_status() takes (grade, subject_code,
--     chapter_number) and its UPDATE carries NO board predicate
--     (20260524110000:82-84). Section 7 drives ~800 calls through it, so a row
--     of ANY board sitting at a trusted coordinate is rewritten as a side
--     effect whether this migration meant to touch it or not. Snapshotting
--     CBSE only would leave those rows outside both the 7b repair and the
--     Section 11 assertion — a blind spot in exactly the direction that hides
--     chapters. So: the snapshot and the 7b.1 PRESERVE branch are board-blind
--     (they protect whatever the recompute can reach), while the 7b.2 PROMOTE
--     branch stays board='CBSE' because that is what 20260621000700's rule
--     said and re-applying it wider would be new policy.
--     The missing board predicate in recompute_syllabus_status() is a
--     pre-existing platform defect reported alongside F4; this file works
--     around it rather than changing that function (one variable at a time).
CREATE TEMP TABLE _recon_pre_status ON COMMIT DROP AS
SELECT cs.id           AS syllabus_id,
       cs.board,
       cs.grade,
       cs.subject_code,
       cs.chapter_number,
       cs.chapter_title,
       cs.rag_status   AS rag_status_before,
       cs.chunk_count  AS chunk_count_before,
       cs.is_in_scope  AS is_in_scope_before,
       (SELECT count(*)::int
          FROM public.question_bank qb
         WHERE qb.grade = cs.grade
           AND qb.subject = cs.subject_code
           AND qb.chapter_number = cs.chapter_number
           AND qb.is_active
           AND qb.deleted_at IS NULL)              AS live_question_count,
       (SELECT count(*)::int
          FROM public.question_bank qb
         WHERE qb.grade = cs.grade
           AND qb.subject = cs.subject_code
           AND qb.chapter_number = cs.chapter_number
           AND qb.is_active
           AND qb.deleted_at IS NULL
           AND qb.verification_state = 'verified')  AS verified_question_count,
       -- The picker's exact conjunction, evaluated on pre-migration state.
       (cs.is_in_scope = TRUE
        AND cs.rag_status IN ('partial','ready'))   AS was_reachable
  FROM public.cbse_syllabus cs
  JOIN _recon_trusted_cells t
    ON t.grade = cs.grade AND t.subject_code = cs.subject_code;

CREATE INDEX ON _recon_pre_status (syllabus_id);
CREATE INDEX ON _recon_pre_status (board, grade, subject_code);

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Create registry rows at CONFIRMED corpus coordinates
-- ═══════════════════════════════════════════════════════════════════════════
-- This is the half of the fix that makes already-indexed content findable:
-- e.g. corpus g10/science/ch11 "Electricity" has no registry row at all today,
-- so coverage, the picker, and chapter-scoped retrieval cannot see it.
--
-- ── TITLE STRATEGY FOR NEW ROWS: the public.chapters catalog is DELIBERATELY
-- ── BYPASSED HERE. This is the single most counter-intuitive decision in the
-- ── file, so the reasoning is recorded in full.
--
-- trg_cbse_syllabus_normalize_display (a BEFORE INSERT trigger on this table)
-- fills chapter_title from public.chapters whenever the supplied title is NULL
-- or matches '^Chapter [0-9]+$'. Normally that catalog is the best title
-- source — it is human-curated Title Case.
--
-- It is NOT the best source AT A CORPUS COORDINATE, because the catalog shares
-- the very numbering this migration is correcting. Verified in
-- _legacy/timestamped/20260415000014_chapters_canonical_master.sql: `chapters`
-- (542 rows, pre-dating the 2026-06-24 manifest) was BACKFILLED FROM
-- question_bank and chapter_concepts — the same legacy pre-2025 numbering that
-- question_bank still carries and that G4 explicitly refuses to remap.
--
-- So if the corpus says g10/science ch11 is "Electricity" while the legacy
-- numbering calls ch11 "Magnetic Effects of Electric Current", letting the
-- trigger fire would stamp the OLD chapter's name onto the NEW coordinate and
-- publish a confidently-wrong chapter name to students. A wrong name is worse
-- than an absent one: an absent one is visibly a to-do (F2), a wrong one looks
-- correct and misleads.
--
-- Ladder actually used for NEW rows, therefore:
--   1. a corpus title passing is_synthetic_chapter_title() = false — it comes
--      from the SAME document that produced the chunks, so it is the only
--      source guaranteed to describe THIS chapter;
--   2. 'Chapter N (title unverified)' — deliberately NOT matching the
--      trigger's '^Chapter [0-9]+$' pattern, so the catalog lookup is
--      suppressed and the row is left visibly awaiting the F2 human pass.
--
-- chapter_title_hi is set non-NULL for the same reason: the trigger's catalog
-- block is also entered when chapter_title_hi IS NULL, which would pull the
-- Hindi title from that same misaligned catalog row and produce a bilingual
-- mismatch (English right, Hindi wrong — a P7 defect). Seeding it with the
-- resolved English string leaves the row untranslated-but-consistent; F2
-- covers the real translation. Untranslated is a visible gap; mistranslated
-- to a different chapter is a factual error.
--
-- subject_display IS still seeded with subject_code so the trigger CAN
-- normalize it from the public.subjects master — that lookup keys on
-- subject_code only, carries no chapter-numbering assumption, and is
-- identical to what 20260624000100 did.

CREATE TEMP TABLE _recon_plan_insert ON COMMIT DROP AS
SELECT c.grade,
       c.subject_code,
       c.chapter_number,
       c.corpus_chunk_count,
       COALESCE(
         c.corpus_title_candidate,
         'Chapter ' || c.chapter_number::text || ' (title unverified)'
       ) AS resolved_title
  FROM _recon_corpus c
  JOIN _recon_trusted_cells t
    ON t.grade = c.grade AND t.subject_code = c.subject_code
 WHERE NOT EXISTS (
   SELECT 1 FROM public.cbse_syllabus cs
    WHERE cs.board = 'CBSE'
      AND cs.grade = c.grade
      AND cs.subject_code = c.subject_code
      AND cs.chapter_number = c.chapter_number
 );

WITH inserted AS (
  INSERT INTO public.cbse_syllabus
    (board, grade, subject_code, subject_display, chapter_number, chapter_title,
     chapter_title_hi, rag_status, is_in_scope)
  SELECT
    'CBSE',
    p.grade,
    p.subject_code,
    p.subject_code,        -- normalized from subjects master by BEFORE trigger
    p.chapter_number,
    p.resolved_title,      -- catalog lookup suppressed on purpose (see above)
    p.resolved_title,      -- non-NULL to suppress the _hi catalog lookup too
    'missing',             -- corrected by Section 7's recompute
    TRUE
  FROM _recon_plan_insert p
  ON CONFLICT (board, grade, subject_code, chapter_number) DO NOTHING
  RETURNING id, grade, subject_code, chapter_number, chapter_title, is_in_scope
)
INSERT INTO public.cbse_syllabus_corpus_reconciliation_ledger
  (run_id, action, grade, subject_code, chapter_number, syllabus_id,
   title_before, title_after, is_in_scope_after, corpus_chunk_count, reason)
SELECT
  (SELECT run_id FROM _recon_run),
  'insert_chapter',
  i.grade, i.subject_code, i.chapter_number, i.id,
  NULL,
  i.chapter_title,
  i.is_in_scope,
  p.corpus_chunk_count,
  'Corpus holds indexed chunks at this coordinate but the registry had no row, '
  'so every (grade,subject,chapter)-keyed surface reported the content as '
  'missing. Registry row created AT the corpus coordinate.'
FROM inserted i
JOIN _recon_plan_insert p
  ON p.grade = i.grade
 AND p.subject_code = i.subject_code
 AND p.chapter_number = i.chapter_number;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Title upgrade for placeholders the chapters catalog could not fill
-- ═══════════════════════════════════════════════════════════════════════════
-- Runs AFTER Section 4 so newly created rows are included. Touches ONLY rows
-- whose CURRENT title is synthetic/placeholder (G5 ladder rung 3), and only
-- when a demonstrably non-synthetic corpus title exists. A real human title is
-- excluded by the `is_synthetic_chapter_title(cs.chapter_title)` predicate and
-- can never be overwritten.

CREATE TEMP TABLE _recon_plan_title ON COMMIT DROP AS
SELECT cs.id            AS syllabus_id,
       cs.grade,
       cs.subject_code,
       cs.chapter_number,
       cs.chapter_title AS title_before,
       c.corpus_title_candidate AS title_after,
       c.corpus_chunk_count
  FROM public.cbse_syllabus cs
  JOIN _recon_corpus c
    ON c.grade = cs.grade
   AND c.subject_code = cs.subject_code
   AND c.chapter_number = cs.chapter_number
  JOIN _recon_trusted_cells t
    ON t.grade = cs.grade AND t.subject_code = cs.subject_code
 WHERE cs.board = 'CBSE'
   AND public.is_synthetic_chapter_title(cs.chapter_title)
   AND c.corpus_title_candidate IS NOT NULL
   AND NOT public.is_synthetic_chapter_title(c.corpus_title_candidate)
   AND btrim(c.corpus_title_candidate) IS DISTINCT FROM btrim(cs.chapter_title);

-- chapter_title_hi is coalesced to a non-NULL value for the same reason
-- Section 4 seeds it: trg_cbse_syllabus_normalize_display enters its catalog
-- block whenever chapter_title_hi IS NULL, and that catalog carries the legacy
-- numbering (20260415000014), so it would supply a Hindi title belonging to a
-- DIFFERENT chapter — English right, Hindi wrong (a P7 defect). An existing
-- real Hindi title is preserved by the COALESCE and never clobbered.
WITH updated AS (
  UPDATE public.cbse_syllabus cs
     SET chapter_title    = p.title_after,
         chapter_title_hi = COALESCE(cs.chapter_title_hi, p.title_after),
         updated_at       = now()
    FROM _recon_plan_title p
   WHERE cs.id = p.syllabus_id
     AND cs.chapter_title IS DISTINCT FROM p.title_after
  RETURNING cs.id
)
INSERT INTO public.cbse_syllabus_corpus_reconciliation_ledger
  (run_id, action, grade, subject_code, chapter_number, syllabus_id,
   title_before, title_after, corpus_chunk_count, reason)
SELECT
  (SELECT run_id FROM _recon_run),
  'title_upgrade',
  p.grade, p.subject_code, p.chapter_number, p.syllabus_id,
  p.title_before, p.title_after, p.corpus_chunk_count,
  'Registry title was a placeholder/synthetic string and the curated '
  'public.chapters catalog could not supply a name, so a corpus title that '
  'passed is_synthetic_chapter_title()=false was adopted (G5 ladder rung 2).'
FROM _recon_plan_title p
JOIN updated u ON u.id = p.syllabus_id;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Retire chapters the corpus does not confirm (G3 / G3b / G3c)
-- ═══════════════════════════════════════════════════════════════════════════
-- NO DELETE. is_in_scope = FALSE only, row-by-row recorded, fully reversible.
-- This retires both the stale-numbering rows (e.g. g10/science/ch12
-- "Electricity", superseded by the corpus's ch11) and chapters CBSE
-- rationalised away (g10/science/ch5 "Periodic Classification of Elements").
--
-- G3b: a chapter with live questions is NEVER retired, because F1 has not run
-- and those questions are still keyed to the old number. Retiring it would
-- hide content students are actively served — the exact failure item #11 is
-- about. Recorded as 'retain_has_questions' instead. NOTE that keeping
-- is_in_scope=TRUE is only HALF of keeping the chapter reachable; the other
-- half (rag_status) is Section 7b's job. See the G3b header note.
--
-- G3c: a chapter is also never retired when the only reason the corpus does
-- not confirm it is that its chunks carry is_active IS NULL (a nullable column
-- the `is_active = true` filter silently drops). Recorded as
-- 'retain_ambiguous_chunks'.

CREATE TEMP TABLE _recon_unconfirmed ON COMMIT DROP AS
SELECT cs.id            AS syllabus_id,
       cs.grade,
       cs.subject_code,
       cs.chapter_number,
       cs.chapter_title AS title_before,
       cs.is_in_scope   AS is_in_scope_before,
       cs.rag_status    AS rag_status_before,
       cs.chunk_count   AS chunk_count_before,
       (SELECT count(*)::int
          FROM public.question_bank qb
         WHERE qb.grade = cs.grade
           AND qb.subject = cs.subject_code
           AND qb.chapter_number = cs.chapter_number
           AND qb.is_active
           AND qb.deleted_at IS NULL) AS live_question_count,
       COALESCE((SELECT a.null_active_chunk_count
                   FROM _recon_corpus_ambiguous a
                  WHERE a.grade = cs.grade
                    AND a.subject_code = cs.subject_code
                    AND a.chapter_number = cs.chapter_number), 0)
                                      AS null_active_chunk_count
  FROM public.cbse_syllabus cs
  JOIN _recon_trusted_cells t
    ON t.grade = cs.grade AND t.subject_code = cs.subject_code
 WHERE cs.board = 'CBSE'
   AND cs.is_in_scope = TRUE
   AND NOT EXISTS (
     SELECT 1 FROM _recon_corpus c
      WHERE c.grade = cs.grade
        AND c.subject_code = cs.subject_code
        AND c.chapter_number = cs.chapter_number
   );

-- 6a. G3b carve-out — record, do not touch.
INSERT INTO public.cbse_syllabus_corpus_reconciliation_ledger
  (run_id, action, grade, subject_code, chapter_number, syllabus_id,
   title_before, is_in_scope_before, is_in_scope_after, rag_status_before,
   chunk_count_before, corpus_chunk_count, live_question_count, reason)
SELECT
  (SELECT run_id FROM _recon_run),
  'retain_has_questions',
  u.grade, u.subject_code, u.chapter_number, u.syllabus_id,
  u.title_before, u.is_in_scope_before, u.is_in_scope_before,
  u.rag_status_before, u.chunk_count_before, 0, u.live_question_count,
  'G3b carve-out: the corpus does not confirm this chapter, but it carries '
  'live question_bank rows still keyed to the old chapter number (F1 has not '
  'run). Left IN SCOPE deliberately - retiring it would hide content students '
  'are actively served.'
FROM _recon_unconfirmed u
WHERE u.live_question_count > 0;

-- 6a2. G3c carve-out — record, do not touch. Kept as a SEPARATE action from
--      'retain_has_questions' because the cause is completely different
--      (NULL metadata on the chunk rows, not question attachment) and the
--      remediation is different too: these coordinates need someone to decide
--      whether those chunks are live, then backfill is_active.
INSERT INTO public.cbse_syllabus_corpus_reconciliation_ledger
  (run_id, action, grade, subject_code, chapter_number, syllabus_id,
   title_before, is_in_scope_before, is_in_scope_after, rag_status_before,
   chunk_count_before, corpus_chunk_count, live_question_count, reason)
SELECT
  (SELECT run_id FROM _recon_run),
  'retain_ambiguous_chunks',
  u.grade, u.subject_code, u.chapter_number, u.syllabus_id,
  u.title_before, u.is_in_scope_before, u.is_in_scope_before,
  u.rag_status_before, u.chunk_count_before, u.null_active_chunk_count,
  u.live_question_count,
  -- Every literal is joined with an explicit ||. This file cannot be parsed
  -- locally (no Postgres in the authoring environment), so it deliberately
  -- avoids relying on implicit adjacent-string-literal continuation in any
  -- expression that also uses || - the two rules are both valid but reading
  -- them together is exactly where an eyeball review goes wrong.
  'G3c carve-out: this coordinate holds ' || u.null_active_chunk_count
  || ' chunk(s) whose is_active IS NULL. rag_content_chunks.is_active is '
  || 'nullable, so the is_active=true corpus filter drops them and the '
  || 'coordinate reads as corpus-absent. Left IN SCOPE deliberately - the text '
  || 'may well be there. FOLLOW-UP: decide whether those chunks are live and '
  || 'backfill is_active; until then recompute_syllabus_status() will not '
  || 'count them either.'
FROM _recon_unconfirmed u
WHERE u.live_question_count = 0
  AND u.null_active_chunk_count > 0;

-- 6b. Retire the rest: no corpus chunks, no ambiguous chunks, no questions.
WITH flipped AS (
  UPDATE public.cbse_syllabus cs
     SET is_in_scope = FALSE,
         updated_at  = now()
    FROM _recon_unconfirmed u
   WHERE cs.id = u.syllabus_id
     AND u.live_question_count = 0
     AND u.null_active_chunk_count = 0
     AND cs.is_in_scope IS DISTINCT FROM FALSE
  RETURNING cs.id
)
INSERT INTO public.cbse_syllabus_corpus_reconciliation_ledger
  (run_id, action, grade, subject_code, chapter_number, syllabus_id,
   title_before, is_in_scope_before, is_in_scope_after, rag_status_before,
   chunk_count_before, corpus_chunk_count, live_question_count, reason)
SELECT
  (SELECT run_id FROM _recon_run),
  'flip_out_of_scope',
  u.grade, u.subject_code, u.chapter_number, u.syllabus_id,
  u.title_before, u.is_in_scope_before, FALSE,
  u.rag_status_before, u.chunk_count_before, 0, u.live_question_count,
  'The indexed corpus holds no active chunks at this coordinate and no live '
  'questions reference it. Either the chapter was renumbered by the NCERT '
  'edition now in the corpus, or CBSE rationalised it out. Retired via '
  'is_in_scope=FALSE (reversible) - NOT deleted.'
FROM _recon_unconfirmed u
JOIN flipped f ON f.id = u.syllabus_id;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 7 — Recompute status on the CORRECTED coordinates (item #11, half 1)
-- ═══════════════════════════════════════════════════════════════════════════
-- Restricted to TRUSTED cells (G1). Recomputing an untrusted cell would zero
-- its chunk_count and drive every chapter to 'missing' — the catastrophe this
-- migration exists to avoid — so untrusted cells are skipped entirely.
--
-- WHAT THIS SECTION DOES: now that registry coordinates match corpus
-- coordinates, recompute_syllabus_status() finds chunks that were always there
-- and lands honest counts, promoting those rows to 'partial'/'ready'. The
-- function itself is NOT modified.
--
-- ⚠ WHAT THIS SECTION ALSO DOES, AND WHY IT CANNOT SHIP ALONE.
-- recompute_syllabus_status() writes 'missing' whenever chunk_count = 0. This
-- loop is unfiltered by design (every trusted-cell row, so counts are honest
-- everywhere), which means it ALSO drives to 'missing' every row that is
-- sitting at 'partial' today with zero chunks — including the rows
-- 20260621000700 deliberately promoted on 2026-06-21 precisely so that
-- chapters WITH QUESTIONS would stop being hidden. Those rows are reachable
-- today; the 2026-06-24 manifest's ON CONFLICT DO NOTHING could not have
-- un-promoted them (see the corrected #11 note in the header — an earlier
-- draft of this file argued the opposite and was wrong).
--
-- So Section 7 in isolation would hide chapters that have questions: the exact
-- defect item #11 exists to remove, re-introduced at ~800-coordinate scale.
-- Section 7b immediately below is not an optional refinement — it is the other
-- half of this operation, and Section 11 refuses to commit if the pair failed
-- to preserve reachability. Do not reorder, gate, or delete 7b.

DO $$
DECLARE
  v_coord  record;
  v_count  int := 0;
BEGIN
  FOR v_coord IN
    SELECT cs.grade, cs.subject_code, cs.chapter_number
      FROM public.cbse_syllabus cs
      JOIN _recon_trusted_cells t
        ON t.grade = cs.grade AND t.subject_code = cs.subject_code
     WHERE cs.board = 'CBSE'
     ORDER BY cs.grade, cs.subject_code, cs.chapter_number
  LOOP
    PERFORM public.recompute_syllabus_status(
      v_coord.grade, v_coord.subject_code, v_coord.chapter_number);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'cbse_syllabus corpus reconciliation: recomputed % coordinates across % trusted cells.',
    v_count, (SELECT count(*) FROM _recon_trusted_cells);
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 7b — Status non-regression + re-applied promotion (item #11, half 2)
-- ═══════════════════════════════════════════════════════════════════════════
-- G8. This is the section that makes G3b mean what it claims and delivers the
-- half of item #11 that is about NOT HIDING chapters. It runs immediately
-- after the recompute, inside the same transaction, and touches ONE column:
-- rag_status. It never touches is_in_scope, never touches chunk_count, never
-- touches a title, and never touches a row outside a trusted cell.
--
-- TRIGGER CHECK (non-obvious, and a silent title regression if wrong):
-- trg_cbse_syllabus_normalize_display is BEFORE INSERT OR UPDATE **OF**
-- (subject_display, subject_display_hi, chapter_title, chapter_title_hi,
-- subject_code, grade, chapter_number). An UPDATE that sets only rag_status
-- and updated_at is outside that column list, so the trigger does NOT fire and
-- cannot re-enter its public.chapters catalog block — the same block Sections
-- 4 and 5 go to such lengths to suppress, because that catalog carries the
-- legacy numbering this migration is correcting (G5). The same reasoning is
-- why Section 7 is safe: recompute_syllabus_status() writes chunk_count,
-- verified_question_count, rag_status, last_verified_at and updated_at, none
-- of which are in the trigger's column list either.
--
-- Two branches, in this order (order matters: 7b.1 first means 7b.2 can only
-- ever see rows that were genuinely 'missing' before the migration too):
--
--   7b.1 PRESERVE — pure non-regression. A row that was REACHABLE before this
--        migration (is_in_scope AND rag_status IN ('partial','ready')) and
--        carries live questions gets its EXACT pre-migration rag_status back if
--        the recompute pushed it to 'missing'. Before-value = after-value, so
--        this is net-zero against the state the run started in; it repairs
--        damage this migration itself did, nothing else.
--        It deliberately restores the exact prior value rather than clamping
--        'ready' down to 'partial': making rag_status more honest is item #14's
--        job and is delivered ADDITIVELY by text_coverage_status (Section 8),
--        which will read 'missing' for these zero-chunk rows and tell the truth
--        without changing what the picker does. One variable at a time.
--
--   7b.2 PROMOTE — re-applies 20260621000700's rule ('missing' -> 'partial'
--        where verified questions exist), restricted to trusted cells. This is
--        not new policy: it is an already-shipped, CEO-approved rule that this
--        migration's recompute would otherwise wipe out, and that has in any
--        case been eroding on its own since 2026-06-21 (see F4 — the
--        question_bank recompute trigger silently self-reverts it). Predicate
--        copied from that migration exactly, including its use of
--        verification_state='verified' rather than verified_against_ncert.
--
-- INVARIANT WORTH NAMING: every row either branch can see has chunk_count = 0,
-- because after Section 7 a row reads 'missing' if and only if the recompute
-- counted zero active chunks at its coordinate. So neither branch can ever
-- contradict a non-zero corpus count.
--
--   7b.3 records the NET rag_status change of Sections 7+7b for every other
--        trusted-cell row, which is what finally makes the recompute
--        reversible (before 2026-08-14 nothing recorded it and the documented
--        rollback silently could not undo Section 7).

-- 7b.1 PRESERVE ─────────────────────────────────────────────────────────────
WITH preserved AS (
  UPDATE public.cbse_syllabus cs
     SET rag_status = s.rag_status_before,
         updated_at = now()
    FROM _recon_pre_status s
   WHERE cs.id = s.syllabus_id
     AND s.was_reachable                -- reachable BEFORE this migration
     AND s.live_question_count > 0      -- and actually serves questions
     AND cs.is_in_scope = TRUE          -- still in scope (G3b kept it there)
     AND cs.rag_status = 'missing'      -- the Section 7 recompute took it away
     AND cs.rag_status IS DISTINCT FROM s.rag_status_before
  RETURNING cs.id
)
INSERT INTO public.cbse_syllabus_corpus_reconciliation_ledger
  (run_id, action, board, grade, subject_code, chapter_number, syllabus_id,
   title_before, rag_status_before, rag_status_after, chunk_count_before,
   corpus_chunk_count, live_question_count, reason)
SELECT
  (SELECT run_id FROM _recon_run),
  'rag_status_preserved',
  s.board, s.grade, s.subject_code, s.chapter_number, s.syllabus_id,
  s.chapter_title,
  s.rag_status_before,
  s.rag_status_before,   -- restored to exactly what it was: net-zero
  s.chunk_count_before,
  0,                     -- zero active corpus chunks here, by the invariant above
  s.live_question_count,
  'G8 non-regression: this chapter was reachable in the /quiz picker before '
  || 'the migration and carries ' || s.live_question_count
  || ' live question(s), but the Section 7 recompute set rag_status=''missing'' '
  || 'because the corpus holds no active chunks at its coordinate. rag_status '
  || 'restored to its pre-migration value. G3b kept is_in_scope=TRUE; this '
  || 'keeps the other half of the picker''s condition. The honest content '
  || 'signal for this row is text_coverage_status=''missing'' (Section 8), '
  || 'which is where the zero-chunk fact is now reported.'
FROM _recon_pre_status s
JOIN preserved p ON p.id = s.syllabus_id;

-- 7b.2 PROMOTE (re-application of 20260621000700, trusted cells only) ───────
WITH promoted AS (
  UPDATE public.cbse_syllabus cs
     SET rag_status = 'partial',
         updated_at = now()
    FROM _recon_pre_status s
   WHERE cs.id = s.syllabus_id
     AND s.board = 'CBSE'          -- 20260621000700's own board predicate
     AND cs.is_in_scope = TRUE
     AND cs.rag_status = 'missing'
     AND s.verified_question_count > 0
  RETURNING cs.id
)
INSERT INTO public.cbse_syllabus_corpus_reconciliation_ledger
  (run_id, action, board, grade, subject_code, chapter_number, syllabus_id,
   title_before, rag_status_before, rag_status_after, chunk_count_before,
   corpus_chunk_count, live_question_count, reason)
SELECT
  (SELECT run_id FROM _recon_run),
  'rag_status_promoted',
  s.board, s.grade, s.subject_code, s.chapter_number, s.syllabus_id,
  s.chapter_title,
  s.rag_status_before,   -- necessarily 'missing' here; recorded, not assumed
  'partial',
  s.chunk_count_before,
  0,
  s.live_question_count,
  'Re-applies migration 20260621000700 (RCA 2026-06-21) inside the trusted '
  || 'cells: ' || s.verified_question_count
  || ' verified question(s) exist at this coordinate, so the chapter is '
  || 'promoted ''missing'' -> ''partial'' and becomes reachable in the /quiz '
  || 'picker. This is the rule item #11 asks for - stop hiding chapters that '
  || 'have questions - not a new policy. NOTE (F4): the question_bank '
  || 'recompute trigger will undo this again the next time anyone writes a '
  || 'question row at this coordinate; that is a pre-existing platform bug '
  || 'with its own ticket, not something this migration can close.'
FROM _recon_pre_status s
JOIN promoted p ON p.id = s.syllabus_id;

-- 7b.3 RECORD every remaining NET rag_status change (rollback source) ───────
-- Rows already ledgered by 7b.1/7b.2 are excluded: 7b.1 rows are net-zero and
-- 7b.2 rows already carry their own before/after pair.
INSERT INTO public.cbse_syllabus_corpus_reconciliation_ledger
  (run_id, action, board, grade, subject_code, chapter_number, syllabus_id,
   title_before, rag_status_before, rag_status_after, chunk_count_before,
   corpus_chunk_count, live_question_count, reason)
SELECT
  (SELECT run_id FROM _recon_run),
  'rag_status_recomputed',
  s.board, s.grade, s.subject_code, s.chapter_number, s.syllabus_id,
  s.chapter_title,
  s.rag_status_before,
  cs.rag_status,
  s.chunk_count_before,
  cs.chunk_count,
  s.live_question_count,
  'Section 7 recompute changed this row''s rag_status on the corrected '
  || 'coordinates (chunk_count ' || s.chunk_count_before || ' -> '
  || cs.chunk_count || '). Recorded so the recompute is reversible: rollback '
  || 'sets rag_status back to rag_status_before. Rows here carry zero live '
  || 'questions whenever the direction is downward - G8 plus the Section 11 A1 '
  || 'assertion make that a guarantee, not a hope.'
FROM _recon_pre_status s
JOIN public.cbse_syllabus cs ON cs.id = s.syllabus_id
WHERE cs.rag_status IS DISTINCT FROM s.rag_status_before
  AND NOT EXISTS (
    SELECT 1 FROM public.cbse_syllabus_corpus_reconciliation_ledger l
     WHERE l.run_id = (SELECT run_id FROM _recon_run)
       AND l.syllabus_id = s.syllabus_id
       AND l.action IN ('rag_status_preserved', 'rag_status_promoted')
  );

DO $$
DECLARE
  v_run uuid;
BEGIN
  SELECT run_id INTO v_run FROM _recon_run;

  RAISE NOTICE 'cbse_syllabus corpus reconciliation 7b: % preserved, % promoted, % net-recomputed.',
    (SELECT count(*) FROM public.cbse_syllabus_corpus_reconciliation_ledger
      WHERE run_id = v_run AND action = 'rag_status_preserved'),
    (SELECT count(*) FROM public.cbse_syllabus_corpus_reconciliation_ledger
      WHERE run_id = v_run AND action = 'rag_status_promoted'),
    (SELECT count(*) FROM public.cbse_syllabus_corpus_reconciliation_ledger
      WHERE run_id = v_run AND action = 'rag_status_recomputed');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 8 — Item #14: separate CONTENT readiness from QUIZ verification
-- ═══════════════════════════════════════════════════════════════════════════
-- rag_status answers TWO questions at once and therefore answers neither:
--   chunk_count             → "do we have the NCERT text?"      (content)
--   verified_question_count → "are the quizzes verified?"        (assessment)
-- A chapter with 400 perfect chunks and zero verified quizzes reads 'partial'
-- and is reported as a CONTENT gap by ingestion_gaps. text_coverage_status answers
-- the content question ALONE.
--
-- Implemented as a STORED GENERATED column rather than a trigger or a nightly
-- job so it can never drift from chunk_count: Postgres maintains it on every
-- write, including writes by recompute_syllabus_status(), forever, with no
-- code path able to forget it.
--
-- The 50 threshold mirrors MIN_CHUNKS_FOR_READY in
-- supabase/functions/grounded-answer/config.ts:4 — the same bar the live
-- strict-mode coverage precheck uses since the 2026-08-01 serving-side fix.
-- A generation expression must be immutable, so the literal cannot be sourced
-- from a config table; if MIN_CHUNKS_FOR_READY changes, this column must be
-- changed in the same PR. The drift canary in Section 9 does not enforce that
-- coupling — testing owns a literal-parity test for it (same pattern as the
-- REG-48 SQL/TS XP literal parity check).
--
-- ADDITIVE ONLY: rag_status is untouched, recompute_syllabus_status() is
-- untouched, ingestion_gaps is untouched, and the chapter picker is untouched.

ALTER TABLE public.cbse_syllabus
  ADD COLUMN IF NOT EXISTS text_coverage_status TEXT
  GENERATED ALWAYS AS (
    CASE
      WHEN chunk_count <= 0  THEN 'missing'      -- no NCERT text at all
      WHEN chunk_count <  50 THEN 'thin'         -- some text, below serving bar
      ELSE                        'sufficient'   -- enough text to ground answers
    END
  ) STORED;

COMMENT ON COLUMN public.cbse_syllabus.text_coverage_status IS
  'CONTENT-ONLY readiness, derived from chunk_count alone: missing (0) / thin '
  '(<50) / sufficient (>=50). Deliberately independent of '
  'verified_question_count. rag_status conflates NCERT-text availability with '
  'quiz-verification maturity, which produced the 2026-07-27 self-confirming '
  'deadlock (zero rag_status=ready rows in production) fixed serving-side on '
  '2026-08-01 while the reporting surface was knowingly left conflated '
  '(supabase/functions/grounded-answer/coverage.ts:78-87). The 50 bar mirrors '
  'MIN_CHUNKS_FOR_READY (grounded-answer/config.ts:4). Added by 20260814000013.';

-- Content-only gap read model. Deliberately a SEPARATE view from
-- ingestion_gaps (which stays exactly as it is, keyed on rag_status) so
-- existing consumers are unaffected and the two signals can be compared
-- side by side during the F3 dashboard migration.
CREATE OR REPLACE VIEW public.content_coverage_gaps
WITH (security_invoker = true) AS
SELECT
  cs.board,
  cs.grade,
  cs.subject_code,
  cs.subject_display,
  cs.chapter_number,
  cs.chapter_title,
  cs.chunk_count,
  cs.text_coverage_status,
  cs.rag_status,
  cs.verified_question_count,
  cs.last_verified_at,
  -- The honest gap classification: a CONTENT gap is about text, full stop.
  CASE
    WHEN cs.text_coverage_status = 'missing' THEN 'critical'
    WHEN cs.text_coverage_status = 'thin' AND cs.chunk_count < 10 THEN 'high'
    ELSE 'medium'
  END AS content_severity,
  -- Explicitly names the rows ingestion_gaps mislabels as content gaps.
  (cs.text_coverage_status = 'sufficient' AND cs.rag_status <> 'ready')
    AS misreported_by_ingestion_gaps
FROM public.cbse_syllabus cs
WHERE cs.is_in_scope = TRUE
  AND cs.text_coverage_status <> 'sufficient';

COMMENT ON VIEW public.content_coverage_gaps IS
  'GENUINE content gaps: in-scope chapters whose NCERT text is missing or thin, '
  'judged on chunk_count ALONE. Companion to (not replacement for) '
  'ingestion_gaps, which keys on rag_status and therefore also flags chapters '
  'that have plenty of text but unverified quizzes. '
  'misreported_by_ingestion_gaps names exactly those rows. '
  'security_invoker=true - caller RLS on cbse_syllabus applies (P8). '
  'Added by 20260814000013.';

GRANT SELECT ON public.content_coverage_gaps TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 9 — Drift canary (assessment request)
-- ═══════════════════════════════════════════════════════════════════════════
-- Asserts, in both directions, that the registry and the corpus agree on
-- coordinates. This is what makes the defect unable to recur silently:
--   registry_without_corpus — an in-scope chapter with zero indexed chunks
--   corpus_without_registry — indexed chunks nobody can reach, because no
--                             registry row exists at that coordinate
-- The second direction is the one that hid ~the whole defect for two months:
-- nothing in the platform looked for content that had no registry row.

CREATE OR REPLACE VIEW public.syllabus_corpus_drift
WITH (security_invoker = true) AS
-- Direction 1: registry row, no corpus.
SELECT
  'registry_without_corpus'::text AS drift_kind,
  cs.board,
  cs.grade,
  cs.subject_code,
  cs.chapter_number,
  cs.chapter_title,
  cs.rag_status,
  cs.text_coverage_status,
  cs.chunk_count                  AS registry_chunk_count,
  0::bigint                       AS corpus_chunk_count
FROM public.cbse_syllabus cs
WHERE cs.is_in_scope = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.rag_content_chunks r
     WHERE r.is_active = true
       AND r.grade_short    = cs.grade
       AND r.subject_code   = cs.subject_code
       AND r.chapter_number = cs.chapter_number
  )
UNION ALL
-- Direction 2: corpus content, no registry row → unreachable content.
SELECT
  'corpus_without_registry'::text AS drift_kind,
  'CBSE'::text                    AS board,
  r.grade_short                   AS grade,
  r.subject_code,
  r.chapter_number,
  NULL::text                      AS chapter_title,
  NULL::text                      AS rag_status,
  NULL::text                      AS text_coverage_status,
  0                               AS registry_chunk_count,
  count(*)                        AS corpus_chunk_count
FROM public.rag_content_chunks r
WHERE r.is_active = true
  AND r.grade_short    IS NOT NULL
  AND r.subject_code   IS NOT NULL
  AND r.chapter_number IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.cbse_syllabus cs
     WHERE cs.board = 'CBSE'
       AND cs.grade = r.grade_short
       AND cs.subject_code = r.subject_code
       AND cs.chapter_number = r.chapter_number
  )
GROUP BY r.grade_short, r.subject_code, r.chapter_number;

COMMENT ON VIEW public.syllabus_corpus_drift IS
  'Drift canary for the 2026-08-14 SEV1: every coordinate where cbse_syllabus '
  'and rag_content_chunks disagree, in BOTH directions. '
  'registry_without_corpus = an in-scope chapter with no indexed text. '
  'corpus_without_registry = indexed text no surface can reach because no '
  'registry row exists at that coordinate - the direction nothing checked for, '
  'which is why the manifest/corpus numbering split went unnoticed. Covers all '
  'subjects, not just the keep-set. security_invoker=true (P8). '
  'Added by 20260814000013.';

GRANT SELECT ON public.syllabus_corpus_drift TO service_role;

-- Machine-readable assertion for the nightly canary / integration test.
-- SECURITY INVOKER (default) - reads only curriculum tables, no PII, so no
-- DEFINER escalation is needed or granted.
CREATE OR REPLACE FUNCTION public.assert_syllabus_corpus_alignment()
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH keep(grade, subject_code) AS (
    SELECT g.grade, s.code
      FROM (VALUES ('6'),('7'),('8'),('9'),('10')) AS g(grade)
     CROSS JOIN (VALUES ('math'),('science')) AS s(code)
    UNION ALL
    SELECT g.grade, s.code
      FROM (VALUES ('11'),('12')) AS g(grade)
     CROSS JOIN (VALUES ('math'),('physics'),('chemistry'),('biology')) AS s(code)
  ),
  d AS (
    SELECT sd.*
      FROM public.syllabus_corpus_drift sd
      JOIN keep k ON k.grade = sd.grade AND k.subject_code = sd.subject_code
  )
  SELECT jsonb_build_object(
    'checked_at', now(),
    'scope', 'CEO keep-set: g6-10 math+science, g11-12 math+physics+chemistry+biology',
    'registry_without_corpus', (SELECT count(*) FROM d WHERE drift_kind = 'registry_without_corpus'),
    'corpus_without_registry', (SELECT count(*) FROM d WHERE drift_kind = 'corpus_without_registry'),
    'aligned', (SELECT count(*) FROM d) = 0,
    'offenders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'drift_kind', drift_kind, 'grade', grade,
               'subject_code', subject_code, 'chapter_number', chapter_number,
               'corpus_chunk_count', corpus_chunk_count))
        FROM (SELECT * FROM d ORDER BY grade, subject_code, chapter_number LIMIT 200) x
    ), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION public.assert_syllabus_corpus_alignment() IS
  'Drift canary assertion over the CEO keep-set. aligned=true means every '
  'in-scope cbse_syllabus row has at least one matching active '
  'rag_content_chunks row AND no indexed corpus coordinate lacks a registry '
  'row. Intended for the nightly cron and the integration lane so the '
  '2026-08-14 SEV1 cannot recur silently. Added by 20260814000013.';

REVOKE ALL ON FUNCTION public.assert_syllabus_corpus_alignment() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_syllabus_corpus_alignment() TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 10 — Summary audit row (written only when something changed)
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO public.admin_audit_log
  (admin_id, action, entity_type, entity_id, details, created_at)
SELECT
  NULL,
  'cbse_syllabus.corpus_reconciled_math_science',
  'system',
  NULL,
  jsonb_build_object(
    'migration', '20260814000013_cbse_syllabus_corpus_reconciliation_math_science',
    'run_id',    (SELECT run_id FROM _recon_run),
    'applied_at', now(),
    'scope', jsonb_build_object(
      'grades_6_10', ARRAY['math','science'],
      'grades_11_12', ARRAY['math','physics','chemistry','biology']),
    'guards', jsonb_build_object(
      'min_cell_chapters', (SELECT min_cell_chapters FROM _recon_const),
      'min_cell_chunks',   (SELECT min_cell_chunks   FROM _recon_const),
      'max_chapter_number',(SELECT max_chapter_number FROM _recon_const)),
    'cells_trusted', (SELECT count(*) FROM _recon_trusted_cells),
    'cells_skipped_untrusted', (
      SELECT count(*) FROM public.cbse_syllabus_corpus_reconciliation_ledger
       WHERE run_id = (SELECT run_id FROM _recon_run) AND action = 'cell_skipped_untrusted'),
    'chapters_inserted', (
      SELECT count(*) FROM public.cbse_syllabus_corpus_reconciliation_ledger
       WHERE run_id = (SELECT run_id FROM _recon_run) AND action = 'insert_chapter'),
    'chapters_retired', (
      SELECT count(*) FROM public.cbse_syllabus_corpus_reconciliation_ledger
       WHERE run_id = (SELECT run_id FROM _recon_run) AND action = 'flip_out_of_scope'),
    'chapters_retained_with_questions', (
      SELECT count(*) FROM public.cbse_syllabus_corpus_reconciliation_ledger
       WHERE run_id = (SELECT run_id FROM _recon_run) AND action = 'retain_has_questions'),
    'chapters_retained_ambiguous_chunks', (
      SELECT count(*) FROM public.cbse_syllabus_corpus_reconciliation_ledger
       WHERE run_id = (SELECT run_id FROM _recon_run) AND action = 'retain_ambiguous_chunks'),
    'titles_upgraded', (
      SELECT count(*) FROM public.cbse_syllabus_corpus_reconciliation_ledger
       WHERE run_id = (SELECT run_id FROM _recon_run) AND action = 'title_upgrade'),
    -- G8 / Sections 7 + 7b. status_preserved is the count of chapters that
    -- WOULD have been hidden by the recompute and were not.
    'status_preserved', (
      SELECT count(*) FROM public.cbse_syllabus_corpus_reconciliation_ledger
       WHERE run_id = (SELECT run_id FROM _recon_run) AND action = 'rag_status_preserved'),
    'status_promoted', (
      SELECT count(*) FROM public.cbse_syllabus_corpus_reconciliation_ledger
       WHERE run_id = (SELECT run_id FROM _recon_run) AND action = 'rag_status_promoted'),
    'status_recomputed', (
      SELECT count(*) FROM public.cbse_syllabus_corpus_reconciliation_ledger
       WHERE run_id = (SELECT run_id FROM _recon_run) AND action = 'rag_status_recomputed'),
    -- Per-cell picker reachability, before vs after, for every trusted cell.
    -- This is the number a human actually cares about: how many chapters can a
    -- student in that grade/subject pick? Recorded because MAJOR #4 of the
    -- 2026-08-14 quality review found a cell could go 16 -> 3 reachable
    -- chapters and pass every assertion in this file silently. It cannot now:
    -- the drop is asserted on (Section 11) and recorded here.
    'reachability_by_cell', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'grade')::int, x->>'subject_code')
        FROM (
          SELECT jsonb_build_object(
                   'grade', t.grade,
                   'subject_code', t.subject_code,
                   'reachable_before', (
                     SELECT count(*) FROM _recon_pre_status s
                      WHERE s.board = 'CBSE'
                        AND s.grade = t.grade AND s.subject_code = t.subject_code
                        AND s.was_reachable),
                   'reachable_after', (
                     SELECT count(*) FROM public.cbse_syllabus cs
                      WHERE cs.board = 'CBSE' AND cs.grade = t.grade
                        AND cs.subject_code = t.subject_code
                        AND cs.is_in_scope = TRUE
                        AND cs.rag_status IN ('partial','ready'))
                 ) AS x
            FROM _recon_trusted_cells t
        ) y
    ), '[]'::jsonb),
    -- 'offenders'::text is cast explicitly: both `jsonb - text` and
    -- `jsonb - integer` exist, so an untyped literal is ambiguous.
    'alignment_after', public.assert_syllabus_corpus_alignment() - 'offenders'::text,
    'not_done_here', jsonb_build_array(
      'F1 question_bank.chapter_number remap (assessment-owned, separate migration)',
      'F2 human title pass for rows left at "Chapter N (title unverified)"',
      'F3 repoint ingestion_gaps / Grounding Coverage dashboard onto text_coverage_status')
  ),
  now()
-- Gated on the CHANGE actions only. 'cell_skipped_untrusted',
-- 'retain_has_questions' and 'retain_ambiguous_chunks' are observations that
-- write nothing to cbse_syllabus, and 'rag_status_preserved' is a net-zero
-- repair of damage done earlier in the same transaction (before-value =
-- after-value). A run that produced only those is a genuine no-op and must not
-- create a second rollback record.
WHERE EXISTS (
  SELECT 1 FROM public.cbse_syllabus_corpus_reconciliation_ledger
   WHERE run_id = (SELECT run_id FROM _recon_run)
     AND action IN ('insert_chapter', 'flip_out_of_scope', 'title_upgrade',
                    'rag_status_promoted', 'rag_status_recomputed')
);

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 11 — Post-condition assertions (fail the migration, not the students)
-- ═══════════════════════════════════════════════════════════════════════════
-- Three assertions, in increasing order of subtlety:
--   A1  per-ROW  — the G8 invariant. No chapter that was reachable and has
--                  live questions may have become unreachable. HARD ABORT.
--   A2  per-CELL — no trusted cell may be left with zero in-scope chapters
--                  (original assertion) OR zero REACHABLE chapters (new: the
--                  original tested is_in_scope only and could not see a cell
--                  whose every chapter had been recomputed to 'missing').
--   A3  per-CELL — any cell whose reachable count DROPPED is reported loudly.
--                  Deliberately a NOTICE, not an abort: A1 already proves that
--                  every chapter lost this way has zero chunks AND zero live
--                  questions, i.e. it would hand the student an empty quiz, and
--                  hiding those is the intended behaviour. An abort here would
--                  make the migration permanently un-appliable on legitimate
--                  data with no override. The count is also written to the
--                  audit row (reachability_by_cell) and is predictable ahead of
--                  time from §E/§E2 of the dry-run companion.
DO $$
DECLARE
  v_empty_cell   text;
  v_dark_cell    text;
  v_regressed    text;
  v_regressed_n  int;
  v_dropped      record;
  v_trusted      int;
  v_msg          text;
BEGIN
  SELECT count(*) INTO v_trusted FROM _recon_trusted_cells;

  -- ── A1. THE G8 INVARIANT (hard abort) ────────────────────────────────────
  -- Every row that (a) was reachable by the picker's exact conjunction before
  -- this migration and (b) carries live questions MUST still satisfy that same
  -- conjunction now. This is the assertion Blockers #1 and #2 of the
  -- 2026-08-14 quality review would have tripped: with Section 7b removed, the
  -- rows 20260621000700 promoted (chunk_count=0, rag_status='partial', live
  -- questions) land here and abort the migration instead of silently
  -- disappearing from the chapter picker.
  SELECT count(*),
         string_agg(s.board || ' ' || s.grade || '/' || s.subject_code
                    || '/ch' || s.chapter_number
                    || ' (' || s.rag_status_before || '->' || cs.rag_status
                    || ', in_scope ' || s.is_in_scope_before || '->' || cs.is_in_scope
                    || ', ' || s.live_question_count || ' live q)', '; '
                    ORDER BY s.grade, s.subject_code, s.chapter_number)
    INTO v_regressed_n, v_regressed
    FROM _recon_pre_status s
    JOIN public.cbse_syllabus cs ON cs.id = s.syllabus_id
   WHERE s.was_reachable
     AND s.live_question_count > 0
     AND NOT (cs.is_in_scope = TRUE AND cs.rag_status IN ('partial','ready'));

  IF COALESCE(v_regressed_n, 0) > 0 THEN
    v_msg := 'ABORT (G8 status non-regression): ' || v_regressed_n || ' chapter(s) that a '
          || 'student could pick BEFORE this migration, and that carry live question_bank '
          || 'rows, would no longer be reachable AFTER it. The /quiz picker requires BOTH '
          || 'is_in_scope=TRUE AND rag_status IN (partial,ready) - losing either one hides '
          || 'the chapter. Offenders: ' || left(v_regressed, 3000)
          || '. Rolling back the entire migration.';
    RAISE EXCEPTION '%', v_msg;
  END IF;

  -- ── A2a. No trusted cell may be left with ZERO in-scope chapters ─────────
  SELECT string_agg(t.grade || '/' || t.subject_code, ', ')
    INTO v_empty_cell
    FROM _recon_trusted_cells t
   WHERE NOT EXISTS (
     SELECT 1 FROM public.cbse_syllabus cs
      WHERE cs.board = 'CBSE'
        AND cs.grade = t.grade
        AND cs.subject_code = t.subject_code
        AND cs.is_in_scope = TRUE
   );

  IF v_empty_cell IS NOT NULL THEN
    v_msg := 'ABORT: reconciliation would leave these grade/subject cells with ZERO in-scope '
          || 'chapters: ' || v_empty_cell || '. That blanks the curriculum for every student '
          || 'in those grades. Rolling back the entire migration.';
    RAISE EXCEPTION '%', v_msg;
  END IF;

  -- ── A2b. No trusted cell may be left with ZERO REACHABLE chapters ────────
  -- is_in_scope alone is not what the student sees. A cell can keep every row
  -- in scope and still present an EMPTY chapter picker if the recompute drove
  -- them all to 'missing' - which is precisely the failure mode A2a could not
  -- detect (MAJOR #4, 2026-08-14 quality review).
  -- A trusted cell has >= 3 corpus-confirmed coordinates with >= 50 chunks
  -- between them (G1), and Section 4 creates a row at any coordinate lacking
  -- one, so the recompute normally leaves >= 3 chapters at 'partial' or better
  -- and this cannot fire. The one non-bug way it CAN fire: every
  -- corpus-confirmed coordinate in the cell already has a row that was
  -- is_in_scope=FALSE before this migration ran. This file never un-retires a
  -- row (that would be a scope decision nobody has reviewed), so it would
  -- rightly stop and ask for a human rather than half-fix the cell.
  SELECT string_agg(t.grade || '/' || t.subject_code, ', ')
    INTO v_dark_cell
    FROM _recon_trusted_cells t
   WHERE NOT EXISTS (
     SELECT 1 FROM public.cbse_syllabus cs
      WHERE cs.board = 'CBSE'
        AND cs.grade = t.grade
        AND cs.subject_code = t.subject_code
        AND cs.is_in_scope = TRUE
        AND cs.rag_status IN ('partial','ready')
   );

  IF v_dark_cell IS NOT NULL THEN
    v_msg := 'ABORT: reconciliation would leave these grade/subject cells with ZERO chapters '
          || 'REACHABLE in the /quiz picker (is_in_scope AND rag_status IN (partial,ready)): '
          || v_dark_cell || '. Rows may still be in scope, but the student sees an empty '
          || 'chapter list, which is the same outage from their side. Rolling back the '
          || 'entire migration.';
    RAISE EXCEPTION '%', v_msg;
  END IF;

  -- ── A3. Loud report of any cell that lost reachable chapters (no abort) ──
  FOR v_dropped IN
    SELECT t.grade,
           t.subject_code,
           (SELECT count(*) FROM _recon_pre_status s
             WHERE s.board = 'CBSE'
               AND s.grade = t.grade AND s.subject_code = t.subject_code
               AND s.was_reachable)                       AS before_n,
           (SELECT count(*) FROM public.cbse_syllabus cs
             WHERE cs.board = 'CBSE' AND cs.grade = t.grade
               AND cs.subject_code = t.subject_code
               AND cs.is_in_scope = TRUE
               AND cs.rag_status IN ('partial','ready'))   AS after_n
      FROM _recon_trusted_cells t
     ORDER BY t.grade, t.subject_code
  LOOP
    IF v_dropped.after_n < v_dropped.before_n THEN
      RAISE NOTICE
        'REACHABILITY DROP %/%: % -> % chapters pickable. A1 passed, so every chapter lost here has ZERO active NCERT chunks AND ZERO live questions (an empty quiz). Cross-check against dry-run section E before accepting.',
        v_dropped.grade, v_dropped.subject_code, v_dropped.before_n, v_dropped.after_n;
    ELSE
      RAISE NOTICE 'reachability %/%: % -> % chapters pickable.',
        v_dropped.grade, v_dropped.subject_code, v_dropped.before_n, v_dropped.after_n;
    END IF;
  END LOOP;

  IF v_trusted = 0 THEN
    v_msg := 'cbse_syllabus corpus reconciliation: ZERO cells cleared the G1 trust floors - '
          || 'every keep-set cell was skipped and NOTHING was changed. This is the '
          || 'fail-closed path, not success. Investigate whether '
          || 'rag_content_chunks.grade_short/subject_code are populated at all (legacy '
          || 'ingester risk) before re-running.';
    RAISE NOTICE '%', v_msg;
  END IF;
END $$;

COMMIT;
