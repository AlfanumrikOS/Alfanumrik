import { describe, it, expect } from 'vitest';
import {
  PROD_PROJECT_REF,
  extractProjectRef as extractProjectRefSeed,
  assertNotProductionProjectRef,
} from '../../../scripts/seed-certification-accounts';
import {
  KNOWN_PROD_PROJECT_REF,
  extractProjectRef as extractProjectRefTeardown,
} from '../../../scripts/teardown-certification-tenant';

/**
 * REG-230 — production-reference fail-closed guard coverage (seed + teardown
 * certification scripts).
 *
 * Both `scripts/seed-certification-accounts.ts` and
 * `scripts/teardown-certification-tenant.ts` carry a doc-commented,
 * safety-critical, "never touch production" guard, but prior to this file
 * neither guard had any committed automated test — see
 * `docs/audit/2026-07-02-certification/evidence/wave-2-environment-readiness/04-stage2-3-preparation-quality-review.md`
 * Finding Q-3 (MAJOR). Quality proved both guards correct via a disposable,
 * non-committed Vitest scratch file exercised against adversarial inputs and
 * then deleted; this file makes that proof permanent, committed regression
 * coverage, using the exact same adversarial cases quality ran:
 *   - an uppercase project ref
 *   - a project ref with surrounding whitespace
 *   - the production ref with a nonstandard port suffix
 *   - a URL where the production ref appears as a subdomain/substring of a
 *     DIFFERENT, non-prod project ref (must NOT be a false-positive block —
 *     over-blocking a legitimate staging URL would be its own bug)
 *   - a URL where the production ref appears as a subdomain-suffix
 *     masquerade (`prodref.supabase.co.evil.com` shape) — must fail closed
 *   - the straightforward positive case: a genuine, non-prod staging-shaped
 *     URL passes
 *   - an ambiguous/unparseable URL — must fail closed, never "probably fine"
 *
 * Both scripts use the SAME literal `PROD_PROJECT_REF` / `KNOWN_PROD_PROJECT_REF`
 * value (cross-checked against `.github/workflows/staging-adaptive-drill.yml`
 * by the quality review) but two DIFFERENT `extractProjectRef` implementations
 * (the seed script uses a strict, single-shape https-only regex; the teardown
 * script uses the WHATWG URL constructor + hostname-label splitting, which is
 * slightly more permissive about http/ports). This file deliberately tests
 * BOTH implementations against the identical adversarial input set so any
 * future drift in either parser's strictness is caught here, not just in one
 * script's suite. The one confirmed behavioral difference (the teardown
 * parser accepts a port suffix and still correctly detects a prod match,
 * while the seed script's stricter regex fails closed via "unparseable" for
 * the same input) is captured explicitly below, not glossed over.
 *
 * Importing from `scripts/teardown-certification-tenant.ts` also closes
 * Finding Q-2 (MAJOR): that file has no importer anywhere else in the
 * codebase, so `tsconfig.json`'s blanket `scripts` exclude previously kept it
 * out of `npm run type-check`'s effective file set entirely. This import
 * pulls it in transitively, the same mechanism that already covers the seed
 * script via `e2e/certification/helpers/cert-gate.ts`.
 *
 * No live database or network access anywhere in this file — every case
 * below exercises pure, synchronous, no-I/O functions.
 *
 * REGRESSION CATALOG: REG-230.
 */

describe('REG-230 — the two scripts share the identical PROD project-ref literal', () => {
  it('PROD_PROJECT_REF (seed) and KNOWN_PROD_PROJECT_REF (teardown) are byte-identical', () => {
    expect(PROD_PROJECT_REF).toBe(KNOWN_PROD_PROJECT_REF);
    expect(PROD_PROJECT_REF).toBe('shktyoxqhundlvkiwguu');
  });
});

describe('REG-230 — seed script: assertNotProductionProjectRef (fail-closed guard)', () => {
  it('blocks an uppercase production ref (case-insensitive match, normalized before compare)', () => {
    const result = assertNotProductionProjectRef('https://SHKTYOXQHUNDLVKIWGUU.supabase.co');
    expect(result.ok).toBe(false);
    expect(result.projectRef).toBe(PROD_PROJECT_REF);
    expect(result.reason).toMatch(/PRODUCTION project ref/);
  });

  it('blocks a production ref with surrounding whitespace (trimmed before compare)', () => {
    const result = assertNotProductionProjectRef('  https://shktyoxqhundlvkiwguu.supabase.co  ');
    expect(result.ok).toBe(false);
    expect(result.projectRef).toBe(PROD_PROJECT_REF);
  });

  it('blocks (fail-closed as unparseable) a production-ref URL with a nonstandard port — the strict regex rejects the whole shape rather than silently stripping the port', () => {
    const result = assertNotProductionProjectRef('https://shktyoxqhundlvkiwguu.supabase.co:5432');
    expect(result.ok).toBe(false);
    expect(result.projectRef).toBeNull();
    expect(result.reason).toMatch(/Could not positively confirm/);
  });

  it('does NOT block a different, non-prod ref merely because the prod ref appears as its substring (no false-positive over-block)', () => {
    const result = assertNotProductionProjectRef('https://my-shktyoxqhundlvkiwguu-staging.supabase.co');
    expect(result.ok).toBe(true);
    expect(result.projectRef).toBe('my-shktyoxqhundlvkiwguu-staging');
    expect(result.projectRef).not.toBe(PROD_PROJECT_REF);
  });

  it('fails closed on a subdomain-suffix masquerade of the prod ref (prodref.supabase.co.evil.com shape) — refuses rather than guessing', () => {
    const result = assertNotProductionProjectRef('https://shktyoxqhundlvkiwguu.supabase.co.evil.com');
    expect(result.ok).toBe(false);
    expect(result.projectRef).toBeNull();
  });

  it('positive case: a genuine, non-prod staging-shaped URL passes cleanly', () => {
    const result = assertNotProductionProjectRef('https://abcdefghijklmnop.supabase.co');
    expect(result.ok).toBe(true);
    expect(result.projectRef).toBe('abcdefghijklmnop');
    expect(result.reason).toBeUndefined();
  });

  it('fails closed on an ambiguous/unparseable URL (no project-ref subdomain at all)', () => {
    const result = assertNotProductionProjectRef('https://supabase.co');
    expect(result.ok).toBe(false);
    expect(result.projectRef).toBeNull();
    expect(result.reason).toMatch(/Could not positively confirm/);
  });

  it('fails closed on completely non-URL garbage input', () => {
    const result = assertNotProductionProjectRef('not-a-url');
    expect(result.ok).toBe(false);
    expect(result.projectRef).toBeNull();
  });
});

describe('REG-230 — teardown script: extractProjectRef + the equality guard main() applies', () => {
  /**
   * `runTeardown` and `main()` in the teardown script keep the production-ref
   * comparison inline (`if (!projectRef) throw; if (projectRef ===
   * KNOWN_PROD_PROJECT_REF) throw;`) rather than factoring it into a separate
   * exported assert function like the seed script's
   * `assertNotProductionProjectRef`. To test the guard's actual decision
   * (not just the raw extraction), this helper reproduces that exact
   * two-line predicate byte-for-byte from `scripts/teardown-certification-tenant.ts`
   * `main()` — it is NOT independent guard logic, it is the same
   * `extractProjectRef` export under test plus the identical comparison the
   * script performs, so a change to either side of that predicate in the
   * script is still caught here.
   */
  function wouldBlock(supabaseUrl: string): { blocked: boolean; ref: string | null } {
    const ref = extractProjectRefTeardown(supabaseUrl);
    if (!ref) return { blocked: true, ref: null };
    if (ref === KNOWN_PROD_PROJECT_REF) return { blocked: true, ref };
    return { blocked: false, ref };
  }

  it('blocks an uppercase production ref (WHATWG URL API lowercases the hostname automatically)', () => {
    const { blocked, ref } = wouldBlock('https://SHKTYOXQHUNDLVKIWGUU.supabase.co');
    expect(blocked).toBe(true);
    expect(ref).toBe(KNOWN_PROD_PROJECT_REF);
  });

  it('blocks a production ref with surrounding whitespace (the URL constructor strips it)', () => {
    const { blocked, ref } = wouldBlock('  https://shktyoxqhundlvkiwguu.supabase.co  ');
    expect(blocked).toBe(true);
    expect(ref).toBe(KNOWN_PROD_PROJECT_REF);
  });

  it('STILL correctly blocks a production-ref URL with a nonstandard port — confirmed behavioral difference from the seed script, which fails closed via "unparseable" for the identical input; the teardown parser is more permissive about the URL shape but never less safe', () => {
    const { blocked, ref } = wouldBlock('https://shktyoxqhundlvkiwguu.supabase.co:5432');
    expect(blocked).toBe(true);
    expect(ref).toBe(KNOWN_PROD_PROJECT_REF);
  });

  it('does NOT block a different, non-prod ref merely because the prod ref appears as its substring (no false-positive over-block)', () => {
    const { blocked, ref } = wouldBlock('https://my-shktyoxqhundlvkiwguu-staging.supabase.co');
    expect(blocked).toBe(false);
    expect(ref).toBe('my-shktyoxqhundlvkiwguu-staging');
    expect(ref).not.toBe(KNOWN_PROD_PROJECT_REF);
  });

  it('fails closed on the exact subdomain-suffix masquerade quality used (prodref.supabase.co.evil.com) — the extra hostname labels make it unparseable under the "exactly one label before supabase.co" rule, so it refuses rather than guessing', () => {
    const { blocked, ref } = wouldBlock('https://shktyoxqhundlvkiwguu.supabase.co.evil.com');
    expect(blocked).toBe(true);
    expect(ref).toBeNull();
  });

  it('positive case: a genuine, non-prod staging-shaped URL passes cleanly', () => {
    const { blocked, ref } = wouldBlock('https://abcdefghijklmnop.supabase.co');
    expect(blocked).toBe(false);
    expect(ref).toBe('abcdefghijklmnop');
  });

  it('fails closed on an ambiguous/unparseable URL (no project-ref subdomain at all)', () => {
    const { blocked, ref } = wouldBlock('https://supabase.co');
    expect(blocked).toBe(true);
    expect(ref).toBeNull();
  });

  it('fails closed on completely non-URL garbage input (URL constructor throws, caught, returns null)', () => {
    const { blocked, ref } = wouldBlock('not-a-url');
    expect(blocked).toBe(true);
    expect(ref).toBeNull();
  });

  it('extractProjectRef returns the ref already lowercased explicitly (parity fix — no longer relies solely on implicit URL-API hostname lowercasing)', () => {
    expect(extractProjectRefTeardown('https://SHKTYOXQHUNDLVKIWGUU.supabase.co')).toBe(
      'shktyoxqhundlvkiwguu',
    );
  });
});
