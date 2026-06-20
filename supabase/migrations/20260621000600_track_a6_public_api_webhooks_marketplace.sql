-- Migration: 20260621000600_track_a6_public_api_webhooks_marketplace.sql
-- Purpose: Track A.6 (public API v1 + outbound webhooks + marketplace) — the
--          architect-owned SCHEMA + SECURITY foundation. Backend builds the
--          endpoints + the webhook dispatcher + the marketplace UI on top of
--          THIS schema afterward. THREE cohesive parts, all ADDITIVE + IDEMPOTENT:
--            (A) Outbound webhooks: webhook_subscriptions (per-school HMAC-signed
--                event sinks) + webhook_deliveries (delivery log + dead-letter
--                queue). RLS inline (P8).
--            (B) Marketplace: integration_listings (world-readable catalog) +
--                integration_installs (own-school installs). RLS inline (P8).
--            (C) Public-API key reuse note: NO new key table. The existing
--                `school_api_keys` table (baseline) already backs public-API keys
--                with a HASHED key, a TEXT[] scope column (`permissions`),
--                `expires_at`, `is_active`, and own-school RLS — so Track A.6 key
--                auth (src/lib/public-api/auth.ts) reuses it as-is. This part only
--                documents that decision + asserts the table's shape is present so
--                a fresh DB that somehow lacks it fails LOUD here rather than at
--                runtime. NO columns are added (the table is already complete).
--
-- ─── Scope / safety contract (HARD CONSTRAINTS) ──────────────────────────────
--   - ADDITIVE ONLY. No DROP TABLE / DROP COLUMN / DELETE / UPDATE / TRUNCATE of
--     data. The only DROPs are DROP POLICY IF EXISTS / DROP TRIGGER IF EXISTS,
--     each immediately followed by an equivalent CREATE in the same transaction
--     (Postgres has no CREATE OR REPLACE POLICY).
--   - IDEMPOTENT / replayable on PROD, main-staging, CI live-DB, and fresh DBs:
--       CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--       CREATE OR REPLACE FUNCTION, DROP POLICY/TRIGGER IF EXISTS + CREATE.
--   - EVERY new table ENABLEs ROW LEVEL SECURITY + ships policies in THIS file (P8).
--   - SECRETS ARE HASHED ONLY (P13): webhook_subscriptions stores `secret_hash`
--     (SHA-256 of the HMAC signing secret), NEVER the raw secret. The raw secret
--     is returned to the school admin EXACTLY ONCE at creation time by the backend
--     route and is never persisted in plaintext (mirrors school_api_keys.key_hash
--     and school_admin_claim_tokens.token_hash). No PII columns on any table here.
--   - P5: grades untouched (school context is uuid-keyed; no grade column).
--   - NO SECURITY DEFINER functions in this file (only an updated_at trigger fn,
--     which is the standard SECURITY INVOKER pattern).
--   - NO feature_flags touched here; the public-API surface is gated at the route
--     layer by the existing public_api.manage RBAC code + the per-key scope check.
--
-- ─── TENANT-ISOLATION CONTRACT (P8/P9) ───────────────────────────────────────
--   Every tenant-owned table here carries a NOT NULL school_id FK to schools(id)
--   and an own-school authenticated policy of the established membership form
--   (`is_school_admin_of(school_id)` — the same helper used across Track A Phase 1
--   and the baseline school-admin policies). A school admin can therefore read /
--   manage ONLY their own school's webhook subscriptions and integration installs;
--   delivery rows are service-role / admin read-only (the dispatcher writes them).
--   The public-API key boundary (src/lib/public-api/auth.ts) derives school_id
--   from the KEY, never from request input — see that file's header.
--
-- Owner: architect. Track A.6 — public API v1 + outbound webhooks + marketplace
-- (CEO launch decision #4). Branch feat/track-a-launch.

BEGIN;

-- =============================================================================
-- PART C (assertion first) — PUBLIC-API KEYS REUSE `school_api_keys` AS-IS.
-- =============================================================================
-- No new key table. Assert the baseline table + the columns the public-API auth
-- helper depends on actually exist, so a fresh/misconfigured DB fails LOUD here
-- (at migrate time) instead of silently at the first API call. Pure read of the
-- catalog; raises if the contract is broken. Idempotent (only ever RAISEs or
-- no-ops). The columns asserted are exactly what src/lib/public-api/auth.ts reads:
--   key_hash (hashed key), permissions (TEXT[] scopes), expires_at, is_active,
--   school_id (the tenant the key belongs to).
DO $$
DECLARE
  v_found integer;
BEGIN
  -- Count how many of the 5 required columns are present. All 5 must exist.
  SELECT COUNT(DISTINCT column_name)
    INTO v_found
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'school_api_keys'
     AND column_name IN ('key_hash', 'permissions', 'expires_at', 'is_active', 'school_id');

  IF v_found <> 5 THEN
    RAISE EXCEPTION 'Track A.6 precondition failed: public.school_api_keys must '
      'expose key_hash, permissions, expires_at, is_active, school_id (public-API '
      'key auth depends on these). Apply the baseline before this migration.';
  END IF;
END $$;

-- =============================================================================
-- PART A — OUTBOUND WEBHOOKS (subscriptions + delivery log / DLQ)
-- =============================================================================

-- A.1 webhook_subscriptions — per-school registration of an event sink.
-- A school admin registers a target_url, the set of event_types they want, and a
-- signing secret (raw shown ONCE; only secret_hash stored). The dispatcher
-- (backend, later) signs each delivery body with HMAC-SHA256 using the raw secret
-- the school stored on their side and stamps an X-Alfanumrik-Signature header;
-- the school verifies it. We persist ONLY the hash so a DB compromise cannot
-- forge signatures for an existing subscription.
CREATE TABLE IF NOT EXISTS "public"."webhook_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "school_id" uuid NOT NULL REFERENCES "public"."schools"("id") ON DELETE CASCADE,
  "target_url" text NOT NULL,
  -- Subscribed event names, e.g. {'student.enrolled','report.generated'}.
  -- An empty array means "no events" (effectively paused); the dispatcher treats
  -- a non-matching subscription as a no-op.
  "event_types" text[] NOT NULL DEFAULT '{}',
  -- SHA-256 of the HMAC signing secret. NEVER the raw secret (P13).
  "secret_hash" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  -- Optional human label + the admin who created it (audit; not PII-bearing here).
  "description" text,
  "created_by" uuid REFERENCES "auth"."users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  -- target_url must look like an https URL (defense-in-depth; the dispatcher also
  -- validates + blocks private/loopback ranges to prevent SSRF — documented for
  -- backend below). https-only so signed payloads are never sent in cleartext.
  CONSTRAINT "webhook_subscriptions_https_only" CHECK ("target_url" ~* '^https://')
);

CREATE INDEX IF NOT EXISTS "idx_webhook_subscriptions_school"
  ON "public"."webhook_subscriptions" ("school_id") WHERE "is_active" = true;
-- GIN index so the dispatcher can fan out by event name efficiently.
CREATE INDEX IF NOT EXISTS "idx_webhook_subscriptions_events"
  ON "public"."webhook_subscriptions" USING GIN ("event_types") WHERE "is_active" = true;

ALTER TABLE "public"."webhook_subscriptions" ENABLE ROW LEVEL SECURITY;

-- Service role (the dispatcher + admin tooling) — full access.
DROP POLICY IF EXISTS "webhook_subscriptions_service_role" ON "public"."webhook_subscriptions";
CREATE POLICY "webhook_subscriptions_service_role"
  ON "public"."webhook_subscriptions"
  TO "service_role"
  USING (true) WITH CHECK (true);

-- School admin — manage ONLY their own school's subscriptions (P8). One ALL-verb
-- policy keyed on is_school_admin_of(school_id) for both the USING (read/update/
-- delete visibility) and WITH CHECK (insert/update destination) sides, so a school
-- admin can never create or move a subscription into another school.
DROP POLICY IF EXISTS "webhook_subscriptions_admin_all" ON "public"."webhook_subscriptions";
CREATE POLICY "webhook_subscriptions_admin_all"
  ON "public"."webhook_subscriptions"
  FOR ALL TO "authenticated"
  USING (
    "school_id" IS NOT NULL
    AND "public"."is_school_admin_of"("school_id")
  )
  WITH CHECK (
    "school_id" IS NOT NULL
    AND "public"."is_school_admin_of"("school_id")
  );

-- A.2 webhook_deliveries — the delivery LOG + DEAD-LETTER QUEUE.
-- One row per (event, subscription) delivery attempt-chain. The dispatcher
-- inserts a 'pending' row, attempts POST, and on failure schedules a retry by
-- bumping `attempts`, setting `next_retry_at`, and recording `last_error`. When
-- attempts exhaust the backoff schedule the row terminates in 'dead_letter' and
-- stops being picked up — it remains as an inspectable DLQ entry an operator can
-- replay. `payload` is the exact signed body that was/should be sent.
--
-- ─── RETRY / BACKOFF / DEAD-LETTER CONTRACT (backend implements; pinned here) ──
--   status lifecycle: 'pending' → ('delivered' | 'failed' → retry → ...) →
--                     'dead_letter' (terminal after max attempts).
--   Backoff schedule (exponential, capped): the dispatcher computes
--     next_retry_at = now() + LEAST(cap, base * 2^(attempts-1)) with jitter.
--     Recommended: base 60s, cap 6h, MAX_ATTEMPTS 8 (~ up to ~24h of retries).
--   A row is eligible for the worker when status IN ('pending','failed')
--     AND (next_retry_at IS NULL OR next_retry_at <= now()).
--   On the (MAX_ATTEMPTS)th failure the worker sets status='dead_letter' and
--     leaves next_retry_at NULL so it is never re-picked automatically.
--   Idempotency: deliveries carry the originating event id in `event` /payload so
--     a consumer can dedupe; the dispatcher should also dedupe (subscription_id,
--     event id) before insert. Operator replay = reset status='pending',
--     attempts unchanged-or-reset, next_retry_at=now() (service-role only).
CREATE TABLE IF NOT EXISTS "public"."webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "subscription_id" uuid NOT NULL
    REFERENCES "public"."webhook_subscriptions"("id") ON DELETE CASCADE,
  -- Denormalised school_id (copied from the subscription at enqueue) so delivery
  -- reads/cleanup can scope by tenant without a join; kept NOT NULL.
  "school_id" uuid NOT NULL REFERENCES "public"."schools"("id") ON DELETE CASCADE,
  -- The event name being delivered (e.g. 'student.enrolled').
  "event" text NOT NULL,
  -- The exact JSON body the dispatcher signs + POSTs.
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'pending'
    CHECK ("status" IN ('pending', 'delivered', 'failed', 'dead_letter')),
  "attempts" integer NOT NULL DEFAULT 0,
  "next_retry_at" timestamptz,
  -- Truncated error string from the last failed attempt (NO PII; status line /
  -- short body only — the dispatcher truncates before writing, P13).
  "last_error" text,
  "delivered_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Worker pickup index: pending/failed rows that are due, oldest first.
CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_due"
  ON "public"."webhook_deliveries" ("next_retry_at")
  WHERE "status" IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_subscription"
  ON "public"."webhook_deliveries" ("subscription_id");
CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_school"
  ON "public"."webhook_deliveries" ("school_id");
-- Dead-letter inspection index.
CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_dead_letter"
  ON "public"."webhook_deliveries" ("school_id", "created_at")
  WHERE "status" = 'dead_letter';

ALTER TABLE "public"."webhook_deliveries" ENABLE ROW LEVEL SECURITY;

-- Service role (the dispatcher) — full access (it is the only writer).
DROP POLICY IF EXISTS "webhook_deliveries_service_role" ON "public"."webhook_deliveries";
CREATE POLICY "webhook_deliveries_service_role"
  ON "public"."webhook_deliveries"
  TO "service_role"
  USING (true) WITH CHECK (true);

-- School admin — READ-ONLY visibility into their own school's delivery log / DLQ
-- (P8). No INSERT/UPDATE/DELETE policy for authenticated → school admins cannot
-- fabricate or mutate delivery rows; only the dispatcher (service role) writes.
DROP POLICY IF EXISTS "webhook_deliveries_admin_select" ON "public"."webhook_deliveries";
CREATE POLICY "webhook_deliveries_admin_select"
  ON "public"."webhook_deliveries"
  FOR SELECT TO "authenticated"
  USING (
    "school_id" IS NOT NULL
    AND "public"."is_school_admin_of"("school_id")
  );

-- =============================================================================
-- PART B — MARKETPLACE (listings catalog + per-school installs)
-- =============================================================================

-- B.1 integration_listings — the world-readable catalog of installable
-- integrations (SIS/LMS/SSO connectors, webhook recipes, etc.). This is platform
-- content, NOT school-owned: any AUTHENTICATED user may READ the active catalog;
-- only the service role / platform ops may write it. scopes_required documents the
-- public-API scopes an install of this listing will need (the same vocabulary as
-- school_api_keys.permissions) so the install flow can request consent up front.
CREATE TABLE IF NOT EXISTS "public"."integration_listings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  -- Public-API scopes this integration needs once installed (e.g.
  -- {'students.read','reports.read'}). Shared vocabulary with school_api_keys.
  "scopes_required" text[] NOT NULL DEFAULT '{}',
  -- Optional presentation / discovery metadata (logo, category, docs url, …).
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Slug is the stable public identifier — unique across the catalog.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_integration_listings_slug"
  ON "public"."integration_listings" ("slug");
CREATE INDEX IF NOT EXISTS "idx_integration_listings_active"
  ON "public"."integration_listings" ("is_active") WHERE "is_active" = true;

ALTER TABLE "public"."integration_listings" ENABLE ROW LEVEL SECURITY;

-- Service role — full access (platform ops curate the catalog).
DROP POLICY IF EXISTS "integration_listings_service_role" ON "public"."integration_listings";
CREATE POLICY "integration_listings_service_role"
  ON "public"."integration_listings"
  TO "service_role"
  USING (true) WITH CHECK (true);

-- World-readable to AUTHENTICATED users — but only ACTIVE listings (an inactive/
-- retired listing is not browsable; service role still sees all). No write policy
-- for authenticated → the catalog is read-only to every non-service caller.
DROP POLICY IF EXISTS "integration_listings_authenticated_select" ON "public"."integration_listings";
CREATE POLICY "integration_listings_authenticated_select"
  ON "public"."integration_listings"
  FOR SELECT TO "authenticated"
  USING ("is_active" = true);

-- B.2 integration_installs — a school's installation of a catalog listing.
-- Own-school only (P8): a school admin manages installs for their own school and
-- can never see/alter another school's installs. `config` holds non-secret
-- install configuration (any secret an install needs is stored hashed elsewhere —
-- e.g. an issued school_api_key.key_hash or a webhook_subscriptions.secret_hash —
-- never raw in this jsonb; documented for backend below).
CREATE TABLE IF NOT EXISTS "public"."integration_installs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "school_id" uuid NOT NULL REFERENCES "public"."schools"("id") ON DELETE CASCADE,
  "listing_id" uuid NOT NULL
    REFERENCES "public"."integration_listings"("id") ON DELETE RESTRICT,
  -- Install lifecycle: pending → active → (paused) → uninstalled (terminal).
  "status" text NOT NULL DEFAULT 'pending'
    CHECK ("status" IN ('pending', 'active', 'paused', 'uninstalled')),
  "installed_by" uuid REFERENCES "auth"."users"("id"),
  -- Non-secret per-install configuration. NEVER raw secrets/keys (P13).
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "installed_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- A school installs a given listing at most once (re-install = flip status back to
-- active on the existing row). Partial unique excludes uninstalled rows so a
-- school can re-install after uninstalling.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_integration_installs_school_listing"
  ON "public"."integration_installs" ("school_id", "listing_id")
  WHERE "status" <> 'uninstalled';
CREATE INDEX IF NOT EXISTS "idx_integration_installs_school"
  ON "public"."integration_installs" ("school_id");
CREATE INDEX IF NOT EXISTS "idx_integration_installs_listing"
  ON "public"."integration_installs" ("listing_id");

ALTER TABLE "public"."integration_installs" ENABLE ROW LEVEL SECURITY;

-- Service role — full access (backend install/uninstall orchestration).
DROP POLICY IF EXISTS "integration_installs_service_role" ON "public"."integration_installs";
CREATE POLICY "integration_installs_service_role"
  ON "public"."integration_installs"
  TO "service_role"
  USING (true) WITH CHECK (true);

-- School admin — manage ONLY their own school's installs (P8). ALL-verb membership
-- policy on both USING and WITH CHECK so an install can never be created in or
-- moved to another school.
DROP POLICY IF EXISTS "integration_installs_admin_all" ON "public"."integration_installs";
CREATE POLICY "integration_installs_admin_all"
  ON "public"."integration_installs"
  FOR ALL TO "authenticated"
  USING (
    "school_id" IS NOT NULL
    AND "public"."is_school_admin_of"("school_id")
  )
  WITH CHECK (
    "school_id" IS NOT NULL
    AND "public"."is_school_admin_of"("school_id")
  );

-- =============================================================================
-- updated_at triggers (standard SECURITY INVOKER pattern; one shared fn).
-- =============================================================================
CREATE OR REPLACE FUNCTION "public"."update_track_a6_updated_at"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS "trg_webhook_subscriptions_updated_at" ON "public"."webhook_subscriptions";
CREATE TRIGGER "trg_webhook_subscriptions_updated_at"
  BEFORE UPDATE ON "public"."webhook_subscriptions"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_track_a6_updated_at"();

DROP TRIGGER IF EXISTS "trg_webhook_deliveries_updated_at" ON "public"."webhook_deliveries";
CREATE TRIGGER "trg_webhook_deliveries_updated_at"
  BEFORE UPDATE ON "public"."webhook_deliveries"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_track_a6_updated_at"();

DROP TRIGGER IF EXISTS "trg_integration_listings_updated_at" ON "public"."integration_listings";
CREATE TRIGGER "trg_integration_listings_updated_at"
  BEFORE UPDATE ON "public"."integration_listings"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_track_a6_updated_at"();

DROP TRIGGER IF EXISTS "trg_integration_installs_updated_at" ON "public"."integration_installs";
CREATE TRIGGER "trg_integration_installs_updated_at"
  BEFORE UPDATE ON "public"."integration_installs"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_track_a6_updated_at"();

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────────
-- 1. All four new tables exist with RLS forced on:
--      SELECT relname, relrowsecurity FROM pg_class
--       WHERE relname IN ('webhook_subscriptions','webhook_deliveries',
--                         'integration_listings','integration_installs');
--      -- relrowsecurity = true for all four.
-- 2. Tenant isolation (as a school admin of school A, authenticated):
--      INSERT INTO webhook_subscriptions (school_id, target_url, secret_hash)
--        VALUES (<school B>, 'https://x', 'h');   -- DENIED (WITH CHECK fails)
--      SELECT count(*) FROM webhook_subscriptions WHERE school_id = <school B>; -- 0
--      SELECT count(*) FROM integration_installs WHERE school_id = <school B>;  -- 0
-- 3. Marketplace catalog readable to any authenticated user, active-only:
--      SELECT count(*) FROM integration_listings;  -- = number of ACTIVE listings
-- 4. Deliveries are read-only to admins:
--      INSERT INTO webhook_deliveries (...) -- DENIED for authenticated (no policy)
-- 5. https-only guard:
--      INSERT INTO webhook_subscriptions (school_id, target_url, secret_hash)
--        VALUES (<own school>, 'http://x', 'h'); -- DENIED (CHECK constraint)
