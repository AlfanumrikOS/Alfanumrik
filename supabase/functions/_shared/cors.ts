/**
 * Shared CORS headers for all Alfanumrik Edge Functions.
 * Restricts origins to known production & preview domains.
 */

const ALLOWED_ORIGINS = [
  'https://alfanumrik.com',
  'https://www.alfanumrik.com',
  'https://alfanumrik.vercel.app',
  'https://alfanumrik-ten.vercel.app',
];

// Allow localhost in development
if (Deno.env.get('ENVIRONMENT') !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:3000', 'http://localhost:3001');
}

/** Build CORS headers, validating the request origin. */
export function getCorsHeaders(requestOrigin?: string | null): Record<string, string> {
  // Check exact match first, then allow Alfanumrik Vercel preview deployments
  const isAllowed = requestOrigin && (
    ALLOWED_ORIGINS.includes(requestOrigin) ||
    // Allow Vercel preview deployments for this project only
    (requestOrigin.endsWith('.vercel.app') && (
      requestOrigin.includes('alfanumrik') ||
      requestOrigin.includes('alfanumrik-') ||
      // Vercel preview format: {project}-{hash}-{team}.vercel.app
      requestOrigin.match(/^https:\/\/alfanumrik[a-z0-9-]*\.vercel\.app$/) !== null
    ))
  );
  const origin = isAllowed ? requestOrigin : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-request-id, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

/** Backwards-compatible static headers (uses first allowed origin). */
export const corsHeaders: Record<string, string> = getCorsHeaders(ALLOWED_ORIGINS[0]);

/** Wrap a JSON body with CORS + content-type headers. */
export function jsonResponse(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
  requestOrigin?: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(requestOrigin),
      'Content-Type': 'application/json',
      ...extra,
    },
  });
}

/** Return a structured error response. */
export function errorResponse(message: string, status = 400, requestOrigin?: string | null): Response {
  return jsonResponse({ error: message }, status, {}, requestOrigin);
}
