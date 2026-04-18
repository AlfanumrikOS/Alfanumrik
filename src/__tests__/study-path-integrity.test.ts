/**
 * Study-path integrity guard (2026-04-18).
 *
 * Prevents the two regressions that broke the quiz picker post-deploy:
 *
 *   1. Subject tiles rendered lowercase ("math" vs "Mathematics") because
 *      `cbse_syllabus.subject_display` was backfilled with subject_code.
 *   2. Chapter picker empty because the client helper omitted the Bearer
 *      token AND the v2 response shape (`chapter_title`) didn't match what
 *      the caller expected (`title`).
 *
 * These tests are unit-level — they exercise the two choke-point helpers
 * (`getChaptersForSubject`, `useAllowedChapters` fetcher) against stubbed
 * fetch responses, asserting:
 *
 *   - The request includes an Authorization: Bearer header when a session
 *     is available (guards against the "chapters = []" regression).
 *   - The response is normalized so `chapter_title` is surfaced as `title`
 *     AND legacy `title` is still accepted for back-compat.
 *   - Empty/401/422 responses degrade to `[]` rather than throwing.
 *
 * Any future refactor that strips the Bearer header or forgets the shape
 * mapping will fail these tests. Pair with the DB-level trigger
 * `cbse_syllabus_normalize_display` (migration
 * `cbse_syllabus_display_integrity_trigger`) which prevents lowercase
 * subject names at the write layer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock the supabase client getSession to return a session with an access token.
vi.mock('@/lib/supabase-client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-access-token-abc' } },
      }),
    },
  },
}));

// The getChaptersForSubject helper lives in supabase.ts alongside many other
// exports that pull in client-only dependencies (PostgrestJS, etc.). The
// test runs under JSDOM so we import directly but guard against accidental
// side-effects via the module mock for the supabase client.
import { getChaptersForSubject } from '@/lib/supabase';

describe('study-path integrity — getChaptersForSubject', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('sends Authorization: Bearer header derived from the Supabase session', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ chapters: [] }),
    });

    await getChaptersForSubject('math', '9');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init).toBeDefined();
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer test-access-token-abc',
    });
  });

  it('maps v2 chapter_title → title for QuizSetup consumers', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        chapters: [
          { chapter_number: 1, chapter_title: 'Number Systems' },
          { chapter_number: 2, chapter_title: 'Polynomials' },
          { chapter_number: 3, chapter_title: 'Coordinate Geometry' },
        ],
      }),
    });

    const chapters = await getChaptersForSubject('math', '9');

    expect(chapters).toEqual([
      { chapter_number: 1, title: 'Number Systems' },
      { chapter_number: 2, title: 'Polynomials' },
      { chapter_number: 3, title: 'Coordinate Geometry' },
    ]);
  });

  it('still accepts legacy response shape (title) for back-compat', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        chapters: [{ chapter_number: 1, title: 'Number Systems' }],
      }),
    });

    const chapters = await getChaptersForSubject('math', '9');

    expect(chapters).toEqual([{ chapter_number: 1, title: 'Number Systems' }]);
  });

  it('falls back to "Chapter N" placeholder when neither field is present', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        chapters: [{ chapter_number: 5 }],
      }),
    });

    const chapters = await getChaptersForSubject('math', '9');

    expect(chapters).toEqual([{ chapter_number: 5, title: 'Chapter 5' }]);
  });

  it('returns [] on 401 (unauthenticated) without throwing', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
    });

    const chapters = await getChaptersForSubject('math', '9');

    expect(chapters).toEqual([]);
  });

  it('returns [] on 422 (subject not allowed) without throwing', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 422,
    });

    const chapters = await getChaptersForSubject('physics', '6');

    expect(chapters).toEqual([]);
  });

  it('returns [] on network error without throwing', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network failure'),
    );

    const chapters = await getChaptersForSubject('math', '9');

    expect(chapters).toEqual([]);
  });
});
