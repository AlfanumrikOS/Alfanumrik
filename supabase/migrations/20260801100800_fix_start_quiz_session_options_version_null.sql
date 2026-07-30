-- Migration: 20260801100800_fix_start_quiz_session_options_version_null.sql
-- Purpose: P0 fix — start_quiz_session() has been unable to insert ANY row
--          into quiz_session_shuffles since 2026-05-04. Every call fails
--          with: null value in column "options_version_at_serve" of
--          relation "quiz_session_shuffles" violates not-null constraint.
--
-- ─── Root cause (verified via migration-chain archaeology + prod query) ─────
--
--   1. Migration `20260430000000_quiz_phase_c_options_versioning.sql`
--      ("Phase C") added question_bank.options_version, added
--      quiz_session_shuffles.options_version_at_serve + integrity_hash
--      (both nullable), and CREATE OR REPLACE'd start_quiz_session() to
--      populate both new columns on INSERT.
--
--   2. The 2026-05-03 "Section 10" cleanup replaced the entire pre-baseline
--      migration chain with a single pg_dump-derived snapshot,
--      `00000000000000_baseline_from_prod.sql`, and archived every migration
--      it superseded (including Phase C) under `_legacy/timestamped/`, on
--      the assumption the dump reflected everything those migrations did.
--
--   3. That assumption was false for Phase C specifically. The baseline's
--      start_quiz_session body (verified by reading the baseline file
--      directly) is byte-for-byte the PHASE A version — its own COMMENT ON
--      FUNCTION says "P0 fix (migration 20260428160000)", not Phase C — and
--      its INSERT INTO quiz_session_shuffles does not mention
--      options_version_at_serve or integrity_hash at all. The baseline's
--      quiz_session_shuffles table definition likewise has neither column,
--      and question_bank.options_version does not exist anywhere in the
--      current (non-_legacy) migration chain. In short: Phase C's function
--      changes never made it into the schema this repo now builds from —
--      only its archived migration file's *description* survived.
--
--   4. One day later, `20260504100500_backfill_quiz_shuffles_integrity.sql`
--      ran on top of the baseline. It defensively `ADD COLUMN IF NOT
--      EXISTS`'d options_version_at_serve and integrity_hash (correctly
--      detecting they were missing post-baseline), backfilled existing rows,
--      and set both NOT NULL — but its own text explicitly says
--      "start_quiz_session logic (already populates both fields for new
--      rows)" and "question_bank.options_version (already NOT NULL DEFAULT 1
--      from Phase C)". Both statements were incorrect for the schema that
--      migration was actually running against: Phase C's function body was
--      never re-applied, and question_bank.options_version was never
--      created. The migration tightened a constraint on a column its own
--      producer function does not populate.
--
--   5. Net effect since 2026-05-04: start_quiz_session() INSERTs have
--      violated the options_version_at_serve NOT NULL constraint on every
--      call (integrity_hash is the SAME kind of gap — also NOT NULL, also
--      unpopulated by the deployed function — and would fail next had this
--      migration fixed only the first column). Empirically confirmed:
--      quiz_session_shuffles has exactly 5 rows, all dated 2026-05-04 (the
--      day the NOT NULL constraint landed); zero rows since.
--
-- ─── Blast radius (verified, not inferred) ───────────────────────────────────
--
--   start_quiz_session is called from FOUR call sites, all hitting this bug
--   in production since 2026-05-04:
--     - apps/host/src/app/(student)/quiz/page.tsx (the LIVE web quiz page,
--       via packages/lib/src/supabase.ts:startQuizSession) — every student
--       quiz on the web.
--     - apps/host/src/app/api/v2/quiz/start/route.ts — the v2 API route.
--     - apps/host/src/app/api/whatsapp/_lib/daily6.ts — the new WhatsApp
--       Daily-6 bot (where this was caught).
--     - mobile/lib/data/repositories/quiz_repository.dart — Flutter app.
--
--   The web path DEGRADES SILENTLY: startQuizSession() catches the RPC
--   error and returns null; the quiz page falls back to legacy client-side
--   shuffle + v1 scoring (serverSessionId stays null). This is why
--   quiz_sessions (plural — the v1/legacy results table) shows continuous
--   activity through 2026-07-29: real quizzes ARE being taken and scored,
--   just via the pre-P0-fix path, silently, for ~3 months. The Phase A/B/C
--   server-shuffle-authority + tamper-detection protections (P1/P6) have
--   been inert in production the entire time with no error surfaced to
--   users or, until this WhatsApp E2E test, to operators.
--
--   The WhatsApp bot path has NO fallback (daily6.ts:735-738 just returns
--   'retry' on RPC error) — this is a hard, total block, not a silent
--   degrade, which is how this was caught.
--
-- ─── This fix ─────────────────────────────────────────────────────────────
--
--   CREATE OR REPLACE start_quiz_session(), preserving the deployed
--   (baseline) Phase A body verbatim, adding only:
--     - integrity_hash: computed exactly as Phase C and the 20260504100500
--       backfill both documented — encode(digest(options_snapshot::text ||
--       correct_answer_index_snapshot::text, 'sha256'), 'hex') — so any
--       future re-introduction of hash verification in submit_quiz_results_v2
--       finds correctly-shaped data with no further backfill needed.
--     - options_version_at_serve: question_bank.options_version does NOT
--       exist in the current schema (verified above), so the "current
--       options_version at serve time" semantic the column was named for is
--       not available. Rather than reintroduce the full Phase C
--       options_version column + auto-increment trigger on question_bank
--       (a materially larger, separately-reviewable change) as part of an
--       urgent hotfix, this migration uses the sentinel value `0`, which is
--       the EXACT value and meaning 20260504100500 itself already
--       documented and used for "no genuine version captured / skip drift
--       comparison" (see that migration's "Sentinel value for
--       options_version_at_serve" comment block). This keeps the column's
--       existing documented contract intact: 0 means "not tracked",
--       non-zero would mean a real captured version. Reinstating
--       question_bank.options_version + its trigger (to make future serves
--       stamp a real version instead of the sentinel) is a legitimate
--       follow-up but is NOT required to fix the NOT NULL violation and is
--       intentionally out of scope here.
--
--   submit_quiz_results_v2 is NOT touched by this migration. The active
--   (post-baseline) version of that function does not reference
--   integrity_hash or options_version_at_serve at all — those columns are
--   currently write-only / observability-only, matching the "observability
--   only, scoring remains snapshot-bound" design intent Phase C itself
--   documented. Re-adding hash verification to submit_quiz_results_v2 is a
--   separate, higher-risk change (that function has been revised 8 times
--   since baseline, most recently 20260729120001) and is out of scope for
--   this urgent, narrowly-targeted fix.
--
-- Backwards compatibility: ADDITIVE / behavior-restoring only. No DROP, no
-- column changes, no ALTER COLUMN. Return shape (session_id, questions[])
-- is byte-identical to the currently deployed function — clients need no
-- changes. SECURITY DEFINER carried over unchanged from the existing
-- function (justification: same as the deployed version — authorization is
-- enforced inline against students.auth_user_id; no new privilege
-- expansion).
--
-- Idempotent: CREATE OR REPLACE FUNCTION; CREATE EXTENSION IF NOT EXISTS
-- pgcrypto (pgcrypto is already active in prod — 20260504100500's own
-- digest() backfill succeeded — this is defensive for fresh/staging DBs).
--
-- Rollback: revert to the current (Phase A, pre-this-migration) function
-- body — but note that IS the bug, so rollback is only appropriate if this
-- fix itself is found to be defective, not as a general-purpose escape
-- hatch. No data migration needed either direction: integrity_hash values
-- written going forward are deterministic from options_snapshot +
-- correct_answer_index_snapshot, matching the format already used by the
-- 20260504100500 backfill for pre-existing rows.
--
-- Reviewers (per .claude/skills/review-chains/SKILL.md, "RBAC/auth" chain):
-- architect (this file) + backend (WhatsApp daily6.ts consumer) + testing
-- (regression coverage) + assessment (P1/P6 scoring-adjacent — no scoring
-- logic changes, but touches the RPC scoring depends on). No RLS/table
-- shape change, so frontend/parent-portal review is not required.

-- ──────────────────────────────────────────────────────────────────────────
-- 0. Defensive: ensure pgcrypto is available for digest()
-- ──────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. start_quiz_session — populate options_version_at_serve + integrity_hash
-- ──────────────────────────────────────────────────────────────────────────
-- Identical to the currently deployed (baseline) body EXCEPT: two new DECLARE
-- variables (v_options_version, v_integrity_hash), one hash computation
-- after v_correct_idx is set, and both values added to the INSERT list.
-- Every other line — ownership check, empty-input short-circuit, shuffle
-- algorithm, ON CONFLICT clause, returned JSON shape — is unchanged.

CREATE OR REPLACE FUNCTION "public"."start_quiz_session"("p_student_id" "uuid", "p_question_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_session_id UUID := gen_random_uuid();
  v_qid UUID;
  v_options JSONB;
  v_options_arr JSONB;
  v_correct_idx INT;
  v_options_version INT;
  v_integrity_hash TEXT;
  v_shuffle INT[];
  v_displayed JSONB;
  v_questions JSONB := '[]'::jsonb;
  v_question_meta RECORD;
  v_temp INT;
  v_swap_idx INT;
  i INT;
BEGIN
  -- Ownership check: caller must own this student.
  -- service_role bypasses RLS but not this guard, so even an admin caller
  -- has to pass p_student_id matching auth.uid()'s student row.
  -- Skip the check when called from the service_role context (auth.uid()
  -- is NULL) so admin / cron / RPC-from-edge-function paths still work.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  IF p_question_ids IS NULL OR array_length(p_question_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'session_id', v_session_id,
      'questions', '[]'::jsonb
    );
  END IF;

  -- Iterate over input question IDs, generate per-question shuffle, snapshot.
  FOREACH v_qid IN ARRAY p_question_ids LOOP
    SELECT id, question_text, question_hi, options, correct_answer_index,
           explanation, explanation_hi, hint, difficulty, bloom_level,
           chapter_number, question_type
      INTO v_question_meta
      FROM question_bank
      WHERE id = v_qid AND is_active = true;

    -- Skip unknown / inactive questions silently — caller is responsible
    -- for filtering. We never want a bad ID in the input array to abort
    -- the entire session start.
    IF v_question_meta IS NULL THEN
      CONTINUE;
    END IF;

    -- Normalize options to a JSONB array.
    v_options := CASE
      WHEN jsonb_typeof(v_question_meta.options::jsonb) = 'array' THEN v_question_meta.options::jsonb
      ELSE NULL
    END;

    -- For non-MCQ or malformed options, store an identity shuffle and
    -- the snapshot as-is. Scoring still works because v_correct_idx is
    -- preserved verbatim in the snapshot.
    IF v_options IS NULL OR jsonb_array_length(v_options) <> 4 THEN
      v_shuffle := ARRAY[0,1,2,3]::INT[];
      v_options_arr := COALESCE(v_options, '[]'::jsonb);
    ELSE
      -- Fisher-Yates shuffle on [0,1,2,3] using random().
      v_shuffle := ARRAY[0,1,2,3]::INT[];
      FOR i IN REVERSE 4..2 LOOP
        -- random returns [0,1); floor((i) * random) gives 0..i-1.
        v_swap_idx := 1 + floor(random() * i)::INT;  -- 1-based for PL/pgSQL arrays
        v_temp := v_shuffle[i];
        v_shuffle[i] := v_shuffle[v_swap_idx];
        v_shuffle[v_swap_idx] := v_temp;
      END LOOP;
      v_options_arr := v_options;
    END IF;

    v_correct_idx := COALESCE(v_question_meta.correct_answer_index, 0);

    -- Fix (migration 20260801100800): question_bank.options_version does
    -- not exist in the current schema (see migration header). 0 is the
    -- documented sentinel for "no genuine version captured" per
    -- 20260504100500 — downstream drift-comparison consumers already treat
    -- 0 as "skip the comparison" rather than a real version.
    v_options_version := 0;

    -- Fix (migration 20260801100800): compute the integrity hash so the
    -- NOT NULL constraint added by 20260504100500 is satisfied. Format
    -- matches that migration's backfill exactly, byte-for-byte, so any
    -- future hash-verification logic in submit_quiz_results_v2 treats rows
    -- written before and after this fix identically.
    v_integrity_hash := encode(
      digest(v_options_arr::text || v_correct_idx::text, 'sha256'),
      'hex'
    );

    -- Persist snapshot. ON CONFLICT DO NOTHING keeps the RPC idempotent if
    -- the same (session_id, question_id) pair is submitted twice — though
    -- that should never happen because session_id is freshly generated.
    INSERT INTO quiz_session_shuffles (
      session_id, question_id, shuffle_map,
      options_snapshot, correct_answer_index_snapshot, student_id,
      options_version_at_serve, integrity_hash
    ) VALUES (
      v_session_id, v_qid, v_shuffle,
      v_options_arr, v_correct_idx, p_student_id,
      v_options_version, v_integrity_hash
    )
    ON CONFLICT (session_id, question_id) DO NOTHING;

    -- Build the displayed options array (in shuffled order) for the client.
    -- Client never receives correct_answer_index — that's intentional.
    IF jsonb_array_length(v_options_arr) = 4 THEN
      v_displayed := jsonb_build_array(
        v_options_arr -> v_shuffle[1],
        v_options_arr -> v_shuffle[2],
        v_options_arr -> v_shuffle[3],
        v_options_arr -> v_shuffle[4]
      );
    ELSE
      v_displayed := v_options_arr;
    END IF;

    v_questions := v_questions || jsonb_build_array(
      jsonb_build_object(
        'question_id', v_qid,
        'question_text', v_question_meta.question_text,
        'question_hi', v_question_meta.question_hi,
        'question_type', v_question_meta.question_type,
        'options_displayed', v_displayed,
        'explanation', v_question_meta.explanation,
        'explanation_hi', v_question_meta.explanation_hi,
        'hint', v_question_meta.hint,
        'difficulty', v_question_meta.difficulty,
        'bloom_level', v_question_meta.bloom_level,
        'chapter_number', v_question_meta.chapter_number
        -- DO NOT include correct_answer_index here. That's the bug class
        -- this migration closes.
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'questions', v_questions
  );
END;
$$;

COMMENT ON FUNCTION "public"."start_quiz_session"("p_student_id" "uuid", "p_question_ids" "uuid"[]) IS 'P0 fix (migration 20260428160000): server-owned shuffle authority for quiz sessions. Generates a per-question Fisher-Yates shuffle, snapshots options + correct_answer_index into quiz_session_shuffles, and returns the SHUFFLED options to the client WITHOUT correct_answer_index. Pair with submit_quiz_results_v2 — client sends only {question_id, selected_displayed_index} per response; server re-derives is_correct against the snapshot. Closes the P1+P6 drift bug where a mid-session question_bank.options edit corrupted the client''s stable shuffle map. Backwards compatible: legacy submit_quiz_results (v1) is preserved for in-flight clients. UPDATED (migration 20260801100800): also populates quiz_session_shuffles.options_version_at_serve (sentinel 0 — question_bank.options_version does not exist in this schema) and integrity_hash (SHA256 of options_snapshot||correct_answer_index_snapshot), both NOT NULL since 20260504100500. Root cause + full blast-radius writeup in that migration file.';

-- End of migration: 20260801100800_fix_start_quiz_session_options_version_null.sql
-- Tables touched:    none (no schema change — quiz_session_shuffles columns
--                    already exist from 20260504100500)
-- Functions touched: start_quiz_session (CREATE OR REPLACE, additive)
-- Triggers touched:  none
-- RLS touched:       none
