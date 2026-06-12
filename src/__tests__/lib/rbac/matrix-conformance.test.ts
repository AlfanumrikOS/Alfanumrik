/**
 * RBAC Matrix Conformance Test
 *
 * Proves the Alfanumrik RBAC Matrix is 100% present by STATICALLY verifying
 * that the conformance migration
 *   supabase/migrations/20260612123200_rbac_matrix_conformance.sql
 * contains:
 *   1. every one of the 11 matrix roles (INSERT INTO roles),
 *   2. every matrix permission code (INSERT INTO permissions),
 *   3. every role -> permission grant (each role's grant block lists each code),
 *   4. the institution_admin -> teacher inheritance grant,
 *   5. all 4 resource_access_rules ownership patterns
 *      (student->own, parent->linked, teacher->assigned, admin->any),
 *   6. that the migration is ADDITIVE + IDEMPOTENT (no DROP/DELETE/TRUNCATE;
 *      ON CONFLICT DO NOTHING / WHERE NOT EXISTS guards).
 *
 * WHY STATIC (offline) rather than a live-DB assertion:
 *   Unit tests have no Supabase connection. The migration file is the
 *   source-of-truth artifact that makes the matrix reproducible on every
 *   fresh environment (CI live-DB, new staging, DR). Locking the matrix to
 *   the migration text means any future drift — a role dropped from the seed,
 *   a permission grant removed, a resource rule deleted — fails CI here before
 *   it can reach a database. The matrix below is the canonical encoding; the
 *   migration must cover it exactly (superset rows in prod are allowed and not
 *   asserted here, matching the additive-only contract).
 *
 * Pattern: src/__tests__/lib/irt/fisher-info.test.ts (pure, deterministic,
 * offline) + the migration-file-existence guard pattern from
 * src/__tests__/lib/feature-flags-phase2-goal-selection-registry.test.ts.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

// ─── Canonical matrix encoding (role -> expected permission codes) ────────────
// Sourced from the applied RBAC seed chain:
//   _legacy/20260324070000_production_rbac_system.sql (base 6 roles + grants + RARs)
//   _legacy/20260327210000_extended_rbac_roles.sql    (5 extended roles + grants)
//   _legacy/20260409000005_add_diagnostic_permissions.sql
//   _legacy/20260417100000_rbac_phase1_security_hardening.sql (tutor + foxy.interact + stem.observe)
//   _legacy/20260418120000_super_admin_access_permission_seed.sql
//   20260505120000_account_deletion_flow.sql (account.delete)
//   20260507110000 / 20260416200100 (school.*)
//   20260610110000 (school.manage_content + diagnostic.*)
//   20260611000050 (payments.subscribe)
//   20260613000000 (child.encourage)
//   20260614000002 (institution.* Wave C)

const MIGRATION_RELATIVE_PATH =
  'supabase/migrations/20260612123200_rbac_matrix_conformance.sql';

const ALL_ROLES = [
  'student',
  'parent',
  'tutor',
  'teacher',
  'support',
  'reviewer',
  'content_manager',
  'finance',
  'institution_admin',
  'admin',
  'super_admin',
] as const;

// Direct (non-wildcard, non-inherited) grants per role.
// admin + super_admin hold ALL permissions via a wildcard grant (asserted
// separately). institution_admin additionally INHERITS teacher (asserted
// separately). The lists below are the EXPLICIT grant blocks each role must
// have in the migration.
const ROLE_GRANTS: Record<string, string[]> = {
  student: [
    'study_plan.view', 'study_plan.create', 'quiz.attempt', 'quiz.view_results',
    'exam.view', 'exam.create', 'image.upload', 'image.view_own',
    'report.view_own', 'report.download_own', 'review.view', 'review.practice',
    'foxy.chat', 'foxy.interact', 'simulation.view', 'simulation.interact',
    'leaderboard.view', 'profile.view_own', 'profile.update_own',
    'notification.view', 'notification.dismiss', 'progress.view_own',
    'diagnostic.attempt', 'diagnostic.complete', 'stem.observe',
    'payments.subscribe', 'account.delete',
  ],
  parent: [
    'child.view_performance', 'child.view_progress', 'child.download_report',
    'child.view_exams', 'child.receive_alerts', 'child.encourage',
    'profile.view_own', 'profile.update_own', 'notification.view',
    'notification.dismiss', 'account.delete',
  ],
  teacher: [
    'class.manage', 'class.view_analytics', 'exam.assign', 'exam.create_for_class',
    'test.create', 'test.edit', 'student.view_uploads', 'student.provide_feedback',
    'worksheet.create', 'worksheet.assign', 'report.view_class',
    'profile.view_own', 'profile.update_own', 'notification.view',
    'notification.dismiss', 'leaderboard.view', 'account.delete',
  ],
  tutor: [
    'tutor.view_student', 'tutor.provide_feedback', 'tutor.view_analytics',
    'tutor.create_worksheet', 'tutor.assign_worksheet',
    'profile.view_own', 'profile.update_own', 'notification.view',
    'notification.dismiss', 'leaderboard.view',
  ],
  content_manager: [
    'content.create', 'content.edit', 'content.submit_review', 'content.view_all',
    'content.manage_questions', 'content.manage_media',
    'profile.view_own', 'profile.update_own', 'notification.view', 'notification.dismiss',
  ],
  reviewer: [
    'content.review', 'content.approve', 'content.reject', 'content.view_drafts',
    'content.view_all',
    'profile.view_own', 'profile.update_own', 'notification.view', 'notification.dismiss',
  ],
  support: [
    'support.view_tickets', 'support.manage_tickets', 'support.view_user_activity',
    'support.fix_relationships', 'support.resend_invites', 'support.reset_passwords',
    'profile.view_own', 'profile.update_own', 'notification.view', 'notification.dismiss',
  ],
  finance: [
    'finance.view_revenue', 'finance.view_subscriptions', 'finance.manage_refunds',
    'finance.export_reports',
    'profile.view_own', 'profile.update_own', 'notification.view', 'notification.dismiss',
  ],
  institution_admin: [
    'institution.manage', 'institution.view_analytics', 'institution.manage_teachers',
    'institution.manage_students', 'institution.view_reports',
    'institution.export_reports', 'institution.manage_billing',
    'institution.view_billing', 'institution.manage_staff',
    'school.manage_branding', 'school.manage_billing', 'school.manage_domain',
    'school.export_data', 'school.manage_settings', 'school.manage_modules',
    'school.manage_content',
  ],
};

// The full permission-code universe of the matrix = union of every role's
// explicit grants + the super-admin-only codes (granted via the admin /
// super_admin wildcards, which is why they are not in any explicit block).
const SUPER_ADMIN_ONLY_CODES = ['super_admin.access', 'super_admin.subjects.manage'];

const ALL_MATRIX_CODES: string[] = Array.from(
  new Set([
    ...Object.values(ROLE_GRANTS).flat(),
    ...SUPER_ADMIN_ONLY_CODES,
  ]),
).sort();

// The 4 ownership patterns => 15 concrete resource_access_rules.
const RESOURCE_ACCESS_RULES: Array<[string, string, string]> = [
  ['student', 'student', 'own'],
  ['student', 'quiz', 'own'],
  ['student', 'study_plan', 'own'],
  ['student', 'report', 'own'],
  ['student', 'image', 'own'],
  ['parent', 'student', 'linked'],
  ['parent', 'report', 'linked'],
  ['parent', 'image', 'linked'],
  ['teacher', 'student', 'assigned'],
  ['teacher', 'class', 'assigned'],
  ['teacher', 'report', 'assigned'],
  ['teacher', 'image', 'assigned'],
  ['admin', 'student', 'any'],
  ['admin', 'report', 'any'],
  ['admin', 'class', 'any'],
];

// ─── Load the migration once ─────────────────────────────────────────────────
const migrationPath = resolve(process.cwd(), MIGRATION_RELATIVE_PATH);
const migrationSql = readFileSync(migrationPath, 'utf8');

/**
 * Extracts the body of a role's explicit grant block from the migration —
 * i.e. the text of the `WHERE r.name = '<role>' AND p.code IN ( ... )`
 * INSERT...SELECT statement. Returns '' if the role has no explicit block
 * (admin/super_admin use a wildcard with no `p.code IN`).
 */
function extractRoleGrantBlock(sql: string, role: string): string {
  // Match: WHERE r.name = 'role' AND p.code IN ( ... )   up to the closing ')'
  const re = new RegExp(
    `WHERE\\s+r\\.name\\s*=\\s*'${role}'\\s+AND\\s+p\\.code\\s+IN\\s*\\(([\\s\\S]*?)\\)`,
    'i',
  );
  const m = sql.match(re);
  return m ? m[1] : '';
}

describe('RBAC matrix conformance — migration file exists & is well-formed', () => {
  it('the conformance migration exists at the timestamped root path', () => {
    expect(migrationSql.length).toBeGreaterThan(0);
  });

  it('declares itself additive + idempotent and uses a transaction', () => {
    expect(migrationSql).toMatch(/BEGIN;/);
    expect(migrationSql).toMatch(/COMMIT;/);
    expect(migrationSql).toMatch(/ON CONFLICT/);
  });

  it('contains NO destructive statements (additive-only contract)', () => {
    // Guard the body against DROP/DELETE/TRUNCATE/UPDATE of matrix tables.
    // (Comment lines may mention them in the reversible-recipe note, so strip
    //  SQL comments first.)
    const codeOnly = migrationSql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(codeOnly).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(codeOnly).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(codeOnly).not.toMatch(/\bTRUNCATE\b/i);
    // No UPDATE of the RBAC tables (plan_permission_overrides upserts live
    // elsewhere; this migration must not mutate existing rows).
    expect(codeOnly).not.toMatch(/\bUPDATE\s+(roles|permissions|role_permissions|resource_access_rules)\b/i);
  });
});

describe('RBAC matrix conformance — all 11 roles seeded', () => {
  it.each(ALL_ROLES)('seeds role "%s" in INSERT INTO roles', (role) => {
    // Each role appears as a quoted value in the VALUES list of INSERT INTO roles.
    expect(migrationSql).toMatch(new RegExp(`\\(\\s*'${role}'\\s*,`));
  });

  it('seeds roles with ON CONFLICT (name) DO NOTHING (idempotent)', () => {
    expect(migrationSql).toMatch(/INSERT INTO roles[\s\S]*?ON CONFLICT \(name\) DO NOTHING/);
  });

  it('encodes exactly 11 roles in the matrix', () => {
    expect(ALL_ROLES.length).toBe(11);
  });
});

describe('RBAC matrix conformance — every permission code seeded', () => {
  // The permissions INSERT block is the single big INSERT INTO permissions (...).
  const permBlock = (() => {
    const m = migrationSql.match(/INSERT INTO permissions[\s\S]*?ON CONFLICT \(code\) DO NOTHING/);
    return m ? m[0] : '';
  })();

  it('has a permissions INSERT block guarded by ON CONFLICT (code) DO NOTHING', () => {
    expect(permBlock.length).toBeGreaterThan(0);
  });

  it.each(ALL_MATRIX_CODES)('defines permission code "%s"', (code) => {
    expect(permBlock).toContain(`'${code}'`);
  });
});

describe('RBAC matrix conformance — every role->permission grant present', () => {
  for (const [role, codes] of Object.entries(ROLE_GRANTS)) {
    describe(`role "${role}" grant block`, () => {
      const block = extractRoleGrantBlock(migrationSql, role);

      it('has an explicit p.code IN (...) grant block', () => {
        expect(block.length).toBeGreaterThan(0);
      });

      it.each(codes)(`grants "%s"`, (code) => {
        expect(block).toContain(`'${code}'`);
      });
    });
  }

  it('admin holds ALL permissions via a wildcard grant (no p.code filter)', () => {
    expect(migrationSql).toMatch(
      /FROM roles r CROSS JOIN permissions p\s+WHERE r\.name = 'admin'\s+ON CONFLICT/,
    );
  });

  it('super_admin holds ALL permissions via a wildcard grant (no p.code filter)', () => {
    expect(migrationSql).toMatch(
      /FROM roles r CROSS JOIN permissions p\s+WHERE r\.name = 'super_admin'\s+ON CONFLICT/,
    );
  });

  it('institution_admin INHERITS all teacher permissions', () => {
    // The inheritance grant joins role_permissions of the teacher role into
    // institution_admin.
    expect(migrationSql).toMatch(/r_inst\.name = 'institution_admin'/);
    expect(migrationSql).toMatch(/r_teacher\.name = 'teacher'/);
    expect(migrationSql).toMatch(
      /SELECT r_inst\.id, rp\.permission_id[\s\S]*?JOIN role_permissions rp ON rp\.role_id = r_teacher\.id/,
    );
  });

  it('every role->permission grant uses ON CONFLICT (role_id, permission_id) DO NOTHING', () => {
    const grantStatements = migrationSql.match(
      /INSERT INTO role_permissions[\s\S]*?ON CONFLICT[^\n]*/g,
    );
    expect(grantStatements).not.toBeNull();
    expect(grantStatements!.length).toBeGreaterThanOrEqual(11);
    for (const stmt of grantStatements!) {
      expect(stmt).toMatch(/ON CONFLICT \(role_id, permission_id\) DO NOTHING/);
    }
  });
});

describe('RBAC matrix conformance — 4 resource_access_rules ownership patterns', () => {
  const rarBlock = (() => {
    const m = migrationSql.match(
      /INSERT INTO resource_access_rules[\s\S]*?(?:;|WHERE NOT EXISTS[\s\S]*?\);)/,
    );
    return m ? m[0] : migrationSql;
  })();

  it('inserts resource_access_rules idempotently via WHERE NOT EXISTS', () => {
    // resource_access_rules has NO unique constraint, so ON CONFLICT cannot
    // dedupe — the migration MUST guard with WHERE NOT EXISTS.
    expect(migrationSql).toMatch(/INSERT INTO resource_access_rules/);
    expect(migrationSql).toMatch(/WHERE NOT EXISTS[\s\S]*?resource_access_rules rar/);
  });

  it.each(RESOURCE_ACCESS_RULES)(
    'rule: role "%s" -> resource "%s" -> ownership "%s"',
    (role, resource, ownership) => {
      // The VALUES row appears as ('role', 'resource', 'ownership').
      const re = new RegExp(
        `'${role}'\\s*,\\s*'${resource}'\\s*,\\s*'${ownership}'`,
      );
      expect(rarBlock).toMatch(re);
    },
  );

  it('covers all 4 ownership patterns: own / linked / assigned / any', () => {
    const patterns = new Set(RESOURCE_ACCESS_RULES.map((r) => r[2]));
    expect(patterns).toEqual(new Set(['own', 'linked', 'assigned', 'any']));
    for (const pattern of patterns) {
      expect(rarBlock).toContain(`'${pattern}'`);
    }
  });
});

describe('RBAC matrix conformance — matrix shape sanity', () => {
  it('the matrix spans 11 roles and a >=60-code permission universe', () => {
    expect(ALL_ROLES.length).toBe(11);
    expect(ALL_MATRIX_CODES.length).toBeGreaterThanOrEqual(60);
  });

  it('student/parent/teacher/tutor each have a distinct, non-empty grant set', () => {
    for (const role of ['student', 'parent', 'teacher', 'tutor']) {
      expect(ROLE_GRANTS[role].length).toBeGreaterThan(0);
    }
  });
});
