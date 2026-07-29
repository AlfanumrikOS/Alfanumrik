/**
 * usage.ts — SERVER-AUTHORITATIVE limit resolution (P0-1 school-coverage fix).
 *
 * THE DEFECT BEING PINNED
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforcement (`check_and_record_usage` → `get_plan_limit`) has honoured SCHOOL
 * (B2B) coverage since migration 20260729130400. DISPLAY, however, was computed
 * from the TypeScript `PLAN_LIMITS` table keyed on `students.subscription_plan`
 * — a column that is school-blind. A student covered by a paid/trial school
 * therefore saw "5 chats left" and was BLOCKED CLIENT-SIDE at 5 while the server
 * would have allowed unlimited. That is the school-demo failure.
 *
 * `checkDailyUsage` now PREFERS `GET /api/usage/daily`, a thin read-through to
 * the very same `get_plan_limit()` RPC. These tests pin:
 *
 *   1. A school-covered student's DISPLAYED limit equals the ENFORCED limit.
 *   2. Pure-B2C students are unchanged (no regression) on both branches.
 *   3. The fallback is CONSERVATIVE — on any server failure it degrades to the
 *      school-blind local default and never fabricates a generous number.
 *   4. The unlimited sentinel is always DETECTABLE, so no surface can render a
 *      literal "999999" (or "-1") countdown.
 *
 * P13: synthetic student ids only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock the legacy supabase facade (the FALLBACK branch's usage read) ────────

const mockMaybeSingle = vi.fn();
const mockEqDate = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockEqFeature = vi.fn(() => ({ eq: mockEqDate }));
const mockEqStudent = vi.fn(() => ({ eq: mockEqFeature }));
const mockSelect = vi.fn(() => ({ eq: mockEqStudent }));

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: mockSelect }),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  },
}));

vi.mock('@alfanumrik/lib/plan-gate', () => ({
  checkPlanGate: vi.fn(),
}));

import {
  checkDailyUsage,
  clearUsageCache,
  isUnlimitedUsage,
  UNLIMITED_USAGE_SENTINEL,
} from '@alfanumrik/lib/usage';

// ── /api/usage/daily transport control ───────────────────────────────────────

const SCHOOL_STUDENT = 'student-school-covered-1';
const B2C_STUDENT = 'student-b2c-1';

const originalFetch = globalThis.fetch;
const fetchSpy = vi.fn();

/** Server answers with an authoritative limit + count. */
function serverAnswers(limit: number, count: number) {
  fetchSpy.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { limit, count } }),
  });
}

/** Server refuses to answer (503 / network / malformed) — the conservative path. */
function serverSilent(mode: 'http-503' | 'network' | 'not-success' | 'malformed' | 'nan') {
  switch (mode) {
    case 'http-503':
      fetchSpy.mockResolvedValue({ ok: false, json: async () => ({ success: false }) });
      break;
    case 'network':
      fetchSpy.mockRejectedValue(new Error('network down'));
      break;
    case 'not-success':
      fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: false }) });
      break;
    case 'malformed':
      fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
      break;
    case 'nan':
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { limit: 'unlimited', count: null } }),
      });
      break;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  clearUsageCache();
  mockSelect.mockReturnValue({ eq: mockEqStudent });
  mockEqStudent.mockReturnValue({ eq: mockEqFeature });
  mockEqFeature.mockReturnValue({ eq: mockEqDate });
  mockEqDate.mockReturnValue({ maybeSingle: mockMaybeSingle });
  mockMaybeSingle.mockResolvedValue({ data: { usage_count: 0 }, error: null });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. School coverage — displayed == enforced
// ══════════════════════════════════════════════════════════════════════════════

describe('checkDailyUsage — school-covered student sees the ENFORCED limit', () => {
  it('a free-column student covered by a paid school shows the school cap, not 5', async () => {
    // Server (get_plan_limit) says unlimited because the school subscription is
    // active. The student's own `subscription_plan` column still says 'free'.
    serverAnswers(UNLIMITED_USAGE_SENTINEL, 12);

    const result = await checkDailyUsage(SCHOOL_STUDENT, 'foxy_chat', 'free');

    expect(result.limit).toBe(UNLIMITED_USAGE_SENTINEL);
    expect(result.count).toBe(12);
    expect(result.allowed).toBe(true);
    // The old behavior — the demo defect — was exactly this.
    expect(result.limit).not.toBe(5);
  });

  it('the student is NOT blocked client-side at the free cap when the server allows more', async () => {
    // 7 chats used: the old PLAN_LIMITS.free cap of 5 would have blocked here.
    serverAnswers(UNLIMITED_USAGE_SENTINEL, 7);
    const result = await checkDailyUsage(SCHOOL_STUDENT, 'foxy_chat', 'free');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it('a finite school-derived cap (e.g. a basic school → starter quiz cap of 20) is displayed verbatim', async () => {
    serverAnswers(20, 3);
    const result = await checkDailyUsage(SCHOOL_STUDENT, 'quiz', 'free');
    expect(result.limit).toBe(20);
    expect(result.remaining).toBe(17);
    expect(result.allowed).toBe(true);
  });

  it('the displayed count comes from the SAME response as the limit (one consistent moment)', async () => {
    serverAnswers(20, 20);
    const result = await checkDailyUsage(SCHOOL_STUDENT, 'quiz', 'free');
    expect(result.count).toBe(20);
    expect(result.limit).toBe(20);
    expect(result.remaining).toBe(0);
    expect(result.allowed).toBe(false);
    // The local fallback read must NOT have been consulted.
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it('asks the server for the specific feature being checked', async () => {
    serverAnswers(5, 0);
    await checkDailyUsage(SCHOOL_STUDENT, 'quiz', 'free');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('feature=quiz');
    // Session cookie must ride along or authorizeRequest cannot resolve the caller.
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Pure-B2C students are unchanged
// ══════════════════════════════════════════════════════════════════════════════

describe('checkDailyUsage — pure-B2C students are unchanged (no regression)', () => {
  const B2C_CASES: Array<[string, 'foxy_chat' | 'quiz', number]> = [
    ['free', 'foxy_chat', 5],
    ['free', 'quiz', 5],
    ['starter', 'quiz', 20],
    ['starter', 'foxy_chat', UNLIMITED_USAGE_SENTINEL],
    ['pro', 'foxy_chat', UNLIMITED_USAGE_SENTINEL],
    ['pro', 'quiz', UNLIMITED_USAGE_SENTINEL],
    ['unlimited', 'quiz', UNLIMITED_USAGE_SENTINEL],
    // legacy aliases + billing-cycle suffixes still normalise
    ['basic', 'quiz', 20],
    ['premium_monthly', 'quiz', UNLIMITED_USAGE_SENTINEL],
    ['ultimate_yearly', 'foxy_chat', UNLIMITED_USAGE_SENTINEL],
  ];

  for (const [plan, feature, expected] of B2C_CASES) {
    it(`FALLBACK branch: plan "${plan}" + ${feature} still resolves to ${expected}`, async () => {
      serverSilent('network');
      clearUsageCache();
      const result = await checkDailyUsage(`${B2C_STUDENT}-${plan}-${feature}`, feature, plan);
      expect(result.limit).toBe(expected);
    });

    it(`SERVER branch: plan "${plan}" + ${feature} is byte-identical when the server agrees`, async () => {
      serverAnswers(expected, 1);
      clearUsageCache();
      const result = await checkDailyUsage(`${B2C_STUDENT}-srv-${plan}-${feature}`, feature, plan);
      expect(result.limit).toBe(expected);
      expect(result.count).toBe(1);
    });
  }

  it('an unknown plan code still falls back to the free tier', async () => {
    serverSilent('network');
    const result = await checkDailyUsage(B2C_STUDENT, 'foxy_chat', 'no-such-plan');
    expect(result.limit).toBe(5);
  });

  it('the fallback still reads the local usage row for the count', async () => {
    serverSilent('network');
    mockMaybeSingle.mockResolvedValue({ data: { usage_count: 4 }, error: null });
    const result = await checkDailyUsage(B2C_STUDENT, 'foxy_chat', 'free');
    expect(result.count).toBe(4);
    expect(result.remaining).toBe(1);
    expect(result.allowed).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. Conservative fallback — never fabricate a generous number
// ══════════════════════════════════════════════════════════════════════════════

describe('checkDailyUsage — conservative fallback contract', () => {
  const FAILURES: Array<['http-503' | 'network' | 'not-success' | 'malformed' | 'nan', string]> = [
    ['http-503', 'a non-2xx response (the route 503s rather than guessing)'],
    ['network', 'a network error'],
    ['not-success', 'a 200 with success:false'],
    ['malformed', 'a 200 with no limit/count'],
    ['nan', 'a 200 with non-numeric limit/count'],
  ];

  for (const [mode, label] of FAILURES) {
    it(`falls back to the school-blind free default on ${label} — never to unlimited`, async () => {
      serverSilent(mode);
      clearUsageCache();
      const result = await checkDailyUsage(`${SCHOOL_STUDENT}-${mode}`, 'foxy_chat', 'free');

      expect(result.limit).toBe(5);
      expect(isUnlimitedUsage(result.limit)).toBe(false);
      // The direction matters: it may UNDER-promise for a school student, but it
      // must never OVER-promise for anyone.
      expect(result.limit).toBeLessThanOrEqual(5);
    });
  }

  it('never throws, whatever the transport does', async () => {
    fetchSpy.mockImplementation(() => {
      throw new Error('sync explosion');
    });
    await expect(checkDailyUsage(B2C_STUDENT, 'foxy_chat', 'free')).resolves.toBeDefined();
  });

  it('a rejected 0 limit from the server is honoured (0 is a real answer, not a failure)', async () => {
    serverAnswers(0, 0);
    const result = await checkDailyUsage(`${B2C_STUDENT}-zero`, 'foxy_chat', 'free');
    expect(result.limit).toBe(0);
    expect(result.allowed).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. The unlimited sentinel must never render as a literal number
// ══════════════════════════════════════════════════════════════════════════════

describe('unlimited sentinel — never user-visible', () => {
  it('every unlimited path produces a limit that isUnlimitedUsage() detects', async () => {
    // Server branch.
    serverAnswers(UNLIMITED_USAGE_SENTINEL, 0);
    const fromServer = await checkDailyUsage(`${SCHOOL_STUDENT}-u1`, 'foxy_chat', 'free');
    expect(isUnlimitedUsage(fromServer.limit)).toBe(true);

    // Fallback branch, paid tier.
    serverSilent('network');
    clearUsageCache();
    const fromFallback = await checkDailyUsage(`${B2C_STUDENT}-u2`, 'foxy_chat', 'pro');
    expect(isUnlimitedUsage(fromFallback.limit)).toBe(true);
  });

  it('a value ABOVE the sentinel is also treated as unlimited (future-proof, not an equality test)', () => {
    expect(isUnlimitedUsage(UNLIMITED_USAGE_SENTINEL)).toBe(true);
    expect(isUnlimitedUsage(UNLIMITED_USAGE_SENTINEL + 1)).toBe(true);
    expect(isUnlimitedUsage(1_000_000)).toBe(true);
  });

  it('finite caps are NOT mistaken for unlimited', () => {
    for (const finite of [0, 1, 5, 20, 200, 999_998]) {
      expect(isUnlimitedUsage(finite), String(finite)).toBe(false);
    }
  });

  it('the RAW DB display sentinel -1 is unlimited too (not a finite cap of -1)', () => {
    // `subscription_plans.foxy_chats_per_day` stores literal -1 on every paid
    // plan. `get_plan_limit()` converts it to 999999, but surfaces that read the
    // plan row directly hand us the -1 unconverted. Reading -1 as a FINITE cap
    // made a paid student's uncapped plan render as exhausted.
    expect(isUnlimitedUsage(-1)).toBe(true);
    expect(isUnlimitedUsage(-999)).toBe(true);
  });

  it('non-numeric / nullish / NaN limits are never unlimited (fail closed)', () => {
    expect(isUnlimitedUsage(null)).toBe(false);
    expect(isUnlimitedUsage(undefined)).toBe(false);
    expect(isUnlimitedUsage(Number.NaN)).toBe(false);
    // The error path in usage.ts returns limit: 0 — must stay finite.
    expect(isUnlimitedUsage(0)).toBe(false);
  });

  it('the sentinel constant mirrors the DB mapping documented in get_plan_limit (-1 → 999999)', () => {
    expect(UNLIMITED_USAGE_SENTINEL).toBe(999999);
  });

  it('the Foxy header badge renders through isUnlimitedUsage, never a raw limit interpolation', async () => {
    // Static-source contract canary (established pattern in this suite): the
    // badge must not print `${limit}` unguarded, or a school-covered student
    // sees "999999". Behavioural rendering of the full Foxy page is out of
    // reach in a unit test, so the pin is on the guard's presence.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '../../app/foxy/page.tsx'),
      'utf8'
    );
    expect(src).toContain('isUnlimitedUsage(chatUsage.limit)');
    // The unguarded countdown must appear ONLY inside the ternary's false arm.
    const badge = src.slice(src.indexOf('isUnlimitedUsage(chatUsage.limit)'));
    expect(badge.slice(0, 300)).toMatch(/Unlimited|असीमित/);
    // No literal sentinel anywhere in the page's user-facing strings.
    expect(src).not.toContain('999999');
  });
});
