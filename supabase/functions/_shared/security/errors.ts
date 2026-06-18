import { securityErrorResponse } from './cors.ts';

export function buildSecurityError(
  code: string,
  message: string,
  status = 400,
  requestOrigin?: string | null,
  requestId?: string,
  extra: Record<string, unknown> = {},
): Response {
  return securityErrorResponse(code, message, status, requestOrigin, requestId, extra);
}

