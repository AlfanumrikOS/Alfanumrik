/**
 * buildClaimUrl() — Track A claim-token DELIVERY (DELTA).
 *
 * Pins the URL builder added to src/lib/school-provisioning.ts that turns a RAW
 * one-time admin claim token into the fully-formed claim URL embedded in the
 * principal's email (the sole delivery channel for the raw token — P13).
 *
 * Contract:
 *   - targets the canonical app host (apex, NOT the school subdomain — wildcard
 *     subdomain TLS must never block the claim screen);
 *   - the raw token is URL-encoded so a base64url value (which can contain `-`
 *     and `_`, both URL-safe, but the encoder must still be applied) survives
 *     query-string transport intact;
 *   - reserved characters that could break the query string (`+`, `/`, `=`,
 *     `&`, space) are percent-encoded;
 *   - the host is overridable via NEXT_PUBLIC_APP_URL (non-prod) with a trailing
 *     slash stripped so the path is never doubled.
 *
 * Pure unit test — no Supabase, no email, no DB. We only manipulate env.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

// Import after a clean module state so the helper reads process.env at call time
// (buildClaimUrl reads env inside appHost() on every call — no module-load cache).
import { buildClaimUrl } from '@/lib/school-provisioning';

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL;
});

afterEach(() => {
  if (ORIGINAL_APP_URL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
});

describe('buildClaimUrl — canonical host + token encoding', () => {
  it('targets the apex host by default and embeds the raw token in the token query param', () => {
    const url = buildClaimUrl('abc123');
    expect(url).toBe('https://alfanumrik.com/school-admin/claim?token=abc123');
  });

  it('uses the /school-admin/claim path (not a subdomain)', () => {
    const url = buildClaimUrl('tok');
    const parsed = new URL(url);
    expect(parsed.hostname).toBe('alfanumrik.com');
    expect(parsed.pathname).toBe('/school-admin/claim');
    expect(parsed.searchParams.get('token')).toBe('tok');
  });

  it('URL-encodes a base64url token safely and round-trips it intact', () => {
    // A realistic 24-byte base64url token: only A–Z a–z 0–9 - _ (all URL-safe),
    // but the encoder must still be applied so the contract is explicit.
    const raw = 'Xy9-_AbCdEf0123456789-_zZ';
    const url = buildClaimUrl(raw);
    const parsed = new URL(url);
    // The decoded token must exactly equal the raw token — no corruption.
    expect(parsed.searchParams.get('token')).toBe(raw);
  });

  it('percent-encodes query-breaking characters (+ / = & and space)', () => {
    // base64 (non-url-safe) can contain + / = ; these MUST be encoded so they do
    // not terminate or split the query string.
    const raw = 'a+b/c=d&e f';
    const url = buildClaimUrl(raw);
    // Raw reserved chars must not appear unencoded after the `token=` marker.
    const queryPart = url.split('token=')[1];
    expect(queryPart).not.toContain('+');
    expect(queryPart).not.toContain('/');
    expect(queryPart).not.toContain('=');
    expect(queryPart).not.toContain('&');
    expect(queryPart).not.toContain(' ');
    // And it still round-trips back to the exact raw token.
    expect(new URL(url).searchParams.get('token')).toBe(raw);
  });

  it('honours NEXT_PUBLIC_APP_URL for non-prod hosts', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.alfanumrik.dev';
    const url = buildClaimUrl('tok');
    expect(url).toBe('https://staging.alfanumrik.dev/school-admin/claim?token=tok');
  });

  it('strips a trailing slash on NEXT_PUBLIC_APP_URL so the path is never doubled', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.alfanumrik.dev/';
    const url = buildClaimUrl('tok');
    expect(url).toBe('https://staging.alfanumrik.dev/school-admin/claim?token=tok');
    expect(url).not.toContain('.dev//school-admin');
  });
});
