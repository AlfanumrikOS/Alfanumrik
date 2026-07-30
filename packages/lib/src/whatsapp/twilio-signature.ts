/**
 * ALFANUMRIK — Twilio Webhook Signature Verification
 *
 * Provider-security invariant for the WhatsApp inbound webhook (P11-adjacent:
 * same "verify before processing" posture as payment-verification.ts).
 *
 * Twilio `X-Twilio-Signature` algorithm (form-encoded POSTs):
 *   1. Start with the FULL public URL exactly as Twilio requested it
 *      (scheme + host + path + query string, query params kept URL-encoded).
 *   2. Sort ALL received POST body params alphabetically by key and append
 *      each `key + value` (decoded values, no separators) to the URL string.
 *   3. HMAC-SHA1 the resulting string with TWILIO_AUTH_TOKEN as the key.
 *   4. Base64-encode and compare against the header, timing-safe.
 *
 * The Twilio param set evolves without notice (ButtonPayload, ReferralCtwaClid,
 * Latitude, ... appear over time) — callers MUST pass every received param, not
 * a whitelist, or validation breaks the day Twilio adds a field.
 *
 * Deliberately dependency-free (node:crypto only) — we do NOT ship the `twilio`
 * npm package; outbound calls go via REST directly.
 *
 * DO NOT duplicate this logic anywhere. Import from here.
 */

import crypto from 'crypto';

export interface TwilioSignatureInput {
  /**
   * The full public webhook URL exactly as configured in the Twilio console,
   * including any query string. Behind Vercel, never derive this from
   * req.url's host — reconstruct from WHATSAPP_WEBHOOK_PUBLIC_URL + the
   * incoming query string.
   */
  url: string;
  /** ALL POST body params as received (decoded key/value pairs). */
  params: Record<string, string>;
  /** The raw `X-Twilio-Signature` header value, or null if absent. */
  signature: string | null;
  /** TWILIO_AUTH_TOKEN — the HMAC key. */
  authToken: string;
}

/** Timing-safe comparison of two raw byte buffers; false on length mismatch. */
function timingSafeBufferEqual(a: Buffer, b: Buffer): boolean {
  try {
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Validate an `X-Twilio-Signature` for a form-encoded webhook POST.
 * Returns false on ANY missing input — never throws.
 */
export function validateTwilioSignature(input: TwilioSignatureInput): boolean {
  const { url, params, signature, authToken } = input;
  if (!url || !signature || !authToken) return false;

  let data = url;
  const keys = Object.keys(params).sort();
  for (const key of keys) {
    data += key + params[key];
  }

  const expected = crypto.createHmac('sha1', authToken).update(data, 'utf8').digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  return timingSafeBufferEqual(expected, provided);
}

export interface TwilioJsonSignatureInput {
  /**
   * The full public URL as requested by Twilio — for JSON-body callbacks this
   * INCLUDES the `bodySHA256` query param Twilio appends.
   */
  url: string;
  /** The exact raw request body string (read once, never re-stringified). */
  rawBody: string;
  /** The raw `X-Twilio-Signature` header value, or null if absent. */
  signature: string | null;
  /** TWILIO_AUTH_TOKEN — the HMAC key. */
  authToken: string;
}

/**
 * Validate a Twilio callback that carries a JSON (non-form) body — e.g. future
 * status callbacks configured with JSON content type.
 *
 * Twilio's `validateRequestWithBody` semantics: the signature covers the URL
 * only (no body params), and body integrity rides on a `bodySHA256` query
 * param that must equal the hex SHA-256 of the raw body.
 *
 * Returns false on any missing input, missing bodySHA256 param, signature
 * mismatch, or body-hash mismatch. Never throws.
 */
export function validateTwilioJsonSignature(input: TwilioJsonSignatureInput): boolean {
  const { url, rawBody, signature, authToken } = input;
  if (!url || !signature || !authToken || rawBody === undefined || rawBody === null) {
    return false;
  }

  // 1. Signature over the URL alone (no form params for JSON bodies).
  if (!validateTwilioSignature({ url, params: {}, signature, authToken })) return false;

  // 2. bodySHA256 query param must match sha256(rawBody).
  let bodySha256: string | null = null;
  try {
    bodySha256 = new URL(url).searchParams.get('bodySHA256');
  } catch {
    return false;
  }
  if (!bodySha256) return false;

  const expectedHex = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');
  return timingSafeBufferEqual(
    Buffer.from(expectedHex, 'utf8'),
    Buffer.from(bodySha256.toLowerCase(), 'utf8'),
  );
}
