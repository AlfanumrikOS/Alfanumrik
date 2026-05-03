-- =============================================================================
-- CMS Foundation: Workflow columns + Per-Item Versioning + Functions
-- Applied to production via Supabase MCP. This file captures the actual
-- schema for reproducibility in fresh environments.
-- =============================================================================

-- 1. WORKFLOW COLUMNS ON curriculum_topics
ALTER TABLE curriculum_topics ADD COLUMN IF NOT EXISTS content_status TEXT DEFAULT 'published' CHECK (content_status IN ('draft','review','published','archived'));
ALTER TABLE curriculum_topics ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
ALTER TABLE curriculum_topics ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id);
ALTER TABLE curriculum_topics ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id);
ALTER TABLE curriculum_topics ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES auth.users(id);
ALTER TABLE curriculum_topics ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE curriculum_topics ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE curriculum_topics ADD COLUMN IF NOT EXISTS review_notes TEXT;

-- 2. WORKFLOW COLUMNS ON question_bank
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS content_status TEXT DEFAULT 'published' CHECK (content_status IN ('draft','review','published','archived'));
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id);
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id);
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES auth.users(id);
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS review_notes TEXT;

-- 3. PER-ITEM VERSION HISTORY TABLE
CREATE TABLE IF NOT EXISTS cms_item_versions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT         NOT NULL CHECK (entity_type IN ('topic','question','simulation','exercise')),
  entity_id       UUID         NOT NULL,
  version_number  INTEGER      NOT NULL DEFAULT 1,
  status          TEXT         NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published','archived')),
  snapshot        JSONB        NOT NULL,
  change_summary  TEXT,
  created_by      UUID         REFERENCES auth.users(id),
  reviewed_by     UUID         REFERENCES auth.users(id),
  published_by    UUID         REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ  DEFAULT now(),
  reviewed_at     TIMESTAMPTZ,
  published_at    TIMESTAMPTZ,
  UNIQUE (entity_type, entity_id, version_number)
);

-- 4. INDEXES
CREATE INDEX IF NOT EXISTS idx_cms_versions_entity ON cms_item_versions (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_cms_versions_status ON cms_item_versions (status);
CREATE INDEX IF NOT EXISTS idx_cms_versions_created ON cms_item_versions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_status ON curriculum_topics (content_status);
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_grade_subject ON curriculum_topics (grade, subject_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_status ON question_bank (content_status);
CREATE INDEX IF NOT EXISTS idx_question_bank_grade_subject ON question_bank (grade, subject);

-- 5. RLS
ALTER TABLE cms_item_versions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY cms_versions_select_admin ON cms_item_versions FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY cms_versions_insert_admin ON cms_item_versions FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY cms_versions_update_admin ON cms_item_versions FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6. FUNCTIONS
CREATE OR REPLACE FUNCTION public.create_cms_version(
  p_entity_type TEXT, p_entity_id UUID, p_snapshot JSONB,
  p_change_summary TEXT DEFAULT NULL, p_created_by UUID DEFAULT NULL
) RETURNS cms_item_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_next INTEGER;
  v_record cms_item_versions;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next
    FROM cms_item_versions WHERE entity_type = p_entity_type AND entity_id = p_entity_id FOR UPDATE;
  INSERT INTO cms_item_versions (entity_type, entity_id, version_number, status, snapshot, change_summary, created_by)
  VALUES (p_entity_type, p_entity_id, v_next, 'draft', p_snapshot, p_change_summary, COALESCE(p_created_by, auth.uid()))
  RETURNING * INTO v_record;
  RETURN v_record;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_content_status(
  p_table TEXT, p_id UUID, p_new_status TEXT, p_actor_id UUID, p_notes TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current TEXT;
  v_valid BOOLEAN := false;
BEGIN
  IF p_table = 'curriculum_topics' THEN
    SELECT content_status INTO v_current FROM curriculum_topics WHERE id = p_id;
  ELSIF p_table = 'question_bank' THEN
    SELECT content_status INTO v_current FROM question_bank WHERE id = p_id;
  ELSE RAISE EXCEPTION 'Invalid table: %', p_table; END IF;

  IF v_current IS NULL THEN RAISE EXCEPTION 'Record not found'; END IF;

  v_valid := CASE
    WHEN v_current = 'draft' AND p_new_status IN ('review','archived') THEN true
    WHEN v_current = 'review' AND p_new_status IN ('published','draft','archived') THEN true
    WHEN v_current = 'published' AND p_new_status IN ('archived','draft') THEN true
    WHEN v_current = 'archived' AND p_new_status = 'draft' THEN true
    ELSE false END;

  IF NOT v_valid THEN RAISE EXCEPTION 'Invalid transition: % -> %', v_current, p_new_status; END IF;

  IF p_table = 'curriculum_topics' THEN
    UPDATE curriculum_topics SET content_status = p_new_status, updated_by = p_actor_id, updated_at = now(),
      reviewed_by = CASE WHEN p_new_status IN ('published','draft') AND v_current = 'review' THEN p_actor_id ELSE reviewed_by END,
      published_by = CASE WHEN p_new_status = 'published' THEN p_actor_id ELSE published_by END,
      published_at = CASE WHEN p_new_status = 'published' THEN now() ELSE published_at END,
      review_notes = COALESCE(p_notes, review_notes)
    WHERE id = p_id;
  ELSIF p_table = 'question_bank' THEN
    UPDATE question_bank SET content_status = p_new_status, updated_by = p_actor_id, updated_at = now(),
      reviewed_by = CASE WHEN p_new_status IN ('published','draft') AND v_current = 'review' THEN p_actor_id ELSE reviewed_by END,
      published_by = CASE WHEN p_new_status = 'published' THEN p_actor_id ELSE published_by END,
      published_at = CASE WHEN p_new_status = 'published' THEN now() ELSE published_at END,
      review_notes = COALESCE(p_notes, review_notes)
    WHERE id = p_id;
  END IF;
  RETURN true;
END;
$$;
