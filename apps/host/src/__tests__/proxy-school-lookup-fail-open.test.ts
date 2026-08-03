import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach } from 'vitest';

/**
 * P0-5 (2026-08-03) — tenant school-lookup failure semantics in proxy.ts.
 *
 * THE BUG THIS PINS
 * =================
 * getSchoolBySlug / getSchoolByCustomDomain used to treat a PostgREST non-2xx
 * (or thrown fetch) as "school absent": they wrote the 60s NEGATIVE cache and
 * returned null, so a single transient 5xx blacked out an entire white-label
 * tenant behind a hard 404 for a full minute. Fix: lookups return
 * { ok, data }; transient failures (non-2xx / thrown / 3s timeout) NEVER
 * write the 60s negative cache — they re-serve last-known-good config (5s
 * re-cache) or fail open to the generic experience (5s error-cache), and the
 * 404 branch fires ONLY on a definitive lookup (ok: true, data: null).
 *
 * The lookup helpers are module-private and proxy() needs the full Next.js
 * runtime, so per the existing harness conventions in middleware.test.ts this
 * pin is (a) a byte-mirrored local reproduction of the cache-decision logic
 * (F1 `simulateAuthLayer` pattern) plus (b) static source-structure asserts
 * on src/proxy.ts (Phase A.3 pattern).
 */

// ─── (a) Behavioral reproduction — mirrors src/proxy.ts byte-for-byte ────────

interface FakeSchoolConfig {
  id: string;
  name: string;
}
type CacheEntry = { data: FakeSchoolConfig | null; expires: number; error?: boolean };
interface SchoolLookupResult {
  ok: boolean;
  data: FakeSchoolConfig | null;
}

const schoolCache = new Map<string, CacheEntry>();

/** Mirror of proxy.ts schoolLookupFailure() — keep in lock-step. */
function schoolLookupFailure(
  cacheKey: string,
  stale: CacheEntry | undefined,
): SchoolLookupResult {
  const staleGood = stale && stale.data && !stale.error ? stale.data : null;
  if (staleGood) {
    schoolCache.set(cacheKey, { data: staleGood, expires: Date.now() + 5_000 });
  } else {
    schoolCache.set(cacheKey, { data: null, expires: Date.now() + 5_000, error: true });
  }
  return { ok: false, data: staleGood };
}

/** Mirror of the cache-read line at the top of both lookup functions. */
function readCache(key: string): SchoolLookupResult | null {
  const cached = schoolCache.get(key);
  if (cached && cached.expires > Date.now()) return { ok: !cached.error, data: cached.data };
  return null;
}

/** Mirror of the 404 gate: `if (isExplicitTenantRequest && !schoolConfig && !schoolLookupFailed)`. */
function shouldHard404(
  isExplicitTenantRequest: boolean,
  lookup: SchoolLookupResult,
): boolean {
  const schoolConfig = lookup.data;
  const schoolLookupFailed = !lookup.ok;
  return isExplicitTenantRequest && !schoolConfig && !schoolLookupFailed;
}

const DPS: FakeSchoolConfig = { id: 'sch_1', name: 'DPS Noida' };

describe('school-lookup failure semantics (behavioral mirror)', () => {
  beforeEach(() => schoolCache.clear());

  it('transient failure with NO last-known-good → 5s error-cache, never the 60s negative cache', () => {
    const result = schoolLookupFailure('dps-noida', undefined);
    expect(result).toEqual({ ok: false, data: null });
    const entry = schoolCache.get('dps-noida')!;
    expect(entry.error).toBe(true);
    // ≤5s TTL — a transient blip must NOT poison the tenant for 60s.
    expect(entry.expires - Date.now()).toBeLessThanOrEqual(5_000);
    expect(entry.expires - Date.now()).toBeGreaterThan(4_000);
  });

  it('transient failure WITH last-known-good → serves stale config (ok:false), re-cached 5s', () => {
    const stale: CacheEntry = { data: DPS, expires: Date.now() - 1 }; // expired positive entry
    const result = schoolLookupFailure('dps-noida', stale);
    expect(result).toEqual({ ok: false, data: DPS });
    const entry = schoolCache.get('dps-noida')!;
    expect(entry.data).toEqual(DPS);
    expect(entry.error).toBeUndefined();
    expect(entry.expires - Date.now()).toBeLessThanOrEqual(5_000);
  });

  it('a prior error entry is never promoted to last-known-good on repeat failure', () => {
    schoolLookupFailure('dps-noida', undefined); // first failure → error entry
    const second = schoolLookupFailure('dps-noida', schoolCache.get('dps-noida'));
    expect(second).toEqual({ ok: false, data: null });
    expect(schoolCache.get('dps-noida')!.error).toBe(true);
  });

  it('a cached error entry reads back as ok:false → the 404 branch cannot fire from it', () => {
    schoolLookupFailure('dps-noida', undefined);
    const read = readCache('dps-noida')!;
    expect(read.ok).toBe(false);
    expect(shouldHard404(true, read)).toBe(false);
  });

  it('failed lookup NEVER hard-404s an explicit tenant request (fail open)', () => {
    expect(shouldHard404(true, { ok: false, data: null })).toBe(false);
    // Last-known-good path also bypasses the 404 (schoolConfig present).
    expect(shouldHard404(true, { ok: false, data: DPS })).toBe(false);
  });

  it('definitive empty-200 (ok:true, data:null) still hard-404s an explicit tenant request', () => {
    expect(shouldHard404(true, { ok: true, data: null })).toBe(true);
    expect(shouldHard404(false, { ok: true, data: null })).toBe(false); // B2C host untouched
  });
});

// ─── (b) Static source-structure pins on src/proxy.ts ────────────────────────

describe('school-lookup failure semantics (proxy.ts source pins)', () => {
  const HOST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const src = readFileSync(path.resolve(HOST_ROOT, 'src/proxy.ts'), 'utf8');

  it('both lookups bound the PostgREST fetch with a 3s AbortSignal timeout', () => {
    const matches = src.match(/signal:\s*AbortSignal\.timeout\(3000\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('non-2xx AND thrown/timeout branches all route through schoolLookupFailure (4 call sites)', () => {
    const matches = src.match(/return schoolLookupFailure\(/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(4);
  });

  it('the !res.ok branches no longer write the 60s negative cache', () => {
    // Each `if (!res.ok) { ... }` block must delegate to schoolLookupFailure
    // and must not contain a 60_000 cache write.
    expect(src).toMatch(/if\s*\(!res\.ok\)\s*\{[^}]*schoolLookupFailure/);
    expect(src).not.toMatch(/if\s*\(!res\.ok\)\s*\{[^}]*60_000/);
  });

  it('schoolLookupFailure caches for 5s only (both arms), never 60s', () => {
    const fnStart = src.indexOf('function schoolLookupFailure(');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = src.slice(fnStart, src.indexOf('\n}', fnStart));
    const fiveSecondWrites = fnBody.match(/expires:\s*Date\.now\(\)\s*\+\s*5_000/g);
    expect(fiveSecondWrites).not.toBeNull();
    expect(fiveSecondWrites!.length).toBe(2);
    expect(fnBody).not.toContain('60_000');
  });

  it('the tenant 404 gate requires the lookup to have been definitive (!schoolLookupFailed)', () => {
    expect(src).toMatch(
      /if\s*\(isExplicitTenantRequest\s*&&\s*!schoolConfig\s*&&\s*!schoolLookupFailed\)/,
    );
  });

  it('cache reads surface the error flag as ok:false ({ ok: !cached.error, data: cached.data })', () => {
    const matches = src.match(/return\s*\{\s*ok:\s*!cached\.error,\s*data:\s*cached\.data\s*\}/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2); // slug + custom-domain lookups
  });
});

/**
 * PROPOSED REGRESSION CATALOG ROW (orchestrator assigns the REG id):
 *   REG-341: proxy_school_lookup_fail_open
 *     asserts  | transient tenant-lookup failures (non-2xx / thrown / 3s timeout)
 *              | never write the 60s negative cache and never hard-404 a tenant —
 *              | last-known-good is re-served or the request fails open (5s error
 *              | cache); only a definitive empty-200 may 404.
 *     location | apps/host/src/__tests__/proxy-school-lookup-fail-open.test.ts
 *     invariant| availability of the white-label tenant surface (Layer 0)
 */
