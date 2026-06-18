import { getCorsHeaders, jsonResponse as baseJsonResponse } from '../cors.ts';

export function securityCorsHeaders(requestOrigin?: string | null): Record<string, string> {
  return getCorsHeaders(requestOrigin);
}

export function securityJsonResponse(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
  requestOrigin?: string | null,
): Response {
  return baseJsonResponse(body, status, extra, requestOrigin);
}

export function securityErrorResponse(
  code: string,
  message: string,
  status = 400,
  requestOrigin?: string | null,
  requestId?: string,
  extra: Record<string, unknown> = {},
): Response {
  return securityJsonResponse(
    { error: code, message, request_id: requestId ?? null, ...extra },
    status,
    {},
    requestOrigin,
  );
}

