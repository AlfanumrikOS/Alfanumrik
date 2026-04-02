import { describe, it, expect } from 'vitest';

/**
 * API Response Helper Tests
 *
 * Verifies consistent response format across all API routes:
 *   Success: { data: T }
 *   Error:   { error: string, code?: string, details?: unknown }
 *
 * Source: src/lib/api-response.ts
 */

import {
  apiSuccess,
  apiError,
  apiBadRequest,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiConflict,
  apiRateLimit,
  apiInternalError,
} from '@/lib/api-response';

// ─── Success Response ────────────────────────────────────────────────────────

describe('apiSuccess', () => {
  it('returns { data: T } wrapper with status 200 by default', async () => {
    const response = apiSuccess({ student_id: 'abc', quizzes: [] });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ data: { student_id: 'abc', quizzes: [] } });
  });

  it('accepts a custom status code', async () => {
    const response = apiSuccess({ created: true }, 201);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ data: { created: true } });
  });

  it('wraps null data correctly', async () => {
    const response = apiSuccess(null);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ data: null });
  });

  it('wraps primitive data correctly', async () => {
    const response = apiSuccess(42);
    const body = await response.json();
    expect(body).toEqual({ data: 42 });
  });

  it('wraps array data correctly', async () => {
    const response = apiSuccess([1, 2, 3]);
    const body = await response.json();
    expect(body).toEqual({ data: [1, 2, 3] });
  });

  it('includes custom headers when provided', () => {
    const response = apiSuccess({ ok: true }, 200, { 'X-Custom': 'value' });
    expect(response.headers.get('X-Custom')).toBe('value');
  });
});

// ─── Error Response ──────────────────────────────────────────────────────────

describe('apiError', () => {
  it('returns { error: string } with status 500 by default', async () => {
    const response = apiError('Something went wrong');
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Something went wrong');
  });

  it('accepts a custom status code', async () => {
    const response = apiError('Not allowed', 403);
    expect(response.status).toBe(403);
  });

  it('includes code when provided', async () => {
    const response = apiError('Bad input', 400, 'VALIDATION_ERROR');
    const body = await response.json();
    expect(body.error).toBe('Bad input');
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('includes details when provided', async () => {
    const response = apiError('Bad input', 400, 'VALIDATION_ERROR', { field: 'grade' });
    const body = await response.json();
    expect(body.details).toEqual({ field: 'grade' });
  });

  it('omits code and details when not provided', async () => {
    const response = apiError('Error');
    const body = await response.json();
    expect(body).toEqual({ error: 'Error' });
    expect(body.code).toBeUndefined();
    expect(body.details).toBeUndefined();
  });
});

// ─── Convenience Error Helpers ───────────────────────────────────────────────

describe('apiBadRequest (400)', () => {
  it('returns 400 with BAD_REQUEST code by default', async () => {
    const response = apiBadRequest('Invalid grade format');
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid grade format');
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('accepts a custom code', async () => {
    const response = apiBadRequest('Invalid', 'GRADE_INVALID');
    const body = await response.json();
    expect(body.code).toBe('GRADE_INVALID');
  });

  it('accepts details', async () => {
    const response = apiBadRequest('Invalid', 'BAD_REQUEST', { fields: ['grade', 'subject'] });
    const body = await response.json();
    expect(body.details).toEqual({ fields: ['grade', 'subject'] });
  });
});

describe('apiUnauthorized (401)', () => {
  it('returns 401 with default message and code', async () => {
    const response = apiUnauthorized();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Authentication required');
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  it('accepts a custom message', async () => {
    const response = apiUnauthorized('Session expired');
    const body = await response.json();
    expect(body.error).toBe('Session expired');
  });
});

describe('apiForbidden (403)', () => {
  it('returns 403 with default message and code', async () => {
    const response = apiForbidden();
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Access denied');
    expect(body.code).toBe('FORBIDDEN');
  });

  it('accepts a custom message', async () => {
    const response = apiForbidden('Teacher access required');
    const body = await response.json();
    expect(body.error).toBe('Teacher access required');
  });
});

describe('apiNotFound (404)', () => {
  it('returns 404 with default message and code', async () => {
    const response = apiNotFound();
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('Resource not found');
    expect(body.code).toBe('NOT_FOUND');
  });

  it('accepts a custom message', async () => {
    const response = apiNotFound('Student not found');
    const body = await response.json();
    expect(body.error).toBe('Student not found');
  });
});

describe('apiConflict (409)', () => {
  it('returns 409 with CONFLICT code by default', async () => {
    const response = apiConflict('Email already registered');
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe('Email already registered');
    expect(body.code).toBe('CONFLICT');
  });
});

describe('apiRateLimit (429)', () => {
  it('returns 429 with default message and code', async () => {
    const response = apiRateLimit();
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe('Too many requests');
    expect(body.code).toBe('RATE_LIMITED');
  });

  it('accepts a custom message', async () => {
    const response = apiRateLimit('Quiz submission rate exceeded');
    const body = await response.json();
    expect(body.error).toBe('Quiz submission rate exceeded');
  });
});

describe('apiInternalError (500)', () => {
  it('returns 500 with generic message (never exposes internals)', async () => {
    const response = apiInternalError();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Internal server error');
    expect(body.code).toBe('INTERNAL_ERROR');
  });

  it('accepts a custom code but message stays generic', async () => {
    const response = apiInternalError('DB_CONNECTION_FAILED');
    const body = await response.json();
    expect(body.error).toBe('Internal server error');
    expect(body.code).toBe('DB_CONNECTION_FAILED');
  });
});

// ─── Response Format Consistency ─────────────────────────────────────────────

describe('Response Format Consistency', () => {
  it('all success responses have Content-Type application/json', () => {
    const response = apiSuccess({ ok: true });
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('all error responses have Content-Type application/json', () => {
    const response = apiError('fail', 500);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('success responses never have an error field', async () => {
    const body = await apiSuccess({ result: 'ok' }).json();
    expect(body.error).toBeUndefined();
  });

  it('error responses never have a data field', async () => {
    const body = await apiError('fail').json();
    expect(body.data).toBeUndefined();
  });
});
