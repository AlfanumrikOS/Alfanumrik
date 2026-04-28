/**
 * posthog-client.ts — unit tests.
 *
 * src/lib/posthog-client.ts is the lazy-init wrapper around posthog-js.
 * It is opt-in (NEXT_PUBLIC_POSTHOG_ENABLED + key required) and
 * silently no-ops in SSR or when misconfigured. Tests cover:
 *   - getKey() / isPosthogEnabled() flag handling
 *   - posthogCapture / posthogIdentify / posthogReset are safe to call
 *     when disabled (never throw)
 *   - hashUserIdForAnalytics returns a 16-hex-char prefix, idempotent for
 *     the same input, distinct for different inputs, null when crypto.subtle
 *     is unavailable, null for empty input
 *   - posthogIdentify rejects too-short hashes (< 8 chars)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  posthogCapture,
  posthogIdentify,
  posthogReset,
  hashUserIdForAnalytics,
  isPosthogEnabled,
} from '@/lib/posthog-client';

describe('isPosthogEnabled / getKey', () => {
  const originalEnabled = process.env.NEXT_PUBLIC_POSTHOG_ENABLED;
  const originalKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

  afterEach(() => {
    (process.env as any).NEXT_PUBLIC_POSTHOG_ENABLED = originalEnabled;
    (process.env as any).NEXT_PUBLIC_POSTHOG_KEY = originalKey;
  });

  it('returns false when the enable flag is unset', () => {
    delete (process.env as any).NEXT_PUBLIC_POSTHOG_ENABLED;
    delete (process.env as any).NEXT_PUBLIC_POSTHOG_KEY;
    expect(isPosthogEnabled()).toBe(false);
  });

  it('returns false when the flag is on but the key is missing', () => {
    (process.env as any).NEXT_PUBLIC_POSTHOG_ENABLED = 'true';
    delete (process.env as any).NEXT_PUBLIC_POSTHOG_KEY;
    expect(isPosthogEnabled()).toBe(false);
  });

  it('returns false when the flag is on but the key is the empty string', () => {
    (process.env as any).NEXT_PUBLIC_POSTHOG_ENABLED = 'true';
    (process.env as any).NEXT_PUBLIC_POSTHOG_KEY = '';
    expect(isPosthogEnabled()).toBe(false);
  });

  it('returns false when the key is set but the flag is anything other than "true"', () => {
    (process.env as any).NEXT_PUBLIC_POSTHOG_ENABLED = '1';
    (process.env as any).NEXT_PUBLIC_POSTHOG_KEY = 'phc_xxx';
    expect(isPosthogEnabled()).toBe(false);
  });

  it('returns true only when both flag === "true" and key is non-empty', () => {
    (process.env as any).NEXT_PUBLIC_POSTHOG_ENABLED = 'true';
    (process.env as any).NEXT_PUBLIC_POSTHOG_KEY = 'phc_xxx';
    expect(isPosthogEnabled()).toBe(true);
  });
});

describe('posthogCapture / posthogIdentify / posthogReset (disabled state)', () => {
  beforeEach(() => {
    delete (process.env as any).NEXT_PUBLIC_POSTHOG_ENABLED;
    delete (process.env as any).NEXT_PUBLIC_POSTHOG_KEY;
  });

  it('posthogCapture is a no-op when disabled (does not throw)', () => {
    expect(() => posthogCapture('quiz_completed', { score: 90 })).not.toThrow();
  });

  it('posthogIdentify is a no-op when disabled', () => {
    expect(() => posthogIdentify('abcdef0123456789')).not.toThrow();
  });

  it('posthogReset is a no-op when disabled', () => {
    expect(() => posthogReset()).not.toThrow();
  });

  it('posthogIdentify rejects hashes shorter than 8 chars (does nothing)', () => {
    // Internal invariant: refuse to identify if the hash is too short to be a
    // real SHA-256 prefix. We just verify no throw + no crash.
    expect(() => posthogIdentify('short')).not.toThrow();
    expect(() => posthogIdentify('')).not.toThrow();
  });
});

describe('hashUserIdForAnalytics', () => {
  it('returns null for empty input', async () => {
    expect(await hashUserIdForAnalytics('')).toBeNull();
  });

  it('returns a 16-hex-char SHA-256 prefix', async () => {
    const out = await hashUserIdForAnalytics('alice@example.com');
    expect(out).not.toBeNull();
    expect(out).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic for the same input', async () => {
    const a = await hashUserIdForAnalytics('user-uuid-123');
    const b = await hashUserIdForAnalytics('user-uuid-123');
    expect(a).toBe(b);
  });

  it('produces distinct hashes for different inputs', async () => {
    const a = await hashUserIdForAnalytics('alice');
    const b = await hashUserIdForAnalytics('bob');
    expect(a).not.toBe(b);
  });

  it('returns null when crypto.subtle is unavailable', async () => {
    const original = (globalThis.crypto as any)?.subtle;
    Object.defineProperty(globalThis.crypto, 'subtle', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    try {
      const out = await hashUserIdForAnalytics('any');
      expect(out).toBeNull();
    } finally {
      Object.defineProperty(globalThis.crypto, 'subtle', {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });

  it('returns null when crypto.subtle.digest throws', async () => {
    const original = (globalThis.crypto as any).subtle.digest;
    (globalThis.crypto as any).subtle.digest = () => {
      throw new Error('digest unavailable');
    };
    try {
      const out = await hashUserIdForAnalytics('anything');
      expect(out).toBeNull();
    } finally {
      (globalThis.crypto as any).subtle.digest = original;
    }
  });
});
