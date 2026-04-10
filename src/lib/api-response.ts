/**
 * ALFANUMRIK -- Standardized API Response Helpers
 *
 * Ensures consistent response format across all API routes:
 *   Success: { data: T }
 *   Error:   { error: string, code?: string, details?: unknown }
 *
 * Usage:
 *   import { apiSuccess, apiError, apiBadRequest, apiNotFound } from '@/lib/api-response';
 *
 *   return apiSuccess({ student_id: '...', quizzes: [] });
 *   return apiBadRequest('Invalid grade format');
 *   return apiNotFound('Student not found');
 *   return apiError('Internal server error', 500, 'INTERNAL_ERROR');
 */

import { NextResponse } from 'next/server';

interface ApiSuccessResponse<T> {
  data: T;
}

interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

/**
 * Return a successful JSON response with consistent { data: T } wrapper.
 */
export function apiSuccess<T>(data: T, status = 200, headers?: Record<string, string>): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json({ data }, { status, headers });
}

/**
 * Return an error JSON response with consistent structure.
 */
export function apiError(
  message: string,
  status = 500,
  code?: string,
  details?: unknown,
): NextResponse<ApiErrorResponse> {
  const body: ApiErrorResponse = { error: message };
  if (code) body.code = code;
  if (details !== undefined) body.details = details;
  return NextResponse.json(body, { status });
}

/**
 * 400 Bad Request -- invalid input from the client.
 */
export function apiBadRequest(message: string, code = 'BAD_REQUEST', details?: unknown): NextResponse<ApiErrorResponse> {
  return apiError(message, 400, code, details);
}

/**
 * 401 Unauthorized -- authentication required.
 */
export function apiUnauthorized(message = 'Authentication required', code = 'AUTH_REQUIRED'): NextResponse<ApiErrorResponse> {
  return apiError(message, 401, code);
}

/**
 * 403 Forbidden -- authenticated but not allowed.
 */
export function apiForbidden(message = 'Access denied', code = 'FORBIDDEN'): NextResponse<ApiErrorResponse> {
  return apiError(message, 403, code);
}

/**
 * 404 Not Found.
 */
export function apiNotFound(message = 'Resource not found', code = 'NOT_FOUND'): NextResponse<ApiErrorResponse> {
  return apiError(message, 404, code);
}

/**
 * 409 Conflict -- resource already exists.
 */
export function apiConflict(message: string, code = 'CONFLICT'): NextResponse<ApiErrorResponse> {
  return apiError(message, 409, code);
}

/**
 * 429 Too Many Requests.
 */
export function apiRateLimit(message = 'Too many requests', code = 'RATE_LIMITED'): NextResponse<ApiErrorResponse> {
  return apiError(message, 429, code);
}

/**
 * 500 Internal Server Error -- catch-all for unexpected failures.
 * NEVER expose internal error details to clients in production.
 */
export function apiInternalError(code = 'INTERNAL_ERROR'): NextResponse<ApiErrorResponse> {
  return apiError('Internal server error', 500, code);
}
