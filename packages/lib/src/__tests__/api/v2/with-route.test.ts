/**
 * Unit tests for withRoute() — /v2 API route error-safety wrapper.
 *
 * P2-2 (API response-envelope consolidation). Pins:
 *   - happy path is a true pass-through: a handler's returned NextResponse
 *     (success OR a deliberate non-200 v2Error) comes back unchanged — same
 *     reference, status, body, headers. Never rewrapped/double-wrapped.
 *   - error path: an unhandled throw ALWAYS becomes the fixed generic
 *     `v2Error('Internal server error', 500, 'INTERNAL_ERROR')` envelope —
 *     the caught error's message/stack is NEVER serialized into the response
 *     body (P13 no-leak), regardless of whether the thrown value is an Error
 *     or something else.
 *   - x-request-id: echoed verbatim if the incoming request carries one,
 *     otherwise generated — attached ONLY on the error path.
 *   - logger.error is invoked (with full detail, server-side only) on the
 *     error path and never on the happy path (success OR handled non-200).
 *   - ctx.params (a Promise, Next 16 shape) is forwarded to the handler
 *     completely untouched — same Promise reference.
 *   - opts.onError, when supplied, receives the raw caught value on the
 *     error path and is never invoked on the happy path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, type NextResponse } from 'next/server';

const mockLoggerError = vi.fn();
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
    debug: vi.fn(),
  },
}));

import { withRoute, type RouteContext, type RouteHandler } from '@alfanumrik/lib/api/v2/with-route';
import { v2Success, v2Error } from '@alfanumrik/lib/api/v2/envelope';

const SENTINEL = 'DO-NOT-LEAK-internal-error-detail-9f3c2a71';

function req(url = 'http://localhost/api/v2/test', headers?: Record<string, string>): NextRequest {
  return new NextRequest(url, { headers });
}

function ctx<T extends Record<string, string> = Record<string, string>>(
  params: T = {} as T,
): RouteContext<T> {
  return { params: Promise.resolve(params) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('withRoute — happy path pass-through', () => {
  it("returns the handler's success NextResponse UNCHANGED (same reference, status, body, headers)", async () => {
    const response = v2Success({ x: 1 }, { headers: { 'x-custom': 'yes' } });
    const handler: RouteHandler = vi.fn(async () => response);
    const res = await withRoute(handler)(req(), ctx());

    // Not rebuilt/rewrapped — the exact same NextResponse instance comes back.
    expect(res).toBe(response);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { x: 1 } });
    expect(res.headers.get('x-custom')).toBe('yes');
    // Never mutated: withRoute must not inject an x-request-id on the happy path.
    expect(res.headers.has('x-request-id')).toBe(false);
  });

  it('passes through a deliberate non-200 v2Error UNCHANGED — a 4xx is not converted to a 500', async () => {
    const response = v2Error('Not found', 404, 'NOT_FOUND');
    const handler: RouteHandler = vi.fn(async () => response);
    const res = await withRoute(handler)(req(), ctx());

    expect(res).toBe(response);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    expect(res.headers.has('x-request-id')).toBe(false);
  });

  it('never calls logger.error when the handler resolves with a success response', async () => {
    const handler: RouteHandler = vi.fn(async () => v2Success({ ok: true }));
    await withRoute(handler)(req(), ctx());
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('never calls logger.error when the handler resolves with a handled (non-thrown) error response', async () => {
    const handler: RouteHandler = vi.fn(async () => v2Error('Bad input', 400, 'VALIDATION_ERROR'));
    await withRoute(handler)(req(), ctx());
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('never calls opts.onError on the happy path', async () => {
    const onError = vi.fn();
    const handler: RouteHandler = vi.fn(async () => v2Success({ ok: true }));
    await withRoute(handler, { onError })(req(), ctx());
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('withRoute — error path (unhandled throw)', () => {
  it('returns exactly the fixed generic 500 envelope on an unhandled throw', async () => {
    const handler: RouteHandler = vi.fn(async () => {
      throw new Error(SENTINEL);
    });
    const res = await withRoute(handler)(req(), ctx());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  });

  it('NEVER leaks the thrown Error message/stack into the response body (P13)', async () => {
    const handler: RouteHandler = vi.fn(async () => {
      throw new Error(SENTINEL, { cause: 'also-secret-cause-detail' });
    });
    const res = await withRoute(handler)(req(), ctx());
    const rawBody = JSON.stringify(await res.json());

    expect(rawBody).not.toContain(SENTINEL);
    expect(rawBody).not.toContain('also-secret-cause-detail');
    expect(rawBody).not.toContain('.ts:'); // no stack-trace fragment either
  });

  it('NEVER leaks a thrown non-Error value into the response body either', async () => {
    const handler: RouteHandler = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw SENTINEL; // bare string, not an Error instance
    });
    const res = await withRoute(handler)(req(), ctx());
    const rawBody = JSON.stringify(await res.json());

    expect(res.status).toBe(500);
    expect(rawBody).not.toContain(SENTINEL);
  });

  it('attaches a generated x-request-id header when the incoming request carries none', async () => {
    const handler: RouteHandler = vi.fn(async () => {
      throw new Error('boom');
    });
    const res = await withRoute(handler)(req(), ctx());
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('echoes the incoming x-request-id header VERBATIM on the error path', async () => {
    const REQUEST_ID = 'caller-supplied-request-id-abc123';
    const handler: RouteHandler = vi.fn(async () => {
      throw new Error('boom');
    });
    const res = await withRoute(handler)(
      req('http://localhost/api/v2/whatever', { 'x-request-id': REQUEST_ID }),
      ctx(),
    );
    expect(res.headers.get('x-request-id')).toBe(REQUEST_ID);
  });

  it('calls logger.error exactly once with full detail (message, requestId, method, path, real Error)', async () => {
    const err = new Error(SENTINEL);
    const handler: RouteHandler = vi.fn(async () => {
      throw err;
    });
    await withRoute(handler)(req('http://localhost/api/v2/whatever'), ctx());

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    const [message, meta] = mockLoggerError.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toBe('Unhandled /v2 route error');
    expect(meta.error).toBe(err); // the REAL Error object reaches the logger, unredacted here
    expect(meta.method).toBe('GET');
    expect(meta.path).toBe('/api/v2/whatever');
    expect(typeof meta.requestId).toBe('string');
    expect((meta.requestId as string).length).toBeGreaterThan(0);
  });

  it('wraps a thrown non-Error value in a real Error before logging it', async () => {
    const handler: RouteHandler = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw SENTINEL;
    });
    await withRoute(handler)(req(), ctx());

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    const [, meta] = mockLoggerError.mock.calls[0] as [string, Record<string, unknown>];
    expect(meta.error).toBeInstanceOf(Error);
    expect((meta.error as Error).message).toBe(SENTINEL);
  });

  it('invokes opts.onError with the raw caught error on the error path', async () => {
    const onError = vi.fn();
    const err = new Error(SENTINEL);
    const handler: RouteHandler = vi.fn(async () => {
      throw err;
    });
    await withRoute(handler, { onError })(req(), ctx());

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('invokes opts.onError with the raw thrown value even when it is not an Error', async () => {
    const onError = vi.fn();
    const handler: RouteHandler = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw SENTINEL;
    });
    await withRoute(handler, { onError })(req(), ctx());

    expect(onError).toHaveBeenCalledWith(SENTINEL);
  });

  it('still returns the generic 500 envelope when no opts are supplied at all', async () => {
    const handler: RouteHandler = vi.fn(async () => {
      throw new Error(SENTINEL);
    });
    const res = await withRoute(handler)(req(), ctx()); // no opts arg
    expect(res.status).toBe(500);
  });
});

describe('withRoute — ctx.params passthrough (Next 16 shape)', () => {
  it('forwards the exact ctx.params Promise reference to the handler, untouched', async () => {
    const paramsPromise = Promise.resolve({ id: 'abc-123' });
    const handler: RouteHandler<{ id: string }> = vi.fn(async (_request, context) => {
      // Same Promise INSTANCE — withRoute never reads or re-wraps params itself.
      expect(context.params).toBe(paramsPromise);
      const resolved = await context.params;
      return v2Success(resolved) as NextResponse;
    });
    const res = await withRoute(handler)(req(), { params: paramsPromise });

    expect(await res.json()).toEqual({ success: true, data: { id: 'abc-123' } });
  });

  it('forwards an empty-object params Promise for static (non-dynamic) routes', async () => {
    const handler: RouteHandler = vi.fn(async (_request, context) => {
      await expect(context.params).resolves.toEqual({});
      return v2Success({ ok: true });
    });
    await withRoute(handler)(req(), ctx({}));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
