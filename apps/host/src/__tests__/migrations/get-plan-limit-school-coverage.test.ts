/**
 * `get_plan_limit()` school coverage — LIVE-DB integration pins.
 *
 * These are architect's three condition-2 pins for
 * `supabase/migrations/20260729130400_get_plan_limit_school_coverage.sql`:
 *
 *   PIN 1  a pure-B2C student's limit is byte-identical to the pre-change value
 *   PIN 2  a school-covered student on a `trial` school resolves to the `pro` cap
 *   PIN 3  a personally-`unlimited` student under a `basic` school is NOT
 *          downgraded (GREATEST, never override)
 *
 * They execute plpgsql, so they CANNOT run in the unit lane. This file runs ONLY
 * under `RUN_INTEGRATION_TESTS=1` with real STAGING_SUPABASE_* secrets and skips
 * cleanly otherwise — the same guard as `seat-enforcement.test.ts` and
 * `school-command-center-read-models.test.ts`.
 *
 * ⚠️ HONEST COVERAGE STATEMENT (REG-329): on a normal PR these three pins DO NOT
 * EXECUTE. The unit-lane companion
 * `src/__tests__/get-plan-limit-school-coverage-structure.test.ts` is what gates
 * every PR, and it can only detect SOURCE drift (personal branch no longer
 * byte-identical, GREATEST replaced, tier map diverged from effective-plan.ts,
 * fail-soft removed). Do not read a green PR as "the school-coverage semantics
 * were verified".
 *
 * P13: every fixture is synthetic and torn down; no real student data.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';
import { ensureSubjects, SAFE_PREFERRED_SUBJECT_CODE } from './_helpers/reference-data';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

const RUN = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const created = {
  studentIds: [] as string[],
  schoolIds: [] as string[],
};

/** The pre-change free-tier caps (the migration's own documented fallback). */
const FREE_FOXY_FALLBACK = 5;

async function seedSchool(label: string, plan: string, status: string): Promise<string> {
  const { data: school, error } = await supabaseAdmin
    .from('schools')
    .insert({ name: `GPL-test ${label} ${RUN}`, board: 'CBSE', is_active: true })
    .select('id')
    .single();
  if (error || !school) throw new Error(`seed school failed: ${error?.message}`);
  created.schoolIds.push(school.id);

  const { error: subErr } = await supabaseAdmin
    .from('school_subscriptions')
    .insert({ school_id: school.id, plan, status, seats_purchased: 50 });
  if (subErr) throw new Error(`seed school_subscription failed: ${subErr.message}`);

  return school.id;
}

async function seedStudent(label: string, schoolId: string | null): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('students')
    .insert({
      // `students.name` is the real column (verified against
      // supabase/migrations/00000000000000_baseline_from_prod.sql and
      // src/types/database.types.ts — there is no `full_name` column;
      // other live-DB tests, e.g. atomic-quiz-xp-42p10-e2e.test.ts, use `name`).
      name: `GPL Test ${label} ${RUN}`,
      grade: '9', // P5 — string
      board: 'CBSE',
      school_id: schoolId,
      is_active: true,
      preferred_subject: SAFE_PREFERRED_SUBJECT_CODE,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed student failed: ${error?.message}`);
  created.studentIds.push(data.id);
  return data.id;
}

/** Cache so each distinct plan_code is only looked up once per test run. */
const planIdCache = new Map<string, string>();

/**
 * `student_subscriptions.plan_id` is `uuid NOT NULL` with a FK to
 * `subscription_plans.id` and no default (verified against
 * supabase/migrations/00000000000000_baseline_from_prod.sql — see
 * `student_subscriptions_plan_id_fkey` — and the `plan_id: string` (non-optional)
 * Insert type in src/types/database.types.ts). `plan_code` alone is not
 * sufficient to satisfy the insert.
 */
async function resolvePlanId(planCode: string): Promise<string> {
  const cached = planIdCache.get(planCode);
  if (cached) return cached;
  const { data, error } = await supabaseAdmin
    .from('subscription_plans')
    .select('id')
    .eq('plan_code', planCode)
    .maybeSingle();
  if (error || !data) {
    throw new Error(`no subscription_plans row for plan_code=${planCode}: ${error?.message}`);
  }
  planIdCache.set(planCode, data.id);
  return data.id;
}

async function giveStudentPlan(studentId: string, planCode: string) {
  const planId = await resolvePlanId(planCode);
  const { error } = await supabaseAdmin
    .from('student_subscriptions')
    .insert({ student_id: studentId, plan_id: planId, plan_code: planCode, status: 'active' });
  if (error) throw new Error(`seed student_subscription failed: ${error.message}`);
}

async function planLimit(studentId: string, feature: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('get_plan_limit', {
    p_student_id: studentId,
    p_feature: feature,
  });
  if (error) throw new Error(`get_plan_limit failed: ${error.message}`);
  return data as number;
}

/** The catalog cap for a consumer plan_code, i.e. the number the school branch must reach. */
async function catalogCap(planCode: string, column: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('subscription_plans')
    .select(column)
    .eq('plan_code', planCode)
    .maybeSingle();
  if (error) throw new Error(`catalog read failed: ${error.message}`);
  const raw = (data as Record<string, unknown> | null)?.[column];
  if (typeof raw !== 'number') throw new Error(`no ${planCode} catalog row`);
  return raw === -1 ? 999999 : raw;
}

describeIntegration('get_plan_limit — school coverage (live DB)', () => {
  let b2cFree = '';
  let b2cUnlimited = '';
  let trialSchoolStudent = '';
  let basicSchoolUnlimitedStudent = '';
  let inactiveSchoolStudent = '';

  beforeAll(async () => {
    await ensureSubjects(supabaseAdmin);

    const trialSchool = await seedSchool('trial', 'trial', 'trial');
    const basicSchool = await seedSchool('basic', 'basic', 'active');
    const deadSchool = await seedSchool('cancelled', 'enterprise', 'cancelled');

    b2cFree = await seedStudent('b2c-free', null);
    b2cUnlimited = await seedStudent('b2c-unlimited', null);
    await giveStudentPlan(b2cUnlimited, 'unlimited');

    trialSchoolStudent = await seedStudent('trial-school', trialSchool);

    basicSchoolUnlimitedStudent = await seedStudent('basic-school-unlimited', basicSchool);
    await giveStudentPlan(basicSchoolUnlimitedStudent, 'unlimited');

    inactiveSchoolStudent = await seedStudent('cancelled-school', deadSchool);
  }, 60_000);

  afterAll(async () => {
    for (const id of created.studentIds) {
      await supabaseAdmin.from('student_subscriptions').delete().eq('student_id', id);
      await supabaseAdmin.from('students').delete().eq('id', id);
    }
    for (const id of created.schoolIds) {
      await supabaseAdmin.from('school_subscriptions').delete().eq('school_id', id);
      await supabaseAdmin.from('schools').delete().eq('id', id);
    }
  }, 60_000);

  // ── PIN 1 ──────────────────────────────────────────────────────────────────

  it('PIN 1: a pure-B2C student with no school link is byte-identical to the pre-change value', async () => {
    // No subscription row at all → the migration's documented free fallback.
    expect(await planLimit(b2cFree, 'foxy_chat')).toBe(FREE_FOXY_FALLBACK);
    expect(await planLimit(b2cFree, 'notes')).toBe(2);
    expect(await planLimit(b2cFree, 'ai_total')).toBe(15);
  });

  it('PIN 1: a B2C student on a paid personal plan keeps exactly the catalog cap', async () => {
    const expected = await catalogCap('unlimited', 'foxy_chats_per_day');
    expect(await planLimit(b2cUnlimited, 'foxy_chat')).toBe(expected);
  });

  it('PIN 1: a school link with NO active/trial subscription contributes nothing', async () => {
    // The school exists and the student is linked, but its subscription is
    // cancelled — the branch must short-circuit to the personal value.
    expect(await planLimit(inactiveSchoolStudent, 'foxy_chat')).toBe(FREE_FOXY_FALLBACK);
  });

  // ── PIN 2 ──────────────────────────────────────────────────────────────────

  it('PIN 2: a student on a `trial` school resolves to the `pro` catalog cap, not free', async () => {
    const proCap = await catalogCap('pro', 'foxy_chats_per_day');
    const actual = await planLimit(trialSchoolStudent, 'foxy_chat');
    expect(actual).toBe(proCap);
    expect(actual).not.toBe(FREE_FOXY_FALLBACK);
  });

  it('PIN 2: the same student gets the pro quiz cap too (the boost is per-feature, not foxy-only)', async () => {
    const proQuiz = await catalogCap('pro', 'quizzes_per_day');
    expect(await planLimit(trialSchoolStudent, 'quiz')).toBe(proQuiz);
  });

  it('PIN 2: the DISPLAYED number (get_student_usage) equals the ENFORCED number', async () => {
    const { data, error } = await supabaseAdmin.rpc('get_student_usage', {
      p_student_id: trialSchoolStudent,
    });
    expect(error).toBeNull();
    const usage = data as Record<string, { used: number; limit: number }>;
    const enforced = await planLimit(trialSchoolStudent, 'foxy_chat');
    // get_student_usage folds 999999 back to the -1 display sentinel.
    const displayed = usage.foxy.limit === -1 ? 999999 : usage.foxy.limit;
    expect(displayed).toBe(enforced);
  });

  // ── PIN 3 ──────────────────────────────────────────────────────────────────

  it('PIN 3: a personally-`unlimited` student under a `basic` school is NOT downgraded', async () => {
    const personalCap = await catalogCap('unlimited', 'foxy_chats_per_day');
    const starterCap = await catalogCap('starter', 'quizzes_per_day');

    // basic school → starter tier, which is STRICTLY lower than unlimited.
    const actual = await planLimit(basicSchoolUnlimitedStudent, 'quiz');
    const personalQuiz = await catalogCap('unlimited', 'quizzes_per_day');

    expect(actual).toBe(personalQuiz);
    expect(actual).toBeGreaterThanOrEqual(starterCap);
    // And the foxy cap likewise stays at the personal (higher) value.
    expect(await planLimit(basicSchoolUnlimitedStudent, 'foxy_chat')).toBe(personalCap);
  });

  it('PIN 3: coverage is monotone — no student ever loses capacity across any feature', async () => {
    for (const feature of ['foxy_chat', 'quiz', 'notes', 'ai_total']) {
      const withSchool = await planLimit(basicSchoolUnlimitedStudent, feature);
      const withoutSchool = await planLimit(b2cUnlimited, feature);
      expect(withSchool, feature).toBeGreaterThanOrEqual(withoutSchool);
    }
  });
});
