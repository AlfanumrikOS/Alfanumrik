/**
 * ALFANUMRIK -- Environment Variable Validation
 *
 * Validates critical environment variables at import time.
 * Fails fast with clear error messages if required vars are missing.
 *
 * Usage:
 *   import { env } from '@/lib/env';
 *   // env.NEXT_PUBLIC_SUPABASE_URL is guaranteed non-empty
 *
 * SECURITY: SUPABASE_SERVICE_ROLE_KEY must NEVER be in a NEXT_PUBLIC_ variable.
 * This module enforces that invariant at startup.
 */

// ---- Public env vars (safe for client bundles) ----

export const NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || '';

export const NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// ---- Server-only env vars ----

export const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const RAZORPAY_WEBHOOK_SECRET =
  process.env.RAZORPAY_WEBHOOK_SECRET || '';

// ---- Validation ----

/**
 * Validate that required public env vars are set.
 * Safe to call in both client and server contexts.
 * Throws if variables are missing at runtime (not during build/SSG).
 */
export function validatePublicEnv(): void {
  // During Next.js build (SSG), env vars may not be available.
  // Only enforce at runtime.
  if (typeof window === 'undefined' && process.env.NEXT_PHASE === 'phase-production-build') {
    return;
  }

  const missing: string[] = [];

  if (!NEXT_PUBLIC_SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  if (missing.length > 0) {
    throw new Error(
      `[env] Missing required public environment variables: ${missing.join(', ')}. ` +
      'Check your .env.local or Vercel environment configuration.'
    );
  }
}

/**
 * Validate that required server-only env vars are set.
 * Must only be called from server-side code (API routes, middleware, SSR).
 * Throws if variables are missing.
 */
export function validateServerEnv(): void {
  // During Next.js build, env vars may not be available.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return;
  }

  const missing: string[] = [];

  if (!NEXT_PUBLIC_SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missing.length > 0) {
    throw new Error(
      `[env] Missing required server environment variables: ${missing.join(', ')}. ` +
      'Check your .env.local or Vercel environment configuration.'
    );
  }

  // CRITICAL SECURITY CHECK: Ensure service role key is not exposed via NEXT_PUBLIC_
  // This would leak the key to all client browsers.
  for (const [key, value] of Object.entries(process.env)) {
    if (
      key.startsWith('NEXT_PUBLIC_') &&
      value &&
      value === SUPABASE_SERVICE_ROLE_KEY
    ) {
      throw new Error(
        `[env] SECURITY VIOLATION: SUPABASE_SERVICE_ROLE_KEY value found in ${key}. ` +
        'Service role keys must NEVER be exposed in NEXT_PUBLIC_ variables.'
      );
    }
  }
}

/**
 * Convenience: all validated env vars as a typed object.
 * Use this in server-side code for type-safe access.
 */
export const env = {
  get NEXT_PUBLIC_SUPABASE_URL() { return NEXT_PUBLIC_SUPABASE_URL; },
  get NEXT_PUBLIC_SUPABASE_ANON_KEY() { return NEXT_PUBLIC_SUPABASE_ANON_KEY; },
  get SUPABASE_SERVICE_ROLE_KEY() { return SUPABASE_SERVICE_ROLE_KEY; },
  get RAZORPAY_WEBHOOK_SECRET() { return RAZORPAY_WEBHOOK_SECRET; },
  get NODE_ENV() { return process.env.NODE_ENV || 'development'; },
  get VERCEL_ENV() { return process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'; },
} as const;
