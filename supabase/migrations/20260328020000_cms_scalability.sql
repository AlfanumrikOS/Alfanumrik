-- =============================================================================
-- CMS Scalability: Full-text search, bulk operations, version retention
-- =============================================================================

-- Full-text search vectors (auto-generated from content columns)
ALTER TABLE curriculum_topics ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(title_hi, ''))
  ) STORED;

ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(question_text, '') || ' ' || coalesce(explanation, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_topics_fts ON curriculum_topics USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_questions_fts ON question_bank USING GIN (search_vector);

-- Bulk status transition
CREATE OR REPLACE FUNCTION public.bulk_transition_status(
  p_table TEXT, p_ids UUID[], p_new_status TEXT, p_actor_id UUID
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER := 0; v_id UUID;
BEGIN
  FOREACH v_id IN ARRAY p_ids LOOP
    BEGIN
      PERFORM transition_content_status(p_table, v_id, p_new_status, p_actor_id);
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Version retention cleanup
CREATE OR REPLACE FUNCTION public.cleanup_old_versions(p_keep INTEGER DEFAULT 20)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_deleted INTEGER;
BEGIN
  DELETE FROM cms_item_versions WHERE id IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY entity_type, entity_id ORDER BY version_number DESC) as rn
      FROM cms_item_versions
    ) ranked WHERE rn > p_keep
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
