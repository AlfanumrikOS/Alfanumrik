/**
 * Shared CORS headers for all Alfanumrik Edge Functions.
 * Allows requests from any origin — tighten `Access-Control-Allow-Origin`
 * to your production domain(s) before going live.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/** Wrap a JSON body with CORS + content-type headers. */
export function jsonResponse(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      ...extra,
    },
  });
}

/** Return a structured error response. */
export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}
