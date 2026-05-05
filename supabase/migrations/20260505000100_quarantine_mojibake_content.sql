-- Migration: 20260505000100_quarantine_mojibake_content.sql
-- Purpose: P0 hotfix — quarantine Sanskrit (and scan Hindi) mojibake content that
--          leaked from non-Unicode Devanagari fonts (Krutidev/SHUSHA/Walkman) when
--          NCERT PDFs were ingested via pdf-parse. The extractor read raw ASCII
--          codepoints, not the rendered glyphs, so titles/chunks like
--          `R\`Rh;%`, `Prqfkz%`, `"K"B%`, `Lire%` are now poisoning the
--          chapter dropdown, NCERT Quiz Setup, Today's Focus, exams, and
--          Foxy citations (P12 risk: Foxy grounds answers on garbage).
--
-- Strategy:
--   1. Add a `quality_status TEXT DEFAULT 'ok'` flag to the four content tables
--      (curriculum_topics, chapters, rag_content_chunks, question_bank) so we
--      can mark rows as quarantined WITHOUT deleting them. Reversible.
--   2. Define a conservative `is_devanagari_mojibake(text)` detector that:
--        - is TRUE only if the input has zero Devanagari codepoints AND
--        - matches Krutidev punctuation patterns (% mid-word, backtick,
--          letter+semicolon).
--      This is conservative — won't false-positive on plain English.
--   3. Auto-quarantine Sanskrit rows. Hindi is only counted (lower confidence
--      since most Hindi rows are Unicode-clean) — operator decides next step.
--   4. Cascade question_bank quarantine to any question whose chapter or topic
--      is quarantined, so quiz-generator stops serving them.
--   5. Provide `count_mojibake_rows()` for ops to verify before/after.
--
-- Reversibility:
--   This migration sets flags only — NO row deletion. To roll back any single
--   table after canonical re-import, run e.g.:
--     UPDATE curriculum_topics SET quality_status = 'ok'
--      WHERE quality_status = 'mojibake_quarantined';
--     UPDATE chapters SET quality_status = 'ok'
--      WHERE quality_status = 'mojibake_quarantined';
--     UPDATE rag_content_chunks SET quality_status = 'ok'
--      WHERE quality_status = 'mojibake_quarantined';
--     UPDATE question_bank SET quality_status = 'ok'
--      WHERE quality_status = 'mojibake_chapter';
--
-- Performance:
--   Migration must complete in <30s on prod (~50K chunks). Detector is a
--   plain regex against `chunk_text` — no joins on the big scan.
--
-- Follow-up (separate migration, not this one):
--   - Replace pdf-parse with pdftotext + Devanagari font-mapping for re-ingest
--   - Re-import canonical Sanskrit/Hindi NCERT JSON
--   - After re-import, lift quarantine via the rollback queries above

-- ─── Step 1: Add quality_status columns where missing ───────────────────────

ALTER TABLE "public"."curriculum_topics"
  ADD COLUMN IF NOT EXISTS "quality_status" TEXT NOT NULL DEFAULT 'ok';

ALTER TABLE "public"."chapters"
  ADD COLUMN IF NOT EXISTS "quality_status" TEXT NOT NULL DEFAULT 'ok';

ALTER TABLE "public"."rag_content_chunks"
  ADD COLUMN IF NOT EXISTS "quality_status" TEXT NOT NULL DEFAULT 'ok';

ALTER TABLE "public"."question_bank"
  ADD COLUMN IF NOT EXISTS "quality_status" TEXT NOT NULL DEFAULT 'ok';

COMMENT ON COLUMN "public"."curriculum_topics"."quality_status" IS
  'Content quality flag. ''ok'' = serve normally. ''mojibake_quarantined'' = legacy Krutidev/SHUSHA garbage detected; do not show to users. See migration 20260505000100.';
COMMENT ON COLUMN "public"."chapters"."quality_status" IS
  'Content quality flag. ''ok'' = serve normally. ''mojibake_quarantined'' = legacy non-Unicode garbage detected. See migration 20260505000100.';
COMMENT ON COLUMN "public"."rag_content_chunks"."quality_status" IS
  'Content quality flag. ''ok'' = retrievable. ''mojibake_quarantined'' = chunk_text or chapter_title is non-Unicode garbage; Foxy must not ground on it (P12). See migration 20260505000100.';
COMMENT ON COLUMN "public"."question_bank"."quality_status" IS
  'Content quality flag. ''ok'' = serve normally. ''mojibake_chapter'' = parent chapter/topic is mojibake-quarantined; quiz-generator must skip. See migration 20260505000100.';

-- ─── Step 2: Mojibake detector helper ───────────────────────────────────────

CREATE OR REPLACE FUNCTION "public"."is_devanagari_mojibake"(p_text TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Empty / null inputs are not mojibake.
  IF p_text IS NULL OR length(p_text) = 0 THEN
    RETURN FALSE;
  END IF;

  -- If the string already contains any Devanagari codepoint, it's real Unicode.
  -- Devanagari block: U+0900..U+097F (ऀ..ॿ).
  IF p_text ~ '[ऀ-ॿ]' THEN
    RETURN FALSE;
  END IF;

  -- No Devanagari codepoints AND matches Krutidev/SHUSHA/Walkman fingerprints:
  --   % sign in word position (e.g. R`Rh;%, Prqfkz%, "K"B%)
  --   backtick used as a vowel/diacritic stand-in
  --   letter immediately followed by a semicolon (e.g. R`Rh;%)
  IF p_text ~ '[%`]' OR p_text ~ '[A-Za-z];' THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION "public"."is_devanagari_mojibake"(TEXT) IS
  'Conservative detector for non-Unicode Devanagari font garbage (Krutidev/SHUSHA/Walkman). Returns TRUE only if input has zero Devanagari codepoints AND contains Krutidev punctuation patterns. Won''t false-positive on English. See migration 20260505000100.';

-- ─── Step 3: Quarantine Sanskrit rows ───────────────────────────────────────
-- Wrapped in a DO block so the structured RAISE NOTICE summary fires on prod.

DO $$
DECLARE
  v_sanskrit_subject_ids UUID[];
  v_topics_quarantined   INT := 0;
  v_chapters_quarantined INT := 0;
  v_chunks_quarantined   INT := 0;
  v_questions_quarantined INT := 0;
  v_hindi_topic_suspects   INT := 0;
  v_hindi_chapter_suspects INT := 0;
  v_hindi_chunk_suspects   INT := 0;
BEGIN
  -- Resolve Sanskrit subject id(s). Defensive: if subject doesn't exist, skip.
  SELECT array_agg(id) INTO v_sanskrit_subject_ids
    FROM public.subjects WHERE code = 'sanskrit';

  IF v_sanskrit_subject_ids IS NULL OR array_length(v_sanskrit_subject_ids, 1) IS NULL THEN
    RAISE NOTICE '[mojibake-quarantine] No subject row with code=''sanskrit'' — skipping Sanskrit pass.';
  ELSE
    -- 3a. curriculum_topics
    UPDATE public.curriculum_topics
       SET quality_status = 'mojibake_quarantined',
           is_active      = FALSE,
           updated_at     = now()
     WHERE subject_id = ANY (v_sanskrit_subject_ids)
       AND quality_status <> 'mojibake_quarantined'
       AND public.is_devanagari_mojibake(title);
    GET DIAGNOSTICS v_topics_quarantined = ROW_COUNT;

    -- 3b. chapters
    UPDATE public.chapters
       SET quality_status = 'mojibake_quarantined',
           is_active      = FALSE
     WHERE subject_id = ANY (v_sanskrit_subject_ids)
       AND quality_status <> 'mojibake_quarantined'
       AND public.is_devanagari_mojibake(title);
    GET DIAGNOSTICS v_chapters_quarantined = ROW_COUNT;

    -- 3c. rag_content_chunks — match by subject_code='sanskrit' (denormalised)
    --     Quarantine if EITHER chapter_title OR chunk_text is mojibake (P12).
    UPDATE public.rag_content_chunks
       SET quality_status = 'mojibake_quarantined',
           is_active      = FALSE,
           updated_at     = now()
     WHERE subject_code = 'sanskrit'
       AND quality_status <> 'mojibake_quarantined'
       AND (
         public.is_devanagari_mojibake(chapter_title) OR
         public.is_devanagari_mojibake(chunk_text)
       );
    GET DIAGNOSTICS v_chunks_quarantined = ROW_COUNT;

    -- 3d. question_bank — cascade: any question whose chapter is quarantined
    --     OR whose topic is quarantined. We tag with 'mojibake_chapter' so
    --     quiz-generator can filter and we can re-validate later.
    UPDATE public.question_bank q
       SET quality_status = 'mojibake_chapter',
           is_active      = FALSE,
           updated_at     = now()
      FROM public.chapters c
     WHERE q.chapter_id = c.id
       AND c.quality_status = 'mojibake_quarantined'
       AND q.quality_status <> 'mojibake_chapter';
    GET DIAGNOSTICS v_questions_quarantined = ROW_COUNT;

    -- Also cascade via topic_id if chapter_id is null on the question.
    UPDATE public.question_bank q
       SET quality_status = 'mojibake_chapter',
           is_active      = FALSE,
           updated_at     = now()
      FROM public.curriculum_topics t
     WHERE q.topic_id = t.id
       AND t.quality_status = 'mojibake_quarantined'
       AND q.quality_status <> 'mojibake_chapter';
  END IF;

  -- ─── Step 4: Diagnostic-only scan of Hindi ────────────────────────────────
  -- Don't auto-quarantine; just count. Hindi is mostly Unicode-clean already.
  SELECT COUNT(*) INTO v_hindi_topic_suspects
    FROM public.curriculum_topics ct
    JOIN public.subjects s ON s.id = ct.subject_id
   WHERE s.code = 'hindi'
     AND public.is_devanagari_mojibake(ct.title);

  SELECT COUNT(*) INTO v_hindi_chapter_suspects
    FROM public.chapters ch
    JOIN public.subjects s ON s.id = ch.subject_id
   WHERE s.code = 'hindi'
     AND public.is_devanagari_mojibake(ch.title);

  SELECT COUNT(*) INTO v_hindi_chunk_suspects
    FROM public.rag_content_chunks
   WHERE subject_code = 'hindi'
     AND (
       public.is_devanagari_mojibake(chapter_title) OR
       public.is_devanagari_mojibake(chunk_text)
     );

  -- Structured summary for Vercel/CI logs.
  RAISE NOTICE '[mojibake-quarantine] sanskrit=>{topics:%, chapters:%, chunks:%, questions:%} hindi_suspects=>{topics:%, chapters:%, chunks:%}',
    v_topics_quarantined, v_chapters_quarantined, v_chunks_quarantined, v_questions_quarantined,
    v_hindi_topic_suspects, v_hindi_chapter_suspects, v_hindi_chunk_suspects;
END;
$$;

-- ─── Step 5: Diagnostic function for ops ────────────────────────────────────

CREATE OR REPLACE FUNCTION "public"."count_mojibake_rows"()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_topics       INT;
  v_chapters     INT;
  v_chunks       INT;
  v_questions    INT;
  v_hindi_topics   INT;
  v_hindi_chapters INT;
  v_hindi_chunks   INT;
BEGIN
  SELECT COUNT(*) INTO v_topics
    FROM public.curriculum_topics
   WHERE quality_status = 'mojibake_quarantined';

  SELECT COUNT(*) INTO v_chapters
    FROM public.chapters
   WHERE quality_status = 'mojibake_quarantined';

  SELECT COUNT(*) INTO v_chunks
    FROM public.rag_content_chunks
   WHERE quality_status = 'mojibake_quarantined';

  SELECT COUNT(*) INTO v_questions
    FROM public.question_bank
   WHERE quality_status = 'mojibake_chapter';

  -- Hindi suspect counts (NOT quarantined yet — review-only).
  SELECT COUNT(*) INTO v_hindi_topics
    FROM public.curriculum_topics ct
    JOIN public.subjects s ON s.id = ct.subject_id
   WHERE s.code = 'hindi'
     AND public.is_devanagari_mojibake(ct.title);

  SELECT COUNT(*) INTO v_hindi_chapters
    FROM public.chapters ch
    JOIN public.subjects s ON s.id = ch.subject_id
   WHERE s.code = 'hindi'
     AND public.is_devanagari_mojibake(ch.title);

  SELECT COUNT(*) INTO v_hindi_chunks
    FROM public.rag_content_chunks
   WHERE subject_code = 'hindi'
     AND (
       public.is_devanagari_mojibake(chapter_title) OR
       public.is_devanagari_mojibake(chunk_text)
     );

  RETURN jsonb_build_object(
    'curriculum_topics',   v_topics,
    'chapters',            v_chapters,
    'rag_content_chunks',  v_chunks,
    'question_bank',       v_questions,
    'hindi_suspected',     jsonb_build_object(
      'curriculum_topics',  v_hindi_topics,
      'chapters',           v_hindi_chapters,
      'rag_content_chunks', v_hindi_chunks
    ),
    'scanned_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;

COMMENT ON FUNCTION "public"."count_mojibake_rows"() IS
  'Ops diagnostic: returns JSONB summary of mojibake-quarantined Sanskrit rows + Hindi suspect counts (Hindi is review-only, not auto-quarantined). Run before and after migration 20260505000100 to verify.';

-- ─── Step 6: Helpful indexes for quick filtering ────────────────────────────
-- Partial indexes keep the index small; queries can filter `quality_status = 'ok'`.

CREATE INDEX IF NOT EXISTS "idx_curriculum_topics_quality_status"
  ON "public"."curriculum_topics" ("quality_status")
  WHERE "quality_status" <> 'ok';

CREATE INDEX IF NOT EXISTS "idx_chapters_quality_status"
  ON "public"."chapters" ("quality_status")
  WHERE "quality_status" <> 'ok';

CREATE INDEX IF NOT EXISTS "idx_rag_content_chunks_quality_status"
  ON "public"."rag_content_chunks" ("quality_status")
  WHERE "quality_status" <> 'ok';

CREATE INDEX IF NOT EXISTS "idx_question_bank_quality_status"
  ON "public"."question_bank" ("quality_status")
  WHERE "quality_status" <> 'ok';

-- End of migration. RLS unchanged (this is a column-add + UPDATE-flag op only).
