/**
 * request-timing.ts — unit tests.
 *
 * src/lib/request-timing.ts wraps Next.js route handlers with timing,
 * structured logging, and Server-Timing headers. Tests cover:
 *   - withTiming forwards request/context to handler and returns response
 *   - Server-Timing header is set with handler;dur=<ms>
 *   - logger.warn fires when duration > slowThresholdMs
 *   - logger.debug fires when duration <= slowThresholdMs
 *   - thrown errors return 500 + log via logger.error
 *   - measureAsync returns { result, durationMs } and warns when slow
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// vi.hoisted lets the mock factory close over a value defined inside the
// test module (vi.mock is hoisted to the top, so plain top-level consts
// are TDZ'd at mock-time). Using vi.fn() inside hoisted() so the mock
// records calls and we can assert on them.
const { loggerMock } = vi.hoisted(() => {
  return {
    loggerMock: {
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
  };
});

vi.mock('@/lib/logger', () => ({ logger: loggerMock }));

// Pin the SLO constant so the threshold is deterministic.
vi.mock('@/lib/slo', () => ({
  SLOW_REQUEST_THRESHOLD_MS: 1_000,
}));

import { withTiming, measureAsync } from '@/lib/request-timing';

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(url = 'https://example.com/api/test') {
  return new NextRequest(url, { method: 'GET' });
}

describe('withTiming', () => {
  it('forwards the request to the handler and returns the response', async () => {
    const handler = vi.fn(async () =>
      NextResponse.json({ ok: true }, { status: 200 }),
    );
    const wrapped = withTiming(handler, 'GET /api/test');

    const req = makeRequest();
    const res = await wrapped(req);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('sets the Server-Timing response header', async () => {
    const handler = async () => NextResponse.json({ ok: true });
    const wrapped = withTiming(handler, 'GET /api/test');
    const res = await wrapped(makeRequest());
    const header = res.headers.get('Server-Timing');
    expect(header).toMatch(/^handler;dur=\d+$/);
  });

  it('logs at debug level for fast requests (duration <= threshold)', async () => {
    const handler = async () => NextResponse.json({ ok: true });
    const wrapped = withTiming(handler, 'GET /api/test', 5_000);
    await wrapped(makeRequest());

    expect(loggerMock.debug).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).not.toHaveBeenCalled();
    const args = loggerMock.debug.mock.calls[0];
    expect(args[0]).toBe('Request completed');
    expect(args[1]).toMatchObject({ label: 'GET /api/test', status: 200 });
  });

  it('logs at warn level for slow requests (duration > threshold)', async () => {
    // Force the handler to "take" longer than the threshold by stubbing
    // performance.now in a way that returns ascending fake values.
    const nowSpy = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(1000) // start
      .mockReturnValueOnce(3500); // end (2500 ms elapsed)

    const handler = async () => NextResponse.json({ ok: true });
    const wrapped = withTiming(handler, 'GET /api/slow', 1_000);
    await wrapped(makeRequest('https://example.com/api/slow'));

    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    const args = loggerMock.warn.mock.calls[0];
    expect(args[0]).toBe('Slow request detected');
    expect(args[1]).toMatchObject({
      label: 'GET /api/slow',
      durationMs: 2500,
      thresholdMs: 1000,
      status: 200,
    });
    nowSpy.mockRestore();
  });

  it('returns a 500 JSON response and logs error when handler throws', async () => {
    const boom = new Error('handler exploded');
    const handler = async () => {
      throw boom;
    };
    const wrapped = withTiming(handler, 'GET /api/boom');
    const res = await wrapped(makeRequest());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Internal server error' });
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
    const args = loggerMock.error.mock.calls[0];
    expect(args[0]).toBe('Request failed');
    expect(args[1].label).toBe('GET /api/boom');
    expect(args[1].error).toBeInstanceOf(Error);
  });

  it('wraps non-Error throws into Error before logging', async () => {
    const handler = async () => {
      throw 'string-throw';
    };
    const wrapped = withTiming(handler, 'GET /api/string-boom');
    const res = await wrapped(makeRequest());
    expect(res.status).toBe(500);
    const args = loggerMock.error.mock.calls[0];
    expect(args[1].error).toBeInstanceOf(Error);
    expect(args[1].error.message).toBe('string-throw');
  });

  it('passes the optional context (params) through to the handler', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withTiming(handler, 'GET /api/[id]');
    const ctx = { params: { id: '42' } };
    await wrapped(makeRequest(), ctx);
    expect(handler).toHaveBeenCalledWith(expect.any(NextRequest), ctx);
  });
});

describe('measureAsync', () => {
  it('returns the result and the elapsed duration', async () => {
    const out = await measureAsync('quick-task', async () => 'value');
    expect(out.result).toBe('value');
    expect(typeof out.durationMs).toBe('number');
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('logs warn when duration exceeds the threshold', async () => {
    const nowSpy = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(2_500);
    const out = await measureAsync('slow-task', async () => 42, 1_000);
    expect(out.result).toBe(42);
    expect(out.durationMs).toBe(2_500);
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn.mock.calls[0][0]).toBe('Slow operation');
    nowSpy.mockRestore();
  });

  it('does not warn when duration is under the threshold', async () => {
    const nowSpy = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(50);
    await measureAsync('fast-task', async () => 'ok', 1_000);
    expect(loggerMock.warn).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });
});
