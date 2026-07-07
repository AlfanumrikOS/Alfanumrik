/**
 * ALFANUMRIK — Effective-Plan Resolver (B2C ↔ B2B coexistence) — SERVER-ONLY
 * ==========================================================================
 *
 * Track A.5: individual student (B2C) subscriptions coexist with school (B2B)
 * subscriptions. CEO decision: a student covered by their school's plan must
 * NOT be double-charged or offered a redundant personal plan, while a genuine
 * personal UPGRADE above the school tier stays purchasable.
 *
 * THE QUESTION THIS ANSWERS: "What plan tier does this student EFFECTIVELY
 * have, and where does it come from?"
 *
 * ─── Effective plan = HIGHEST tier among three sources ──────────────────────
 *   (a) SCHOOL coverage  — student.school_id present
 *                          AND the school has an active|trial school_subscription
 *                          AND the student occupies a SEAT (an active roster row
 *                          on class_students OR class_enrollments — the exact
 *                          Phase 3B "active student of a school" definition).
 *   (b) PERSONAL (B2C)   — the student's own active|past_due student_subscription
 *                          (past_due is still in grace → still full access, per
 *                          the payment-flow skill's grace rule).
 *   (c) FREE             — the floor. Always present.
 *
 * The winner is whichever has the HIGHEST tier (planTier from plans.ts — the
 * ONE ranking). Ties resolve to the SCHOOL source (school coverage is "free to
 * the student", so when school == personal there is nothing to buy).
 *
 * ─── Tier ordering: ONE source of truth ────────────────────────────────────
 * `planTier(code)` in `src/lib/plans.ts` (0=free, 1=starter, 2=pro,
 * 3=unlimited) is the single ranking. This module NEVER hardcodes a second
 * ordering. The B2B `school_subscriptions.plan` text is mapped into the same
 * consumer tier space via `normalizeSchoolPlanToConsumerCode` (which reuses
 * `normalizePlanCode` + an explicit B2B-tier alias map) so a school plan and a
 * personal plan are compared on ONE axis.
 *
 * ─── canUpgrade ────────────────────────────────────────────────────────────
 * True when there EXISTS a higher consumer tier than the student's effective
 * tier (i.e. effective tier < the max tier 'unlimited'). The checkout/redundant-
 * purchase guard uses the richer `isRedundantPurchase()` to decide a SPECIFIC
 * requested plan; `canUpgrade` is the coarse "is any upgrade still possible"
 * signal for the coverage endpoint / UI.
 *
 * ─── Backward compatibility (CRITICAL) ──────────────────────────────────────
 *   - B2C-only student (school_id NULL): source is 'personal' or 'free',
 *     schoolCoverage is undefined — EXACTLY today's behavior. The personal
 *     subscription governs.
 *   - Free-tier student (no sub, no school): source 'free' — today's behavior.
 *   - A school-covered student whose PERSONAL plan is higher: source 'personal'
 *     (the upgrade they paid for wins). No entitlement is ever lowered by school
 *     coverage.
 *
 * All DB reads go through supabaseAdmin (service role). SERVER-ONLY — never
 * import into client code (P8). P13: returns tiers/codes/ids the caller already
 * owns; never logs PII.
 */

import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { planTier, normalizePlanCode, type PlanConfig } from '@alfanumrik/lib/plans';

// ─── Canonical consumer plan codes (lockstep with plans.ts / catalog.ts) ─────

export type ConsumerPlanCode = 'free' | 'starter' | 'pro' | 'unlimited';

/** The highest tier code (the ceiling above which no upgrade exists). */
const MAX_TIER_CODE: ConsumerPlanCode = 'unlimited';

/**
 * B2B `school_subscriptions.plan` text → consumer tier code.
 *
 * The B2B billing tiers (basic/standard/premium/enterprise — see
 * src/lib/pricing.ts SCHOOL_SEAT_TIER_INR) and the 'trial' default do NOT map
 * 1:1 onto the consumer plan codes, so we map them explicitly here and then run
 * the result through `normalizePlanCode` (which also folds basic→starter,
 * premium→pro, ultimate→unlimited and strips _monthly/_yearly). Anything we
 * don't recognise falls through to `normalizePlanCode` directly, and finally to
 * 'free' if still unknown — fail-closed (never grant a tier we can't justify).
 *
 * NOTE: CEO/ops policy for the live B2B→consumer tier mapping. A school on
 * 'trial' or 'standard'/'enterprise' grants the consumer-equivalent tier below.
 * Adjust here (single place) if the institution plan catalog changes.
 */
const SCHOOL_PLAN_TO_CONSUMER: Record<string, ConsumerPlanCode> = {
  trial: 'pro',        // trial schools get full module access (pro-equivalent)
  basic: 'starter',
  standard: 'pro',
  premium: 'pro',
  enterprise: 'unlimited',
  school_premium: 'unlimited',
};

/**
 * Map a raw `school_subscriptions.plan` value into the consumer tier space so
 * it can be compared against a B2C plan on the ONE `planTier` axis.
 */
export function normalizeSchoolPlanToConsumerCode(
  raw: string | null | undefined,
): ConsumerPlanCode {
  const base = (raw ?? '').toLowerCase().trim();
  if (base in SCHOOL_PLAN_TO_CONSUMER) return SCHOOL_PLAN_TO_CONSUMER[base];
  // Fall through to the canonical consumer normaliser (handles starter/pro/
  // unlimited + legacy aliases + billing-cycle suffixes); unknown → 'free'.
  const normalized = normalizePlanCode(base) as string;
  const valid: ReadonlySet<string> = new Set(['free', 'starter', 'pro', 'unlimited']);
  return (valid.has(normalized) ? normalized : 'free') as ConsumerPlanCode;
}

// ─── Result type ─────────────────────────────────────────────────────────────

export interface SchoolCoverage {
  /** The consumer-tier code the school coverage provides (e.g. 'pro'). */
  plan: ConsumerPlanCode;
  /** The covering school's id (the caller already owns this — it's the
   *  student's own school_id; not cross-tenant PII). */
  schoolId: string;
}

export interface EffectiveEntitlement {
  /** The winning (highest) consumer-tier code. */
  effectivePlan: ConsumerPlanCode;
  /** Where the effective plan came from. */
  source: 'school' | 'personal' | 'free';
  /** Present only when the student is covered by their school (whether or not
   *  that coverage is the winning source). Lets the UI say "covered by your
   *  school" even when a personal upgrade is the active source. */
  schoolCoverage?: SchoolCoverage;
  /** The student's own active|grace personal plan code, when they have one. */
  personalPlan?: ConsumerPlanCode;
  /** True when a strictly-higher consumer tier than `effectivePlan` exists. */
  canUpgrade: boolean;
}

// ─── DB row shapes ───────────────────────────────────────────────────────────

interface StudentRow {
  id: string;
  school_id: string | null;
}

// Personal subscription statuses that STILL grant full plan access:
//   'active'   — paid + current
//   'past_due' — payment failed but inside the grace window (payment-flow skill)
// 'cancelled' is intentionally EXCLUDED here: a cancelled sub runs until
// current_period_end, but the canonical access source for a cancelled-but-still-
// in-period sub is `students.subscription_plan` (kept in sync by the webhook),
// which is read separately below as the personal-plan signal. We treat the
// student_subscriptions row as the live recurring signal and fall back to
// students.subscription_plan for the "what plan do they currently hold" code.
const PERSONAL_ACTIVE_STATUSES: ReadonlySet<string> = new Set(['active', 'past_due']);

// ─── Internal: resolve school coverage for a student ─────────────────────────

/**
 * Does this student occupy a seat in a school that has an active|trial school
 * subscription? Returns the consumer-tier coverage, or null.
 *
 * "Occupies a seat" = has an ACTIVE roster row on class_students OR
 * class_enrollments for an active, non-deleted class of the school — the exact
 * Phase 3B "active student of a school" definition (seat enforcement counts
 * precisely these students). A school-linked student with NO roster row
 * consumes no seat and therefore is NOT covered.
 */
async function resolveSchoolCoverage(
  studentId: string,
  schoolId: string,
): Promise<SchoolCoverage | null> {
  // 1. The school must have an active|trial subscription. Pick the strongest
  //    active row deterministically (highest seats, then newest) — mirrors the
  //    Phase 3B seat RPCs' active-row selection.
  const { data: sub, error: subErr } = await supabaseAdmin
    .from('school_subscriptions')
    .select('plan, status, seats_purchased, created_at')
    .eq('school_id', schoolId)
    .in('status', ['active', 'trial'])
    .order('seats_purchased', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (subErr) {
    // Fail-closed: a transient lookup error must NEVER fabricate coverage.
    logger.warn('effective_plan_school_sub_lookup_failed', {
      route: 'entitlements/effective-plan',
      error: subErr.message,
    });
    return null;
  }
  if (!sub) return null; // school has no active|trial subscription → no coverage

  // 2. The student must occupy a seat (active roster row, either table).
  const occupiesSeat = await studentOccupiesSeat(studentId, schoolId);
  if (!occupiesSeat) return null;

  return {
    plan: normalizeSchoolPlanToConsumerCode(sub.plan as string | null),
    schoolId,
  };
}

/**
 * True iff the student has an ACTIVE roster row (class_students OR
 * class_enrollments) on an active, non-deleted class of THIS school. This is
 * the seat-occupancy definition; it is intentionally the per-student probe of
 * the Phase 3B `_school_active_student_ids` set.
 *
 * Implemented in two steps (mirrors the Phase 3B SQL and avoids depending on
 * PostgREST relationship-name resolution for the embedded filter): (1) fetch
 * the school's active, non-deleted class ids; (2) probe BOTH roster tables for
 * an active membership row in any of those classes, short-circuiting. The
 * indexes idx_class_students_student_active / idx_class_enrollments_student
 * (WHERE is_active) back the membership probes.
 */
async function studentOccupiesSeat(studentId: string, schoolId: string): Promise<boolean> {
  // 1. Active, non-deleted classes of THIS school.
  const { data: classes, error: clsErr } = await supabaseAdmin
    .from('classes')
    .select('id')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .is('deleted_at', null);

  if (clsErr) {
    logger.warn('effective_plan_seat_classes_lookup_failed', {
      route: 'entitlements/effective-plan',
      error: clsErr.message,
    });
    return false; // fail-closed
  }
  const classIds = (classes ?? []).map((c) => c.id as string);
  if (classIds.length === 0) return false; // no classes → no seat

  // 2a. class_students path: active membership row in any of those classes.
  const { data: csRows, error: csErr } = await supabaseAdmin
    .from('class_students')
    .select('class_id')
    .eq('student_id', studentId)
    .eq('is_active', true)
    .in('class_id', classIds)
    .limit(1);

  if (csErr) {
    logger.warn('effective_plan_seat_probe_cs_failed', {
      route: 'entitlements/effective-plan',
      error: csErr.message,
    });
    // Fall through to the class_enrollments probe rather than failing outright.
  } else if (csRows && csRows.length > 0) {
    return true;
  }

  // 2b. class_enrollments path (the bulk-import / enroll-PAGE roster table).
  const { data: ceRows, error: ceErr } = await supabaseAdmin
    .from('class_enrollments')
    .select('class_id')
    .eq('student_id', studentId)
    .eq('is_active', true)
    .in('class_id', classIds)
    .limit(1);

  if (ceErr) {
    logger.warn('effective_plan_seat_probe_ce_failed', {
      route: 'entitlements/effective-plan',
      error: ceErr.message,
    });
    return false; // fail-closed
  }

  return !!(ceRows && ceRows.length > 0);
}

// ─── Internal: resolve the student's own personal (B2C) plan ─────────────────

/**
 * Resolve the student's active personal plan code, or 'free'. Reads the live
 * recurring `student_subscriptions` row (active|past_due grants access); if that
 * is absent/free, falls back to `students.subscription_plan` (the column the
 * webhook keeps in sync, which also covers the cancelled-but-still-in-period
 * case). Returns 'free' when neither grants a paid tier.
 */
async function resolvePersonalPlan(studentId: string): Promise<ConsumerPlanCode> {
  const { data: sub, error } = await supabaseAdmin
    .from('student_subscriptions')
    .select('plan_code, status')
    .eq('student_id', studentId)
    .maybeSingle();

  if (error) {
    logger.warn('effective_plan_personal_sub_lookup_failed', {
      route: 'entitlements/effective-plan',
      error: error.message,
    });
    // Fall back to the students.subscription_plan column below.
  } else if (sub && PERSONAL_ACTIVE_STATUSES.has(sub.status as string)) {
    const code = normalizePlanCode(sub.plan_code as string) as string;
    if (code !== 'free') return toConsumerCode(code);
  }

  // Fallback: the denormalised plan column on students (webhook-synced).
  const { data: studentPlan } = await supabaseAdmin
    .from('students')
    .select('subscription_plan')
    .eq('id', studentId)
    .maybeSingle();

  const fallback = normalizePlanCode(studentPlan?.subscription_plan as string | null) as string;
  return toConsumerCode(fallback);
}

function toConsumerCode(code: string): ConsumerPlanCode {
  const valid: ReadonlySet<string> = new Set(['free', 'starter', 'pro', 'unlimited']);
  return (valid.has(code) ? code : 'free') as ConsumerPlanCode;
}

// ─── Public: the effective-entitlement resolver ──────────────────────────────

/**
 * Resolve a student's EFFECTIVE plan from a known studentId (+ optional known
 * school_id to save a lookup).
 *
 * This is the single source of truth for "what plan does this student
 * effectively have". `plan-gate.ts` consults it (via `resolveEffectivePlanCode`)
 * so a school-covered student is gated at their effective tier, and the checkout
 * routes consult it to avoid redundant purchases.
 */
export async function resolveEffectiveEntitlement(
  studentId: string,
  knownSchoolId?: string | null,
): Promise<EffectiveEntitlement> {
  // Resolve the student's school_id if not supplied.
  let schoolId: string | null = knownSchoolId ?? null;
  if (knownSchoolId === undefined) {
    const { data: student } = await supabaseAdmin
      .from('students')
      .select('id, school_id')
      .eq('id', studentId)
      .maybeSingle<StudentRow>();
    schoolId = student?.school_id ?? null;
  }

  // Resolve the two paid sources in parallel (school coverage requires a
  // school_id; personal is always checked).
  const [coverage, personalPlan] = await Promise.all([
    schoolId ? resolveSchoolCoverage(studentId, schoolId) : Promise.resolve(null),
    resolvePersonalPlan(studentId),
  ]);

  return assembleEffective(coverage, personalPlan);
}

/**
 * Resolve a student's effective entitlement from their AUTH user id (the
 * checkout/coverage routes hold the auth user, not the student row id).
 * Returns null when the auth user is not a student (no students row).
 */
export async function resolveEffectiveEntitlementForUser(
  authUserId: string,
): Promise<{ studentId: string; entitlement: EffectiveEntitlement } | null> {
  if (!authUserId) return null;
  const { data: student, error } = await supabaseAdmin
    .from('students')
    .select('id, school_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle<StudentRow>();

  if (error) {
    logger.warn('effective_plan_user_student_lookup_failed', {
      route: 'entitlements/effective-plan',
      error: error.message,
    });
    return null;
  }
  if (!student) return null;

  const entitlement = await resolveEffectiveEntitlement(student.id, student.school_id);
  return { studentId: student.id, entitlement };
}

/**
 * Convenience for plan-gate.ts and other callers that only need the effective
 * plan CODE for a student (not the full structured result).
 */
export async function resolveEffectivePlanCode(
  studentId: string,
  knownSchoolId?: string | null,
): Promise<ConsumerPlanCode> {
  const { effectivePlan } = await resolveEffectiveEntitlement(studentId, knownSchoolId);
  return effectivePlan;
}

// ─── Pure assembly (testable without DB) ─────────────────────────────────────

/**
 * Combine the (already-resolved) school coverage and personal plan into the
 * structured effective-entitlement result. Pure — no I/O. Tie (school ==
 * personal tier) resolves to 'school' (coverage is free to the student, so
 * there's nothing to buy).
 */
export function assembleEffective(
  coverage: SchoolCoverage | null,
  personalPlan: ConsumerPlanCode,
): EffectiveEntitlement {
  const schoolTier = coverage ? planTier(coverage.plan) : -1;
  const personalT = planTier(personalPlan);

  let effectivePlan: ConsumerPlanCode;
  let source: EffectiveEntitlement['source'];

  if (coverage && schoolTier >= personalT) {
    // School wins outright OR ties → school is the source (free to the student).
    effectivePlan = coverage.plan;
    source = 'school';
  } else if (personalT > 0) {
    effectivePlan = personalPlan;
    source = 'personal';
  } else {
    effectivePlan = 'free';
    source = 'free';
  }

  const result: EffectiveEntitlement = {
    effectivePlan,
    source,
    canUpgrade: planTier(effectivePlan) < planTier(MAX_TIER_CODE),
  };
  if (coverage) result.schoolCoverage = coverage;
  if (personalT > 0) result.personalPlan = personalPlan;
  return result;
}

// ─── Redundant-purchase decision (used by checkout pre-checks) ───────────────

export interface RedundancyVerdict {
  /** True when the requested plan adds NO entitlement over school coverage
   *  (requested tier <= school-provided tier). The checkout route returns a
   *  structured `already_covered` response in this case (NOT a hard error). */
  redundant: boolean;
  /** Present when redundant: the consumer-tier code the school already provides. */
  schoolPlan?: ConsumerPlanCode;
}

/**
 * Decide whether a requested B2C plan purchase is REDUNDANT given the student's
 * school coverage.
 *
 * RULE (CEO): a purchase is redundant ONLY when the student is covered by their
 * school AND the requested tier is <= the school-provided tier (it adds no
 * entitlement). A request that EXCEEDS the school tier is a genuine UPGRADE and
 * is NEVER blocked. A student with no school coverage is never blocked here
 * (B2C-only behavior is unchanged).
 *
 * This compares ONLY against school coverage, not the student's own existing
 * personal plan — duplicate-personal-plan handling stays in the subscribe route
 * (the existing 409 "already have an active subscription" check is untouched).
 */
export function isRedundantPurchase(
  entitlement: EffectiveEntitlement,
  requestedPlan: string,
): RedundancyVerdict {
  const coverage = entitlement.schoolCoverage;
  if (!coverage) return { redundant: false }; // no school → never redundant

  const requestedTier = planTier(requestedPlan);
  const schoolTier = planTier(coverage.plan);

  if (requestedTier <= schoolTier) {
    return { redundant: true, schoolPlan: coverage.plan };
  }
  return { redundant: false }; // genuine upgrade above the school tier
}

// Re-export for callers that want the plan config of the effective plan.
export type { PlanConfig };
