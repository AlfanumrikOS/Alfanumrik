import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Track A.5 — checkPlanGateEffective backward-compat + UP-only invariant.
 *
 * Under test: src/lib/plan-gate.ts → checkPlanGateEffective(...)
 *
 * Invariants pinned:
 *   1. It only ever RAISES the gate tier: effectivePlan = max(supplied, resolved)
 *      by tier. It NEVER lowers the gate → never strips existing access.
 *   2. studentId null → it is a byte-identical pass-through to checkPlanGate
 *      (no resolver call at all).
 *   3. A resolver ERROR fails OPEN to the supplied plan (today's behavior).
 *   4. The downstream checkPlanGate is always called with the chosen plan.
 *
 * We mock the effective-plan resolver (its own behavior is proven in
 * effective-plan-resolver.test.ts) and the override lookup (supabase-admin), so
 * we observe EXACTLY which plan string the gate enforces on.
 */

// ─── resolver seam ───────────────────────────────────────────────────────────
const resolveEffectivePlanCode = vi.fn();
vi.mock('@alfanumrik/lib/entitlements/effective-plan', () => ({
  resolveEffectivePlanCode: (...a: unknown[]) => resolveEffectivePlanCode(...a),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── supabase-admin: capture the plan the override lookup is keyed on ─────────
// checkPlanGate calls .from('plan_permission_overrides').select(...).eq('plan',X)
//   .eq('permission_code',Y).maybeSingle(). We record the X to assert the
//   enforced plan; returning {data:null} makes checkPlanGate grant (no override).
const eqCalls: Array<[string, unknown]> = [];
function overridesChain() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (col: string, val: unknown) => { eqCalls.push([col, val]); return chain; };
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  return chain;
}
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: () => overridesChain(), rpc: vi.fn() }),
  supabaseAdmin: { from: () => overridesChain(), rpc: vi.fn() },
}));

import { checkPlanGateEffective, clearPlanGateCache } from '@alfanumrik/lib/plan-gate';

function enforcedPlan(): string | undefined {
  const planEq = eqCalls.find(([c]) => c === 'plan');
  return planEq?.[1] as string | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearPlanGateCache();
  eqCalls.length = 0;
});

describe('checkPlanGateEffective — UP-only invariant', () => {
  it('RAISES the gate when school coverage exceeds the supplied plan (free → pro)', async () => {
    resolveEffectivePlanCode.mockResolvedValue('pro');
    const res = await checkPlanGateEffective('user-1', 'foxy.chat', 'free', 'student-1');
    expect(res.granted).toBe(true);
    expect(enforcedPlan()).toBe('pro'); // gated UP at the school tier
  });

  it('NEVER lowers the gate: supplied pro, resolved free → still enforces pro', async () => {
    resolveEffectivePlanCode.mockResolvedValue('free');
    await checkPlanGateEffective('user-1', 'foxy.chat', 'pro', 'student-1');
    expect(enforcedPlan()).toBe('pro'); // max(pro, free) = pro — not lowered
  });

  it('equal tiers → enforces the supplied plan (no change)', async () => {
    resolveEffectivePlanCode.mockResolvedValue('starter');
    await checkPlanGateEffective('user-1', 'foxy.chat', 'starter', 'student-1');
    expect(enforcedPlan()).toBe('starter');
  });
});

describe('checkPlanGateEffective — backward compatibility', () => {
  it('studentId null → pass-through to checkPlanGate, resolver NOT called', async () => {
    const res = await checkPlanGateEffective('user-1', 'foxy.chat', 'starter', null);
    expect(resolveEffectivePlanCode).not.toHaveBeenCalled();
    expect(enforcedPlan()).toBe('starter');
    expect(res.granted).toBe(true);
  });

  it('B2C-only student (resolver returns the same personal plan) → identical to today', async () => {
    resolveEffectivePlanCode.mockResolvedValue('starter');
    await checkPlanGateEffective('user-1', 'foxy.chat', 'starter', 'student-1');
    expect(enforcedPlan()).toBe('starter');
  });

  it('free-tier student (resolver returns free) → enforces free, unchanged', async () => {
    resolveEffectivePlanCode.mockResolvedValue('free');
    await checkPlanGateEffective('user-1', 'foxy.chat', 'free', 'student-1');
    expect(enforcedPlan()).toBe('free');
  });

  it('resolver ERROR → fails OPEN to the supplied plan (today’s behavior)', async () => {
    resolveEffectivePlanCode.mockRejectedValue(new Error('resolver down'));
    const res = await checkPlanGateEffective('user-1', 'foxy.chat', 'starter', 'student-1');
    expect(enforcedPlan()).toBe('starter'); // fell back to supplied plan
    expect(res.granted).toBe(true);
  });
});
