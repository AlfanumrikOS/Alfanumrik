-- Recovered from production migration history (supabase_migrations.schema_migrations,
-- version 20260713142448, name fix_content_readiness_ambiguous_subject_code), which was
-- applied out-of-band on 2026-07-13 and never committed. Captured into git verbatim to
-- close the local<->remote drift so `supabase db push` reconciles with zero modification
-- to production history. The statement below is byte-identical to the recorded production
-- `statements[1]` (md5 701e5b908be6f60f3890d64e7b88609c, 3585 bytes) and is additive only
-- (CREATE OR REPLACE FUNCTION, idempotent; no DROP/DELETE/TRUNCATE).

-- Hotfix: alfanumrik-content-readiness-daily pg_cron job (jobid 12) failing nightly since
-- at least 2026-07-11 with: ERROR: column reference "subject_code" is ambiguous (LINE 58, ON CONFLICT).
-- Root cause: RETURNS TABLE OUT params (subject_code, grade, ...) collide with the target-table
-- column names in the ON CONFLICT inference list under plpgsql variable substitution.
-- Minimal non-breaking fix: add `#variable_conflict use_column` pragma. Function signature,
-- result column names, and body logic are otherwise byte-identical to the prior definition.
-- Verified 2026-07-13 via BEGIN/CREATE OR REPLACE/SELECT/ROLLBACK dry run on production data.
create or replace function public.recompute_subject_content_readiness_daily()
 returns table(subject_code text, grade text, ready_score numeric, chunks_count integer, questions_count integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
DECLARE
  v_today DATE := (now() AT TIME ZONE 'UTC')::date;
  v_min_questions_floor CONSTANT INT := 40;
BEGIN
  PERFORM compute_subject_content_readiness();

  RETURN QUERY
  WITH valid_pairs AS (
    SELECT DISTINCT
           gsm.subject_code,
           gsm.grade::TEXT AS grade
      FROM grade_subject_map gsm
     WHERE gsm.subject_code IS NOT NULL
       AND gsm.grade IS NOT NULL
  ),
  chap AS (
    SELECT c.subject_code,
           c.grade::TEXT AS grade,
           COUNT(*)::INT AS chunks
      FROM chapters c
     WHERE c.is_active
     GROUP BY c.subject_code, c.grade
  ),
  qs AS (
    SELECT LOWER(q.subject) AS subject_code,
           regexp_replace(q.grade::TEXT, '\D', '', 'g') AS grade,
           COUNT(*)::INT AS questions
      FROM question_bank q
     WHERE q.is_active = true
     GROUP BY LOWER(q.subject), regexp_replace(q.grade::TEXT, '\D', '', 'g')
  ),
  joined AS (
    SELECT vp.subject_code,
           vp.grade,
           COALESCE(chap.chunks, 0)    AS chunks,
           COALESCE(qs.questions, 0)   AS questions
      FROM valid_pairs vp
      LEFT JOIN chap ON chap.subject_code = vp.subject_code AND chap.grade = vp.grade
      LEFT JOIN qs   ON qs.subject_code   = vp.subject_code AND qs.grade   = vp.grade
  ),
  scored AS (
    SELECT j.subject_code,
           j.grade,
           CASE
             WHEN j.chunks <= 0 AND j.questions <= 0 THEN 0::NUMERIC
             WHEN j.chunks >= 1 AND j.questions >= v_min_questions_floor THEN 1::NUMERIC
             WHEN j.chunks >= 1 OR j.questions >= 1 THEN 0.5::NUMERIC
             ELSE 0::NUMERIC
           END AS ready_score,
           j.chunks    AS chunks_count,
           j.questions AS questions_count
      FROM joined j
     WHERE j.grade ~ '^(6|7|8|9|10|11|12)$'
  ),
  upserted AS (
    INSERT INTO subject_content_readiness_daily AS t (
      subject_code, grade, ready_score, chunks_count, questions_count,
      computed_on, last_computed_at
    )
    SELECT s.subject_code, s.grade, s.ready_score, s.chunks_count,
           s.questions_count, v_today, now()
      FROM scored s
    ON CONFLICT (subject_code, grade, computed_on) DO UPDATE
      SET ready_score      = EXCLUDED.ready_score,
          chunks_count     = EXCLUDED.chunks_count,
          questions_count  = EXCLUDED.questions_count,
          last_computed_at = now()
    RETURNING t.subject_code, t.grade, t.ready_score,
              t.chunks_count, t.questions_count
  )
  SELECT u.subject_code,
         u.grade,
         u.ready_score::NUMERIC,
         u.chunks_count::INT,
         u.questions_count::INT
    FROM upserted u;
END;
$function$;
