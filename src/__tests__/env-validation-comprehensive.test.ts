import { describe, it, expect } from 'vitest';
import {
  validateEnv,
  getEnvGroups,
  ENV_DEFINITIONS,
  type EnvValidationResult,
} from '@/lib/env-validation';

/**
 * Comprehensive Environment Variable Validation Tests
 *
 * Tests the validateEnv() function from src/lib/env-validation.ts
 * which validates all required and optional env vars grouped by service.
 */

// Helper: build a complete valid env object
function fullEnv(): Record<string, string> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    RAZORPAY_KEY_ID: 'rzp_test_123',
    RAZORPAY_KEY_SECRET: 'rzp_secret_123',
    RAZORPAY_WEBHOOK_SECRET: 'whsec_test_123',
    UPSTASH_REDIS_REST_URL: 'https://redis.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'redis-token',
    NEXT_PUBLIC_SENTRY_DSN: 'https://sentry.io/123',
    SUPER_ADMIN_SECRET: 'admin-secret-value',
  };
}

describe('validateEnv', () => {
  it('returns valid when all vars are set', () => {
    const result = validateEnv(fullEnv());
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('reports missing required Supabase vars', () => {
    const env = fullEnv();
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    const result = validateEnv(env);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('reports missing required Razorpay vars', () => {
    const env = fullEnv();
    delete env.RAZORPAY_KEY_ID;
    delete env.RAZORPAY_KEY_SECRET;
    delete env.RAZORPAY_WEBHOOK_SECRET;
    const result = validateEnv(env);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('RAZORPAY_KEY_ID');
    expect(result.missing).toContain('RAZORPAY_KEY_SECRET');
    expect(result.missing).toContain('RAZORPAY_WEBHOOK_SECRET');
  });

  it('reports missing SUPER_ADMIN_SECRET as required', () => {
    const env = fullEnv();
    delete env.SUPER_ADMIN_SECRET;
    const result = validateEnv(env);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('SUPER_ADMIN_SECRET');
  });

  it('treats Redis vars as optional with warnings', () => {
    const env = fullEnv();
    delete env.UPSTASH_REDIS_REST_URL;
    delete env.UPSTASH_REDIS_REST_TOKEN;
    const result = validateEnv(env);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('UPSTASH_REDIS_REST_URL');
    expect(result.warnings[0]).toContain('Redis');
    expect(result.warnings[1]).toContain('UPSTASH_REDIS_REST_TOKEN');
  });

  it('treats Sentry DSN as optional with warning', () => {
    const env = fullEnv();
    delete env.NEXT_PUBLIC_SENTRY_DSN;
    const result = validateEnv(env);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('NEXT_PUBLIC_SENTRY_DSN');
    expect(result.warnings[0]).toContain('Sentry');
  });

  it('treats empty strings as missing', () => {
    const env = fullEnv();
    env.RAZORPAY_KEY_ID = '';
    const result = validateEnv(env);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('RAZORPAY_KEY_ID');
  });

  it('reports all missing required vars at once', () => {
    const result = validateEnv({});
    expect(result.valid).toBe(false);
    const requiredCount = ENV_DEFINITIONS.filter(d => d.required).length;
    expect(result.missing).toHaveLength(requiredCount);
  });

  it('reports all optional warnings when none are set', () => {
    // Provide only required vars
    const env: Record<string, string> = {};
    for (const def of ENV_DEFINITIONS) {
      if (def.required) {
        env[def.name] = 'test-value';
      }
    }
    const result = validateEnv(env);
    expect(result.valid).toBe(true);
    const optionalCount = ENV_DEFINITIONS.filter(d => !d.required).length;
    expect(result.warnings).toHaveLength(optionalCount);
  });

  it('does not throw -- always returns a result', () => {
    let result: EnvValidationResult | undefined;
    expect(() => {
      result = validateEnv({});
    }).not.toThrow();
    expect(result).toBeDefined();
    expect(result!.valid).toBe(false);
  });

  it('accepts a custom env source object', () => {
    const custom = { NEXT_PUBLIC_SUPABASE_URL: 'https://custom.supabase.co' };
    const result = validateEnv(custom);
    // Should not contain NEXT_PUBLIC_SUPABASE_URL in missing
    expect(result.missing).not.toContain('NEXT_PUBLIC_SUPABASE_URL');
    // But should contain other required vars
    expect(result.missing).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  });
});

describe('getEnvGroups', () => {
  it('returns definitions grouped by service name', () => {
    const groups = getEnvGroups();
    expect(groups).toHaveProperty('Supabase');
    expect(groups).toHaveProperty('Razorpay');
    expect(groups).toHaveProperty('Redis');
    expect(groups).toHaveProperty('Sentry');
    expect(groups).toHaveProperty('Admin');
  });

  it('puts 3 vars in the Supabase group', () => {
    const groups = getEnvGroups();
    expect(groups.Supabase).toHaveLength(3);
  });

  it('puts 3 vars in the Razorpay group', () => {
    const groups = getEnvGroups();
    expect(groups.Razorpay).toHaveLength(3);
  });

  it('puts 2 vars in the Redis group', () => {
    const groups = getEnvGroups();
    expect(groups.Redis).toHaveLength(2);
  });

  it('marks Redis vars as not required', () => {
    const groups = getEnvGroups();
    for (const def of groups.Redis) {
      expect(def.required).toBe(false);
    }
  });

  it('marks Sentry DSN as not required', () => {
    const groups = getEnvGroups();
    expect(groups.Sentry).toHaveLength(1);
    expect(groups.Sentry[0].required).toBe(false);
  });
});

describe('ENV_DEFINITIONS', () => {
  it('has at least 10 definitions', () => {
    expect(ENV_DEFINITIONS.length).toBeGreaterThanOrEqual(10);
  });

  it('every definition has name, required, and group', () => {
    for (const def of ENV_DEFINITIONS) {
      expect(typeof def.name).toBe('string');
      expect(def.name.length).toBeGreaterThan(0);
      expect(typeof def.required).toBe('boolean');
      expect(typeof def.group).toBe('string');
      expect(def.group.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate variable names', () => {
    const names = ENV_DEFINITIONS.map(d => d.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
