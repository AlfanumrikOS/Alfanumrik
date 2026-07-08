/**
 * Phase 3B Wave A / A5 — live-DB integration tests for the three School Command
 * Center read-model RPCs created in
 * `supabase/migrations/20260614000000_phase3b_school_command_center_read_models.sql`:
 *   - get_school_overview(p_school_id)             → jsonb
 *   - get_classes_at_risk(p_school_id, limit, off) → TABLE
 *   - get_teacher_engagement(p_school_id, l, o)    → TABLE
 *
 * These are SECURITY DEFINER and enforce school-scope INTERNALLY via
 * `school_admins.auth_user_id = auth.uid()` (else RAISE 42501). For auth.uid()
 * to resolve, the RPC MUST be called through a USER-CONTEXT client (an anon
 * client carrying the admin's JWT) — the service-role client has no auth.uid()
 * and the guard would reject every call. So this suite:
 *   1. Seeds two isolated schools + roster + mastery via the SERVICE-ROLE client.
 *   2. Creates two real auth users (admin-A active on school A; outsider) and a
 *      wrong-school admin (admin-B active on school B) via auth.admin.createUser,
 *      then signs each in to obtain a JWT and builds a user-context client.
 *   3. Exercises the scope guard, the 0.4 at-risk boundary, the pagination clamp,
 *      the data_state flip, and the null avg_mastery / seat_utilization_pct cases.
 *
 * RUNS ONLY under the integration suite: `RUN_INTEGRATION_TESTS=1` + real
 * STAGING_SUPABASE_* secrets (CI job "Integration Tests (live DB)", currently
 * billing-blocked but restored when CI billing is restored). Skips cleanly
 * otherwise via the standard `hasSupabaseIntegrationEnv()` guard (mirrors
 * src/__tests__/migrations/cbse-syllabus.test.ts:5 and
 * question-bank-verification.test.ts:5).
 *
 * Pattern matched: migration integration tests under src/__tests__/migrations/**
 * (e.g. state-runtime/bkt-sql-parity.test.ts:43 — `await sb.rpc(...)`; seed +
 * call + assert + cleanup). This file adds the user-context-JWT seam those tests
 * did not need (their RPCs run as service-role), so the in-RPC auth.uid() guard
 * is exercised for real.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';
import {
  ensureSchoolReadModelReferenceData,
  SAFE_PREFERRED_SUBJECT_CODE,
} from './_helpers/reference-data';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

// Unique suffix so parallel / repeated runs never collide on a shared staging DB.
const RUN = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PW = `Test!${RUN}`;

// ── Identifiers we create and must tear down. ────────────────────────────────
const created = {
  schoolIds: [] as string[],
  authUserIds: [] as string[],
  studentIds: [] as string[],
  teacherIds: [] as string[],
  classIds: [] as string[],
  topicId: '' as string,
};

// User-context clients (carry the admin JWT so auth.uid() resolves in the RPC).
let adminAClient: SupabaseClient; // active admin of school A
let adminBClient: SupabaseClient; // active admin of school B (wrong-school for A)
let outsiderClient: SupabaseClient; // authenticated but NOT a school_admin anywhere

// School ids for the two fixtures.
let SCHOOL_A = '';
let SCHOOL_B = ''; // empty school (no classes/roster/mastery) — data_state probe
let SCHOOL_NO_MASTERY = ''; // roster but no concept_mastery — null avg_mastery probe

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Create a real auth user and return a user-context client bearing its JWT. */
async function makeUserClient(email: string): Promise<{ userId: string; client: SupabaseClient }> {
  const { data: createdUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: PW,
    email_confirm: true,
  });
  if (createErr || !createdUser.user) {
    throw new Error(`createUser failed for ${email}: ${createErr?.message}`);
  }
  const userId = createdUser.user.id;
  created.authUserIds.push(userId);

  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PW });
  if (signInErr) throw new Error(`signIn failed for ${email}: ${signInErr.message}`);
  return { userId, client };
}

async function seedSchool(name: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('schools')
    .insert({ name: `CC-test ${name} ${RUN}`, board: 'CBSE', is_active: true })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed school failed: ${error?.message}`);
  created.schoolIds.push(data.id);
  return data.id;
}

async function seedClass(schoolId: string, name: string, grade: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('classes')
    .insert({ school_id: schoolId, name: `${name} ${RUN}`, grade, is_active: true })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed class failed: ${error?.message}`);
  created.classIds.push(data.id);
  return data.id;
}

async function seedStudent(name: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('students')
    // Set preferred_subject EXPLICITLY to a seeded subjects.code. The column
    // DEFAULT ('Mathematics') is a stale value that matches no subjects.code,
    // so an omitted preferred_subject trips students_preferred_subject_fkey
    // (23503) on any DB seeded only from the schema-only baseline. See
    // ./_helpers/reference-data.ts for the full root-cause note.
    .insert({
      name: `${name} ${RUN}`,
      grade: '8',
      is_active: true,
      preferred_subject: SAFE_PREFERRED_SUBJECT_CODE,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed student failed: ${error?.message}`);
  created.studentIds.push(data.id);
  return data.id;
}

async function seedTeacher(schoolId: string, name: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('teachers')
    .insert({ name: `${name} ${RUN}`, email: `t-${RUN}-${name}@cc.test`, school_id: schoolId, is_active: true })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed teacher failed: ${error?.message}`);
  created.teacherIds.push(data.id);
  return data.id;
}

async function enrol(classId: string, studentId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('class_students')
    .insert({ class_id: classId, student_id: studentId, is_active: true });
  if (error) throw new Error(`enrol failed: ${error.message}`);
}

async function assignTeacher(classId: string, teacherId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('class_teachers')
    .insert({ class_id: classId, teacher_id: teacherId, is_active: true });
  if (error) throw new Error(`assignTeacher failed: ${error.message}`);
}

async function setMastery(studentId: string, pKnow: number): Promise<void> {
  const { error } = await supabaseAdmin
    .from('concept_mastery')
    .insert({ student_id: studentId, topic_id: created.topicId, p_know: pKnow });
  if (error) throw new Error(`setMastery failed: ${error.message}`);
}

async function makeAdmin(schoolId: string, authUserId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('school_admins')
    .insert({ auth_user_id: authUserId, school_id: schoolId, role: 'principal', is_active: true });
  if (error) throw new Error(`makeAdmin failed: ${error.message}`);
}

describeIntegration('Phase 3B school command center read models (live DB)', () => {
  beforeAll(async () => {
    // Idempotently ensure reference data the fixtures depend on:
    //  - the canonical `subjects` taxonomy (so the students FK resolves), and
    //  - a `curriculum_topics` anchor for concept_mastery.topic_id.
    // Reuses an existing topic on a fully-seeded staging DB; self-seeds a
    // minimal anchor on a fresh/reset/drifted CI DB (schema-only baseline ships
    // these tables EMPTY). See ./_helpers/reference-data.ts for the root cause.
    const { topicId } = await ensureSchoolReadModelReferenceData(supabaseAdmin);
    created.topicId = topicId;

    // ── School A: 2 classes, mastery spanning the 0.4 boundary, teachers. ──
    SCHOOL_A = await seedSchool('A');
    // School B: EMPTY (no classes, roster, mastery) — data_state='no_data' probe.
    SCHOOL_B = await seedSchool('B-empty');
    // School with roster but NO mastery — null avg_mastery / utilization probe.
    SCHOOL_NO_MASTERY = await seedSchool('C-no-mastery');

    // ── School A classes ──
    const classRisky = await seedClass(SCHOOL_A, 'Risky', '8'); // many below 0.4
    const classHealthy = await seedClass(SCHOOL_A, 'Healthy', '9'); // all above 0.4

    // Risky class: 4 students. p_know values pin the boundary:
    //   0.39 → at-risk, 0.40 → NOT at-risk (boundary excludes equality),
    //   0.10 → at-risk, 0.80 → not at-risk. ⇒ at_risk_count = 2.
    const sR1 = await seedStudent('R1');
    const sR2 = await seedStudent('R2'); // exactly 0.40 → NOT at-risk
    const sR3 = await seedStudent('R3');
    const sR4 = await seedStudent('R4');
    await enrol(classRisky, sR1);
    await enrol(classRisky, sR2);
    await enrol(classRisky, sR3);
    await enrol(classRisky, sR4);
    await setMastery(sR1, 0.39);
    await setMastery(sR2, 0.4); // boundary — must be EXCLUDED from at-risk
    await setMastery(sR3, 0.1);
    await setMastery(sR4, 0.8);

    // Healthy class: 2 students, both well above 0.4 ⇒ at_risk_count = 0.
    const sH1 = await seedStudent('H1');
    const sH2 = await seedStudent('H2');
    await enrol(classHealthy, sH1);
    await enrol(classHealthy, sH2);
    await setMastery(sH1, 0.9);
    await setMastery(sH2, 0.7);

    // Teachers on school A: tA1 on both classes, tA2 on none.
    const tA1 = await seedTeacher(SCHOOL_A, 'TA1');
    const tA2 = await seedTeacher(SCHOOL_A, 'TA2');
    await assignTeacher(classRisky, tA1);
    await assignTeacher(classHealthy, tA1);
    void tA2;

    // ── School with roster but no mastery ──
    const classNM = await seedClass(SCHOOL_NO_MASTERY, 'NM', '7');
    const sNM = await seedStudent('NM1');
    await enrol(classNM, sNM);
    // intentionally NO setMastery — avg_mastery must be null.

    // ── Auth users / admins ──
    const a = await makeUserClient(`cc-admin-a-${RUN}@cc.test`);
    adminAClient = a.client;
    // Admin A is an active admin of BOTH school A and the no-mastery school, so
    // the same JWT can probe the live, no-mastery, and (via wrong-school) guard
    // paths. Multi-school is NOT a concern here: the RPC takes an explicit
    // p_school_id, and the guard only checks membership of THAT school.
    await makeAdmin(SCHOOL_A, a.userId);
    await makeAdmin(SCHOOL_NO_MASTERY, a.userId);

    const b = await makeUserClient(`cc-admin-b-${RUN}@cc.test`);
    adminBClient = b.client;
    await makeAdmin(SCHOOL_B, b.userId); // active admin of B only (wrong-school for A)

    const o = await makeUserClient(`cc-outsider-${RUN}@cc.test`);
    outsiderClient = o.client; // authenticated, NOT a school_admin anywhere
  }, 60000);

  afterAll(async () => {
    // Children first (FKs mostly CASCADE, but be explicit + idempotent).
    await supabaseAdmin.from('concept_mastery').delete().in('student_id', created.studentIds);
    await supabaseAdmin.from('class_students').delete().in('student_id', created.studentIds);
    await supabaseAdmin.from('class_teachers').delete().in('teacher_id', created.teacherIds);
    await supabaseAdmin.from('classes').delete().in('id', created.classIds);
    await supabaseAdmin.from('school_admins').delete().in('school_id', created.schoolIds);
    await supabaseAdmin.from('teachers').delete().in('id', created.teacherIds);
    await supabaseAdmin.from('students').delete().in('id', created.studentIds);
    await supabaseAdmin.from('schools').delete().in('id', created.schoolIds);
    for (const uid of created.authUserIds) {
      await supabaseAdmin.auth.admin.deleteUser(uid).catch(() => undefined);
    }
  }, 60000);

  // ── (a) Scope guard — 42501 for non-admin + wrong-school; success for admin ──
  describe('scope guard (cross-tenant safety — RAISE 42501)', () => {
    it('rejects an authenticated NON-admin caller (get_school_overview)', async () => {
      const { error } = await outsiderClient.rpc('get_school_overview', { p_school_id: SCHOOL_A });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501');
    });

    it('rejects a WRONG-SCHOOL admin (admin of B querying A)', async () => {
      const { error } = await adminBClient.rpc('get_school_overview', { p_school_id: SCHOOL_A });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501');
    });

    it('rejects the non-admin on get_classes_at_risk and get_teacher_engagement too', async () => {
      const r1 = await outsiderClient.rpc('get_classes_at_risk', { p_school_id: SCHOOL_A, p_limit: 20, p_offset: 0 });
      expect(r1.error?.code).toBe('42501');
      const r2 = await outsiderClient.rpc('get_teacher_engagement', { p_school_id: SCHOOL_A, p_limit: 20, p_offset: 0 });
      expect(r2.error?.code).toBe('42501');
    });

    it('ALLOWS the active admin of the school (get_school_overview succeeds)', async () => {
      const { data, error } = await adminAClient.rpc('get_school_overview', { p_school_id: SCHOOL_A });
      expect(error).toBeNull();
      expect(data).toBeTruthy();
      expect((data as { data_state: string }).data_state).toBe('live');
    });
  });

  // ── (b) The 0.4 at-risk boundary ──
  describe('at-risk boundary (p_know < 0.4 is at-risk; exactly 0.4 is NOT)', () => {
    it('counts students strictly below 0.4 — the 0.40 student is excluded', async () => {
      const { data, error } = await adminAClient.rpc('get_classes_at_risk', {
        p_school_id: SCHOOL_A,
        p_limit: 20,
        p_offset: 0,
      });
      expect(error).toBeNull();
      const rows = (data ?? []) as Array<{
        class_name: string;
        student_count: number;
        at_risk_count: number;
        avg_mastery: number | null;
      }>;
      const risky = rows.find((r) => r.class_name.includes('Risky'));
      const healthy = rows.find((r) => r.class_name.includes('Healthy'));
      expect(risky).toBeTruthy();
      expect(healthy).toBeTruthy();
      // 4 students; 0.39 and 0.10 are below 0.4; 0.40 (boundary) and 0.80 are not.
      expect(Number(risky!.student_count)).toBe(4);
      expect(Number(risky!.at_risk_count)).toBe(2);
      // Healthy class: both above 0.4.
      expect(Number(healthy!.student_count)).toBe(2);
      expect(Number(healthy!.at_risk_count)).toBe(0);
    });

    it('orders most-at-risk class first (at_risk_count DESC)', async () => {
      const { data } = await adminAClient.rpc('get_classes_at_risk', {
        p_school_id: SCHOOL_A,
        p_limit: 20,
        p_offset: 0,
      });
      const rows = (data ?? []) as Array<{ class_name: string; at_risk_count: number }>;
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows[0].class_name).toContain('Risky');
    });
  });

  // ── (c) Pagination clamp ──
  describe('pagination clamp (p_limit 1..100, p_offset >= 0)', () => {
    it('clamps p_limit=500 to at most 100 rows', async () => {
      const { data, error } = await adminAClient.rpc('get_classes_at_risk', {
        p_school_id: SCHOOL_A,
        p_limit: 500,
        p_offset: 0,
      });
      expect(error).toBeNull();
      expect((data as unknown[]).length).toBeLessThanOrEqual(100);
    });

    it('clamps p_limit=0 up to >=1 (returns the top class, not zero rows)', async () => {
      const { data, error } = await adminAClient.rpc('get_classes_at_risk', {
        p_school_id: SCHOOL_A,
        p_limit: 0,
        p_offset: 0,
      });
      expect(error).toBeNull();
      // School A has 2 classes; clamp-to-1 ⇒ exactly one row, not zero.
      expect((data as unknown[]).length).toBe(1);
    });

    it('clamps a negative p_limit up to >=1', async () => {
      const { data, error } = await adminAClient.rpc('get_teacher_engagement', {
        p_school_id: SCHOOL_A,
        p_limit: -5,
        p_offset: 0,
      });
      expect(error).toBeNull();
      expect((data as unknown[]).length).toBeGreaterThanOrEqual(1);
      expect((data as unknown[]).length).toBeLessThanOrEqual(100);
    });
  });

  // ── (d) data_state flip ──
  describe('data_state hint', () => {
    it("flips to 'no_data' for an empty school (no classes/roster/mastery)", async () => {
      const { data, error } = await adminBClient.rpc('get_school_overview', { p_school_id: SCHOOL_B });
      expect(error).toBeNull();
      const o = data as { data_state: string; class_count: number; student_count: number };
      expect(o.data_state).toBe('no_data');
      expect(Number(o.class_count)).toBe(0);
      expect(Number(o.student_count)).toBe(0);
    });

    it("is 'live' for a school with a roster", async () => {
      const { data } = await adminAClient.rpc('get_school_overview', { p_school_id: SCHOOL_A });
      expect((data as { data_state: string }).data_state).toBe('live');
    });
  });

  // ── (e) null avg_mastery / seat_utilization_pct when no signal ──
  describe('null numerics when there is no signal', () => {
    it('avg_mastery is null for a roster with no concept_mastery rows', async () => {
      const { data, error } = await adminAClient.rpc('get_school_overview', {
        p_school_id: SCHOOL_NO_MASTERY,
      });
      expect(error).toBeNull();
      const o = data as { avg_mastery: number | null; data_state: string; student_count: number };
      // Roster exists ⇒ live, but no mastery rows ⇒ avg_mastery null (no fake 0).
      expect(o.data_state).toBe('live');
      expect(Number(o.student_count)).toBe(1);
      expect(o.avg_mastery).toBeNull();
    });

    it('seat_utilization_pct is null when there is no seat snapshot or subscription', async () => {
      const { data } = await adminAClient.rpc('get_school_overview', {
        p_school_id: SCHOOL_NO_MASTERY,
      });
      const o = data as { seat_utilization_pct: number | null };
      // No school_seat_usage snapshot and no active school_subscriptions seeded
      // for this fixture school ⇒ utilization is null, never 0% or NaN.
      expect(o.seat_utilization_pct).toBeNull();
    });
  });

  // ── teacher engagement basic correctness (defense-in-depth on the rollup) ──
  describe('teacher engagement rollup', () => {
    it('counts distinct active class assignments per teacher; orders assigned DESC', async () => {
      const { data, error } = await adminAClient.rpc('get_teacher_engagement', {
        p_school_id: SCHOOL_A,
        p_limit: 20,
        p_offset: 0,
      });
      expect(error).toBeNull();
      const rows = (data ?? []) as Array<{
        teacher_name: string;
        class_count: number;
        remediation_assigned_count: number;
      }>;
      // Both seeded teachers appear (TA1 on 2 classes, TA2 on 0).
      const ta1 = rows.find((r) => r.teacher_name.includes('TA1'));
      const ta2 = rows.find((r) => r.teacher_name.includes('TA2'));
      expect(ta1).toBeTruthy();
      expect(ta2).toBeTruthy();
      expect(Number(ta1!.class_count)).toBe(2);
      expect(Number(ta2!.class_count)).toBe(0);
      // No remediation seeded ⇒ all zero, order stable (assigned DESC then name ASC).
      expect(Number(ta1!.remediation_assigned_count)).toBe(0);
    });
  });
});
