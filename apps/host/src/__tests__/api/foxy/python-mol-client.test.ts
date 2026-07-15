import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callPythonMol } from '@alfanumrik/lib/ai/clients/python-mol';
import { logger } from '@alfanumrik/lib/logger';

/**
 * Foxy Perception (Phase 1C) — Node Python-MOL client fail-closed contract.
 *
 * callPythonMol MUST:
 *   - return null when PYTHON_AI_BASE_URL is empty (architect kill switch),
 *   - forward the caller's Authorization when a token is present,
 *   - return the raw response text on 2xx,
 *   - return null (never throw) on non-2xx, network error, or timeout,
 *   - never log the request/response body (P13) — not asserted here directly,
 *     but the client only ever passes status/reason to the logger.
 *
 * REG-254 (below): the ARMED keyless Cloud Run invoker-token mint. When
 * PYTHON_AI_BASE_URL is set AND all four GCP_* WIF env vars are present the
 * client mints a Google-signed ID token (aud = the service origin) via
 * Vercel OIDC → ExternalAccountClient (STS + SA impersonation) →
 * iamcredentials generateIdToken and attaches it as
 * `X-Serverless-Authorization` WITHOUT touching the student `Authorization`.
 * Every mint failure/dormant branch is fail-closed (null, no throw, no
 * unauthenticated request, no token/body in logs). The heavy deps are
 * dynamic-imported ONLY on the armed path — mocked here so the dormant path
 * (and the existing 7 tests) can never touch them.
 */

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Heavy Node deps for the armed keyless-mint path. These are `await import()`-ed
// only when the WIF env is present, so mocking them is a no-op for the dormant
// tests (which never reach the import) — that is exactly what REG-254's dormant
// case pins. `vi.hoisted` gives the mock factories a stable reference the tests
// can reconfigure per-scenario.
const { getVercelOidcTokenMock, externalAccountFromJsonMock, generateIdTokenRequestMock } =
  vi.hoisted(() => ({
    getVercelOidcTokenMock: vi.fn(),
    externalAccountFromJsonMock: vi.fn(),
    generateIdTokenRequestMock: vi.fn(),
  }));

vi.mock('@vercel/oidc', () => ({
  getVercelOidcToken: getVercelOidcTokenMock,
}));

vi.mock('google-auth-library', () => ({
  ExternalAccountClient: { fromJSON: externalAccountFromJsonMock },
}));

const ORIGINAL_ENV = process.env.PYTHON_AI_BASE_URL;

/** The four NON-SECRET WIF env vars that arm the keyless mint. All must be
 * present for the mint to run; any missing → dormant (legacy behavior). */
const GCP_WIF_KEYS = [
  'GCP_PROJECT_NUMBER',
  'GCP_SERVICE_ACCOUNT_EMAIL',
  'GCP_WORKLOAD_IDENTITY_POOL_ID',
  'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID',
] as const;

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.PYTHON_AI_BASE_URL;
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.PYTHON_AI_BASE_URL;
  else process.env.PYTHON_AI_BASE_URL = ORIGINAL_ENV;
});

describe('callPythonMol — dark until PYTHON_AI_BASE_URL is wired in', () => {
  it('returns null when the env var is unset (no fetch attempted)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const out = await callPythonMol({ endpointPath: '/v1/classify', authToken: 't', body: {} });
    expect(out).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null when the env var is empty/whitespace', async () => {
    process.env.PYTHON_AI_BASE_URL = '   ';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const out = await callPythonMol({ endpointPath: '/v1/classify', authToken: 't', body: {} });
    expect(out).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('callPythonMol — happy path + header forwarding', () => {
  it('POSTs to base+path, forwards the bearer token, returns raw text on 2xx', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"intent":"ask_concept"}', { status: 200 }),
    );
    const out = await callPythonMol({
      endpointPath: '/v1/classify',
      authToken: 'student-jwt',
      body: { student_id: 's1' },
      baseUrlOverride: 'https://py.example.com/',
    });
    expect(out).toBe('{"intent":"ask_concept"}');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    // Trailing/leading slash tolerated → single slash join.
    expect(url).toBe('https://py.example.com/v1/classify');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer student-jwt');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('omits Authorization when authToken is null (Python auth will 401 → null)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    await callPythonMol({
      endpointPath: 'v1/classify',
      authToken: null,
      body: {},
      baseUrlOverride: 'https://py.example.com',
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://py.example.com/v1/classify');
    const headers = init.headers as Record<string, string>;
    expect('Authorization' in headers).toBe(false);
  });
});

describe('callPythonMol — fail-safe (never throws)', () => {
  it('returns null on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 503 }));
    const out = await callPythonMol({
      endpointPath: '/v1/classify',
      authToken: 't',
      body: {},
      baseUrlOverride: 'https://py.example.com',
    });
    expect(out).toBeNull();
  });

  it('returns null on a thrown network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const out = await callPythonMol({
      endpointPath: '/v1/classify',
      authToken: 't',
      body: {},
      baseUrlOverride: 'https://py.example.com',
    });
    expect(out).toBeNull();
  });

  it('returns null on an AbortError (timeout)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );
    const out = await callPythonMol({
      endpointPath: '/v1/classify',
      authToken: 't',
      body: {},
      baseUrlOverride: 'https://py.example.com',
      timeoutMs: 5,
    });
    expect(out).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REG-254 — keyless Vercel-OIDC → GCP-WIF Cloud Run invoker-token mint.
//
// This is the ARMED path (WIF env present) that the DORMANT-only suite above
// does not exercise. Contract under test:
//   - happy: mint an ID token → outbound fetch carries BOTH
//     `X-Serverless-Authorization: Bearer <idToken>` and the UNTOUCHED student
//     `Authorization`; generateIdToken audience == the service ORIGIN.
//   - fail-closed on OIDC absent / STS+generateIdToken failure / non-2xx / empty
//     token / mint timeout → null, NEVER a throw, NEVER an unauthenticated
//     request to the Invoker-IAM-enforced Cloud Run service.
//   - P13: a token/body/failure detail is never handed to the logger — only the
//     scope code + path.
//   - dormant (GCP_* absent): mint block skipped, NO dynamic import attempted,
//     legacy header set (byte-identical to today).
// ─────────────────────────────────────────────────────────────────────────────

const ARMED_BASE_URL = 'https://py.example.com';
const CLOUD_RUN_ID_TOKEN = 'cloud-run-id-token-SUPER-SECRET-VALUE';

describe('callPythonMol — keyless WIF Cloud Run invoker mint (REG-254)', () => {
  const ORIGINAL_GCP: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Snapshot + clear the four WIF vars so each test controls arm vs dormant.
    // (The top-level beforeEach already ran vi.restoreAllMocks + cleared
    // PYTHON_AI_BASE_URL; we re-establish the mint mock wiring here AFTER that.)
    for (const k of GCP_WIF_KEYS) {
      ORIGINAL_GCP[k] = process.env[k];
      delete process.env[k];
    }

    // The top-level beforeEach runs vi.restoreAllMocks(), which only restores
    // vi.spyOn spies — NOT these hoisted vi.fn() mocks (nor the logger mock).
    // Reset them explicitly so call history + implementation don't leak between
    // tests (the dormant "never called" and P13 "not logged" checks depend on a
    // clean slate).
    getVercelOidcTokenMock.mockReset();
    externalAccountFromJsonMock.mockReset();
    generateIdTokenRequestMock.mockReset();
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.error).mockClear();
    vi.mocked(logger.debug).mockClear();

    // Default happy wiring; individual tests override to drive each failure.
    // Faithful client shape: the real ExternalAccountClient resolves the Vercel
    // OIDC subject token first (throws off-Vercel when the header is absent),
    // exchanges at STS + impersonates the SA, then request() hits the explicit
    // generateIdToken hop. We route request() through generateIdTokenRequestMock
    // so tests can inspect the audience and drive the hop's outcome, and we call
    // the captured subject-token supplier so a throwing OIDC fetch degrades
    // exactly like production.
    getVercelOidcTokenMock.mockResolvedValue('vercel-oidc-subject-jwt');
    generateIdTokenRequestMock.mockResolvedValue({ data: { token: CLOUD_RUN_ID_TOKEN } });
    externalAccountFromJsonMock.mockImplementation((config: any) => ({
      request: async (opts: any) => {
        await config.subject_token_supplier.getSubjectToken();
        return generateIdTokenRequestMock(opts);
      },
    }));
  });

  afterEach(() => {
    for (const k of GCP_WIF_KEYS) {
      if (ORIGINAL_GCP[k] === undefined) delete process.env[k];
      else process.env[k] = ORIGINAL_GCP[k];
    }
  });

  function armWif(): void {
    process.env.GCP_PROJECT_NUMBER = '111111111111';
    process.env.GCP_SERVICE_ACCOUNT_EMAIL = 'foxy-invoker@proj.iam.gserviceaccount.com';
    process.env.GCP_WORKLOAD_IDENTITY_POOL_ID = 'vercel-pool';
    process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = 'vercel-provider';
  }

  describe('armed — all four GCP_* present', () => {
    beforeEach(() => {
      armWif();
    });

    it('mints an ID token and sends BOTH X-Serverless-Authorization and the untouched student Authorization; aud = service origin', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{"intent":"ask_concept"}', { status: 200 }),
      );

      const out = await callPythonMol({
        endpointPath: '/v1/classify',
        authToken: 'student-jwt',
        body: { student_id: 's1' },
        baseUrlOverride: `${ARMED_BASE_URL}/`,
      });

      expect(out).toBe('{"intent":"ask_concept"}');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      // Cloud Run invoker token rides X-Serverless-Authorization …
      expect(headers['X-Serverless-Authorization']).toBe(`Bearer ${CLOUD_RUN_ID_TOKEN}`);
      // … and the student JWT on Authorization is byte-for-byte untouched.
      expect(headers.Authorization).toBe('Bearer student-jwt');

      // generateIdToken audience == the service ORIGIN (not base+path).
      expect(generateIdTokenRequestMock).toHaveBeenCalledTimes(1);
      const genOpts = generateIdTokenRequestMock.mock.calls[0][0] as {
        url: string;
        method: string;
        data: { audience: string; includeEmail?: boolean };
      };
      expect(genOpts.data.audience).toBe('https://py.example.com');
      expect(genOpts.url).toContain(':generateIdToken');
      // The subject-token supplier (Vercel OIDC) was actually consumed.
      expect(getVercelOidcTokenMock).toHaveBeenCalled();
    });

    it('fail-closed — OIDC token absent (off-Vercel, e.g. AWS ECS): returns null, never throws, sends NO request to Cloud Run', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      // getVercelOidcToken throws when the request-scoped header/env is absent.
      getVercelOidcTokenMock.mockRejectedValue(new Error('x-vercel-oidc-token header absent'));

      const out = await callPythonMol({
        endpointPath: '/v1/classify',
        authToken: 'student-jwt',
        body: {},
        baseUrlOverride: ARMED_BASE_URL,
      });

      expect(out).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('fail-closed — STS/impersonation or generateIdToken rejects (non-2xx): returns null, no request sent', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      generateIdTokenRequestMock.mockRejectedValue(new Error('STS 403 permission denied'));

      const out = await callPythonMol({
        endpointPath: '/v1/classify',
        authToken: 'student-jwt',
        body: {},
        baseUrlOverride: ARMED_BASE_URL,
      });

      expect(out).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('fail-closed — generateIdToken 2xx but empty/absent token: returns null, no request sent', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      generateIdTokenRequestMock.mockResolvedValue({ data: {} });

      const out = await callPythonMol({
        endpointPath: '/v1/classify',
        authToken: 'student-jwt',
        body: {},
        baseUrlOverride: ARMED_BASE_URL,
      });

      expect(out).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('fail-closed — mint timeout elapses: returns null, never throws, no request sent', async () => {
      vi.useFakeTimers();
      try {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        // The generateIdToken hop hangs forever → only the mint's own internal
        // timeout (MINT_TIMEOUT_MS = 3s) can settle the race.
        generateIdTokenRequestMock.mockReturnValue(new Promise<never>(() => {}));

        const p = callPythonMol({
          endpointPath: '/v1/classify',
          authToken: 'student-jwt',
          body: {},
          baseUrlOverride: ARMED_BASE_URL,
        });

        // Flush the dynamic imports + the hanging hop, then trip the 3s mint
        // timeout. advanceTimersByTimeAsync drains microtasks between timers.
        await vi.advanceTimersByTimeAsync(3000);
        await expect(p).resolves.toBeNull();
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('P13 — token/body/failure detail never reach the logger (scope code + path only)', async () => {
      vi.spyOn(globalThis, 'fetch');
      // The failure reason carries token- and body-shaped secrets; NONE may be
      // logged. The mint swallows the throw and returns null.
      generateIdTokenRequestMock.mockRejectedValue(
        new Error('token=LEAKED_ID_TOKEN body=STUDENT_PII_NOTE'),
      );

      const out = await callPythonMol({
        endpointPath: '/v1/classify',
        authToken: 'student-jwt',
        body: { note: 'STUDENT_PII_NOTE' },
        baseUrlOverride: ARMED_BASE_URL,
      });

      expect(out).toBeNull();

      // Only the fail-closed scope code + non-PII path may be logged.
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith('python_mol.mint_unavailable', {
        path: '/v1/classify',
      });

      const allLogArgs = JSON.stringify([
        ...vi.mocked(logger.info).mock.calls,
        ...vi.mocked(logger.warn).mock.calls,
        ...vi.mocked(logger.error).mock.calls,
        ...vi.mocked(logger.debug).mock.calls,
      ]);
      expect(allLogArgs).not.toContain('LEAKED_ID_TOKEN');
      expect(allLogArgs).not.toContain('STUDENT_PII_NOTE');
      expect(allLogArgs).not.toContain('student-jwt');
    });
  });

  describe('dormant — GCP_* absent (byte-identical to legacy, no dynamic import)', () => {
    it('skips the mint entirely: no X-Serverless-Authorization, student Authorization forwarded, WIF deps never touched', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('ok', { status: 200 }),
      );

      const out = await callPythonMol({
        endpointPath: '/v1/classify',
        authToken: 'student-jwt',
        body: {},
        baseUrlOverride: ARMED_BASE_URL,
      });

      expect(out).toBe('ok');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect('X-Serverless-Authorization' in headers).toBe(false);
      expect(headers.Authorization).toBe('Bearer student-jwt');

      // No dynamic import attempted → the WIF deps were never reached.
      expect(getVercelOidcTokenMock).not.toHaveBeenCalled();
      expect(externalAccountFromJsonMock).not.toHaveBeenCalled();
    });
  });
});
