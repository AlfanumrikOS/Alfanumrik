import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Track A.5 — B2C ↔ B2B effective-plan resolver: DB-backed paths.
 *
 * Under test: src/lib/entitlements/effective-plan.ts
 *   - resolveEffectiveEntitlement(studentId, knownSchoolId?)
 *   - resolveEffectiveEntitlementForUser(authUserId)
 *   - resolveEffectivePlanCode(...)
 *
 * Focus: SEAT OCCUPANCY + fail-closed coverage. School coverage exists ONLY when
 * ALL of: (a) school_id present, (b) an active|trial school_subscriptions row,
 * (c) the student occupies a seat (active class_students OR class_enrollments row
 * in an active, non-deleted class of that school). Missing any → not covered.
 * Any coverage-lookup ERROR fails CLOSED (never fabricates coverage).
 *
 * House mocking style (mirrors src/__tests__/entitlements/resolver.test.ts):
 * @/lib/supabase-admin is a per-table chained thenable builder driven by a single
 * `fixture` object; @/lib/logger is silenced.
 */

// ─── @/lib/logger ────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── @/lib/supabase-admin (per-table chained builder) ────────────────────────
interface Fixture {
  // students.select('id, school_id').eq('id'|'auth_user_id', ...).maybeSingle()
  student: { id: string; school_id: string | null } | null;
  // school_subscriptions active|trial row
  schoolSub: { plan: string | null; status: string; seats_purchased: number | null; created_at: string } | null;
  // classes of the school (active, non-deleted)
  classes: Array<{ id: string }>;
  // class_students membership rows (already filtered to active + in classIds)
  classStudents: Array<{ class_id: string }>;
  // class_enrollments membership rows
  classEnrollments: Array<{ class_id: string }>;
  // student_subscriptions (personal) row
  personalSub: { plan_code: string; status: string } | null;
  // students.subscription_plan fallback column
  studentPlanColumn: string | null;
  errors?: Partial<Record<string, boolean>>;
}

let fixture: Fixture;
// Track which select() column-set each students-table read asked for so the
// two distinct students reads (id+school_id vs subscription_plan) return the
// right shape.
function studentsResolve(selectArg: string) {
  if (fixture.errors?.students) return { data: null, error: { message: 'students boom' } };
  if (selectArg.includes('subscription_plan')) {
    return { data: { subscription_plan: fixture.studentPlanColumn }, error: null };
  }
  return { data: fixture.student, error: null };
}

function makeBuilder(table: string) {
  let selectArg = '';
  const resolveData = (): { data: unknown; error: { message: string } | null } => {
    if (fixture.errors?.[table]) return { data: null, error: { message: `${table} boom` } };
    switch (table) {
      case 'students':
        return studentsResolve(selectArg);
      case 'school_subscriptions':
        return { data: fixture.schoolSub, error: null };
      case 'classes':
        return { data: fixture.classes, error: null };
      case 'class_students':
        return { data: fixture.classStudents, error: null };
      case 'class_enrollments':
        return { data: fixture.classEnrollments, error: null };
      case 'student_subscriptions':
        return { data: fixture.personalSub, error: null };
      default:
        return { data: [], error: null };
    }
  };
  const builder: Record<string, unknown> = {};
  builder.select = (arg?: string) => { selectArg = arg ?? ''; return builder; };
  for (const m of ['eq', 'in', 'order', 'limit', 'is', 'not']) {
    builder[m] = () => builder;
  }
  builder.maybeSingle = () => Promise.resolve(resolveData());
  builder.single = () => Promise.resolve(resolveData());
  (builder as { then: unknown }).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(resolveData()).then(resolve, reject);
  return builder;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
  getSupabaseAdmin: () => ({ from: (table: string) => makeBuilder(table) }),
}));

// Import AFTER mocks.
import {
  resolveEffectiveEntitlement,
  resolveEffectiveEntitlementForUser,
  resolveEffectivePlanCode,
} from '@/lib/entitlements/effective-plan';

const STUDENT = 'student-1';
const SCHOOL = 'school-1';

function baseFixture(): Fixture {
  return {
    student: { id: STUDENT, school_id: SCHOOL },
    schoolSub: { plan: 'standard', status: 'active', seats_purchased: 100, created_at: '2026-01-01' },
    classes: [{ id: 'class-1' }],
    classStudents: [{ class_id: 'class-1' }], // occupies a seat via class_students
    classEnrollments: [],
    personalSub: null,
    studentPlanColumn: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture = baseFixture();
});

// ─────────────────────────────────────────────────────────────────────────────
// Covered: all three conditions met
// ─────────────────────────────────────────────────────────────────────────────
describe('school coverage — covered only when school_id + active|trial sub + seat', () => {
  it('covered via class_students seat → source school, school standard maps to pro', async () => {
    const e = await resolveEffectiveEntitlement(STUDENT, SCHOOL);
    expect(e.source).toBe('school');
    expect(e.effectivePlan).toBe('pro'); // standard → pro
    expect(e.schoolCoverage).toEqual({ plan: 'pro', schoolId: SCHOOL });
  });

  it('covered via class_enrollments seat (class_students empty)', async () => {
    fixture.classStudents = [];
    fixture.classEnrollments = [{ class_id: 'class-1' }];
    const e = await resolveEffectiveEntitlement(STUDENT, SCHOOL);
    expect(e.source).toBe('school');
    expect(e.schoolCoverage?.plan).toBe('pro');
  });

  it('covers on a TRIAL school subscription (trial → pro)', async () => {
    fixture.schoolSub = { plan: 'trial', status: 'trial', seats_purchased: 5, created_at: '2026-01-01' };
    const e = await resolveEffectiveEntitlement(STUDENT, SCHOOL);
    expect(e.source).toBe('school');
    expect(e.schoolCoverage?.plan).toBe('pro');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NOT covered — each missing condition independently removes coverage
// ─────────────────────────────────────────────────────────────────────────────
describe('school coverage — not covered when any condition is missing', () => {
  it('no school_id (B2C-only) → no school coverage; falls to free', async () => {
    const e = await resolveEffectiveEntitlement(STUDENT, null);
    expect(e.source).toBe('free');
    expect(e.schoolCoverage).toBeUndefined();
  });

  it('school has NO active|trial subscription (null) → not covered', async () => {
    fixture.schoolSub = null;
    const e = await resolveEffectiveEntitlement(STUDENT, SCHOOL);
    expect(e.source).toBe('free');
    expect(e.schoolCoverage).toBeUndefined();
  });

  it('school-linked student with NO seat row (no roster) → consumes no seat → not covered', async () => {
    fixture.classStudents = [];
    fixture.classEnrollments = [];
    const e = await resolveEffectiveEntitlement(STUDENT, SCHOOL);
    expect(e.source).toBe('free');
    expect(e.schoolCoverage).toBeUndefined();
  });

  it('school has no active/non-deleted classes → no seat possible → not covered', async () => {
    fixture.classes = [];
    const e = await resolveEffectiveEntitlement(STUDENT, SCHOOL);
    expect(e.source).toBe('free');
    expect(e.schoolCoverage).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fail-closed on coverage-lookup errors
// ─────────────────────────────────────────────────────────────────────────────
describe('school coverage — fails CLOSED on lookup error (never fabricates coverage)', () => {
  it('school_subscriptions read error → no coverage (free)', async () => {
    fixture.errors = { school_subscriptions: true };
    const e = await resolveEffectiveEntitlement(STUDENT, SCHOOL);
    expect(e.source).toBe('free');
    expect(e.schoolCoverage).toBeUndefined();
  });

  it('classes read error → no seat → no coverage (free)', async () => {
    fixture.errors = { classes: true };
    const e = await resolveEffectiveEntitlement(STUDENT, SCHOOL);
    expect(e.source).toBe('free');
    expect(e.schoolCoverage).toBeUndefined();
  });

  it('class_enrollments probe error (and class_students empty) → not covered', async () => {
    fixture.classStudents = [];
    fixture.classEnrollments = [{ class_id: 'class-1' }];
    fixture.errors = { class_enrollments: true };
    const e = await resolveEffectiveEntitlement(STUDENT, SCHOOL);
    expect(e.source).toBe('free');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Personal (B2C) plan + coexistence with school
// ─────────────────────────────────────────────────────────────────────────────
describe('personal (B2C) plan resolution', () => {
  it('active personal sub beats lower school coverage → source personal', async () => {
    fixture.schoolSub = { plan: 'basic', status: 'active', seats_purchased: 10, created_at: '2026-01-01' }; // basic → starter
    fixture.personalSub = { plan_code: 'unlimited', status: 'active' };
    const e = await resolveEffectiveEntitlement(STUDENT, SCHOOL);
    expect(e.source).toBe('personal');
    expect(e.effectivePlan).toBe('unlimited');
    expect(e.schoolCoverage?.plan).toBe('starter'); // coverage still attached
    expect(e.personalPlan).toBe('unlimited');
  });

  it('past_due personal sub still grants access (grace window)', async () => {
    fixture.student = { id: STUDENT, school_id: null };
    fixture.personalSub = { plan_code: 'pro', status: 'past_due' };
    const e = await resolveEffectiveEntitlement(STUDENT, null);
    expect(e.source).toBe('personal');
    expect(e.effectivePlan).toBe('pro');
  });

  it('falls back to students.subscription_plan when the live sub is absent/free', async () => {
    fixture.student = { id: STUDENT, school_id: null };
    fixture.personalSub = null;
    fixture.studentPlanColumn = 'starter';
    const e = await resolveEffectiveEntitlement(STUDENT, null);
    expect(e.source).toBe('personal');
    expect(e.effectivePlan).toBe('starter');
  });

  it('B2C-only free student → source free, no coverage (today’s behavior unchanged)', async () => {
    fixture.student = { id: STUDENT, school_id: null };
    fixture.personalSub = null;
    fixture.studentPlanColumn = null;
    const e = await resolveEffectiveEntitlement(STUDENT, null);
    expect(e.source).toBe('free');
    expect(e.effectivePlan).toBe('free');
    expect(e.canUpgrade).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveEffectiveEntitlementForUser + resolveEffectivePlanCode
// ─────────────────────────────────────────────────────────────────────────────
describe('resolveEffectiveEntitlementForUser', () => {
  it('resolves the student from auth_user_id then returns the entitlement', async () => {
    const res = await resolveEffectiveEntitlementForUser('auth-1');
    expect(res).not.toBeNull();
    expect(res!.studentId).toBe(STUDENT);
    expect(res!.entitlement.source).toBe('school');
  });

  it('returns null when the auth user is not a student (no students row)', async () => {
    fixture.student = null;
    const res = await resolveEffectiveEntitlementForUser('auth-not-a-student');
    expect(res).toBeNull();
  });

  it('returns null on a students-lookup error', async () => {
    fixture.errors = { students: true };
    const res = await resolveEffectiveEntitlementForUser('auth-1');
    expect(res).toBeNull();
  });

  it('returns null for an empty auth user id (no lookup)', async () => {
    const res = await resolveEffectiveEntitlementForUser('');
    expect(res).toBeNull();
  });
});

describe('resolveEffectivePlanCode', () => {
  it('returns just the effective plan code', async () => {
    const code = await resolveEffectivePlanCode(STUDENT, SCHOOL);
    expect(code).toBe('pro');
  });
});
