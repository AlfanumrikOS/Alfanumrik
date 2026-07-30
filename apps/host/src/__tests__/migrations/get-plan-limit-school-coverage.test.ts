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
import { hasSupabaseIntegrationEnv, skipIfNoSubstrate } from '../helpers/integration';
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

/**
 * The `subscription_plans` catalog rows this suite is pinned to.
 *
 * IMPORTANT — unlike `subjects` (seeded idempotently by `ensureSubjects()`
 * below), `subscription_plans` is commercial pricing data with NO seed
 * migration anywhere in this repo. `grep`-confirmed: there is no
 * `INSERT INTO subscription_plans` / `COPY subscription_plans` in any file
 * under `supabase/migrations/` (see the same finding documented in
 * `supabase/migrations/20260729130500_get_student_usage_single_limit_authority.sql`
 * lines ~92-95). The `free`/`starter`/`pro`/`unlimited` rows exist in
 * PRODUCTION only because the pg_dump baseline
 * (`00000000000000_baseline_from_prod.sql`) captured live prod DATA for this
 * one table incidentally — it is otherwise schema-only. A migration-only
 * CI/staging DB built purely from `supabase db push` therefore has NO
 * guarantee of carrying these rows.
 *
 * Rather than hardcode `plan_code` literals and let a missing row surface as
 * a confusing mid-`beforeAll` throw (which is what broke CI: `resolvePlanId`
 * failed on 'unlimited' with `error: undefined` because there was truly no
 * row, not because the query was wrong), this suite resolves ALL the
 * plan_codes its assertions need in ONE query up front, before seeding
 * anything, and gates every test behind `skipIfNoSubstrate` — the same
 * "seed-less CI Supabase DB" idiom already used by
 * `migrations/atomic-quiz-xp-42p10-e2e.test.ts` and friends (see
 * `../helpers/integration.ts`). A missing catalog row becomes a loud SKIP,
 * not a hard FAIL, and never silently weakens an assertion that DOES run.
 *
 * 'free' is deliberately NOT in this list: every assertion that touches the
 * free tier (`FREE_FOXY_FALLBACK`, the `notes`/`ai_total` literals in PIN 1)
 * pins the SQL function's own hardcoded fallback constants
 * (`get_plan_limit`'s `IF v_plan IS NULL THEN v_plan := 'free'` branch and
 * its literal CASE arms), not a `subscription_plans` catalog row — so it
 * does not depend on this table having a 'free' row at all.
 */
const REQUIRED_PLAN_CODES = ['starter', 'pro', 'unlimited'] as const;

interface PlanCatalogRow {
  id: string;
  foxy_chats_per_day: number;
  quizzes_per_day: number;
}

/** Populated once in `beforeAll` from a single query; never re-queried per-test. */
const planCatalog = new Map<string, PlanCatalogRow>();

/**
 * `student_subscriptions.plan_id` is `uuid NOT NULL` with a FK to
 * `subscription_plans.id` and no default (verified against
 * supabase/migrations/00000000000000_baseline_from_prod.sql — see
 * `student_subscriptions_plan_id_fkey` — and the `plan_id: string` (non-optional)
 * Insert type in src/types/database.types.ts). `plan_code` alone is not
 * sufficient to satisfy the insert.
 *
 * Reads the `beforeAll`-populated cache only — by the time any caller reaches
 * this, `REQUIRED_PLAN_CODES` presence has already been gated, so a miss here
 * would mean the gate itself has a bug, not a legitimately-missing row.
 */
function resolvePlanId(planCode: string): string {
  const row = planCatalog.get(planCode);
  if (!row) {
    throw new Error(
      `resolvePlanId: no cached subscription_plans row for plan_code=${planCode} — ` +
        `expected the beforeAll catalog gate to have already caught this as a skip`,
    );
  }
  return row.id;
}

async function giveStudentPlan(studentId: string, planCode: string) {
  const planId = resolvePlanId(planCode);
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

/**
 * The catalog cap for a consumer plan_code, i.e. the number the school branch
 * must reach. Reads the `beforeAll`-populated cache — see `planCatalog` above.
 */
function catalogCap(planCode: string, column: 'foxy_chats_per_day' | 'quizzes_per_day'): number {
  const row = planCatalog.get(planCode);
  if (!row) {
    throw new Error(
      `catalogCap: no cached subscription_plans row for plan_code=${planCode} — ` +
        `expected the beforeAll catalog gate to have already caught this as a skip`,
    );
  }
  const raw = row[column];
  if (typeof raw !== 'number') throw new Error(`catalogCap: ${planCode}.${column} is not numeric`);
  return raw === -1 ? 999999 : raw;
}

/**
 * Insert one `institution_entitlements` row for a school. `value` is the raw
 * jsonb the resolver must coerce — some callers (PIN 5 below) intentionally
 * pass a MALFORMED shape to prove `coerce_institution_limit_max` fails soft.
 * No explicit teardown is needed: `institution_entitlements.school_id` is
 * `ON DELETE CASCADE` (migration 20260615205752), so a seeded row is removed
 * automatically when the outer `afterAll` deletes `created.schoolIds`.
 */
async function seedInstitutionOverride(
  schoolId: string,
  entitlementKey: string,
  value: Record<string, unknown>,
  window?: { effectiveFrom?: string; effectiveTo?: string },
): Promise<void> {
  const { error } = await supabaseAdmin.from('institution_entitlements').insert({
    school_id: schoolId,
    entitlement_key: entitlementKey,
    value,
    effective_from: window?.effectiveFrom ?? null,
    effective_to: window?.effectiveTo ?? null,
  });
  if (error) throw new Error(`seed institution_entitlements failed: ${error.message}`);
}

/**
 * Cover a student via the ROSTER path (`class_students`), not the direct
 * `students.school_id` link — the second of the three UNION arms
 * `get_plan_limit`'s candidate-school CTE reads. `classes.school_id` and
 * `class_students.class_id`/`.student_id` are all `ON DELETE CASCADE`
 * (baseline schema), so the created class/class_students rows are cleaned up
 * automatically when the outer `afterAll` deletes the school or the student —
 * no separate tracking array is needed.
 */
async function linkStudentViaClassRoster(
  studentId: string,
  schoolId: string,
  label: string,
): Promise<void> {
  const { data: cls, error: clsErr } = await supabaseAdmin
    .from('classes')
    .insert({ school_id: schoolId, name: `GPL-IO ${label} ${RUN}`, grade: '9', is_active: true })
    .select('id')
    .single();
  if (clsErr || !cls) throw new Error(`seed class failed: ${clsErr?.message}`);
  const { error: linkErr } = await supabaseAdmin
    .from('class_students')
    .insert({ class_id: (cls as { id: string }).id, student_id: studentId, is_active: true });
  if (linkErr) throw new Error(`seed class_students failed: ${linkErr.message}`);
}

describeIntegration('get_plan_limit — school coverage (live DB)', () => {
  let b2cFree = '';
  let b2cUnlimited = '';
  let trialSchoolStudent = '';
  let basicSchoolUnlimitedStudent = '';
  let inactiveSchoolStudent = '';

  // SEED-DATA gate: false when this staging/CI DB is missing one or more of
  // REQUIRED_PLAN_CODES' `subscription_plans` rows (see the comment on
  // `REQUIRED_PLAN_CODES` above for why that can legitimately happen). Every
  // `it` below skips gracefully via `skipIfNoSubstrate`, surfacing the cause,
  // rather than the whole suite hard-failing.
  let available = false;
  let setupError: string | null = null;

  beforeAll(async () => {
    // 0. Resolve every subscription_plans row this suite's assertions are
    //    pinned to, in ONE query, BEFORE seeding anything mutable. If any
    //    required plan_code is absent on this DB, stop here — seeding
    //    schools/students would just be wasted work ahead of a skip.
    const { data: catalogRows, error: catalogErr } = await supabaseAdmin
      .from('subscription_plans')
      .select('plan_code, id, foxy_chats_per_day, quizzes_per_day')
      .in('plan_code', [...REQUIRED_PLAN_CODES]);
    if (catalogErr) {
      setupError = `subscription_plans catalog read failed: ${catalogErr.message}`;
      return;
    }
    for (const row of (catalogRows ?? []) as Array<
      { plan_code: string } & PlanCatalogRow
    >) {
      planCatalog.set(row.plan_code, {
        id: row.id,
        foxy_chats_per_day: row.foxy_chats_per_day,
        quizzes_per_day: row.quizzes_per_day,
      });
    }
    const missingPlanCodes = REQUIRED_PLAN_CODES.filter((code) => !planCatalog.has(code));
    if (missingPlanCodes.length > 0) {
      setupError =
        `subscription_plans is missing plan_code row(s) on this DB: ` +
        `${missingPlanCodes.join(', ')}. This catalog table has no seed ` +
        `migration in this repo (prod-only pg_dump data) — a migration-only ` +
        `staging/CI DB may legitimately not carry it yet.`;
      return;
    }

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
    available = true;
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

  it('PIN 1: a pure-B2C student with no school link is byte-identical to the pre-change value', async (ctx) => {
    skipIfNoSubstrate(ctx, available, setupError ?? 'setup did not complete');
    // No subscription row at all → the migration's documented free fallback.
    expect(await planLimit(b2cFree, 'foxy_chat')).toBe(FREE_FOXY_FALLBACK);
    expect(await planLimit(b2cFree, 'notes')).toBe(2);
    expect(await planLimit(b2cFree, 'ai_total')).toBe(15);
  });

  it('PIN 1: a B2C student on a paid personal plan keeps exactly the catalog cap', async (ctx) => {
    skipIfNoSubstrate(ctx, available, setupError ?? 'setup did not complete');
    const expected = catalogCap('unlimited', 'foxy_chats_per_day');
    expect(await planLimit(b2cUnlimited, 'foxy_chat')).toBe(expected);
  });

  it('PIN 1: a school link with NO active/trial subscription contributes nothing', async (ctx) => {
    skipIfNoSubstrate(ctx, available, setupError ?? 'setup did not complete');
    // The school exists and the student is linked, but its subscription is
    // cancelled — the branch must short-circuit to the personal value.
    expect(await planLimit(inactiveSchoolStudent, 'foxy_chat')).toBe(FREE_FOXY_FALLBACK);
  });

  // ── PIN 2 ──────────────────────────────────────────────────────────────────

  it('PIN 2: a student on a `trial` school resolves to the `pro` catalog cap, not free', async (ctx) => {
    skipIfNoSubstrate(ctx, available, setupError ?? 'setup did not complete');
    const proCap = catalogCap('pro', 'foxy_chats_per_day');
    const actual = await planLimit(trialSchoolStudent, 'foxy_chat');
    expect(actual).toBe(proCap);
    expect(actual).not.toBe(FREE_FOXY_FALLBACK);
  });

  it('PIN 2: the same student gets the pro quiz cap too (the boost is per-feature, not foxy-only)', async (ctx) => {
    skipIfNoSubstrate(ctx, available, setupError ?? 'setup did not complete');
    const proQuiz = catalogCap('pro', 'quizzes_per_day');
    expect(await planLimit(trialSchoolStudent, 'quiz')).toBe(proQuiz);
  });

  it('PIN 2: the DISPLAYED number (get_student_usage) equals the ENFORCED number', async (ctx) => {
    skipIfNoSubstrate(ctx, available, setupError ?? 'setup did not complete');
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

  it('PIN 3: a personally-`unlimited` student under a `basic` school is NOT downgraded', async (ctx) => {
    skipIfNoSubstrate(ctx, available, setupError ?? 'setup did not complete');
    const personalCap = catalogCap('unlimited', 'foxy_chats_per_day');
    const starterCap = catalogCap('starter', 'quizzes_per_day');

    // basic school → starter tier, which is STRICTLY lower than unlimited.
    const actual = await planLimit(basicSchoolUnlimitedStudent, 'quiz');
    const personalQuiz = catalogCap('unlimited', 'quizzes_per_day');

    expect(actual).toBe(personalQuiz);
    expect(actual).toBeGreaterThanOrEqual(starterCap);
    // And the foxy cap likewise stays at the personal (higher) value.
    expect(await planLimit(basicSchoolUnlimitedStudent, 'foxy_chat')).toBe(personalCap);
  });

  it('PIN 3: coverage is monotone — no student ever loses capacity across any feature', async (ctx) => {
    skipIfNoSubstrate(ctx, available, setupError ?? 'setup did not complete');
    for (const feature of ['foxy_chat', 'quiz', 'notes', 'ai_total']) {
      const withSchool = await planLimit(basicSchoolUnlimitedStudent, feature);
      const withoutSchool = await planLimit(b2cUnlimited, feature);
      expect(withSchool, feature).toBeGreaterThanOrEqual(withoutSchool);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Institution-override floor (20260729130600_get_plan_limit_institution_
  // override_floor.sql) — REG-330's 7 condition-2 pins.
  //
  // Nested inside the SAME describeIntegration block deliberately: it reuses
  // the outer beforeAll's catalog-presence gate (`available`/`setupError`)
  // and the module-scope seedSchool/seedStudent/giveStudentPlan/planLimit/
  // catalogCap helpers instead of duplicating them, per the task instruction
  // to keep the beforeAll gate reusable rather than re-seed a parallel rig.
  //
  // ⚠️ HONEST COVERAGE STATEMENT (REG-330, same shape as REG-329 above): on a
  // normal PR none of these 8 pins execute. The unit-lane companion
  // `get-plan-limit-institution-override-structure.test.ts` is what gates
  // every PR, and it can only detect SOURCE drift. Do not read a green PR as
  // "the institution-override floor semantics were verified".
  // ══════════════════════════════════════════════════════════════════════════
  describe('institution-override floor (20260729130600)', () => {
    let noOverrideSchoolStudent = '';
    let floorSchoolStudent = '';
    let ceilingSchoolStudent = '';
    let malformedSchoolStudent = '';
    let expiredSchoolStudent = '';
    let multiSchoolStudent = '';

    let ioAvailable = false;
    let ioSetupError: string | null = null;

    beforeAll(async () => {
      // Reuse the OUTER beforeAll's catalog-presence result — if that gate
      // failed, none of these fixtures can seed meaningfully either.
      if (!available) {
        ioSetupError = setupError ?? 'outer setup did not complete';
        return;
      }
      try {
        // Case 2: school with NO institution_entitlements row at all — a
        // fresh 'standard' (-> pro) school, deliberately distinct from
        // trialSchoolStudent above so this suite reads standalone.
        const standardSchool = await seedSchool('io-standard', 'standard', 'active');
        noOverrideSchoolStudent = await seedStudent('io-no-override', standardSchool);

        // Case 3 (floor): a 'standard' (-> pro) school with a LOW override —
        // must NOT lower the pro tier-derived cap.
        const floorSchool = await seedSchool('io-floor', 'standard', 'active');
        floorSchoolStudent = await seedStudent('io-floor', floorSchool);
        await seedInstitutionOverride(floorSchool, 'limit.foxy_chat_daily', {
          max: 1,
          period: 'day',
        });

        // Case 4 (ceiling raise): a 'basic' (-> starter) school with a HIGH
        // override — must win over both personal-free and the starter cap.
        const ceilingSchool = await seedSchool('io-ceiling', 'basic', 'active');
        ceilingSchoolStudent = await seedStudent('io-ceiling', ceilingSchool);
        await seedInstitutionOverride(ceilingSchool, 'limit.foxy_chat_daily', {
          max: 99999,
          period: 'day',
        });

        // Case 5 (malformed): a 'basic' school with a malformed override
        // (negative max) — must fall through to NULL, no error, no effect.
        const malformedSchool = await seedSchool('io-malformed', 'basic', 'active');
        malformedSchoolStudent = await seedStudent('io-malformed', malformedSchool);
        await seedInstitutionOverride(malformedSchool, 'limit.foxy_chat_daily', {
          max: -1,
          period: 'day',
        });

        // Case 6 (expired window): a 'basic' school with a well-formed but
        // EXPIRED override — must be ignored (effective_to in the past).
        const expiredSchool = await seedSchool('io-expired', 'basic', 'active');
        expiredSchoolStudent = await seedStudent('io-expired', expiredSchool);
        await seedInstitutionOverride(
          expiredSchool,
          'limit.foxy_chat_daily',
          { max: 99999, period: 'day' },
          { effectiveTo: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
        );

        // Case 7 (multi-school MAX): ONE student covered by TWO schools — a
        // DIRECT link (students.school_id) to the LOWER-override school, and
        // a ROSTER link (class_students) to the HIGHER-override school. The
        // resolver must return the HIGHER of the two.
        const multiSchoolLower = await seedSchool('io-multi-lower', 'basic', 'active');
        const multiSchoolHigher = await seedSchool('io-multi-higher', 'basic', 'active');
        multiSchoolStudent = await seedStudent('io-multi', multiSchoolLower);
        await linkStudentViaClassRoster(multiSchoolStudent, multiSchoolHigher, 'io-multi');
        await seedInstitutionOverride(multiSchoolLower, 'limit.foxy_chat_daily', {
          max: 500,
          period: 'day',
        });
        await seedInstitutionOverride(multiSchoolHigher, 'limit.foxy_chat_daily', {
          max: 2000,
          period: 'day',
        });

        ioAvailable = true;
      } catch (e) {
        ioSetupError = e instanceof Error ? e.message : String(e);
      }
    }, 60_000);

    it('1: a pure-B2C student with no school link is unaffected (no regression from adding the 3rd GREATEST term)', async (ctx) => {
      skipIfNoSubstrate(ctx, available, setupError ?? 'setup did not complete');
      expect(await planLimit(b2cFree, 'foxy_chat')).toBe(FREE_FOXY_FALLBACK);
      expect(await planLimit(b2cUnlimited, 'foxy_chat')).toBe(
        catalogCap('unlimited', 'foxy_chats_per_day'),
      );
    });

    it('2: a school with NO institution_entitlements row resolves exactly as 20260729130400 already proved', async (ctx) => {
      skipIfNoSubstrate(ctx, ioAvailable, ioSetupError ?? 'io setup did not complete');
      const proCap = catalogCap('pro', 'foxy_chats_per_day');
      expect(await planLimit(noOverrideSchoolStudent, 'foxy_chat')).toBe(proCap);
    });

    it('3: an override BELOW the school tier-derived cap does NOT lower the result (floor, not ceiling)', async (ctx) => {
      skipIfNoSubstrate(ctx, ioAvailable, ioSetupError ?? 'io setup did not complete');
      const proCap = catalogCap('pro', 'foxy_chats_per_day');
      const actual = await planLimit(floorSchoolStudent, 'foxy_chat');
      expect(actual).toBe(proCap);
      expect(actual).not.toBe(1);
    });

    it('4: an override ABOVE both personal and tier-derived caps WINS', async (ctx) => {
      skipIfNoSubstrate(ctx, ioAvailable, ioSetupError ?? 'io setup did not complete');
      const starterCap = catalogCap('starter', 'foxy_chats_per_day');
      const actual = await planLimit(ceilingSchoolStudent, 'foxy_chat');
      expect(actual).toBe(99999);
      expect(actual).toBeGreaterThan(starterCap);
      expect(actual).toBeGreaterThan(FREE_FOXY_FALLBACK);
    });

    it('5: a malformed override value ({max:-1}) falls through to NULL — no error, no effect on the result', async (ctx) => {
      skipIfNoSubstrate(ctx, ioAvailable, ioSetupError ?? 'io setup did not complete');
      const starterCap = catalogCap('starter', 'foxy_chats_per_day');
      const actual = await planLimit(malformedSchoolStudent, 'foxy_chat');
      expect(actual).toBe(starterCap);
      expect(actual).not.toBe(-1);
    });

    it('6: an override with effective_to in the past is ignored (window check)', async (ctx) => {
      skipIfNoSubstrate(ctx, ioAvailable, ioSetupError ?? 'io setup did not complete');
      const starterCap = catalogCap('starter', 'foxy_chats_per_day');
      const actual = await planLimit(expiredSchoolStudent, 'foxy_chat');
      expect(actual).toBe(starterCap);
      expect(actual).not.toBe(99999);
    });

    it('7: two covering schools each with a valid override — the HIGHER one wins (MAX aggregate)', async (ctx) => {
      skipIfNoSubstrate(ctx, ioAvailable, ioSetupError ?? 'io setup did not complete');
      const actual = await planLimit(multiSchoolStudent, 'foxy_chat');
      expect(actual).toBe(2000);
      expect(actual).not.toBe(500);
    });

    it('the DISPLAYED number (get_student_usage) equals the ENFORCED number under an active override', async (ctx) => {
      skipIfNoSubstrate(ctx, ioAvailable, ioSetupError ?? 'io setup did not complete');
      const { data, error } = await supabaseAdmin.rpc('get_student_usage', {
        p_student_id: ceilingSchoolStudent,
      });
      expect(error).toBeNull();
      const usage = data as Record<string, { used: number; limit: number }>;
      const enforced = await planLimit(ceilingSchoolStudent, 'foxy_chat');
      const displayed = usage.foxy.limit === -1 ? 999999 : usage.foxy.limit;
      expect(displayed).toBe(enforced);
      expect(displayed).toBe(99999);
    });
  });
});
