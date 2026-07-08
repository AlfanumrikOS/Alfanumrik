/**
 * Phase 3B — School Command Center (Wave D) shared API contract for the
 * school-wide academic REPORTING read routes.
 *
 * These types are the single source of truth for the three read-only reporting
 * endpoints. They mirror EXACTLY the return shapes of the three Postgres
 * read-model RPCs created in
 * `supabase/migrations/20260614000003_phase3b_school_reporting.sql`:
 *
 *   - get_school_mastery_rollup(p_school_id, p_group_by) → TABLE → MasteryRollupRow[]
 *   - get_school_bloom_summary(p_school_id)              → TABLE → BloomSummaryRow[]
 *   - export_school_report(p_school_id)                  → jsonb → SchoolReportSnapshot
 *
 * Frontend (Wave D UI) imports these directly so the wire shape stays in lockstep
 * with the SQL contract. Do NOT widen/rename a field without updating the RPC.
 *
 * Numeric note: Postgres `numeric` and `bigint` arrive over PostgREST as JS
 * `number` (the read models round to 2–4dp and counts are bounded by school
 * size). Nullable numerics (avg_mastery with no signal) arrive as `null`.
 */

import { NextResponse } from 'next/server';
import { logger } from '@alfanumrik/lib/logger';
import type { SchoolOverview, SchoolDataState } from './command-center-types';

// ─── Grouping dimension for the mastery rollup ───────────────────────────────

/** The three valid `group_by` dimensions for get_school_mastery_rollup. */
export type MasteryGroupBy = 'grade' | 'subject' | 'teacher';

/** Default grouping when ?group_by is absent. Matches the RPC DEFAULT 'grade'. */
export const DEFAULT_MASTERY_GROUP_BY: MasteryGroupBy = 'grade';

/** The valid set, used to validate ?group_by before the RPC is ever called. */
export const VALID_MASTERY_GROUP_BY: ReadonlySet<string> = new Set<MasteryGroupBy>([
  'grade',
  'subject',
  'teacher',
]);

// ─── Row shapes (mirror the RETURNS TABLE columns exactly) ───────────────────

/**
 * One group row of the school-wide mastery comparatives. Maps the RETURNS TABLE
 * of get_school_mastery_rollup().
 *
 * `group_key` is TEXT in every mode (grade is a STRING per P5; subject is text;
 * teacher is the teacher uuid rendered as text). `avg_mastery` is the AVG of
 * per-student AVG(p_know) (0..1, 4dp); null when no group member has any mastery
 * signal.
 */
export interface MasteryRollupRow {
  group_key: string;
  /** Human-readable label (e.g. "Grade 7", the subject, the teacher name). */
  group_label: string;
  student_count: number;
  /** AVG of per-student AVG(p_know) (0..1, 4dp); null when no signal. */
  avg_mastery: number | null;
  /** Students in the group whose per-student avg p_know < 0.4. */
  at_risk_count: number;
}

/**
 * One Bloom's bucket of the school-wide distribution. Maps the RETURNS TABLE of
 * get_school_bloom_summary(). NULL/empty bloom_level is bucketed as
 * 'unspecified' by the RPC so the distribution is exhaustive.
 *
 * Bloom's level names (remember→understand→apply→analyze→evaluate→create) are
 * technical terms — NOT translated even when isHi (P7 exception).
 */
export interface BloomSummaryRow {
  bloom_level: string;
  response_count: number;
  correct_count: number;
  /** round(correct/total, 2); 0 when the bucket has no responses. */
  accuracy: number;
}

/**
 * One per-grade mastery row inside the exported aggregate snapshot. Mirrors the
 * jsonb objects in export_school_report().mastery_by_grade — note the key is
 * `grade` (not `group_key`) and `label` (not `group_label`) in the RPC's jsonb.
 */
export interface ReportGradeMasteryRow {
  grade: string;
  label: string;
  student_count: number;
  avg_mastery: number | null;
  at_risk_count: number;
}

/**
 * PII-SAFE aggregate snapshot. Return shape of export_school_report()'s jsonb.
 * AGGREGATES ONLY — no individual student names/emails/ids.
 */
export interface SchoolReportSnapshot {
  school_id: string;
  overview: SchoolOverview;
  mastery_by_grade: ReportGradeMasteryRow[];
  bloom_summary: BloomSummaryRow[];
  data_state: SchoolDataState;
  /** ISO timestamp the snapshot was generated (RPC now()). */
  generated_at: string;
}

// ─── Envelope types (what each route returns) ────────────────────────────────

/** GET /api/school-admin/reports/mastery → `{ data, group_by }`. */
export interface MasteryRollupResponse {
  data: MasteryRollupRow[];
  group_by: MasteryGroupBy;
}

/** GET /api/school-admin/reports/bloom → `{ data }`. */
export interface BloomSummaryResponse {
  data: BloomSummaryRow[];
}

// ─── Error mapping (reporting routes map BOTH 22023 and 42501) ───────────────

/**
 * Map a reporting RPC error to an HTTP response without leaking SQL (P13).
 *
 * Unlike the Wave A `rpcErrorResponse` (42501 → 403 only), the reporting RPCs can
 * also raise 22023 (invalid p_group_by) — though the routes validate group_by
 * BEFORE calling the RPC, this maps it defensively as a 400 should it ever reach
 * SQL. Everything else is a redacted 500.
 *   - Postgres 22023 (invalid p_group_by) → 400.
 *   - Postgres 42501 (in-RPC scope guard) → 403.
 *   - Anything else                       → 500, logged server-side.
 */
export function reportingRpcErrorResponse(
  err: { code?: string; message?: string } | null,
  routeName: string,
): NextResponse {
  if (err?.code === '22023') {
    return NextResponse.json(
      { success: false, error: 'Invalid group_by (expected grade | subject | teacher)' },
      { status: 400 },
    );
  }
  if (err?.code === '42501') {
    return NextResponse.json(
      { success: false, error: 'Not authorized for this school' },
      { status: 403 },
    );
  }
  logger.error('school_reporting_rpc_failed', {
    error: new Error(err?.message ?? 'RPC failed'),
    route: routeName,
  });
  return NextResponse.json(
    { success: false, error: 'Internal server error' },
    { status: 500 },
  );
}
