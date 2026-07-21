import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Regression coverage for the parent-dashboard RCA fixes (2026-07-20).
// See supabase/migrations/20260720170000_parent_dashboard_rca_fixes.sql
//
// Root cause recap:
//   - 11 RLS policies gated parent SELECT access on
//     guardian_student_links.status = 'approved' only, while the live
//     self-service OTP linking flow sets status = 'active'. Guardians
//     linked via that flow silently saw zero rows on score/xp/coin/quiz/
//     skill-state/exam/monthly-report tables even though their link
//     succeeded.
//   - link_guardian_to_student_via_code (the OTP-redeem RPC target) only
//     matched students.invite_code, not students.link_code, causing a
//     false Invalid invite code rejection after a correct OTP.
//   - teacher_parent_threads had no INSERT RLS policy (app-layer-only
//     trust boundary).
//   - synthesis/parent-share skipped the house authorizeRequest() RBAC
//     gate used by every other parent-portal route.
//
// This file intentionally uses exact substring assertions (toContain)
// rather than regex with escape sequences, since the migration file's
// exact formatting is known (it was written deterministically) and
// substring checks are simpler to keep correct than regex escaping.

const repoRoot = path.resolve(__dirname, '../../../..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260720170000_parent_dashboard_rca_fixes.sql',
);

describe('Parent dashboard RCA fixes migration (2026-07-20)', () => {
  it('exists on disk', () => {
    expect(existsSync(migrationPath), 'missing parent dashboard RCA fixes migration').toBe(true);
  });

  const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

  const AFFECTED_POLICIES: Array<{ policy: string; table: string }> = [
    { policy: 'score_history_parent_select', table: 'score_history' },
    { policy: 'xp_txn_parent_select', table: 'xp_transactions' },
    { policy: 'coin_bal_parent_select', table: 'coin_balances' },
    { policy: 'coin_txn_parent_select', table: 'coin_transactions' },
    { policy: 'challenge_attempts_parent_select', table: 'challenge_attempts' },
    { policy: 'challenge_streaks_parent_select', table: 'challenge_streaks' },
    { policy: 'quiz_session_shuffles_parent_select', table: 'quiz_session_shuffles' },
    { policy: 'student_skill_state_parent_select', table: 'student_skill_state' },
    { policy: 'perf_scores_parent_select', table: 'performance_scores' },
    { policy: 'guardians_view_exam_configs', table: 'exam_configs' },
    { policy: 'guardians_view_monthly_reports', table: 'monthly_reports' },
  ];

  it.each(AFFECTED_POLICIES)(
    'FINDING A: drops and recreates $policy on $table',
    ({ policy, table }) => {
      expect(sql).toContain(
        'DROP POLICY IF EXISTS "' + policy + '" ON "public"."' + table + '"',
      );
      expect(sql).toContain('CREATE POLICY "' + policy + '" ON "public"."' + table + '"');
    },
  );

  it.each(AFFECTED_POLICIES)(
    'FINDING A: $policy uses is_guardian_of(student_id), not a bare status literal',
    ({ policy }) => {
      const createIdx = sql.indexOf('CREATE POLICY "' + policy + '"');
      expect(createIdx, 'CREATE POLICY block for ' + policy + ' not found').toBeGreaterThan(-1);
      const nextSemicolon = sql.indexOf(';', createIdx);
      expect(nextSemicolon).toBeGreaterThan(createIdx);
      const block = sql.slice(createIdx, nextSemicolon + 1);
      expect(block).toContain('is_guardian_of(student_id)');
      expect(block).not.toContain("status = 'approved'");
      expect(block).not.toContain('status = "approved"');
    },
  );

  it('FINDING B: link_guardian_to_student_via_code matches invite_code OR link_code', () => {
    const fnStartIdx = sql.indexOf(
      'CREATE OR REPLACE FUNCTION "public"."link_guardian_to_student_via_code"',
    );
    expect(fnStartIdx).toBeGreaterThan(-1);
    const fnEndIdx = sql.indexOf('$$;', fnStartIdx);
    expect(fnEndIdx).toBeGreaterThan(fnStartIdx);
    const fnBody = sql.slice(fnStartIdx, fnEndIdx + 3);
    expect(fnBody).toContain('invite_code = v_code OR link_code = v_code');
    expect(fnBody).toContain('SECURITY DEFINER');
  });

  it('FINDING E: teacher_parent_threads gets a guardian-scoped INSERT RLS policy', () => {
    const idx = sql.indexOf('CREATE POLICY "tp_threads_guardian_insert"');
    expect(idx).toBeGreaterThan(-1);
    const nextSemicolon = sql.indexOf(';', idx);
    const block = sql.slice(idx, nextSemicolon + 1);
    expect(block).toContain('FOR INSERT');
    expect(block).toContain('is_guardian_of(student_id)');
  });
});

describe('synthesis/parent-share RBAC gate (Task 1.5)', () => {
  const routePath = path.join(
    repoRoot,
    'apps/host/src/app/api/synthesis/parent-share/route.ts',
  );

  it('calls authorizeRequest before any DB access, keeping the inline ownership check', () => {
    const route = readFileSync(routePath, 'utf8');
    expect(route).toContain("import { authorizeRequest } from '@alfanumrik/lib/rbac';");
    expect(route).toContain("authorizeRequest(request, 'report.download_own')");

    const rbacIdx = route.indexOf('authorizeRequest(request');
    const ownershipIdx = route.indexOf('row.students.auth_user_id !== userId');
    const supabaseAdminCallIdx = route.indexOf('supabaseAdmin', rbacIdx + 1);
    expect(rbacIdx).toBeGreaterThan(-1);
    expect(ownershipIdx).toBeGreaterThan(rbacIdx);
    expect(supabaseAdminCallIdx).toBeGreaterThan(rbacIdx);
  });
});
