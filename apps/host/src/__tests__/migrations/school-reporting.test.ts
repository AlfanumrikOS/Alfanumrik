/**
 * Phase 3B Wave D / D-tests — live-DB integration tests for the three
 * school-wide academic REPORTING read-model RPCs created in
 * `supabase/migrations/20260614000003_phase3b_school_reporting.sql`:
 *   - get_school_mastery_rollup(p_school_id, p_group_by) → TABLE  (grade|subject|teacher)
 *   - get_school_bloom_summary(p_school_id)              → TABLE  (Bloom distribution)
 *   - export_school_report(p_school_id)                  → jsonb  (PII-SAFE aggregate)
 *
 * These are SECURITY DEFINER and enforce school-scope INTERNALLY via
 * `school_admins.auth_user_id = auth.uid()` (else RAISE 42501). For auth.uid()
 * to resolve, the RPC MUST be called through a USER-CONTEXT client (an anon
 * client carrying the admin's JWT) — the service-role client has no auth.uid()
 * and the guard would reject every call. So this suite (mirroring the Wave A
 * harness in `src/__tests__/migrations/school-command-center-read-models.test.ts`
 * and the Wave B harness in `seat-enforcement.test.ts` seam-for-seam):
 *   1. Seeds ONE isolated school spanning ≥2 grades / ≥2 subjects / ≥2 teachers,
 *      with a roster that MIXES class_students AND class_enrollments (so the
 *      unified-roster claim — a student only in class_enrollments still counts —
 *      is proven), concept_mastery rows straddling the 0.4 at-risk boundary, and
 *      quiz_responses carrying bloom_level (including a NULL-bloom row that must
 *      bucket as 'unspecified'). All seeded via the SERVICE-ROLE client.
 *   2. Creates real auth users (admin-A active on school A; a wrong-school admin
 *      active on school B; an outsider) via auth.admin.createUser → sign in →
 *      anon client bearing the JWT, so the in-RPC scope guard is exercised for
 *      real (not bypassed by the service-role client).
 *   3. Exercises: mastery rollup grouped by grade / subject / teacher (grouping,
 *      student_count, per-student-pre-aggregated avg_mastery, 0.4 at-risk
 *      boundary); invalid group_by → 22023; bloom summary grouping + accuracy +
 *      the 'unspecified' bucket; export_school_report shape + PII-safety (NO
 *      student name/email/id string appears in the jsonb); cross-school 42501 on
 *      all three; unified roster (class_enrollments-only student counts).
 *
 * RUNS ONLY under the integration suite: `RUN_INTEGRATION_TESTS=1` + real
 * STAGING_SUPABASE_* secrets (CI job "Integration Tests (live DB)", currently
 * billing-blocked; restored when CI billing is restored). Skips cleanly otherwise
 * via the standard `hasSupabaseIntegrationEnv()` guard (mirrors
 * src/__tests__/migrations/cbse-syllabus.test.ts:5 and
 * question-bank-verification.test.ts:5).
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
  quizSessionIds: [] as string[],
  topicId: '' as string,
};

// User-context clients (carry the admin JWT so auth.uid() resolves in the RPC).
let adminAClient: SupabaseClient; // active admin of school A
let adminBClient: SupabaseClient; // active admin of school B (wrong-school for A)
let outsiderClient: SupabaseClient; // authenticated but NOT a school_admin anywhere

let SCHOOL_A = '';
let SCHOOL_B = ''; // separate school an unrelated admin owns (wrong-school 42501 probe)

// Capture the seeded student identifiers so the PII-safety assertion can prove
// NONE of them leak into the exported aggregate jsonb.
const seededStudentNames: string[] = [];
const seededStudentIds: string[] = [];

// The class_enrollments-ONLY student (no class_students row) — proves the
// unified roster counts a student reachable only via the enrollments table.
let CE_ONLY_STUDENT_ID = '';
let CE_ONLY_STUDENT_NAME = '';

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
    .insert({ name: `RPT-test ${name} ${RUN}`, board: 'CBSE', is_active: true })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed school failed: ${error?.message}`);
  created.schoolIds.push(data.id);
  return data.id;
}

async function seedClass(
  schoolId: string,
  name: string,
  grade: string,
  subject: string,
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('classes')
    .insert({ school_id: schoolId, name: `${name} ${RUN}`, grade, subject, is_active: true })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed class failed: ${error?.message}`);
  created.classIds.push(data.id);
  return data.id;
}

async function seedStudent(name: string, grade: string): Promise<string> {
  const fullName = `${name} ${RUN}`;
  const { data, error } = await supabaseAdmin
    .from('students')
    // Set preferred_subject EXPLICITLY to a seeded subjects.code — the column
    // DEFAULT ('Mathematics') matches no subjects.code and trips
    // students_preferred_subject_fkey (23503) on a schema-only-baseline DB.
    // See ./_helpers/reference-data.ts for the full root-cause note.
    .insert({ name: fullName, grade, is_active: true, preferred_subject: SAFE_PREFERRED_SUBJECT_CODE })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed student failed: ${error?.message}`);
  created.studentIds.push(data.id);
  seededStudentNames.push(fullName);
  seededStudentIds.push(data.id);
  return data.id;
}

async function seedTeacher(schoolId: string, name: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('teachers')
    .insert({
      name: `${name} ${RUN}`,
      email: `t-${RUN}-${name}@rpt.test`,
      school_id: schoolId,
      is_active: true,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed teacher failed: ${error?.message}`);
  created.teacherIds.push(data.id);
  return data.id;
}

/** Roster a student onto a class via class_students. */
async function enrolCS(classId: string, studentId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('class_students')
    .insert({ class_id: classId, student_id: studentId, is_active: true });
  if (error) throw new Error(`enrolCS failed: ${error.message}`);
}

/** Roster a student onto a class via class_enrollments (the unified-roster other arm). */
async function enrolCE(classId: string, studentId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('class_enrollments')
    .insert({ class_id: classId, student_id: studentId, is_active: true });
  if (error) throw new Error(`enrolCE failed: ${error.message}`);
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

/**
 * Seed one quiz_responses row for a student with a given bloom_level + is_correct.
 * quiz_responses.quiz_session_id is NOT NULL (FK → quiz_sessions), so we first
 * create a minimal session for the student (the bloom rollup keys off the
 * roster's student_id, not the session, but the FK must resolve).
 */
async function seedResponse(
  studentId: string,
  grade: string,
  bloomLevel: string | null,
  isCorrect: boolean,
): Promise<void> {
  const { data: session, error: sErr } = await supabaseAdmin
    .from('quiz_sessions')
    .insert({ student_id: studentId, subject: 'Science', grade, total_questions: 1 })
    .select('id')
    .single();
  if (sErr || !session) throw new Error(`seed quiz_session failed: ${sErr?.message}`);
  created.quizSessionIds.push(session.id);

  const { error } = await supabaseAdmin.from('quiz_responses').insert({
    quiz_session_id: session.id,
    student_id: studentId,
    question_number: 1,
    question_text: `Q ${RUN}`,
    bloom_level: bloomLevel,
    is_correct: isCorrect,
  });
  if (error) throw new Error(`seed quiz_response failed: ${error.message}`);
}

async function makeAdmin(schoolId: string, authUserId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('school_admins')
    .insert({ auth_user_id: authUserId, school_id: schoolId, role: 'principal', is_active: true });
  if (error) throw new Error(`makeAdmin failed: ${error.message}`);
}

// Group helpers — the RETURNS TABLE shape of get_school_mastery_rollup.
interface MasteryRow {
  group_key: string;
  group_label: string;
  student_count: number;
  avg_mastery: number | null;
  at_risk_count: number;
}
interface BloomRow {
  bloom_level: string;
  response_count: number;
  correct_count: number;
  accuracy: number;
}

describeIntegration('Phase 3B Wave D — school-wide reporting read models (live DB)', () => {
  beforeAll(async () => {
    // Idempotently ensure reference data the fixtures depend on:
    //  - the canonical `subjects` taxonomy (so the students FK resolves), and
    //  - a `curriculum_topics` anchor for concept_mastery.topic_id (FK).
    // Reuses an existing topic on a fully-seeded staging DB; self-seeds a
    // minimal anchor on a fresh/reset/drifted CI DB (the schema-only baseline
    // ships these tables EMPTY). See ./_helpers/reference-data.ts for the RCA.
    const { topicId } = await ensureSchoolReadModelReferenceData(supabaseAdmin);
    created.topicId = topicId;

    SCHOOL_A = await seedSchool('A');
    SCHOOL_B = await seedSchool('B-other');

    // ── School A topology ──────────────────────────────────────────────────
    // Grade 7 / Science taught by TA_SCI  → 3 students (one CE-only).
    // Grade 8 / Maths   taught by TA_MATH → 2 students.
    // This gives ≥2 grades, ≥2 subjects, ≥2 teachers.
    const cls7Sci = await seedClass(SCHOOL_A, 'G7-Science', '7', 'Science');
    const cls8Math = await seedClass(SCHOOL_A, 'G8-Maths', '8', 'Maths');

    const taSci = await seedTeacher(SCHOOL_A, 'TASCI');
    const taMath = await seedTeacher(SCHOOL_A, 'TAMATH');
    await assignTeacher(cls7Sci, taSci);
    await assignTeacher(cls8Math, taMath);

    // ── Grade 7 / Science roster (mix class_students + class_enrollments) ─────
    // s7a: class_students,    p_know 0.20 → at-risk
    // s7b: class_students,    p_know 0.40 → boundary, NOT at-risk (strict < 0.4)
    // s7c: class_ENROLLMENTS only (no class_students row!), p_know 0.30 → at-risk
    const s7a = await seedStudent('S7A', '7');
    const s7b = await seedStudent('S7B', '7');
    const s7c = await seedStudent('S7C', '7');
    CE_ONLY_STUDENT_ID = s7c;
    CE_ONLY_STUDENT_NAME = seededStudentNames[seededStudentNames.length - 1];
    await enrolCS(cls7Sci, s7a);
    await enrolCS(cls7Sci, s7b);
    await enrolCE(cls7Sci, s7c); // unified-roster arm: enrollments-only
    await setMastery(s7a, 0.2);
    await setMastery(s7b, 0.4); // boundary — must be EXCLUDED from at-risk
    await setMastery(s7c, 0.3);

    // ── Grade 8 / Maths roster (both above 0.4 → at_risk 0) ──────────────────
    const s8a = await seedStudent('S8A', '8');
    const s8b = await seedStudent('S8B', '8');
    await enrolCS(cls8Math, s8a);
    await enrolCS(cls8Math, s8b);
    await setMastery(s8a, 0.7);
    await setMastery(s8b, 0.9);

    // ── Bloom responses (across the roster; one NULL-bloom → 'unspecified') ──
    // 'remember': 3 responses, 2 correct  → accuracy 0.67
    // 'apply'   : 2 responses, 1 correct  → accuracy 0.50
    // NULL bloom: 1 response, 0 correct   → bucketed 'unspecified', accuracy 0.00
    await seedResponse(s7a, '7', 'remember', true);
    await seedResponse(s7b, '7', 'remember', true);
    await seedResponse(s7c, '7', 'remember', false);
    await seedResponse(s8a, '8', 'apply', true);
    await seedResponse(s8b, '8', 'apply', false);
    await seedResponse(s7a, '7', null, false); // → 'unspecified'

    // ── Auth users / admins ──────────────────────────────────────────────────
    const a = await makeUserClient(`rpt-admin-a-${RUN}@rpt.test`);
    adminAClient = a.client;
    await makeAdmin(SCHOOL_A, a.userId);

    const b = await makeUserClient(`rpt-admin-b-${RUN}@rpt.test`);
    adminBClient = b.client;
    await makeAdmin(SCHOOL_B, b.userId); // active admin of B only (wrong-school for A)

    const o = await makeUserClient(`rpt-outsider-${RUN}@rpt.test`);
    outsiderClient = o.client; // authenticated, NOT a school_admin anywhere
  }, 60000);

  afterAll(async () => {
    await supabaseAdmin.from('quiz_responses').delete().in('student_id', created.studentIds);
    await supabaseAdmin.from('quiz_sessions').delete().in('id', created.quizSessionIds);
    await supabaseAdmin.from('concept_mastery').delete().in('student_id', created.studentIds);
    await supabaseAdmin.from('class_students').delete().in('student_id', created.studentIds);
    await supabaseAdmin.from('class_enrollments').delete().in('student_id', created.studentIds);
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

  // ── (a) Cross-school 42501 scope guard on all three RPCs ───────────────────
  describe('scope guard (cross-tenant safety — RAISE 42501)', () => {
    it('rejects an authenticated NON-admin on get_school_mastery_rollup', async () => {
      const { error } = await outsiderClient.rpc('get_school_mastery_rollup', {
        p_school_id: SCHOOL_A,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501');
    });

    it('rejects a WRONG-SCHOOL admin on all three RPCs (admin of B querying A)', async () => {
      const r1 = await adminBClient.rpc('get_school_mastery_rollup', { p_school_id: SCHOOL_A });
      expect(r1.error?.code).toBe('42501');
      const r2 = await adminBClient.rpc('get_school_bloom_summary', { p_school_id: SCHOOL_A });
      expect(r2.error?.code).toBe('42501');
      const r3 = await adminBClient.rpc('export_school_report', { p_school_id: SCHOOL_A });
      expect(r3.error?.code).toBe('42501');
    });

    it('rejects the outsider on bloom summary + export too', async () => {
      const r2 = await outsiderClient.rpc('get_school_bloom_summary', { p_school_id: SCHOOL_A });
      expect(r2.error?.code).toBe('42501');
      const r3 = await outsiderClient.rpc('export_school_report', { p_school_id: SCHOOL_A });
      expect(r3.error?.code).toBe('42501');
    });

    it('ALLOWS the active admin of the school on all three', async () => {
      const r1 = await adminAClient.rpc('get_school_mastery_rollup', { p_school_id: SCHOOL_A });
      expect(r1.error).toBeNull();
      const r2 = await adminAClient.rpc('get_school_bloom_summary', { p_school_id: SCHOOL_A });
      expect(r2.error).toBeNull();
      const r3 = await adminAClient.rpc('export_school_report', { p_school_id: SCHOOL_A });
      expect(r3.error).toBeNull();
    });
  });

  // ── (b) Mastery rollup — invalid group_by → 22023 ──────────────────────────
  describe('get_school_mastery_rollup — group_by validation', () => {
    it('RAISES 22023 for an unknown group_by (never silently guesses)', async () => {
      const { error } = await adminAClient.rpc('get_school_mastery_rollup', {
        p_school_id: SCHOOL_A,
        p_group_by: 'bogus',
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('22023');
    });

    it("defaults to 'grade' when p_group_by is omitted", async () => {
      const { data, error } = await adminAClient.rpc('get_school_mastery_rollup', {
        p_school_id: SCHOOL_A,
      });
      expect(error).toBeNull();
      const rows = (data ?? []) as MasteryRow[];
      // Grade keys are STRINGS (P5): "7" and "8".
      const keys = rows.map((r) => r.group_key).sort();
      expect(keys).toEqual(['7', '8']);
      expect(rows.every((r) => typeof r.group_key === 'string')).toBe(true);
    });
  });

  // ── (c) Mastery rollup — group_by = grade (incl. unified roster + 0.4 boundary)
  describe('get_school_mastery_rollup — group_by grade', () => {
    it('groups by grade string with correct student_count, avg_mastery, at_risk_count', async () => {
      const { data, error } = await adminAClient.rpc('get_school_mastery_rollup', {
        p_school_id: SCHOOL_A,
        p_group_by: 'grade',
      });
      expect(error).toBeNull();
      const rows = (data ?? []) as MasteryRow[];
      const g7 = rows.find((r) => r.group_key === '7');
      const g8 = rows.find((r) => r.group_key === '8');
      expect(g7).toBeTruthy();
      expect(g8).toBeTruthy();

      // Grade 7: 3 students (incl. the class_enrollments-ONLY student) — proves
      // the unified roster. p_know {0.20, 0.40, 0.30}; strict <0.4 → 2 at-risk
      // (0.20, 0.30); the 0.40 boundary student is EXCLUDED.
      expect(Number(g7!.student_count)).toBe(3);
      expect(Number(g7!.at_risk_count)).toBe(2);
      // avg_mastery = mean of per-student averages (0.20+0.40+0.30)/3 = 0.30.
      expect(Number(g7!.avg_mastery)).toBeCloseTo(0.3, 4);
      expect(g7!.group_label).toBe('Grade 7');

      // Grade 8: 2 students, both above 0.4 → 0 at-risk; avg (0.7+0.9)/2 = 0.80.
      expect(Number(g8!.student_count)).toBe(2);
      expect(Number(g8!.at_risk_count)).toBe(0);
      expect(Number(g8!.avg_mastery)).toBeCloseTo(0.8, 4);
    });
  });

  // ── (d) Mastery rollup — group_by = subject ────────────────────────────────
  describe('get_school_mastery_rollup — group_by subject', () => {
    it('groups by subject text with the right per-subject student_count', async () => {
      const { data, error } = await adminAClient.rpc('get_school_mastery_rollup', {
        p_school_id: SCHOOL_A,
        p_group_by: 'subject',
      });
      expect(error).toBeNull();
      const rows = (data ?? []) as MasteryRow[];
      const sci = rows.find((r) => r.group_key === 'Science');
      const math = rows.find((r) => r.group_key === 'Maths');
      expect(sci).toBeTruthy();
      expect(math).toBeTruthy();
      expect(Number(sci!.student_count)).toBe(3); // G7 Science roster
      expect(Number(math!.student_count)).toBe(2); // G8 Maths roster
      expect(Number(sci!.at_risk_count)).toBe(2);
      expect(Number(math!.at_risk_count)).toBe(0);
    });
  });

  // ── (e) Mastery rollup — group_by = teacher ────────────────────────────────
  describe('get_school_mastery_rollup — group_by teacher', () => {
    it('groups by teacher uuid (group_key is text) with the teacher name as label', async () => {
      const { data, error } = await adminAClient.rpc('get_school_mastery_rollup', {
        p_school_id: SCHOOL_A,
        p_group_by: 'teacher',
      });
      expect(error).toBeNull();
      const rows = (data ?? []) as MasteryRow[];
      // Two teachers, each on one class.
      expect(rows.length).toBe(2);
      const sci = rows.find((r) => r.group_label.includes('TASCI'));
      const math = rows.find((r) => r.group_label.includes('TAMATH'));
      expect(sci).toBeTruthy();
      expect(math).toBeTruthy();
      // group_key is the teacher uuid rendered as text.
      expect(created.teacherIds).toContain(sci!.group_key);
      expect(created.teacherIds).toContain(math!.group_key);
      expect(Number(sci!.student_count)).toBe(3);
      expect(Number(math!.student_count)).toBe(2);
    });
  });

  // ── (f) Bloom summary — grouping, accuracy, 'unspecified' bucket ───────────
  describe('get_school_bloom_summary', () => {
    it('buckets by bloom_level with response/correct counts + 2dp accuracy', async () => {
      const { data, error } = await adminAClient.rpc('get_school_bloom_summary', {
        p_school_id: SCHOOL_A,
      });
      expect(error).toBeNull();
      const rows = (data ?? []) as BloomRow[];

      const remember = rows.find((r) => r.bloom_level === 'remember');
      const apply = rows.find((r) => r.bloom_level === 'apply');
      const unspecified = rows.find((r) => r.bloom_level === 'unspecified');

      expect(remember).toBeTruthy();
      expect(apply).toBeTruthy();
      expect(unspecified).toBeTruthy(); // NULL bloom bucketed exhaustively

      // remember: 3 responses, 2 correct → 0.67.
      expect(Number(remember!.response_count)).toBe(3);
      expect(Number(remember!.correct_count)).toBe(2);
      expect(Number(remember!.accuracy)).toBeCloseTo(0.67, 2);

      // apply: 2 responses, 1 correct → 0.50.
      expect(Number(apply!.response_count)).toBe(2);
      expect(Number(apply!.correct_count)).toBe(1);
      expect(Number(apply!.accuracy)).toBeCloseTo(0.5, 2);

      // unspecified: 1 response, 0 correct → 0.00.
      expect(Number(unspecified!.response_count)).toBe(1);
      expect(Number(unspecified!.correct_count)).toBe(0);
      expect(Number(unspecified!.accuracy)).toBe(0);
    });

    it('counts the class_enrollments-only student responses (unified roster)', async () => {
      // s7c (CE-only) contributed one 'remember' wrong answer — so its response is
      // included only if the bloom summary roster unifies both roster tables.
      const { data } = await adminAClient.rpc('get_school_bloom_summary', {
        p_school_id: SCHOOL_A,
      });
      const rows = (data ?? []) as BloomRow[];
      const remember = rows.find((r) => r.bloom_level === 'remember');
      // 3 'remember' responses INCLUDES the CE-only student's row → proves the
      // roster is the unified union, not class_students-only (which would be 2).
      expect(Number(remember!.response_count)).toBe(3);
    });
  });

  // ── (g) export_school_report — shape + PII-safety ──────────────────────────
  describe('export_school_report', () => {
    it('returns the documented PII-SAFE aggregate shape', async () => {
      const { data, error } = await adminAClient.rpc('export_school_report', {
        p_school_id: SCHOOL_A,
      });
      expect(error).toBeNull();
      const snap = data as {
        school_id: string;
        overview: { student_count: number; class_count: number };
        mastery_by_grade: Array<{ grade: string; student_count: number }>;
        bloom_summary: BloomRow[];
        data_state: string;
        generated_at: string;
      };
      expect(snap.school_id).toBe(SCHOOL_A);
      expect(snap.overview).toBeTruthy();
      expect(Array.isArray(snap.mastery_by_grade)).toBe(true);
      expect(Array.isArray(snap.bloom_summary)).toBe(true);
      expect(snap.data_state).toBe('live'); // school has roster + classes
      expect(typeof snap.generated_at).toBe('string');

      // mastery_by_grade carries group-level rows keyed by `grade` (string).
      const grades = snap.mastery_by_grade.map((r) => r.grade).sort();
      expect(grades).toEqual(['7', '8']);

      // overview reflects the unified roster (5 active students).
      expect(Number(snap.overview.student_count)).toBe(5);
    });

    it('contains NO individual student name / email / id anywhere in the jsonb (P13)', async () => {
      const { data } = await adminAClient.rpc('export_school_report', {
        p_school_id: SCHOOL_A,
      });
      const serialized = JSON.stringify(data);

      // No seeded student NAME appears.
      for (const name of seededStudentNames) {
        expect(serialized).not.toContain(name);
      }
      // No seeded student UUID appears (only group-level rows / counts).
      for (const id of seededStudentIds) {
        expect(serialized).not.toContain(id);
      }
      // The class_enrollments-only student is doubly checked (name + id) — it is
      // part of the aggregate counts but must never surface as an identifier.
      expect(serialized).not.toContain(CE_ONLY_STUDENT_NAME);
      expect(serialized).not.toContain(CE_ONLY_STUDENT_ID);
      // No teacher email leaks either.
      expect(serialized).not.toContain('@rpt.test');
    });

    it('reports data_state "no_data" for an empty school (no classes/roster)', async () => {
      // SCHOOL_B has an admin (adminB) but NO classes/roster/responses seeded.
      const { data, error } = await adminBClient.rpc('export_school_report', {
        p_school_id: SCHOOL_B,
      });
      expect(error).toBeNull();
      const snap = data as { data_state: string; mastery_by_grade: unknown[]; bloom_summary: unknown[] };
      expect(snap.data_state).toBe('no_data');
      expect(snap.mastery_by_grade).toEqual([]);
      expect(snap.bloom_summary).toEqual([]);
    });
  });
});
