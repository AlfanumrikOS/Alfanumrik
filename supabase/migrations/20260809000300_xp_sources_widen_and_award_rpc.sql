-- Migration: 20260809000300_xp_sources_widen_and_award_rpc.sql
-- Purpose: Foxy North-Star Phase 3 — (a) widen xp_transactions_source_check
--   with the four new Phase-3 earning sources; (b) NEW generic capped-award
--   RPC award_xp_capped() so every new XP lane shares ONE audited cap/clamp/
--   idempotency implementation instead of re-typing the ledger mechanics.
--
-- ─── (a) Source-check widen ───────────────────────────────────────────────
-- The FULL existing member list below was read VERBATIM from the baseline
-- xp_transactions DDL (00000000000000_baseline_from_prod.sql:14808 — 17
-- members; grep across all root migrations 2026-08-05 confirms no later
-- migration ever redefined this constraint, so the baseline list IS current).
-- Four additions:
--   'review_graded'         — graded review-loop completion (Phase 3)
--   'remediation_recovered' — adaptive-remediation recovery award (Phase 3)
--   'unhinted_mastery'      — correct-with-zero-hints bonus (20260809000500)
--   'thoughtful_question'   — Foxy thoughtful-question award (Phase 3)
-- DO-block drop/recreate: existing rows all carry members of the OLD list, a
-- strict subset of the NEW list, so re-validation cannot fail. Re-running is
-- a no-op-equivalent (drop-if-exists then add).
--
-- ─── (b) award_xp_capped ──────────────────────────────────────────────────
-- Signature: (p_student_id uuid, p_source text, p_amount int, p_daily_cap int,
--             p_daily_category text, p_reference_id text, p_metadata jsonb).
--
--   * XP VALUES NEVER LIVE HERE (P2): p_amount and p_daily_cap are ALWAYS
--     passed by the caller from packages/lib/src/xp-config.ts (or from a
--     paired SQL caller whose defaults are parity-pinned to xp-config, see
--     20260809000500). This function contains ZERO XP literals.
--   * Daily cap: SUM(amount) over p_daily_category within the Asia/Kolkata
--     calendar day — the EXACT IST day-boundary mechanics copied from the
--     quiz-cap implementation in atomic_quiz_profile_update
--     (20260729130000:230,257-263: v_ist_today anchor + half-open
--     [ist_day, ist_day+1) created_at range). Award is clamped to remaining
--     headroom: LEAST(GREATEST(0, p_amount), GREATEST(0, cap - earned)).
--   * Idempotency: INSERT ... ON CONFLICT (reference_id) WHERE reference_id
--     IS NOT NULL DO NOTHING — the WHERE predicate is REQUIRED to match the
--     existing PARTIAL unique index idx_xp_txn_reference_id (baseline :18221);
--     a bare conflict target raises 42P10 (the exact defect 20260623000600
--     fixed — pattern mirrored from there). No new constraint needed: the
--     partial unique index already exists, and this RPC REQUIRES a non-NULL
--     p_reference_id (RAISEs otherwise) so every row it writes is covered by
--     the index. A conflict (replay) awards NOTHING and skips the xp_total
--     update — retry-safe by construction.
--   * students.xp_total is incremented in the SAME (implicit) transaction as
--     the ledger INSERT — they can never diverge. last_active/streaks are
--     deliberately NOT touched (those belong to the quiz path).
--   * Returns jsonb: success, requested_xp, effective_xp, xp_capped,
--     idempotent_replay, today_earned, remaining_today.
--
-- SECURITY INVOKER justification (required comment): the ONLY grantee is
--   service_role, which bypasses RLS — INVOKER therefore works and is the
--   least-privilege posture: if a future migration accidentally granted this
--   to authenticated, INVOKER means the caller would still need INSERT on
--   xp_transactions / UPDATE on students under their OWN RLS (students have
--   neither), so no client could mint XP even through a mis-grant. DEFINER
--   would silently convert such a mis-grant into an XP-minting hole.
--   REVOKE includes anon + authenticated explicitly because the baseline's
--   ALTER DEFAULT PRIVILEGES auto-grants EXECUTE on new public functions to
--   authenticated (documented in 20260729130000's REACHABILITY section) —
--   REVOKE FROM PUBLIC alone would NOT remove that default grant.
--
-- Idempotent: drop/recreate constraint; CREATE OR REPLACE function. No DROP
--   TABLE/COLUMN. No RLS change (no new table).
-- Owner: architect. Reviewers (P14): assessment (P2 economy), backend
--   (callers), testing (REG-48-family parity + cap tests), quality.
-- Added: 2026-08-05.

BEGIN;

-- ─── (a) Widen the source CHECK ───────────────────────────────────────────
DO $xp_source_widen$
BEGIN
  ALTER TABLE public.xp_transactions
    DROP CONSTRAINT IF EXISTS xp_transactions_source_check;
  ALTER TABLE public.xp_transactions
    ADD CONSTRAINT xp_transactions_source_check CHECK (source = ANY (ARRAY[
      -- existing 17 members, verbatim from baseline :14808 —
      'quiz'::text,
      'quiz_correct'::text,
      'quiz_high_score'::text,
      'quiz_perfect'::text,
      'foxy_chat'::text,
      'foxy_lesson_complete'::text,
      'streak_daily'::text,
      'streak_milestone'::text,
      'topic_mastered'::text,
      'chapter_complete'::text,
      'study_task'::text,
      'study_week'::text,
      'challenge_win'::text,
      'competition_prize'::text,
      'first_quiz_of_day'::text,
      'redemption'::text,
      'admin_adjustment'::text,
      -- Phase 3 additions (2026-08-05) —
      'review_graded'::text,
      'remediation_recovered'::text,
      'unhinted_mastery'::text,
      'thoughtful_question'::text
    ]));
END $xp_source_widen$;

-- ─── (b) award_xp_capped ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.award_xp_capped(
  p_student_id     uuid,
  p_source         text,
  p_amount         integer,
  p_daily_cap      integer,
  p_daily_category text,
  p_reference_id   text,
  p_metadata       jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
-- SECURITY INVOKER: service_role-only grantee bypasses RLS; INVOKER makes an
-- accidental future grant to a client role fail closed under that role's own
-- RLS instead of minting XP. See header.
SET search_path = public
AS $$
DECLARE
  v_ist_today    date;
  v_today_earned integer;
  v_remaining    integer;
  v_award        integer;
  v_capped       boolean;
  v_inserted_id  uuid;
BEGIN
  IF p_student_id IS NULL OR p_source IS NULL OR p_daily_category IS NULL THEN
    RAISE EXCEPTION 'award_xp_capped: p_student_id, p_source and p_daily_category are required';
  END IF;
  -- Idempotency is non-optional on this RPC: every award must carry a caller-
  -- chosen dedupe key covered by the partial unique index idx_xp_txn_reference_id.
  IF p_reference_id IS NULL OR length(p_reference_id) = 0 THEN
    RAISE EXCEPTION 'award_xp_capped: p_reference_id (idempotency key) is required';
  END IF;
  IF p_daily_cap IS NULL OR p_daily_cap < 0 THEN
    RAISE EXCEPTION 'award_xp_capped: p_daily_cap must be >= 0';
  END IF;

  -- IST day anchor + half-open day range: copied from the quiz-cap
  -- implementation (atomic_quiz_profile_update, 20260729130000).
  v_ist_today := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  SELECT COALESCE(SUM(amount), 0)::integer
    INTO v_today_earned
    FROM public.xp_transactions
   WHERE student_id     = p_student_id
     AND daily_category = p_daily_category
     AND created_at    >= (v_ist_today AT TIME ZONE 'Asia/Kolkata')
     AND created_at    <  ((v_ist_today + 1) AT TIME ZONE 'Asia/Kolkata');

  v_remaining := GREATEST(0, p_daily_cap - v_today_earned);
  v_award     := LEAST(GREATEST(0, COALESCE(p_amount, 0)), v_remaining);
  v_capped    := v_award < GREATEST(0, COALESCE(p_amount, 0));

  IF v_award = 0 THEN
    -- Fully capped (or zero/negative request): no ledger row, no total change
    -- — mirrors the 7-arg quiz overload's "skip INSERT when clamped to 0".
    RETURN jsonb_build_object(
      'success',           true,
      'requested_xp',      COALESCE(p_amount, 0),
      'effective_xp',      0,
      'xp_capped',         v_capped,
      'idempotent_replay', false,
      'today_earned',      v_today_earned,
      'remaining_today',   v_remaining
    );
  END IF;

  -- Ledger write. Conflict target carries the WHERE predicate so Postgres can
  -- infer the PARTIAL unique index (42P10 otherwise — see 20260623000600).
  INSERT INTO public.xp_transactions (
    student_id, amount, source, subject,
    daily_category, reference_id, metadata, created_at
  ) VALUES (
    p_student_id,
    v_award,                                  -- CAPPED amount, matching the credit below
    p_source,
    NULL,                                     -- subject not part of this generic lane; put it in p_metadata
    p_daily_category,
    p_reference_id,
    COALESCE(p_metadata, '{}'::jsonb)
      || jsonb_build_object('original_xp', COALESCE(p_amount, 0)),
    now()
  )
  ON CONFLICT (reference_id) WHERE reference_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    -- Replay: this reference_id was already awarded. Nothing written, total
    -- untouched — the earlier call's credit stands.
    RETURN jsonb_build_object(
      'success',           true,
      'requested_xp',      COALESCE(p_amount, 0),
      'effective_xp',      0,
      'xp_capped',         false,
      'idempotent_replay', true,
      'today_earned',      v_today_earned,
      'remaining_today',   v_remaining
    );
  END IF;

  -- Same-transaction total update: ledger and aggregate can never diverge.
  UPDATE public.students
     SET xp_total = COALESCE(xp_total, 0) + v_award
   WHERE id = p_student_id;

  RETURN jsonb_build_object(
    'success',           true,
    'requested_xp',      COALESCE(p_amount, 0),
    'effective_xp',      v_award,
    'xp_capped',         v_capped,
    'idempotent_replay', false,
    'today_earned',      v_today_earned + v_award,
    'remaining_today',   GREATEST(0, v_remaining - v_award)
  );
END;
$$;

COMMENT ON FUNCTION public.award_xp_capped(uuid, text, integer, integer, text, text, jsonb) IS
  'Foxy North-Star Phase 3: generic capped XP award. Contains ZERO XP '
  'literals (P2) — amount and daily cap are always caller-supplied from '
  'xp-config (TS) or a parity-pinned SQL caller. Clamps to remaining '
  'Asia/Kolkata-day headroom over daily_category (same IST mechanics as '
  'atomic_quiz_profile_update), writes the ledger row idempotently via the '
  'partial unique index on reference_id (ON CONFLICT ... WHERE reference_id '
  'IS NOT NULL, per 20260623000600), and updates students.xp_total in the '
  'same transaction. SECURITY INVOKER; EXECUTE granted to service_role ONLY '
  '— no client role can mint XP.';

-- Grants: service_role ONLY. Explicitly strip the default-privileges grant to
-- authenticated (see header) and anon.
REVOKE ALL ON FUNCTION public.award_xp_capped(uuid, text, integer, integer, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.award_xp_capped(uuid, text, integer, integer, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.award_xp_capped(uuid, text, integer, integer, text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.award_xp_capped(uuid, text, integer, integer, text, text, jsonb) TO service_role;

COMMIT;
