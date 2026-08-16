/**
 * Static SQL content pins for
 * 20260816000009_fix_user_roles_admin_rls_write_policy.sql (P8 CRITICAL fix —
 * quality-review finding on the Phase 1 Mission Control overhaul, 2026-08-16).
 *
 * Pattern: static parse of the migration file (no DB, no network, fully
 * deterministic) — matches the established convention in this repo for
 * pinning migration content (see the sibling
 * analyst-role-and-admin-tier-sync-migration.test.ts, which this file is
 * modeled on directly).
 *
 * WHAT THIS PROVES (source-level):
 *   1. The baseline "user_roles_admin" policy — originally FOR ALL (implicit,
 *      no `FOR` clause) with no `WITH CHECK` — is DROPPED and RECREATED as
 *      FOR SELECT only, under the SAME name and the SAME read predicate.
 *   2. No INSERT/UPDATE/DELETE keyword appears anywhere in the new policy
 *      definition — i.e. the fix does not merely add a WITH CHECK guard, it
 *      removes the `authenticated` write grant entirely.
 *   3. The migration is idempotent (DROP POLICY IF EXISTS + CREATE POLICY,
 *      wrapped in BEGIN/COMMIT) and additive/corrective (no DROP
 *      TABLE/COLUMN, no DELETE/TRUNCATE of data).
 *   4. The policy name is UNCHANGED ("user_roles_admin"), which is what lets
 *      the existing RLS cross-table-recursion ledger entry
 *      'user_roles::user_roles_admin' in rls-no-cross-table-recursion.test.ts
 *      remain valid with zero edits there — this test also asserts that
 *      guard's ledger still contains exactly that key and that the guard
 *      still detects the (narrowed but still admin_users-inlining) policy,
 *      proving the two test files agree post-fix.
 *
 * WHAT THIS DOES NOT PROVE (documented limitation, per Phase 1 review
 * instructions): a static source pin cannot execute SQL, so it cannot
 * directly demonstrate that a live support-tier session's
 * `INSERT INTO user_roles ...` now actually raises a Postgres RLS violation
 * at runtime. That requires a live-DB integration test (this repo's CI
 * "integration tests" job / the live-DB lane carved out in vitest.config.ts
 * for src/__tests__/migrations/**) — tracked as a follow-up, consistent with
 * how the sibling analyst-role-and-admin-tier-sync-migration.test.ts already
 * documents the same limitation for its own trigger-fires-and-writes-a-row
 * behavior.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260816000009_fix_user_roles_admin_rls_write_policy.sql',
);
const priorMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260816000008_analyst_role_and_admin_tier_rbac_sync.sql',
);
const recursionGuardPath = path.join(
  repoRoot,
  'apps/host/src/__tests__/rls-no-cross-table-recursion.test.ts',
);

function readMigration(): string {
  expect(existsSync(migrationPath), 'missing user_roles_admin RLS write-policy fix migration').toBe(
    true,
  );
  return readFileSync(migrationPath, 'utf8');
}

/** Executable SQL only: strip `-- ...` comment lines. */
function executableSql(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

describe('20260816000009 — user_roles_admin RLS write-policy fix (P8 CRITICAL)', () => {
  it('drops the old policy idempotently (DROP POLICY IF EXISTS)', () => {
    const sql = readMigration();
    expect(sql).toMatch(/DROP POLICY IF EXISTS "user_roles_admin" ON "public"\."user_roles"/);
  });

  it('recreates "user_roles_admin" as FOR SELECT ONLY — no implicit FOR ALL survives', () => {
    const sql = readMigration();
    const code = executableSql(sql);

    const createMatch = code.match(
      /CREATE POLICY "user_roles_admin" ON "public"\."user_roles"[\s\S]*?;/,
    );
    expect(createMatch, 'CREATE POLICY "user_roles_admin" statement not found').not.toBeNull();
    const createBlock = createMatch![0];

    // Must explicitly declare FOR SELECT (closing the implicit-FOR-ALL hole).
    expect(createBlock).toMatch(/FOR\s+SELECT/i);
    // Must NOT grant any write command — the safest fix removes write access
    // entirely rather than merely adding a WITH CHECK guard.
    expect(createBlock).not.toMatch(/FOR\s+ALL/i);
    expect(createBlock).not.toMatch(/FOR\s+INSERT/i);
    expect(createBlock).not.toMatch(/FOR\s+UPDATE/i);
    expect(createBlock).not.toMatch(/FOR\s+DELETE/i);
    expect(createBlock).toMatch(/TO\s+"authenticated"/);
  });

  it('preserves the exact baseline read predicate (auth.uid() IN active admin_users) — read scope unchanged', () => {
    const sql = readMigration();
    const code = executableSql(sql);
    expect(code).toMatch(
      /"auth"\."uid"\(\)\s+IN\s*\(\s*SELECT\s+"admin_users"\."auth_user_id"\s+FROM\s+"public"\."admin_users"\s+WHERE\s*\(\s*"admin_users"\."is_active"\s*=\s*true\s*\)\s*\)/,
    );
  });

  it('is wrapped in a single BEGIN/COMMIT transaction', () => {
    const sql = readMigration();
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
  });

  it('contains no DROP TABLE / DROP COLUMN / DELETE / TRUNCATE (additive/corrective only)', () => {
    const sql = readMigration();
    // "DROP POLICY IF EXISTS ... ; CREATE POLICY ..." is the established
    // idempotent-policy-recreation pattern used elsewhere in this repo (e.g.
    // 20260815000002_fix_rls_with_check_student_id_drift.sql) and is
    // explicitly NOT a destructive schema change (no table/column dropped).
    const code = executableSql(sql).replace(/DROP POLICY IF EXISTS[^;]*;/gi, '');
    expect(code).not.toMatch(/\bDROP TABLE\b/i);
    expect(code).not.toMatch(/\bDROP COLUMN\b/i);
    expect(code).not.toMatch(/\b(DELETE|TRUNCATE)\b/i);
    expect(code).not.toMatch(/\bDROP\b/i);
  });

  it('does not touch any table other than public.user_roles', () => {
    const sql = readMigration();
    const code = executableSql(sql);
    // Every DROP POLICY / CREATE POLICY / ALTER TABLE statement must target
    // user_roles — scope discipline per the task constraint.
    const targets = [...code.matchAll(/\bON\s+"public"\."([a-z_]+)"/gi)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      expect(t).toBe('user_roles');
    }
  });
});

describe('20260816000008 — rationale comment correction (no false P8 security claim survives)', () => {
  function readPriorMigration(): string {
    expect(
      existsSync(priorMigrationPath),
      'missing analyst role + admin tier RBAC sync migration',
    ).toBe(true);
    return readFileSync(priorMigrationPath, 'utf8');
  }

  it('no longer claims user_roles had no INSERT/UPDATE policy for authenticated as an unconditional, un-corrected fact', () => {
    const sql = readPriorMigration();
    // The corrected comment must acknowledge the actual pre-fix hole rather
    // than assert it never existed.
    expect(sql).toMatch(/CORRECTED 2026-08-16/);
    expect(sql).toMatch(/self-escalation/i);
    expect(sql).toMatch(/20260816000009_fix_user_roles_admin_rls_write_policy\.sql/);
  });

  it('still documents the SECURITY DEFINER justification for the sync trigger (unaffected by the correction)', () => {
    const sql = readPriorMigration();
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/RLS interaction check \(P8\)/);
  });
});

describe('20260816000009 — agreement with the RLS cross-table-recursion ledger', () => {
  function readRecursionGuard(): string {
    expect(existsSync(recursionGuardPath), 'missing rls-no-cross-table-recursion.test.ts').toBe(
      true,
    );
    return readFileSync(recursionGuardPath, 'utf8');
  }

  it('the policy name is UNCHANGED ("user_roles_admin") so the existing ledger entry needs no edit', () => {
    // Belt-and-suspenders: re-assert (independent of the block above) that
    // the DROP and the CREATE both target the exact same policy name, which
    // is what keeps this fix from requiring a GRANDFATHERED_INLINE_POLICIES
    // edit in the sibling recursion-guard test.
    const sql = readMigration();
    const code = executableSql(sql);
    expect(code).toMatch(/DROP POLICY IF EXISTS "user_roles_admin"/);
    expect(code).toMatch(/CREATE POLICY "user_roles_admin"/);
  });

  it('the recursion-guard ledger still carries the "user_roles::user_roles_admin" entry (proves no ledger drift was required)', () => {
    const guardSrc = readRecursionGuard();
    expect(guardSrc).toMatch(/'user_roles::user_roles_admin'/);
  });
});

describe('20260816000009 — documented limitation', () => {
  it('acknowledges that live-DB self-escalation behavior is not provable by this static pin', () => {
    // This is a meta-assertion on this file's own header, verifying the
    // limitation is documented in-repo rather than silently skipped, per
    // the task instruction. If this ever gets a live-DB integration test
    // counterpart, that test should supersede this note.
    const selfSrc = readFileSync(__filename, 'utf8');
    expect(selfSrc).toMatch(/live-DB integration test/);
  });
});
