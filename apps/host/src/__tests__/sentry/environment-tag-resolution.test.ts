import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * REG-227 — Sentry `environment:` tag resolution (Environment Readiness
 * remediation wave, 2026-07-02).
 *
 * FILE LOCATIONS (updated 2026-08-03, P0-1 Sentry-initialization fix;
 * re-updated same day for the P10 deferred-load repair)
 * =====================================================================
 * The three Sentry init files historically sat at the REPO root
 * (`sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`)
 * — outside the Next.js project root — and were therefore never loaded. They
 * now live in `apps/host/` under the @sentry/nextjs v10 convention: the client
 * config content moved first to `apps/host/instrumentation-client.ts` (P0-1),
 * then to `apps/host/sentry-client-init.ts` (P10 repair, 2026-08-03:
 * `instrumentation-client.ts` became a ~1 kB deferred loader that `import()`s
 * the init module after window load, keeping the browser SDK out of the
 * first-paint shared bundle — CAP_SHARED_KB). Server/edge configs kept their
 * names in `apps/host/` and are imported from `apps/host/instrumentation.ts`
 * by NEXT_RUNTIME. The `environment:` tag expressions this test pins are
 * UNCHANGED — only the file paths moved.
 *
 * THE BUG THIS PINS
 * ==================
 * All three Sentry init files used to key the `environment` tag off `process.env.NODE_ENV`
 * ONLY. Next.js's `next build` always sets `NODE_ENV=production` for a production-mode
 * build regardless of which Vercel environment (Production vs Preview) the build is
 * destined for — `VERCEL_ENV` (`production`/`preview`/`development`) is the only value
 * Vercel itself varies per deploy target. Staging deploys as a genuine Vercel Preview
 * environment (`deploy-staging.yml`: `vercel pull --yes --environment=preview`), so
 * every Sentry event generated on staging — including certification-testing errors —
 * was tagged `environment: production`, byte-identical to a real production incident.
 * 35+ other environment-sensitive call sites in the codebase (feature flags, PostHog,
 * health check, entitlements resolver, etc.) already correctly read
 * `VERCEL_ENV`/`NEXT_PUBLIC_VERCEL_ENV` first — the three Sentry configs were the sole
 * outlier. See
 * docs/audit/2026-07-02-certification/evidence/stage-1-static/code-trace-notes/environment-readiness-ops.md
 * §2 for the full trace, and
 * docs/runbooks/2026-07-02-environment-readiness-remediation.md for the fix record.
 *
 * THE FIX (already applied, ops pass, this test only pins it)
 * =============================================================
 *   sentry-client-init.ts:   process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || 'development'
 *   sentry.server.config.ts: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'
 *   sentry.edge.config.ts:   process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'
 *
 * The client config uses the NEXT_PUBLIC_-prefixed mirror because it executes in the
 * browser bundle and bare VERCEL_ENV is not exposed to client code. Server/edge read
 * the non-prefixed var directly since neither executes in a browser context.
 *
 * WHY THIS TEST DOES NOT IMPORT THE CONFIG FILES DIRECTLY
 * ==========================================================
 * The Sentry init files call `Sentry.init(...)` as a top-level side effect at module
 * import time. Importing them under Vitest would trigger the real Sentry SDK. The
 * existing convention for this exact problem
 * (`src/lib/sentry-client-redact.ts` extracted from the client Sentry config,
 * tested via `src/__tests__/sentry/client-redact.test.ts`) is to pull testable logic
 * out into a plain module — but the `environment:` line is a single inline expression
 * with no natural extraction point, and these three files are outside the testing
 * agent's ownership domain (Sentry configs are ops/architect-owned). So this test
 * follows the codebase's OTHER established convention for pinning inline source
 * expressions without importing/executing the file — the static-source-parse pattern
 * used by `reg-226-quiz-rpc-ownership-check.test.ts`,
 * `atomic-quiz-conflict-42p10-structure.test.ts`, and
 * `score-formula-three-way-parity.test.ts` — PLUS a locally-reproduced pure function
 * (defined only inside this test file, never imported into application code) that
 * implements the byte-identical precedence expression, so the *semantic* behavior
 * (which value wins under a Preview-shaped env) is exercised with real
 * `vi.stubEnv`/`vi.unstubAllEnvs` env mocking — mirroring
 * `src/__tests__/feature-flags.test.ts`'s and `src/__tests__/lib/anon-id.test.ts`'s
 * existing `vi.stubEnv` usage for VERCEL_ENV-adjacent logic.
 *
 * REGRESSION CATALOG: REG-227.
 */

// apps/host/ — the Next.js project root, where the Sentry init files live as
// of the 2026-08-03 P0-1 fix. Anchored to this test file's own location
// (apps/host/src/__tests__/sentry/ → three levels up) so resolution works
// regardless of the vitest cwd; cwd-based candidates kept as fallback.
const HOST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function resolve(rel: string): string | null {
  for (const c of [
    path.resolve(HOST_ROOT, rel),
    path.resolve(process.cwd(), rel),
    path.resolve(process.cwd(), 'apps', 'host', rel),
  ]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function read(rel: string): string {
  const p = resolve(rel);
  if (!p) throw new Error(`Fixture file not found: ${rel} (checked apps/host root and cwd)`);
  return fs.readFileSync(p, 'utf8');
}

const CLIENT_CONFIG = 'sentry-client-init.ts';
const SERVER_CONFIG = 'sentry.server.config.ts';
const EDGE_CONFIG = 'sentry.edge.config.ts';

// Exact expected expressions, byte-for-byte. A future edit that reorders the
// precedence, drops a fallback, or reverts to NODE_ENV-only must fail this test.
const CLIENT_EXPR = "environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || 'development',";
const SERVER_EDGE_EXPR = "environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',";

// The regressed (pre-fix) shape — must NEVER reappear as the value of the
// `environment:` key in any of the three files.
const REGRESSED_LINE_RE = /environment:\s*process\.env\.NODE_ENV\s*\|\|\s*'development',/;

describe('REG-227 — Sentry environment-tag resolution (static source pin)', () => {
  it('sentry-client-init.ts (deferred client init) prioritizes NEXT_PUBLIC_VERCEL_ENV over NODE_ENV', () => {
    const src = read(CLIENT_CONFIG);
    expect(src).toContain(CLIENT_EXPR);
  });

  it('sentry.server.config.ts prioritizes VERCEL_ENV over NODE_ENV', () => {
    const src = read(SERVER_CONFIG);
    expect(src).toContain(SERVER_EDGE_EXPR);
  });

  it('sentry.edge.config.ts prioritizes VERCEL_ENV over NODE_ENV', () => {
    const src = read(EDGE_CONFIG);
    expect(src).toContain(SERVER_EDGE_EXPR);
  });

  it('none of the three configs regress to the NODE_ENV-only shape', () => {
    for (const file of [CLIENT_CONFIG, SERVER_CONFIG, EDGE_CONFIG]) {
      const src = read(file);
      expect(REGRESSED_LINE_RE.test(src), `${file} regressed to NODE_ENV-only environment tagging`).toBe(false);
    }
  });

  it('the beforeSend production-only drop guard is unchanged by this fix (server + edge)', () => {
    // Explicitly out of scope for this fix per the remediation record — pin that
    // it is untouched so a future "helpful" refactor doesn't silently couple the
    // send/drop decision to the new environment tag.
    for (const file of [SERVER_CONFIG, EDGE_CONFIG]) {
      const src = read(file);
      expect(src).toContain("if (process.env.NODE_ENV !== 'production') return null;");
    }
    const clientSrc = read(CLIENT_CONFIG);
    expect(clientSrc).toContain("if (process.env.NODE_ENV !== 'production') return null;");
  });
});

describe('REG-227 — Sentry environment-tag resolution (semantic behavior)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * Byte-identical reproduction of the server/edge expression. Defined ONLY in
   * this test file — never imported into application code — so this test can
   * exercise the precedence semantics without triggering `Sentry.init()`.
   */
  function resolveServerEnvironment(): string {
    return process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
  }

  /** Byte-identical reproduction of the client expression (NEXT_PUBLIC_ mirror). */
  function resolveClientEnvironment(): string {
    return process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || 'development';
  }

  it('a Preview-deployment-shaped env (VERCEL_ENV=preview, NODE_ENV=production) resolves to "preview", not "production" (server/edge)', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('NODE_ENV', 'production');
    expect(resolveServerEnvironment()).toBe('preview');
    expect(resolveServerEnvironment()).not.toBe('production');
  });

  it('a Preview-deployment-shaped env (NEXT_PUBLIC_VERCEL_ENV=preview, NODE_ENV=production) resolves to "preview", not "production" (client)', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview');
    vi.stubEnv('NODE_ENV', 'production');
    expect(resolveClientEnvironment()).toBe('preview');
    expect(resolveClientEnvironment()).not.toBe('production');
  });

  it('a real production deployment (VERCEL_ENV=production) still resolves to "production"', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('NODE_ENV', 'production');
    expect(resolveServerEnvironment()).toBe('production');
  });

  it('falls back to NODE_ENV when VERCEL_ENV is unset (pure local dev, no Vercel)', () => {
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', 'development');
    // vi.stubEnv('VERCEL_ENV', '') simulates "unset" for the `||` fallback chain
    // (empty string is falsy, same as undefined for this purpose).
    expect(resolveServerEnvironment()).toBe('development');
  });

  it("falls back to the 'development' literal when both VERCEL_ENV and NODE_ENV are unset", () => {
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', '');
    expect(resolveServerEnvironment()).toBe('development');
  });

  it('client resolution never leaks the non-prefixed VERCEL_ENV (browser cannot read it)', () => {
    // Only NEXT_PUBLIC_VERCEL_ENV is wired into next.config.js's `env` block for
    // client-bundle exposure (see next.config.js: NEXT_PUBLIC_VERCEL_ENV:
    // process.env.VERCEL_ENV ?? ''). Setting the bare VERCEL_ENV alone (without
    // the NEXT_PUBLIC_ mirror) must NOT influence the client resolver.
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(resolveClientEnvironment()).toBe('development');
  });
});
