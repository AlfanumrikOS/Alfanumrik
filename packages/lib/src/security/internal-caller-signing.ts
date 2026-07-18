/**
 * Node.js implementation of the internal caller signing protocol used by the
 * Platform Security Layer. Mirrors supabase/functions/_shared/security/request-signature.ts.
 *
 * Used by Next.js API routes that call Supabase Edge Functions as internal service callers.
 *
 * Encoding note: the Deno verifier (`verifyInternalRequestSignature`) uses base64url
 * (URL-safe base64, no padding — replaces `+` with `-`, `/` with `_`, strips trailing `=`).
 * This module produces the same encoding so signatures round-trip correctly.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';

export function generateInternalRequestId(): string {
  return randomUUID();
}

export function currentTimestampSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

export function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Canonicalize a request path so the signer (Vercel/Node) and the verifier
 * (Supabase Edge/Deno) always HMAC over the SAME string, regardless of whether
 * the platform strips the gateway prefix.
 *
 * On a DEPLOYED edge function Supabase strips the `/functions/v1` prefix, so the
 * verifier sees `/alfabot-answer` while the Node signer hardcodes the full
 * gateway path `/functions/v1/alfabot-answer`. Applying this normalization on
 * BOTH sides converges every environment onto the bare function path:
 *   - deployed edge:   `/alfabot-answer`                 -> `/alfabot-answer`
 *   - local / tests:   `/functions/v1/alfabot-answer`    -> `/alfabot-answer`
 *
 * The transform is total and idempotent, so it is safe to apply centrally.
 */
export function canonicalizeInternalPath(path: string): string {
  // Drop any query string / hash fragment before signing.
  let p = path.split('#')[0].split('?')[0];
  // Remove a single leading `/functions/v1` gateway segment if present.
  // The `(?=\/)` lookahead requires the next char to be `/`, so paths like
  // `/functions/v1foo` are left untouched.
  p = p.replace(/^\/functions\/v1(?=\/)/, '');
  // Guarantee the canonical path still starts with a slash.
  if (!p.startsWith('/')) p = `/${p}`;
  return p;
}

export function buildCanonicalInternalRequest(args: {
  method: string;
  path: string;
  requestId: string;
  timestamp: string;
  bodyHash: string;
  caller: string;
}): string {
  return [
    args.method.toUpperCase(),
    canonicalizeInternalPath(args.path),
    args.requestId,
    args.timestamp,
    args.bodyHash,
    args.caller,
  ].join('\n');
}

/**
 * Sign the canonical request string with HMAC-SHA256 and return the result as
 * base64url (URL-safe base64, no padding) to match the Deno verifier in
 * supabase/functions/_shared/security/request-signature.ts.
 */
export function signInternalRequest(secret: string, canonical: string): string {
  const raw = createHmac('sha256', secret).update(canonical, 'utf8').digest('base64');
  // Convert standard base64 → base64url: replace + with -, / with _, strip =
  return raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build the full set of internal caller headers for a Next.js → Edge Function call.
 *
 * @param method  HTTP method (e.g., 'POST')
 * @param path    URL path (e.g., '/functions/v1/alfabot-answer')
 * @param body    Serialized JSON body string
 * @param caller  Internal caller name as registered in security_internal_callers
 * @returns headers to merge into the fetch call, or null if INTERNAL_CALLER_SIGNING_SECRET is not set
 */
export function buildInternalCallerHeaders(
  method: string,
  path: string,
  body: string,
  caller: string,
): Record<string, string> | null {
  const secret = process.env.INTERNAL_CALLER_SIGNING_SECRET;
  if (!secret) {
    // Return null so callers can decide whether to proceed without signing.
    // The Edge Function will reject unsigned internal calls once the security
    // layer is enforcing, so this must be set in production.
    return null;
  }

  const requestId = generateInternalRequestId();
  const timestamp = currentTimestampSeconds();
  const bodyHash = sha256Hex(body);
  const canonical = buildCanonicalInternalRequest({ method, path, requestId, timestamp, bodyHash, caller });
  const signature = signInternalRequest(secret, canonical);

  return {
    'x-request-id': requestId,
    'x-internal-caller': caller,
    'x-internal-timestamp': timestamp,
    'x-internal-signature': signature,
  };
}
