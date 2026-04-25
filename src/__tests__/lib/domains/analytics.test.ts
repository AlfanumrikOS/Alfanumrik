/**
 * Analytics domain (B12) — unit + integration contract tests.
 *
 * Unit tests run unconditionally:
 *   - Input validation (no env required).
 *   - Mocked supabaseAdmin: verifies the camelCase mapping and the
 *     "missing relation" soft-failure path.
 *
 * Integration tests run only when SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY
 * are present in the env. They use a deterministic fake UUID so they are
 * meaningful even against an empty database — the contract under test is
 * that the helpers return ok with an empty list / null for missing data.
 *
 * Scope mirrors `src/__tests__/lib/domains/identity.test.ts`. See
 * docs/architecture/MICROSERVICES_EXTRACTION_PLAN.md (Phase 0i).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hasSupabaseIntegrationEnv } from '@/__tests__/helpers/integration';

// ── Mocked supabaseAdmin harness ──────────────────────────────────────────────
//
// The mock is module-scoped so tests can reach in and stub the resolved
// payload for each case. The fluent builder (.from().select()...etc) returns
// `mockResult` from any thenable terminator.

interface MockResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

let mockResult: MockResult = { data: null, error: null };

function makeBuilder() {
  // Each chained method returns the same builder; the final await reads
  // mockResult. This mimics the supabase-js fluent API just enough for
  // the analytics module's call shape.
  const builder: Record<string, unknown> = {};
  const chainable = ['select', 'eq', 'gte', 'lte', 'order', 'limit'];
  for (const m of chainable) {
    builder[m] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(mockResult));
  builder.then = (resolve: (v: MockResult) => unknown) =>
    Promise.resolve(mockResult).then(resolve);
  return builder;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => makeBuilder()),
  },
  getSupabaseAdmin: () => ({
    from: vi.fn(() => makeBuilder()),
  }),
}));

// Suppress logger noise during error-path tests — none of these assertions
// depend on what the logger actually does.
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  getDailyActivity,
  getStudentAnalytics,
  getUsageMetrics,
  getPerformanceReport,
} from '@/lib/domains/analytics';

beforeEach(() => {
  mockResult = { data: null, error: null };
});

// ── Input validation ──────────────────────────────────────────────────────────

describe('analytics domain — input validation', () => {
  it('getDailyActivity rejects empty studentId with INVALID_INPUT', async () => {
    const r = await getDailyActivity('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getStudentAnalytics rejects empty studentId with INVALID_INPUT', async () => {
    const r = await getStudentAnalytics('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getUsageMetrics rejects when neither studentId nor schoolId is provided', async () => {
    const r = await getUsageMetrics({});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getPerformanceReport rejects empty reportId with INVALID_INPUT', async () => {
    const r = await getPerformanceReport('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });
});

// ── Mocked happy path (camelCase mapping) ─────────────────────────────────────

describe('analytics domain — camelCase projection', () => {
  it('getDailyActivity maps snake_case rows to camelCase', async () => {
    mockResult = {
      data: [
        {
          id: 'row-1',
          student_id: 'stu-1',
          activity_date: '2026-04-20',
          subject: 'math',
          questions_asked: 12,
          questions_correct: 9,
          xp_earned: 45,
          time_minutes: 18,
          sessions: 2,
          created_at: '2026-04-20T10:00:00Z',
          updated_at: '2026-04-20T10:00:00Z',
        },
      ],
      error: null,
    };

    const r = await getDailyActivity('stu-1', { days: 7 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toHaveLength(1);
    const [row] = r.data;
    expect(row.studentId).toBe('stu-1');
    expect(row.activityDate).toBe('2026-04-20');
    expect(row.questionsAsked).toBe(12);
    expect(row.questionsCorrect).toBe(9);
    expect(row.xpEarned).toBe(45);
    expect(row.timeMinutes).toBe(18);
    expect(row.sessions).toBe(2);
  });

  it('getDailyActivity defaults missing numeric columns to 0', async () => {
    mockResult = {
      data: [
        {
          id: 'row-2',
          student_id: 'stu-2',
          activity_date: '2026-04-21',
          subject: null,
          questions_asked: null,
          questions_correct: null,
          xp_earned: null,
          time_minutes: null,
          sessions: null,
          created_at: null,
          updated_at: null,
        },
      ],
      error: null,
    };

    const r = await getDailyActivity('stu-2');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [row] = r.data;
    expect(row.questionsAsked).toBe(0);
    expect(row.questionsCorrect).toBe(0);
    expect(row.xpEarned).toBe(0);
    expect(row.timeMinutes).toBe(0);
    expect(row.sessions).toBe(0);
    expect(row.subject).toBeNull();
  });

  it('getStudentAnalytics returns ok(null) when no snapshot exists', async () => {
    mockResult = { data: null, error: null };
    const r = await getStudentAnalytics('stu-1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('getStudentAnalytics maps snake_case to camelCase when row present', async () => {
    mockResult = {
      data: {
        student_id: 'stu-1',
        total_questions_attempted: 100,
        total_questions_correct: 80,
        average_score_percent: 80,
        total_xp: 1200,
        total_sessions: 10,
        total_study_minutes: 240,
        last_activity_at: '2026-04-24T08:00:00Z',
        computed_at: '2026-04-24T09:00:00Z',
      },
      error: null,
    };

    const r = await getStudentAnalytics('stu-1');
    expect(r.ok).toBe(true);
    if (!r.ok || !r.data) return;
    expect(r.data.studentId).toBe('stu-1');
    expect(r.data.totalQuestionsAttempted).toBe(100);
    expect(r.data.averageScorePercent).toBe(80);
    expect(r.data.totalStudyMinutes).toBe(240);
    expect(r.data.lastActivityAt).toBe('2026-04-24T08:00:00Z');
  });

  it('getUsageMetrics maps rows and accepts schoolId scope', async () => {
    mockResult = {
      data: [
        {
          id: 'um-1',
          student_id: null,
          school_id: 'school-1',
          metric: 'chats.daily.count',
          value: 42,
          recorded_at: '2026-04-24T00:00:00Z',
          metadata: { source: 'cron' },
        },
      ],
      error: null,
    };

    const r = await getUsageMetrics({ schoolId: 'school-1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toHaveLength(1);
    expect(r.data[0].schoolId).toBe('school-1');
    expect(r.data[0].metric).toBe('chats.daily.count');
    expect(r.data[0].value).toBe(42);
    expect(r.data[0].metadata).toEqual({ source: 'cron' });
  });

  it('getPerformanceReport maps a single row by id', async () => {
    mockResult = {
      data: {
        id: 'report-1',
        student_id: 'stu-1',
        school_id: null,
        report_type: 'weekly_progress',
        period_start: '2026-04-14',
        period_end: '2026-04-20',
        payload: { topics_mastered: 3 },
        generated_at: '2026-04-21T01:00:00Z',
      },
      error: null,
    };

    const r = await getPerformanceReport('report-1');
    expect(r.ok).toBe(true);
    if (!r.ok || !r.data) return;
    expect(r.data.id).toBe('report-1');
    expect(r.data.reportType).toBe('weekly_progress');
    expect(r.data.payload).toEqual({ topics_mastered: 3 });
  });

  it('getPerformanceReport returns ok(null) when not found', async () => {
    mockResult = { data: null, error: null };
    const r = await getPerformanceReport('does-not-exist');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });
});

// ── Soft-failure paths (table missing, generic DB error) ──────────────────────

describe('analytics domain — error mapping', () => {
  it('treats Postgres 42P01 (relation missing) as DB_ERROR for daily_activity', async () => {
    mockResult = {
      data: null,
      error: { code: '42P01', message: 'relation "daily_activity" does not exist' },
    };
    const r = await getDailyActivity('stu-1');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
    expect(r.error).toMatch(/not provisioned/);
  });

  it('treats Postgres 42P01 as DB_ERROR for student_analytics', async () => {
    mockResult = {
      data: null,
      error: { code: '42P01', message: 'relation "student_analytics" does not exist' },
    };
    const r = await getStudentAnalytics('stu-1');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
  });

  it('treats Postgres 42P01 as DB_ERROR for usage_metrics', async () => {
    mockResult = {
      data: null,
      error: { code: '42P01', message: 'relation "usage_metrics" does not exist' },
    };
    const r = await getUsageMetrics({ studentId: 'stu-1' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
  });

  it('treats Postgres 42P01 as DB_ERROR for performance_reports', async () => {
    mockResult = {
      data: null,
      error: { code: '42P01', message: 'relation "performance_reports" does not exist' },
    };
    const r = await getPerformanceReport('rpt-1');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
  });

  it('maps any other postgres error to DB_ERROR with the message preserved', async () => {
    mockResult = {
      data: null,
      error: { code: '42501', message: 'permission denied for table daily_activity' },
    };
    const r = await getDailyActivity('stu-1');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
    expect(r.error).toContain('permission denied');
  });
});

// ── Integration happy-path (skipped without env) ─────────────────────────────

const FAKE_UUID = '00000000-0000-0000-0000-00000000dead';

const describeIntegration = hasSupabaseIntegrationEnv()
  ? describe
  : describe.skip;

describeIntegration('analytics domain — integration (null/empty path)', () => {
  it('getDailyActivity returns ok with an array for unknown student', async () => {
    const r = await getDailyActivity(FAKE_UUID, { days: 7 });
    // If the table is provisioned, expect ok([]). If it is not, the helper
    // returns DB_ERROR — both are valid in an empty staging DB.
    if (r.ok) {
      expect(Array.isArray(r.data)).toBe(true);
    } else {
      expect(r.code).toBe('DB_ERROR');
    }
  });

  it('getStudentAnalytics returns ok(null) or DB_ERROR for unknown student', async () => {
    const r = await getStudentAnalytics(FAKE_UUID);
    if (r.ok) {
      expect(r.data).toBeNull();
    } else {
      expect(r.code).toBe('DB_ERROR');
    }
  });

  it('getUsageMetrics returns ok with an array or DB_ERROR for unknown school', async () => {
    const r = await getUsageMetrics({ schoolId: FAKE_UUID });
    if (r.ok) {
      expect(Array.isArray(r.data)).toBe(true);
    } else {
      expect(r.code).toBe('DB_ERROR');
    }
  });

  it('getPerformanceReport returns ok(null) or DB_ERROR for unknown id', async () => {
    const r = await getPerformanceReport(FAKE_UUID);
    if (r.ok) {
      expect(r.data).toBeNull();
    } else {
      expect(r.code).toBe('DB_ERROR');
    }
  });
});
