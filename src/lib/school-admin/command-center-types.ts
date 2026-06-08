/**
 * Phase 3B — School Command Center (Wave A) shared API contract.
 *
 * These types are the single source of truth for the three read-only Command
 * Center endpoints. They mirror EXACTLY the return shapes of the three Postgres
 * read-model RPCs created in
 * `supabase/migrations/20260614000000_phase3b_school_command_center_read_models.sql`:
 *
 *   - get_school_overview(p_school_id)      → jsonb  → SchoolOverview
 *   - get_classes_at_risk(p_school_id,…)    → TABLE  → ClassAtRiskRow[]
 *   - get_teacher_engagement(p_school_id,…) → TABLE  → TeacherEngagementRow[]
 *
 * Frontend (Wave B UI) imports these directly so the wire shape stays in lockstep
 * with the SQL contract. Do NOT widen/rename a field without updating the RPC.
 *
 * Numeric note: Postgres `numeric` and `bigint` arrive over PostgREST as JS
 * `number` (the read models round/clamp so they stay safe-integer or 2–4dp).
 * Nullable numerics (utilization/mastery with no signal) arrive as `null`.
 */

/** Whether the overview snapshot has real signal or is an empty school. */
export type SchoolDataState = 'live' | 'no_data';

/**
 * One-pass snapshot of a school. Return shape of get_school_overview()'s jsonb.
 * `seat_utilization_pct` and `avg_mastery` are null when there is no signal.
 */
export interface SchoolOverview {
  class_count: number;
  teacher_count: number;
  student_count: number;
  seats_purchased: number;
  active_students: number;
  /** % seats used (snapshot value, else derived); null when no seats/cap. */
  seat_utilization_pct: number | null;
  /** AVG BKT p_know (0..1, 4dp) across the active roster; null when none. */
  avg_mastery: number | null;
  data_state: SchoolDataState;
}

/** One row of the per-class risk rollup. Maps get_classes_at_risk() TABLE row. */
export interface ClassAtRiskRow {
  class_id: string;
  /** Display name (name + section + subject as available); never empty. */
  class_name: string;
  /** Grade as a string "6"–"12" (P5). May be null if the class has no grade. */
  grade: string | null;
  student_count: number;
  /** Students whose avg p_know < 0.4 (AT_RISK_PKNOW_THRESHOLD). */
  at_risk_count: number;
  /** AVG p_know (0..1, 4dp) across the class; null when no mastery signal. */
  avg_mastery: number | null;
}

/** One row of the per-teacher engagement rollup. Maps get_teacher_engagement(). */
export interface TeacherEngagementRow {
  teacher_id: string;
  /** Display name; never empty (defaults to 'Teacher' in SQL). */
  teacher_name: string;
  class_count: number;
  remediation_assigned_count: number;
  remediation_resolved_count: number;
}

// ─── Envelope types (what each route returns) ────────────────────────────────

/** GET /api/school-admin/overview → `{ data, data_state }`. */
export interface OverviewResponse {
  data: SchoolOverview;
  data_state: SchoolDataState;
}

/** Shared pagination envelope for the two list endpoints. */
export interface PaginatedListResponse<T> {
  data: T[];
  limit: number;
  offset: number;
  /** Number of rows in THIS page (rows.length), not a grand total. */
  count: number;
}

/** GET /api/school-admin/classes-at-risk → paginated ClassAtRiskRow page. */
export type ClassesAtRiskResponse = PaginatedListResponse<ClassAtRiskRow>;

/** GET /api/school-admin/teacher-engagement → paginated TeacherEngagementRow page. */
export type TeacherEngagementResponse = PaginatedListResponse<TeacherEngagementRow>;

// ─── Pagination constants (single source so routes + tests agree) ────────────

/** Default page size when ?limit is absent. Matches the RPC DEFAULT 20. */
export const DEFAULT_PAGE_LIMIT = 20;
/** Hard ceiling on ?limit. Matches the RPC's internal LEAST(...,100) clamp. */
export const MAX_PAGE_LIMIT = 100;
