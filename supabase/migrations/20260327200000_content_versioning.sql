-- =============================================================================
-- Content Versioning & Governance System
-- Migration: 20260327200000_content_versioning.sql
--
-- Adds version tracking for chapters, topics, and questions with a full
-- draft -> review -> published -> archived lifecycle. Integrates with the
-- existing RBAC system (admin_users, user_roles, roles tables).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. CONTENT_VERSIONS TABLE
--    Stores immutable snapshots of every content revision.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_versions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type    TEXT         NOT NULL CHECK (content_type IN ('chapter', 'topic', 'question')),
  content_id      UUID         NOT NULL,
  version_number  INTEGER      NOT NULL DEFAULT 1,
  status          TEXT         NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'review', 'published', 'archived')),
  data            JSONB        NOT NULL,
  change_summary  TEXT,
  created_by      UUID         REFERENCES auth.users(id),
  reviewed_by     UUID         REFERENCES auth.users(id),
  published_by    UUID         REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ  DEFAULT now(),
  reviewed_at     TIMESTAMPTZ,
  published_at    TIMESTAMPTZ,

  UNIQUE (content_type, content_id, version_number)
);

COMMENT ON TABLE content_versions IS 'Immutable version history for chapters, topics, and questions.';
COMMENT ON COLUMN content_versions.data IS 'Full JSONB snapshot of the content at this version.';


-- ---------------------------------------------------------------------------
-- 2. ADD content_status COLUMN TO EXISTING TABLES
--    Tracks the current lifecycle state on the source record itself.
-- ---------------------------------------------------------------------------
ALTER TABLE chapters      ADD COLUMN IF NOT EXISTS content_status TEXT DEFAULT 'published';
ALTER TABLE topics        ADD COLUMN IF NOT EXISTS content_status TEXT DEFAULT 'published';
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS content_status TEXT DEFAULT 'published';


-- ---------------------------------------------------------------------------
-- 3. INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_content_versions_type_id
  ON content_versions (content_type, content_id);

CREATE INDEX IF NOT EXISTS idx_content_versions_status
  ON content_versions (status);

CREATE INDEX IF NOT EXISTS idx_content_versions_created_at
  ON content_versions (created_at);


-- ---------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
ALTER TABLE content_versions ENABLE ROW LEVEL SECURITY;

-- Helper: returns TRUE when the current user is a super_admin or admin
-- (uses the existing admin_users table from the RBAC migration).
CREATE OR REPLACE FUNCTION public.is_content_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM admin_users
    WHERE auth_user_id = auth.uid()
      AND is_active = true
      AND admin_level IN ('super_admin', 'admin')
  );
$$;

-- Helper: returns TRUE when the current user holds a 'content_manager' role
-- (uses the existing user_roles + roles tables from the RBAC migration).
CREATE OR REPLACE FUNCTION public.is_content_manager()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.auth_user_id = auth.uid()
      AND ur.is_active = true
      AND r.name = 'content_manager'
      AND r.is_active = true
  );
$$;

-- 4a. SELECT ------------------------------------------------------------------

-- Admins can read every version.
CREATE POLICY content_versions_select_admin
  ON content_versions FOR SELECT TO authenticated
  USING (public.is_content_admin());

-- Content managers can read every version.
CREATE POLICY content_versions_select_manager
  ON content_versions FOR SELECT TO authenticated
  USING (public.is_content_manager());

-- All authenticated users can read published versions.
CREATE POLICY content_versions_select_published
  ON content_versions FOR SELECT TO authenticated
  USING (status = 'published');

-- 4b. INSERT ------------------------------------------------------------------

-- Admins can insert any version.
CREATE POLICY content_versions_insert_admin
  ON content_versions FOR INSERT TO authenticated
  WITH CHECK (public.is_content_admin());

-- Content managers can create drafts and submit for review.
CREATE POLICY content_versions_insert_manager
  ON content_versions FOR INSERT TO authenticated
  WITH CHECK (
    public.is_content_manager()
    AND status IN ('draft', 'review')
  );

-- 4c. UPDATE ------------------------------------------------------------------

-- Admins can update any version (e.g. publish, archive).
CREATE POLICY content_versions_update_admin
  ON content_versions FOR UPDATE TO authenticated
  USING  (public.is_content_admin())
  WITH CHECK (public.is_content_admin());

-- Content managers can update their own drafts.
CREATE POLICY content_versions_update_manager
  ON content_versions FOR UPDATE TO authenticated
  USING (
    public.is_content_manager()
    AND created_by = auth.uid()
    AND status IN ('draft', 'review')
  )
  WITH CHECK (
    public.is_content_manager()
    AND status IN ('draft', 'review')
  );

-- 4d. DELETE ------------------------------------------------------------------

-- Only admins can delete versions (soft-delete via 'archived' is preferred).
CREATE POLICY content_versions_delete_admin
  ON content_versions FOR DELETE TO authenticated
  USING (public.is_content_admin());


-- ---------------------------------------------------------------------------
-- 5. FUNCTION: create_content_version
--    Auto-increments version_number per (content_type, content_id) pair and
--    returns the newly created row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_content_version(
  p_content_type   TEXT,
  p_content_id     UUID,
  p_data           JSONB,
  p_change_summary TEXT DEFAULT NULL,
  p_created_by     UUID DEFAULT NULL
)
RETURNS content_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_version INTEGER;
  v_record       content_versions;
BEGIN
  -- Validate content_type
  IF p_content_type NOT IN ('chapter', 'topic', 'question') THEN
    RAISE EXCEPTION 'Invalid content_type: %. Must be chapter, topic, or question.', p_content_type;
  END IF;

  -- Determine the next version number (locked to prevent races)
  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version
    FROM content_versions
   WHERE content_type = p_content_type
     AND content_id   = p_content_id
     FOR UPDATE;

  -- Insert the new version
  INSERT INTO content_versions (
    content_type,
    content_id,
    version_number,
    status,
    data,
    change_summary,
    created_by,
    created_at
  ) VALUES (
    p_content_type,
    p_content_id,
    v_next_version,
    'draft',
    p_data,
    p_change_summary,
    COALESCE(p_created_by, auth.uid()),
    now()
  )
  RETURNING * INTO v_record;

  RETURN v_record;
END;
$$;

COMMENT ON FUNCTION public.create_content_version IS
  'Creates a new content version with an auto-incremented version number. '
  'Returns the full content_versions row.';
