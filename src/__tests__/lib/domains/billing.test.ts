/**
 * Billing domain (Phase 0g.1, B10) — typed read API contract tests.
 *
 * Covers input validation (no env required) and integration happy paths
 * gated by hasSupabaseIntegrationEnv(). Mirrors identity.test.ts.
 *
 * Scope: read-only helpers from src/lib/domains/billing.ts
 *   - listSubscriptionPlans
 *   - getSubscriptionPlanByCode
 *   - getStudentSubscription
 *   - getPayment
 *   - listPayments
 *   - getRazorpayOrderByOrderId
 *   - listRazorpayWebhooks
 *
 * P11 contract guard: this module exposes NO write helpers. Tests assert
 * that by importing the module surface — if a writer function is added,
 * the dedicated guard test below will fail.
 */

import { describe, it, expect } from 'vitest';
import { hasSupabaseIntegrationEnv } from '@/__tests__/helpers/integration';
import * as billing from '@/lib/domains/billing';
import {
  listSubscriptionPlans,
  getSubscriptionPlanByCode,
  getStudentSubscription,
  getPayment,
  listPayments,
  getRazorpayOrderByOrderId,
  listRazorpayWebhooks,
} from '@/lib/domains/billing';

// ── P11 module-surface guard ──────────────────────────────────────────────────

describe('billing domain — module surface (P11 guard)', () => {
  it('exports only read helpers — no write/activate/cancel functions', () => {
    const exports = Object.keys(billing);
    const writeFns = exports.filter((name) =>
      /^(activate|cancel|create|update|delete|insert|upsert|write|set|enqueue|process)/i.test(
        name
      )
    );
    expect(writeFns).toEqual([]);
  });

  it('exports the documented read helpers', () => {
    expect(typeof listSubscriptionPlans).toBe('function');
    expect(typeof getSubscriptionPlanByCode).toBe('function');
    expect(typeof getStudentSubscription).toBe('function');
    expect(typeof getPayment).toBe('function');
    expect(typeof listPayments).toBe('function');
    expect(typeof getRazorpayOrderByOrderId).toBe('function');
    expect(typeof listRazorpayWebhooks).toBe('function');
  });
});

// ── Input validation (always run, no env required) ────────────────────────────

describe('billing domain — input validation', () => {
  it('getSubscriptionPlanByCode rejects empty planCode', async () => {
    const r = await getSubscriptionPlanByCode('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getStudentSubscription rejects empty studentId', async () => {
    const r = await getStudentSubscription('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getPayment rejects empty paymentId', async () => {
    const r = await getPayment('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listPayments rejects when neither studentId nor status provided', async () => {
    const r = await listPayments({});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getRazorpayOrderByOrderId rejects empty razorpayOrderId', async () => {
    const r = await getRazorpayOrderByOrderId('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });
});

// ── Integration happy path (skipped without env) ──────────────────────────────
//
// Uses fake UUIDs / fake plan codes that should not resolve. Each function
// is asserted to either return ok with empty/null data, or — for tables
// that may not be fully provisioned in a test database — DB_ERROR (the
// soft-fail path). Either is an acceptable contract result.

const FAKE_STUDENT = '00000000-0000-0000-0000-00000000dead';
const FAKE_PAYMENT = '00000000-0000-0000-0000-00000000beef';
const FAKE_PLAN_CODE = '__test_nonexistent_plan_code__';
const FAKE_RAZORPAY_ORDER = 'order_TEST_NONEXISTENT';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

describeIntegration('billing domain — integration (empty/null happy case)', () => {
  it('listSubscriptionPlans returns ok with array (active-only default)', async () => {
    const r = await listSubscriptionPlans();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
    // every active plan must have isActive: true
    for (const p of r.data) expect(p.isActive).toBe(true);
  });

  it('listSubscriptionPlans({activeOnly:false}) returns ok with array', async () => {
    const r = await listSubscriptionPlans({ activeOnly: false });
    expect(r.ok).toBe(true);
  });

  it('getSubscriptionPlanByCode returns ok with null for unknown code', async () => {
    const r = await getSubscriptionPlanByCode(FAKE_PLAN_CODE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('getStudentSubscription returns ok with null for unknown student', async () => {
    const r = await getStudentSubscription(FAKE_STUDENT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('getPayment returns ok with null for unknown id', async () => {
    const r = await getPayment(FAKE_PAYMENT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('listPayments({studentId, limit}) clamps and returns ok with array', async () => {
    const r = await listPayments({ studentId: FAKE_STUDENT, limit: 9999 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
    expect(r.data.length).toBeLessThanOrEqual(200);
  });

  it('listPayments({status}) returns ok with array (admin surface)', async () => {
    const r = await listPayments({ status: 'failed' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('getRazorpayOrderByOrderId returns ok with null for unknown order', async () => {
    const r = await getRazorpayOrderByOrderId(FAKE_RAZORPAY_ORDER);
    if (r.ok) {
      expect(r.data).toBeNull();
    } else {
      // Soft-fail acceptable if razorpay_orders table not provisioned in test DB
      expect(r.code).toBe('DB_ERROR');
    }
  });

  it('listRazorpayWebhooks returns ok with array (admin surface)', async () => {
    const r = await listRazorpayWebhooks({ limit: 10 });
    if (r.ok) {
      expect(Array.isArray(r.data)).toBe(true);
      expect(r.data.length).toBeLessThanOrEqual(10);
    } else {
      expect(r.code).toBe('DB_ERROR');
    }
  });
});
