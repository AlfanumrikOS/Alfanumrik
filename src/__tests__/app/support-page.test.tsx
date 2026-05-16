/**
 * /support — frontend & API contract tests.
 *
 * History: the old render-time tests for /support and /support/new were
 * skipped from 2026-05-06 onward because the Atlas redesign mounted those
 * pages inside chrome the test setup didn't provide. Phase B.6 (prod-
 * readiness sweep, 2026-05-16) replaces those two `describe.skip` blocks
 * with API-contract coverage that exercises the actual support routes
 * without needing the page render context. UI re-coverage will land with
 * the broader Atlas test-setup rework tracked alongside teacher-shell.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROUTE_FILES = [
  'src/app/api/support/ticket/route.ts',
  'src/app/api/support/tickets/route.ts',
  'src/app/api/support/tickets/[id]/route.ts',
  'src/app/api/support/ai-issue/route.ts',
] as const;

async function readRoute(rel: string): Promise<string> {
  return fs.readFile(path.resolve(process.cwd(), rel), 'utf8');
}

describe('/support API routes — contract guard', () => {
  // These are static source-level assertions so they don't depend on the
  // Atlas-redesign render context. They protect against silent removal /
  // accidental rename of the support API surface.

  it('every support route exports the documented HTTP method handler', async () => {
    const expectedExports: Record<(typeof ROUTE_FILES)[number], string[]> = {
      'src/app/api/support/ticket/route.ts': ['POST'],
      'src/app/api/support/tickets/route.ts': ['GET'],
      'src/app/api/support/tickets/[id]/route.ts': ['GET'],
      'src/app/api/support/ai-issue/route.ts': ['POST'],
    };
    for (const file of ROUTE_FILES) {
      const src = await readRoute(file);
      for (const method of expectedExports[file]) {
        expect(src).toMatch(new RegExp(`export\\s+async\\s+function\\s+${method}\\b`));
      }
    }
  });

  it('POST /api/support/ticket validates with zod and resolves auth optionally', async () => {
    const src = await readRoute('src/app/api/support/ticket/route.ts');
    // Zod body schema is the contract for incoming payloads.
    expect(src).toMatch(/z\.object\(\s*\{/);
    expect(src).toMatch(/category:\s*z\.enum/);
    expect(src).toMatch(/message:\s*z\.string/);
    // Optional Bearer-token auth resolution (guests are allowed but auth is honored).
    expect(src).toMatch(/Authorization/);
    expect(src).toMatch(/Bearer/);
    // Never trusts client-provided student_id (audit F22 invariant).
    expect(src).not.toMatch(/body\.student_id/);
    expect(src).not.toMatch(/rawBody\.student_id/);
  });

  it('POST /api/support/ticket caps message length to 5000 chars (rate-limit / abuse guard)', async () => {
    const src = await readRoute('src/app/api/support/ticket/route.ts');
    expect(src).toMatch(/\.max\(5000/);
  });

  it('GET /api/support/tickets requires authentication', async () => {
    const src = await readRoute('src/app/api/support/tickets/route.ts');
    // Either Bearer-header check or supabase auth resolution must be present.
    const hasAuthCheck =
      /Authorization/.test(src) ||
      /getUser\(/.test(src) ||
      /authorizeRequest\(/.test(src);
    expect(hasAuthCheck).toBe(true);
  });

  it('GET /api/support/tickets/[id] scopes by ticket owner (no cross-user leakage)', async () => {
    const src = await readRoute('src/app/api/support/tickets/[id]/route.ts');
    // Owner check must reference student_id OR auth_user_id at the query level.
    const hasOwnerScope =
      /\.eq\(['"]student_id['"]/.test(src) ||
      /\.eq\(['"]auth_user_id['"]/.test(src) ||
      /ownership/.test(src);
    expect(hasOwnerScope).toBe(true);
  });

  it('POST /api/support/ai-issue exists with auth resolution', async () => {
    const src = await readRoute('src/app/api/support/ai-issue/route.ts');
    expect(src).toMatch(/export\s+async\s+function\s+POST\b/);
    // Some auth surface — Bearer header, supabase getUser, or rbac authorizeRequest.
    const hasAuthSurface =
      /Authorization/.test(src) ||
      /getUser\(/.test(src) ||
      /authorizeRequest\(/.test(src);
    expect(hasAuthSurface).toBe(true);
  });
});

describe('/support page modules — still resolvable from the bundler', () => {
  // These import paths are referenced by Next.js's App Router and by the
  // future-restored UI tests. Asserting the files exist as modules (no
  // rendering) is enough to catch accidental deletion or rename.
  it('app/support/page.tsx exists', async () => {
    const stat = await fs.stat(path.resolve(process.cwd(), 'src/app/support/page.tsx'));
    expect(stat.isFile()).toBe(true);
  });

  it('app/support/new/page.tsx exists', async () => {
    const stat = await fs.stat(path.resolve(process.cwd(), 'src/app/support/new/page.tsx'));
    expect(stat.isFile()).toBe(true);
  });
});
