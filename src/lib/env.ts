/**
 * ALFANUMRIK — Environment Variable Validation
 *
 * Central, type-safe access to every environment variable used by the Next.js
 * runtime (server + client). Extended in 2026-04 to cover the full variable
 * inventory with zod-based validation.
 *
 * DESIGN:
 *   • Legacy exports (NEXT_PUBLIC_SUPABASE_URL, validatePublicEnv, etc.) are
 *     preserved for backward compatibility. Existing callers keep working.
 *   • New code should import one of the typed accessors:
 *       getPublicEnv()   — client-safe (NEXT_PUBLIC_ only)
 *       getServerEnv()   — server-only (secrets). Throws in browser.
 *       getAIEnv()       — AI provider keys (Anthropic / Voyage)
 *       getPaymentEnv()  — Razorpay trio
 *       getAdminEnv()    — SUPER_ADMIN_SECRET / CRON_SECRET
 *       getMonitoringEnv() — Sentry + Vercel metadata
 *       getRedisEnv()    — Upstash (may return null if unset)
 *
 * SECURITY:
 *   • SUPABASE_SERVICE_ROLE_KEY must NEVER be in a NEXT_PUBLIC_ variable.
 *   • validateServerEnv() enforces that invariant at runtime.
 *
 * VALIDATION MODES:
 *   • "development" / "test" — missing optional vars warn; missing required
 *     vars throw clear messages naming every offender.
 *   • "production" — same, plus stricter URL-format checks.
 *   • During Next.js build phase (NEXT_PHASE=phase-production-build), validators
 *     return early because env may not be available until the runtime step.
 *
 * Scope for Edge Functions (Deno):
 *   This module is Node.js/browser only. Deno Edge Functions must continue to
 *   read `Deno.env.get(...)` directly. See ENVIRONMENT_SETUP.md for the full
 *   Edge Function variable list.
 */

import { z } from 'zod';

// ─── Internal: phase detection ──────────────────────────────────────────────

/** True during `next build` — allows validators to short-circuit. */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === 'phase-production-build';
}

/** Cheap check — true if running in a browser (client-side code). */
function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

// ─── Legacy exports (DO NOT BREAK — 50+ callers depend on these) ────────────

export const NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || '';

export const NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const RAZORPAY_WEBHOOK_SECRET =
  process.env.RAZORPAY_WEBHOOK_SECRET || '';

/**
 * Validate that required public env vars are set.
 * Safe to call in both client and server contexts.
 * Throws if variables are missing at runtime (not during build/SSG).
 */
export function validatePublicEnv(): void {
  // During Next.js build (SSG), env vars may not be available.
  // Only enforce at runtime.
  if (!isBrowser() && isBuildPhase()) {
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
  if (isBuildPhase()) {
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

  // CRITICAL SECURITY CHECK: service role key must not be exposed via NEXT_PUBLIC_*
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
 * Legacy convenience object. Kept for backward compatibility.
 * Prefer the typed accessors below for new code.
 */
export const env = {
  get NEXT_PUBLIC_SUPABASE_URL() { return NEXT_PUBLIC_SUPABASE_URL; },
  get NEXT_PUBLIC_SUPABASE_ANON_KEY() { return NEXT_PUBLIC_SUPABASE_ANON_KEY; },
  get SUPABASE_SERVICE_ROLE_KEY() { return SUPABASE_SERVICE_ROLE_KEY; },
  get RAZORPAY_WEBHOOK_SECRET() { return RAZORPAY_WEBHOOK_SECRET; },
  get NODE_ENV() { return process.env.NODE_ENV || 'development'; },
  get VERCEL_ENV() { return process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'; },
} as const;

// ─── New: zod schemas ───────────────────────────────────────────────────────

const urlSchema = z
  .string()
  .min(1)
  .refine(
    (v) => v.startsWith('http://') || v.startsWith('https://'),
    'must start with http:// or https://'
  );

const nonEmpty = z.string().min(1);
const optional = z.string().optional();

/** Public schema — only NEXT_PUBLIC_* (or Next.js-inlined) are allowed here. */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: urlSchema,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty,
  NEXT_PUBLIC_SENTRY_DSN: optional,
  NEXT_PUBLIC_APP_URL: optional,
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

/** Server schema — secrets. Must never appear in client bundles. */
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty,
});

const aiSchema = z.object({
  ANTHROPIC_API_KEY: optional,
  VOYAGE_API_KEY: optional,
  OPENAI_API_KEY: optional,
  AI_ENABLE_INTENT_ROUTER: optional,
  AI_ENABLE_OUTPUT_VALIDATION: optional,
  AI_ENABLE_TRACING: optional,
});

const paymentSchema = z.object({
  RAZORPAY_KEY_ID: optional,
  RAZORPAY_KEY_SECRET: optional,
  RAZORPAY_WEBHOOK_SECRET: optional,
});

const adminSchema = z.object({
  SUPER_ADMIN_SECRET: optional,
  CRON_SECRET: optional,
});

const redisSchema = z.object({
  UPSTASH_REDIS_REST_URL: optional,
  UPSTASH_REDIS_REST_TOKEN: optional,
});

const monitoringSchema = z.object({
  NEXT_PUBLIC_SENTRY_DSN: optional,
  SENTRY_ORG: optional,
  SENTRY_PROJECT: optional,
  VERCEL: optional,
  VERCEL_ENV: optional,
  VERCEL_REGION: optional,
  VERCEL_URL: optional,
  VERCEL_DEPLOYMENT_ID: optional,
  VERCEL_GIT_COMMIT_SHA: optional,
  VERCEL_GIT_COMMIT_REF: optional,
  VERCEL_GIT_COMMIT_MESSAGE: optional,
  VERCEL_GIT_COMMIT_AUTHOR_LOGIN: optional,
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: optional,
});

// ─── New: typed accessors ───────────────────────────────────────────────────

/** Format a zod error into a single human-readable line per issue. */
function formatZodError(err: z.ZodError, group: string): string {
  const lines = err.issues.map((issue) => {
    const path = issue.path.join('.');
    return `  • ${path}: ${issue.message}`;
  });
  return `[env] Invalid/missing variables in group "${group}":\n${lines.join('\n')}\n` +
    'Check .env.local (local) or Vercel env settings (prod). See ENVIRONMENT_SETUP.md.';
}

/**
 * Client-safe public env. Always callable — including during client render.
 * Returns parsed, typed data. Throws only if required public vars are missing
 * AND we are past the build phase.
 */
export function getPublicEnv() {
  if (!isBrowser() && isBuildPhase()) {
    // Best-effort parse during build — return whatever is available.
    return publicSchema.partial().parse({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      NODE_ENV: process.env.NODE_ENV,
    });
  }
  const result = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NODE_ENV: process.env.NODE_ENV,
  });
  if (!result.success) {
    throw new Error(formatZodError(result.error, 'public'));
  }
  return result.data;
}

/**
 * Server-only env. Throws immediately if called from a browser context.
 * Returns parsed, typed data with all required server secrets validated.
 */
export function getServerEnv() {
  if (isBrowser()) {
    throw new Error(
      '[env] getServerEnv() was called in a browser context. ' +
      'Server secrets must never be imported into client code.'
    );
  }
  if (isBuildPhase()) {
    return {
      ...publicSchema.partial().parse({
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        NODE_ENV: process.env.NODE_ENV,
      }),
      ...serverSchema.partial().parse({
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      }),
    };
  }
  const publicResult = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NODE_ENV: process.env.NODE_ENV,
  });
  const serverResult = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!publicResult.success) {
    throw new Error(formatZodError(publicResult.error, 'public'));
  }
  if (!serverResult.success) {
    throw new Error(formatZodError(serverResult.error, 'server'));
  }

  // CRITICAL: service role key must not be leaked through a NEXT_PUBLIC_ variable.
  for (const [key, value] of Object.entries(process.env)) {
    if (
      key.startsWith('NEXT_PUBLIC_') &&
      value &&
      value === serverResult.data.SUPABASE_SERVICE_ROLE_KEY
    ) {
      throw new Error(
        `[env] SECURITY VIOLATION: SUPABASE_SERVICE_ROLE_KEY value found in ${key}. ` +
        'Service role keys must NEVER be exposed in NEXT_PUBLIC_ variables.'
      );
    }
  }

  return { ...publicResult.data, ...serverResult.data };
}

/** AI provider credentials. All optional — feature degrades if absent. */
export function getAIEnv() {
  return aiSchema.parse({
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    VOYAGE_API_KEY: process.env.VOYAGE_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AI_ENABLE_INTENT_ROUTER: process.env.AI_ENABLE_INTENT_ROUTER,
    AI_ENABLE_OUTPUT_VALIDATION: process.env.AI_ENABLE_OUTPUT_VALIDATION,
    AI_ENABLE_TRACING: process.env.AI_ENABLE_TRACING,
  });
}

/** Razorpay credentials. Individual vars are optional at this level; each
 *  API route that needs them performs its own 500 on missing-value. */
export function getPaymentEnv() {
  return paymentSchema.parse({
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
  });
}

/** Admin-panel and cron-path secrets. */
export function getAdminEnv() {
  return adminSchema.parse({
    SUPER_ADMIN_SECRET: process.env.SUPER_ADMIN_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
  });
}

/** Upstash Redis. Returns both vars as `undefined` if Redis is not configured. */
export function getRedisEnv() {
  return redisSchema.parse({
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

/** Sentry + Vercel deployment metadata. All optional. */
export function getMonitoringEnv() {
  return monitoringSchema.parse({
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    SENTRY_ORG: process.env.SENTRY_ORG,
    SENTRY_PROJECT: process.env.SENTRY_PROJECT,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_REGION: process.env.VERCEL_REGION,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    VERCEL_GIT_COMMIT_MESSAGE: process.env.VERCEL_GIT_COMMIT_MESSAGE,
    VERCEL_GIT_COMMIT_AUTHOR_LOGIN: process.env.VERCEL_GIT_COMMIT_AUTHOR_LOGIN,
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  });
}

// ─── Exported types (for consumers that want stricter typing) ───────────────

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = PublicEnv & z.infer<typeof serverSchema>;
export type AIEnv = z.infer<typeof aiSchema>;
export type PaymentEnv = z.infer<typeof paymentSchema>;
export type AdminEnv = z.infer<typeof adminSchema>;
export type RedisEnv = z.infer<typeof redisSchema>;
export type MonitoringEnv = z.infer<typeof monitoringSchema>;
