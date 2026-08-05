import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * REG-348 companion — static structure pin for migration
 * 20260806000100_safeguarding_escalations.sql (Foxy North-Star Phase 1, U6).
 *
 * This table's RLS posture is a DELIBERATE DEVIATION from the house
 * 4-pattern template (student-own / parent-linked / teacher-assigned /
 * admin-service-role): NO student, parent, or teacher SELECT policy may
 * ever exist here — a student (or an abuser with device access) being able
 * to read their own escalation rows is itself a harm vector, and parent
 * notification is a human reviewer decision (approval A1), never a
 * direct-read grant. The ONLY policy is service_role ALL; every read goes
 * through service-role server routes: the school-admin lane gated by
 * authorizeSchoolAdmin(request, 'safeguarding.review') (granted to
 * institution_admin; narrowed to principal + institution_admin by the Wave C
 * capability matrix under ff_school_admin_rbac), the super-admin lane gated
 * by authorizeAdmin(request, 'admin') per the /api/super-admin/* house
 * convention.
 *
 * Static SQL-text pin (no live DB), following the established pattern in
 * teachers-classes-rls-tenant-leak-fix.test.ts. See
 * .claude/regression/02-foxy-ai.md REG-348..REG-350 for the narrative.
 */

const migrationsDir = join(process.cwd(), '..', '..', 'supabase', 'migrations');
const sql = readFileSync(
  join(migrationsDir, '20260806000100_safeguarding_escalations.sql'),
  'utf8',
);

// Active DDL only — header comments legitimately DESCRIBE the excluded
// policies while explaining the deviation, so strip `--` lines before
// asserting what the migration actually DOES.
const activeDdl = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('migration 20260806000100 — safeguarding_escalations structure', () => {
  it('creates the table idempotently and ENABLES RLS in the same migration (P8)', () => {
    expect(activeDdl).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.safeguarding_escalations/,
    );
    expect(activeDdl).toMatch(
      /ALTER TABLE public\.safeguarding_escalations ENABLE ROW LEVEL SECURITY/,
    );
  });

  it('has EXACTLY ONE policy, granted to service_role only', () => {
    const policies = activeDdl.match(/CREATE POLICY/g) ?? [];
    expect(policies).toHaveLength(1);
    expect(activeDdl).toMatch(
      /CREATE POLICY "safeguarding_escalations_service_role_all"[\s\S]*?FOR ALL[\s\S]*?TO service_role/,
    );
  });

  it('grants NO student/parent/teacher/authenticated/anon read path (deliberate deviation)', () => {
    // No policy may target any principal other than service_role.
    expect(activeDdl).not.toMatch(/TO authenticated/i);
    expect(activeDdl).not.toMatch(/TO anon/i);
    expect(activeDdl).not.toMatch(/auth\.uid\(\)/);
    // The house student-own / parent-linked / teacher-assigned predicates
    // must not appear in active DDL.
    expect(activeDdl).not.toMatch(/parent_student_links/i);
    expect(activeDdl).not.toMatch(/teacher_students|class_students/i);
  });

  it('carries the deliberate-deviation rationale comment so a future "fix" cannot claim ignorance', () => {
    expect(sql).toMatch(/DELIBERATE DEVIATION/);
    expect(sql).toMatch(/NO student self-read policy/);
    expect(sql).toMatch(/NO parent-linked policy/);
    expect(sql).toMatch(/NO teacher-assigned policy/);
  });

  it('caps disclosure_excerpt at 500 chars and constrains category/tier/status enums', () => {
    expect(activeDdl).toMatch(
      /disclosure_excerpt IS NULL OR length\(disclosure_excerpt\) <= 500/,
    );
    expect(activeDdl).toMatch(
      /category IN \('self_harm', 'abuse', 'violence', 'acute_distress'\)/,
    );
    expect(activeDdl).toMatch(/tier IN \('regex_only', 'llm_confirmed'\)/);
    expect(activeDdl).toMatch(
      /status IN \('pending_review', 'reviewed', 'actioned', 'dismissed'\)/,
    );
  });

  it('seeds safeguarding.review and grants it to institution_admin + admin + super_admin in the SAME migration', () => {
    expect(activeDdl).toMatch(/'safeguarding\.review'/);
    expect(activeDdl).toMatch(/ON CONFLICT \(code\) DO NOTHING/);
    expect(activeDdl).toMatch(/r\.name = 'institution_admin'/);
    expect(activeDdl).toMatch(/r\.name IN \('admin', 'super_admin'\)/);
    expect(activeDdl).toMatch(/ON CONFLICT \(role_id, permission_id\) DO NOTHING/);
  });

  it('has a 90-day retention boundary column with default', () => {
    expect(activeDdl).toMatch(
      /retain_until\s+timestamptz NOT NULL DEFAULT \(now\(\) \+ interval '90 days'\)/,
    );
  });

  it('is additive-only: no DROP TABLE/COLUMN, no DELETE, no RBAC UPDATE', () => {
    expect(activeDdl).not.toMatch(/DROP TABLE/i);
    expect(activeDdl).not.toMatch(/DROP COLUMN/i);
    expect(activeDdl).not.toMatch(/\bDELETE FROM\b/i);
    expect(activeDdl).not.toMatch(/UPDATE (permissions|roles|role_permissions)\b/i);
  });
});
