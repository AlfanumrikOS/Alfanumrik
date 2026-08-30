/**
 * POST /api/auth/pre-check — rate-limit gate for login/signup/forgot, added
 * 2026-08-30 because AuthScreen.tsx calls Supabase directly from the browser
 * for all three flows, bypassing every app-level rate limiter. See the
 * route's own header comment for the full rationale and the per-action
 * limits pinned below.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { mockRateLimit } = vi.hoisted(() => ({ mockRateLimit: vi.fn() }));
vi.mock('@alfanumrik/lib/api-rate-limit', () => ({
  checkApiRateLimit: (...a: unknown[]) => mockRateLimit(...a),
}));

import { POST } from '@/app/api/auth/pre-check/route';

function makeRequest(body: unknown, ip = '203.0.113.7'): NextRequest {
  return new NextRequest('http://localhost/api/auth/pre-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function allow() {
  mockRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Math.ceil(Date.now() / 1000) + 300 });
}

beforeEach(() => {
  mockRateLimit.mockReset();
  allow();
});

describe('POST /api/auth/pre-check — validation', () => {
  it('rejects an unknown action', async () => {
    const res = await POST(makeRequest({ action: 'delete-everything', email: 'a@b.com' }));
    expect(res.status).toBe(400);
  });

  it('rejects a missing email', async () => {
    const res = await POST(makeRequest({ action: 'login' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/pre-check — login (IP 20/5min, email 10/15min)', () => {
  it('allows by default', async () => {
    const res = await POST(makeRequest({ action: 'login', email: 'student@test.example' }));
    expect(res.status).toBe(200);
    expect((await res.json()).allowed).toBe(true);
  });

  it('returns 429 with Retry-After when the per-IP limiter denies', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Math.ceil(Date.now() / 1000) + 90 });
    const res = await POST(makeRequest({ action: 'login', email: 'student@test.example' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('90');
    expect(mockRateLimit).toHaveBeenCalledTimes(1); // short-circuits before the email check
  });

  it('returns 429 when the per-IP limiter allows but the per-email limiter denies', async () => {
    mockRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 5, resetAt: 0 }) // ip
      .mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Math.ceil(Date.now() / 1000) + 60 }); // email
    const res = await POST(makeRequest({ action: 'login', email: 'student@test.example' }));
    expect(res.status).toBe(429);
    expect(mockRateLimit).toHaveBeenCalledTimes(2);
  });

  it('keys the IP and email limiters distinctly and case-insensitively on email', async () => {
    await POST(makeRequest({ action: 'login', email: 'Student@Test.example' }, '198.51.100.9'));
    expect(mockRateLimit).toHaveBeenNthCalledWith(1, 'auth-pre-check:login:ip:198.51.100.9', 20, 5 * 60 * 1000);
    expect(mockRateLimit).toHaveBeenNthCalledWith(2, 'auth-pre-check:login:email:student@test.example', 10, 15 * 60 * 1000);
  });
});

describe('POST /api/auth/pre-check — signup (IP 10/5min only, no email limiter)', () => {
  it('allows by default and only checks the IP limiter', async () => {
    const res = await POST(makeRequest({ action: 'signup', email: 'new@test.example' }));
    expect(res.status).toBe(200);
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(mockRateLimit).toHaveBeenCalledWith('auth-pre-check:signup:ip:203.0.113.7', 10, 5 * 60 * 1000);
  });

  it('returns 429 when the IP limiter denies', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Math.ceil(Date.now() / 1000) + 30 });
    const res = await POST(makeRequest({ action: 'signup', email: 'new@test.example' }));
    expect(res.status).toBe(429);
  });
});

describe('POST /api/auth/pre-check — forgot (IP 10/5min, email 5/15min)', () => {
  it('keys both limiters at the tighter forgot-password limits', async () => {
    await POST(makeRequest({ action: 'forgot', email: 'victim@test.example' }));
    expect(mockRateLimit).toHaveBeenNthCalledWith(1, 'auth-pre-check:forgot:ip:203.0.113.7', 10, 5 * 60 * 1000);
    expect(mockRateLimit).toHaveBeenNthCalledWith(2, 'auth-pre-check:forgot:email:victim@test.example', 5, 15 * 60 * 1000);
  });

  it('returns 429 when the per-email limiter denies (email-bombing guard)', async () => {
    mockRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 5, resetAt: 0 })
      .mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Math.ceil(Date.now() / 1000) + 120 });
    const res = await POST(makeRequest({ action: 'forgot', email: 'victim@test.example' }));
    expect(res.status).toBe(429);
  });
});

describe('POST /api/auth/pre-check — fail open', () => {
  it('allows the request when the rate limiter throws', async () => {
    mockRateLimit.mockRejectedValueOnce(new Error('redis unreachable'));
    const res = await POST(makeRequest({ action: 'login', email: 'student@test.example' }));
    expect(res.status).toBe(200);
    expect((await res.json()).allowed).toBe(true);
  });

  it('allows the request when the body is malformed JSON', async () => {
    const res = await POST(makeRequest('not-json{{'));
    expect(res.status).toBe(400); // no email parsed -> validation error, not a crash
  });
});
