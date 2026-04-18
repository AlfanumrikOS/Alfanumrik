-- Study-path integrity guards (2026-04-18).
--
-- Three post-mortem guards following the quiz-picker regression where
-- students saw lowercase subject tiles and an empty chapter list:
--
--   1. BEFORE-trigger on cbse_syllabus that auto-corrects subject_display
--      and chapter_title from the subjects master + chapters catalog,
--      preventing any future write from regressing the data back to
--      bare codes / "Chapter N" placeholders.
--
--   2. Two alert_rules (spike + drift) that fire when ops_events sees an
--      unusual volume of category='grounding.study_path' fallback events,
--      so the next regression surfaces in the super-admin grounding panel
--      before a user reports it.
--
-- Applied to production first via Supabase MCP (2026-04-18 02:xx UTC).
-- This migration records the exact state in repo history so a fresh
-- environment reproduces it.

BEGIN;

-- ─── Guard 1: cbse_syllabus display integrity trigger ───────────────────

CREATE OR REPLACE FUNCTION public.cbse_syllabus_normalize_display()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subject_name     TEXT;
  v_subject_name_hi  TEXT;
  v_chapter_title    TEXT;
  v_chapter_title_hi TEXT;
BEGIN
  -- Subject display: fill from subjects master when missing or echoing the code.
  IF NEW.subject_display IS NULL
     OR NEW.subject_display = NEW.subject_code
     OR NEW.subject_display_hi IS NULL
  THEN
    SELECT name, name_hi INTO v_subject_name, v_subject_name_hi
      FROM subjects
     WHERE code = NEW.subject_code
     LIMIT 1;

    IF v_subject_name IS NOT NULL THEN
      IF NEW.subject_display IS NULL OR NEW.subject_display = NEW.subject_code THEN
        NEW.subject_display := v_subject_name;
      END IF;
      IF NEW.subject_display_hi IS NULL THEN
        NEW.subject_display_hi := v_subject_name_hi;
      END IF;
    END IF;
  END IF;

  -- Chapter title: fill from chapters catalog when missing or placeholder.
  IF NEW.chapter_title IS NULL
     OR NEW.chapter_title ~ '^Chapter [0-9]+$'
     OR NEW.chapter_title_hi IS NULL
  THEN
    SELECT title, title_hi INTO v_chapter_title, v_chapter_title_hi
      FROM chapters
     WHERE grade = NEW.grade
       AND subject_code = NEW.subject_code
       AND chapter_number = NEW.chapter_number
       AND title IS NOT NULL
       AND title !~ '^Chapter [0-9]+$'
     LIMIT 1;

    IF v_chapter_title IS NOT NULL THEN
      IF NEW.chapter_title IS NULL OR NEW.chapter_title ~ '^Chapter [0-9]+$' THEN
        NEW.chapter_title := v_chapter_title;
      END IF;
      IF NEW.chapter_title_hi IS NULL THEN
        NEW.chapter_title_hi := v_chapter_title_hi;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.cbse_syllabus_normalize_display IS
  'Study-path integrity trigger: ensures cbse_syllabus.subject_display and chapter_title always reflect Title Case names from the subjects master + chapters catalog, never bare codes or "Chapter N" placeholders when real data exists.';

DROP TRIGGER IF EXISTS trg_cbse_syllabus_normalize_display ON cbse_syllabus;

CREATE TRIGGER trg_cbse_syllabus_normalize_display
  BEFORE INSERT OR UPDATE OF subject_display, subject_display_hi,
                              chapter_title, chapter_title_hi,
                              subject_code, grade, chapter_number
  ON cbse_syllabus
  FOR EACH ROW
  EXECUTE FUNCTION public.cbse_syllabus_normalize_display();

-- ─── Guard 2: grounding.study_path fallback alert rules ─────────────────

-- alert_rules.name lacks a unique constraint, so delete-then-insert keeps
-- the migration idempotent across reruns.
DELETE FROM alert_rules
 WHERE name IN (
   'grounding.study_path.fallback.spike',
   'grounding.study_path.fallback.drift'
 );

INSERT INTO alert_rules (
  name, description, enabled, category, source, min_severity,
  count_threshold, window_minutes, cooldown_minutes, channel_ids
) VALUES
(
  'grounding.study_path.fallback.spike',
  'Spike: 50+ study-path fallback events in 5 minutes. The subjects or chapters route is repeatedly falling back from the v2 cbse_syllabus RPC to the legacy constants — likely an active regression (RPC broken, table wiped, or a bad migration).',
  true,
  'grounding.study_path',
  NULL,              -- any source (api.student.subjects OR api.student.chapters)
  'warning',
  50, 5, 30,
  '{}'::uuid[]       -- ops fills channel_ids via super-admin alerts page
),
(
  'grounding.study_path.fallback.drift',
  'Drift: 100+ study-path fallback events in 24 hours. Some students are silently hitting the legacy subjects/chapters fallback — likely a slow regression where cbse_syllabus coverage decayed for specific (grade, subject) pairs. Investigate via super-admin grounding dashboard.',
  true,
  'grounding.study_path',
  NULL,
  'warning',
  100, 1440, 720,
  '{}'::uuid[]
);

-- ─── Idempotent normalization sweep ─────────────────────────────────────
-- Re-run through the trigger to normalise any remaining lowercase
-- subject_display or placeholder chapter_title rows. No-op if the
-- backfill migration already put the data in good shape.
UPDATE cbse_syllabus SET subject_display = subject_display
 WHERE subject_display = subject_code;

COMMIT;
