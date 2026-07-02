import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasSupabaseIntegrationEnv, skipIfNoSubstrate } from '../helpers/integration';

/**
 * REG-229 — `purge_certification_tenant(p_school_id)` end-to-end regression
 * (integration lane). Companion coverage for
 * `supabase/migrations/20260702180000_certification_tenant_teardown.sql`
 * (Environment Readiness remediation wave, 2026-07-02; the migration was
 * subsequently CORRECTED after a quality review found its original FK
 * inventory stale and missing 4 genuinely-blocking tables — see the
 * migration's "Corrected FK inventory" section. This file was extended in
 * the same follow-up to cover all 6 newly-added items, not just the
 * original 7 — see "WHAT THIS TEST PROVES" below).
 *
 * THE GAP THIS CLOSES
 * =====================
 * Before this migration there was no single-operation way to tear down a
 * school-scoped certification/demo tenant: `students.school_id` and
 * `teachers.school_id` reference `schools(id)` with NO `ON DELETE CASCADE`
 * (deliberately — see the migration header for why that's a SAFETY property,
 * not a bug), so a raw `DELETE FROM schools` failed with a Postgres 23503
 * foreign-key violation whenever any student/teacher still referenced it. The
 * migration adds `purge_certification_tenant(p_school_id uuid)`, a guarded,
 * single-call teardown scoped ONLY to `is_demo = true` rows. The corrected
 * version additionally clears 4 per-student RESTRICT/no-cascade child tables
 * (`foxy_chat_messages`, `foxy_sessions`, `ai_workflow_traces`,
 * `admin_impersonation_sessions`) and 2 tenant-level/B2B RESTRICT tables
 * (`payment_reconciliation_queue`, `school_contracts`) that the original
 * version silently missed — every one of the 7 items in the migration's
 * "Corrected FK inventory" section is now covered by this file.
 *
 * WHAT THIS TEST PROVES (the task's 3 minimum assertions, extended to the
 * corrected FK inventory's full table list)
 * ==========================================================
 *   1. Calling the RPC on a school where `is_demo IS NOT TRUE` raises an
 *      exception (ERRCODE 42501) and touches ZERO rows — the school row
 *      (and everything under it) survives untouched.
 *   2. Calling the RPC twice in a row on an already-torn-down tenant
 *      succeeds as a no-op BOTH times (`already_absent: true`, no error).
 *   3. After a successful call, ZERO rows remain across every table the
 *      migration's teardown order touches, for that school id / student id:
 *      `students`, `teachers`, `demo_accounts`, the 4 defensively-cleaned
 *      school-scoped child tables (`school_alert_rules`, `school_audit_log`,
 *      `school_invoices`, `school_seat_usage`), the 4 per-student
 *      RESTRICT/no-cascade child tables (`foxy_chat_messages`,
 *      `foxy_sessions`, `ai_workflow_traces`, `admin_impersonation_sessions`
 *      — corrected FK inventory items 1-4), and the 2 tenant-level/B2B
 *      RESTRICT tables (`payment_reconciliation_queue`, `school_contracts`
 *      — corrected FK inventory items 5-7) — plus the `schools` row itself.
 *      The `payment_reconciliation_queue` fixture additionally links its
 *      `invoice_id` to the SAME `school_invoices` row this suite tears down,
 *      so the zero-row assertion doubles as an ORDERING proof (item 6's
 *      chained RESTRICT against `school_invoices`) — see the inline comment
 *      at that assertion site for exactly why a reversed delete order would
 *      fail the whole RPC call, not just leave a stray row.
 *
 * LANE: integration. Self-skips cleanly unless real Supabase creds are
 * present (`hasSupabaseIntegrationEnv()` — placeholder-aware, same gate as
 * every other file in `src/__tests__/migrations/**`). Run via:
 *   RUN_INTEGRATION_TESTS=1 npm run test:integration
 *
 * ══════════════════════════════════════════════════════════════════════════
 * STAGE-2 COVERAGE NOTE (for the certification re-run of Environment
 * Readiness criterion 5 — "test data can be cleaned up"):
 *
 * This test exercises `purge_certification_tenant` against a SEEDED
 * standalone tenant (this file's own fixtures), not against the output of
 * `scripts/seed-certification-accounts.ts` run end-to-end, and not against a
 * real Vercel Preview (staging) deployment. In THIS session, no live
 * Supabase credentials are configured, so `hasSupabaseIntegrationEnv()`
 * returns false and every test below SKIPS (visible in the report as
 * `skipped`, not `passed`) — the SQL-level behavioral proof described above
 * is written and ready but UNEXECUTED this session. Full closure of
 * criterion 5 requires this suite to be run for real (RUN_INTEGRATION_TESTS=1
 * against a live staging Supabase project) AND a full
 * seed (via the certification seeding script) -> certify -> teardown cycle
 * on actual staging, per the runbook's "Mandatory post-teardown leak check"
 * (docs/runbooks/certification-traffic-traceability.md). Until that Stage-2
 * run happens, criterion 5 should be recorded as PARTIALLY resolved
 * (migration + regression test authored and structurally sound; live-DB
 * execution and the real seed->teardown cycle still pending), not fully
 * resolved.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * REGRESSION CATALOG: REG-229.
 */

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

const RPC = 'purge_certification_tenant';

interface RpcResult {
  success: boolean;
  already_absent?: boolean;
  school_id?: string;
  registry_accounts_purged?: number;
  students_purged_direct?: number;
  teachers_purged_direct?: number;
  error?: string;
}

async function callPurge(
  admin: SupabaseClient,
  schoolId: string,
): Promise<{ data: RpcResult | null; error: { code?: string; message: string } | null }> {
  const { data, error } = await admin.rpc(RPC, { p_school_id: schoolId });
  return { data: data as RpcResult | null, error: error as { code?: string; message: string } | null };
}

async function countWhereSchool(admin: SupabaseClient, table: string, schoolId: string): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId);
  if (error) throw new Error(`count failed for ${table}: ${error.message}`);
  return count ?? 0;
}

// Same shape as countWhereSchool but scoped by student_id — used for the 4
// per-student RESTRICT/no-cascade child tables (corrected FK inventory items
// 1-4: foxy_chat_messages, foxy_sessions, ai_workflow_traces,
// admin_impersonation_sessions), none of which carry a school_id column.
async function countWhereStudent(admin: SupabaseClient, table: string, studentId: string): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId);
  if (error) throw new Error(`count failed for ${table}: ${error.message}`);
  return count ?? 0;
}

async function schoolExists(admin: SupabaseClient, schoolId: string): Promise<boolean> {
  const { data, error } = await admin.from('schools').select('id').eq('id', schoolId).maybeSingle();
  if (error) throw new Error(`schools lookup failed: ${error.message}`);
  return data != null;
}

describeIntegration('REG-229 — purge_certification_tenant (live RPC against migrated DB)', () => {
  let admin: SupabaseClient;
  let available = false;
  let setupError: string | null = null;

  beforeAll(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    // Smoke-check the RPC exists and is callable before running the suite —
    // a school_id that certainly does not exist must return the idempotent
    // no-op shape (success:true, already_absent:true), never an error, on a
    // freshly-migrated DB.
    const probe = await callPurge(admin, '00000000-0000-0000-0000-000000000000');
    if (probe.error) {
      setupError = probe.error.message;
      return;
    }
    available = true;
  });

  // ─────────────────────────────────────────────────────────────────────
  // (1) Refuses to touch a REAL school (is_demo IS NOT TRUE) — hard fail,
  //     zero rows touched.
  // ─────────────────────────────────────────────────────────────────────
  describe('guard: refuses non-demo schools', () => {
    let realSchoolId: string | null = null;

    afterAll(async () => {
      if (admin && realSchoolId) {
        await admin.from('schools').delete().eq('id', realSchoolId);
      }
    });

    it('raises an exception and touches zero rows when is_demo IS NOT TRUE', async (ctx) => {
      skipIfNoSubstrate(ctx, available, `RPC probe failed: ${setupError ?? ''}`);

      const { data: school, error: createErr } = await admin
        .from('schools')
        .insert({ name: `REG-229 real school ${randomUUID()}`, board: 'CBSE', is_active: true, is_demo: false })
        .select('id')
        .single();
      expect(createErr, createErr?.message).toBeNull();
      realSchoolId = (school as { id: string }).id;

      const { data, error } = await callPurge(admin, realSchoolId);

      // Must hard-fail — never silently succeed against a real school.
      expect(error, 'must raise an exception, not return success').not.toBeNull();
      expect(error?.code, `expected 42501 insufficient_privilege, got ${error?.message}`).toBe('42501');
      expect(data).toBeNull();

      // Zero rows touched: the school row itself must survive, completely
      // untouched (still exists, is_demo still false).
      const stillExists = await schoolExists(admin, realSchoolId);
      expect(stillExists, 'real school row must survive the refused call').toBe(true);

      const { data: after, error: afterErr } = await admin
        .from('schools')
        .select('id, is_demo, deleted_at')
        .eq('id', realSchoolId)
        .single();
      expect(afterErr, afterErr?.message).toBeNull();
      expect((after as { is_demo: boolean }).is_demo).toBe(false);
      expect((after as { deleted_at: string | null }).deleted_at).toBeNull();
    });

    it('also refuses when is_demo IS NULL (not just explicitly false)', async (ctx) => {
      skipIfNoSubstrate(ctx, available, `RPC probe failed: ${setupError ?? ''}`);

      const { data: school, error: createErr } = await admin
        .from('schools')
        .insert({ name: `REG-229 null-demo school ${randomUUID()}`, board: 'CBSE', is_active: true })
        .select('id')
        .single();
      expect(createErr, createErr?.message).toBeNull();
      const nullDemoSchoolId = (school as { id: string }).id;

      try {
        const { data, error } = await callPurge(admin, nullDemoSchoolId);
        expect(error, 'must raise, IS NOT TRUE catches NULL too').not.toBeNull();
        expect(error?.code).toBe('42501');
        expect(data).toBeNull();
        expect(await schoolExists(admin, nullDemoSchoolId)).toBe(true);
      } finally {
        await admin.from('schools').delete().eq('id', nullDemoSchoolId);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // (2) + (3) Happy path: full demo tenant torn down in one call, zero rows
  //     remain across every touched table; a second call is an idempotent
  //     no-op.
  // ─────────────────────────────────────────────────────────────────────
  describe('happy path: full demo tenant teardown + idempotent re-call', () => {
    it('purges every row across all 13 touched tables (7 original + 6 corrected-FK-inventory additions), then a second call is a clean no-op', async (ctx) => {
      skipIfNoSubstrate(ctx, available, `RPC probe failed: ${setupError ?? ''}`);

      const marker = `reg229-${randomUUID()}`;
      // Manually-cleaned outside the purge: admin_users is NOT school-scoped
      // and the migration correctly never touches it (it's the FK *target*
      // for admin_impersonation_sessions.admin_id, not a demo-tenant row).
      // Tracked here so the finally-block always cleans it up, pass or fail.
      let adminUserId: string | null = null;

      try {
        // ── Seed a demo school ──
        const { data: school, error: schoolErr } = await admin
          .from('schools')
          .insert({ name: `[CERTIFICATION] ${marker}-school`, board: 'CBSE', is_active: true, is_demo: true })
          .select('id')
          .single();
        expect(schoolErr, schoolErr?.message).toBeNull();
        const schoolId = (school as { id: string }).id;

        // ── Seed a demo student (registered in demo_accounts) ──
        const studentAuthId = randomUUID();
        const { data: student, error: studentErr } = await admin
          .from('students')
          .insert({
            auth_user_id: studentAuthId,
            name: `${marker}-student`,
            email: `${marker}-student@certification.alfanumrik.invalid`,
            grade: '10',
            board: 'CBSE',
            school_id: schoolId,
            is_demo: true,
          })
          .select('id')
          .single();
        expect(studentErr, studentErr?.message).toBeNull();
        const studentId = (student as { id: string }).id;

        // ── Seed a demo teacher (NOT registered in demo_accounts — proves the
        //    defensive direct-sweep branch, since not every demo row is
        //    guaranteed a registry row per the traceability runbook) ──
        const teacherAuthId = randomUUID();
        const { error: teacherErr } = await admin.from('teachers').insert({
          auth_user_id: teacherAuthId,
          name: `${marker}-teacher`,
          email: `${marker}-teacher@certification.alfanumrik.invalid`,
          school_id: schoolId,
          is_demo: true,
        });
        expect(teacherErr, teacherErr?.message).toBeNull();

        // ── Register the student in demo_accounts (registry-path branch) ──
        const { error: demoAcctErr } = await admin.from('demo_accounts').insert({
          auth_user_id: studentAuthId,
          role: 'student',
          display_name: `${marker}-student`,
          email: `${marker}-student@certification.alfanumrik.invalid`,
          school_id: schoolId,
          is_active: true,
        });
        expect(demoAcctErr, demoAcctErr?.message).toBeNull();

        // ── Seed the 4 defensively-cleaned school-scoped child tables ──
        const { error: alertErr } = await admin.from('school_alert_rules').insert({
          school_id: schoolId,
          rule_type: 'seat_limit',
          threshold: 100,
        });
        expect(alertErr, alertErr?.message).toBeNull();

        const { error: auditErr } = await admin.from('school_audit_log').insert({
          school_id: schoolId,
          actor_id: randomUUID(),
          action: 'reg229_test_seed',
        });
        expect(auditErr, auditErr?.message).toBeNull();

        // Capture the invoice id — it's the FK target that makes the ordering
        // proof below meaningful (see payment_reconciliation_queue below).
        const { data: invoice, error: invoiceErr } = await admin
          .from('school_invoices')
          .insert({
            school_id: schoolId,
            period_start: '2026-07-01',
            period_end: '2026-07-31',
            seats_used: 1,
            amount_inr: 0,
          })
          .select('id')
          .single();
        expect(invoiceErr, invoiceErr?.message).toBeNull();
        const invoiceId = (invoice as { id: string }).id;

        const { error: seatErr } = await admin.from('school_seat_usage').insert({
          school_id: schoolId,
        });
        expect(seatErr, seatErr?.message).toBeNull();

        // ── Seed the 4 per-student RESTRICT/no-cascade child tables
        //    (corrected FK inventory items 1-4: foxy_chat_messages,
        //    foxy_sessions, ai_workflow_traces, admin_impersonation_sessions).
        //    This student IS registered in demo_accounts (above), so these
        //    rows are cleared via the REGISTERED path —
        //    purge_demo_account_by_id's student branch — not the defensive
        //    direct sweep (that unregistered-row branch is already exercised
        //    by the teacher fixture above, which has no per-teacher
        //    equivalent of these 4 tables to worry about since no blocking
        //    teachers(id) FK exists anywhere in the schema per the migration
        //    header's "CHECKED AND CONFIRMED SAFE" section). ──
        const { data: foxySession, error: foxySessionErr } = await admin
          .from('foxy_sessions')
          .insert({ student_id: studentId, subject: 'Mathematics', grade: '10', mode: 'learn' })
          .select('id')
          .single();
        expect(foxySessionErr, foxySessionErr?.message).toBeNull();
        const foxySessionId = (foxySession as { id: string }).id;

        const { error: foxyMsgErr } = await admin.from('foxy_chat_messages').insert({
          session_id: foxySessionId,
          student_id: studentId,
          role: 'user',
          content: `${marker}-message`,
        });
        expect(foxyMsgErr, foxyMsgErr?.message).toBeNull();

        const { error: traceErr } = await admin.from('ai_workflow_traces').insert({
          trace_id: `${marker}-trace`,
          workflow: 'foxy_chat',
          student_id: studentId,
          subject: 'Mathematics',
          grade: '10',
        });
        expect(traceErr, traceErr?.message).toBeNull();

        // admin_impersonation_sessions.admin_id is NOT NULL REFERENCES
        // admin_users(id) — needs a real row to point at. This row is
        // intentionally OUTSIDE the demo tenant (admin_users has no
        // school_id/is_demo column) and is cleaned up in `finally`, not by
        // the purge — matching the migration's documented scope.
        const { data: adminUser, error: adminUserErr } = await admin
          .from('admin_users')
          .insert({ name: `${marker}-admin`, email: `${marker}-admin@certification.alfanumrik.invalid` })
          .select('id')
          .single();
        expect(adminUserErr, adminUserErr?.message).toBeNull();
        adminUserId = (adminUser as { id: string }).id;

        const { error: impersonationErr } = await admin.from('admin_impersonation_sessions').insert({
          admin_id: adminUserId,
          student_id: studentId,
        });
        expect(impersonationErr, impersonationErr?.message).toBeNull();

        // ── Seed the 2 tenant-level/B2B child tables (corrected FK inventory
        //    items 5-7). payment_reconciliation_queue.invoice_id points at
        //    the SAME school_invoices row seeded above — this link is what
        //    makes the post-teardown assertions below an actual ordering
        //    proof, not just a presence/absence check (see the comment at
        //    the assertion site). ──
        const { error: prqErr } = await admin.from('payment_reconciliation_queue').insert({
          invoice_id: invoiceId,
          school_id: schoolId,
          expected_amount_inr: 100,
          received_amount_inr: 100,
          payment_method: 'bank_transfer',
          reference_number: `${marker}-utr`,
          submitted_by_user_id: randomUUID(),
        });
        expect(prqErr, prqErr?.message).toBeNull();

        const { error: contractErr } = await admin.from('school_contracts').insert({
          school_id: schoolId,
          contract_number: `${marker}-contract`,
          start_date: '2026-07-01',
          end_date: '2027-07-01',
          billing_cycle: 'annual',
          seats_purchased: 50,
          value_inr: 500000,
        });
        expect(contractErr, contractErr?.message).toBeNull();

        // ── Pre-condition sanity: everything we just seeded is actually there ──
        expect(await countWhereSchool(admin, 'students', schoolId)).toBe(1);
        expect(await countWhereSchool(admin, 'teachers', schoolId)).toBe(1);
        expect(await countWhereSchool(admin, 'school_alert_rules', schoolId)).toBe(1);
        expect(await countWhereSchool(admin, 'school_audit_log', schoolId)).toBe(1);
        expect(await countWhereSchool(admin, 'school_invoices', schoolId)).toBe(1);
        expect(await countWhereSchool(admin, 'school_seat_usage', schoolId)).toBe(1);
        expect(await countWhereStudent(admin, 'foxy_sessions', studentId)).toBe(1);
        expect(await countWhereStudent(admin, 'foxy_chat_messages', studentId)).toBe(1);
        expect(await countWhereStudent(admin, 'ai_workflow_traces', studentId)).toBe(1);
        expect(await countWhereStudent(admin, 'admin_impersonation_sessions', studentId)).toBe(1);
        expect(await countWhereSchool(admin, 'payment_reconciliation_queue', schoolId)).toBe(1);
        expect(await countWhereSchool(admin, 'school_contracts', schoolId)).toBe(1);

        // ═══════════════ FIRST CALL: real teardown ═══════════════
        const first = await callPurge(admin, schoolId);
        expect(first.error, first.error?.message).toBeNull();
        expect(first.data?.success).toBe(true);
        expect(first.data?.already_absent).toBe(false);
        // Registry-path (student, via demo_accounts) + direct-sweep path
        // (teacher, no registry row) both fired.
        expect(first.data?.registry_accounts_purged).toBeGreaterThanOrEqual(1);
        expect(first.data?.teachers_purged_direct).toBeGreaterThanOrEqual(1);

        // Zero rows remain across every touched table, for this school id.
        expect(await countWhereSchool(admin, 'students', schoolId)).toBe(0);
        expect(await countWhereSchool(admin, 'teachers', schoolId)).toBe(0);
        expect(await countWhereSchool(admin, 'school_alert_rules', schoolId)).toBe(0);
        expect(await countWhereSchool(admin, 'school_audit_log', schoolId)).toBe(0);
        expect(await countWhereSchool(admin, 'school_invoices', schoolId)).toBe(0);
        expect(await countWhereSchool(admin, 'school_seat_usage', schoolId)).toBe(0);

        // Zero rows remain across the 4 per-student RESTRICT/no-cascade child
        // tables (corrected FK inventory items 1-4). If purge_demo_account_by_id's
        // student branch regressed to NOT clear these before its `DELETE FROM
        // students`, the RPC call above would have raised 23503 instead of
        // succeeding — `first.error` would be non-null and this whole block
        // would already have failed before reaching these lines. Asserting
        // the counts too (rather than only the error) additionally catches a
        // narrower regression: a clearing statement that runs but is scoped
        // wrong (e.g. filters on the wrong student_id) and so silently leaves
        // orphaned rows without tripping the FK at all.
        expect(await countWhereStudent(admin, 'foxy_sessions', studentId)).toBe(0);
        expect(await countWhereStudent(admin, 'foxy_chat_messages', studentId)).toBe(0);
        expect(await countWhereStudent(admin, 'ai_workflow_traces', studentId)).toBe(0);
        expect(await countWhereStudent(admin, 'admin_impersonation_sessions', studentId)).toBe(0);

        // Zero rows remain across the 2 tenant-level/B2B child tables
        // (corrected FK inventory items 5-7).
        //
        // ORDERING PROOF, not just a presence/absence check: this fixture's
        // payment_reconciliation_queue row was seeded with invoice_id pointing
        // at the SAME school_invoices row this suite already asserted is gone
        // (above). The migration's step (c) deletes
        // `payment_reconciliation_queue` BEFORE `school_invoices` specifically
        // because prq.invoice_id is `ON DELETE RESTRICT` against
        // school_invoices(id) (corrected FK inventory item 6). If a future
        // edit reversed that order — ran `DELETE FROM school_invoices` while
        // this fixture's linked payment_reconciliation_queue row still
        // existed — that DELETE would hit the RESTRICT FK, the whole RPC call
        // would raise a 23503 and roll back the entire transaction, `first.error`
        // would be non-null, and EVERY assertion in this block (including the
        // students/teachers/school_invoices ones above) would already have
        // failed before execution ever reached this point — nothing in the
        // transaction partially commits. So a passing test here is a genuine
        // ordering regression guard, not a coincidence of both tables ending
        // up empty independently.
        expect(await countWhereSchool(admin, 'payment_reconciliation_queue', schoolId)).toBe(0);
        expect(await countWhereSchool(admin, 'school_contracts', schoolId)).toBe(0);

        const { count: demoAcctCount, error: demoAcctCountErr } = await admin
          .from('demo_accounts')
          .select('id', { count: 'exact', head: true })
          .eq('school_id', schoolId);
        expect(demoAcctCountErr).toBeNull();
        expect(demoAcctCount ?? 0).toBe(0);

        expect(await schoolExists(admin, schoolId)).toBe(false);

        // ═══════════════ SECOND CALL: idempotent no-op ═══════════════
        const second = await callPurge(admin, schoolId);
        expect(second.error, second.error?.message).toBeNull();
        expect(second.data?.success).toBe(true);
        expect(second.data?.already_absent).toBe(true);

        // ═══════════════ THIRD CALL: still a clean no-op ═══════════════
        const third = await callPurge(admin, schoolId);
        expect(third.error, third.error?.message).toBeNull();
        expect(third.data?.success).toBe(true);
        expect(third.data?.already_absent).toBe(true);

        // Still zero rows everywhere, after both idempotent re-calls —
        // across the original tables and all 6 newly-covered ones.
        expect(await countWhereSchool(admin, 'students', schoolId)).toBe(0);
        expect(await countWhereSchool(admin, 'teachers', schoolId)).toBe(0);
        expect(await countWhereStudent(admin, 'foxy_sessions', studentId)).toBe(0);
        expect(await countWhereStudent(admin, 'foxy_chat_messages', studentId)).toBe(0);
        expect(await countWhereStudent(admin, 'ai_workflow_traces', studentId)).toBe(0);
        expect(await countWhereStudent(admin, 'admin_impersonation_sessions', studentId)).toBe(0);
        expect(await countWhereSchool(admin, 'payment_reconciliation_queue', schoolId)).toBe(0);
        expect(await countWhereSchool(admin, 'school_contracts', schoolId)).toBe(0);
        expect(await schoolExists(admin, schoolId)).toBe(false);
      } finally {
        // admin_users is never touched by the purge (correctly — it's not a
        // demo-tenant row) so it must be cleaned up here regardless of
        // whether the assertions above passed or failed.
        if (adminUserId) {
          await admin.from('admin_users').delete().eq('id', adminUserId);
        }
      }
    });

    it('a school_id that never existed returns the idempotent no-op shape on the very first call', async (ctx) => {
      skipIfNoSubstrate(ctx, available, `RPC probe failed: ${setupError ?? ''}`);
      const neverExisted = randomUUID();
      const { data, error } = await callPurge(admin, neverExisted);
      expect(error, error?.message).toBeNull();
      expect(data?.success).toBe(true);
      expect(data?.already_absent).toBe(true);
    });
  });
});
