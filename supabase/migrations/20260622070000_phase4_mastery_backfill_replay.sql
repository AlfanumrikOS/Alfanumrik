-- Migration: 20260622070000_phase4_mastery_backfill_replay.sql
-- Purpose: PHASE 4 BACKFILL (NON-DESTRUCTIVE, ADDITIVE-ONLY).
--          The 9 students who have quiz history (quiz_sessions + quiz_responses)
--          but ZERO concept_mastery rows get REAL mastery by replaying every one
--          of their persisted quiz_responses CHRONOLOGICALLY, per (student, topic),
--          through the LIVE RPC update_learner_state_post_quiz(...) — using the
--          FIRST 7 POSITIONAL ARGS ONLY (BKT params left default), byte-for-byte
--          the same call the live submit makes (20260622030000 lines 366-374).
--
-- STRICTLY NON-DESTRUCTIVE. This migration NEVER deletes, updates, or normalizes
-- any pre-existing concept_mastery row. The 54 synthetic seed rows are OUT OF SCOPE
-- and are left untouched (their cleanup is deferred pending separate authorization).
-- We process ONLY (student, topic) pairs that currently have ZERO concept_mastery
-- rows, so the upsert inside the RPC always lands on the INSERT branch for the
-- first replayed response and the DO UPDATE branch only for that same fresh row's
-- subsequent responses. No existing row is ever the conflict target.
--
-- ZERO XP / SCORE / SESSION SIDE EFFECTS: this migration calls ONLY
-- update_learner_state_post_quiz. It does NOT call atomic_quiz_profile_update,
-- submit_quiz_results_v2, or any writer of students.xp_total, quiz_sessions,
-- score, score_percent, or streak_days. History is never re-graded or re-scored.
--
-- IDEMPOTENCY (two layers):
--   (1) One-shot marker: the whole backfill block is guarded behind
--       NOT EXISTS (admin_audit_log WHERE action='data_quality.phase4_mastery_backfill').
--       On re-run the marker exists -> the block is a no-op.
--   (2) Pair guard: even absent the marker, only (student, topic) pairs with ZERO
--       current concept_mastery rows are processed. A second run after the first
--       would find those pairs now populated and skip them.
--   Re-run changes ZERO rows.
--
-- FIDELITY GAP (documented, per assessment spec): p_error_type is passed NULL
-- because the original error classification is not recoverable from persisted
-- quiz_responses. Therefore error_count_conceptual/procedural/careless will be 0
-- for backfilled rows. This is the accepted spec behavior.
--
-- Grades remain TEXT (P5). RLS unchanged. No schema change. No DROP/DELETE/UPDATE
-- of existing concept_mastery rows. SECURITY: runs as the migration role (no
-- auth.uid()); update_learner_state_post_quiz performs no ownership check (it is
-- called post-validation in the live chain), so a NULL auth.uid() is safe here.

BEGIN;

DO $$
DECLARE
  v_marker_exists BOOLEAN;
  v_pair RECORD;
  v_resp RECORD;
  v_topic_id UUID;
  v_rt_ms INT;
  v_pairs_processed INT := 0;
  v_responses_replayed INT := 0;
  v_responses_skipped_null_topic INT := 0;
  v_responses_skipped_null_correct INT := 0;
  v_students_seen UUID[] := ARRAY[]::UUID[];
  v_topics_seen UUID[] := ARRAY[]::UUID[];
BEGIN
  -- ── One-shot marker guard ───────────────────────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM public.admin_audit_log
    WHERE action = 'data_quality.phase4_mastery_backfill'
  ) INTO v_marker_exists;

  IF v_marker_exists THEN
    RAISE NOTICE 'phase4_mastery_backfill: marker present, skipping (idempotent no-op).';
    RETURN;
  END IF;

  -- ── Iterate (student, topic) pairs that have quiz_responses but ZERO
  --     concept_mastery rows. We resolve topic per-response (question_bank
  --     topic_id, then curriculum_topics fallback) but group at the pair level
  --     by the SAME resolution, so the guard "pair has zero concept_mastery
  --     rows" is checked against the resolved topic_id. ────────────────────
  FOR v_pair IN
    WITH resolved AS (
      SELECT
        qr.id            AS response_id,
        qr.student_id    AS student_id,
        qr.is_correct    AS is_correct,
        qr.time_taken_seconds AS tts,
        qr.created_at    AS created_at,
        qr.question_number AS question_number,
        qb.bloom_level   AS bloom_level,
        qb.difficulty    AS difficulty,
        COALESCE(
          qb.topic_id,
          (
            SELECT ct.id
            FROM   public.curriculum_topics ct
            JOIN   public.subjects s ON s.id = ct.subject_id
            WHERE  s.code            = qb.subject
              AND  ct.grade          = qb.grade
              AND  ct.chapter_number = qb.chapter_number
              AND  ct.is_active      = true
            ORDER BY ct.display_order ASC
            LIMIT 1
          )
        ) AS topic_id
      FROM public.quiz_responses qr
      LEFT JOIN public.question_bank qb ON qb.id = qr.question_id
      WHERE qr.student_id IN (
        -- the 9 quiz-takers: have quiz_sessions, ZERO concept_mastery rows
        SELECT DISTINCT s.student_id
        FROM public.quiz_sessions s
        WHERE NOT EXISTS (
          SELECT 1 FROM public.concept_mastery cm
          WHERE cm.student_id = s.student_id
        )
      )
    )
    SELECT student_id, topic_id
    FROM resolved
    WHERE topic_id IS NOT NULL
      AND is_correct IS NOT NULL
      -- pair guard: only pairs that currently have ZERO concept_mastery rows
      AND NOT EXISTS (
        SELECT 1 FROM public.concept_mastery cm
        WHERE cm.student_id = resolved.student_id
          AND cm.topic_id   = resolved.topic_id
      )
    GROUP BY student_id, topic_id
  LOOP
    v_pairs_processed := v_pairs_processed + 1;
    IF NOT (v_pair.student_id = ANY(v_students_seen)) THEN
      v_students_seen := array_append(v_students_seen, v_pair.student_id);
    END IF;
    IF NOT (v_pair.topic_id = ANY(v_topics_seen)) THEN
      v_topics_seen := array_append(v_topics_seen, v_pair.topic_id);
    END IF;

    -- ── Replay this pair's responses CHRONOLOGICALLY ─────────────────────
    FOR v_resp IN
      SELECT
        qr.is_correct,
        qr.time_taken_seconds AS tts,
        qb.bloom_level,
        qb.difficulty,
        COALESCE(
          qb.topic_id,
          (
            SELECT ct.id
            FROM   public.curriculum_topics ct
            JOIN   public.subjects s ON s.id = ct.subject_id
            WHERE  s.code            = qb.subject
              AND  ct.grade          = qb.grade
              AND  ct.chapter_number = qb.chapter_number
              AND  ct.is_active      = true
            ORDER BY ct.display_order ASC
            LIMIT 1
          )
        ) AS topic_id
      FROM public.quiz_responses qr
      LEFT JOIN public.question_bank qb ON qb.id = qr.question_id
      WHERE qr.student_id = v_pair.student_id
      ORDER BY qr.created_at ASC, qr.question_number ASC NULLS LAST, qr.id ASC
    LOOP
      -- only responses that resolve to THIS pair's topic
      IF v_resp.topic_id IS NULL THEN
        -- counted once per skipped response (only for this student's stream;
        -- skipped responses are topic-less so they belong to no pair)
        CONTINUE;
      END IF;
      IF v_resp.topic_id <> v_pair.topic_id THEN
        CONTINUE;
      END IF;
      IF v_resp.is_correct IS NULL THEN
        CONTINUE;
      END IF;

      -- p_response_time_ms: time_taken_seconds * 1000; NULL/0 -> NULL (not 0)
      IF v_resp.tts IS NULL OR v_resp.tts = 0 THEN
        v_rt_ms := NULL;
      ELSE
        v_rt_ms := v_resp.tts * 1000;
      END IF;

      -- FIRST 7 POSITIONAL ARGS ONLY (BKT params default) — identical to the
      -- live submit (20260622030000 lines 366-374). p_error_type = NULL.
      PERFORM public.update_learner_state_post_quiz(
        v_pair.student_id,   -- p_student_id
        v_pair.topic_id,     -- p_topic_id
        v_resp.is_correct,   -- p_is_correct (authoritative; not re-derived)
        v_resp.bloom_level,  -- p_bloom_level (NULL ok)
        NULL,                -- p_error_type (documented fidelity gap)
        v_rt_ms,             -- p_response_time_ms (NULL when source NULL/0)
        v_resp.difficulty    -- p_difficulty (NULL ok)
      );
      v_responses_replayed := v_responses_replayed + 1;
    END LOOP;
  END LOOP;

  -- ── Count NULL-topic / NULL-is_correct responses skipped across cohort
  --     (reporting only; these never enter any pair) ──────────────────────
  SELECT
    COUNT(*) FILTER (
      WHERE COALESCE(
        qb.topic_id,
        (
          SELECT ct.id FROM public.curriculum_topics ct
          JOIN public.subjects s ON s.id = ct.subject_id
          WHERE s.code = qb.subject AND ct.grade = qb.grade
            AND ct.chapter_number = qb.chapter_number AND ct.is_active = true
          ORDER BY ct.display_order ASC LIMIT 1
        )
      ) IS NULL
    ),
    COUNT(*) FILTER (WHERE qr.is_correct IS NULL)
  INTO v_responses_skipped_null_topic, v_responses_skipped_null_correct
  FROM public.quiz_responses qr
  LEFT JOIN public.question_bank qb ON qb.id = qr.question_id
  WHERE qr.student_id IN (
    SELECT DISTINCT s.student_id
    FROM public.quiz_sessions s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.concept_mastery cm WHERE cm.student_id = s.student_id
    )
  );

  -- ── Write the one-shot marker (records run + counts; no PII) ────────────
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
  VALUES (
    NULL,
    'data_quality.phase4_mastery_backfill',
    'system',
    NULL,
    jsonb_build_object(
      'migrated_at', now(),
      'migration', '20260622070000_phase4_mastery_backfill_replay',
      'reason', 'PHASE 4: replay persisted quiz_responses through update_learner_state_post_quiz to populate concept_mastery for quiz-takers with zero mastery rows. Non-destructive, additive-only.',
      'pairs_processed', v_pairs_processed,
      'responses_replayed', v_responses_replayed,
      'distinct_students', array_length(v_students_seen, 1),
      'distinct_topics', array_length(v_topics_seen, 1),
      'responses_skipped_null_topic', v_responses_skipped_null_topic,
      'responses_skipped_null_is_correct', v_responses_skipped_null_correct,
      'fidelity_gap', 'p_error_type=NULL (not recoverable); error_count_* will be 0 for backfilled rows'
    ),
    now()
  );

  RAISE NOTICE 'phase4_mastery_backfill: pairs=% responses=% students=% topics=% (skipped null_topic=% null_is_correct=%)',
    v_pairs_processed, v_responses_replayed,
    array_length(v_students_seen, 1), array_length(v_topics_seen, 1),
    v_responses_skipped_null_topic, v_responses_skipped_null_correct;
END $$;

COMMIT;
