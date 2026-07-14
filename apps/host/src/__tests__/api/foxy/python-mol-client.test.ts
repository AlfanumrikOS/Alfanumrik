import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callPythonMol } from '@alfanumrik/lib/ai/clients/python-mol';

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
 */

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ORIGINAL_ENV = process.env.PYTHON_AI_BASE_URL;

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
