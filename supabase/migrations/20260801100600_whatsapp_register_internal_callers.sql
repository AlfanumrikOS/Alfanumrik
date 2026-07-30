-- Migration: 20260801100600_whatsapp_register_internal_callers.sql
-- Purpose: WhatsApp study bot — register the new outbound Edge Function
--          (whatsapp-send) in the Platform Security Layer: quota profile,
--          route policy, and the two internal-caller registrations for the
--          Next.js routes that sign POSTs to it.
--
-- whatsapp-send is an internal-service-only function: only signed Next.js
-- callers (whatsapp-webhook-route, whatsapp-drain-cron) may call it. No
-- student JWT, no bare service-role bearer is admitted
-- (allow_jwt = false, allow_service_role = false, allow_signed_internal = true).
--
-- ─── THE NAME-MATCH TRAP (the 20260722094000 lesson — read before editing) ───
-- supabase/functions/_shared/security/auth.ts verifies the x-internal-caller
-- header via security_resolve_internal_caller(p_caller_name), which looks up
-- security_internal_callers.name. The `name` values seeded here MUST match
-- BYTE-FOR-BYTE (case-sensitive) the literal `caller` argument each Next.js
-- caller passes to buildInternalCallerHeaders():
--   'whatsapp-webhook-route' — apps/host/src/app/api/whatsapp/webhook/route.ts
--                              (the after() inline-processing send path)
--   'whatsapp-drain-cron'    — apps/host/src/app/api/cron/whatsapp-drain/route.ts
--                              (the pending-event retry sweep)
-- These strings are matched 1:1 against the caller source, never guessed. If
-- a caller literal ever changes, this registration must change in the same
-- PR, or every send is rejected with a signature/caller-resolution failure.
--
-- This migration follows the EXACT registration pattern established in
-- 20260620001500_whatsapp_notify_security_policy.sql (quota profile + route
-- policy + caller rows) and 20260722094000_whatsapp_notify_register_
-- adaptive_remediation_caller.sql (byte-for-byte caller-name discipline).
-- caller_kind is 'service_name' for BOTH rows, per 20260722094000's
-- reasoning: whatsapp-drain-cron is Vercel-cron-triggered, but as a CALLER
-- of whatsapp-send it plays the identical role to the other signed
-- Next.js-side service callers ('cron_job' is reserved for cron Edge
-- Functions themselves, per 20260618093000).
--
-- No behavior change while the ff_whatsapp_* flags remain OFF (seeded OFF in
-- 20260801100500): the call sites this unblocks are unreachable until the
-- flags are flipped.
--
-- Idempotent + fresh-DB-safe: DO block with to_regclass guards (no-ops
-- cleanly if the security_* tables are absent, mirroring 20260801100500's
-- guard shape); ON CONFLICT on every insert. Additive only — data seeds, no
-- schema changes, so RLS N/A; the security_* tables keep their posture.
--
-- Owner: architect. Added: 2026-08-01 (WhatsApp bot plan, migration 7 of 7 —
-- Phase-2 scope registers whatsapp-send only; whatsapp-agent gets its own
-- registration when that function ships in Phase 3).
-- Plan: plan-alfanumrik-whatsapp-bot-mighty-frost.md (Migrations table,
-- row 7; ADDENDUM 2 Phase-2 scope).
--
-- ─── Rollback (MANUAL ONLY — never auto-run) ─────────────────────────────────
--   DELETE FROM public.security_route_policies   WHERE route = 'whatsapp-send';
--   DELETE FROM public.security_internal_callers
--     WHERE name IN ('whatsapp-webhook-route','whatsapp-drain-cron');
--   DELETE FROM public.security_quota_profiles
--     WHERE name = 'whatsapp-send-internal_service';
-- (children first — security_internal_callers.quota_profile_id is
-- ON DELETE RESTRICT against the profile.)

DO $whatsapp_send_security$
BEGIN
  IF to_regclass('public.security_quota_profiles') IS NULL
     OR to_regclass('public.security_route_policies') IS NULL
     OR to_regclass('public.security_internal_callers') IS NULL THEN
    RAISE NOTICE 'Platform Security Layer tables absent; skipping whatsapp-send registration (fresh DB).';
    RETURN;
  END IF;

  -- ── 1. Quota profile ──────────────────────────────────────────────────────
  -- Token limits are zero (WhatsApp provider API, not an LLM token-counted
  -- API) — mirrored into the input-token columns as request-shaped values,
  -- same convention as whatsapp-notify-internal_service (20260620001500).
  -- Request limits are sized for the 50-student beta: per-recipient cap is
  -- 40/day (whatsapp_record_send, 20260801100200) → 2,000/day theoretical
  -- ceiling. Cost limits cover paid template sends only (session sends are
  -- free); revisit BOTH at production ramp — this profile is deliberately
  -- tight so the ramp is an explicit, reviewed migration.

  INSERT INTO public.security_quota_profiles (
    name, scope, role, route,
    requests_daily_limit, requests_monthly_limit,
    input_tokens_daily_limit, input_tokens_monthly_limit,
    output_tokens_daily_limit, output_tokens_monthly_limit,
    estimated_cost_daily_limit, estimated_cost_monthly_limit,
    max_concurrent_requests, circuit_breaker_threshold, enforcement_mode
  ) VALUES (
    'whatsapp-send-internal_service',
    'internal_service',
    'internal_service',
    'whatsapp-send',
    2000,  60000,
    2000,  60000,
    0,     0,
    1.00,  30.00,
    10, 5, 'enforce'
  )
  ON CONFLICT (name) DO UPDATE SET
    scope                       = EXCLUDED.scope,
    role                        = EXCLUDED.role,
    route                       = EXCLUDED.route,
    requests_daily_limit        = EXCLUDED.requests_daily_limit,
    requests_monthly_limit      = EXCLUDED.requests_monthly_limit,
    input_tokens_daily_limit    = EXCLUDED.input_tokens_daily_limit,
    input_tokens_monthly_limit  = EXCLUDED.input_tokens_monthly_limit,
    output_tokens_daily_limit   = EXCLUDED.output_tokens_daily_limit,
    output_tokens_monthly_limit = EXCLUDED.output_tokens_monthly_limit,
    estimated_cost_daily_limit  = EXCLUDED.estimated_cost_daily_limit,
    estimated_cost_monthly_limit= EXCLUDED.estimated_cost_monthly_limit,
    max_concurrent_requests     = EXCLUDED.max_concurrent_requests,
    circuit_breaker_threshold   = EXCLUDED.circuit_breaker_threshold,
    enforcement_mode            = EXCLUDED.enforcement_mode,
    updated_at                  = now();

  -- ── 2. Route policy ───────────────────────────────────────────────────────
  -- Only signed internal callers may access whatsapp-send.
  -- allow_jwt = false, allow_service_role = false, allow_signed_internal = true.
  -- internal_caller_id = NULL: the policy admits ANY active, signed
  -- internal_service caller on this route (same generic shape as
  -- whatsapp-notify's policy, which 20260722094000 reused unchanged when
  -- adding a 4th caller). policy_key is auto-generated by DB trigger; we use
  -- ON CONFLICT (policy_key) DO NOTHING, matching 20260620001500.

  INSERT INTO public.security_route_policies (
    route, school_id, role, caller_type, internal_caller_id,
    quota_profile_id,
    enforcement_mode,
    allow_signed_internal, allow_jwt, allow_service_role,
    is_enabled
  )
  SELECT
    'whatsapp-send',
    NULL,
    NULL,
    'internal_service',
    NULL,
    p.id,
    'enforce',
    true, false, false,
    true
  FROM public.security_quota_profiles p
  WHERE p.name = 'whatsapp-send-internal_service'
  ON CONFLICT (policy_key) DO NOTHING;

  -- ── 3. Internal caller registrations ──────────────────────────────────────
  -- The two Next.js callers that POST to whatsapp-send. Names MUST match the
  -- buildInternalCallerHeaders caller literals byte-for-byte — see the
  -- header-comment trap above before renaming anything.

  INSERT INTO public.security_internal_callers (
    name, owner, description, status, caller_kind, quota_profile_id
  )
  SELECT
    caller_name,
    'platform',
    caller_desc,
    'active',
    'service_name',
    p.id
  FROM (
    VALUES
      ('whatsapp-webhook-route', 'Next.js /api/whatsapp/webhook route (after() inline processing path) posting to whatsapp-send'),
      ('whatsapp-drain-cron',    'Next.js /api/cron/whatsapp-drain route (pending inbound-event retry sweep) posting to whatsapp-send')
  ) AS callers(caller_name, caller_desc)
  CROSS JOIN public.security_quota_profiles p
  WHERE p.name = 'whatsapp-send-internal_service'
  ON CONFLICT (name) DO UPDATE SET
    status      = EXCLUDED.status,
    description = EXCLUDED.description;
END $whatsapp_send_security$;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- 1. SELECT name, route, enforcement_mode FROM security_quota_profiles
--      WHERE name = 'whatsapp-send-internal_service';
--    -- expect: 1 row, route 'whatsapp-send', 'enforce'.
-- 2. SELECT route, caller_type, allow_signed_internal, allow_jwt,
--           allow_service_role, is_enabled
--      FROM security_route_policies WHERE route = 'whatsapp-send';
--    -- expect: 1 row: internal_service, true, false, false, true.
-- 3. SELECT name, status, caller_kind FROM security_internal_callers
--      WHERE name IN ('whatsapp-webhook-route','whatsapp-drain-cron');
--    -- expect: 2 rows, both active / service_name.
-- 4. grep the caller literals against the source once the routes land:
--      rg "buildInternalCallerHeaders\(.*'whatsapp-(webhook-route|drain-cron)'"
--        apps/host/src/app/api/whatsapp/ apps/host/src/app/api/cron/
--    -- expect: exactly the two names seeded here, byte-identical.
