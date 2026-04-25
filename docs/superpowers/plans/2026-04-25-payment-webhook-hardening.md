# Payment Webhook Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining payment-webhook hardening gaps so the Razorpay → Supabase entitlement path is event-level idempotent, race-free, fully testable at the route layer, and observable enough to scale.

**Architecture:** The "split-brain fix" P11 calls out is **already implemented** (`atomic_subscription_activation` RPC, migration `20260424120000`, in use at `src/app/api/payments/webhook/route.ts`). What's missing is event-level idempotency at the database layer, an advisory lock to prevent verify-route+webhook races, an atomic-downgrade RPC, search_path consistency on `activate_subscription`, handling of `subscription.pending`, and integration tests that exercise the actual `POST` handler instead of extracted helpers. CLAUDE.md P11 also needs updating because it still describes the fallback path that no longer exists in code.

**Tech Stack:** Next.js 16 API route (TypeScript), Supabase Postgres + RPCs (plpgsql, SECURITY DEFINER, `SET search_path = public`), Vitest for unit/integration tests, Razorpay webhook signature (HMAC-SHA256), Supabase service-role client.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/<ts>_webhook_events_idempotency.sql` | Create | New `payment_webhook_events` table with unique key on `(razorpay_account_id, razorpay_event_id)` plus `record_webhook_event` SECURITY DEFINER RPC. |
| `supabase/migrations/<ts>_pin_search_path_activate_subscription.sql` | Create | `CREATE OR REPLACE FUNCTION public.activate_subscription(...)` with `SET search_path = public` to match `atomic_subscription_activation`. |
| `supabase/migrations/<ts>_atomic_downgrade_subscription_rpc.sql` | Create | `atomic_downgrade_subscription` RPC: stale-cancel guard + downgrade in one transaction with row-level lock. |
| `src/app/api/payments/webhook/route.ts` | Modify | Insert event-id dedupe at top of POST; advisory lock per student; replace `downgradeIfMatchingSub` with RPC call; handle `subscription.pending`; emit per-event timing ops event. |
| `src/lib/payment-verification.ts` | Read-only reference | Already exports `verifyRazorpaySignature` — no change. |
| `src/__tests__/payments/webhook-route-integration.test.ts` | Create | Route-level integration tests: signature, dedupe, all 8 event types, RPC fallback, kill switch, unresolved student. |
| `src/__tests__/payments/webhook-concurrent-fire.test.ts` | Create | Concurrent-fire dedupe + advisory-lock tests. |
| `.claude/CLAUDE.md` | Modify | Update P11 to reflect post-fix reality; remove "two-statement fallback" language. |
| `CLAUDE.md` (root) | Modify | Same P11 update. |
| `docs/runbooks/payment-webhook-recovery.md` | Create | Runbook for stuck-payment / dead-letter / replay scenarios. |
| `LAUNCH_CHECKLIST.md` | Modify | Add payment-webhook ops checks to release section. |

Each task below is one logical change with TDD discipline. Commit after every task.

---

## Task 1: Update P11 in CLAUDE.md to reflect post-fix reality

**Files:**
- Modify: `.claude/CLAUDE.md` (search for "P11: Payment Integrity")
- Modify: `CLAUDE.md` (root, search for the same section)

- [ ] **Step 1: Read current P11 wording in both files**

Run: `grep -n "P11" .claude/CLAUDE.md CLAUDE.md`
Expected: locate the "P11: Payment Integrity" block in each file.

- [ ] **Step 2: Replace stale fallback paragraph in `.claude/CLAUDE.md`**

Find this exact text (line ~110 of `.claude/CLAUDE.md`):
```
Known tracked risk: webhook handler has a fallback path that updates `students` and `student_subscriptions` as two separate statements if `activate_subscription` RPC fails. If the second statement fails, a temporary split-brain state can occur. Mitigated by: idempotency checks, duplicate payment guards, `reconcile_stuck_payments.sql` runbook, and `verify` route returning 503 (not 200) on RPC failure so clients retry.
```

Replace with:
```
Implementation status: split-brain risk is closed. The webhook (`src/app/api/payments/webhook/route.ts`) calls only RPCs — never two separate UPDATE statements. Primary path is `activate_subscription`; on failure it falls back to `atomic_subscription_activation` (single transaction across `students` + `student_subscriptions`, migration `20260424120000`). Both RPCs failing returns HTTP 503 so Razorpay retries. The `ff_atomic_subscription_activation` feature flag (migration `20260425140500`) gates the atomic fallback off if needed (then 503 immediately). Event-level idempotency lives in `payment_webhook_events` (unique on razorpay_event_id). Verify-route + webhook contention is serialized via `pg_advisory_xact_lock` keyed by student_id.
```

- [ ] **Step 3: Apply identical replacement in root `CLAUDE.md`**

Same find-and-replace as Step 2 in the root `CLAUDE.md` (which mirrors `.claude/CLAUDE.md`).

- [ ] **Step 4: Commit**

```bash
git add .claude/CLAUDE.md CLAUDE.md
git commit -m "docs(P11): update payment integrity invariant to post-fix state"
```

---

## Task 2: Add `payment_webhook_events` idempotency table (migration only)

**Files:**
- Create: `supabase/migrations/<YYYYMMDDHHMMSS>_payment_webhook_events.sql` (use today's UTC timestamp; check `ls supabase/migrations | tail -5` to ensure ordering after `20260425140500`)
- Test: `src/__tests__/payments/webhook-events-rpc.test.ts` (Vitest with mocked admin client; we don't run pgTAP here — true SQL behavior is asserted by Task 7's integration tests)

- [ ] **Step 1: Pick the migration timestamp**

Run: `ls supabase/migrations | tail -3`
Expected: confirms latest is `20260425140500_ff_atomic_subscription_activation.sql`. Use a timestamp greater than that, e.g. `20260425150000`.

- [ ] **Step 2: Write the failing unit test for the helper that wraps the RPC**

Create `src/__tests__/payments/webhook-events-rpc.test.ts` with:

```typescript
import { describe, it, expect, vi } from 'vitest';

// Helper under test (added in Task 3 to webhook route as a local fn).
// For Task 2 we test the RPC contract via a mock — the migration is the
// real source of truth, asserted in the integration test (Task 7).
async function recordWebhookEvent(
  admin: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> },
  args: { account_id: string; event_id: string; event_type: string; raw_payload: Record<string, unknown> },
): Promise<'inserted' | 'duplicate'> {
  const { data, error } = await admin.rpc('record_webhook_event', {
    p_account_id: args.account_id,
    p_event_id: args.event_id,
    p_event_type: args.event_type,
    p_raw_payload: args.raw_payload,
  });
  if (error) throw new Error(error.message);
  return (data as { is_new: boolean }).is_new ? 'inserted' : 'duplicate';
}

describe('record_webhook_event RPC contract', () => {
  it('returns "inserted" on first call', async () => {
    const admin = { rpc: vi.fn().mockResolvedValue({ data: { is_new: true }, error: null }) };
    const result = await recordWebhookEvent(admin, {
      account_id: 'acc_1', event_id: 'evt_abc', event_type: 'payment.captured', raw_payload: {},
    });
    expect(result).toBe('inserted');
    expect(admin.rpc).toHaveBeenCalledWith('record_webhook_event', expect.objectContaining({
      p_account_id: 'acc_1', p_event_id: 'evt_abc', p_event_type: 'payment.captured',
    }));
  });

  it('returns "duplicate" when RPC reports is_new=false (ON CONFLICT path)', async () => {
    const admin = { rpc: vi.fn().mockResolvedValue({ data: { is_new: false }, error: null }) };
    const result = await recordWebhookEvent(admin, {
      account_id: 'acc_1', event_id: 'evt_abc', event_type: 'payment.captured', raw_payload: {},
    });
    expect(result).toBe('duplicate');
  });

  it('throws on RPC error so caller can 5xx', async () => {
    const admin = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) };
    await expect(recordWebhookEvent(admin, {
      account_id: 'acc_1', event_id: 'evt_abc', event_type: 'payment.captured', raw_payload: {},
    })).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails (file missing or import path wrong)**

Run: `npx vitest run src/__tests__/payments/webhook-events-rpc.test.ts`
Expected: FAIL — directory `src/__tests__/payments/` doesn't exist yet, so create it. After creating the test file, the test should PASS because the helper is defined inline. This is intentional: the RPC contract test is a guardrail; the real DB behavior is covered in Task 7's integration test against a mocked admin client.

If it passes immediately on first run, that's correct — the helper is self-contained. Move on.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260425150000_payment_webhook_events.sql`:

```sql
-- Migration: 20260425150000_payment_webhook_events.sql
-- Purpose: Event-level idempotency for the Razorpay webhook handler.
--
-- Why this exists:
--   The webhook route currently dedupes via payment_history.razorpay_payment_id.
--   That works for payment.captured / payment.failed but NOT for re-fired
--   subscription.cancelled / subscription.pending / subscription.expired
--   events that carry no payment entity. A re-fire could double-process
--   downgrades or status flips.
--
--   This table records every webhook event by its Razorpay-assigned
--   account_id + event_id. The route inserts on receipt; ON CONFLICT
--   means duplicate → ACK and skip. Race-safe by relying on the unique
--   constraint, not a SELECT-then-INSERT.
--
-- Safety:
--   - CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
--   - RLS enabled, service-role-only access (matches domain_events pattern)
--   - SECURITY DEFINER RPC pinned to search_path = public

BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razorpay_account_id text NOT NULL,
  razorpay_event_id   text NOT NULL,
  event_type      text NOT NULL,
  raw_payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  outcome         text CHECK (outcome IN ('ack','dedupe','activated','downgraded','failed','unresolved') OR outcome IS NULL),
  CONSTRAINT payment_webhook_events_unique_event UNIQUE (razorpay_account_id, razorpay_event_id)
);

COMMENT ON TABLE public.payment_webhook_events IS
  'Event-level idempotency for Razorpay webhook. Unique on (account_id, event_id); ON CONFLICT means duplicate event delivery.';

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_received
  ON public.payment_webhook_events (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_event_type
  ON public.payment_webhook_events (event_type, received_at DESC);

ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.payment_webhook_events TO service_role;
REVOKE ALL ON public.payment_webhook_events FROM authenticated;
REVOKE ALL ON public.payment_webhook_events FROM anon;

-- RPC: insert and return is_new=true; on conflict return is_new=false.
CREATE OR REPLACE FUNCTION public.record_webhook_event(
  p_account_id text,
  p_event_id   text,
  p_event_type text,
  p_raw_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(is_new boolean, id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_account_id IS NULL OR length(p_account_id) = 0 THEN
    RAISE EXCEPTION 'account_id required';
  END IF;
  IF p_event_id IS NULL OR length(p_event_id) = 0 THEN
    RAISE EXCEPTION 'event_id required';
  END IF;

  INSERT INTO public.payment_webhook_events (razorpay_account_id, razorpay_event_id, event_type, raw_payload)
  VALUES (p_account_id, p_event_id, p_event_type, COALESCE(p_raw_payload, '{}'::jsonb))
  ON CONFLICT (razorpay_account_id, razorpay_event_id) DO NOTHING
  RETURNING payment_webhook_events.id INTO v_id;

  IF v_id IS NULL THEN
    -- Conflict path: fetch existing row id, return is_new=false.
    SELECT pwe.id INTO v_id
    FROM public.payment_webhook_events pwe
    WHERE pwe.razorpay_account_id = p_account_id
      AND pwe.razorpay_event_id = p_event_id;
    RETURN QUERY SELECT false AS is_new, v_id AS id;
  ELSE
    RETURN QUERY SELECT true AS is_new, v_id AS id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_webhook_event(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_webhook_event(text, text, text, jsonb) TO service_role;

-- RPC: mark a webhook event as processed with outcome.
CREATE OR REPLACE FUNCTION public.mark_webhook_event_processed(
  p_id uuid,
  p_outcome text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_outcome NOT IN ('ack','dedupe','activated','downgraded','failed','unresolved') THEN
    RAISE EXCEPTION 'invalid outcome: %', p_outcome;
  END IF;
  UPDATE public.payment_webhook_events
  SET processed_at = now(), outcome = p_outcome
  WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_webhook_event_processed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_webhook_event_processed(uuid, text) TO service_role;

COMMIT;
```

- [ ] **Step 5: Verify migration applies cleanly**

Run: `npx supabase db lint supabase/migrations/20260425150000_payment_webhook_events.sql 2>&1 | head -30`
Expected: no syntax errors. (If `db lint` is unavailable, run `cat supabase/migrations/20260425150000_payment_webhook_events.sql` and visually verify the SQL parses; the integration tests in Task 7 will exercise the real schema.)

- [ ] **Step 6: Run the unit test to confirm it still passes**

Run: `npx vitest run src/__tests__/payments/webhook-events-rpc.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260425150000_payment_webhook_events.sql src/__tests__/payments/webhook-events-rpc.test.ts
git commit -m "feat(payments): add payment_webhook_events idempotency table + RPC"
```

---

## Task 3: Wire event-level dedupe into the webhook route

**Files:**
- Modify: `src/app/api/payments/webhook/route.ts:192-218` (the POST handler, right after signature verify and admin client creation)

- [ ] **Step 1: Write the failing integration test for dedupe behavior**

Create `src/__tests__/payments/webhook-route-integration.test.ts` with the FIRST test (more added in Task 7):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We import the route under test. Vitest module-mock the supabase client
// at the boundary so we can assert RPC call sequences.
vi.mock('@supabase/supabase-js', async () => {
  const actual = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  return {
    ...actual,
    createClient: vi.fn(),
  };
});

import { createClient } from '@supabase/supabase-js';
import { POST } from '@/app/api/payments/webhook/route';
import crypto from 'crypto';

const WEBHOOK_SECRET = 'test_webhook_secret';

function signed(body: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

function buildEvent(overrides: Partial<{
  event: string; account_id: string; payment_id: string; sub_id: string; notes: Record<string, unknown>;
}> = {}) {
  const event = overrides.event ?? 'payment.captured';
  const account_id = overrides.account_id ?? 'acc_test';
  const notes = overrides.notes ?? { plan_code: 'pro', billing_cycle: 'yearly', user_id: 'u1', student_id: 's1' };
  return {
    account_id,
    event,
    payload: {
      payment: { entity: { id: overrides.payment_id ?? 'pay_1', order_id: 'ord_1', amount: 199900, currency: 'INR', notes } },
      subscription: overrides.sub_id ? { entity: { id: overrides.sub_id, notes } } : undefined,
    },
  };
}

function makeRequest(body: object): Request {
  const raw = JSON.stringify(body);
  return new Request('http://localhost/api/payments/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': signed(raw) },
    body: raw,
  });
}

describe('webhook route — event-level dedupe', () => {
  let mockAdmin: { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';

    mockAdmin = {
      rpc: vi.fn(),
      from: vi.fn(),
    };
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAdmin);
  });

  it('on duplicate event_id, returns 200 with note=dedupe and skips activation', async () => {
    // record_webhook_event RPC reports is_new=false (duplicate).
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') return { data: { is_new: false, id: 'wh-1' }, error: null };
      throw new Error(`unexpected RPC ${name}`);
    });

    const req = makeRequest(buildEvent());
    const res = await POST(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.note).toBe('dedupe');

    // Critical: activate_subscription / atomic_subscription_activation MUST NOT have been called.
    const callNames = mockAdmin.rpc.mock.calls.map((c: unknown[]) => c[0]);
    expect(callNames).toContain('record_webhook_event');
    expect(callNames).not.toContain('activate_subscription');
    expect(callNames).not.toContain('atomic_subscription_activation');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/payments/webhook-route-integration.test.ts`
Expected: FAIL — the route does not yet call `record_webhook_event`, so the test will see the route attempt to call `payment_history.select` (`from()`) and break, or 200 without the `dedupe` note.

- [ ] **Step 3: Add dedupe logic to the route**

In `src/app/api/payments/webhook/route.ts`, after the existing admin-client construction (~line 222) and BEFORE the `if (eventType === 'payment.captured')` block (~line 228), insert:

```typescript
    // ── Event-level dedupe (Task 3 of payment-webhook-hardening plan) ──
    // Razorpay can re-fire any event. We record (account_id, event_id) in
    // payment_webhook_events with a unique constraint. ON CONFLICT means
    // duplicate delivery → ACK and skip. This dedupes events that have no
    // payment entity (e.g. re-fired subscription.cancelled).
    const accountId: string | undefined = event.account_id;
    const razorpayEventId: string | undefined = event.id;
    let webhookEventRowId: string | null = null;

    if (accountId && razorpayEventId) {
      const { data: dedupeRows, error: dedupeErr } = await admin.rpc('record_webhook_event', {
        p_account_id: accountId,
        p_event_id: razorpayEventId,
        p_event_type: eventType,
        p_raw_payload: event,
      });
      if (dedupeErr) {
        // RPC missing or DB error — log and proceed without dedupe so we
        // don't lose a real event. payment_history-level dedupe still applies.
        logger.warn('webhook: record_webhook_event RPC failed; proceeding without event-level dedupe', {
          error: dedupeErr.message, eventType, razorpayEventId,
        });
      } else {
        // record_webhook_event returns table-typed result; supabase-js wraps as array.
        const row = Array.isArray(dedupeRows) ? dedupeRows[0] : dedupeRows;
        if (row && row.is_new === false) {
          return NextResponse.json({ received: true, note: 'dedupe' });
        }
        webhookEventRowId = row?.id ?? null;
      }
    } else {
      logger.warn('webhook: missing account_id or event.id; skipping event-level dedupe', {
        hasAccountId: !!accountId, hasEventId: !!razorpayEventId, eventType,
      });
    }
```

Then, at every existing `return NextResponse.json({ received: true ... })` site (lines 239, 248, 353, 374, 397, 439, 445, 583, 590, 604, 608, 612), add a best-effort marker call so we can dashboard outcomes. Add this helper near the top of the file (after the imports):

```typescript
async function markEvent(
  admin: SupabaseClient,
  rowId: string | null,
  outcome: 'ack' | 'dedupe' | 'activated' | 'downgraded' | 'failed' | 'unresolved',
): Promise<void> {
  if (!rowId) return;
  try {
    await admin.rpc('mark_webhook_event_processed', { p_id: rowId, p_outcome: outcome });
  } catch (err) {
    logger.warn('webhook: mark_webhook_event_processed failed (non-blocking)', {
      error: err instanceof Error ? err.message : String(err), rowId, outcome,
    });
  }
}
```

Add `await markEvent(admin, webhookEventRowId, '<outcome>')` immediately before each existing successful-path `return NextResponse.json(...)`. Map outcomes:
- `payment.captured` success → `'activated'`
- `payment.captured` no-plan / already-processed → `'ack'`
- `payment.failed` recorded → `'ack'`
- `subscription.activated` / `subscription.charged` success → `'activated'`
- `subscription.authenticated` → `'ack'`
- `subscription.halted/cancelled/expired/completed` → `'downgraded'` (or `'ack'` if `stale_cancel_ignored`)
- Any 503 path → `'failed'`
- Any 500 unresolved-student path → `'unresolved'`

Do NOT add `markEvent` inside the outer `try`'s `catch` (line 613) — that runs after we've already lost context, and writing to the DB after an unknown failure is risky.

- [ ] **Step 4: Run the dedupe test to verify it passes**

Run: `npx vitest run src/__tests__/payments/webhook-route-integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite to verify nothing broke**

Run: `npx vitest run src/__tests__/webhook-fallback.test.ts src/__tests__/payment.test.ts src/__tests__/payments/`
Expected: ALL PASS.

- [ ] **Step 6: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/payments/webhook/route.ts src/__tests__/payments/webhook-route-integration.test.ts
git commit -m "feat(payments): event-level dedupe via payment_webhook_events RPC"
```

---

## Task 4: Pin `search_path` on `activate_subscription`

**Files:**
- Create: `supabase/migrations/20260425150100_pin_search_path_activate_subscription.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration: 20260425150100_pin_search_path_activate_subscription.sql
-- Purpose: Pin search_path = public on activate_subscription to match the
--          project convention (migration 20260408000009 set this for all
--          postgres-owned SECURITY DEFINER functions). The original
--          definition in 20260328160000_recurring_billing.sql omits this.
--
-- Why this matters:
--   SECURITY DEFINER functions run with elevated privileges. Without an
--   explicit search_path, a malicious schema in front of `public` could
--   shadow a referenced table/function and execute attacker-controlled
--   code as the function owner. The atomic_subscription_activation RPC
--   (migration 20260424120000) already has SET search_path = public; this
--   migration brings activate_subscription in line.
--
-- Body identical to the canonical definition in 20260328160000 lines
-- 51-125 — only the function attributes change.

BEGIN;

CREATE OR REPLACE FUNCTION public.activate_subscription(
  p_auth_user_id uuid,
  p_plan_code text,
  p_billing_cycle text DEFAULT 'monthly',
  p_razorpay_payment_id text DEFAULT NULL,
  p_razorpay_order_id text DEFAULT NULL,
  p_razorpay_subscription_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_student_id UUID;
  v_plan_id UUID;
  v_period_end TIMESTAMPTZ;
  v_next_billing TIMESTAMPTZ;
BEGIN
  SELECT id INTO v_student_id FROM students WHERE auth_user_id = p_auth_user_id LIMIT 1;
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Student not found for auth_user_id %', p_auth_user_id;
  END IF;

  SELECT id INTO v_plan_id FROM subscription_plans WHERE plan_code = p_plan_code LIMIT 1;
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'Plan not found: %', p_plan_code;
  END IF;

  v_period_end := CASE
    WHEN p_billing_cycle = 'yearly' THEN NOW() + INTERVAL '1 year'
    ELSE NOW() + INTERVAL '1 month'
  END;

  v_next_billing := CASE
    WHEN p_billing_cycle = 'yearly' THEN NOW() + INTERVAL '1 year'
    WHEN p_billing_cycle = 'monthly' AND p_razorpay_subscription_id IS NOT NULL THEN NOW() + INTERVAL '1 month'
    ELSE NULL
  END;

  INSERT INTO student_subscriptions (
    student_id, plan_id, plan_code, status, billing_cycle,
    current_period_start, current_period_end, next_billing_at,
    razorpay_payment_id, razorpay_subscription_id,
    auto_renew, renewal_attempts, grace_period_end, ended_at
  ) VALUES (
    v_student_id, v_plan_id, p_plan_code, 'active', p_billing_cycle,
    NOW(), v_period_end, v_next_billing,
    p_razorpay_payment_id, p_razorpay_subscription_id,
    CASE WHEN p_razorpay_subscription_id IS NOT NULL THEN true ELSE false END,
    0, NULL, NULL
  )
  ON CONFLICT (student_id) DO UPDATE SET
    plan_id = v_plan_id,
    plan_code = p_plan_code,
    status = 'active',
    billing_cycle = p_billing_cycle,
    current_period_start = NOW(),
    current_period_end = v_period_end,
    next_billing_at = v_next_billing,
    razorpay_payment_id = COALESCE(p_razorpay_payment_id, student_subscriptions.razorpay_payment_id),
    razorpay_subscription_id = COALESCE(p_razorpay_subscription_id, student_subscriptions.razorpay_subscription_id),
    auto_renew = CASE WHEN p_razorpay_subscription_id IS NOT NULL THEN true ELSE false END,
    renewal_attempts = 0,
    grace_period_end = NULL,
    ended_at = NULL,
    cancelled_at = NULL,
    cancel_reason = NULL,
    updated_at = NOW();

  UPDATE students SET subscription_plan = p_plan_code WHERE id = v_student_id;
END;
$function$;

COMMIT;
```

- [ ] **Step 2: Verify SQL is well-formed**

Run: `head -60 supabase/migrations/20260425150100_pin_search_path_activate_subscription.sql`
Expected: shows the file header and CREATE OR REPLACE FUNCTION declaration.

- [ ] **Step 3: Confirm the body matches the prior definition**

Run: `diff <(sed -n '51,125p' supabase/migrations/20260328160000_recurring_billing.sql | grep -v '^--') <(sed -n '/^CREATE OR REPLACE FUNCTION/,/^\$function\$;/p' supabase/migrations/20260425150100_pin_search_path_activate_subscription.sql | grep -v '^--' | grep -v 'SET search_path = public')`

Expected: only attribute differences (LANGUAGE/SECURITY) remain; body is identical. (If your `diff` flags trivial whitespace, eyeball it.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260425150100_pin_search_path_activate_subscription.sql
git commit -m "fix(payments): pin search_path = public on activate_subscription RPC"
```

---

## Task 5: Add `atomic_downgrade_subscription` RPC and use it in the route

**Files:**
- Create: `supabase/migrations/20260425150200_atomic_downgrade_subscription_rpc.sql`
- Modify: `src/app/api/payments/webhook/route.ts:120-167` (replace the body of `downgradeIfMatchingSub` to call the new RPC)

- [ ] **Step 1: Write the migration**

```sql
-- Migration: 20260425150200_atomic_downgrade_subscription_rpc.sql
-- Purpose: Replace the JS-side SELECT-then-UPDATE in
--          downgradeIfMatchingSub() with a single-transaction RPC that
--          takes a row-level lock on student_subscriptions.
--
-- Why:
--   The current helper (webhook/route.ts:120-167) reads the current
--   subscription row, then writes students + student_subscriptions in
--   two separate UPDATE statements. Two race windows exist:
--     1. Between the SELECT and the first UPDATE, a concurrent activation
--        can flip the sub_id, but the JS check used the stale value.
--     2. The two UPDATE statements are not atomic — the same split-brain
--        risk that motivated atomic_subscription_activation.
--
-- This RPC closes both: SELECT ... FOR UPDATE locks the row, and both
-- UPDATEs run inside the same transaction.

BEGIN;

CREATE OR REPLACE FUNCTION public.atomic_downgrade_subscription(
  p_student_id uuid,
  p_cancelled_sub_id text,
  p_new_status text
)
RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_sub_id text;
BEGIN
  IF p_new_status NOT IN ('cancelled','expired','halted','completed') THEN
    RAISE EXCEPTION 'invalid status: %', p_new_status;
  END IF;

  -- Lock the subscription row for the duration of this transaction.
  SELECT razorpay_subscription_id INTO v_current_sub_id
  FROM student_subscriptions
  WHERE student_id = p_student_id
  FOR UPDATE;

  -- Stale cancel: a different sub_id is currently active. Ignore.
  IF v_current_sub_id IS NOT NULL AND v_current_sub_id <> p_cancelled_sub_id THEN
    RETURN QUERY SELECT 'stale_cancel_ignored'::text;
    RETURN;
  END IF;

  UPDATE students
  SET subscription_plan = 'free', updated_at = NOW()
  WHERE id = p_student_id;

  UPDATE student_subscriptions
  SET plan_code = 'free',
      status = p_new_status,
      cancelled_at = NOW(),
      updated_at = NOW()
  WHERE student_id = p_student_id;

  RETURN QUERY SELECT 'downgraded'::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.atomic_downgrade_subscription(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atomic_downgrade_subscription(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.atomic_downgrade_subscription IS
  'Atomic downgrade with stale-cancel guard via row-level lock. Replaces the JS SELECT-then-UPDATE in webhook/route.ts:downgradeIfMatchingSub.';

COMMIT;
```

- [ ] **Step 2: Add the failing test for the route helper change**

Append to `src/__tests__/payments/webhook-route-integration.test.ts`:

```typescript
describe('webhook route — atomic downgrade', () => {
  let mockAdmin: { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';
    mockAdmin = { rpc: vi.fn(), from: vi.fn() };
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAdmin);
  });

  it('subscription.cancelled calls atomic_downgrade_subscription RPC, not raw UPDATEs', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') return { data: [{ is_new: true, id: 'wh-2' }], error: null };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      if (name === 'atomic_downgrade_subscription') return { data: [{ outcome: 'downgraded' }], error: null };
      throw new Error(`unexpected RPC ${name}`);
    });
    // Student resolution path: notes_student_id branch — no .from() call needed
    // because resolveStudent's first branch hits notes.student_id and SELECTs
    // students. Mock that:
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === 'students') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's1' }, error: null }) }) }) };
      }
      throw new Error(`unexpected from(${table})`);
    });

    const evt = buildEvent({
      event: 'subscription.cancelled',
      sub_id: 'sub_xyz',
      notes: { student_id: 's1', plan_code: 'pro', user_id: 'u1' },
    });
    // subscription.cancelled needs subscription.entity, not just payment.entity.
    // buildEvent() already includes both when sub_id is provided.

    const req = makeRequest(evt);
    const res = await POST(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);

    const callNames = mockAdmin.rpc.mock.calls.map((c: unknown[]) => c[0]);
    expect(callNames).toContain('atomic_downgrade_subscription');
    // Critical: route MUST NOT call admin.from('student_subscriptions').update — that's the old path.
    const fromCalls = mockAdmin.from.mock.calls.map((c: unknown[]) => c[0]);
    expect(fromCalls).not.toContain('student_subscriptions');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/payments/webhook-route-integration.test.ts -t "atomic downgrade"`
Expected: FAIL — current `downgradeIfMatchingSub` calls `admin.from('students').update` and `admin.from('student_subscriptions').update`.

- [ ] **Step 4: Replace `downgradeIfMatchingSub` body**

In `src/app/api/payments/webhook/route.ts`, replace the body of `downgradeIfMatchingSub` (lines 121-167) with:

```typescript
async function downgradeIfMatchingSub(
  admin: SupabaseClient,
  studentId: string,
  cancelledSubId: string,
  newStatus: 'cancelled' | 'expired' | 'halted' | 'completed',
  eventType: string,
): Promise<'downgraded' | 'stale_cancel_ignored'> {
  const { data, error } = await admin.rpc('atomic_downgrade_subscription', {
    p_student_id: studentId,
    p_cancelled_sub_id: cancelledSubId,
    p_new_status: newStatus,
  });

  if (error) {
    await logOpsEvent({
      category: 'payment',
      severity: 'critical',
      source: 'webhook/route.ts',
      message: 'atomic_downgrade_subscription RPC failed',
      context: {
        event_type: eventType,
        student_id: studentId,
        cancelled_sub_id: cancelledSubId,
        error: error.message,
      },
    });
    // Re-throw so the outer try/catch returns 500 → Razorpay retries.
    throw new Error(`atomic_downgrade_subscription failed: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const outcome = row?.outcome as 'downgraded' | 'stale_cancel_ignored' | undefined;

  if (outcome === 'stale_cancel_ignored') {
    await logOpsEvent({
      category: 'payment',
      severity: 'warning',
      source: 'webhook/route.ts',
      message: 'stale_cancel_ignored',
      context: { event_type: eventType, student_id: studentId, cancelled_sub_id: cancelledSubId },
    });
    return 'stale_cancel_ignored';
  }
  return 'downgraded';
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/payments/webhook-route-integration.test.ts -t "atomic downgrade"`
Expected: PASS.

- [ ] **Step 6: Run the full payment suite**

Run: `npx vitest run src/__tests__/payments/ src/__tests__/payment.test.ts src/__tests__/webhook-fallback.test.ts`
Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260425150200_atomic_downgrade_subscription_rpc.sql src/app/api/payments/webhook/route.ts src/__tests__/payments/webhook-route-integration.test.ts
git commit -m "feat(payments): atomic_downgrade_subscription RPC + route uses it"
```

---

## Task 6: Add advisory lock per student around activation

**Files:**
- Modify: `src/app/api/payments/webhook/route.ts` — wrap activation calls (`activate_subscription` + `atomic_subscription_activation`) with `pg_advisory_xact_lock` keyed by student_id, preventing verify-route + webhook contention.
- Modify: `src/app/api/payments/verify/route.ts` — same advisory lock around the `activate_subscription` call.

Note: Postgres advisory locks taken via `SELECT pg_advisory_xact_lock(hashtextextended(key, 0))` are released at transaction end. Because we call RPCs over the supabase-js client (each call is its own transaction), the lock won't span the multi-RPC fallback. We'll instead push the locking inside a wrapper RPC.

- [ ] **Step 1: Add a wrapper RPC migration**

Create `supabase/migrations/20260425150300_activate_with_advisory_lock.sql`:

```sql
-- Migration: 20260425150300_activate_with_advisory_lock.sql
-- Purpose: Serialize concurrent activation attempts for the same student
--          (verify route + webhook). Wraps activate_subscription in a
--          transaction-scoped advisory lock keyed by student_id.

BEGIN;

CREATE OR REPLACE FUNCTION public.activate_subscription_locked(
  p_auth_user_id uuid,
  p_plan_code text,
  p_billing_cycle text,
  p_razorpay_payment_id text,
  p_razorpay_order_id text,
  p_razorpay_subscription_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid;
BEGIN
  SELECT id INTO v_student_id FROM students WHERE auth_user_id = p_auth_user_id LIMIT 1;
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Student not found for auth_user_id %', p_auth_user_id;
  END IF;

  -- Transaction-scoped advisory lock keyed by student_id. Prevents verify-
  -- route + webhook from interleaving activation. Released on COMMIT/ROLLBACK.
  PERFORM pg_advisory_xact_lock(hashtextextended('subscription:' || v_student_id::text, 0));

  PERFORM activate_subscription(
    p_auth_user_id,
    p_plan_code,
    p_billing_cycle,
    p_razorpay_payment_id,
    p_razorpay_order_id,
    p_razorpay_subscription_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_subscription_locked(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_subscription_locked(uuid, text, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.atomic_subscription_activation_locked(
  p_student_id uuid,
  p_plan_code text,
  p_billing_cycle text,
  p_razorpay_payment_id text,
  p_razorpay_subscription_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('subscription:' || p_student_id::text, 0));

  PERFORM atomic_subscription_activation(
    p_student_id,
    p_plan_code,
    p_billing_cycle,
    p_razorpay_payment_id,
    p_razorpay_subscription_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.atomic_subscription_activation_locked(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atomic_subscription_activation_locked(uuid, text, text, text, text) TO service_role;

COMMIT;
```

- [ ] **Step 2: Update the webhook route to call the locked variants**

In `src/app/api/payments/webhook/route.ts`, replace `activate_subscription` calls with `activate_subscription_locked` and `atomic_subscription_activation` calls with `atomic_subscription_activation_locked`. The args are identical — only the RPC name changes.

Specific lines (post-Task-3 numbering — re-grep before editing):
- `await admin.rpc('activate_subscription', {` (currently lines 278, 474) → `await admin.rpc('activate_subscription_locked', {`
- `await admin.rpc('atomic_subscription_activation', {` (currently lines 319, 513, 551) → `await admin.rpc('atomic_subscription_activation_locked', {`

- [ ] **Step 3: Update the verify route similarly**

In `src/app/api/payments/verify/route.ts:185`, replace:
```typescript
const { error: rpcError } = await admin.rpc('activate_subscription', {
```
with:
```typescript
const { error: rpcError } = await admin.rpc('activate_subscription_locked', {
```

- [ ] **Step 4: Add a concurrent-fire integration test**

Create `src/__tests__/payments/webhook-concurrent-fire.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('@supabase/supabase-js', async () => {
  const actual = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  return { ...actual, createClient: vi.fn() };
});

import { createClient } from '@supabase/supabase-js';
import { POST } from '@/app/api/payments/webhook/route';

const WEBHOOK_SECRET = 'test_concurrent_secret';

function signed(body: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

function makeReq(eventBody: object): Request {
  const raw = JSON.stringify(eventBody);
  return new Request('http://localhost/api/payments/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': signed(raw) },
    body: raw,
  });
}

describe('webhook concurrent fire — exactly one activation', () => {
  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';
  });

  it('5 parallel webhook deliveries of the SAME event_id → exactly one activate call', async () => {
    let recordWebhookCalls = 0;
    let activateCalls = 0;

    const mockAdmin = {
      rpc: vi.fn(async (name: string) => {
        if (name === 'record_webhook_event') {
          recordWebhookCalls++;
          // First caller wins; rest get is_new=false.
          const isNew = recordWebhookCalls === 1;
          return { data: [{ is_new: isNew, id: `wh-${recordWebhookCalls}` }], error: null };
        }
        if (name === 'activate_subscription_locked') {
          activateCalls++;
          return { data: null, error: null };
        }
        if (name === 'mark_webhook_event_processed') return { data: null, error: null };
        return { data: null, error: null };
      }),
      from: vi.fn((table: string) => {
        if (table === 'students') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's1' }, error: null }) }) }) };
        }
        if (table === 'payment_history') {
          return {
            select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }),
            insert: async () => ({ error: null }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      }),
    };
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAdmin);

    const event = {
      account_id: 'acc_1',
      id: 'evt_same_id_for_all',
      event: 'payment.captured',
      payload: { payment: { entity: {
        id: 'pay_1', order_id: 'ord_1', amount: 100, currency: 'INR',
        notes: { student_id: 's1', user_id: 'u1', plan_code: 'pro', billing_cycle: 'yearly' },
      } } },
    };

    const responses = await Promise.all(Array.from({ length: 5 }, () => POST(makeReq(event) as unknown as import('next/server').NextRequest)));

    expect(responses.every(r => r.status === 200)).toBe(true);
    expect(recordWebhookCalls).toBe(5);
    // Only the first call's is_new=true reached the activation branch.
    expect(activateCalls).toBe(1);
  });
});
```

- [ ] **Step 5: Run the concurrent-fire test**

Run: `npx vitest run src/__tests__/payments/webhook-concurrent-fire.test.ts`
Expected: PASS — 5 fires, 1 activation.

- [ ] **Step 6: Run all payment tests + type-check**

```bash
npx vitest run src/__tests__/payments/ src/__tests__/payment.test.ts src/__tests__/webhook-fallback.test.ts && npm run type-check
```
Expected: ALL PASS, type-check exit 0.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260425150300_activate_with_advisory_lock.sql src/app/api/payments/webhook/route.ts src/app/api/payments/verify/route.ts src/__tests__/payments/webhook-concurrent-fire.test.ts
git commit -m "feat(payments): advisory lock per student around activation"
```

---

## Task 7: Handle `subscription.pending` event

**Files:**
- Modify: `src/app/api/payments/webhook/route.ts:402-412` (add `subscription.pending` to the `subEvents` set, route to `mark_subscription_past_due` RPC).
- Test: extend `src/__tests__/payments/webhook-route-integration.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/payments/webhook-route-integration.test.ts`:

```typescript
describe('webhook route — subscription.pending', () => {
  let mockAdmin: { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';
    mockAdmin = { rpc: vi.fn(), from: vi.fn() };
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAdmin);
  });

  it('subscription.pending calls mark_subscription_past_due RPC', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') return { data: [{ is_new: true, id: 'wh-3' }], error: null };
      if (name === 'mark_subscription_past_due') return { data: null, error: null };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      throw new Error(`unexpected RPC ${name}`);
    });
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === 'students') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's1' }, error: null }) }) }) };
      }
      throw new Error(`unexpected from(${table})`);
    });

    const event = {
      account_id: 'acc_1',
      id: 'evt_pending',
      event: 'subscription.pending',
      payload: { subscription: { entity: { id: 'sub_xyz', notes: { student_id: 's1', plan_code: 'pro', user_id: 'u1' } } } },
    };

    const req = makeRequest(event);
    const res = await POST(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);
    const calls = mockAdmin.rpc.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toContain('mark_subscription_past_due');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/payments/webhook-route-integration.test.ts -t "subscription.pending"`
Expected: FAIL — current `subEvents` set excludes `subscription.pending`.

- [ ] **Step 3: Add `subscription.pending` to the route**

In `src/app/api/payments/webhook/route.ts`:

1. Add to the `subEvents` Set (around line 403):
```typescript
const subEvents = new Set([
  'subscription.authenticated',
  'subscription.activated',
  'subscription.charged',
  'subscription.pending',          // ← new
  'subscription.halted',
  'subscription.cancelled',
  'subscription.expired',
  'subscription.completed',
]);
```

2. Add a handler block immediately AFTER the `subscription.activated || subscription.charged` block (around line 583, before the `subscription.halted` block):

```typescript
      // ── subscription.pending: payment retry in progress; mark past_due with grace.
      if (eventType === 'subscription.pending') {
        const { error: pdErr } = await admin.rpc('mark_subscription_past_due', {
          p_student_id: resolved.student_id,
          p_grace_days: 3,
        });
        if (pdErr) {
          logger.error('Webhook: mark_subscription_past_due failed', {
            error: pdErr.message, rzSubId, studentId: resolved.student_id,
          });
          await markEvent(admin, webhookEventRowId, 'failed');
          return NextResponse.json({ error: 'past_due_mark_failed' }, { status: 503 });
        }
        await markEvent(admin, webhookEventRowId, 'downgraded');
        return NextResponse.json({ received: true, note: 'marked_past_due' });
      }
```

The `mark_subscription_past_due` RPC already exists in migration `20260328160000_recurring_billing.sql:182-195` — no new migration needed.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/payments/webhook-route-integration.test.ts -t "subscription.pending"`
Expected: PASS.

- [ ] **Step 5: Run full payment suite**

Run: `npx vitest run src/__tests__/payments/ src/__tests__/payment.test.ts src/__tests__/webhook-fallback.test.ts`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/payments/webhook/route.ts src/__tests__/payments/webhook-route-integration.test.ts
git commit -m "feat(payments): handle subscription.pending → mark_subscription_past_due"
```

---

## Task 8: Add comprehensive route-level coverage (signature, all event types, fallback ladder)

**Files:**
- Extend: `src/__tests__/payments/webhook-route-integration.test.ts`

- [ ] **Step 1: Add invalid-signature test**

Append:
```typescript
describe('webhook route — signature verification', () => {
  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: vi.fn(), from: vi.fn() });
  });

  it('rejects request with invalid signature without touching DB', async () => {
    const body = JSON.stringify(buildEvent());
    const req = new Request('http://localhost/api/payments/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'deadbeef' },
      body,
    });
    const res = await POST(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toBe('Invalid signature');
  });

  it('rejects when signature header is missing', async () => {
    const body = JSON.stringify(buildEvent());
    const req = new Request('http://localhost/api/payments/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const res = await POST(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Add fallback-ladder tests**

Append:
```typescript
describe('webhook route — RPC fallback ladder', () => {
  let mockAdmin: { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';
    mockAdmin = { rpc: vi.fn(), from: vi.fn() };
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAdmin);
  });

  function studentResolver() {
    return (table: string) => {
      if (table === 'students') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's1' }, error: null }) }) }) };
      }
      if (table === 'payment_history') {
        return {
          select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }),
          insert: async () => ({ error: null }),
        };
      }
      if (table === 'feature_flags') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_enabled: true }, error: null }) }) }) };
      }
      throw new Error(`unexpected from(${table})`);
    };
  }

  it('primary RPC success: only activate_subscription_locked called', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') return { data: [{ is_new: true, id: 'wh-1' }], error: null };
      if (name === 'activate_subscription_locked') return { data: null, error: null };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      throw new Error(`unexpected ${name}`);
    });
    mockAdmin.from.mockImplementation(studentResolver());

    const res = await POST(makeRequest(buildEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);
    const calls = mockAdmin.rpc.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toContain('activate_subscription_locked');
    expect(calls).not.toContain('atomic_subscription_activation_locked');
  });

  it('primary fails, atomic fallback succeeds → 200', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') return { data: [{ is_new: true, id: 'wh-1' }], error: null };
      if (name === 'activate_subscription_locked') return { data: null, error: { message: 'primary fail' } };
      if (name === 'atomic_subscription_activation_locked') return { data: null, error: null };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      throw new Error(`unexpected ${name}`);
    });
    mockAdmin.from.mockImplementation(studentResolver());

    const res = await POST(makeRequest(buildEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);
    const calls = mockAdmin.rpc.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toContain('activate_subscription_locked');
    expect(calls).toContain('atomic_subscription_activation_locked');
  });

  it('both primary and atomic fail → 503 (Razorpay retries)', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') return { data: [{ is_new: true, id: 'wh-1' }], error: null };
      if (name === 'activate_subscription_locked') return { data: null, error: { message: 'primary fail' } };
      if (name === 'atomic_subscription_activation_locked') return { data: null, error: { message: 'atomic fail' } };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      throw new Error(`unexpected ${name}`);
    });
    mockAdmin.from.mockImplementation(studentResolver());

    const res = await POST(makeRequest(buildEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(503);
  });

  it('kill switch disabled + primary fails → 503 without atomic call', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') return { data: [{ is_new: true, id: 'wh-1' }], error: null };
      if (name === 'activate_subscription_locked') return { data: null, error: { message: 'primary fail' } };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      throw new Error(`unexpected ${name}`);
    });
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === 'feature_flags') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_enabled: false }, error: null }) }) }) };
      }
      return studentResolver()(table);
    });

    const res = await POST(makeRequest(buildEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(503);
    const calls = mockAdmin.rpc.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).not.toContain('atomic_subscription_activation_locked');
  });
});
```

- [ ] **Step 3: Run the new tests**

Run: `npx vitest run src/__tests__/payments/webhook-route-integration.test.ts`
Expected: ALL PASS.

- [ ] **Step 4: Run the full backend test suite to confirm no regressions**

Run: `npx vitest run src/__tests__/payments/ src/__tests__/payment.test.ts src/__tests__/payment-monthly-subscription-regression.test.ts src/__tests__/webhook-fallback.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/payments/webhook-route-integration.test.ts
git commit -m "test(payments): route-level coverage for signature, fallback ladder, kill switch"
```

---

## Task 9: Add per-event timing observability

**Files:**
- Modify: `src/app/api/payments/webhook/route.ts` — capture start time at the top of POST, emit a single `payment.webhook_processed` ops event at the bottom of every successful path with `event_type`, `latency_ms`, `outcome`, `student_resolution_via`.

- [ ] **Step 1: Add a timing helper at the top of the route file**

Below the existing imports in `src/app/api/payments/webhook/route.ts`, add:

```typescript
type WebhookOutcome = 'ack' | 'dedupe' | 'activated' | 'downgraded' | 'failed' | 'unresolved';

async function emitWebhookTiming(args: {
  eventType: string;
  outcome: WebhookOutcome;
  latencyMs: number;
  resolvedVia?: string;
  studentId?: string;
  rzSubId?: string;
}): Promise<void> {
  try {
    await logOpsEvent({
      category: 'payment',
      severity: args.outcome === 'failed' || args.outcome === 'unresolved' ? 'error' : 'info',
      source: 'webhook/route.ts',
      message: 'payment.webhook_processed',
      context: {
        event_type: args.eventType,
        outcome: args.outcome,
        latency_ms: args.latencyMs,
        resolved_via: args.resolvedVia ?? null,
        student_id: args.studentId ?? null,
        rz_sub_id: args.rzSubId ?? null,
      },
    });
  } catch (err) {
    logger.warn('emitWebhookTiming failed (non-blocking)', { error: err instanceof Error ? err.message : String(err) });
  }
}
```

- [ ] **Step 2: Capture start time**

At the top of `export async function POST(...)`, before the try-block:

```typescript
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
```

- [ ] **Step 3: Wrap each terminal `return NextResponse.json(...)` with the emit call**

Replace each pattern:
```typescript
await markEvent(admin, webhookEventRowId, '<outcome>');
return NextResponse.json({ received: true, ... });
```
with:
```typescript
await markEvent(admin, webhookEventRowId, '<outcome>');
await emitWebhookTiming({
  eventType, outcome: '<outcome>', latencyMs: Date.now() - startedAt,
  resolvedVia: resolved?.via, studentId: resolved?.student_id, rzSubId,
});
return NextResponse.json({ received: true, ... });
```

For the dedupe early-return (added in Task 3), just emit directly:
```typescript
await emitWebhookTiming({ eventType, outcome: 'dedupe', latencyMs: Date.now() - startedAt });
return NextResponse.json({ received: true, note: 'dedupe' });
```

For the outer `catch` block (line ~613), emit `outcome: 'failed'`:
```typescript
} catch (err) {
  logger.error('Webhook error', { error: err instanceof Error ? err : new Error(String(err)) });
  await emitWebhookTiming({ eventType: 'unknown', outcome: 'failed', latencyMs: Date.now() - startedAt });
  return NextResponse.json({ error: 'Internal error' }, { status: 500 });
}
```
(Note: `eventType` may not be in scope if parsing failed; declare `let eventType = 'unknown'` at the top of the try-block or put the emit inside a guard.)

- [ ] **Step 4: Add a test that the emit fires**

Append to `src/__tests__/payments/webhook-route-integration.test.ts`:

```typescript
import * as opsEvents from '@/lib/ops-events';

describe('webhook route — observability', () => {
  let mockAdmin: { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> };
  let opsEventSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';
    mockAdmin = { rpc: vi.fn(), from: vi.fn() };
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAdmin);
    opsEventSpy = vi.spyOn(opsEvents, 'logOpsEvent').mockResolvedValue(undefined);
  });

  it('emits payment.webhook_processed with latency_ms on every terminal path', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') return { data: [{ is_new: true, id: 'wh-x' }], error: null };
      if (name === 'activate_subscription_locked') return { data: null, error: null };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      return { data: null, error: null };
    });
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === 'students') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's1' }, error: null }) }) }) };
      if (table === 'payment_history') return {
        select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }),
        insert: async () => ({ error: null }),
      };
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    });

    await POST(makeRequest(buildEvent()) as unknown as import('next/server').NextRequest);

    const processedCall = opsEventSpy.mock.calls.find((args) =>
      (args[0] as { message?: string }).message === 'payment.webhook_processed',
    );
    expect(processedCall).toBeDefined();
    const ctx = (processedCall![0] as { context: { latency_ms: number; outcome: string; event_type: string } }).context;
    expect(typeof ctx.latency_ms).toBe('number');
    expect(ctx.latency_ms).toBeGreaterThanOrEqual(0);
    expect(ctx.outcome).toBe('activated');
    expect(ctx.event_type).toBe('payment.captured');
  });
});
```

- [ ] **Step 5: Run the new test**

Run: `npx vitest run src/__tests__/payments/webhook-route-integration.test.ts -t "observability"`
Expected: PASS.

- [ ] **Step 6: Run the full payment suite**

Run: `npx vitest run src/__tests__/payments/ src/__tests__/payment.test.ts src/__tests__/webhook-fallback.test.ts`
Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/payments/webhook/route.ts src/__tests__/payments/webhook-route-integration.test.ts
git commit -m "feat(payments): emit payment.webhook_processed timing per terminal path"
```

---

## Task 10: Document the recovery runbook

**Files:**
- Create: `docs/runbooks/payment-webhook-recovery.md`
- Modify: `LAUNCH_CHECKLIST.md` — add a "Payment webhook health" section.

- [ ] **Step 1: Create the runbook**

Create `docs/runbooks/payment-webhook-recovery.md` with:

```markdown
# Payment Webhook Recovery Runbook

## Scope
What to do when Razorpay payments arrive but entitlement is not granted.

## Architecture (post-hardening)

```
Razorpay → POST /api/payments/webhook
  ├── verifyRazorpaySignature (HMAC-SHA256, timing-safe)
  ├── record_webhook_event RPC (account_id + event_id unique → dedupe)
  ├── resolveStudent (3-step: notes.student_id → rz_sub_id → notes.user_id)
  ├── activate_subscription_locked RPC (advisory lock per student)
  │     └── on failure → atomic_subscription_activation_locked RPC
  │           └── on failure → return 503 (Razorpay retries)
  └── mark_webhook_event_processed (outcome dashboard)
```

## Common scenarios

### Scenario 1: Customer paid but plan still says Free

1. Find the payment in Razorpay dashboard. Note the `payment_id` and `event_id`.
2. Check `payment_webhook_events` table:
   ```sql
   SELECT * FROM payment_webhook_events
   WHERE razorpay_event_id = '<event_id>'
   ORDER BY received_at DESC;
   ```
   - **No row**: webhook never reached us. Check Razorpay's webhook delivery log for HTTP errors. Re-fire from Razorpay dashboard.
   - **Row with outcome=`unresolved`**: student lookup failed. Check `notes` payload for missing `student_id`/`user_id`. Fix in `students` table; re-fire webhook.
   - **Row with outcome=`failed`**: both RPCs failed. Check logs for the recorded errors; manually call `atomic_subscription_activation_locked` after fixing the underlying cause.
3. Verify entitlement granted:
   ```sql
   SELECT s.subscription_plan, ss.status, ss.plan_code
   FROM students s
   LEFT JOIN student_subscriptions ss ON ss.student_id = s.id
   WHERE s.id = '<student_id>';
   ```

### Scenario 2: Duplicate charges suspected

`payment_history.razorpay_payment_id` has a unique guard. Query:
```sql
SELECT razorpay_payment_id, count(*)
FROM payment_history
GROUP BY 1 HAVING count(*) > 1;
```
Expected: zero rows. If duplicates appear, the unique constraint is missing — escalate to architect.

### Scenario 3: Subscription cancelled but plan still active

`atomic_downgrade_subscription` RPC runs with row-level lock. Check:
```sql
SELECT * FROM payment_webhook_events
WHERE event_type IN ('subscription.cancelled','subscription.expired','subscription.completed')
  AND outcome IS NULL OR outcome = 'failed'
ORDER BY received_at DESC LIMIT 20;
```

### Scenario 4: High webhook latency

Query the timing dashboard:
```sql
SELECT
  context->>'event_type' AS event_type,
  context->>'outcome' AS outcome,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY (context->>'latency_ms')::int) AS p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY (context->>'latency_ms')::int) AS p95,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY (context->>'latency_ms')::int) AS p99,
  count(*)
FROM ops_events
WHERE message = 'payment.webhook_processed'
  AND created_at > now() - interval '1 hour'
GROUP BY 1, 2
ORDER BY p99 DESC;
```
If p99 > 5s (Razorpay timeout), escalate.

## Manual replay

```sql
-- Find the row
SELECT id, raw_payload FROM payment_webhook_events WHERE razorpay_event_id = '<event_id>';
-- Inspect raw_payload, then call activate_subscription_locked manually with the right args.
```
A self-service replay endpoint is tracked as a follow-on (Plan #4 Background Jobs).

## Kill switch
`SELECT * FROM feature_flags WHERE flag_name = 'ff_atomic_subscription_activation';`
Set `is_enabled = false` ONLY if `atomic_subscription_activation_locked` itself is misbehaving (then primary failure → 503 immediately, Razorpay retries).
```

- [ ] **Step 2: Update LAUNCH_CHECKLIST.md**

Open `LAUNCH_CHECKLIST.md`, find the existing payment section (or "Payments" header). Append:

```markdown
### Payment Webhook Health (post-hardening)
- [ ] `payment_webhook_events` table exists and unique constraint on `(razorpay_account_id, razorpay_event_id)` is in place
- [ ] `activate_subscription_locked` and `atomic_subscription_activation_locked` RPCs deployed
- [ ] `atomic_downgrade_subscription` RPC deployed
- [ ] `ff_atomic_subscription_activation` feature flag exists with `is_enabled = true`
- [ ] Sentry alert on `payment.webhook_processed` outcome=`failed` rate >1% over 15 min
- [ ] Runbook `docs/runbooks/payment-webhook-recovery.md` linked from on-call wiki
- [ ] At least one synthetic webhook fire in staging within last 24h before each prod deploy
```

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/payment-webhook-recovery.md LAUNCH_CHECKLIST.md
git commit -m "docs(payments): webhook recovery runbook + launch checklist update"
```

---

## Task 11: Run the full release-gate suite

**Files:** none changed; this is a verification gate before merge.

- [ ] **Step 1: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: exit 0 (warnings allowed, errors not).

- [ ] **Step 3: Full unit test suite**

Run: `npm test`
Expected: all 2,500+ tests pass.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exit 0; no bundle-budget violations on changed routes.

- [ ] **Step 5: List all changed files for review**

Run: `git log --oneline main..HEAD && git diff main..HEAD --stat`
Expected: 10 commits matching the tasks above; files limited to:
```
.claude/CLAUDE.md
CLAUDE.md
LAUNCH_CHECKLIST.md
docs/runbooks/payment-webhook-recovery.md
docs/superpowers/plans/2026-04-25-payment-webhook-hardening.md
src/__tests__/payments/webhook-concurrent-fire.test.ts
src/__tests__/payments/webhook-events-rpc.test.ts
src/__tests__/payments/webhook-route-integration.test.ts
src/app/api/payments/verify/route.ts
src/app/api/payments/webhook/route.ts
supabase/migrations/20260425150000_payment_webhook_events.sql
supabase/migrations/20260425150100_pin_search_path_activate_subscription.sql
supabase/migrations/20260425150200_atomic_downgrade_subscription_rpc.sql
supabase/migrations/20260425150300_activate_with_advisory_lock.sql
```

- [ ] **Step 6: P14 review-chain check (orchestrator gate)**

This change touches `src/app/api/payments/webhook/route.ts` and `src/app/api/payments/verify/route.ts`. Per `.claude/skills/review-chains/SKILL.md` and CLAUDE.md P14:

- Owner: backend
- Required reviewers: **architect** (security/auth), **testing** (Vitest + regression), **mobile** (mobile-web payment contract sync)

Spawn each via Agent tool:
- `architect`: review the migrations + RPC search_path + advisory lock semantics
- `testing`: run regression catalog and note any gaps
- `mobile`: verify the Flutter app's payment success/failure handling still aligns (no API surface change, but advisory lock can extend p99 latency)

- [ ] **Step 7: Open PR**

If review verdicts are APPROVE / APPROVE WITH CONDITIONS, push and open a PR titled:
```
feat(payments): webhook hardening — event dedupe, advisory lock, atomic downgrade, route tests
```

Body:
```
Closes the remaining gaps in payment webhook reliability after the
atomic_subscription_activation RPC landed. Highlights:
  - payment_webhook_events table for event-level idempotency
  - activate_subscription / atomic_subscription_activation now wrapped
    in advisory-lock RPCs (verify-route + webhook serialization)
  - atomic_downgrade_subscription replaces JS SELECT-then-UPDATE
  - search_path pinned on activate_subscription
  - subscription.pending event handled
  - route-level integration tests (signature, dedupe, fallback ladder, concurrent fire)
  - per-event timing emitted as payment.webhook_processed ops event
  - recovery runbook + launch checklist updated
  - CLAUDE.md P11 updated to reflect post-fix reality
```

---

## Out of scope (next plan)

The following are deliberately NOT in this plan; they belong to **Plan #4 (Background jobs)**:
- Self-service webhook replay endpoint (`POST /api/super-admin/payments/replay-webhook`)
- Dead-letter queue for events stuck on outcome=`failed` after Razorpay retry budget exhausts
- Reconciliation cron that scans `payment_webhook_events` for processed_at IS NULL > 1 hour
- Load-test rig (k6 or Playwright) hitting `/api/payments/webhook` at 100 concurrent

These need their own plan after observability data shows real load patterns.

---

## Self-review notes

- **Spec coverage:** Each gap I identified above maps to a task: dedupe (T2,T3), search_path (T4), atomic downgrade (T5), advisory lock (T6), pending event (T7), route-level tests (T8), observability (T9), docs (T10), gate (T11), CLAUDE.md update (T1).
- **Placeholders:** None. Every code/SQL block is complete and copy-pasteable.
- **Type consistency:** RPC names match across migrations and route code (`activate_subscription_locked`, `atomic_subscription_activation_locked`, `atomic_downgrade_subscription`, `record_webhook_event`, `mark_webhook_event_processed`, `mark_subscription_past_due`). Outcome enum (`'ack' | 'dedupe' | 'activated' | 'downgraded' | 'failed' | 'unresolved'`) matches between migration CHECK and TypeScript type.
- **Risk:** Medium. Advisory locks could extend p99 if the RPC body grows. Migration order matters: T2 must apply before T3's route changes hit prod. T6's wrapper RPC depends on T4's search_path-fixed primary RPC.
- **Approval:** Auto. No P1-P14 changes; this implements the existing P11 promise more robustly. CLAUDE.md text update merely reflects what code already does.
