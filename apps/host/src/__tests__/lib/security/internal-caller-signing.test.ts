import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCanonicalInternalRequest,
  buildInternalCallerHeaders,
  sha256Hex,
  signInternalRequest,
} from '@alfanumrik/lib/security/internal-caller-signing';

// ── Env-var isolation helpers ────────────────────────────────────────────────

let savedSecret: string | undefined;

beforeEach(() => {
  savedSecret = process.env.INTERNAL_CALLER_SIGNING_SECRET;
});

afterEach(() => {
  if (savedSecret === undefined) {
    delete process.env.INTERNAL_CALLER_SIGNING_SECRET;
  } else {
    process.env.INTERNAL_CALLER_SIGNING_SECRET = savedSecret;
  }
});

// ── sha256Hex ────────────────────────────────────────────────────────────────

describe('sha256Hex', () => {
  it('produces a 64-char hex string', () => {
    const result = sha256Hex('hello world');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the reference Node.js crypto digest', () => {
    const input = 'test-body-content';
    const expected = createHash('sha256').update(input, 'utf8').digest('hex');
    expect(sha256Hex(input)).toBe(expected);
  });

  it('produces different hashes for different inputs', () => {
    expect(sha256Hex('abc')).not.toBe(sha256Hex('def'));
  });
});

// ── buildCanonicalInternalRequest ────────────────────────────────────────────

describe('buildCanonicalInternalRequest', () => {
  it('joins fields with newlines in the correct order', () => {
    const args = {
      method: 'post',
      path: '/functions/v1/alfabot-answer',
      requestId: 'req-123',
      timestamp: '1718800000',
      bodyHash: 'abc123',
      caller: 'alfabot-next',
    };

    const result = buildCanonicalInternalRequest(args);

    const parts = result.split('\n');
    expect(parts).toHaveLength(6);
    // method is uppercased
    expect(parts[0]).toBe('POST');
    expect(parts[1]).toBe('/functions/v1/alfabot-answer');
    expect(parts[2]).toBe('req-123');
    expect(parts[3]).toBe('1718800000');
    expect(parts[4]).toBe('abc123');
    expect(parts[5]).toBe('alfabot-next');
  });

  it('uppercases the method regardless of input case', () => {
    const result = buildCanonicalInternalRequest({
      method: 'get',
      path: '/test',
      requestId: 'r',
      timestamp: '0',
      bodyHash: 'h',
      caller: 'c',
    });
    expect(result.startsWith('GET\n')).toBe(true);
  });
});

// ── signInternalRequest ──────────────────────────────────────────────────────

describe('signInternalRequest', () => {
  const SECRET = 'super-secret-key';
  const CANONICAL = 'POST\n/functions/v1/ncert-solver\nreq-abc\n1718800000\nhash123\nncert-next';

  it('produces base64url output (no padding, URL-safe chars)', () => {
    const sig = signInternalRequest(SECRET, CANONICAL);
    // base64url must not contain standard base64 characters +, /, or padding =
    expect(sig).not.toMatch(/[+/=]/);
    // Must only contain URL-safe base64url characters
    expect(sig).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('is deterministic for the same inputs', () => {
    const sig1 = signInternalRequest(SECRET, CANONICAL);
    const sig2 = signInternalRequest(SECRET, CANONICAL);
    expect(sig1).toBe(sig2);
  });

  it('matches independently computed HMAC-SHA256 base64url', () => {
    const rawB64 = createHmac('sha256', SECRET).update(CANONICAL, 'utf8').digest('base64');
    const expectedBase64url = rawB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(signInternalRequest(SECRET, CANONICAL)).toBe(expectedBase64url);
  });

  it('produces different output for different secrets', () => {
    expect(signInternalRequest('key-a', CANONICAL)).not.toBe(signInternalRequest('key-b', CANONICAL));
  });

  it('produces different output for different canonical strings', () => {
    const otherCanonical = 'POST\n/functions/v1/other\nreq-xyz\n1718800001\nhash456\ncaller';
    expect(signInternalRequest(SECRET, CANONICAL)).not.toBe(signInternalRequest(SECRET, otherCanonical));
  });
});

// ── buildInternalCallerHeaders ───────────────────────────────────────────────

describe('buildInternalCallerHeaders', () => {
  it('returns null when INTERNAL_CALLER_SIGNING_SECRET is not set', () => {
    delete process.env.INTERNAL_CALLER_SIGNING_SECRET;
    const result = buildInternalCallerHeaders('POST', '/functions/v1/alfabot-answer', '{"a":1}', 'alfabot-next');
    expect(result).toBeNull();
  });

  it('returns all four required headers when secret is set', () => {
    process.env.INTERNAL_CALLER_SIGNING_SECRET = 'test-secret';
    const result = buildInternalCallerHeaders(
      'POST',
      '/functions/v1/alfabot-answer',
      '{"message":"hello"}',
      'alfabot-next',
    );
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('x-request-id');
    expect(result).toHaveProperty('x-internal-caller');
    expect(result).toHaveProperty('x-internal-timestamp');
    expect(result).toHaveProperty('x-internal-signature');
  });

  it('sets x-internal-caller to the provided caller value', () => {
    process.env.INTERNAL_CALLER_SIGNING_SECRET = 'test-secret';
    const result = buildInternalCallerHeaders('POST', '/path', '{}', 'ncert-next');
    expect(result?.['x-internal-caller']).toBe('ncert-next');
  });

  it('signature is valid HMAC-SHA256 base64url', () => {
    const secret = 'verify-me-secret';
    process.env.INTERNAL_CALLER_SIGNING_SECRET = secret;

    const method = 'POST';
    const urlPath = '/functions/v1/ncert-solver';
    const body = '{"question":"What is photosynthesis?"}';
    const caller = 'ncert-next';

    const headers = buildInternalCallerHeaders(method, urlPath, body, caller);
    expect(headers).not.toBeNull();

    const requestId = headers!['x-request-id'];
    const timestamp = headers!['x-internal-timestamp'];
    const signature = headers!['x-internal-signature'];

    // Reconstruct the canonical string the same way the module does.
    const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
    const canonical = [method.toUpperCase(), urlPath, requestId, timestamp, bodyHash, caller].join('\n');
    const expectedRaw = createHmac('sha256', secret).update(canonical, 'utf8').digest('base64');
    const expectedSig = expectedRaw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    expect(signature).toBe(expectedSig);
    // base64url form — no padding or standard base64 specials
    expect(signature).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('x-internal-timestamp is current unix seconds (within a 5-second window)', () => {
    process.env.INTERNAL_CALLER_SIGNING_SECRET = 'ts-test-secret';
    const before = Math.floor(Date.now() / 1000);
    const result = buildInternalCallerHeaders('POST', '/path', '{}', 'caller');
    const after = Math.floor(Date.now() / 1000);

    const ts = Number(result?.['x-internal-timestamp']);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 5);
  });

  it('x-request-id is a non-empty string on each call', () => {
    process.env.INTERNAL_CALLER_SIGNING_SECRET = 'test-secret';
    const r1 = buildInternalCallerHeaders('POST', '/p', '{}', 'c');
    const r2 = buildInternalCallerHeaders('POST', '/p', '{}', 'c');
    expect(r1?.['x-request-id']).toBeTruthy();
    expect(r2?.['x-request-id']).toBeTruthy();
    // Each call produces a fresh request-id
    expect(r1?.['x-request-id']).not.toBe(r2?.['x-request-id']);
  });
});
