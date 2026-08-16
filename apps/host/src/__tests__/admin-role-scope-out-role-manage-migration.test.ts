/**
 * Static SQL content pins for
 * 20260816000010_admin_role_scope_out_role_manage.sql (P9 fix — ops Gate 5
 * finding on the Phase 1 Mission Control overhaul, 2026-08-16).
 *
 * Pattern: static parse of the migration file (no DB, no network, fully
 * deterministic) — matches the established convention in this repo for
 * pinning migration content (see the sibling
 * analyst-role-and-admin-tier-sync-migration.test.ts).
 *
 * Covers:
 *   1. The DELETE removes exactly role.manage + permission.manage from the
 *      `admin` role — no other role, no other codes.
 *   2. super_admin's grant of the same two codes is untouched (the DELETE
 *      is scoped to role_id = admin's id, never super_admin's).
 *   3. Idempotent (safe to replay: deleting zero matching rows is a no-op —
 *      no ON CONFLICT needed for a DELETE, but the WHERE-scoped shape must
 *      be present, not a bare unscoped DELETE).
 *   4. Wrapped in BEGIN/COMMIT.
 *   5. No DROP TABLE / DROP COLUMN / TRUNCATE anywhere (a permission
 *      revocation via DELETE FROM role_permissions is explicitly allowed by
 *      the Migration Rules — only DROP TABLE/COLUMN require user approval).
 *   6. Resolves the role and permissions by name/code, never a hardcoded
 *      UUID.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260816000010_admin_role_scope_out_role_manage.sql',
);

function readMigration(): string {
  expect(existsSync(migrationPath), 'missing admin role_manage/permission.manage scope-out migration').toBe(true);
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

describe('20260816000010 — admin role loses role.manage / permission.manage', () => {
  it('deletes role_permissions rows scoped to the admin role id', () => {
    const sql = readMigration();
    const code = executableSql(sql);
    expect(code).toMatch(
      /DELETE FROM role_permissions\s+WHERE role_id = \(SELECT id FROM roles WHERE name = 'admin'\)/,
    );
  });

  it('scopes the DELETE to exactly role.manage and permission.manage — no other codes', () => {
    const sql = readMigration();
    const code = executableSql(sql);

    const deleteMatch = code.match(
      /DELETE FROM role_permissions[\s\S]*?permission_id IN \(\s*SELECT id FROM permissions WHERE code IN \(([\s\S]*?)\)\s*\);/,
    );
    expect(deleteMatch, 'DELETE...permission_id IN (...) block not found').not.toBeNull();
    const codeList = deleteMatch![1];

    expect(codeList).toMatch(/'role\.manage'/);
    expect(codeList).toMatch(/'permission\.manage'/);
    // Exactly these two codes — no stray third code slipped in.
    const quoted = codeList.match(/'[a-z_]+\.[a-z_]+'/g) ?? [];
    expect(new Set(quoted)).toEqual(new Set(["'role.manage'", "'permission.manage'"]));
  });

  it('never targets super_admin — the DELETE has no WHERE clause naming super_admin', () => {
    const sql = readMigration();
    const code = executableSql(sql);
    expect(code).not.toMatch(/DELETE[\s\S]*?super_admin/);
  });

  it('resolves the role by name and permissions by code — no hardcoded UUID', () => {
    const sql = readMigration();
    const code = executableSql(sql);
    expect(code).not.toMatch(/role_id\s*=\s*'[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(code).not.toMatch(/permission_id\s+IN\s*\(\s*'[0-9a-f]{8}-/i);
  });

  it('is wrapped in a single BEGIN/COMMIT transaction', () => {
    const sql = readMigration();
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
  });

  it('contains no DROP TABLE / DROP COLUMN / TRUNCATE (data revocation only, no schema change)', () => {
    const sql = readMigration();
    const code = executableSql(sql);
    expect(code).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('contains exactly one DELETE statement (the targeted revocation, nothing broader)', () => {
    const sql = readMigration();
    const code = executableSql(sql);
    const deletes = code.match(/\bDELETE\s+FROM\b/gi) ?? [];
    expect(deletes).toHaveLength(1);
  });

  it('documents the incident, the chosen approach, and the deliberately-untouched codes', () => {
    const sql = readMigration();
    expect(sql).toMatch(/20260816000008/);
    expect(sql).toMatch(/role\.manage/);
    expect(sql).toMatch(/system\.config/);
    expect(sql).toMatch(/user\.manage/);
  });
});
