import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the anon-visitor identity helper.
 *
 * Source: src/lib/anon-id.ts
 *
 * Covers:
 *   - generateAnonId() returns a valid RFC4122 v4 UUID
 *   - 100 generations produce unique values (no collisions)
 *   - Cookie attribute string carries Path=/, Max-Age=31536000, SameSite=Lax
 *     and `Secure` only when NODE_ENV === 'production'
 *   - The 365-day Max-Age constant
 *
 * Owning agent: testing.
 */

import {
  ANON_ID_COOKIE,
  ANON_ID_MAX_AGE_SECONDS,
  generateAnonId,
  anonIdCookieAttributes,
} from '@/lib/anon-id';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('anon-id helper — constants', () => {
  it('cookie name is the documented value', () => {
    expect(ANON_ID_COOKIE).toBe('alf_anon_id');
  });

  it('max-age is exactly 365 days in seconds', () => {
    expect(ANON_ID_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 365);
    expect(ANON_ID_MAX_AGE_SECONDS).toBe(31_536_000);
  });
});

describe('anon-id helper — generateAnonId()', () => {
  it('returns a valid RFC4122 v4 UUID', () => {
    const id = generateAnonId();
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it('produces 100 unique values (no obvious collisions)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(generateAnonId());
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(UUID_V4_REGEX);
  });

  it('falls back to manual RFC4122 implementation when crypto.randomUUID is missing', async () => {
    // Save and stub crypto so randomUUID is undefined but getRandomValues works.
    const realCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        getRandomValues: (arr: Uint8Array) => {
          for (let i = 0; i < arr.length; i++) arr[i] = (i * 31 + 7) & 0xff;
          return arr;
        },
        // intentionally no randomUUID
      },
      configurable: true,
      writable: true,
    });
    try {
      // Re-import to ensure the function picks up the stubbed crypto each call.
      const { generateAnonId: gen } = await import('@/lib/anon-id');
      const id = gen();
      expect(id).toMatch(UUID_V4_REGEX);
      // Version nibble must be 4 and variant nibble must be 8/9/a/b
      expect(id[14]).toBe('4');
      expect(['8', '9', 'a', 'b']).toContain(id[19].toLowerCase());
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: realCrypto,
        configurable: true,
        writable: true,
      });
    }
  });
});

describe('anon-id helper — anonIdCookieAttributes()', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('includes Path=/', () => {
    const attrs = anonIdCookieAttributes();
    expect(attrs).toContain('Path=/');
  });

  it('includes SameSite=Lax', () => {
    const attrs = anonIdCookieAttributes();
    expect(attrs).toContain('SameSite=Lax');
  });

  it('includes Max-Age=31536000 (365 days)', () => {
    const attrs = anonIdCookieAttributes();
    expect(attrs).toContain(`Max-Age=${ANON_ID_MAX_AGE_SECONDS}`);
    expect(attrs).toContain('Max-Age=31536000');
  });

  it('omits Secure outside production (development)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const attrs = anonIdCookieAttributes();
    expect(attrs).not.toContain('Secure');
  });

  it('omits Secure outside production (test)', () => {
    vi.stubEnv('NODE_ENV', 'test');
    const attrs = anonIdCookieAttributes();
    expect(attrs).not.toContain('Secure');
  });

  it('includes Secure when NODE_ENV === production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const attrs = anonIdCookieAttributes();
    expect(attrs).toContain('Secure');
  });

  it('parts are joined by "; " (single Set-Cookie attribute string)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const attrs = anonIdCookieAttributes();
    expect(attrs.split('; ')).toEqual(
      expect.arrayContaining(['Path=/', `Max-Age=${ANON_ID_MAX_AGE_SECONDS}`, 'SameSite=Lax', 'Secure']),
    );
  });
});
