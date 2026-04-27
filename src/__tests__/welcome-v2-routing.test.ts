import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Welcome v1/v2 routing decision tests.
 *
 * Verifies the server-component routing logic in `src/app/welcome/page.tsx`
 * which decides whether to render the legacy `WelcomeV1` or the new editorial
 * `WelcomeV2` based on:
 *   1. The `?v=` query-string escape hatch (always wins)
 *   2. The `ff_welcome_v2` feature flag's enabled state
 *   3. The flag's `rollout_percentage` plus the per-anon-id deterministic hash
 *
 * Implementation notes:
 *   - We mock `next/headers` `cookies()` and `@/lib/feature-flags`
 *     `isFeatureEnabled` (per case) so we test the routing logic in isolation
 *     from real Supabase / cookie infrastructure.
 *   - WelcomeV1 / WelcomeV2 are mocked to simple sentinel components so we can
 *     assert which one was returned by the server component.
 *   - The page is async and returns React elements directly — no React render
 *     is needed; we inspect the returned element's `type` to identify which
 *     component was chosen.
 *
 * Owning agent: testing. Owner of source: frontend (page.tsx, anon-id helpers).
 */

// ── Sentinel components ──────────────────────────────────────────────────────
function FakeV1() { return null; }
function FakeV2() { return null; }
FakeV1.displayName = 'FakeV1';
FakeV2.displayName = 'FakeV2';

vi.mock('@/app/welcome/page-v1', () => ({ default: FakeV1 }));
vi.mock('@/components/landing-v2/WelcomeV2', () => ({ default: FakeV2 }));

// ── isFeatureEnabled mock (per-test override) ────────────────────────────────
const mockIsFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/feature-flags')>();
  return {
    ...actual,
    isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  };
});

// ── cookies() mock ───────────────────────────────────────────────────────────
let mockCookieValue: string | undefined;
const mockCookieSet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'alf_anon_id' && mockCookieValue
        ? { name, value: mockCookieValue }
        : undefined,
    set: mockCookieSet,
  }),
}));

import { hashForRollout } from '@/lib/feature-flags';
// Import AFTER mocks are set up so the module captures our stubs.
const importPage = async () => {
  const mod = await import('@/app/welcome/page');
  return mod.default;
};

// ── Helpers ──────────────────────────────────────────────────────────────────
type RenderedType = React.JSXElementConstructor<unknown> | string;
function elementType(el: unknown): RenderedType | undefined {
  if (el && typeof el === 'object' && 'type' in (el as Record<string, unknown>)) {
    return (el as { type: RenderedType }).type;
  }
  return undefined;
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('welcome page routing — v1 vs v2 decision', () => {
  beforeEach(() => {
    mockIsFeatureEnabled.mockReset();
    mockCookieSet.mockReset();
    mockCookieValue = undefined;
    vi.resetModules();
  });

  describe('?v= query escape hatches', () => {
    it('?v=1 forces v1 even when flag is ON', async () => {
      mockIsFeatureEnabled.mockResolvedValue(true);
      const Page = await importPage();
      const result = await Page({ searchParams: { v: '1' } });
      expect(elementType(result)).toBe(FakeV1);
      // Flag should not even be evaluated
      expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
    });

    it('?v=2 forces v2 even when flag is OFF', async () => {
      mockIsFeatureEnabled.mockResolvedValue(false);
      const Page = await importPage();
      const result = await Page({ searchParams: { v: '2' } });
      expect(elementType(result)).toBe(FakeV2);
      expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
    });

    it('?v=2 still wins when flag throws (defensive)', async () => {
      mockIsFeatureEnabled.mockRejectedValue(new Error('DB down'));
      const Page = await importPage();
      const result = await Page({ searchParams: { v: '2' } });
      expect(elementType(result)).toBe(FakeV2);
    });
  });

  describe('flag-based routing (no ?v= override)', () => {
    it('flag OFF → renders v1', async () => {
      mockIsFeatureEnabled.mockResolvedValue(false);
      mockCookieValue = '11111111-1111-4111-8111-111111111111';
      const Page = await importPage();
      const result = await Page({ searchParams: {} });
      expect(elementType(result)).toBe(FakeV1);
    });

    it('flag ON @ 100% → renders v2', async () => {
      mockIsFeatureEnabled.mockResolvedValue(true);
      mockCookieValue = '11111111-1111-4111-8111-111111111111';
      const Page = await importPage();
      const result = await Page({ searchParams: {} });
      expect(elementType(result)).toBe(FakeV2);
    });

    it('flag ON @ 0% → renders v1 (isFeatureEnabled returns false)', async () => {
      // 0% rollout means isFeatureEnabled returns false even though the flag
      // row is is_enabled = true. The page just delegates to that boolean.
      mockIsFeatureEnabled.mockResolvedValue(false);
      mockCookieValue = '11111111-1111-4111-8111-111111111111';
      const Page = await importPage();
      const result = await Page({ searchParams: {} });
      expect(elementType(result)).toBe(FakeV1);
    });
  });

  describe('per-anon-id rollout determinism', () => {
    it('passes anon-id cookie value as userId to flag evaluator', async () => {
      const stableId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      mockCookieValue = stableId;
      mockIsFeatureEnabled.mockResolvedValue(true);
      const Page = await importPage();
      await Page({ searchParams: {} });
      expect(mockIsFeatureEnabled).toHaveBeenCalledWith(
        'ff_welcome_v2',
        expect.objectContaining({ userId: stableId }),
      );
    });

    it('hash falls in lower half (lower bucket) — picked by 50% rollout simulation', async () => {
      // Use a UUID whose hash mod 100 is < 50.
      // We rely on the real hashForRollout to find a deterministic id.
      const lowerId = findIdWithBucket((h) => h < 50);
      mockCookieValue = lowerId;
      // Simulate isFeatureEnabled honouring rollout: hash(lowerId) < 50 → true
      mockIsFeatureEnabled.mockImplementation(async (_name: string, ctx: { userId?: string }) => {
        const h = hashForRollout(ctx.userId || '', 'ff_welcome_v2');
        return h < 50;
      });
      const Page = await importPage();
      const result = await Page({ searchParams: {} });
      expect(elementType(result)).toBe(FakeV2);
    });

    it('hash falls in upper half → not picked by 50% rollout', async () => {
      const upperId = findIdWithBucket((h) => h >= 50);
      mockCookieValue = upperId;
      mockIsFeatureEnabled.mockImplementation(async (_name: string, ctx: { userId?: string }) => {
        const h = hashForRollout(ctx.userId || '', 'ff_welcome_v2');
        return h < 50;
      });
      const Page = await importPage();
      const result = await Page({ searchParams: {} });
      expect(elementType(result)).toBe(FakeV1);
    });
  });

  describe('cookie minting when missing', () => {
    it('mints a fresh anon-id when cookie is absent and still routes deterministically', async () => {
      mockCookieValue = undefined; // No cookie
      mockIsFeatureEnabled.mockResolvedValue(true);
      const Page = await importPage();
      const result = await Page({ searchParams: {} });

      // Documented existing fallback behavior:
      // 1. A fresh UUID is generated and passed as userId for THIS request.
      // 2. cookies().set() is called when the cookie store supports it
      //    (Server Action / Route Handler / Middleware contexts). In a Server
      //    Component context the call is a no-op wrapped in try/catch — the
      //    page still renders, but persistence may not occur until a mutable
      //    context handles it. We assert at least the call was attempted.
      expect(mockIsFeatureEnabled).toHaveBeenCalledTimes(1);
      const ctxArg = mockIsFeatureEnabled.mock.calls[0]![1] as { userId?: string };
      expect(ctxArg.userId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      // Persistence attempted via cookies().set() (no-op in pure SC, but called).
      expect(mockCookieSet).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'alf_anon_id',
          value: ctxArg.userId,
          path: '/',
          sameSite: 'lax',
          maxAge: expect.any(Number),
        }),
      );
      // The flag returns true → v2 rendered.
      expect(elementType(result)).toBe(FakeV2);
    });

    it('reuses existing cookie value (does not mint a new one)', async () => {
      mockCookieValue = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      mockIsFeatureEnabled.mockResolvedValue(false);
      const Page = await importPage();
      await Page({ searchParams: {} });
      expect(mockCookieSet).not.toHaveBeenCalled();
    });
  });

  describe('searchParams contract', () => {
    it('awaits a Promise<SearchParams> (Next 15+/16 contract)', async () => {
      mockCookieValue = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      mockIsFeatureEnabled.mockResolvedValue(false);
      const Page = await importPage();
      const result = await Page({
        searchParams: Promise.resolve({ v: '2' }),
      });
      expect(elementType(result)).toBe(FakeV2);
    });
  });
});

/** Find a UUID whose `hashForRollout(uuid, 'ff_welcome_v2')` matches `predicate`. */
function findIdWithBucket(predicate: (h: number) => boolean): string {
  // Deterministic search — start from a fixed seed and walk.
  for (let i = 0; i < 10_000; i++) {
    // Construct a synthetic UUID v4 from i; uniqueness/format only matter for hashing.
    const hex = i.toString(16).padStart(12, '0');
    const id = `00000000-0000-4000-8000-${hex}`;
    if (predicate(hashForRollout(id, 'ff_welcome_v2'))) return id;
  }
  throw new Error('Could not find a UUID matching predicate (hash search exhausted)');
}
