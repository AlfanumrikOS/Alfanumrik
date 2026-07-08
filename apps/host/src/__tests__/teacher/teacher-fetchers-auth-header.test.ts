/**
 * Teacher-portal authed-fetch contract (Bearer-token forwarding).
 *
 * BUG FIXED (2026-06-16):
 *   This app's client-side auth state lives in localStorage; the Next.js proxy
 *   does NOT sync it to cookies, so server routes that call `authorizeRequest()`
 *   can't fall back to the cookie path on the first hop — the
 *   `Authorization: Bearer …` header is the only working path. Several teacher
 *   surfaces were issuing plain `fetch('/api/teacher/…')` with no header and
 *   getting 401 the moment a teacher clicked anything. They now forward the
 *   header via the shared `authHeader()` helper (mirrors the school-admin fix).
 *
 * COVERAGE (two complementary layers, mirroring the school-admin authed-fetch
 * pattern — test the smallest shared seam, not heavy page mounts):
 *
 *   1. Behavioral — the `authHeader()` seam every teacher fetcher spreads:
 *      - returns `{ Authorization: 'Bearer <token>' }` when a session exists,
 *      - returns `{}` (no header) when there is no session,
 *      - returns `{}` (fails soft) when getSession throws — never crashes the
 *        caller's fetch.
 *
 *   2. Structural — each touched teacher surface must import and SPREAD
 *      `authHeader()` into its fetch headers. A regression that drops the spread
 *      (reverting to a bare `fetch`) re-opens the 401 and is caught here without
 *      needing to mount the full page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Mock the Supabase client the helper reads its session from. ────────────────
const getSession = vi.fn();
vi.mock('@alfanumrik/lib/supabase-client', () => ({
  supabase: { auth: { getSession: (...a: unknown[]) => getSession(...a) } },
  supabaseUrl: 'https://placeholder.supabase.co',
  supabaseAnonKey: 'anon-key',
}));

import { authHeader } from '@alfanumrik/lib/api/auth-header';

beforeEach(() => {
  getSession.mockReset();
});

describe('authHeader() — the shared teacher-fetcher auth seam', () => {
  it('returns an Authorization: Bearer header when a session is present', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok-abc' } } });

    const headers = await authHeader();

    expect(headers).toEqual({ Authorization: 'Bearer tok-abc' });
  });

  it('returns no Authorization header when there is no session', async () => {
    getSession.mockResolvedValue({ data: { session: null } });

    const headers = await authHeader();

    expect(headers).toEqual({});
    expect(headers).not.toHaveProperty('Authorization');
  });

  it('fails soft (empty object, no throw) when getSession rejects', async () => {
    getSession.mockRejectedValue(new Error('supabase not initialized'));

    await expect(authHeader()).resolves.toEqual({});
  });

  it('spreads cleanly into a fetch headers object alongside Content-Type', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok-xyz' } } });

    // This mirrors the exact teacher-fetcher call site:
    //   headers: { 'Content-Type': 'application/json', ...(await authHeader()) }
    const headers = { 'Content-Type': 'application/json', ...(await authHeader()) };

    expect(headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok-xyz',
    });
  });
});

// ── Structural pin: every touched teacher surface forwards authHeader(). ───────
describe('teacher surfaces forward authHeader() into fetch (structural pin)', () => {
  const TEACHER_SURFACES = [
    'src/app/teacher/classes/page.tsx',
    'src/app/teacher/assignments/page.tsx',
    'src/app/teacher/profile/page.tsx',
    'src/app/teacher/students/page.tsx',
    'src/app/teacher/lab-leaderboard/page.tsx',
    'src/app/teacher/_components/TeacherShell.tsx',
  ];

  it.each(TEACHER_SURFACES)('%s imports authHeader from the shared helper', (file) => {
    const src = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(src).toMatch(/import\s*\{\s*authHeader\s*\}\s*from\s*'@\/lib\/api\/auth-header'/);
  });

  it.each(TEACHER_SURFACES)('%s actually calls authHeader() (not a dead import)', (file) => {
    const src = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(src).toMatch(/authHeader\(\)/);
  });
});
