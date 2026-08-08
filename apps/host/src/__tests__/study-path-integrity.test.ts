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
 *   - No response shape throws.
 *
 * FAILURE-vs-EMPTY CONTRACT (added when getChaptersForSubject started
 * returning `ServiceResult`): the helper used to collapse 401, 5xx, network
 * errors AND "this subject isn't yours" all into the same `[]`, so /learn and
 * QuizSetup rendered "No chapters available yet" — a claim that the student's
 * syllabus is empty — after a mere auth hiccup. Exactly ONE non-2xx is a
 * genuine empty answer now:
 *
 *   - 422 (subject not in the student's allowed set) → ok, data: []
 *   - 401 / other non-2xx / network throw            → ok: false
 *
 * Both directions are asserted below; a test that only checked the failure
 * direction would pass even if the genuine-empty path had been deleted.
 *
 * Any future refactor that strips the Bearer header or forgets the shape
 * mapping will fail these tests. Pair with the DB-level trigger
 * `cbse_syllabus_normalize_display` (migration
 * `cbse_syllabus_display_integrity_trigger`) which prevents lowercase
 * subject names at the write layer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock the supabase client getSession to return a session with an access token.
vi.mock('@alfanumrik/lib/supabase-client', () => ({
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
import { getChaptersForSubject } from '@alfanumrik/lib/supabase';

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

    const res = await getChaptersForSubject('math', '9');

    expect(res.ok).toBe(true);
    expect(res.ok && res.data).toEqual([
      { chapter_number: 1, title: 'Number Systems', title_hi: null, verified_question_count: 0 },
      { chapter_number: 2, title: 'Polynomials', title_hi: null, verified_question_count: 0 },
      { chapter_number: 3, title: 'Coordinate Geometry', title_hi: null, verified_question_count: 0 },
    ]);
  });

  it('still accepts legacy response shape (title) for back-compat', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        chapters: [{ chapter_number: 1, title: 'Number Systems' }],
      }),
    });

    const res = await getChaptersForSubject('math', '9');

    expect(res.ok).toBe(true);
    expect(res.ok && res.data).toEqual([{ chapter_number: 1, title: 'Number Systems', title_hi: null, verified_question_count: 0 }]);
  });

  it('falls back to "Chapter N" placeholder when neither field is present', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        chapters: [{ chapter_number: 5 }],
      }),
    });

    const res = await getChaptersForSubject('math', '9');

    expect(res.ok).toBe(true);
    expect(res.ok && res.data).toEqual([{ chapter_number: 5, title: 'Chapter 5', title_hi: null, verified_question_count: 0 }]);
  });

  it('reports a FAILURE (not an empty list) on 401 — an auth hiccup is not an empty syllabus', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
    });

    const res = await getChaptersForSubject('math', '9');

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.code).toBe('UNAUTHORIZED');
    // The old shape — a bare, success-looking [] — must not come back.
    expect(res).not.toHaveProperty('data');
  });

  it('reports a genuine EMPTY (ok, data: []) on 422 — subject not in this student\'s set', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 422,
    });

    const res = await getChaptersForSubject('physics', '6');

    // Other direction of the same contract: 422 is an ANSWER, not a failure —
    // "No chapters available for this subject yet" is correct here.
    expect(res.ok).toBe(true);
    expect(res.ok && res.data).toEqual([]);
  });

  it('reports a FAILURE (not an empty list) on a 5xx', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
    });

    const res = await getChaptersForSubject('math', '9');

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.code).toBe('EXTERNAL_FAILURE');
  });

  it('reports a FAILURE on a network error, without throwing', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network failure'),
    );

    const res = await getChaptersForSubject('math', '9');

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain('network failure');
  });

  it('reports a genuine EMPTY (ok, data: []) when the server returns zero chapters', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ chapters: [] }),
    });

    const res = await getChaptersForSubject('math', '9');

    expect(res.ok).toBe(true);
    expect(res.ok && res.data).toEqual([]);
  });
});
