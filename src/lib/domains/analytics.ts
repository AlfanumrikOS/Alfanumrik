/**
 * Analytics Domain (B12) — read-only projections of cross-context data.
 *
 * CONTRACT:
 *   - Every helper here is read-only. B12 never writes into another
 *     bounded context's tables.
 *   - Every helper uses `supabaseAdmin` (service role). The ESLint
 *     `no-restricted-imports` rule on `@/lib/supabase-admin` keeps these
 *     out of client components; `src/lib/domains/**` is in the allow-list.
 *   - Every helper returns ServiceResult<T> — no throws, no silent nulls.
 *   - Single-row lookups return `ServiceResult<T | null>`. Reserve
 *     `NOT_FOUND` for callers that want 404 semantics.
 *   - List queries return `ServiceResult<T[]>`. An empty array is `ok`.
 *   - Never `select('*')`. Map snake_case columns to the camelCase domain
 *     type once, here, so callers don't depend on database column names.
 *   - Grade coercion (P5) does not apply directly to analytics rows —
 *     analytics tables don't carry grade — but be defensive when adding
 *     new helpers that join into students/quiz_sessions.
 *
 * MISSING TABLES:
 *   Three of the four reference tables in DATA_OWNERSHIP_MATRIX.md
 *   (`student_analytics`, `usage_metrics`, `performance_reports`) do not
 *   yet exist as physical tables. The helpers below are still defined to
 *   lock the service contract. If the underlying table is missing at
 *   query time, Postgres returns error code `42P01`; we map this to a
 *   single warn log and a `DB_ERROR` ServiceResult so callers can degrade
 *   gracefully without crashing.
 *
 * MICROSERVICE EXTRACTION PATH:
 *   B12 is a candidate for early extraction because it is purely read-only
 *   against every other context. Wrap each function in an HTTP handler,
 *   add JWT validation, and the super-admin surfaces consume it via HTTP.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  ok,
  fail,
  type ServiceResult,
  type DailyActivity,
  type StudentAnalytics,
  type UsageMetric,
  type PerformanceReport,
} from './types';

// ── Postgres "relation does not exist" detection ──────────────────────────────
//
// When a referenced table is not yet provisioned (i.e. the planned
// analytics tables that are still aspirational), Postgres returns SQLSTATE
// 42P01. Treat this as a soft-failure DB_ERROR and warn once; never throw.

interface PgErrorLike {
  code?: string;
  message: string;
}

function isMissingRelation(err: PgErrorLike | null | undefined): boolean {
  if (!err) return false;
  if (err.code === '42P01') return true;
  // The supabase-js PostgrestError sometimes only surfaces the message text.
  return /relation .* does not exist/i.test(err.message ?? '');
}

// ── daily_activity (the only physical analytics table today) ──────────────────

type DailyActivityRow = {
  id: string;
  student_id: string;
  activity_date: string;
  subject: string | null;
  questions_asked: number | null;
  questions_correct: number | null;
  xp_earned: number | null;
  time_minutes: number | null;
  sessions: number | null;
  created_at: string | null;
  updated_at: string | null;
};

const DAILY_ACTIVITY_COLUMNS =
  'id, student_id, activity_date, subject, questions_asked, questions_correct, xp_earned, time_minutes, sessions, created_at, updated_at';

function mapDailyActivity(row: DailyActivityRow): DailyActivity {
  return {
    id: row.id,
    studentId: row.student_id,
    activityDate: row.activity_date,
    subject: row.subject,
    questionsAsked: row.questions_asked ?? 0,
    questionsCorrect: row.questions_correct ?? 0,
    xpEarned: row.xp_earned ?? 0,
    timeMinutes: row.time_minutes ?? 0,
    sessions: row.sessions ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Fetch the recent `daily_activity` rows for a student, newest-first.
 *
 * Returns up to `opts.days` calendar days back from today (default 30).
 * One student can have multiple rows per day (one per subject + one
 * subject-null aggregate row), so the caller should aggregate as needed.
 */
export async function getDailyActivity(
  studentId: string,
  opts: { days?: number } = {}
): Promise<ServiceResult<DailyActivity[]>> {
  if (!studentId) return fail('studentId is required', 'INVALID_INPUT');

  const days = Math.max(1, Math.min(opts.days ?? 30, 365));
  const since = new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from('daily_activity')
    .select(DAILY_ACTIVITY_COLUMNS)
    .eq('student_id', studentId)
    .gte('activity_date', since)
    .order('activity_date', { ascending: false });

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('analytics_daily_activity_table_missing', {
        message: error.message,
      });
      return fail('daily_activity table is not provisioned', 'DB_ERROR');
    }
    logger.error('analytics_get_daily_activity_failed', {
      error: new Error(error.message),
      studentId,
      days,
    });
    return fail(`daily_activity lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []).map((r) => mapDailyActivity(r as DailyActivityRow)));
}

// ── student_analytics (planned table) ─────────────────────────────────────────

type StudentAnalyticsRow = {
  student_id: string;
  total_questions_attempted: number | null;
  total_questions_correct: number | null;
  average_score_percent: number | null;
  total_xp: number | null;
  total_sessions: number | null;
  total_study_minutes: number | null;
  last_activity_at: string | null;
  computed_at: string | null;
};

const STUDENT_ANALYTICS_COLUMNS =
  'student_id, total_questions_attempted, total_questions_correct, average_score_percent, total_xp, total_sessions, total_study_minutes, last_activity_at, computed_at';

function mapStudentAnalytics(row: StudentAnalyticsRow): StudentAnalytics {
  return {
    studentId: row.student_id,
    totalQuestionsAttempted: row.total_questions_attempted,
    totalQuestionsCorrect: row.total_questions_correct,
    averageScorePercent: row.average_score_percent,
    totalXp: row.total_xp,
    totalSessions: row.total_sessions,
    totalStudyMinutes: row.total_study_minutes,
    lastActivityAt: row.last_activity_at,
    computedAt: row.computed_at,
  };
}

/**
 * Fetch the latest pre-computed analytics snapshot for a student. The
 * snapshot is maintained by the daily-cron job; this helper reads only.
 *
 * Returns `ok(null)` when the student has no snapshot yet (new account
 * or cron has not run since signup).
 */
export async function getStudentAnalytics(
  studentId: string
): Promise<ServiceResult<StudentAnalytics | null>> {
  if (!studentId) return fail('studentId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('student_analytics')
    .select(STUDENT_ANALYTICS_COLUMNS)
    .eq('student_id', studentId)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('analytics_student_analytics_table_missing', {
        message: error.message,
      });
      return fail('student_analytics table is not provisioned', 'DB_ERROR');
    }
    logger.error('analytics_get_student_analytics_failed', {
      error: new Error(error.message),
      studentId,
    });
    return fail(
      `student_analytics lookup failed: ${error.message}`,
      'DB_ERROR'
    );
  }

  return ok(data ? mapStudentAnalytics(data as StudentAnalyticsRow) : null);
}

// ── usage_metrics (planned table) ─────────────────────────────────────────────

type UsageMetricRow = {
  id: string;
  student_id: string | null;
  school_id: string | null;
  metric: string;
  value: number | null;
  recorded_at: string;
  metadata: Record<string, unknown> | null;
};

const USAGE_METRIC_COLUMNS =
  'id, student_id, school_id, metric, value, recorded_at, metadata';

function mapUsageMetric(row: UsageMetricRow): UsageMetric {
  return {
    id: row.id,
    studentId: row.student_id,
    schoolId: row.school_id,
    metric: row.metric,
    value: row.value ?? 0,
    recordedAt: row.recorded_at,
    metadata: row.metadata,
  };
}

/**
 * Fetch usage metrics with a bounded scope. Either `studentId` or
 * `schoolId` MUST be provided so callers cannot accidentally page the
 * entire table.
 *
 * Date filters are inclusive (`>=` start, `<=` end) and use ISO strings.
 * Newest-first order; up to 1000 rows.
 */
export async function getUsageMetrics(opts: {
  studentId?: string;
  schoolId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<ServiceResult<UsageMetric[]>> {
  if (!opts.studentId && !opts.schoolId) {
    return fail(
      'getUsageMetrics requires studentId or schoolId',
      'INVALID_INPUT'
    );
  }

  let query = supabaseAdmin
    .from('usage_metrics')
    .select(USAGE_METRIC_COLUMNS)
    .order('recorded_at', { ascending: false })
    .limit(1000);

  if (opts.studentId) query = query.eq('student_id', opts.studentId);
  if (opts.schoolId) query = query.eq('school_id', opts.schoolId);
  if (opts.startDate) query = query.gte('recorded_at', opts.startDate);
  if (opts.endDate) query = query.lte('recorded_at', opts.endDate);

  const { data, error } = await query;

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('analytics_usage_metrics_table_missing', {
        message: error.message,
      });
      return fail('usage_metrics table is not provisioned', 'DB_ERROR');
    }
    logger.error('analytics_get_usage_metrics_failed', {
      error: new Error(error.message),
      studentId: opts.studentId ?? null,
      schoolId: opts.schoolId ?? null,
    });
    return fail(`usage_metrics lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []).map((r) => mapUsageMetric(r as UsageMetricRow)));
}

// ── performance_reports (planned table) ───────────────────────────────────────

type PerformanceReportRow = {
  id: string;
  student_id: string | null;
  school_id: string | null;
  report_type: string;
  period_start: string | null;
  period_end: string | null;
  payload: Record<string, unknown> | null;
  generated_at: string;
};

const PERFORMANCE_REPORT_COLUMNS =
  'id, student_id, school_id, report_type, period_start, period_end, payload, generated_at';

function mapPerformanceReport(row: PerformanceReportRow): PerformanceReport {
  return {
    id: row.id,
    studentId: row.student_id,
    schoolId: row.school_id,
    reportType: row.report_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    payload: row.payload ?? {},
    generatedAt: row.generated_at,
  };
}

/**
 * Look up a single performance report by id. RLS handles caller-level
 * access; this helper does not enforce ownership on its own. Routes that
 * accept a user-supplied reportId MUST be authenticated via
 * `authorizeRequest` and gated to roles that legitimately consume reports
 * (super-admin, school-admin, parent of the linked student, the student).
 *
 * Returns `ok(null)` when the id does not resolve.
 */
export async function getPerformanceReport(
  reportId: string
): Promise<ServiceResult<PerformanceReport | null>> {
  if (!reportId) return fail('reportId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('performance_reports')
    .select(PERFORMANCE_REPORT_COLUMNS)
    .eq('id', reportId)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('analytics_performance_reports_table_missing', {
        message: error.message,
      });
      return fail(
        'performance_reports table is not provisioned',
        'DB_ERROR'
      );
    }
    logger.error('analytics_get_performance_report_failed', {
      error: new Error(error.message),
      reportId,
    });
    return fail(
      `performance_reports lookup failed: ${error.message}`,
      'DB_ERROR'
    );
  }

  return ok(
    data ? mapPerformanceReport(data as PerformanceReportRow) : null
  );
}
