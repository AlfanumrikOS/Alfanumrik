-- Migration: 20260408000002_foxy_sessions_and_messages.sql
-- Purpose: Create foxy_sessions and foxy_chat_messages tables to support the
--          new /api/foxy Next.js route (resolveSession, loadHistory, message
--          persistence). The API route uses supabaseAdmin (service_role) for
--          writes; RLS is enabled so direct anon/authenticated client access
--          is scoped to the owning student only.
-- Note: Does NOT modify chat_sessions (legacy foxy-tutor Edge Function table,
--       preserved during parallel migration).

-- ============================================================================
-- 1. foxy_sessions
-- ============================================================================
-- Tracks a tutoring session per student/subject/mode. The API route calls
-- resolveSession() which upserts rows here. last_active_at is updated on
-- every interaction so the route can detect stale/expired sessions.

CREATE TABLE IF NOT EXISTS public.foxy_sessions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     UUID        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject        TEXT        NOT NULL,
  grade          TEXT        NOT NULL CHECK (grade IN ('6','7','8','9','10','11','12')),  -- P5
  chapter        TEXT,
  mode           TEXT        NOT NULL DEFAULT 'learn',
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS — direct client access is blocked by default; service_role bypasses.
ALTER TABLE public.foxy_sessions ENABLE ROW LEVEL SECURITY;

-- Student reads own sessions
DO $$ BEGIN
  CREATE POLICY "foxy_sessions_student_select" ON public.foxy_sessions
    FOR SELECT USING (
      student_id IN (SELECT id FROM public.students WHERE auth_user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Student updates own sessions (e.g., last_active_at, mode, chapter)
DO $$ BEGIN
  CREATE POLICY "foxy_sessions_student_update" ON public.foxy_sessions
    FOR UPDATE USING (
      student_id IN (SELECT id FROM public.students WHERE auth_user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Parent reads linked child's sessions
DO $$ BEGIN
  CREATE POLICY "foxy_sessions_parent_select" ON public.foxy_sessions
    FOR SELECT USING (
      student_id IN (
        SELECT student_id FROM public.guardian_student_links
        WHERE guardian_id IN (
          SELECT id FROM public.guardians WHERE auth_user_id = auth.uid()
        )
        AND status = 'approved'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Teacher reads sessions for assigned students
DO $$ BEGIN
  CREATE POLICY "foxy_sessions_teacher_select" ON public.foxy_sessions
    FOR SELECT USING (
      student_id IN (
        SELECT student_id FROM public.class_students
        WHERE class_id IN (
          SELECT class_id FROM public.class_teachers
          WHERE teacher_id IN (
            SELECT id FROM public.teachers WHERE auth_user_id = auth.uid()
          )
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role full access (API route uses supabaseAdmin for inserts/updates)
DO $$ BEGIN
  CREATE POLICY "foxy_sessions_service_all" ON public.foxy_sessions
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes
-- Session lookup + expiry check (resolveSession queries by student ordered by recency)
CREATE INDEX IF NOT EXISTS idx_foxy_sessions_student_active
  ON public.foxy_sessions (student_id, last_active_at DESC);

-- Subject-scoped session lookup
CREATE INDEX IF NOT EXISTS idx_foxy_sessions_student_subject
  ON public.foxy_sessions (student_id, subject);


-- ============================================================================
-- 2. foxy_chat_messages
-- ============================================================================
-- Stores the conversation history for each foxy session. loadHistory() reads
-- from this table ordered by created_at DESC. Writes happen only via the API
-- route (supabaseAdmin), so no student INSERT/UPDATE policy is needed; the
-- student SELECT policy allows the client to read their own conversation.

CREATE TABLE IF NOT EXISTS public.foxy_chat_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID        NOT NULL REFERENCES public.foxy_sessions(id) ON DELETE CASCADE,
  student_id  UUID        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT        NOT NULL,
  sources     JSONB,      -- RAG chunk sources for assistant messages (null for user messages)
  tokens_used INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS — direct client access is blocked by default; service_role bypasses.
ALTER TABLE public.foxy_chat_messages ENABLE ROW LEVEL SECURITY;

-- Student reads own messages
DO $$ BEGIN
  CREATE POLICY "foxy_chat_messages_student_select" ON public.foxy_chat_messages
    FOR SELECT USING (
      student_id IN (SELECT id FROM public.students WHERE auth_user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Parent reads linked child's chat messages
DO $$ BEGIN
  CREATE POLICY "foxy_chat_messages_parent_select" ON public.foxy_chat_messages
    FOR SELECT USING (
      student_id IN (
        SELECT student_id FROM public.guardian_student_links
        WHERE guardian_id IN (
          SELECT id FROM public.guardians WHERE auth_user_id = auth.uid()
        )
        AND status = 'approved'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Teacher reads messages for assigned students
DO $$ BEGIN
  CREATE POLICY "foxy_chat_messages_teacher_select" ON public.foxy_chat_messages
    FOR SELECT USING (
      student_id IN (
        SELECT student_id FROM public.class_students
        WHERE class_id IN (
          SELECT class_id FROM public.class_teachers
          WHERE teacher_id IN (
            SELECT id FROM public.teachers WHERE auth_user_id = auth.uid()
          )
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role full access (API route uses supabaseAdmin for all writes)
DO $$ BEGIN
  CREATE POLICY "foxy_chat_messages_service_all" ON public.foxy_chat_messages
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes
-- Message history retrieval (loadHistory fetches most recent messages per session)
CREATE INDEX IF NOT EXISTS idx_foxy_chat_messages_session_created
  ON public.foxy_chat_messages (session_id, created_at DESC);

-- Student activity index (per-student message timeline)
CREATE INDEX IF NOT EXISTS idx_foxy_chat_messages_student_created
  ON public.foxy_chat_messages (student_id, created_at DESC);


-- ============================================================================
-- End of migration: 20260408000002_foxy_sessions_and_messages.sql
--
-- Tables created (with RLS + policies): 2
--   foxy_sessions        — session tracking for /api/foxy resolveSession()
--   foxy_chat_messages   — conversation history for /api/foxy loadHistory()
-- Indexes created: 4
--   idx_foxy_sessions_student_active
--   idx_foxy_sessions_student_subject
--   idx_foxy_chat_messages_session_created
--   idx_foxy_chat_messages_student_created
-- RLS policies per table: 5 (student select, student update*, parent select,
--   teacher select, service_role all) — *sessions only; no client writes on messages
-- ============================================================================
