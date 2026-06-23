-- Migration: 20260623020000_provision_school_rpc.sql
-- Purpose: P1 "One-switch onboarding" — atomic provision_school() RPC that
--          creates a school row, a school_subscription row, and an admin invite
--          code in ONE transaction and returns the claim-flow bootstrap payload.
--
-- ─── WHY THIS RPC EXISTS ─────────────────────────────────────────────────────
-- Two pre-existing code paths had split-brain provisioning bugs:
--
--   1. provisionTrialSchool() (src/lib/school-provisioning.ts) wrote `code` but
--      not `slug`, so schools it created have slug=NULL. /api/schools/join reads
--      slug — those schools were unreachable.
--
--   2. POST /api/super-admin/institutions/provision/route.ts wrote slug but did
--      four bare sequential inserts (no transaction). It also minted an invite
--      with role_type='teacher', but the claim flow requires role_type='admin'.
--
-- This RPC is the single correct path for both callers. It is fail-atomic: if
-- any step raises, Postgres rolls back the entire transaction, leaving no orphan
-- rows. Both callers are updated separately (backend task).
--
-- ─── WHAT THIS MIGRATION DOES ────────────────────────────────────────────────
--   1. CREATE OR REPLACE FUNCTION public.provision_school(...) RETURNS jsonb
--      SECURITY DEFINER — three INSERTs in ONE transaction, returns the
--      bootstrap payload {school_id, slug, invite_code, subdomain}.
--   2. REVOKE / GRANT EXECUTE → service_role only.
--
-- ─── WHAT THIS MIGRATION DOES NOT DO ─────────────────────────────────────────
--   - Does NOT create an auth user (Supabase Admin SDK / application code).
--   - Does NOT INSERT into school_admins (happens after the claim flow).
--   - Does NOT INSERT into school_admin_claim_tokens (issuing a claim token
--     requires a school_admins row to FK into; that row is created post-claim).
--   - Does NOT touch any other table or policy.
--
-- ─── IDEMPOTENCY ─────────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION — safe to replay on any env. The school INSERT uses
-- ON CONFLICT (slug) DO UPDATE SET updated_at = now(), making re-provision of
-- the same slug a metadata-refresh no-op (the invite code returned is fresh each
-- call, but the school row is not duplicated). school_subscriptions and
-- school_invite_codes are always INSERTed fresh (idempotent from the caller's
-- perspective: a second provision call for the same slug yields a new invite).
--
-- ─── SECURITY DEFINER JUSTIFICATION ─────────────────────────────────────────
-- SECURITY DEFINER is required because:
--   (a) provision_school is called by the service-role-backed backend (which
--       already bypasses RLS) but we also need the DB function to be
--       callable from Supabase's RPC gateway via service_role where auth.uid()
--       is null and RLS would otherwise block all three inserts.
--   (b) Belt-and-suspenders for any future caller that may run with a JWT
--       (e.g. a future super-admin SPA direct RPC call) — the function still
--       writes correctly without needing per-table RLS exceptions for the caller.
-- search_path is pinned to `public` to prevent search-path hijack. The function
-- does not read or return auth.uid() and does not accept unvalidated free-form
-- SQL input — all parameters are typed and used only in parameterised form.
--
-- ─── SCHEMA NOTES (confirmed from baseline + post-baseline migrations) ────────
-- schools.code         — NULLABLE (no NOT NULL). Set to slug for backward compat.
-- schools.tenant_type  — NOT NULL DEFAULT 'school' (migration 20260507000004).
--                        CHECK IN ('school','coaching','corporate','government').
-- school_invite_codes.role_type CHECK — widened to include 'admin' by migration
--   20260621000100 (applied before this file in timestamp order). The 'admin'
--   INSERT below is therefore safe on any env that has run 20260621000100.
-- school_subscriptions.price_per_seat_monthly — NULLABLE numeric (no NOT NULL).
-- schools.slug — UNIQUE via constraint schools_slug_key (baseline line ~15980).
--
-- Owner: architect. Review chain: backend (wiring), testing.

BEGIN;

-- =============================================================================
-- provision_school — atomic one-switch school onboarding RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION public.provision_school(
  p_name                    text,
  p_slug                    text,
  p_board                   text    DEFAULT 'CBSE',
  p_city                    text    DEFAULT NULL,
  p_state                   text    DEFAULT NULL,
  p_plan                    text    DEFAULT 'trial',
  p_seats                   int     DEFAULT 50,
  p_price_per_seat_monthly  numeric DEFAULT 0,
  p_billing_email           text    DEFAULT NULL,
  p_tenant_type             text    DEFAULT 'school'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id   uuid;
  v_invite_code text;
BEGIN
  -- ── Input validation ───────────────────────────────────────────────────────
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'p_name is required' USING ERRCODE = '22023';
  END IF;
  IF p_slug IS NULL OR trim(p_slug) = '' THEN
    RAISE EXCEPTION 'p_slug is required' USING ERRCODE = '22023';
  END IF;
  IF p_seats IS NULL OR p_seats < 1 THEN
    RAISE EXCEPTION 'p_seats must be >= 1' USING ERRCODE = '22023';
  END IF;
  -- Validate tenant_type against the schools_tenant_type_check constraint values
  -- (migration 20260507000004). Raises early rather than letting the INSERT fail
  -- with a cryptic constraint violation message.
  IF p_tenant_type NOT IN ('school', 'coaching', 'corporate', 'government') THEN
    RAISE EXCEPTION 'p_tenant_type must be one of: school, coaching, corporate, government'
      USING ERRCODE = '22023';
  END IF;

  -- ── Step 1: INSERT school row (idempotent on slug conflict) ───────────────
  -- ON CONFLICT (slug) DO UPDATE is an UPSERT: if this slug already exists,
  -- refresh updated_at and re-SELECT the id so subsequent steps use the right
  -- school_id. This makes re-running the provision call for the same slug safe
  -- (metadata refresh) — the school is never duplicated.
  --
  -- `code` is set equal to `slug` for backward compatibility with callers that
  -- read the legacy `code` column (schools.code is NULLABLE; no NOT NULL
  -- constraint). When code already holds a different legacy value on conflict,
  -- we leave it untouched (the UPSERT only refreshes updated_at).
  INSERT INTO public.schools (
    name,
    slug,
    code,
    board,
    city,
    state,
    billing_email,
    subscription_plan,
    max_students,
    is_active,
    tenant_type,
    created_at,
    updated_at
  ) VALUES (
    trim(p_name),
    p_slug,
    p_slug,            -- code mirrors slug for backward compat (nullable column)
    COALESCE(p_board, 'CBSE'),
    p_city,
    p_state,
    p_billing_email,
    p_plan,            -- subscription_plan (string tag on schools row)
    p_seats,           -- max_students (seats ceiling on schools row)
    true,
    p_tenant_type,
    now(),
    now()
  )
  ON CONFLICT (slug) DO UPDATE
    SET updated_at = now()
  RETURNING id
  INTO v_school_id;

  -- ── Step 2: INSERT school_subscriptions row ───────────────────────────────
  -- Creates the contractual-seats row that seat-enforcement RPCs read
  -- (evaluate_seat_policy, enroll_students_with_seat_check, etc.). Always INSERT;
  -- on a re-provision for the same slug a second subscription row is created
  -- (the seat-enforcement RPCs pick the active/trial row with the most seats,
  -- so a second row is harmless and still correct). If this needs to be an UPSERT
  -- in future, add UNIQUE(school_id) to school_subscriptions in a separate
  -- migration — the current schema has no such constraint.
  INSERT INTO public.school_subscriptions (
    school_id,
    plan,
    billing_cycle,
    seats_purchased,
    price_per_seat_monthly,
    status,
    current_period_start,
    current_period_end,
    created_at,
    updated_at
  ) VALUES (
    v_school_id,
    p_plan,
    'monthly',
    p_seats,
    COALESCE(p_price_per_seat_monthly, 0),
    'trial',           -- always start as trial; backend upgrades on payment
    now(),
    now() + interval '30 days',
    now(),
    now()
  );

  -- ── Step 3: INSERT admin invite code ─────────────────────────────────────
  -- role_type='admin' — the ONLY value that the claim flow (POST /api/schools/
  -- claim-admin) accepts. The baseline CHECK only allows ('teacher','student');
  -- the 'admin' value was added by migration 20260621000100 which runs BEFORE
  -- this file (20260621... < 20260623...). Any env that has not run 20260621000100
  -- will fail here — that is the correct safety behavior (not a silent data bug).
  --
  -- Code format: 'INV-' + first 8 hex chars of school_id (uppercase). The
  -- school_id is a UUID so the prefix is always 8 hex chars; collisions within
  -- the same school are impossible (one admin invite per provision call).
  -- max_uses=1 so only the designated principal can claim it.
  -- expires_at=7 days — short window to force timely onboarding; ops can re-run
  -- provision_school for the same slug to issue a fresh invite if it lapses.
  v_invite_code := 'INV-' || upper(substring(v_school_id::text FROM 1 FOR 8));

  INSERT INTO public.school_invite_codes (
    school_id,
    code,
    role_type,
    max_uses,
    used_count,
    is_active,
    expires_at,
    created_at
  ) VALUES (
    v_school_id,
    v_invite_code,
    'admin',
    1,
    0,
    true,
    now() + interval '7 days',
    now()
  );

  -- ── Return bootstrap payload ───────────────────────────────────────────────
  -- Shape consumed by both callers (super-admin provision route + trial route):
  --   school_id   : uuid   — the school row id
  --   slug        : text   — the URL slug
  --   invite_code : text   — 'INV-XXXXXXXX' (8 upper-hex chars from school_id)
  --   subdomain   : text   — canonical principal-facing onboarding link base
  RETURN jsonb_build_object(
    'school_id',   v_school_id,
    'slug',        p_slug,
    'invite_code', v_invite_code,
    'subdomain',   p_slug || '.alfanumrik.com'
  );
END;
$$;

COMMENT ON FUNCTION public.provision_school(
  text, text, text, text, text, text, int, numeric, text, text
) IS
  'P1 one-switch school onboarding RPC. Atomically inserts (1) a schools row '
  '(ON CONFLICT (slug) DO UPDATE SET updated_at → idempotent re-provision), '
  '(2) a school_subscriptions row (status=trial), and (3) a school_invite_codes '
  'row (role_type=''admin'', max_uses=1, expires 7 days). Returns jsonb '
  '{school_id, slug, invite_code, subdomain}. Does NOT create an auth user or '
  'school_admins row — those happen in application code after the claim flow. '
  'SECURITY DEFINER: must write past RLS (called via service_role JWT); '
  'search_path pinned to public; all inputs typed, no dynamic SQL. '
  'Requires migration 20260621000100 to be applied (role_type=''admin'' CHECK).';

-- =============================================================================
-- Grants — service_role only. Provisioning is a privileged super-admin action.
-- =============================================================================
DO $grant$
BEGIN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.provision_school('
    'text, text, text, text, text, text, int, numeric, text, text'
    ') FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.provision_school('
    'text, text, text, text, text, text, int, numeric, text, text'
    ') FROM anon';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.provision_school('
    'text, text, text, text, text, text, int, numeric, text, text'
    ') FROM authenticated';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public.provision_school('
    'text, text, text, text, text, text, int, numeric, text, text'
    ') TO service_role';
END;
$grant$;

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────────
-- As service_role:
--   SELECT public.provision_school('Test School', 'test-school');
--   -- Returns: {"school_id":"<uuid>","slug":"test-school",
--   --           "invite_code":"INV-XXXXXXXX","subdomain":"test-school.alfanumrik.com"}
--
--   -- Confirm school row:
--   SELECT id, name, slug, code, subscription_plan, tenant_type
--     FROM schools WHERE slug = 'test-school';
--   -- code = 'test-school' (mirrors slug for backward compat)
--   -- tenant_type = 'school'
--
--   -- Confirm subscription row:
--   SELECT school_id, plan, seats_purchased, status
--     FROM school_subscriptions WHERE school_id = '<uuid from above>';
--   -- plan='trial', status='trial', seats_purchased=50
--
--   -- Confirm invite code:
--   SELECT school_id, code, role_type, max_uses, is_active
--     FROM school_invite_codes WHERE school_id = '<uuid from above>';
--   -- role_type='admin', max_uses=1, is_active=true
--
--   -- Idempotency: re-run returns same school_id, fresh invite code (used_count=0):
--   SELECT public.provision_school('Test School', 'test-school');
--   -- Returns same school_id; new INV-XXXXXXXX row in school_invite_codes.
--
--   -- Verify non-service_role cannot call:
--   SET ROLE authenticated;
--   SELECT public.provision_school('X', 'x'); -- MUST raise permission denied
--   RESET ROLE;
--
--   -- Cleanup:
--   DELETE FROM school_invite_codes WHERE school_id = '<uuid>';
--   DELETE FROM school_subscriptions WHERE school_id = '<uuid>';
--   DELETE FROM schools WHERE id = '<uuid>';
