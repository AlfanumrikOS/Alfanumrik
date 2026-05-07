/**
 * Vercel domain client unit tests.
 *
 * Pins:
 *   - getVercelEnv() returns null when env vars missing.
 *   - attachDomainToProject + getDomainState fail-graceful when not configured.
 *   - 409 on attach (already-attached) is treated as success — re-fetches state.
 *   - normaliseDomainResponse handles missing/extra fields safely.
 *   - HTTP non-2xx returns typed error result, not throw.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getVercelEnv,
  attachDomainToProject,
  getDomainState,
} from '@/lib/vercel/domains';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.VERCEL_API_TOKEN = 'test-token';
  process.env.VERCEL_PROJECT_ID = 'prj_test';
  delete process.env.VERCEL_TEAM_ID;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('getVercelEnv', () => {
  it('returns null when VERCEL_API_TOKEN is missing', () => {
    delete process.env.VERCEL_API_TOKEN;
    expect(getVercelEnv()).toBeNull();
  });

  it('returns null when VERCEL_PROJECT_ID is missing', () => {
    delete process.env.VERCEL_PROJECT_ID;
    expect(getVercelEnv()).toBeNull();
  });

  it('returns env when both required vars are set', () => {
    expect(getVercelEnv()).toEqual({
      apiToken: 'test-token',
      projectId: 'prj_test',
      teamId: undefined,
    });
  });

  it('passes through teamId when set', () => {
    process.env.VERCEL_TEAM_ID = 'team_xyz';
    expect(getVercelEnv()?.teamId).toBe('team_xyz');
  });
});

describe('attachDomainToProject — not configured', () => {
  it('returns VERCEL_NOT_CONFIGURED when env unset', async () => {
    delete process.env.VERCEL_API_TOKEN;
    const r = await attachDomainToProject('learn.dps.com');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('VERCEL_NOT_CONFIGURED');
      expect(r.error).toMatch(/VERCEL_API_TOKEN/);
    }
  });
});

describe('attachDomainToProject — happy path', () => {
  it('POSTs to /v10/projects/{id}/domains and normalises response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          name: 'learn.dps.com',
          verified: false,
          misconfigured: true,
          verification: [
            { type: 'TXT', domain: '_vercel.learn.dps.com', value: 'vc-domain-verify=...', reason: 'pending_domain_verification' },
          ],
          createdAt: 1700000000000,
        }),
        { status: 200 },
      ),
    );

    const r = await attachDomainToProject('learn.dps.com');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.name).toBe('learn.dps.com');
      expect(r.data.verified).toBe(false);
      expect(r.data.misconfigured).toBe(true);
      expect(r.data.verification).toHaveLength(1);
      expect(r.data.verification[0].type).toBe('TXT');
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    const url = call[0] instanceof URL ? call[0].toString() : String(call[0]);
    expect(url).toContain('/v10/projects/prj_test/domains');
    expect(call[1]?.method).toBe('POST');
    expect(JSON.parse(String(call[1]?.body))).toEqual({ name: 'learn.dps.com' });
  });

  it('forwards teamId as a query param when set', async () => {
    process.env.VERCEL_TEAM_ID = 'team_xyz';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ name: 'x.com', verified: true, verification: [] }), { status: 200 }),
    );
    await attachDomainToProject('x.com');
    const url = fetchMock.mock.calls[0][0] instanceof URL
      ? fetchMock.mock.calls[0][0].toString()
      : String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('teamId=team_xyz');
  });
});

describe('attachDomainToProject — error paths', () => {
  it('409 (already-attached) re-fetches state via getDomainState', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      // First call: POST → 409
      .mockResolvedValueOnce(new Response('', { status: 409 }))
      // Second call: GET state
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ name: 'learn.dps.com', verified: true, verification: [] }),
          { status: 200 },
        ),
      );

    const r = await attachDomainToProject('learn.dps.com');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.verified).toBe(true);

    // Both calls happened, second was a GET to /v9/.../domains/{name}.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = fetchMock.mock.calls[1][0] instanceof URL
      ? fetchMock.mock.calls[1][0].toString()
      : String(fetchMock.mock.calls[1][0]);
    expect(secondUrl).toContain('/v9/projects/prj_test/domains/learn.dps.com');
    expect(fetchMock.mock.calls[1][1]?.method).toBe('GET');
  });

  it('non-2xx returns typed error result with code propagated', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'forbidden', message: 'Token lacks scope' } }),
        { status: 403 },
      ),
    );
    const r = await attachDomainToProject('x.com');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.code).toBe('forbidden');
      expect(r.error).toBe('Token lacks scope');
    }
  });

  it('network error returns VERCEL_NETWORK_ERROR (not throw)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('econnrefused'));
    const r = await attachDomainToProject('x.com');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('VERCEL_NETWORK_ERROR');
      expect(r.error).toBe('econnrefused');
    }
  });
});

describe('getDomainState', () => {
  it('GETs /v9/.../domains/{name} and returns DOMAIN_NOT_ATTACHED on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 }));
    const r = await getDomainState('not-yet.com');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(404);
      expect(r.code).toBe('DOMAIN_NOT_ATTACHED');
    }
  });

  it('happy path returns normalised state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ name: 'x.com', verified: true, misconfigured: false, verification: [] }),
        { status: 200 },
      ),
    );
    const r = await getDomainState('x.com');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.verified).toBe(true);
      expect(r.data.misconfigured).toBe(false);
      expect(r.data.verification).toEqual([]);
    }
  });
});

describe('normalisation safety', () => {
  it('handles missing verification field (defaults to empty array)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ name: 'x.com', verified: false }), { status: 200 }),
    );
    const r = await attachDomainToProject('x.com');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.verification).toEqual([]);
  });

  it('handles missing name (falls back to requested domain)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ verified: true, verification: [] }), { status: 200 }),
    );
    const r = await attachDomainToProject('x.com');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.name).toBe('x.com');
  });
});
