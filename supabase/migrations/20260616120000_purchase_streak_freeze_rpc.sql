-- Migration: 20260616120000_purchase_streak_freeze_rpc.sql
-- Purpose: Restore the missing purchase_streak_freeze RPC + the streak-freeze
--          inventory columns it (and daily-cron) depend on, so the shop
--          "Streak Freeze" purchase works end-to-end and the cron can consume.
--
-- Context (RPC re-sweep 2026-06-16):
--   - src/app/api/student/shop/purchase/route.ts calls
--       supabase.rpc('purchase_streak_freeze', { p_student_id, p_cost, p_currency })
--     but the function did NOT exist on prod → every /profile shop purchase 500'd.
--   - supabase/functions/daily-cron/index.ts resetMissedStreaks() reads/writes
--       students.freezes_available / freezes_used_total / last_freeze_used_at,
--     but those columns did NOT exist on prod → the freeze branch silently
--     no-op'd (query error caught as a warning) and freezes were never applied.
--   This migration closes both gaps. It is additive + idempotent.
--
-- Currency model (verified live):
--   - coins  → coin_balances(student_id, balance) + coin_transactions ledger
--              (same tables award_coins uses; coin_transactions.source must be one
--               of the coin_transactions_source_check allow-list values, so we use
--               'redemption' — the canonical source for spending coins on a shop
--               item — and record the specific item in metadata).
--   - xp     → students.xp (integer running balance).
--   The spend is atomic with the inventory grant in one transaction.
--   Insufficient balance RAISEs the exact messages the route + tests expect:
--   'Insufficient coin balance' / 'Insufficient XP balance'.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Streak-freeze inventory columns on students (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS freezes_available  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freezes_used_total INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_freeze_used_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. purchase_streak_freeze RPC
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purchase_streak_freeze(
  p_student_id UUID,
  p_cost       INTEGER,
  p_currency   TEXT
)
RETURNS INTEGER          -- new spendable balance (coins or xp) after the purchase
LANGUAGE plpgsql
SECURITY DEFINER         -- spends another currency atomically; route gates RBAC
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  IF p_cost IS NULL OR p_cost <= 0 THEN
    RAISE EXCEPTION 'Invalid cost';
  END IF;

  IF p_currency = 'coins' THEN
    -- Lock the balance row to serialize concurrent spends.
    SELECT COALESCE(balance, 0) INTO v_balance
      FROM coin_balances
     WHERE student_id = p_student_id
       FOR UPDATE;

    IF v_balance IS NULL THEN v_balance := 0; END IF;
    IF v_balance < p_cost THEN
      RAISE EXCEPTION 'Insufficient coin balance';
    END IF;

    -- Ledger + balance debit (mirror award_coins's table shape, negative amount).
    INSERT INTO coin_transactions (student_id, amount, source, metadata)
      VALUES (p_student_id, -p_cost, 'redemption',
              jsonb_build_object('item', 'streak_freeze'));

    UPDATE coin_balances
       SET balance = balance - p_cost, updated_at = now()
     WHERE student_id = p_student_id;

    v_balance := v_balance - p_cost;

  ELSIF p_currency = 'xp' THEN
    -- Lock the student row to serialize concurrent spends.
    SELECT COALESCE(xp, 0) INTO v_balance
      FROM students
     WHERE id = p_student_id
       FOR UPDATE;

    IF v_balance IS NULL THEN v_balance := 0; END IF;
    IF v_balance < p_cost THEN
      RAISE EXCEPTION 'Insufficient XP balance';
    END IF;

    UPDATE students
       SET xp = xp - p_cost
     WHERE id = p_student_id;

    v_balance := v_balance - p_cost;

  ELSE
    RAISE EXCEPTION 'Invalid currency: %', p_currency;
  END IF;

  -- Grant the streak freeze (same columns daily-cron consumes).
  UPDATE students
     SET freezes_available = COALESCE(freezes_available, 0) + 1,
         updated_at = now()
   WHERE id = p_student_id;

  RETURN v_balance;
END;
$$;

-- Service-role-only: the route calls this via supabaseAdmin after authorizeRequest
-- ('profile.update_own'). Match award_coins's grant posture (no anon/authenticated).
REVOKE ALL ON FUNCTION public.purchase_streak_freeze(UUID, INTEGER, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purchase_streak_freeze(UUID, INTEGER, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.purchase_streak_freeze(UUID, INTEGER, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_streak_freeze(UUID, INTEGER, TEXT) TO service_role;
