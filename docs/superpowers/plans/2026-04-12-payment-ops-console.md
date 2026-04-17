# Payment Ops Console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Payment Ops" tab to the existing subscriptions admin page with stuck-payment detection, one-click reconciliation, failure timeline, and activation timing analytics.

**Architecture:** No new tables. 3 new API routes read from `payment_history`, `students`, `student_subscriptions`, and `ops_events`. Reconciliation writes to `students` and `student_subscriptions` using the same logic as `reconcile_stuck_payments.sql`. A new tab component on the existing subscriptions page renders all payment ops views.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase PostgreSQL (service-role), Tailwind 3.4, SWR.

**Branch:** `feature/observability-console`

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/app/api/super-admin/payment-ops/stuck/route.ts` | GET: detect stuck payments |
| `src/app/api/super-admin/payment-ops/reconcile/route.ts` | POST: fix stuck payments (single or batch) |
| `src/app/api/super-admin/payment-ops/stats/route.ts` | GET: health strip stats |
| `src/app/super-admin/subscriptions/_components/PaymentOpsTab.tsx` | Payment Ops tab UI |
| `src/__tests__/payment-ops-api.test.ts` | API tests |
| `e2e/payment-ops.spec.ts` | Playwright E2E |

### Modified files

| Path | Change |
|---|---|
| `src/app/super-admin/subscriptions/page.tsx` | Add tab switching (Revenue & Entitlements / Payment Ops) |
| `docs/quality/testing-strategy.md` | Add regression entries R48-R49 |

---

## Tasks

### Task 1: Stuck payments detection API

**Files:**
- Create: `src/app/api/super-admin/payment-ops/stuck/route.ts`

- [ ] **Step 1.1: Create the route**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response!;

  // Same detection logic as reconcile_stuck_payments.sql
  const { data, error } = await supabaseAdmin
    .from('payment_history')
    .select(`
      id, student_id, razorpay_payment_id, razorpay_order_id,
      plan_code, billing_cycle, amount, status, created_at,
      students!inner(id, name, email, subscription_plan, subscription_expiry)
    `)
    .eq('status', 'captured')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Filter stuck: student plan doesn't match payment plan
  const stuck = (data ?? []).filter((ph: any) => {
    const student = ph.students;
    return !student.subscription_plan
      || student.subscription_plan === 'free'
      || student.subscription_plan !== ph.plan_code;
  });

  return NextResponse.json({ stuck, total: stuck.length });
}
```

IMPORTANT: Read the actual `payment_history` table columns and verify the Supabase join syntax works. The `students!inner(...)` join pattern may need adjustment based on how FKs are defined. If the FK relationship isn't named, use `.select('*, students(*)').eq(...)` or a separate query.

- [ ] **Step 1.2: Commit**

```bash
git add src/app/api/super-admin/payment-ops/stuck
git commit -m "feat(payment-ops): add stuck payment detection API"
```

---

### Task 2: Reconciliation API

**Files:**
- Create: `src/app/api/super-admin/payment-ops/reconcile/route.ts`

- [ ] **Step 2.1: Create the route**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logOpsEvent } from '@/lib/ops-events';

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response!;

  const body = await request.json();
  const { studentId, paymentId, all } = body;

  if (!all && (!studentId || !paymentId)) {
    return NextResponse.json({ error: 'studentId and paymentId required (or all: true)' }, { status: 400 });
  }

  // Fetch stuck payments to reconcile
  let stuckQuery = supabaseAdmin
    .from('payment_history')
    .select('id, student_id, plan_code, billing_cycle, amount, created_at, students!inner(id, name, email, subscription_plan)')
    .eq('status', 'captured');

  if (!all) {
    stuckQuery = stuckQuery.eq('student_id', studentId).eq('id', paymentId);
  }

  const { data: payments, error: fetchErr } = await stuckQuery;
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  // Filter to actually stuck ones
  const toFix = (payments ?? []).filter((ph: any) => {
    const s = ph.students;
    return !s.subscription_plan || s.subscription_plan === 'free' || s.subscription_plan !== ph.plan_code;
  });

  let fixed = 0;
  let errors: string[] = [];

  for (const ph of toFix) {
    try {
      // 1. Update student plan
      const expiry = new Date(ph.created_at);
      if (ph.billing_cycle === 'yearly') expiry.setFullYear(expiry.getFullYear() + 1);
      else expiry.setDate(expiry.getDate() + 30);

      await supabaseAdmin
        .from('students')
        .update({
          subscription_plan: ph.plan_code,
          subscription_expiry: expiry.toISOString(),
        })
        .eq('id', ph.student_id);

      // 2. Upsert student_subscriptions
      await supabaseAdmin
        .from('student_subscriptions')
        .upsert({
          student_id: ph.student_id,
          plan_code: ph.plan_code,
          status: 'active',
          billing_cycle: ph.billing_cycle,
          razorpay_payment_id: ph.razorpay_payment_id ?? null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'student_id' });

      // 3. Ops event
      await logOpsEvent({
        category: 'payment',
        source: 'payment-ops',
        severity: 'info',
        message: 'manual reconciliation',
        subjectType: 'student',
        subjectId: ph.student_id,
        context: {
          payment_id: ph.id,
          plan_code: ph.plan_code,
          amount: ph.amount,
          admin_email: auth.email,
        },
      });

      // 4. Audit log
      await logAdminAudit(
        { adminId: auth.adminId!, email: auth.email! },
        'payment_reconciled',
        'payment_history',
        ph.id,
        { student_id: ph.student_id, plan_code: ph.plan_code },
      );

      fixed += 1;
    } catch (err) {
      errors.push(`${ph.student_id}: ${String(err)}`);
    }
  }

  return NextResponse.json({ fixed, total: toFix.length, errors });
}
```

IMPORTANT: Verify `student_subscriptions` table's conflict target. It may use `student_id` as a unique constraint or `(student_id, plan_code)`. Read the existing webhook handler's upsert pattern for the correct `onConflict` value.

- [ ] **Step 2.2: Commit**

```bash
git add src/app/api/super-admin/payment-ops/reconcile
git commit -m "feat(payment-ops): add one-click reconciliation API"
```

---

### Task 3: Stats API + seeded alert rule

**Files:**
- Create: `src/app/api/super-admin/payment-ops/stats/route.ts`

- [ ] **Step 3.1: Create the stats route**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response!;

  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();

  const [stuckRes, failuresRes, recentPaymentsRes] = await Promise.all([
    // Stuck count
    supabaseAdmin
      .from('payment_history')
      .select('id, student_id, plan_code, students!inner(subscription_plan)')
      .eq('status', 'captured'),

    // Payment failures in last 24h (from ops_events)
    supabaseAdmin
      .from('ops_events')
      .select('id', { count: 'exact', head: true })
      .eq('category', 'payment')
      .in('severity', ['error', 'critical'])
      .gte('occurred_at', twentyFourHoursAgo),

    // Last 50 captured payments for timing analysis
    supabaseAdmin
      .from('payment_history')
      .select('id, student_id, plan_code, created_at')
      .eq('status', 'captured')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  // Compute stuck count
  const stuckCount = (stuckRes.data ?? []).filter((ph: any) => {
    const s = ph.students;
    return !s?.subscription_plan || s.subscription_plan === 'free' || s.subscription_plan !== ph.plan_code;
  }).length;

  // Failures count
  const failureCount = failuresRes.count ?? 0;

  // Activation timing: for each recent payment, find when subscription became active
  let timings: number[] = [];
  for (const ph of (recentPaymentsRes.data ?? []).slice(0, 20)) {
    const { data: sub } = await supabaseAdmin
      .from('student_subscriptions')
      .select('updated_at')
      .eq('student_id', ph.student_id)
      .eq('plan_code', ph.plan_code)
      .eq('status', 'active')
      .gte('updated_at', ph.created_at)
      .order('updated_at', { ascending: true })
      .limit(1);

    if (sub?.[0]?.updated_at) {
      const delta = (new Date(sub[0].updated_at).getTime() - new Date(ph.created_at).getTime()) / 1000;
      if (delta >= 0 && delta < 3600) timings.push(delta); // ignore >1h outliers
    }
  }

  timings.sort((a, b) => a - b);
  const median = timings.length > 0 ? timings[Math.floor(timings.length / 2)] : null;
  const p95 = timings.length >= 5 ? timings[Math.floor(timings.length * 0.95)] : null;
  const max = timings.length > 0 ? timings[timings.length - 1] : null;

  return NextResponse.json({
    stuckCount,
    failureCount24h: failureCount,
    activationTiming: { median, p95, max, sampleSize: timings.length },
  });
}
```

- [ ] **Step 3.2: Seed a "Stuck payment detected" alert rule**

Add to the migration or run directly: insert a disabled rule with `category='payment'`, `min_severity='error'`, `count_threshold=1`, `window_minutes=60`.

Actually — the stuck-payment detection doesn't go through `ops_events` (it's a derived query, not an event). Instead, seed the rule as: "Payment failure spike" — `category='payment'`, `min_severity='error'`, `count_threshold=3`, `window_minutes=60`, `cooldown_minutes=30`. This fires when multiple payment failures happen in an hour, which is the actionable signal.

Insert via the API or directly in the stats route's first-run check. Simplest: add it via a small migration or a Supabase MCP call.

- [ ] **Step 3.3: Commit**

```bash
git add src/app/api/super-admin/payment-ops/stats
git commit -m "feat(payment-ops): add payment stats API with stuck count and activation timing"
```

---

### Task 4: Payment Ops Tab UI

**Files:**
- Create: `src/app/super-admin/subscriptions/_components/PaymentOpsTab.tsx`
- Modify: `src/app/super-admin/subscriptions/page.tsx`

- [ ] **Step 4.1: Create the PaymentOpsTab component**

A `'use client'` component that fetches from all 3 payment-ops API routes and renders:

1. **Health strip** — stuck count (yellow if >0), failure count (24h), activation timing (median/p95)
2. **Reconcile All button** — POST to `/reconcile` with `{ all: true }`, shows result
3. **Stuck payments table** — from `/stuck` API, per-row [Reconcile] button
4. **Recent failures** — from `ops_events` (reuse the same pattern as the observability timeline, but filtered to category=payment severity≥error, last 20)
5. **Activation timing table** — last 20 payments with timing delta

Uses SWR for data fetching with `mutate` after reconciliation.

- [ ] **Step 4.2: Add tab switching to the subscriptions page**

Read `src/app/super-admin/subscriptions/page.tsx`. Add tab state:
- Tab 1: existing content (wrap in a div that shows/hides)
- Tab 2: `<PaymentOpsTab />`

Tab switcher UI: two buttons at the top, same style as the Student Detail page tabs.

- [ ] **Step 4.3: Type-check, build, commit**

```bash
npm run type-check
npm run build
git add src/app/super-admin/subscriptions
git commit -m "feat(payment-ops): add Payment Ops tab with stuck detection, reconciliation, and timing"
```

---

### Task 5: Tests + regression + verification

**Files:**
- Create: `src/__tests__/payment-ops-api.test.ts`
- Create: `e2e/payment-ops.spec.ts`
- Modify: `docs/quality/testing-strategy.md`

- [ ] **Step 5.1: Create API tests**

Test: GET /stuck returns array, POST /reconcile validates input, GET /stats returns expected shape.

- [ ] **Step 5.2: Create Playwright spec**

Test: navigate to subscriptions, click Payment Ops tab, verify health strip renders, verify stuck table renders.

- [ ] **Step 5.3: Add regression entries**

R48: Reconciliation action is audit-logged in both ops_events and admin_audit_log.
R49: Stuck payment detection query matches the logic in reconcile_stuck_payments.sql runbook.

- [ ] **Step 5.4: Run full verification**

```bash
npm run type-check && npm run lint && npm test && npm run build
```

- [ ] **Step 5.5: Commit and push**

```bash
git add src/__tests__/payment-ops-api.test.ts e2e/payment-ops.spec.ts docs/quality/testing-strategy.md
git commit -m "test(payment-ops): add API tests, E2E spec, regression entries R48-R49"
git push origin feature/observability-console
```

---

## Post-implementation
- No new Supabase migration needed (no new tables)
- Seed the "Payment failure spike" alert rule via Supabase MCP
- Verify on staging: navigate to subscriptions → Payment Ops tab