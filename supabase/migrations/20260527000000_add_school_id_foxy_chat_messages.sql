-- 20260527000000_add_school_id_foxy_chat_messages.sql
--
-- Phase B.4 of multi-school prod-readiness plan.
--
-- foxy_chat_messages currently has only student_id (NOT NULL FK to
-- students.id). Per-school filtering of tutor logs requires a JOIN to
-- students.school_id, which is slow at scale and means compliance / export
-- queries scan cross-tenant by default.
--
-- This migration:
--   1. Adds a NULLABLE school_id column with FK + ON DELETE SET NULL
--   2. Backfills from students.school_id via the existing student_id FK
--   3. Creates an index for per-school filtering on the hot path
--   4. Adds a school-scoped RLS policy for school_admins so school
--      ops can read their own school's tutor logs without joining
--   5. Sets up a trigger so future INSERTs auto-populate school_id from
--      students (best-effort; falls back to NULL for B2C / orphaned students)
--
-- school_id remains NULLABLE (NOT NULL would block B2C students whose
-- students.school_id is also NULL). A future migration can tighten this
-- once all rows are guaranteed to be school-linked.

BEGIN;

-- 1. Add nullable school_id column with FK to schools.id
ALTER TABLE public.foxy_chat_messages
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.foxy_chat_messages.school_id IS
  'Denormalized school_id from students for per-school filtering. NULLABLE because students.school_id is also NULLABLE (B2C path).';

-- 2. Backfill from the student FK
UPDATE public.foxy_chat_messages fcm
SET    school_id = s.school_id
FROM   public.students s
WHERE  fcm.student_id = s.id
  AND  fcm.school_id IS NULL
  AND  s.school_id IS NOT NULL;

-- 3. Index for per-school filtering on the hot path
CREATE INDEX IF NOT EXISTS idx_foxy_chat_messages_school_id
  ON public.foxy_chat_messages (school_id);

CREATE INDEX IF NOT EXISTS idx_foxy_chat_messages_school_session
  ON public.foxy_chat_messages (school_id, session_id, created_at DESC)
  WHERE school_id IS NOT NULL;

-- 4. School-scoped RLS policy for school_admins
-- Existing policies (Students see own foxy messages, service_role bypass) are preserved.
-- This policy adds an OR clause: school_admins of the matching school can SELECT.
DROP POLICY IF EXISTS "school_admins_see_school_foxy_messages" ON public.foxy_chat_messages;
CREATE POLICY "school_admins_see_school_foxy_messages"
  ON public.foxy_chat_messages
  FOR SELECT
  USING (
    school_id IS NOT NULL
    AND school_id IN (
      SELECT sa.school_id
      FROM public.school_admins sa
      WHERE sa.auth_user_id = auth.uid()
        AND sa.is_active = true
    )
  );

-- 5. Trigger to auto-populate school_id on INSERT
-- This makes the denormalization automatic for new rows. If students has no
-- school_id (B2C), trigger sets NULL (already the column default).
CREATE OR REPLACE FUNCTION public.set_foxy_chat_school_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.school_id IS NULL AND NEW.student_id IS NOT NULL THEN
    SELECT s.school_id INTO NEW.school_id
    FROM public.students s
    WHERE s.id = NEW.student_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_foxy_chat_set_school_id ON public.foxy_chat_messages;
CREATE TRIGGER trg_foxy_chat_set_school_id
  BEFORE INSERT ON public.foxy_chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_foxy_chat_school_id();

COMMIT;
