import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * F6: usePermissions hook tests
 *
 * Covered:
 *   - notifyPermissionsChanged() dispatches the right event.
 *   - clearPermissionsCache() clears the module-level cache.
 *   - The exported refresh() contract (present on the hook result).
 *   - Concurrent fetch de-duplication via the module's inflight promise
 *     (tested as a pure function so we do not need to mount React).
 *
 * We intentionally do NOT render the hook itself here — the heavy React/
 * Supabase/AuthContext mock surface that would require is out of scope and
 * would overlap with existing smoke tests.  Instead we:
 *
 *   1. Exercise the two exported free functions (notifyPermissionsChanged,
 *      clearPermissionsCache) directly.
 *   2. Source-level-assert that the hook wires the event listener, the
 *      visibility listener, the bypassCache flag, and the inflight
 *      coalescing behaviour.
 */

// ── Mocks ───────────────────────────────────────────────────

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ activeRole: 'student' }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

// ═══════════════════════════════════════════════════════════
// notifyPermissionsChanged
// ═══════════════════════════════════════════════════════════

describe('F6: notifyPermissionsChanged', () => {
  it('dispatches a "alfanumrik:permissions-changed" CustomEvent on window', async () => {
    const { notifyPermissionsChanged } = await import('@/lib/usePermissions');

    const listener = vi.fn();
    window.addEventListener('alfanumrik:permissions-changed', listener);

    notifyPermissionsChanged();

    expect(listener).toHaveBeenCalledOnce();
    const ev = listener.mock.calls[0][0] as Event;
    expect(ev.type).toBe('alfanumrik:permissions-changed');
    expect(ev).toBeInstanceOf(CustomEvent);

    window.removeEventListener('alfanumrik:permissions-changed', listener);
  });

  it('is safe to call when no listener is registered (no throw)', async () => {
    const { notifyPermissionsChanged } = await import('@/lib/usePermissions');
    expect(() => notifyPermissionsChanged()).not.toThrow();
  });

  it('fires multiple events when called repeatedly', async () => {
    const { notifyPermissionsChanged } = await import('@/lib/usePermissions');
    const listener = vi.fn();
    window.addEventListener('alfanumrik:permissions-changed', listener);

    notifyPermissionsChanged();
    notifyPermissionsChanged();
    notifyPermissionsChanged();

    expect(listener).toHaveBeenCalledTimes(3);
    window.removeEventListener('alfanumrik:permissions-changed', listener);
  });
});

// ═══════════════════════════════════════════════════════════
// clearPermissionsCache
// ═══════════════════════════════════════════════════════════

describe('F6: clearPermissionsCache', () => {
  it('is exported and callable without throwing', async () => {
    const mod = await import('@/lib/usePermissions');
    expect(typeof mod.clearPermissionsCache).toBe('function');
    expect(() => mod.clearPermissionsCache()).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════
// usePermissions API surface
// ═══════════════════════════════════════════════════════════

describe('F6: usePermissions exports', () => {
  it('exports usePermissions, notifyPermissionsChanged, clearPermissionsCache', async () => {
    const mod = await import('@/lib/usePermissions');
    expect(typeof mod.usePermissions).toBe('function');
    expect(typeof mod.notifyPermissionsChanged).toBe('function');
    expect(typeof mod.clearPermissionsCache).toBe('function');
  });
});

// ═══════════════════════════════════════════════════════════
// Source-level structural assertions for F6
// ═══════════════════════════════════════════════════════════

describe('F6: usePermissions.ts source structure', () => {
  async function readSource(): Promise<string> {
    const fs = await import('fs');
    const path = await import('path');
    return fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/usePermissions.ts'),
      'utf-8'
    );
  }

  it('exposes a refresh() method in the hook result', async () => {
    const file = await readSource();
    expect(file).toMatch(/refresh:\s*\(\)\s*=>\s*Promise<void>/);
    expect(file).toMatch(/refresh\s*,/); // returned from hook
  });

  it('listens for the alfanumrik:permissions-changed event on window', async () => {
    const file = await readSource();
    expect(file).toContain("'alfanumrik:permissions-changed'");
    expect(file).toMatch(/window\.addEventListener\(PERMISSIONS_CHANGED_EVENT/);
  });

  it('listens for tab visibility changes to silently refresh stale cache', async () => {
    const file = await readSource();
    expect(file).toContain('visibilitychange');
    expect(file).toMatch(/STALE_THRESHOLD_MS/);
  });

  it('uses an inflight promise to coalesce concurrent fetches', async () => {
    const file = await readSource();
    // The de-duplication relies on a module-level `inflightFetch` Promise ref.
    expect(file).toMatch(/inflightFetch/);
    // The read "if (inflightFetch) return inflightFetch" guard must exist.
    expect(file).toMatch(/if\s*\(inflightFetch\)\s*\{?\s*return inflightFetch/);
  });

  it('refresh() bypasses cache (passes bypassCache: true to load)', async () => {
    const file = await readSource();
    expect(file).toMatch(/load\(\{\s*bypassCache:\s*true\s*\}\)/);
  });

  it('visibility change uses silent refresh (no loading spinner)', async () => {
    const file = await readSource();
    expect(file).toMatch(/silent:\s*true/);
  });

  it('notifyPermissionsChanged uses CustomEvent with the canonical name', async () => {
    const file = await readSource();
    expect(file).toMatch(/new CustomEvent\(PERMISSIONS_CHANGED_EVENT\)/);
  });

  it('handles being called in non-window environments (SSR-safe)', async () => {
    const file = await readSource();
    expect(file).toMatch(/typeof window !== 'undefined'/);
  });

  it('caches results for 5 minutes (expires = now + 5 * 60 * 1000)', async () => {
    const file = await readSource();
    expect(file).toMatch(/5\s*\*\s*60\s*\*\s*1000/);
  });

  it('STALE_THRESHOLD_MS is 60 seconds', async () => {
    const file = await readSource();
    expect(file).toMatch(/STALE_THRESHOLD_MS\s*=\s*60\s*\*\s*1000/);
  });
});

// ═══════════════════════════════════════════════════════════
// Concurrent fetch coalescing logic (pure algorithm test)
// ═══════════════════════════════════════════════════════════

describe('F6: concurrent fetch coalescing algorithm', () => {
  /**
   * Mirrors the fetchPermissionsFromServer de-duplication pattern:
   *   let inflight: Promise<T> | null = null;
   *   function fetch(): Promise<T> {
   *     if (inflight) return inflight;
   *     inflight = (async () => { try { return await impl(); } finally { inflight = null; } })();
   *     return inflight;
   *   }
   */
  let inflight: Promise<{ count: number }> | null;
  let calls: number;

  beforeEach(() => {
    inflight = null;
    calls = 0;
  });

  afterEach(() => {
    inflight = null;
  });

  function coalescedFetch(impl: () => Promise<{ count: number }>): Promise<{ count: number }> {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        calls++;
        return await impl();
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  it('single call invokes impl exactly once', async () => {
    const impl = async () => ({ count: 1 });
    const result = await coalescedFetch(impl);
    expect(result.count).toBe(1);
    expect(calls).toBe(1);
  });

  it('3 concurrent calls coalesce to ONE impl invocation', async () => {
    let resolveImpl: (v: { count: number }) => void = () => undefined;
    const impl = () =>
      new Promise<{ count: number }>((resolve) => {
        resolveImpl = resolve;
      });

    // Kick off three "concurrent" calls.
    const p1 = coalescedFetch(impl);
    const p2 = coalescedFetch(impl);
    const p3 = coalescedFetch(impl);

    // All three should be the same promise reference.
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);

    resolveImpl({ count: 42 });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.count).toBe(42);
    expect(r2.count).toBe(42);
    expect(r3.count).toBe(42);

    // impl() is invoked exactly once despite three callers.
    expect(calls).toBe(1);
  });

  it('after resolution, inflight clears and the next call triggers a new impl', async () => {
    const impl1 = async () => ({ count: 1 });
    await coalescedFetch(impl1);
    expect(calls).toBe(1);

    // New call after the first settles must trigger a second impl invocation.
    const impl2 = async () => ({ count: 2 });
    const r2 = await coalescedFetch(impl2);
    expect(r2.count).toBe(2);
    expect(calls).toBe(2);
  });
});