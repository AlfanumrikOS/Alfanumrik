-- Migration: 20260814000012_support_ticket_replies.sql
-- Purpose: SEV1 — close the support black hole. A student can file a ticket but
--          can NEVER receive a written response, because the schema has nowhere
--          to put one. `apps/host/src/app/api/support/tickets/[id]/route.ts:75`
--          returns `replies: []` as a hardcoded literal, documented at :8 with
--          "there is no `support_ticket_replies` table in the current schema",
--          while `/help` promises students a response within 24 hours
--          (apps/host/src/app/help/page.tsx:426,592). The only operator-writable
--          text field today is `support_tickets.admin_notes`, which is internal
--          and never returned to the student.
--
--          This migration adds the missing conversation table. It is ADDITIVE
--          ONLY: no change to `support_tickets`, no DROP of any table or column.
--
-- ─── Design ──────────────────────────────────────────────────────────────────
-- One row = one message on a ticket thread, from either side:
--   * requester side (author_role student/parent/teacher/guest)
--   * operator side  (author_role operator/admin/system)
-- `is_internal` is the student-visible vs private-note distinction, so an
-- operator can keep working notes on the thread without leaking them. Internal
-- notes are structurally unreachable by any non-service-role reader (see RLS).
--
-- ─── P13 (data privacy) ──────────────────────────────────────────────────────
-- NO PII is denormalised here. There is deliberately no author_name /
-- author_email / author_phone column. The author is an id + a role; the UI
-- renders "You" vs "Alfanumrik Support" from `author_role` alone. This matches
-- the ID-only posture established by 20260722103000_support_tickets_related_entity.
--
-- ─── P8 (RLS in the same migration) ──────────────────────────────────────────
-- RLS is enabled below with policies in this same file. The ownership
-- derivation MIRRORS `support_tickets_self_select` verbatim
-- (baseline_from_prod.sql:22378) —
--     student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
-- resolved one hop away through support_tickets.id. No new ownership
-- expression was invented.
--
-- ─── KNOWN ASYMMETRY this migration deliberately does NOT widen ──────────────
-- Parent-authored tickets are anchored to the CHILD's student_id with
-- user_role='parent' (api/support/tickets/route.ts:185-195). The list route
-- narrows on that role (`:292` .in(student_id, childIds).eq('user_role','parent')
-- and `:301` .eq('student_id', …).eq('user_role','student')), but the DETAIL
-- route ([id]/route.ts:50-51) filters on student_id ONLY and omits the
-- user_role filter — so today a student can already open a ticket their PARENT
-- filed about them. Today that leaks only the parent's own subject/message.
-- Adding a reply thread would turn that into a leak of the entire support
-- CONVERSATION about the child (refunds, escalations, behavioural concerns).
-- Therefore the student read policy below carries the SAME user_role narrowing
-- the list route already applies: parent- and teacher-authored threads are not
-- readable by the anchor student. This is strictly narrower than
-- support_tickets_self_select — it cannot widen anything.
--
-- ─── Deliberately NOT included ───────────────────────────────────────────────
--   * No guardian/parent SELECT policy. `support_tickets` itself has NO parent
--     policy (only support_tickets_self_insert / _self_select, both student-
--     anchored), so granting parents RLS read on the CHILD table while they
--     cannot read the PARENT row would be an asymmetric surface. Parents are
--     served today through the service-role API path. Separately,
--     `guardian_student_links.status` is inconsistent in-tree ('active' in the
--     link RPCs, 'approved' in others) and that must be reconciled before any
--     guardian policy is written against it. Tracked as a follow-up.
--   * No teacher policy — teacher-filed tickets carry student_id IS NULL and
--     have no student anchor to resolve.
--   * No UPDATE / DELETE policy for `authenticated`. RLS default-denies, so a
--     student can post a reply but can never edit or delete one — the audit
--     trail of a support conversation must be immutable from the requester side.
--   * No change to support_tickets (status re-open on reply, updated_at bump,
--     unread counters) — that is API-layer behaviour owned by backend.
--
-- ─── Idempotency ─────────────────────────────────────────────────────────────
-- CREATE TABLE IF NOT EXISTS, ENABLE RLS (idempotent), DROP POLICY IF EXISTS +
-- CREATE POLICY, CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP TRIGGER IF EXISTS + CREATE TRIGGER. Fully re-runnable.
--
-- Owner: architect. Reviewer chain: backend (reply POST/GET API + the user_role
-- detail-route filter noted above), frontend (thread UI on
-- apps/host/src/app/support/[ticket_id]/page.tsx:300), ops (super-admin reply
-- console), testing.

BEGIN;

-- =============================================================================
-- 1. Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.support_ticket_replies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Thread anchor. CASCADE: a deleted ticket takes its conversation with it.
  ticket_id       uuid NOT NULL
                    REFERENCES public.support_tickets(id) ON DELETE CASCADE,

  -- Who wrote it. Nullable so a system-generated reply (auto-ack, auto-close)
  -- or a reply whose operator account was later removed keeps the thread
  -- intact. SET NULL rather than CASCADE — deleting a staff account must never
  -- silently delete a student's support history.
  author_user_id  uuid NULL
                    REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Which SIDE of the conversation the author is on. This is the security-
  -- relevant field: the requester-side values are the only ones an
  -- `authenticated` caller may write (see support_ticket_replies_owner_insert),
  -- so a student cannot forge a reply that renders as official support.
  author_role     text NOT NULL
                    CHECK (author_role IN (
                      -- requester side
                      'student', 'parent', 'teacher', 'guest',
                      -- operator side
                      'operator', 'admin', 'system'
                    )),

  -- Message body. Bounded at 5000 to match the intake route's
  -- description.max(5000) / message.slice(0, 5000) contract.
  body            text NOT NULL
                    CHECK (btrim(body) <> '' AND length(body) <= 5000),

  -- Student-visible vs private operator note. FALSE (visible) is the default so
  -- that a forgotten flag fails toward "the student gets an answer", which is
  -- the entire point of this table; internal notes must be opted INTO.
  is_internal     boolean NOT NULL DEFAULT false,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Table-level invariant: only the operator side can author an internal note.
  -- A requester-side "private note" is meaningless and would be a trap — a
  -- student writing one would believe they had messaged support when nobody
  -- outside service-role could see it. Enforced in SQL, not just in the API.
  CONSTRAINT support_ticket_replies_internal_requires_operator
    CHECK (is_internal = false OR author_role IN ('operator', 'admin', 'system'))
);

COMMENT ON TABLE public.support_ticket_replies IS
  'Two-sided conversation thread on a support ticket. Closes the SEV1 where a student could file a ticket but never receive a written response. P13: ID-only authorship — no name/email/phone is denormalised here; the UI derives the speaker label from author_role.';
COMMENT ON COLUMN public.support_ticket_replies.author_role IS
  'Which side of the conversation authored this message. Requester side: student/parent/teacher/guest. Operator side: operator/admin/system. RLS permits an `authenticated` caller to insert ONLY author_role=''student'' — operator-side roles are writable by service_role alone, so a student cannot forge an official reply.';
COMMENT ON COLUMN public.support_ticket_replies.is_internal IS
  'TRUE = private operator note, never readable by the requester (no authenticated SELECT policy matches it). FALSE = student-visible reply. Defaults to FALSE so the fail-open direction is "the student gets an answer"; internal is opt-in. Paired with the internal_requires_operator CHECK so only the operator side can set it.';
COMMENT ON COLUMN public.support_ticket_replies.author_user_id IS
  'auth.users.id of the author. NULL for system-generated replies or when a staff account was removed (ON DELETE SET NULL — deleting a staff account must never delete a student''s support history). ID only, no PII (P13).';

-- =============================================================================
-- 2. RLS — enabled in this same migration (P8, mandatory)
-- =============================================================================

ALTER TABLE public.support_ticket_replies ENABLE ROW LEVEL SECURITY;

-- ── Read: ticket owner, student-visible replies only ────────────────────────
-- Blocks, in order of the three conjuncts:
--   (1) is_internal = false        -> a student can never read an operator's
--                                     private note, on any ticket.
--   (2) student_id IN (…auth.uid()) -> a student can never read replies on
--                                     ANOTHER student's ticket. This is
--                                     support_tickets_self_select's expression
--                                     verbatim, resolved through ticket_id.
--   (3) user_role NOT IN (parent, teacher)
--                                  -> the anchor student cannot read the thread
--                                     of a ticket their PARENT filed about them.
--                                     Mirrors the list route's own user_role
--                                     narrowing (route.ts:292,301) which the
--                                     detail route currently omits. Legacy rows
--                                     with NULL/'guest' user_role stay readable
--                                     by their anchor student.
DROP POLICY IF EXISTS support_ticket_replies_owner_select
  ON public.support_ticket_replies;
CREATE POLICY support_ticket_replies_owner_select
  ON public.support_ticket_replies
  FOR SELECT
  TO authenticated
  USING (
    is_internal = false
    AND EXISTS (
      SELECT 1
      FROM public.support_tickets st
      WHERE st.id = support_ticket_replies.ticket_id
        AND st.student_id IN (
          SELECT students.id
          FROM public.students
          WHERE students.auth_user_id = auth.uid()
        )
        AND (st.user_role IS NULL OR st.user_role NOT IN ('parent', 'teacher'))
    )
  );

COMMENT ON POLICY support_ticket_replies_owner_select
  ON public.support_ticket_replies IS
  'Ticket owner reads student-visible replies on their OWN student-filed ticket only. Blocks: another student''s replies, internal operator notes, and the thread of a parent-/teacher-authored ticket anchored to this student. Ownership expression mirrors support_tickets_self_select.';

-- ── Write: ticket owner may reply to their own thread, as a student only ────
-- Blocks:
--   * author_role forgery      -> only 'student' is writable by `authenticated`;
--                                 'operator'/'admin'/'system' are service-role
--                                 only, so a student cannot post a message that
--                                 renders as an official support answer.
--   * author impersonation     -> author_user_id must equal auth.uid().
--   * internal-note forgery    -> is_internal must be false (and the table CHECK
--                                 independently forbids a non-operator internal).
--   * replying to someone else -> same ownership subquery as the read policy.
DROP POLICY IF EXISTS support_ticket_replies_owner_insert
  ON public.support_ticket_replies;
CREATE POLICY support_ticket_replies_owner_insert
  ON public.support_ticket_replies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    author_role = 'student'
    AND is_internal = false
    AND author_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.support_tickets st
      WHERE st.id = support_ticket_replies.ticket_id
        AND st.student_id IN (
          SELECT students.id
          FROM public.students
          WHERE students.auth_user_id = auth.uid()
        )
        AND (st.user_role IS NULL OR st.user_role NOT IN ('parent', 'teacher'))
    )
  );

COMMENT ON POLICY support_ticket_replies_owner_insert
  ON public.support_ticket_replies IS
  'Ticket owner may append a student-side reply to their own thread. author_role is pinned to ''student'' and author_user_id to auth.uid() at the POLICY level, so operator-role forgery is impossible from a client session regardless of application code. No UPDATE/DELETE policy exists — requester-side messages are immutable.';

-- ── Operator/admin surface: service_role only ───────────────────────────────
-- Operator replies, internal notes, edits and redactions all go through the
-- service-role client (packages/lib/src/supabase-admin.ts, server-only), which
-- bypasses RLS. This explicit policy documents that intent and matches the
-- baseline's `subs_service_write` / teacher_assignment_drafts_service_role_all
-- convention. Authorisation for those writes is enforced in the route by
-- authorizeAdmin()/authorizeRequest(), NOT here.
DROP POLICY IF EXISTS support_ticket_replies_service_role_all
  ON public.support_ticket_replies;
CREATE POLICY support_ticket_replies_service_role_all
  ON public.support_ticket_replies
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- 3. Indexes
-- =============================================================================

-- Hot path: render one ticket's thread in chronological order (operator view —
-- includes internal notes).
CREATE INDEX IF NOT EXISTS idx_support_ticket_replies_ticket_created
  ON public.support_ticket_replies (ticket_id, created_at);

-- Hot path: the student-facing thread, which never includes internal notes.
-- Partial index keeps the student read cheap as operator notes accumulate.
CREATE INDEX IF NOT EXISTS idx_support_ticket_replies_visible
  ON public.support_ticket_replies (ticket_id, created_at)
  WHERE is_internal = false;

-- =============================================================================
-- 4. updated_at trigger (repo-standard shape)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_support_ticket_replies_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_ticket_replies_updated_at
  ON public.support_ticket_replies;
CREATE TRIGGER trg_support_ticket_replies_updated_at
  BEFORE UPDATE ON public.support_ticket_replies
  FOR EACH ROW EXECUTE FUNCTION public.set_support_ticket_replies_updated_at();

COMMIT;
