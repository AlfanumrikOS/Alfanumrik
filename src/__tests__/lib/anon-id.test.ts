/**
 * anon-id.ts — unit tests.
 *
 * src/lib/anon-id.ts produces the stable per-visitor cookie used as the
 * bucket key for feature-flag rollouts on anonymous traffic. Tests cover:
 *   - generateAnonId() returns a valid RFC4122 v4 UUID
 *   - fallback path (no crypto.randomUUID) still returns a valid UUID v4
 *   - anonIdCookieAttributes() composes the right Set-Cookie tail for
 *     production and non-production environments
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ANON_ID_COOKIE,
  ANON_ID_MAX_AGE_SECONDS,
  generateAnonId,
  anonIdCookieAttributes,
} from '@/lib/anon-id';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('constants', () => {
  it('cookie name is alf_anon_id', () => {
    expect(ANON_ID_COOKIE).toBe('alf_anon_id');
  });

  it('max-age is 365 days in seconds', () => {
    expect(ANON_ID_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 365);
  });
});

describe('generateAnonId', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a valid UUID v4 string', () => {
    const id = generateAnonId();
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it('returns different ids on consecutive calls', () => {
    const a = generateAnonId();
    const b = generateAnonId();
    expect(a).not.toBe(b);
  });

  it('falls back to manual RFC4122 when crypto.randomUUID is missing', () => {
    // Stub out randomUUID but keep getRandomValues so the fallback uses
    // the secure-random branch (lines 36-37 of anon-id.ts).
    const originalRandomUUID = (crypto as any).randomUUID;
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    try {
      const id = generateAnonId();
      expect(id).toMatch(UUID_V4_REGEX);
      // Verify the version (position 14) is 4 and variant (position 19) is 8/9/a/b
      expect(id[14]).toBe('4');
      expect('89ab').toContain(id[19].toLowerCase());
    } finally {
      if (originalRandomUUID) {
        Object.defineProperty(crypto, 'randomUUID', {
          configurable: true,
          writable: true,
          value: originalRandomUUID,
        });
      }
    }
  });

  it('falls back to Math.random when neither crypto.randomUUID nor getRandomValues exist', () => {
    // Hide both crypto.randomUUID AND crypto.getRandomValues to exercise the
    // pure Math.random branch (line 39).
    const originalRandomUUID = (crypto as any).randomUUID;
    const originalGetRandomValues = (crypto as any).getRandomValues;
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(crypto, 'getRandomValues', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    try {
      const id = generateAnonId();
      expect(id).toMatch(UUID_V4_REGEX);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', {
        configurable: true,
        writable: true,
        value: originalRandomUUID,
      });
      Object.defineProperty(crypto, 'getRandomValues', {
        configurable: true,
        writable: true,
        value: originalGetRandomValues,
      });
    }
  });
});

describe('anonIdCookieAttributes', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    // Use vi.stubEnv-friendly direct assignment; Vitest exposes process.env
    // as a non-configurable getter so Object.defineProperty fails on it.
    (process.env as any).NODE_ENV = originalEnv;
  });

  it('always includes Path=/ and SameSite=Lax', () => {
    const attrs = anonIdCookieAttributes();
    expect(attrs).toContain('Path=/');
    expect(attrs).toContain('SameSite=Lax');
  });

  it('includes the 365-day Max-Age', () => {
    const attrs = anonIdCookieAttributes();
    expect(attrs).toContain(`Max-Age=${ANON_ID_MAX_AGE_SECONDS}`);
  });

  it('omits Secure outside production', () => {
    (process.env as any).NODE_ENV = 'development';
    const attrs = anonIdCookieAttributes();
    expect(attrs).not.toContain('Secure');
  });

  it('appends Secure when NODE_ENV is production', () => {
    (process.env as any).NODE_ENV = 'production';
    const attrs = anonIdCookieAttributes();
    expect(attrs).toContain('Secure');
  });

  it('joins attributes with "; " separator', () => {
    const attrs = anonIdCookieAttributes();
    expect(attrs.split('; ').length).toBeGreaterThanOrEqual(3);
  });
});
