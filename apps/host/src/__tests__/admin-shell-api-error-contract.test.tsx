/**
 * AdminShell structured API error contract (Phase 2 client hardening, 2026-07-20).
 *
 * RCA: Vercel's DDoS challenge intermittently serves 429 text/html "Security
 * Checkpoint" pages to super-admin fetch() calls; raw `res.json()` then threw
 * `Unexpected token '<'` at the operator with no explanation. Phase 2 replaced
 * raw parsing with a structured `ApiResult` contract:
 *
 *   - `classifyJsonResponse` — pure Response → ApiResult classifier (never throws)
 *   - `readAdminJson`        — minimal drop-in guard for legacy `await res.json()` sites
 *   - `apiFetchJson`         — AdminShell context fetch wrapper: network errors →
 *                              {kind:'network'}, 401 → one refreshSession + retry,
 *                              second 401 → session_expired + banner,
 *                              security_checkpoint → dismissible operator banner
 *
 * The pure helpers are exported from AdminShell.tsx and imported directly
 * (sibling-suite pattern); the apiFetchJson refresh/retry flow is exercised by
 * rendering the real AdminShell with its heavy deps mocked and a probe child
 * capturing the useAdmin() context.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

// ── hoisted mocks for AdminShell's heavy deps ───────────────────────────────

const { getSessionMock, refreshSessionMock, getUserMock, onAuthStateChangeMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  refreshSessionMock: vi.fn(),
  getUserMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
}));

vi.mock('@alfanumrik/lib/supabase-client', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      refreshSession: refreshSessionMock,
      getUser: getUserMock,
      onAuthStateChange: onAuthStateChangeMock,
      signOut: vi.fn(),
    },
  },
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({}),
}));

vi.mock('@alfanumrik/lib/feature-flags', () => ({
  EDUCATION_INTELLIGENCE_FLAGS: { V1: 'ff_education_intelligence' },
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: false }),
}));

vi.mock('@alfanumrik/lib/cosmic-theme', () => ({
  useCosmicTheme: () => ({ cosmicEnabled: false }),
}));

vi.mock('@alfanumrik/ui/cosmic', () => ({
  Starfield: () => null,
}));

vi.mock('@alfanumrik/ui/admin-ui/DashboardSidebar', () => ({
  __esModule: true,
  default: () => <nav data-testid="sidebar" />,
}));

vi.mock('@alfanumrik/ui/Skeleton', () => ({
  AdminDashboardSkeleton: () => <div data-testid="skeleton" />,
}));

import AdminShell, {
  classifyJsonResponse,
  readAdminJson,
  useAdmin,
  type ApiResult,
} from '@/app/super-admin/_components/AdminShell';

// ── Response builders ───────────────────────────────────────────────────────

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const htmlRes = (status: number, body = '<html><body>Security Checkpoint</body></html>') =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

const malformedJsonRes = (status = 200) =>
  new Response('{ this is not json', { status, headers: { 'content-type': 'application/json' } });

// ── classifyJsonResponse — pure classification matrix ───────────────────────

describe('classifyJsonResponse (pure Response → ApiResult classifier)', () => {
  it('200 + application/json → { ok: true, data, status: 200 }', async () => {
    const result = await classifyJsonResponse<{ hello: string }>(jsonRes({ hello: 'world' }));
    expect(result).toEqual({ ok: true, data: { hello: 'world' }, status: 200 });
  });

  it('429 + text/html (Vercel DDoS challenge page) → security_checkpoint', async () => {
    const result = await classifyJsonResponse(htmlRes(429));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('security_checkpoint');
    expect(result.error.status).toBe(429);
    expect(result.error.message).toMatch(/security checkpoint/i);
  });

  it('200 + text/html → non_json (NOT a checkpoint — only 429+html is the challenge shape)', async () => {
    const result = await classifyJsonResponse(htmlRes(200));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('non_json');
    expect(result.error.status).toBe(200);
    expect(result.error.message).toContain('HTTP 200');
  });

  it('429 + application/json (real rate-limit response) → http, NOT security_checkpoint', async () => {
    const result = await classifyJsonResponse(jsonRes({ error: 'rate limited' }, 429));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('http');
    expect(result.error.status).toBe(429);
    expect(result.error.message).toBe('rate limited');
  });

  it('401 + JSON → session_expired (callers reach here only after apiFetch refresh+retry)', async () => {
    const result = await classifyJsonResponse(jsonRes({ error: 'jwt expired' }, 401));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('session_expired');
    expect(result.error.status).toBe(401);
  });

  it('non-2xx JSON with server error string → http carrying the server message', async () => {
    const result = await classifyJsonResponse(jsonRes({ error: 'boom' }, 500));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ kind: 'http', status: 500, message: 'boom' });
  });

  it('non-2xx JSON without an error string → http with HTTP <status> fallback message', async () => {
    const result = await classifyJsonResponse(jsonRes({ nope: true }, 503));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ kind: 'http', status: 503, message: 'HTTP 503' });
  });

  it('application/json content-type with a malformed body → non_json (never throws)', async () => {
    const result = await classifyJsonResponse(malformedJsonRes(200));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('non_json');
    expect(result.error.message).toMatch(/Malformed JSON/i);
  });
});

// ── readAdminJson — legacy `await res.json()` drop-in guard ─────────────────

describe('readAdminJson (drop-in guard for legacy res.json() call sites)', () => {
  it('returns the parsed body for 200 JSON', async () => {
    await expect(readAdminJson(jsonRes({ ok: 1 }))).resolves.toEqual({ ok: 1 });
  });

  it('preserves legacy semantics: non-2xx JSON bodies are RETURNED (caller `d.error` handling keeps working)', async () => {
    await expect(readAdminJson(jsonRes({ error: 'forbidden' }, 403))).resolves.toEqual({ error: 'forbidden' });
  });

  it('429 non-JSON → throws a readable security-checkpoint message, not "Unexpected token \'<\'"', async () => {
    await expect(readAdminJson(htmlRes(429))).rejects.toThrow(/security checkpoint.*HTTP 429/i);
  });

  it('other non-JSON → throws "Server returned a non-JSON response (HTTP <status>)"', async () => {
    await expect(readAdminJson(htmlRes(502))).rejects.toThrow('Server returned a non-JSON response (HTTP 502)');
  });

  it('malformed JSON body → throws "Malformed JSON response (HTTP <status>)"', async () => {
    await expect(readAdminJson(malformedJsonRes(200))).rejects.toThrow('Malformed JSON response (HTTP 200)');
  });
});

// ── apiFetchJson — component-level 401 refresh+retry / network / checkpoint ─

type AdminCtx = {
  apiFetchJson: <T = unknown>(path: string, init?: RequestInit) => Promise<ApiResult<T>>;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
};

let capturedCtx: AdminCtx | null = null;
function Probe() {
  capturedCtx = useAdmin();
  return <div data-testid="probe" />;
}

const fetchMock = vi.fn();

async function renderShell(): Promise<AdminCtx> {
  render(
    <AdminShell>
      <Probe />
    </AdminShell>,
  );
  await screen.findByTestId('probe');
  if (!capturedCtx) throw new Error('useAdmin context not captured');
  return capturedCtx;
}

describe('AdminShell apiFetchJson (401-refresh-retry + structured errors)', () => {
  beforeEach(() => {
    capturedCtx = null;
    fetchMock.mockReset();
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok-initial' } } });
    refreshSessionMock.mockReset();
    getUserMock.mockResolvedValue({ data: { user: null } });
    onAuthStateChangeMock.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('network throw → { kind: "network", status: 0 } (no unhandled rejection at the caller)', async () => {
    const ctx = await renderShell();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    let result!: ApiResult<unknown>;
    await act(async () => {
      result = await ctx.apiFetchJson('/api/super-admin/stats');
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'network', status: 0, message: 'Failed to fetch' },
    });
  });

  it('401 → refreshSession → retry with the refreshed Bearer → 200 ok', async () => {
    const ctx = await renderShell();
    fetchMock
      .mockResolvedValueOnce(jsonRes({ error: 'jwt expired' }, 401))
      .mockResolvedValueOnce(jsonRes({ hello: 'world' }));
    refreshSessionMock.mockResolvedValueOnce({
      data: { session: { access_token: 'tok-refreshed' } },
    });

    let result!: ApiResult<{ hello: string }>;
    await act(async () => {
      result = await ctx.apiFetchJson<{ hello: string }>('/api/super-admin/stats');
    });

    expect(result).toEqual({ ok: true, data: { hello: 'world' }, status: 200 });
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Retry rides the refreshed token (accessTokenRef, not stale state) and
    // keeps the same-origin credentials so the httpOnly sb-* cookie rides along.
    const [, retryInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer tok-refreshed');
    expect(retryInit.credentials).toBe('same-origin');
    // No session-expired banner on a recovered 401.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('401 → refresh → 401 again → session_expired + operator banner', async () => {
    const ctx = await renderShell();
    fetchMock.mockResolvedValue(jsonRes({ error: 'jwt expired' }, 401));
    refreshSessionMock.mockResolvedValueOnce({ data: { session: null } });

    let result!: ApiResult<unknown>;
    await act(async () => {
      result = await ctx.apiFetchJson('/api/super-admin/stats');
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('session_expired');
    expect(result.error.status).toBe(401);
    // Exactly one retry — apiFetch never loops.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The session-expired banner renders (preserves in-progress operator work).
    expect(await screen.findByRole('alert')).toHaveTextContent(/session expired/i);
  });

  it('security checkpoint via apiFetchJson → structured error + dismissible status banner', async () => {
    const ctx = await renderShell();
    fetchMock.mockResolvedValueOnce(htmlRes(429));

    let result!: ApiResult<unknown>;
    await act(async () => {
      result = await ctx.apiFetchJson('/api/super-admin/stats');
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('security_checkpoint');
    // Checkpoint is informational (data may be stale), NOT a session error:
    // status banner shows, alert (session-expired) does not.
    expect(await screen.findByRole('status')).toHaveTextContent(/security checkpoint/i);
    expect(screen.queryByRole('alert')).toBeNull();
    // A checkpoint 429 must not burn the single refresh+retry (only 401 does).
    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
