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
 *   // School-level SLO tracking
 *   import { SchoolSLOTracker } from '@/lib/slo';
 *   const tracker = new SchoolSLOTracker(schoolId);
 *   tracker.recordRequest(latencyMs, statusCode);
 *   const report = tracker.getReport();
 *
 * Context:
 *   - Deployment: Vercel bom1 (Mumbai), serving Indian K-12 students
 *   - Target network: Indian 4G (2-5 Mbps)
 *   - Peak hours: 4-9 PM IST (after-school study time)
 *   - B2B: Per-school SLO tracking for 5K-10K concurrent users
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

// ── B2B / School-Level SLO Targets ──

/** Per-school API p95 latency target. Same as global for now. */
export const SCHOOL_API_P95_LATENCY_MS = 500;

/** Per-school error rate threshold. Slightly more lenient for initial rollout. */
export const SCHOOL_ERROR_RATE_THRESHOLD = 0.02;

/** Cache hit rate target for school-scoped data. Below this triggers alert. */
export const SCHOOL_CACHE_HIT_RATE_TARGET = 0.70;

/** Concurrent user target per school instance. */
export const SCHOOL_CONCURRENT_USERS_TARGET = 500;

/** Maximum Redis latency for cache operations (milliseconds). */
export const REDIS_CACHE_P95_LATENCY_MS = 50;

// ── School SLO Tracker ──

interface SchoolSLOWindow {
  requests: number;
  errors: number;
  latencies: number[];
  startedAt: number;
}

/**
 * Per-school SLO tracker for B2B monitoring.
 *
 * Tracks request count, error rate, and latency distribution
 * within rolling windows. Designed to be held in-memory per
 * Vercel instance, aggregated by the observability endpoint.
 *
 * Memory budget: ~1KB per school per window (100 latency samples).
 * At 200 schools, that is ~200KB total -- well within budget.
 */
export class SchoolSLOTracker {
  private schoolId: string;
  private current: SchoolSLOWindow;
  private windowMs: number;

  /** Max latency samples kept per window to bound memory usage */
  private static readonly MAX_LATENCY_SAMPLES = 100;

  constructor(schoolId: string, windowMs: number = 60_000) {
    this.schoolId = schoolId;
    this.windowMs = windowMs;
    this.current = this.newWindow();
  }

  private newWindow(): SchoolSLOWindow {
    return {
      requests: 0,
      errors: 0,
      latencies: [],
      startedAt: Date.now(),
    };
  }

  private rotateIfNeeded(): void {
    if (Date.now() - this.current.startedAt >= this.windowMs) {
      this.current = this.newWindow();
    }
  }

  /**
   * Record a request for this school.
   * @param latencyMs - Response time in milliseconds
   * @param statusCode - HTTP status code (5xx counts as error)
   */
  recordRequest(latencyMs: number, statusCode: number): void {
    this.rotateIfNeeded();
    this.current.requests++;
    if (statusCode >= 500) {
      this.current.errors++;
    }
    // Reservoir sampling: keep up to MAX_LATENCY_SAMPLES entries
    if (this.current.latencies.length < SchoolSLOTracker.MAX_LATENCY_SAMPLES) {
      this.current.latencies.push(latencyMs);
    } else {
      // Replace a random entry to maintain uniform sampling
      const idx = Math.floor(Math.random() * this.current.requests);
      if (idx < SchoolSLOTracker.MAX_LATENCY_SAMPLES) {
        this.current.latencies[idx] = latencyMs;
      }
    }
  }

  /**
   * Compute p95 latency from collected samples.
   * Returns null if no samples collected.
   */
  private computeP95(): number | null {
    const sorted = [...this.current.latencies].sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const idx = Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1);
    return sorted[idx];
  }

  /**
   * Get the current SLO report for this school.
   */
  getReport(): {
    school_id: string;
    window_start: string;
    requests: number;
    error_rate: number;
    p95_latency_ms: number | null;
    slo_status: 'meeting' | 'at_risk' | 'breaching';
  } {
    this.rotateIfNeeded();
    const { requests, errors } = this.current;
    const errorRate = requests > 0 ? errors / requests : 0;
    const p95 = this.computeP95();

    // Determine SLO status
    let sloStatus: 'meeting' | 'at_risk' | 'breaching' = 'meeting';
    if (errorRate > SCHOOL_ERROR_RATE_THRESHOLD) {
      sloStatus = 'breaching';
    } else if (p95 !== null && p95 > SCHOOL_API_P95_LATENCY_MS) {
      sloStatus = 'breaching';
    } else if (errorRate > SCHOOL_ERROR_RATE_THRESHOLD * 0.75) {
      // Within 75% of threshold — at risk
      sloStatus = 'at_risk';
    } else if (p95 !== null && p95 > SCHOOL_API_P95_LATENCY_MS * 0.80) {
      // Within 80% of latency threshold — at risk
      sloStatus = 'at_risk';
    }

    return {
      school_id: this.schoolId,
      window_start: new Date(this.current.startedAt).toISOString(),
      requests,
      error_rate: Math.round(errorRate * 10000) / 10000,
      p95_latency_ms: p95 !== null ? Math.round(p95) : null,
      slo_status: sloStatus,
    };
  }
}

// ── School SLO Registry (in-memory, per Vercel instance) ──

const _schoolTrackers = new Map<string, SchoolSLOTracker>();

/**
 * Get or create an SLO tracker for a school.
 * Trackers are held in-memory per Vercel instance.
 */
export function getSchoolTracker(schoolId: string): SchoolSLOTracker {
  let tracker = _schoolTrackers.get(schoolId);
  if (!tracker) {
    tracker = new SchoolSLOTracker(schoolId);
    _schoolTrackers.set(schoolId, tracker);
  }
  return tracker;
}

/**
 * Get SLO reports for all tracked schools.
 * Used by the observability/health endpoint.
 */
export function getAllSchoolSLOReports(): ReturnType<SchoolSLOTracker['getReport']>[] {
  const reports: ReturnType<SchoolSLOTracker['getReport']>[] = [];
  _schoolTrackers.forEach(tracker => {
    reports.push(tracker.getReport());
  });
  return reports;
}

/**
 * Clear all school trackers. Used for testing or periodic reset.
 */
export function resetSchoolTrackers(): void {
  _schoolTrackers.clear();
}

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
  // B2B school-level targets
  SCHOOL_API_P95_LATENCY_MS,
  SCHOOL_ERROR_RATE_THRESHOLD,
  SCHOOL_CACHE_HIT_RATE_TARGET,
  SCHOOL_CONCURRENT_USERS_TARGET,
  REDIS_CACHE_P95_LATENCY_MS,
} as const;
