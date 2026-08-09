-- Migration: 20260814000006_webhook_dedupe_on_processed_not_existence.sql
-- Purpose: Change public.record_webhook_event's dedupe semantics from
--          "a row EXISTS for this event id" to "this event was SUCCESSFULLY
--          PROCESSED", by ADDING an `already_processed` output column. This
--          converts the Razorpay webhook's retryable statuses from
--          theoretically-retryable into actually-retryable.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE DEFECT
-- ═══════════════════════════════════════════════════════════════════════════
-- record_webhook_event (baseline 00000000000000_baseline_from_prod.sql:6504-6534,
-- originally 20260425150000_payment_webhook_events.sql:50-87) does:
--
--     INSERT INTO payment_webhook_events (...) VALUES (...)
--     ON CONFLICT (razorpay_account_id, razorpay_event_id) DO NOTHING
--     RETURNING id INTO v_id;
--     -- v_id IS NULL  =>  re-SELECT the existing row, RETURN is_new = false
--
-- The webhook route (apps/host/src/app/api/payments/webhook/route.ts:556-588)
-- calls this FIRST, before any activation work. Because PostgREST commits each
-- RPC in its own transaction, the dedupe row is DURABLE the instant the RPC
-- returns — while the activation that the event is actually FOR has not been
-- attempted yet.
--
-- ─── THE FALSE-ACKNOWLEDGEMENT FAILURE MODE ────────────────────────────────
-- Delivery 1:
--   1. record_webhook_event -> is_new = true, row COMMITTED, processed_at NULL.
--   2. activate_subscription_locked fails (route:700-741).
--   3. atomic_subscription_activation_locked also fails (route:749-786).
--   4. Route marks outcome = 'failed' and returns HTTP 503 with the explicit
--      intent "so Razorpay retries the webhook" (route:757, 786).
-- Delivery 2 (Razorpay's retry — the whole point of the 503):
--   1. record_webhook_event -> the row already exists -> is_new = FALSE.
--   2. Route short-circuits on `row.is_new === false` (route:583) and returns
--      HTTP 200 { received: true, note: 'dedupe' } (route:585).
--   3. Activation is NEVER RE-ATTEMPTED. Razorpay sees 200, stops retrying,
--      and marks the event delivered.
--
-- Net effect: the retry is CONSUMED, not honoured. EVERY retryable status on
-- this route — the 503s at route:731/741/776/786/1159/1170/1201/1212/1247/1258/
-- 1348, the 500 from handleUnresolved (route:479), and the catch-all 500 — is
-- un-retryable in practice. Worse, a crash, timeout or Vercel function kill
-- BETWEEN the dedupe commit (step 1) and the activation loses the event
-- PERMANENTLY and SILENTLY: the row exists with processed_at NULL, every future
-- delivery is deduped away, and the customer has paid without being activated.
-- The 15s/30s Vercel timeouts make that window real, not theoretical.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY SUCCESS-BASED DEDUPE IS THE CORRECT SEMANTIC
-- ═══════════════════════════════════════════════════════════════════════════
-- Row existence answers "have I SEEN this event?". Idempotency requires
-- "have I FINISHED this event?". Those diverge exactly in the window this
-- defect lives in. The table already carries the right signal — `processed_at`
-- and `outcome`, written by mark_webhook_event_processed (baseline:5626-5638) —
-- it was simply never consulted by the dedupe decision.
--
-- The row keeps its original job (a durable, unique receipt that makes the
-- INSERT race-safe and gives the route a stable id to stamp an outcome onto).
-- What changes is only WHICH FIELD gates the short-circuit.
--
-- ─── WHICH OUTCOMES COUNT AS SUCCESS ───────────────────────────────────────
-- The CHECK constraint (baseline:12636) is:
--   outcome = ANY (ARRAY['ack','dedupe','activated','downgraded','failed',
--                        'unresolved']) OR outcome IS NULL
-- That is a permissive enumeration with no notion of terminality, so success is
-- DEFINED EXPLICITLY here, derived from the HTTP status each outcome is paired
-- with in the route (a 2xx ends Razorpay's retry chain; a 5xx continues it):
--
--   SUCCESS — terminal, route returned 2xx, must NOT be re-processed:
--     'ack'        route:624,636,882,912,1022,1054,1069,1425,1438 -> 200
--     'activated'  route:831, 1300                                -> 200
--     'downgraded' route:1350                                     -> 200
--
--   NOT SUCCESS — must allow a retry to re-attempt:
--     'failed'     route:731,776,1159,1201,1247,1339 -> 503 (Retry-After)
--     'unresolved' route:468 via handleUnresolved    -> 500 ("so Razorpay
--                  retries", route:478). Treating this as success would
--                  re-create the exact defect for unresolved-student events.
--     'dedupe'     never written to the row today (it is only a timing-metric
--                  label). Deliberately classed NOT-success: a row marked
--                  'dedupe' asserts "we recognised a duplicate", NOT "the
--                  underlying work completed". Calling it success would let a
--                  future edit resurrect this defect one level up. Misclassing
--                  it the safe way costs at most one idempotent re-attempt;
--                  misclassing it the unsafe way loses the payment.
--     NULL         received but never marked -> the crash window above.
--
--   processed_at IS NULL  =>  NOT success, regardless of outcome. Both fields
--   are required, because mark_webhook_event_processed writes them together
--   and a half-written row must fail SAFE (retry) rather than fail SILENT.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY RE-PROCESSING IS SAFE (this is what makes the semantic change sound)
-- ═══════════════════════════════════════════════════════════════════════════
-- Loosening dedupe is only correct if the work behind it is idempotent. It is,
-- and this was verified in source rather than assumed:
--
-- 1. activate_subscription_locked (baseline:134-157) takes
--      pg_advisory_xact_lock(hashtextextended('subscription:'||student_id, 0))
--    then PERFORMs activate_subscription (baseline:87-131), whose write is an
--    INSERT ... ON CONFLICT (student_id) DO UPDATE upsert on
--    student_subscriptions plus a single UPDATE students SET subscription_plan.
-- 2. atomic_subscription_activation_locked (baseline:1029-1044) takes the SAME
--    'subscription:'||student_id advisory lock and PERFORMs
--    atomic_subscription_activation (baseline:962-1023) — likewise
--    ON CONFLICT (student_id) DO UPDATE.
--    That shared lock key is what serialises two concurrent deliveries at the
--    layer that actually matters; see the CONCURRENCY note below for why the
--    lock added in THIS function is a different, narrower guarantee.
-- 3. payment_history is protected by
--      payment_history_razorpay_payment_id_key UNIQUE (baseline:15712)
--    and idx_payment_history_razorpay_pid_unique (baseline:17441). A duplicate
--    insert raises 23505, which the route already swallows, and the route
--    additionally short-circuits on an existing capture (route:636,
--    note:'already_processed').
-- 4. atomic_downgrade_subscription is a no-op against an already-free/stale row.
--
-- HONEST CAVEAT (not a blocker, stated so nobody discovers it later): both
-- activation RPCs recompute current_period_end / next_billing_at from NOW().
-- A re-processed activation therefore dates the period from the RETRY instant
-- rather than the original delivery instant. The drift equals the retry delay
-- (seconds to minutes), and it moves in the CUSTOMER'S FAVOUR. This is strictly
-- better than the status quo, where the alternative outcome is "paid, never
-- activated". It is not corrected here because doing so is a body edit to the
-- activation RPCs, which is a separate change with its own blast radius.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- CONCURRENCY — WHY THE ADVISORY LOCK IS NEEDED, AND EXACTLY WHAT IT COVERS
-- ═══════════════════════════════════════════════════════════════════════════
-- Under the OLD semantics the unique index alone was sufficient: exactly one of
-- two simultaneous deliveries won the INSERT, the other got is_new=false and
-- bailed. Under the NEW semantics that is no longer enough — an unprocessed row
-- now returns already_processed=false, so BOTH concurrent callers could read
-- "not processed yet" and both proceed.
--
--   PERFORM pg_advisory_xact_lock(
--     hashtextextended('webhook_event:'||p_account_id||':'||p_event_id, 0));
--
-- WHAT IT GUARANTEES: the insert-or-read plus the already_processed
-- determination is ATOMIC PER EVENT ID. The second caller blocks at the top of
-- the function until the first caller's transaction commits, and only THEN
-- performs its INSERT/SELECT — so it reads the post-commit state of the row
-- instead of racing against it. Without it, the sequence
-- "A reads unprocessed / B reads unprocessed / A marks processed" is possible;
-- with it, that read-modify decision is serialised. Same lock idiom and same
-- hashtextextended(text, 0) key construction as the 'subscription:'||student_id
-- locks in the activation RPCs, so the two key spaces are namespaced apart by
-- their string prefixes.
--
-- WHAT IT DOES *NOT* GUARANTEE (do not overread this): pg_advisory_XACT_lock is
-- released at the end of the RPC's OWN transaction, which under PostgREST is
-- the end of this single RPC call — NOT the end of the route handler. It
-- therefore does not hold across the route's subsequent activation work, and
-- two deliveries can still reach activation concurrently. That case is covered
-- one layer down by the 'subscription:'||student_id advisory lock inside
-- activate_subscription_locked / atomic_subscription_activation_locked, plus
-- the ON CONFLICT (student_id) upsert and the payment_history unique index.
-- The two locks are complementary, not redundant: this one makes the DEDUPE
-- DECISION atomic, that one makes the ACTIVATION WRITE atomic.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY DROP + CREATE (and why that is NOT a table drop)
-- ═══════════════════════════════════════════════════════════════════════════
-- PostgreSQL cannot change a function's return type with CREATE OR REPLACE
-- alone; adding a RETURNS TABLE column requires DROP FUNCTION first, otherwise
-- the apply fails with "cannot change return type of existing function". Same
-- constraint, same remedy, and the same in-one-transaction handling as
-- 20260727130000_rag_ncert_expose_cosine_similarity.sql (which added a single
-- RETURNS TABLE column to match_rag_chunks_ncert) and the DROP+CREATE pairs in
-- 20260813000007_reconcile_acl_drift_and_ownership_guards.sql.
--
--   * NO TABLE IS DROPPED. payment_webhook_events is not touched by any DDL
--     here, and no row in it is inserted, updated, deleted or truncated.
--   * The DROP and the CREATE are inside ONE transaction, so no session ever
--     observes a missing function; a concurrent caller blocks on the pg_proc
--     lock and then sees the new definition.
--   * The INPUT signature is byte-identical (p_account_id text, p_event_id
--     text, p_event_type text, p_raw_payload jsonb DEFAULT '{}'::jsonb), so no
--     new overload is created and the by-exact-signature REVOKEs in
--     20260516040000:77 and 20260516050000:99 — both of which run EARLIER in
--     the chain and have no IF EXISTS — still resolve on a fresh-DB replay.
--   * Plain DROP (RESTRICT, the default — no CASCADE) is used on purpose: if
--     any dependent object ever appears, the migration must fail loudly rather
--     than silently remove it. No SQL caller exists today (the only call site
--     is the Next.js route).
--
-- ⚠ SECURITY CONSEQUENCE OF THE DROP — the reason the grants below are
-- MANDATORY, not decorative. The baseline sets
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT ALL ON FUNCTIONS TO anon / authenticated / service_role
-- (baseline:22634-22637). A function RE-CREATED in `public` is therefore BORN
-- with EXECUTE granted to PUBLIC/anon/authenticated. Dropping and recreating
-- this function WITHOUT the explicit REVOKE below would silently hand an
-- unauthenticated anon-key caller the ability to write arbitrary rows into
-- payment_webhook_events (SECURITY DEFINER, RLS bypassed) and to poison the
-- payment dedupe ledger — the identical defect class closed by
-- 20260814000004 / 20260814000005. The REVOKE + GRANT pair restores EXACTLY
-- today's posture and widens nothing:
--   today: service_role only (granted 20260425150000:90; PUBLIC revoked
--          20260425150000:89 and again 20260516050000:99; anon + authenticated
--          revoked 20260516040000:77).
--   after: service_role only. Identical.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ADDITIVE RETURN SHAPE — THE ROUTE KEEPS WORKING UNCHANGED
-- ═══════════════════════════════════════════════════════════════════════════
-- Existing columns are PRESERVED IN ORDER — `is_new` first, `id` second (that
-- is the real baseline order; note it is is_new BEFORE id) — and
-- `already_processed` is APPENDED LAST. PostgREST returns named JSON objects,
-- and the route reads `row.is_new` and `row.id` by name (route:583, 587), so
-- the current route compiles and behaves EXACTLY as before this migration:
-- an existing row still yields is_new=false and the route still short-circuits.
-- The new column is inert until the route opts into it.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- BACKEND HANDOFF — REQUIRED FOLLOW-UP, NOT DONE HERE
-- ═══════════════════════════════════════════════════════════════════════════
-- This migration alone does NOT fix the bug. It only makes the fix expressible.
-- apps/host/src/app/api/payments/webhook/route.ts is backend-owned and is
-- deliberately untouched by this change. Backend must:
--
--   1. SWITCH THE SHORT-CIRCUIT. Replace
--          if (row && row.is_new === false) { return 200 dedupe }   (route:583)
--      with
--          if (row && row.already_processed === true) { return 200 dedupe }
--      and, on the not-short-circuited path, keep capturing
--      `webhookEventRowId = row?.id ?? null` for BOTH the new-row and the
--      existing-but-unprocessed cases — otherwise a retry re-runs the work and
--      then has no row id to stamp the outcome onto, and loops forever.
--
--   2. CALL mark_webhook_event_processed ON EVERY TERMINAL SUCCESS PATH.
--      Under the new semantics an unmarked row is INDISTINGUISHABLE from an
--      unfinished one, so any 2xx return that skips the mark makes that event
--      retry forever (bounded only by Razorpay's own retry policy) and
--      re-execute the idempotent activation each time. Today's coverage is
--      already close — 'ack'/'activated'/'downgraded' are stamped at
--      route:624,636,831,882,912,1022,1054,1069,1300,1350,1425,1438 — but note
--      markEvent is best-effort/non-blocking (route:52-56) and is skipped
--      entirely when webhookEventRowId is null (the dedupeErr and
--      missing-identifier branches, route:562-606). Those branches are
--      acceptable (they already proceed without dedupe), but the mark MUST NOT
--      be silently dropped on a path that does have a row id.
--
--   3. REGENERATE apps/host/src/types/database.types.ts. Its
--      `record_webhook_event.Returns` entry (currently `{ id, is_new }[]`,
--      types:25752-25763) will not type-check a read of `already_processed`.
--
--   4. UPDATE THE ROUTE'S RPC MOCKS. apps/host/src/__tests__/payments/
--      webhook-route-integration.test.ts, webhook-retry-and-dedupe-semantics.
--      test.ts, webhook-school-quarterly-invoice.test.ts and
--      webhook-concurrent-fire.test.ts all stub record_webhook_event as
--      `{ is_new, id }`. Once the route reads already_processed, an
--      undefined field silently means "not processed" — which is the SAFE
--      direction, but it makes the duplicate-suppression tests vacuous unless
--      the mocks are updated to return the field explicitly.
--
--   5. P11 REVIEW CHAIN. Payment-flow change => architect + testing + mobile
--      per .claude/CLAUDE.md P14. This migration covers the architect half of
--      the schema/ACL review only.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- BLAST RADIUS / SAFETY
-- ═══════════════════════════════════════════════════════════════════════════
-- * payment_webhook_events holds ZERO ROWS in production, so there is no
--   backfill, no reclassification of historical rows, and no possibility of
--   this migration changing the disposition of an event that already happened.
--   The first row written after deploy is the first row the new logic sees.
-- * No table, column, index, constraint, RLS policy or trigger is created,
--   altered or dropped. No DML of any kind. Table RLS posture
--   (baseline:21543-21549, service-role insert + super-admin select) unchanged.
-- * mark_webhook_event_processed is NOT modified — its accepted-outcome list
--   already covers exactly the six CHECK values.
-- * SECURITY DEFINER is RETAINED (unchanged from baseline:6505) and is
--   justified: payment_webhook_events has RLS enabled with no policy reachable
--   by anon/authenticated, and the caller is the service-role webhook route,
--   which must be able to write the receipt without a broad table grant. The
--   function takes no student identifier, performs no cross-student read, and
--   returns only a row id plus two booleans, so it cannot be used to cross the
--   P8/P13 student-data boundary. search_path is pinned to 'public'.
-- * Idempotent / replay-safe: DROP FUNCTION IF EXISTS + CREATE OR REPLACE +
--   REVOKE/GRANT (both naturally replay-safe) + assertion-only DO blocks.
--   Wrapped in BEGIN/COMMIT so the whole swap lands atomically or not at all.

BEGIN;

-- ── Pre-flight: assert the function we are about to replace is the one we
--    read. Aborts (rolling the whole transaction back) if the live shape has
--    drifted from the baseline definition this migration was written against.
DO $pre$
DECLARE
  v_overloads integer;
  v_result    text;
BEGIN
  SELECT count(*) INTO v_overloads
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'record_webhook_event';

  IF v_overloads = 0 THEN
    -- Fresh database mid-chain: nothing to replace yet. The CREATE below still
    -- establishes the correct end state, so this is informational, not fatal.
    RAISE NOTICE '20260814000006: record_webhook_event not present yet; creating fresh.';
  ELSIF v_overloads > 1 THEN
    RAISE EXCEPTION
      '20260814000006 ABORT: record_webhook_event has % overloads (expected exactly 1). '
      'DROP FUNCTION by signature would leave a stale overload that PostgREST could bind to.',
      v_overloads;
  ELSE
    SELECT pg_get_function_result(p.oid) INTO v_result
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'record_webhook_event';

    IF v_result LIKE '%already_processed%' THEN
      RAISE NOTICE '20260814000006: already_processed already present (replay); re-asserting definition.';
    END IF;

    RAISE NOTICE '20260814000006: replacing record_webhook_event, result type BEFORE = %', v_result;
  END IF;
END
$pre$;

-- ── Required by PostgreSQL: a RETURNS TABLE column cannot be added via
--    CREATE OR REPLACE ("cannot change return type of existing function").
--    This drops the FUNCTION only. The payment_webhook_events TABLE and every
--    row in it are untouched. RESTRICT (default) on purpose — fail loudly if a
--    dependent ever exists rather than cascade it away.
DROP FUNCTION IF EXISTS public.record_webhook_event(text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.record_webhook_event(
  p_account_id  text,
  p_event_id    text,
  p_event_type  text,
  p_raw_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(is_new boolean, id uuid, already_processed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id           uuid;
  v_processed_at timestamptz;
  v_outcome      text;
BEGIN
  IF p_account_id IS NULL OR length(p_account_id) = 0 THEN
    RAISE EXCEPTION 'account_id required';
  END IF;
  IF p_event_id IS NULL OR length(p_event_id) = 0 THEN
    RAISE EXCEPTION 'event_id required';
  END IF;

  -- CONCURRENCY: serialise the insert-or-read + already_processed decision per
  -- event id. Under success-based dedupe the unique index is no longer enough
  -- on its own -- two simultaneous deliveries could both read "not processed
  -- yet" and both proceed. The second caller blocks HERE until the first
  -- caller's transaction commits, then re-reads the committed row, which makes
  -- the read-modify decision atomic per event id. Scope note: this is an
  -- xact-scoped lock held only for THIS RPC's transaction, so it does not span
  -- the route's later activation work -- that is serialised separately by the
  -- 'subscription:'||student_id lock inside activate_subscription_locked /
  -- atomic_subscription_activation_locked.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('webhook_event:' || p_account_id || ':' || p_event_id, 0)
  );

  INSERT INTO public.payment_webhook_events (razorpay_account_id, razorpay_event_id, event_type, raw_payload)
  VALUES (p_account_id, p_event_id, p_event_type, COALESCE(p_raw_payload, '{}'::jsonb))
  ON CONFLICT (razorpay_account_id, razorpay_event_id) DO NOTHING
  RETURNING payment_webhook_events.id INTO v_id;

  IF v_id IS NOT NULL THEN
    -- Brand-new receipt: first delivery. Nothing has been processed yet.
    RETURN QUERY SELECT true AS is_new, v_id AS id, false AS already_processed;
    RETURN;
  END IF;

  -- Conflict path: a receipt already exists. is_new stays false for backward
  -- compatibility with the current route, but whether the caller may skip the
  -- work is now decided by processed_at + outcome, NOT by mere existence.
  SELECT pwe.id, pwe.processed_at, pwe.outcome
    INTO v_id, v_processed_at, v_outcome
    FROM public.payment_webhook_events pwe
   WHERE pwe.razorpay_account_id = p_account_id
     AND pwe.razorpay_event_id   = p_event_id;

  RETURN QUERY SELECT
    false AS is_new,
    v_id  AS id,
    -- SUCCESS is defined explicitly because the outcome CHECK constraint is a
    -- permissive enumeration with no notion of terminality. Only outcomes the
    -- route pairs with a 2xx response count:
    --   'ack' | 'activated' | 'downgraded'  -> terminal success, skip.
    -- Everything else re-attempts, ON PURPOSE:
    --   'failed'     -> route returned 503 asking Razorpay to retry.
    --   'unresolved' -> route returned 500 asking Razorpay to retry.
    --   'dedupe'     -> asserts "duplicate seen", NOT "work completed".
    --   NULL         -> received but never marked (the crash window).
    -- processed_at must ALSO be set: a half-written row fails SAFE (retry)
    -- rather than fail SILENT.
    (
      v_processed_at IS NOT NULL
      AND v_outcome IS NOT NULL
      AND v_outcome IN ('ack', 'activated', 'downgraded')
    ) AS already_processed;
END;
$fn$;

COMMENT ON FUNCTION public.record_webhook_event(text, text, text, jsonb) IS
  'Razorpay webhook event receipt + idempotency gate. Returns (is_new, id, already_processed). '
  'DEDUPE SEMANTIC as of 20260814000006: callers must short-circuit on already_processed = true, '
  'NOT on is_new = false. Row existence only proves the event was SEEN; already_processed proves it '
  'was FINISHED (processed_at IS NOT NULL AND outcome IN (''ack'',''activated'',''downgraded'') -- the '
  'outcomes the route pairs with a 2xx). ''failed'' (503) and ''unresolved'' (500) are retryable and '
  'deliberately return already_processed = false, as are ''dedupe'' and a NULL outcome. Previously the '
  'route short-circuited on is_new = false, so a retry triggered by its own 503 was answered '
  '200 {note: dedupe} without re-attempting activation -- every retryable status was un-retryable, and '
  'a crash between the dedupe commit and activation lost the event permanently. Re-processing is safe: '
  'activate_subscription_locked / atomic_subscription_activation_locked are ON CONFLICT (student_id) '
  'upserts under pg_advisory_xact_lock(''subscription:''||student_id), and payment_history is unique on '
  'razorpay_payment_id. Takes pg_advisory_xact_lock(''webhook_event:''||account||'':''||event_id) so the '
  'insert-or-read + already_processed decision is atomic per event id (xact-scoped: it does NOT span '
  'the route handler). SECURITY DEFINER: payment_webhook_events is RLS-protected with no '
  'anon/authenticated-reachable policy and the service-role webhook route must write the receipt '
  'without a broad table grant; no student identifier is accepted and no student data is returned. '
  'ACL: service_role EXECUTE only -- PUBLIC/anon/authenticated revoked (re-asserted after the '
  'DROP+CREATE, which would otherwise inherit the baseline ALTER DEFAULT PRIVILEGES grants).';

-- ── ACL: re-assert TODAY'S posture verbatim. MANDATORY after a DROP+CREATE --
-- the baseline ALTER DEFAULT PRIVILEGES (baseline:22634-22637) grants EXECUTE
-- on every newly-created public function to anon and authenticated, so
-- omitting these two lines would silently widen an RLS-bypassing
-- SECURITY DEFINER payment function to unauthenticated callers. Nothing is
-- widened: service_role was and remains the only grantee.
REVOKE ALL     ON FUNCTION public.record_webhook_event(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_webhook_event(text, text, text, jsonb) TO service_role;

-- ── Post-flight: the migration verifies its own end state and aborts the
--    transaction if any of it is wrong.
DO $post$
DECLARE
  v_oid       oid;
  v_overloads integer;
  v_result    text;
  v_outnames  text[];
  v_anon      boolean;
  v_authed    boolean;
  v_service   boolean;
BEGIN
  SELECT count(*) INTO v_overloads
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'record_webhook_event';

  IF v_overloads <> 1 THEN
    RAISE EXCEPTION
      '20260814000006 ABORT: expected exactly 1 record_webhook_event overload after apply, found %.',
      v_overloads;
  END IF;

  v_oid := to_regprocedure('public.record_webhook_event(text, text, text, jsonb)')::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      '20260814000006 ABORT: record_webhook_event(text,text,text,jsonb) does not exist after apply -- '
      'the input signature drifted, which would orphan the by-signature REVOKEs in 20260516040000/50000.';
  END IF;

  v_result := pg_get_function_result(v_oid);

  -- Exact OUT-parameter names (proargmodes 't' = TABLE column), not a LIKE on
  -- the rendered signature: a substring match on 'id ' would be satisfied by
  -- an unrelated column and could pass vacuously.
  SELECT array_agg(u.nm)
    INTO v_outnames
    FROM pg_proc p,
         LATERAL unnest(p.proargnames, p.proargmodes) AS u(nm, md)
   WHERE p.oid = v_oid
     AND u.md = 't';

  IF NOT ('already_processed' = ANY (COALESCE(v_outnames, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION
      '20260814000006 ABORT: already_processed missing from the result type (%).', v_result;
  END IF;
  -- Additive, not replacing: the route still reads is_new and id BY NAME.
  IF NOT ('is_new' = ANY (v_outnames)) OR NOT ('id' = ANY (v_outnames)) THEN
    RAISE EXCEPTION
      '20260814000006 ABORT: is_new/id missing from the result type (%) -- the webhook route reads both.',
      v_result;
  END IF;

  -- ACL assertions. Guarded with to_regrole so a non-Supabase database without
  -- the PostgREST roles does not error out on a privilege probe.
  IF to_regrole('anon') IS NOT NULL THEN
    v_anon := has_function_privilege('anon', v_oid, 'EXECUTE');
    IF v_anon THEN
      RAISE EXCEPTION
        '20260814000006 ABORT: anon can EXECUTE record_webhook_event after apply. The DROP+CREATE '
        'inherited the baseline default GRANT and the REVOKE did not take.';
    END IF;
  END IF;

  IF to_regrole('authenticated') IS NOT NULL THEN
    v_authed := has_function_privilege('authenticated', v_oid, 'EXECUTE');
    IF v_authed THEN
      RAISE EXCEPTION
        '20260814000006 ABORT: authenticated can EXECUTE record_webhook_event after apply.';
    END IF;
  END IF;

  IF to_regrole('service_role') IS NOT NULL THEN
    v_service := has_function_privilege('service_role', v_oid, 'EXECUTE');
    IF NOT v_service THEN
      RAISE EXCEPTION
        '20260814000006 ABORT: service_role LOST EXECUTE on record_webhook_event -- the webhook route '
        'would fail open into the no-dedupe degraded branch on every delivery.';
    END IF;
  END IF;

  RAISE NOTICE
    '20260814000006: record_webhook_event AFTER = % | anon=% authenticated=% service_role=%',
    v_result, COALESCE(v_anon, false), COALESCE(v_authed, false), COALESCE(v_service, true);
END
$post$;

COMMIT;

-- End of migration: 20260814000006_webhook_dedupe_on_processed_not_existence.sql
-- Changed:   public.record_webhook_event -- return shape (+already_processed),
--            dedupe semantic (existence -> successful processing), advisory lock,
--            ACL re-asserted to service_role only.
-- Untouched: the payment_webhook_events TABLE (no DDL, no DML, zero prod rows),
--            its RLS policies, mark_webhook_event_processed, the activation
--            RPCs, and the backend-owned webhook route (see BACKEND HANDOFF).
