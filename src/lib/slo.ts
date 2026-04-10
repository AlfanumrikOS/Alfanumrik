/**
 * ALFANUMRIK -- Service Level Objectives (SLO) Definitions
 *
 * Centralized SLO constants for monitoring, alerting, and dashboards.
 * These targets define the minimum acceptable performance for the platform.
 *
 * Usage:
 *   import { SLO } from '@/lib/slo';
 *   if (latencyMs > SLO.API_P95_LATENCY_MS) logger.warn('SLO breach');
 *
 * Context:
 *   - Deployment: Vercel bom1 (Mumbai), serving Indian K-12 students
 *   - Target network: Indian 4G (2-5 Mbps)
 *   - Peak hours: 4-9 PM IST (after-school study time)
 */

// ── Availability ──

/** Monthly uptime target (fraction). 99.5% = ~3.6 hours downtime/month. */
export const UPTIME_TARGET = 0.995;

/** Error rate threshold (fraction). Requests returning 5xx. */
export const ERROR_RATE_THRESHOLD = 0.01;

// ── Latency targets (milliseconds) ──

/** API routes p95 latency. Most reads should complete well under this. */
export const API_P95_LATENCY_MS = 500;

/** Quiz submission p95. Includes atomic_quiz_profile_update RPC. */
export const QUIZ_SUBMISSION_P95_MS = 2_000;

/** Foxy AI tutor response p95. Includes Claude API call + streaming. */
export const FOXY_RESPONSE_P95_MS = 5_000;

/** Database query warning threshold. Queries slower than this get logged. */
export const DB_QUERY_WARN_MS = 200;

/** Slow request warning threshold for the request-timing wrapper. */
export const SLOW_REQUEST_THRESHOLD_MS = 1_000;

// ── Health check ──

/** Health check poll interval in milliseconds (used by external monitors). */
export const HEALTH_CHECK_INTERVAL_MS = 60_000;

/** Health check endpoint timeout. Individual check must respond within this. */
export const HEALTH_CHECK_TIMEOUT_MS = 3_000;

// ── Infrastructure limits ──

/** Supabase admin client fetch timeout. */
export const SUPABASE_FETCH_TIMEOUT_MS = 10_000;

/** Vercel serverless function hard timeout. */
export const VERCEL_FUNCTION_TIMEOUT_MS = 30_000;

/** Vercel SSR timeout. */
export const VERCEL_SSR_TIMEOUT_MS = 15_000;

// ── Bundle budgets (bytes) ──

/** Shared JS bundle max size. */
export const BUNDLE_SHARED_MAX_KB = 160;

/** Individual page bundle max size. */
export const BUNDLE_PAGE_MAX_KB = 260;

/** Middleware bundle max size. */
export const BUNDLE_MIDDLEWARE_MAX_KB = 120;

// ── Convenience export ──

export const SLO = {
  UPTIME_TARGET,
  ERROR_RATE_THRESHOLD,
  API_P95_LATENCY_MS,
  QUIZ_SUBMISSION_P95_MS,
  FOXY_RESPONSE_P95_MS,
  DB_QUERY_WARN_MS,
  SLOW_REQUEST_THRESHOLD_MS,
  HEALTH_CHECK_INTERVAL_MS,
  HEALTH_CHECK_TIMEOUT_MS,
  SUPABASE_FETCH_TIMEOUT_MS,
  VERCEL_FUNCTION_TIMEOUT_MS,
  VERCEL_SSR_TIMEOUT_MS,
  BUNDLE_SHARED_MAX_KB,
  BUNDLE_PAGE_MAX_KB,
  BUNDLE_MIDDLEWARE_MAX_KB,
} as const;
