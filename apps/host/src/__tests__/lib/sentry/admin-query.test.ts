/**
 * src/lib/sentry/admin-query.ts — unit tests.
 *
 * Covers every documented degradation path so the super-admin health
 * dashboard never blanks on an unexpected Sentry failure mode.
 *
 *   - no_token    → env unset; fetch is NEVER called.
 *   - happy path  → 200 + well-shaped data; builds Map correctly.
 *   - http_error  → 401, 403, 5xx — all collapse to the same UI hint.
 *   - timeout     → AbortController fires; returns reason=timeout.
 *   - parse_error → malformed JSON or wrong-shape body.
 *
 * Plus the short-circuit case: an empty schoolIds array returns
 * `{ ok: true }` without touching env vars or fetch — important so a
 * fresh-install instance doesn't log a degraded-banner for zero
 * schools.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { fetchSentryEventCountsBySchool } from '@alfanumrik/lib/sentry/admin-query';

const ORIGINAL_ENV = { ...process.env };

const SCHOOL_A = '11111111-1111-1111-1111-111111111111';
const SCHOOL_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

// ─── no_token ────────────────────────────────────────────────────

describe('fetchSentryEventCountsBySchool — no_token', () => {
  it('returns ok:false reason:no_token when SENTRY_AUTH_TOKEN is missing, and does NOT call fetch', async () => {
    delete process.env.SENTRY_AUTH_TOKEN;
    process.env.SENTRY_ORG_SLUG = 'org';
    process.env.SENTRY_PROJECT_SLUG = 'proj';

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await fetchSentryEventCountsBySchool([SCHOOL_A]);

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_token');
    expect(r.counts.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns ok:false reason:no_token when SENTRY_ORG_SLUG is missing', async () => {
    process.env.SENTRY_AUTH_TOKEN = 'tok';
    delete process.env.SENTRY_ORG_SLUG;
    process.env.SENTRY_PROJECT_SLUG = 'proj';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const r = await fetchSentryEventCountsBySchool([SCHOOL_A]);
    expect(r.reason).toBe('no_token');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns ok:false reason:no_token when SENTRY_PROJECT_SLUG is missing', async () => {
    process.env.SENTRY_AUTH_TOKEN = 'tok';
    process.env.SENTRY_ORG_SLUG = 'org';
    delete process.env.SENTRY_PROJECT_SLUG;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const r = await fetchSentryEventCountsBySchool([SCHOOL_A]);
    expect(r.reason).toBe('no_token');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─── empty input short-circuit ───────────────────────────────────

describe('fetchSentryEventCountsBySchool — empty input', () => {
  it('short-circuits to ok:true with empty Map when schoolIds is empty (no fetch, no env read)', async () => {
    delete process.env.SENTRY_AUTH_TOKEN;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const r = await fetchSentryEventCountsBySchool([]);
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.counts.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─── happy path ──────────────────────────────────────────────────

describe('fetchSentryEventCountsBySchool — happy path', () => {
  beforeEach(() => {
    process.env.SENTRY_AUTH_TOKEN = 'tok-abc';
    process.env.SENTRY_ORG_SLUG = 'alfanumrikos';
    process.env.SENTRY_PROJECT_SLUG = 'alfanumrik';
  });

  it('parses 200 response and builds a per-school Map', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { 'tags[school_id]': SCHOOL_A, 'count()': 7 },
            { 'tags[school_id]': SCHOOL_B, 'count()': 3 },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const r = await fetchSentryEventCountsBySchool([SCHOOL_A, SCHOOL_B]);

    expect(r.ok).toBe(true);
    expect(r.counts.get(SCHOOL_A)).toBe(7);
    expect(r.counts.get(SCHOOL_B)).toBe(3);

    // Verify the URL + headers we actually sent.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    const urlStr = String(url);
    expect(urlStr).toContain('https://sentry.io/api/0/organizations/alfanumrikos/events/');
    expect(urlStr).toContain('event.type%3Aerror');
    expect(urlStr).toContain(encodeURIComponent(`tags[school_id]:[${SCHOOL_A},${SCHOOL_B}]`));
    expect(urlStr).toContain('statsPeriod=24h');
    expect(urlStr).toContain('project=alfanumrik');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-abc');
  });

  it('coerces string count() values to numbers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ 'tags[school_id]': SCHOOL_A, 'count()': '12' }],
        }),
        { status: 200 },
      ),
    );

    const r = await fetchSentryEventCountsBySchool([SCHOOL_A]);
    expect(r.ok).toBe(true);
    expect(r.counts.get(SCHOOL_A)).toBe(12);
  });

  it('skips rows without a school_id tag', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { 'tags[school_id]': SCHOOL_A, 'count()': 5 },
            { 'tags[school_id]': null, 'count()': 999 }, // unbound errors
            { 'count()': 42 }, // no tag at all
          ],
        }),
        { status: 200 },
      ),
    );

    const r = await fetchSentryEventCountsBySchool([SCHOOL_A]);
    expect(r.ok).toBe(true);
    expect(r.counts.size).toBe(1);
    expect(r.counts.get(SCHOOL_A)).toBe(5);
  });
});

// ─── http_error ──────────────────────────────────────────────────

describe('fetchSentryEventCountsBySchool — http_error', () => {
  beforeEach(() => {
    process.env.SENTRY_AUTH_TOKEN = 'tok';
    process.env.SENTRY_ORG_SLUG = 'org';
    process.env.SENTRY_PROJECT_SLUG = 'proj';
  });

  it('returns reason:http_error on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    );
    const r = await fetchSentryEventCountsBySchool([SCHOOL_A]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('http_error');
    expect(r.counts.size).toBe(0);
  });

  it('returns reason:http_error on 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Forbidden', { status: 403 }),
    );
    const r = await fetchSentryEventCountsBySchool([SCHOOL_A]);
    expect(r.reason).toBe('http_error');
  });

  it('returns reason:http_error on 500', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Server Error', { status: 500 }),
    );
    const r = await fetchSentryEventCountsBySchool([SCHOOL_A]);
    expect(r.reason).toBe('http_error');
  });

  it('returns reason:http_error on a network-level fetch rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNRESET'));
    const r = await fetchSentryEventCountsBySchool([SCHOOL_A]);
    expect(r.reason).toBe('http_error');
  });
});

// ─── timeout ─────────────────────────────────────────────────────

describe('fetchSentryEventCountsBySchool — timeout', () => {
  beforeEach(() => {
    process.env.SENTRY_AUTH_TOKEN = 'tok';
    process.env.SENTRY_ORG_SLUG = 'org';
    process.env.SENTRY_PROJECT_SLUG = 'proj';
  });

  it('returns reason:timeout when the fetch is aborted', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => {
      // Simulate what fetch does when its signal aborts: reject with
      // a DOMException-shaped error whose name is 'AbortError'.
      const err = new Error('The user aborted a request.');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    const r = await fetchSentryEventCountsBySchool([SCHOOL_A]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('timeout');
    expect(r.counts.size).toBe(0);
  });
});

// ─── parse_error ─────────────────────────────────────────────────

describe('fetchSentryEventCountsBySchool — parse_error', () => {
  beforeEach(() => {
    process.env.SENTRY_AUTH_TOKEN = 'tok';
    process.env.SENTRY_ORG_SLUG = 'org';
    process.env.SENTRY_PROJECT_SLUG = 'proj';
  });

  it('returns reason:parse_error when body is malformed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not-json{{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const r = await fetchSentryEventCountsBySchool([SCHOOL_A]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('parse_error');
  });

  it("returns reason:parse_error when body shape lacks data:[]", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ unexpected: 'shape' }), { status: 200 }),
    );
    const r = await fetchSentryEventCountsBySchool([SCHOOL_A]);
    expect(r.reason).toBe('parse_error');
  });
});
