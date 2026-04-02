import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Environment Variable Validation Tests
 *
 * Verifies:
 * - Missing required vars are detected and throw
 * - Valid vars are accepted
 * - Service role key in NEXT_PUBLIC_ is caught as security violation
 * - Build phase skips validation
 *
 * Source: src/lib/env.ts
 */

describe('validatePublicEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    // Clear relevant env vars
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PHASE;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    // Do NOT set NEXT_PUBLIC_SUPABASE_URL

    const { validatePublicEnv } = await import('@/lib/env');
    expect(() => validatePublicEnv()).toThrow('NEXT_PUBLIC_SUPABASE_URL');
  });

  it('throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    // Do NOT set NEXT_PUBLIC_SUPABASE_ANON_KEY

    const { validatePublicEnv } = await import('@/lib/env');
    expect(() => validatePublicEnv()).toThrow('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  });

  it('throws listing all missing vars when both are missing', async () => {
    const { validatePublicEnv } = await import('@/lib/env');
    expect(() => validatePublicEnv()).toThrow('NEXT_PUBLIC_SUPABASE_URL');
  });

  it('does not throw when all public vars are set', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

    const { validatePublicEnv } = await import('@/lib/env');
    expect(() => validatePublicEnv()).not.toThrow();
  });

  it('still validates in jsdom even during build phase (skip is server-only)', async () => {
    // validatePublicEnv skips only when typeof window === 'undefined' AND NEXT_PHASE is build.
    // In jsdom (browser-like), window exists, so the skip does not apply.
    process.env.NEXT_PHASE = 'phase-production-build';

    const { validatePublicEnv } = await import('@/lib/env');
    // Should still throw because window is defined in jsdom
    expect(() => validatePublicEnv()).toThrow('Missing required public environment variables');
  });
});

describe('validateServerEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PHASE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    // Do NOT set SUPABASE_SERVICE_ROLE_KEY

    const { validateServerEnv } = await import('@/lib/env');
    expect(() => validateServerEnv()).toThrow('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('throws when public vars are missing in server context', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-server-key';

    const { validateServerEnv } = await import('@/lib/env');
    expect(() => validateServerEnv()).toThrow('NEXT_PUBLIC_SUPABASE_URL');
  });

  it('does not throw when all server vars are set', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-server-key';

    const { validateServerEnv } = await import('@/lib/env');
    expect(() => validateServerEnv()).not.toThrow();
  });

  it('skips validation during Next.js build phase', async () => {
    process.env.NEXT_PHASE = 'phase-production-build';

    const { validateServerEnv } = await import('@/lib/env');
    expect(() => validateServerEnv()).not.toThrow();
  });

  it('detects service role key leaked in NEXT_PUBLIC_ variable (security violation)', async () => {
    const leakedKey = 'test-fake-service-role-key-not-real';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = leakedKey;
    // Simulate the leak: same value in a NEXT_PUBLIC_ var
    process.env.NEXT_PUBLIC_LEAKED_KEY = leakedKey;

    const { validateServerEnv } = await import('@/lib/env');
    expect(() => validateServerEnv()).toThrow('SECURITY VIOLATION');
  });
});

describe('env convenience object', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('exposes NEXT_PUBLIC_SUPABASE_URL', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://my-project.supabase.co';
    const { env } = await import('@/lib/env');
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://my-project.supabase.co');
  });

  it('exposes NODE_ENV with fallback to development', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = undefined;
    const { env } = await import('@/lib/env');
    expect(env.NODE_ENV).toBe('development');
  });

  it('exposes RAZORPAY_WEBHOOK_SECRET', async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
    const { env } = await import('@/lib/env');
    expect(env.RAZORPAY_WEBHOOK_SECRET).toBe('whsec_test');
  });

  it('returns empty string for unset optional vars', async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const { env } = await import('@/lib/env');
    expect(env.RAZORPAY_WEBHOOK_SECRET).toBe('');
  });
});
