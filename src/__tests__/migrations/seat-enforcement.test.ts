/**
 * Phase 3B Wave B — live-DB integration tests for the seat-enforcement SQL
 * primitives created in
 * `supabase/migrations/20260614000001_phase3b_seat_enforcement.sql`:
 *   - evaluate_seat_policy(p_school_id, p_add_count)            → jsonb (READ-ONLY)
 *   - enroll_students_with_seat_check(p_school_id, p_payload)   → jsonb (class_students)
 *   - enroll_section_students_with_seat_check(...)             → jsonb (class_enrollments)
 *   - refresh_school_seat_usage(p_school_id)                    → jsonb (snapshot + grace)
 *   - _count_active_school_students / _school_active_student_ids → unified count
 *
 * THE CEO-APPROVED HYBRID SEAT POLICY UNDER TEST (migration header §"HYBRID"):
 *   S            = active school_subscriptions.seats_purchased
 *   grace_ceiling = floor(S * 1.10)
 *   grace_window  = 14 days from the FIRST moment active > S
 *   statuses:
 *     within_plan   (N <= S)                                   → ALLOW
 *     grace_warn    (S < N <= ceiling, window OPEN)            → ALLOW (soft)
 *     grace_expired (S < N <= ceiling, window ELAPSED)         → BLOCK
 *     over_ceiling  (N > ceiling)                              → BLOCK (always)
 *   - grace clock SET on first overage; RESET to null when active returns <= S.
 *   - active = DISTINCT UNION of class_students + class_enrollments (active rows,
 *     active non-deleted classes of the school, active students). A student in
 *     BOTH counts ONCE.
 *   - NEVER auto-deactivate. Blocking only prevents NEW additions.
 *
 * `evaluate_seat_policy` is SECURITY DEFINER + scope-guarded on auth.uid()
 * (RAISE 42501 cross-school) and EXECUTE-able by `authenticated`. The mutating
 * RPCs are service_role-only. So this suite (mirroring the Wave A harness in
 * `src/__tests__/migrations/school-command-center-read-models.test.ts`):
 *   1. Seeds a school (seats_purchased=10 ⇒ grace_ceiling=11) + roster via the
 *      SERVICE-ROLE client.
 *   2. Creates a REAL auth user (active admin of the school) + a wrong-school
 *      admin via auth.admin.createUser → signInWithPassword → anon client bearing
 *      the JWT, so the in-RPC auth.uid() scope guard is exercised for real.
 *   3. Drives evaluate_seat_policy through the user-context client and the
 *      mutating RPCs through the service-role client (their backend credential).
 *
 * RUNS ONLY under the integration suite: `RUN_INTEGRATION_TESTS=1` +
 * `hasSupabaseIntegrationEnv()` (real STAGING_SUPABASE_* secrets). Skips cleanly
 * otherwise (placeholder CI env), exactly like the Wave A read-model test and
 * `cbse-syllabus.test.ts:5` / `question-bank-verification.test.ts:5`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

// Unique suffix so parallel / repeated runs never collide on a shared staging DB.
const RUN = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PW = `Test!${RUN}`;

const SEATS = 10; // S = 10 ⇒ grace_ceiling = floor(10 * 1.10) = 11.
const CEILING = 11;

// Identifiers we create and must tear down.
const created = {
  schoolIds: [] as string[],
  authUserIds: [] as string[],
  studentIds: [] as string[],
  classIds: [] as string[],
};

let adminClient: SupabaseClient; // active admin of SCHOOL (carries JWT for evaluate_)
let wrongAdminClient: SupabaseClient; // active admin of OTHER school (42501 probe)

let SCHOOL = '';
let OTHER_SCHOOL = '';
let CLASS_CS = ''; // class for the class_students roster path
let CLASS_CE = ''; // class for the class_enrollments roster path
let SUB_ID = ''; // school_subscriptions row id (for back-dating the grace clock)

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

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
    .insert({ name: `SEAT-test ${name} ${RUN}`, board: 'CBSE', is_active: true })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed school failed: ${error?.message}`);
  created.schoolIds.push(data.id);
  return data.id;
}

async function seedSubscription(schoolId: string, seats: number): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('school_subscriptions')
    .insert({ school_id: schoolId, seats_purchased: seats, status: 'active', plan: 'school' })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed subscription failed: ${error?.message}`);
  return data.id;
}

async function seedClass(schoolId: string, name: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('classes')
    .insert({ school_id: schoolId, name: `${name} ${RUN}`, grade: '8', is_active: true })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed class failed: ${error?.message}`);
  created.classIds.push(data.id);
  return data.id;
}

async function seedStudent(tag: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('students')
    .insert({ name: `S-${tag} ${RUN}`, grade: '8', is_active: true })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed student failed: ${error?.message}`);
  created.studentIds.push(data.id);
  return data.id;
}

async function makeAdmin(schoolId: string, authUserId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('school_admins')
    .insert({ auth_user_id: authUserId, school_id: schoolId, role: 'principal', is_active: true });
  if (error) throw new Error(`makeAdmin failed: ${error.message}`);
}

/** Place N students on a class via class_students (the section-roster path). */
async function enrolCS(classId: string, studentIds: string[]): Promise<void> {
  if (studentIds.length === 0) return;
  const { error } = await supabaseAdmin
    .from('class_students')
    .insert(studentIds.map((s) => ({ class_id: classId, student_id: s, is_active: true })));
  if (error) throw new Error(`enrolCS failed: ${error.message}`);
}

/** Place N students on a class via class_enrollments (the bulk-import path). */
async function enrolCE(classId: string, studentIds: string[]): Promise<void> {
  if (studentIds.length === 0) return;
  const { error } = await supabaseAdmin
    .from('class_enrollments')
    .insert(studentIds.map((s) => ({ class_id: classId, student_id: s, is_active: true })));
  if (error) throw new Error(`enrolCE failed: ${error.message}`);
}

async function countActive(schoolId: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('_count_active_school_students', {
    p_school_id: schoolId,
  });
  if (error) throw new Error(`_count_active_school_students failed: ${error.message}`);
  return Number(data);
}

interface Verdict {
  allowed: boolean;
  status: 'within_plan' | 'grace_warn' | 'grace_expired' | 'over_ceiling';
  seats_purchased: number;
  grace_ceiling: number;
  current_active: number;
  projected: number;
  grace_started_at: string | null;
  grace_expires_at: string | null;
}

describeIntegration('Phase 3B seat enforcement — hybrid policy state machine (live DB)', () => {
  beforeAll(async () => {
    SCHOOL = await seedSchool('main');
    OTHER_SCHOOL = await seedSchool('other');
    SUB_ID = await seedSubscription(SCHOOL, SEATS); // S = 10
    CLASS_CS = await seedClass(SCHOOL, 'CS');
    CLASS_CE = await seedClass(SCHOOL, 'CE');

    const a = await makeUserClient(`seat-admin-${RUN}@seat.test`);
    adminClient = a.client;
    await makeAdmin(SCHOOL, a.userId);

    const w = await makeUserClient(`seat-wrong-${RUN}@seat.test`);
    wrongAdminClient = w.client;
    await makeAdmin(OTHER_SCHOOL, w.userId); // admin of OTHER, never of SCHOOL
  }, 60000);

  afterAll(async () => {
    await supabaseAdmin.from('class_students').delete().in('student_id', created.studentIds);
    await supabaseAdmin.from('class_enrollments').delete().in('student_id', created.studentIds);
    await supabaseAdmin.from('classes').delete().in('id', created.classIds);
    await supabaseAdmin.from('school_seat_usage').delete().in('school_id', created.schoolIds);
    await supabaseAdmin.from('school_subscriptions').delete().in('school_id', created.schoolIds);
    await supabaseAdmin.from('school_admins').delete().in('school_id', created.schoolIds);
    await supabaseAdmin.from('students').delete().in('id', created.studentIds);
    await supabaseAdmin.from('schools').delete().in('id', created.schoolIds);
    for (const uid of created.authUserIds) {
      await supabaseAdmin.auth.admin.deleteUser(uid).catch(() => undefined);
    }
  }, 60000);

  // ── (a) READ-ONLY evaluate_seat_policy: the 4 statuses against a clean count ──
  describe('evaluate_seat_policy — the 4 statuses (S=10, ceiling=11)', () => {
    it('grace_ceiling = floor(S * 1.10) = 11', async () => {
      const { data, error } = await adminClient.rpc('evaluate_seat_policy', {
        p_school_id: SCHOOL,
        p_add_count: 1,
      });
      expect(error).toBeNull();
      const v = data as Verdict;
      expect(v.seats_purchased).toBe(SEATS);
      expect(v.grace_ceiling).toBe(CEILING);
    });

    it('within_plan: projected <= S is ALLOWED (no roster yet, add 10)', async () => {
      // current_active = 0; add 10 ⇒ projected 10 == S ⇒ within_plan.
      const { data, error } = await adminClient.rpc('evaluate_seat_policy', {
        p_school_id: SCHOOL,
        p_add_count: 10,
      });
      expect(error).toBeNull();
      const v = data as Verdict;
      expect(v.status).toBe('within_plan');
      expect(v.allowed).toBe(true);
      expect(v.projected).toBe(10);
    });

    it('grace_warn: S < projected <= ceiling with the window open is a SOFT ALLOW', async () => {
      // current 0; add 11 ⇒ projected 11 (== ceiling) ⇒ grace_warn (window opens).
      const { data, error } = await adminClient.rpc('evaluate_seat_policy', {
        p_school_id: SCHOOL,
        p_add_count: 11,
      });
      expect(error).toBeNull();
      const v = data as Verdict;
      expect(v.status).toBe('grace_warn');
      expect(v.allowed).toBe(true);
      expect(v.projected).toBe(11);
    });

    it('over_ceiling: projected > ceiling is BLOCKED regardless of window (add 12)', async () => {
      const { data, error } = await adminClient.rpc('evaluate_seat_policy', {
        p_school_id: SCHOOL,
        p_add_count: 12,
      });
      expect(error).toBeNull();
      const v = data as Verdict;
      expect(v.status).toBe('over_ceiling');
      expect(v.allowed).toBe(false);
      expect(v.projected).toBe(12);
    });

    it('READ-ONLY: evaluate_seat_policy never sets the grace clock', async () => {
      // After previewing an overage above, the subscription grace clock must
      // remain null — only the enroll/refresh path mutates it.
      const { data } = await supabaseAdmin
        .from('school_subscriptions')
        .select('seat_grace_started_at')
        .eq('id', SUB_ID)
        .single();
      expect((data as { seat_grace_started_at: string | null }).seat_grace_started_at).toBeNull();
    });
  });

  // ── (b) Cross-school 42501 scope guard on evaluate_seat_policy ──
  describe('scope guard (cross-tenant safety — RAISE 42501)', () => {
    it('rejects a WRONG-SCHOOL admin previewing this school', async () => {
      const { error } = await wrongAdminClient.rpc('evaluate_seat_policy', {
        p_school_id: SCHOOL,
        p_add_count: 1,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501');
    });

    it('ALLOWS the active admin of the school', async () => {
      const { error } = await adminClient.rpc('evaluate_seat_policy', {
        p_school_id: SCHOOL,
        p_add_count: 1,
      });
      expect(error).toBeNull();
    });
  });

  // ── (c) The UNIFIED both-table count — a student in BOTH counts ONCE ──
  describe('unified active count (class_students UNION class_enrollments)', () => {
    it('counts the DISTINCT union; a student in BOTH roster tables counts once', async () => {
      // Seed 3 students: one only in class_students, one only in class_enrollments,
      // one in BOTH. Unified count must be 3, not 4.
      const sOnlyCS = await seedStudent('only-cs');
      const sOnlyCE = await seedStudent('only-ce');
      const sBoth = await seedStudent('both');

      await enrolCS(CLASS_CS, [sOnlyCS, sBoth]);
      await enrolCE(CLASS_CE, [sOnlyCE, sBoth]);

      const n = await countActive(SCHOOL);
      expect(n).toBe(3); // sBoth de-duped by the SQL UNION

      // Honest-count parity with the Wave A read model (re-defined in Wave B).
      const { data: overview, error } = await adminClient.rpc('get_school_overview', {
        p_school_id: SCHOOL,
      });
      expect(error).toBeNull();
      expect(Number((overview as { student_count: number }).student_count)).toBe(3);

      // Clean up so the later state-machine tests start from a known count.
      await supabaseAdmin
        .from('class_students')
        .delete()
        .in('student_id', [sOnlyCS, sOnlyCE, sBoth]);
      await supabaseAdmin
        .from('class_enrollments')
        .delete()
        .in('student_id', [sOnlyCS, sOnlyCE, sBoth]);
    });
  });

  // ── (d) ATOMIC enroll guards (both paths): P3B01, nothing inserted on block ──
  describe('enroll_students_with_seat_check (class_students path)', () => {
    it('SUCCEEDS within plan and inserts the roster rows', async () => {
      // Fill to exactly S = 10 via class_students through the RPC.
      const ids = [];
      for (let i = 0; i < 10; i++) ids.push(await seedStudent(`cs-fill-${i}`));
      const payload = ids.map((s) => ({ student_id: s, class_id: CLASS_CS }));

      const { data, error } = await supabaseAdmin.rpc('enroll_students_with_seat_check', {
        p_school_id: SCHOOL,
        p_payload: payload,
      });
      expect(error).toBeNull();
      const r = data as { success: boolean; enrolled: number; verdict: Verdict };
      expect(r.success).toBe(true);
      expect(r.verdict.status).toBe('within_plan');
      expect(await countActive(SCHOOL)).toBe(10);
    });

    it('grace_warn (11th) is a SOFT ALLOW and SETS the grace clock', async () => {
      const s11 = await seedStudent('cs-11');
      const { data, error } = await supabaseAdmin.rpc('enroll_students_with_seat_check', {
        p_school_id: SCHOOL,
        p_payload: [{ student_id: s11, class_id: CLASS_CS }],
      });
      expect(error).toBeNull();
      const r = data as { verdict: Verdict };
      expect(r.verdict.status).toBe('grace_warn');
      expect(await countActive(SCHOOL)).toBe(11);

      // The grace clock is now set on the active subscription row.
      const { data: sub } = await supabaseAdmin
        .from('school_subscriptions')
        .select('seat_grace_started_at')
        .eq('id', SUB_ID)
        .single();
      expect(
        (sub as { seat_grace_started_at: string | null }).seat_grace_started_at,
      ).not.toBeNull();
    });

    it('over_ceiling (12th, N=12 > ceiling 11) RAISES P3B01 and inserts NOTHING', async () => {
      const s12 = await seedStudent('cs-12');
      const before = await countActive(SCHOOL);
      const { error } = await supabaseAdmin.rpc('enroll_students_with_seat_check', {
        p_school_id: SCHOOL,
        p_payload: [{ student_id: s12, class_id: CLASS_CS }],
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('P3B01');
      // Verdict is carried in DETAIL as the verdict jsonb.
      expect(error?.details).toContain('over_ceiling');
      // NOTHING inserted — the count is unchanged and the student is not on the roster.
      expect(await countActive(SCHOOL)).toBe(before);
      const { data: rows } = await supabaseAdmin
        .from('class_students')
        .select('id')
        .eq('student_id', s12);
      expect((rows ?? []).length).toBe(0);
    });

    it('grace_expired: back-date the grace clock > 14d ⇒ the 11th-equivalent add is BLOCKED', async () => {
      // Currently active = 11 (S=10, ceiling=11, grace clock set above). Deactivate
      // one to return to 10 first would reset the clock — instead, back-date the
      // EXISTING clock so the window is elapsed, then attempt another within-ceiling
      // add. With active already at 11 the next add projects to 12 (over_ceiling),
      // so to isolate grace_expired we deactivate one (active→10) WITHOUT refresh
      // (so the clock stays set), back-date it, then add one (projected 11 ≤ ceiling
      // but window elapsed ⇒ grace_expired).
      const fillRows = created.studentIds.slice(0, 1); // any one active class_students row
      // Deactivate one roster row directly (no refresh ⇒ clock NOT reset).
      await supabaseAdmin
        .from('class_students')
        .update({ is_active: false })
        .eq('student_id', fillRows[0]);
      expect(await countActive(SCHOOL)).toBe(10);

      // Back-date the grace clock to 15 days ago (window = 14d ⇒ elapsed).
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString();
      await supabaseAdmin
        .from('school_subscriptions')
        .update({ seat_grace_started_at: fifteenDaysAgo })
        .eq('id', SUB_ID);

      // Sanity: in-window this same add (projected 11 ≤ ceiling) WAS allowed
      // (proven by the grace_warn test above). Now the window is elapsed.
      const reAdd = await seedStudent('cs-expired');
      const { error } = await supabaseAdmin.rpc('enroll_students_with_seat_check', {
        p_school_id: SCHOOL,
        p_payload: [{ student_id: reAdd, class_id: CLASS_CS }],
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('P3B01');
      expect(error?.details).toContain('grace_expired');
      expect(await countActive(SCHOOL)).toBe(10); // nothing inserted

      // Restore: reactivate the deactivated row + clear the clock for later tests.
      await supabaseAdmin
        .from('class_students')
        .update({ is_active: true })
        .eq('student_id', fillRows[0]);
      await supabaseAdmin
        .from('school_subscriptions')
        .update({ seat_grace_started_at: null })
        .eq('id', SUB_ID);
    });
  });

  describe('enroll_section_students_with_seat_check (class_enrollments path)', () => {
    it('over_ceiling RAISES P3B01 and inserts NOTHING into class_enrollments', async () => {
      // Reset roster to empty, set S small (3) to force a quick over-ceiling.
      await supabaseAdmin.from('class_students').delete().eq('class_id', CLASS_CS);
      await supabaseAdmin.from('class_enrollments').delete().eq('class_id', CLASS_CE);
      await supabaseAdmin
        .from('school_subscriptions')
        .update({ seats_purchased: 3, seat_grace_started_at: null })
        .eq('id', SUB_ID);

      const ids = [];
      for (let i = 0; i < 4; i++) ids.push(await seedStudent(`ce-over-${i}`));
      // ceiling = floor(3*1.10) = 3; add 4 ⇒ projected 4 > 3 ⇒ over_ceiling.
      const { error } = await supabaseAdmin.rpc('enroll_section_students_with_seat_check', {
        p_school_id: SCHOOL,
        p_payload: ids.map((s) => ({ student_id: s, class_id: CLASS_CE })),
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('P3B01');
      expect(error?.details).toContain('over_ceiling');
      expect(await countActive(SCHOOL)).toBe(0); // nothing inserted

      // Restore S = 10 for the remaining tests.
      await supabaseAdmin
        .from('school_subscriptions')
        .update({ seats_purchased: SEATS })
        .eq('id', SUB_ID);
    });

    it('SUCCEEDS within plan and inserts into class_enrollments', async () => {
      const ids = [];
      for (let i = 0; i < 3; i++) ids.push(await seedStudent(`ce-ok-${i}`));
      const { data, error } = await supabaseAdmin.rpc('enroll_section_students_with_seat_check', {
        p_school_id: SCHOOL,
        p_payload: ids.map((s) => ({ student_id: s, class_id: CLASS_CE })),
      });
      expect(error).toBeNull();
      expect((data as { verdict: Verdict }).verdict.status).toBe('within_plan');
      expect(await countActive(SCHOOL)).toBe(3);
    });
  });

  // ── (e) Grace clock RESET when active returns <= S, via refresh ──
  describe('grace clock reset + refresh idempotency', () => {
    it('SETS the clock on overage then RESETS to null when active <= S after refresh', async () => {
      // Reset rosters; S=10. Fill to 11 via the section path ⇒ clock set.
      await supabaseAdmin.from('class_students').delete().eq('class_id', CLASS_CS);
      await supabaseAdmin.from('class_enrollments').delete().eq('class_id', CLASS_CE);
      await supabaseAdmin
        .from('school_subscriptions')
        .update({ seats_purchased: SEATS, seat_grace_started_at: null })
        .eq('id', SUB_ID);

      const ids = [];
      for (let i = 0; i < 11; i++) ids.push(await seedStudent(`reset-${i}`));
      const ok = await supabaseAdmin.rpc('enroll_section_students_with_seat_check', {
        p_school_id: SCHOOL,
        p_payload: ids.map((s) => ({ student_id: s, class_id: CLASS_CE })),
      });
      expect(ok.error).toBeNull();
      expect(await countActive(SCHOOL)).toBe(11);

      const { data: setClock } = await supabaseAdmin
        .from('school_subscriptions')
        .select('seat_grace_started_at')
        .eq('id', SUB_ID)
        .single();
      expect(
        (setClock as { seat_grace_started_at: string | null }).seat_grace_started_at,
      ).not.toBeNull();

      // Deactivate two (active → 9 ≤ S) — NEVER auto-deactivate is the policy, so
      // we do it explicitly (a real admin freeing seats), then refresh.
      await supabaseAdmin
        .from('class_enrollments')
        .update({ is_active: false })
        .in('student_id', [ids[0], ids[1]]);

      const refreshed = await supabaseAdmin.rpc('refresh_school_seat_usage', {
        p_school_id: SCHOOL,
      });
      expect(refreshed.error).toBeNull();
      expect(await countActive(SCHOOL)).toBe(9);

      const { data: resetClock } = await supabaseAdmin
        .from('school_subscriptions')
        .select('seat_grace_started_at')
        .eq('id', SUB_ID)
        .single();
      // active (9) <= S (10) ⇒ grace clock RESET to null.
      expect(
        (resetClock as { seat_grace_started_at: string | null }).seat_grace_started_at,
      ).toBeNull();
    });

    it('refresh_school_seat_usage is idempotent (call twice → same snapshot)', async () => {
      const first = await supabaseAdmin.rpc('refresh_school_seat_usage', { p_school_id: SCHOOL });
      const second = await supabaseAdmin.rpc('refresh_school_seat_usage', { p_school_id: SCHOOL });
      expect(first.error).toBeNull();
      expect(second.error).toBeNull();
      const a = first.data as { active_students: number; seats_purchased: number; utilization_pct: number };
      const b = second.data as { active_students: number; seats_purchased: number; utilization_pct: number };
      expect(b.active_students).toBe(a.active_students);
      expect(b.seats_purchased).toBe(a.seats_purchased);
      expect(Number(b.utilization_pct)).toBe(Number(a.utilization_pct));

      // Exactly one snapshot row for (school, today) — the UPSERT did not duplicate.
      const today = new Date().toISOString().slice(0, 10);
      const { data: snaps } = await supabaseAdmin
        .from('school_seat_usage')
        .select('id')
        .eq('school_id', SCHOOL)
        .eq('snapshot_date', today);
      expect((snaps ?? []).length).toBe(1);
    });
  });

  // ── (f) Race-safety: the advisory lock serialises concurrent enroll paths ──
  describe('race-safety (advisory lock serialises concurrent enrolls)', () => {
    it('two concurrent enrolls that would jointly exceed the ceiling never both succeed', async () => {
      // Fresh state: S=10, ceiling=11, roster emptied.
      await supabaseAdmin.from('class_students').delete().eq('class_id', CLASS_CS);
      await supabaseAdmin.from('class_enrollments').delete().eq('class_id', CLASS_CE);
      await supabaseAdmin
        .from('school_subscriptions')
        .update({ seats_purchased: SEATS, seat_grace_started_at: null })
        .eq('id', SUB_ID);
      expect(await countActive(SCHOOL)).toBe(0);

      // Two batches of 7 each. Either alone fits (7 ≤ ceiling 11); together they
      // project to 14 > ceiling. The per-school advisory lock (same 'school_seat:'
      // namespace across BOTH paths) serialises them: the first commits 7, the
      // second re-reads 7 under the lock and projects 14 ⇒ over_ceiling ⇒ P3B01.
      const batchA = [];
      const batchB = [];
      for (let i = 0; i < 7; i++) batchA.push(await seedStudent(`raceA-${i}`));
      for (let i = 0; i < 7; i++) batchB.push(await seedStudent(`raceB-${i}`));

      const [resA, resB] = await Promise.all([
        supabaseAdmin.rpc('enroll_students_with_seat_check', {
          p_school_id: SCHOOL,
          p_payload: batchA.map((s) => ({ student_id: s, class_id: CLASS_CS })),
        }),
        supabaseAdmin.rpc('enroll_section_students_with_seat_check', {
          p_school_id: SCHOOL,
          p_payload: batchB.map((s) => ({ student_id: s, class_id: CLASS_CE })),
        }),
      ]);

      const errors = [resA.error, resB.error].filter(Boolean);
      const successes = [resA.error, resB.error].filter((e) => e === null);

      // Exactly one wins, exactly one is blocked with P3B01.
      expect(successes.length).toBe(1);
      expect(errors.length).toBe(1);
      expect(errors[0]?.code).toBe('P3B01');

      // The total never exceeds the ceiling: only the winning batch of 7 landed.
      expect(await countActive(SCHOOL)).toBe(7);
    });
  });
});
