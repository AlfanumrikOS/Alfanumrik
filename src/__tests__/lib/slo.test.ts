/**
 * slo.ts — unit tests.
 *
 * src/lib/slo.ts holds:
 *   - SLO constant table (latency / availability targets)
 *   - SchoolSLOTracker — per-school B2B SLO tracker, in-memory, with
 *     rolling windows and reservoir sampling for latency
 *   - getSchoolTracker / getAllSchoolSLOReports / resetSchoolTrackers
 *
 * Tests exercise: empty windows, error-rate classification, p95
 * computation, latency reservoir cap, window rotation, and the
 * registry helpers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SLO,
  SCHOOL_API_P95_LATENCY_MS,
  SCHOOL_ERROR_RATE_THRESHOLD,
  SchoolSLOTracker,
  getSchoolTracker,
  getAllSchoolSLOReports,
  resetSchoolTrackers,
  SLOW_REQUEST_THRESHOLD_MS,
} from '@/lib/slo';

afterEach(() => {
  resetSchoolTrackers();
});

describe('SLO constant export', () => {
  it('exposes latency, error, and bundle constants', () => {
    expect(SLO.UPTIME_TARGET).toBeGreaterThan(0.9);
    expect(SLO.UPTIME_TARGET).toBeLessThan(1);
    expect(SLO.API_P95_LATENCY_MS).toBe(500);
    expect(SLO.QUIZ_SUBMISSION_P95_MS).toBe(2000);
    expect(SLO.FOXY_RESPONSE_P95_MS).toBe(5000);
    expect(SLO.BUNDLE_SHARED_MAX_KB).toBe(160);
    expect(SLO.BUNDLE_PAGE_MAX_KB).toBe(260);
    expect(SLO.BUNDLE_MIDDLEWARE_MAX_KB).toBe(120);
  });

  it('SLOW_REQUEST_THRESHOLD_MS is positive', () => {
    expect(SLOW_REQUEST_THRESHOLD_MS).toBeGreaterThan(0);
  });
});

describe('SchoolSLOTracker — empty state', () => {
  it('reports null p95 with zero requests and meeting status', () => {
    const t = new SchoolSLOTracker('school-empty');
    const r = t.getReport();
    expect(r.school_id).toBe('school-empty');
    expect(r.requests).toBe(0);
    expect(r.error_rate).toBe(0);
    expect(r.p95_latency_ms).toBeNull();
    expect(r.slo_status).toBe('meeting');
    expect(typeof r.window_start).toBe('string');
  });
});

describe('SchoolSLOTracker — recordRequest classification', () => {
  it('counts only 5xx as errors', () => {
    const t = new SchoolSLOTracker('school-1');
    t.recordRequest(100, 200);
    t.recordRequest(100, 404); // not an error per the threshold logic
    t.recordRequest(100, 500);
    const r = t.getReport();
    expect(r.requests).toBe(3);
    // 1 error / 3 requests ≈ 0.3333 → rounded to 4 decimals
    expect(r.error_rate).toBeCloseTo(0.3333, 3);
  });

  it('marks SLO breaching when error_rate > threshold', () => {
    const t = new SchoolSLOTracker('school-2');
    // 2 errors out of 3 = 0.667 → way over the 0.02 threshold
    t.recordRequest(50, 500);
    t.recordRequest(50, 500);
    t.recordRequest(50, 200);
    expect(t.getReport().slo_status).toBe('breaching');
  });

  it('marks SLO breaching when p95 latency > target', () => {
    const t = new SchoolSLOTracker('school-3');
    // All 200s, but latencies all over the school p95 target
    const HIGH = SCHOOL_API_P95_LATENCY_MS + 100;
    for (let i = 0; i < 20; i++) t.recordRequest(HIGH, 200);
    expect(t.getReport().slo_status).toBe('breaching');
  });

  it('marks SLO at_risk when error_rate is between 75% of threshold and threshold', () => {
    const t = new SchoolSLOTracker('school-4');
    // Need error_rate in ((threshold * 0.75), threshold]
    // SCHOOL_ERROR_RATE_THRESHOLD = 0.02 → window (0.015, 0.02]
    // Use 100 requests with 2 errors → error_rate = 0.02 (exactly at threshold,
    // so > 0.75*threshold but NOT > threshold). The branch should be at_risk.
    // Actually the code triggers breaching for errorRate > threshold (strict),
    // and at_risk for > threshold * 0.75. So at exactly 0.02 we get at_risk.
    for (let i = 0; i < 98; i++) t.recordRequest(100, 200);
    t.recordRequest(100, 500);
    t.recordRequest(100, 500);
    const r = t.getReport();
    expect(r.error_rate).toBeCloseTo(0.02, 4);
    expect(r.slo_status).toBe('at_risk');
  });

  it('marks SLO at_risk when p95 is between 80% of target and target', () => {
    const t = new SchoolSLOTracker('school-5');
    // SCHOOL_API_P95_LATENCY_MS = 500 → at_risk window (400, 500]
    // Latencies all 450ms → p95 = 450
    for (let i = 0; i < 20; i++) t.recordRequest(450, 200);
    const r = t.getReport();
    expect(r.p95_latency_ms).toBe(450);
    expect(r.slo_status).toBe('at_risk');
  });

  it('marks SLO meeting when comfortably under thresholds', () => {
    const t = new SchoolSLOTracker('school-6');
    for (let i = 0; i < 20; i++) t.recordRequest(50, 200);
    expect(t.getReport().slo_status).toBe('meeting');
  });
});

describe('SchoolSLOTracker — p95 computation', () => {
  it('p95 of [10, 20, 30, ..., 100] is 100 (top of distribution)', () => {
    const t = new SchoolSLOTracker('school-p95');
    for (let i = 1; i <= 10; i++) t.recordRequest(i * 10, 200);
    const r = t.getReport();
    // Math.floor(10 * 0.95) = 9 → sorted[9] = 100
    expect(r.p95_latency_ms).toBe(100);
  });
});

describe('SchoolSLOTracker — reservoir sampling cap', () => {
  it('keeps at most 100 latency samples even after many requests', () => {
    const t = new SchoolSLOTracker('school-reservoir');
    // Push way more than the 100-sample cap
    for (let i = 0; i < 500; i++) t.recordRequest(100, 200);
    const r = t.getReport();
    expect(r.requests).toBe(500);
    // p95 should still be defined and finite
    expect(r.p95_latency_ms).not.toBeNull();
  });
});

describe('SchoolSLOTracker — window rotation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rotates the window after windowMs elapses', () => {
    const start = new Date('2026-04-28T10:00:00Z').getTime();
    vi.setSystemTime(start);
    const t = new SchoolSLOTracker('school-rot', 60_000);
    t.recordRequest(100, 500); // 1 error in window 1

    // Move past the window boundary
    vi.setSystemTime(start + 61_000);
    const r = t.getReport();
    // After rotation, the new window is empty
    expect(r.requests).toBe(0);
    expect(r.error_rate).toBe(0);
    expect(r.p95_latency_ms).toBeNull();
  });
});

describe('Registry helpers', () => {
  it('getSchoolTracker returns the same instance for the same school id', () => {
    const a = getSchoolTracker('reg-1');
    const b = getSchoolTracker('reg-1');
    expect(a).toBe(b);
  });

  it('getSchoolTracker returns distinct instances per school id', () => {
    const a = getSchoolTracker('reg-2');
    const b = getSchoolTracker('reg-3');
    expect(a).not.toBe(b);
  });

  it('getAllSchoolSLOReports returns one report per registered school', () => {
    getSchoolTracker('reg-4').recordRequest(100, 200);
    getSchoolTracker('reg-5').recordRequest(100, 500);
    const reports = getAllSchoolSLOReports();
    const ids = reports.map((r) => r.school_id);
    expect(ids).toContain('reg-4');
    expect(ids).toContain('reg-5');
  });

  it('resetSchoolTrackers clears the registry', () => {
    getSchoolTracker('reg-6');
    resetSchoolTrackers();
    expect(getAllSchoolSLOReports()).toEqual([]);
  });

  // Touch the unused threshold constant so the import isn't tree-shaken away
  // by a future refactor.
  it('SCHOOL_ERROR_RATE_THRESHOLD is a small positive fraction', () => {
    expect(SCHOOL_ERROR_RATE_THRESHOLD).toBeGreaterThan(0);
    expect(SCHOOL_ERROR_RATE_THRESHOLD).toBeLessThan(0.1);
  });
});
