/**
 * Static SQL content pins for the 2026-07-20 super-admin repair migrations
 * (Phase 1 of the admin session/routing RCA):
 *
 *   20260720150000_get_admin_level_rpc.sql
 *     Additive `public.get_admin_level(uuid)` RPC so middleware Layer 0.65
 *     can consult `admin_users` (the roster authorizeAdmin reads) with
 *     precedence over student/teacher/guardian — the student-bounce fix.
 *     Pins: SECURITY DEFINER + pinned search_path, anon/PUBLIC EXECUTE
 *     revoked, self-or-service anti-enumeration caller guard, active-row
 *     filter, fresh-DB to_regclass guard.
 *
 *   20260720160000_deactivate_orphaned_admin_users.sql
 *     Data-only hygiene UPDATE deactivating admin_users rows whose
 *     auth_user_id points at a deleted auth.users row. Pins: the
 *     `auth_user_id IS NOT NULL` guard (never sweeps never-linked rows),
 *     the NOT EXISTS anti-join against auth.users, idempotence filter,
 *     and NO DDL / NO DELETE anywhere in executable SQL.
 *
 * Pattern: static parse of the migration file, like the sibling
 * *-rpc-migration.test.ts suites. No DB, no network, fully deterministic.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

const rpcMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260720150000_get_admin_level_rpc.sql',
);
const orphanMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260720160000_deactivate_orphaned_admin_users.sql',
);

/** Executable SQL only: strip `-- ...` comment lines so header prose (which
 *  legitimately mentions DROP/DELETE in the manual-DOWN docs) cannot mask —
 *  or false-positive — the DDL/DELETE absence pins. */
function executableSql(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

describe('20260720150000 get_admin_level RPC migration (Layer 0.65 admin precedence)', () => {
  it('exists and defines public.get_admin_level as SECURITY DEFINER with pinned search_path', () => {
    expect(existsSync(rpcMigrationPath), 'missing get_admin_level RPC migration').toBe(true);
    const sql = readFileSync(rpcMigrationPath, 'utf8');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_admin_level(p_user_id uuid)');
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    // Definer-function hygiene: object resolution pinned so a malicious schema
    // on the caller's search_path cannot shadow admin_users.
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
    // Read-only contract.
    expect(sql).toMatch(/\bSTABLE\b/i);
  });

  it('revokes EXECUTE from PUBLIC and anon, grants only authenticated + service_role', () => {
    const sql = readFileSync(rpcMigrationPath, 'utf8');

    // Functions are executable by PUBLIC by default — the REVOKE is load-bearing.
    expect(sql).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_admin_level\(uuid\)\s+FROM\s+PUBLIC/i);
    expect(sql).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_admin_level\(uuid\)\s+FROM\s+anon/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_admin_level\(uuid\)\s+TO\s+authenticated/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_admin_level\(uuid\)\s+TO\s+service_role/i);
    // No grant to anon anywhere.
    expect(sql).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_admin_level\(uuid\)\s+TO\s+anon/i);
  });

  it('carries the self-or-service anti-enumeration caller guard inside the function body', () => {
    const sql = readFileSync(rpcMigrationPath, 'utf8');

    // service_role may resolve any user (middleware path)…
    expect(sql).toMatch(/COALESCE\(auth\.role\(\),\s*''\)\s*=\s*'service_role'/);
    // …authenticated users may only resolve THEMSELVES.
    expect(sql).toMatch(/OR\s+p_user_id\s*=\s*auth\.uid\(\)/i);
    // Guard must live in the SAME predicate as the roster lookup: the SELECT
    // over admin_users carries both the active-row filter and the caller guard.
    expect(sql).toMatch(
      /FROM\s+public\.admin_users[\s\S]*?is_active\s*=\s*true[\s\S]*?service_role[\s\S]*?p_user_id\s*=\s*auth\.uid\(\)/i,
    );
  });

  it('is fresh-DB safe (to_regclass no-op guard) and single-transaction', () => {
    const sql = readFileSync(rpcMigrationPath, 'utf8');
    expect(sql).toMatch(/to_regclass\('public\.admin_users'\)\s+IS\s+NULL/i);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
  });

  it('is consumed by the middleware helper with graceful fallback (consumer contract)', () => {
    const helper = readFileSync(
      path.join(repoRoot, 'packages/lib/src/middleware-helpers.ts'),
      'utf8',
    );
    // Layer 0.65 role resolution actually calls the RPC…
    expect(helper).toContain('rpc/get_admin_level');
    // …and exports the uncached ROLE_UNKNOWN sentinel used when probes fail
    // (never cache a demoted role on a transient failure).
    expect(helper).toMatch(/export\s+const\s+ROLE_UNKNOWN\s*=\s*'unknown'/);
  });
});

describe('20260720160000 orphaned admin_users deactivation migration (data-only hygiene)', () => {
  it('exists and the UPDATE predicate requires auth_user_id IS NOT NULL (never sweeps never-linked rows)', () => {
    expect(existsSync(orphanMigrationPath), 'missing orphaned-admin deactivation migration').toBe(true);
    const sql = readFileSync(orphanMigrationPath, 'utf8');

    expect(sql).toMatch(/UPDATE\s+public\.admin_users/i);
    expect(sql).toMatch(/SET\s+is_active\s*=\s*false/i);
    // Idempotence filter: second run matches zero rows.
    expect(sql).toMatch(/WHERE\s+is_active\s*=\s*true/i);
    // The load-bearing guard: a bare NOT EXISTS is TRUE for NULL auth_user_id
    // too, which would deactivate pre-provisioned (never-linked) rows.
    expect(sql).toMatch(/AND\s+auth_user_id\s+IS\s+NOT\s+NULL/i);
  });

  it('uses a NOT EXISTS anti-join against auth.users as the orphan predicate', () => {
    const sql = readFileSync(orphanMigrationPath, 'utf8');
    expect(sql).toMatch(
      /NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+auth\.users\s+u\s+WHERE\s+u\.id\s*=\s*admin_users\.auth_user_id\s*\)/i,
    );
    // The IS NOT NULL guard precedes the anti-join in the same WHERE clause.
    expect(sql).toMatch(/auth_user_id\s+IS\s+NOT\s+NULL[\s\S]*?NOT\s+EXISTS/i);
  });

  it('contains no DDL and no DELETE in executable SQL (data-only UPDATE)', () => {
    const sql = readFileSync(orphanMigrationPath, 'utf8');
    const code = executableSql(sql);

    // No schema changes, no row deletion, no grant surface changes. (DO/BEGIN
    // blocks, RAISE NOTICE, GET DIAGNOSTICS and the single UPDATE are fine.)
    expect(code).not.toMatch(/\b(CREATE|ALTER|DROP|TRUNCATE|DELETE|GRANT|REVOKE|COMMENT\s+ON)\b/i);
    // Exactly one UPDATE statement, and only against admin_users. (`\s` after
    // UPDATE excludes the `$update$` dollar-quote tags from the count.)
    const updates = code.match(/\bUPDATE\s/gi) ?? [];
    expect(updates).toHaveLength(1);
    expect(code).not.toMatch(/UPDATE\s+(?!public\.admin_users)/i);
  });

  it('is fresh-DB safe on BOTH tables and surfaces the row count in the apply log', () => {
    const sql = readFileSync(orphanMigrationPath, 'utf8');
    expect(sql).toMatch(/to_regclass\('public\.admin_users'\)\s+IS\s+NULL/i);
    expect(sql).toMatch(/to_regclass\('auth\.users'\)\s+IS\s+NULL/i);
    expect(sql).toMatch(/GET\s+DIAGNOSTICS/i);
    expect(sql).toMatch(/RAISE\s+NOTICE/i);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
  });
});
