-- 20260527000003_teacher_parent_threads.sql
--
-- Phase C.3 of multi-school prod-readiness plan: teacher ↔ parent
-- messaging surface.
--
-- Schools cannot operate without a direct channel between teachers and
-- the parents of their students. This migration ships the canonical
-- substrate:
--
--   1. teacher_parent_threads   — one row per (teacher, guardian, student)
--                                  tuple, scoped to a school.
--   2. teacher_parent_messages  — append-only message rows, indexed by
--                                  thread, with per-sender read tracking.
--
-- RLS:
--   - teachers SEE their own threads + messages (auth.uid → teachers row);
--   - guardians SEE their own threads + messages (auth.uid → guardians row);
--   - service_role bypasses (API routes use supabaseAdmin already);
--   - both can INSERT messages they author.
--
-- BEFORE INSERT trigger on teacher_parent_messages bumps the parent
-- thread's `last_message_at` so the list view can sort by recency with
-- a single index hit.
--
-- Migration is idempotent — CREATE TABLE IF NOT EXISTS, DROP POLICY IF
-- EXISTS / CREATE POLICY pattern matches the rest of the repo (see
-- 20260527000000_add_school_id_foxy_chat_messages.sql).

BEGIN;

-- ── 1. Threads table ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.teacher_parent_threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id      uuid NOT NULL REFERENCES public.teachers(id)  ON DELETE CASCADE,
  guardian_id     uuid NOT NULL REFERENCES public.guardians(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES public.students(id)  ON DELETE CASCADE,
  school_id       uuid          REFERENCES public.schools(id)   ON DELETE SET NULL,
  subject         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.teacher_parent_threads
  IS 'One messaging thread per (teacher, guardian, student) tuple. school_id denormalised for tenant-scoped audit / archival.';
COMMENT ON COLUMN public.teacher_parent_threads.school_id
  IS 'Denormalised from students/teachers — kept NULLABLE because B2C students may have no school_id.';

-- One thread per (teacher, guardian, student). Re-opening a closed thread
-- reuses the row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tp_threads_unique_tuple
  ON public.teacher_parent_threads (teacher_id, guardian_id, student_id);

CREATE INDEX IF NOT EXISTS idx_tp_threads_teacher_recent
  ON public.teacher_parent_threads (teacher_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_tp_threads_guardian_recent
  ON public.teacher_parent_threads (guardian_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_tp_threads_school
  ON public.teacher_parent_threads (school_id)
  WHERE school_id IS NOT NULL;

-- ── 2. Messages table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.teacher_parent_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           uuid NOT NULL REFERENCES public.teacher_parent_threads(id) ON DELETE CASCADE,
  sender_role         text NOT NULL CHECK (sender_role IN ('teacher','guardian')),
  sender_auth_user_id uuid NOT NULL,
  body                text NOT NULL CHECK (char_length(btrim(body)) > 0 AND char_length(body) <= 4000),
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Read tracking — null until the *opposite* role marks it read via
  -- the GET threads/[id]/messages endpoint.
  read_at             timestamptz
);

COMMENT ON TABLE  public.teacher_parent_messages
  IS 'Append-only message log for teacher↔parent threads. sender_role + sender_auth_user_id together identify the author.';
COMMENT ON COLUMN public.teacher_parent_messages.read_at
  IS 'Set when the RECIPIENT (the opposite role) opens the message list. Sender-side read tracking is implicit (you wrote it).';

CREATE INDEX IF NOT EXISTS idx_tp_messages_thread_created
  ON public.teacher_parent_messages (thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tp_messages_unread_by_recipient
  ON public.teacher_parent_messages (thread_id, sender_role)
  WHERE read_at IS NULL;

-- ── 3. BEFORE INSERT trigger to bump last_message_at ──────────────────
-- Keep updated_at + last_message_at in lock-step so the list query can
-- sort by either without ambiguity.

CREATE OR REPLACE FUNCTION public.tp_messages_bump_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.teacher_parent_threads
  SET    last_message_at = NEW.created_at,
         updated_at      = NEW.created_at
  WHERE  id = NEW.thread_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tp_messages_bump_thread ON public.teacher_parent_messages;
CREATE TRIGGER trg_tp_messages_bump_thread
  BEFORE INSERT ON public.teacher_parent_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.tp_messages_bump_thread();

-- ── 4. RLS — threads ──────────────────────────────────────────────────
-- service_role bypasses RLS implicitly via the Supabase service-role JWT
-- claim (api routes use supabaseAdmin). The policies below scope SELECT
-- to the two human roles.

ALTER TABLE public.teacher_parent_threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tp_threads_teacher_select" ON public.teacher_parent_threads;
CREATE POLICY "tp_threads_teacher_select"
  ON public.teacher_parent_threads
  FOR SELECT
  USING (
    teacher_id IN (
      SELECT t.id FROM public.teachers t
      WHERE t.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tp_threads_guardian_select" ON public.teacher_parent_threads;
CREATE POLICY "tp_threads_guardian_select"
  ON public.teacher_parent_threads
  FOR SELECT
  USING (
    guardian_id IN (
      SELECT g.id FROM public.guardians g
      WHERE g.auth_user_id = auth.uid()
    )
  );

-- ── 5. RLS — messages ─────────────────────────────────────────────────
ALTER TABLE public.teacher_parent_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tp_messages_teacher_select" ON public.teacher_parent_messages;
CREATE POLICY "tp_messages_teacher_select"
  ON public.teacher_parent_messages
  FOR SELECT
  USING (
    thread_id IN (
      SELECT th.id FROM public.teacher_parent_threads th
      JOIN   public.teachers t ON t.id = th.teacher_id
      WHERE  t.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tp_messages_guardian_select" ON public.teacher_parent_messages;
CREATE POLICY "tp_messages_guardian_select"
  ON public.teacher_parent_messages
  FOR SELECT
  USING (
    thread_id IN (
      SELECT th.id FROM public.teacher_parent_threads th
      JOIN   public.guardians g ON g.id = th.guardian_id
      WHERE  g.auth_user_id = auth.uid()
    )
  );

-- INSERT policies — both roles can author messages in threads they own,
-- and only with the role label that matches their own identity. The API
-- routes do the heavy lifting (idempotency, side effects) but having
-- RLS here means a misuse via PostgREST cannot forge cross-role rows.
DROP POLICY IF EXISTS "tp_messages_teacher_insert" ON public.teacher_parent_messages;
CREATE POLICY "tp_messages_teacher_insert"
  ON public.teacher_parent_messages
  FOR INSERT
  WITH CHECK (
    sender_role = 'teacher'
    AND sender_auth_user_id = auth.uid()
    AND thread_id IN (
      SELECT th.id FROM public.teacher_parent_threads th
      JOIN   public.teachers t ON t.id = th.teacher_id
      WHERE  t.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tp_messages_guardian_insert" ON public.teacher_parent_messages;
CREATE POLICY "tp_messages_guardian_insert"
  ON public.teacher_parent_messages
  FOR INSERT
  WITH CHECK (
    sender_role = 'guardian'
    AND sender_auth_user_id = auth.uid()
    AND thread_id IN (
      SELECT th.id FROM public.teacher_parent_threads th
      JOIN   public.guardians g ON g.id = th.guardian_id
      WHERE  g.auth_user_id = auth.uid()
    )
  );

-- UPDATE policies are intentionally NOT created — read_at updates flow
-- through the API routes (supabaseAdmin / service_role).

COMMIT;
