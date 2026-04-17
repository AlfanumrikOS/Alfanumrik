-- supabase/migrations/20260418100500_syllabus_status_triggers.sql

-- Thresholds (duplicated in src/lib/grounding-config.ts — CI parity check enforces)
-- MIN_CHUNKS_FOR_READY    = 50
-- MIN_QUESTIONS_FOR_READY = 40

CREATE OR REPLACE FUNCTION recompute_syllabus_status(
  p_grade text,
  p_subject_code text,
  p_chapter_number int
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_chunks int;
  v_questions int;
  v_status text;
BEGIN
  SELECT count(*) INTO v_chunks
    FROM rag_content_chunks
    WHERE grade_short = p_grade
      AND subject_code = p_subject_code
      AND chapter_number = p_chapter_number;

  SELECT count(*) INTO v_questions
    FROM question_bank
    WHERE grade = p_grade
      AND subject = p_subject_code
      AND chapter_number = p_chapter_number
      AND verified_against_ncert = true
      AND deleted_at IS NULL;

  v_status := CASE
    WHEN v_chunks = 0 THEN 'missing'
    WHEN v_chunks < 50 OR v_questions < 40 THEN 'partial'
    ELSE 'ready'
  END;

  UPDATE cbse_syllabus
  SET chunk_count = v_chunks,
      verified_question_count = v_questions,
      rag_status = v_status,
      last_verified_at = now(),
      updated_at = now()
  WHERE grade = p_grade
    AND subject_code = p_subject_code
    AND chapter_number = p_chapter_number;
END $$;

-- Trigger on rag_content_chunks
CREATE OR REPLACE FUNCTION trg_rag_chunks_recompute()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recompute_syllabus_status(OLD.grade_short, OLD.subject_code, OLD.chapter_number);
    RETURN OLD;
  ELSE
    PERFORM recompute_syllabus_status(NEW.grade_short, NEW.subject_code, NEW.chapter_number);
    IF TG_OP = 'UPDATE' AND (
      OLD.grade_short IS DISTINCT FROM NEW.grade_short OR
      OLD.subject_code IS DISTINCT FROM NEW.subject_code OR
      OLD.chapter_number IS DISTINCT FROM NEW.chapter_number
    ) THEN
      PERFORM recompute_syllabus_status(OLD.grade_short, OLD.subject_code, OLD.chapter_number);
    END IF;
    RETURN NEW;
  END IF;
END $$;

DROP TRIGGER IF EXISTS rag_chunks_recompute_trigger ON rag_content_chunks;
CREATE TRIGGER rag_chunks_recompute_trigger
  AFTER INSERT OR UPDATE OR DELETE ON rag_content_chunks
  FOR EACH ROW EXECUTE FUNCTION trg_rag_chunks_recompute();

-- Trigger on question_bank (only when verification state changes)
CREATE OR REPLACE FUNCTION trg_question_bank_recompute()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
     OLD.verified_against_ncert IS NOT DISTINCT FROM NEW.verified_against_ncert AND
     OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at THEN
    RETURN NEW;                                    -- no-op, no recompute needed
  END IF;
  PERFORM recompute_syllabus_status(NEW.grade, NEW.subject, NEW.chapter_number);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS question_bank_recompute_trigger ON question_bank;
CREATE TRIGGER question_bank_recompute_trigger
  AFTER INSERT OR UPDATE ON question_bank
  FOR EACH ROW EXECUTE FUNCTION trg_question_bank_recompute();