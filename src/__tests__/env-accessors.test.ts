import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Typed env accessor tests
 *
 * Covers the new zod-based helpers added in src/lib/env.ts:
 *   getPublicEnv / getServerEnv / getAIEnv / getPaymentEnv /
 *   getAdminEnv / getRedisEnv / getMonitoringEnv
 *
 * Legacy validatePublicEnv / validateServerEnv / env tests live in
 * env-validation.test.ts and are unchanged.
 */

describe('getPublicEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PHASE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws a grouped error listing every missing required public var', async () => {
    const { getPublicEnv } = await import('@/lib/env');
    // Don't set either required var
    expect(() => getPublicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('rejects a non-HTTP(S) URL for NEXT_PUBLIC_SUPABASE_URL', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'not-a-url';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    const { getPublicEnv } = await import('@/lib/env');
    expect(() => getPublicEnv()).toThrow(/must start with http/);
  });

  it('accepts a valid https URL and returns typed data', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    const { getPublicEnv } = await import('@/lib/env');
    const out = getPublicEnv();
    expect(out.NEXT_PUBLIC_SUPABASE_URL).toBe('https://example.supabase.co');
    expect(out.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('anon-key');
  });

  it('includes NEXT_PUBLIC_APP_URL and SENTRY_DSN when provided', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.alfanumrik.com';
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://dsn@sentry.io/1';
    const { getPublicEnv } = await import('@/lib/env');
    const out = getPublicEnv();
    expect(out.NEXT_PUBLIC_APP_URL).toBe('https://app.alfanumrik.com');
    expect(out.NEXT_PUBLIC_SENTRY_DSN).toBe('https://dsn@sentry.io/1');
  });
});

describe('getServerEnv', () => {
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

  it('throws when called in a browser-like context', async () => {
    // jsdom defines window — simulate browser
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sr';
    const { getServerEnv } = await import('@/lib/env');
    // jsdom provides window — expect a browser-guard throw
    expect(() => getServerEnv()).toThrow(/browser context/);
  });

  it('throws a grouped error when SERVICE_ROLE is missing (Node context)', async () => {
    // Strip window to simulate Node
    const g = globalThis as Record<string, unknown>;
    const originalWindow = g.window;
    delete g.window;
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
      // no SERVICE_ROLE
      const { getServerEnv } = await import('@/lib/env');
      expect(() => getServerEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    } finally {
      g.window = originalWindow;
    }
  });

  it('succeeds and returns merged public + server env in Node context', async () => {
    const g = globalThis as Record<string, unknown>;
    const originalWindow = g.window;
    delete g.window;
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'sr';
      const { getServerEnv } = await import('@/lib/env');
      const out = getServerEnv();
      expect(out.NEXT_PUBLIC_SUPABASE_URL).toBe('https://x.supabase.co');
      expect(out.SUPABASE_SERVICE_ROLE_KEY).toBe('sr');
    } finally {
      g.window = originalWindow;
    }
  });

  it('flags a security violation when SERVICE_ROLE is duplicated into a NEXT_PUBLIC_ var', async () => {
    const g = globalThis as Record<string, unknown>;
    const originalWindow = g.window;
    delete g.window;
    try {
      const leaked = 'fake-leaked-service-role';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
      process.env.SUPABASE_SERVICE_ROLE_KEY = leaked;
      process.env.NEXT_PUBLIC_LEAK = leaked;
      const { getServerEnv } = await import('@/lib/env');
      expect(() => getServerEnv()).toThrow(/SECURITY VIOLATION/);
      delete process.env.NEXT_PUBLIC_LEAK;
    } finally {
      g.window = originalWindow;
    }
  });

  it('returns best-effort data during NEXT_PHASE=phase-production-build', async () => {
    const g = globalThis as Record<string, unknown>;
    const originalWindow = g.window;
    delete g.window;
    try {
      process.env.NEXT_PHASE = 'phase-production-build';
      // Intentionally leave all vars unset — build phase must not throw
      const { getServerEnv } = await import('@/lib/env');
      expect(() => getServerEnv()).not.toThrow();
    } finally {
      g.window = originalWindow;
    }
  });
});

describe('group accessors — AI / payment / admin / redis / monitoring', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    for (const k of [
      'ANTHROPIC_API_KEY', 'VOYAGE_API_KEY', 'OPENAI_API_KEY',
      'AI_ENABLE_INTENT_ROUTER', 'AI_ENABLE_OUTPUT_VALIDATION', 'AI_ENABLE_TRACING',
      'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET',
      'SUPER_ADMIN_SECRET', 'CRON_SECRET',
      'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
      'NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_ORG', 'SENTRY_PROJECT',
    ]) {
      delete process.env[k];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('getAIEnv returns all-undefined when nothing is set (all optional)', async () => {
    const { getAIEnv } = await import('@/lib/env');
    const out = getAIEnv();
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
    expect(out.VOYAGE_API_KEY).toBeUndefined();
    expect(out.AI_ENABLE_TRACING).toBeUndefined();
  });

  it('getAIEnv surfaces values when set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    process.env.VOYAGE_API_KEY = 'voyage';
    const { getAIEnv } = await import('@/lib/env');
    const out = getAIEnv();
    expect(out.ANTHROPIC_API_KEY).toBe('sk-ant');
    expect(out.VOYAGE_API_KEY).toBe('voyage');
  });

  it('getPaymentEnv returns the Razorpay trio when set', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_id';
    process.env.RAZORPAY_KEY_SECRET = 'secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec';
    const { getPaymentEnv } = await import('@/lib/env');
    const out = getPaymentEnv();
    expect(out.RAZORPAY_KEY_ID).toBe('rzp_test_id');
    expect(out.RAZORPAY_WEBHOOK_SECRET).toBe('whsec');
  });

  it('getAdminEnv returns SUPER_ADMIN_SECRET and CRON_SECRET', async () => {
    process.env.SUPER_ADMIN_SECRET = 'admin';
    process.env.CRON_SECRET = 'cron';
    const { getAdminEnv } = await import('@/lib/env');
    const out = getAdminEnv();
    expect(out.SUPER_ADMIN_SECRET).toBe('admin');
    expect(out.CRON_SECRET).toBe('cron');
  });

  it('getRedisEnv returns undefined for both when Upstash is not configured', async () => {
    const { getRedisEnv } = await import('@/lib/env');
    const out = getRedisEnv();
    expect(out.UPSTASH_REDIS_REST_URL).toBeUndefined();
    expect(out.UPSTASH_REDIS_REST_TOKEN).toBeUndefined();
  });

  it('getRedisEnv returns values when configured', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://r.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
    const { getRedisEnv } = await import('@/lib/env');
    const out = getRedisEnv();
    expect(out.UPSTASH_REDIS_REST_URL).toBe('https://r.upstash.io');
    expect(out.UPSTASH_REDIS_REST_TOKEN).toBe('tok');
  });

  it('getMonitoringEnv returns Sentry and Vercel metadata when set', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://dsn@sentry.io/1';
    process.env.SENTRY_ORG = 'org';
    process.env.SENTRY_PROJECT = 'proj';
    process.env.VERCEL_ENV = 'production';
    const { getMonitoringEnv } = await import('@/lib/env');
    const out = getMonitoringEnv();
    expect(out.NEXT_PUBLIC_SENTRY_DSN).toBe('https://dsn@sentry.io/1');
    expect(out.SENTRY_ORG).toBe('org');
    expect(out.VERCEL_ENV).toBe('production');
  });
});
