/**
 * Migration 20260621000100_track_a_school_admin_provisioning.sql — static
 * conformance guard (Phase 1 Track A foundational changeset).
 *
 * Unit tests have no Supabase connection, so — exactly like
 * src/__tests__/lib/rbac/matrix-conformance.test.ts — we statically verify the
 * migration TEXT is the source-of-truth artifact for the three Track A parts:
 *
 *   PART A — admin-claim flow:
 *     - school_invite_codes.role_type CHECK widened to admit 'admin' (additively).
 *     - school_admin_claim_tokens table created with RLS ENABLED + a
 *       service-role-only policy, storing token_hash (never a raw token / PII).
 *
 *   PART B — tenant-isolation hardening:
 *     - classes gets INSERT/UPDATE/DELETE RLS scoped via is_school_admin_of().
 *     - the school-admin students SELECT policy is hardened with an explicit
 *       `school_id IS NOT NULL` guard so B2C (NULL school_id) students are
 *       never readable by any school admin.
 *     - assert_seat_capacity(uuid) is SECURITY DEFINER, RAISES SQLSTATE P0001
 *       'seat_capacity_exceeded' at the ceiling, else returns the
 *       {ok,ceiling,used,remaining} jsonb.
 *
 *   PART C — RBAC additions:
 *     - 3 new permission codes seeded (integration.manage, public_api.manage,
 *       ops_team.manage).
 *     - integration.manage + public_api.manage → institution_admin + admin +
 *       super_admin.
 *     - ops_team.manage → admin + super_admin ONLY (NOT institution_admin).
 *
 * And the whole-file additive/idempotent contract (BEGIN/COMMIT, no
 * DROP TABLE/COLUMN/DELETE/TRUNCATE, ON CONFLICT guards).
 *
 * SQL-only branches that this offline harness cannot exercise (documented as a
 * catalog gap in the test report): the RUNTIME behaviour of the RLS policies and
 * the RUNTIME raise/return of assert_seat_capacity require a live DB — those are
 * pinned at the integration tier (see src/__tests__/migrations/seat-enforcement.test.ts
 * for the established live-DB harness pattern).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

const MIGRATION_PATH =
  'supabase/migrations/20260621000100_track_a_school_admin_provisioning.sql';

const sql = readFileSync(resolve(process.cwd(), MIGRATION_PATH), 'utf8');

// Code-only view (strip `--` comment lines) for destructive-statement scans.
const codeOnly = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('Track A migration — additive + idempotent contract', () => {
  it('exists and wraps its work in a single transaction', () => {
    expect(sql.length).toBeGreaterThan(0);
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(/COMMIT;/);
  });

  it('contains NO destructive table/column/data statements', () => {
    expect(codeOnly).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(codeOnly).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(codeOnly).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(codeOnly).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('uses idempotent guards (IF NOT EXISTS / ON CONFLICT / DROP POLICY IF EXISTS)', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS/i);
    expect(sql).toMatch(/ON CONFLICT \(code\) DO NOTHING/i);
    expect(sql).toMatch(/ON CONFLICT \(role_id, permission_id\) DO NOTHING/i);
    expect(sql).toMatch(/DROP POLICY IF EXISTS/i);
  });
});

describe('Track A migration — PART A: admin-claim flow', () => {
  it('widens school_invite_codes.role_type to admit "admin" (additive)', () => {
    // Every previously-valid value must remain valid; only 'admin' is ADDED.
    expect(sql).toMatch(
      /CHECK\s*\(\s*"role_type"\s*=\s*ANY\s*\(\s*ARRAY\[[^\]]*'teacher'[^\]]*'student'[^\]]*'admin'[^\]]*\]/i,
    );
  });

  it('creates school_admin_claim_tokens storing a token_hash (never a raw token)', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "public"\."school_admin_claim_tokens"/i);
    expect(sql).toMatch(/"token_hash"\s+text\s+NOT NULL/i);
    // The table is hash-only — it must not declare a raw-token / password column.
    expect(sql).not.toMatch(/"raw_token"/i);
    expect(sql).not.toMatch(/"password"/i);
  });

  it('enables RLS on school_admin_claim_tokens with a service-role-only policy (P8)', () => {
    expect(sql).toMatch(
      /ALTER TABLE "public"\."school_admin_claim_tokens" ENABLE ROW LEVEL SECURITY/i,
    );
    expect(sql).toMatch(/CREATE POLICY "claim_tokens_service_role"[\s\S]*?TO "service_role"/i);
  });

  it('makes the token hash unique (O(1) lookup, no duplicates)', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]*?"school_admin_claim_tokens" \("token_hash"\)/i,
    );
  });
});

describe('Track A migration — PART B: tenant-isolation hardening', () => {
  it('adds INSERT / UPDATE / DELETE RLS on classes scoped via is_school_admin_of()', () => {
    for (const verb of ['INSERT', 'UPDATE', 'DELETE']) {
      const re = new RegExp(
        `CREATE POLICY "School admins can ${verb.toLowerCase()} school classes"[\\s\\S]*?FOR ${verb}`,
        'i',
      );
      expect(sql, `missing ${verb} policy on classes`).toMatch(re);
    }
    expect(sql).toMatch(/"public"\."is_school_admin_of"\("school_id"\)/i);
  });

  it('hardens the school-admin students SELECT policy with an explicit school_id IS NOT NULL guard (B2C isolation)', () => {
    const m = sql.match(
      /CREATE POLICY "School admins can view school students"[\s\S]*?USING\s*\(([\s\S]*?)\);/i,
    );
    expect(m).not.toBeNull();
    const usingClause = m![1];
    // The guard that makes B2C (NULL school_id) students unreadable by ANY admin.
    expect(usingClause).toMatch(/"school_id"\s+IS NOT NULL/i);
    // And it still scopes visible rows to the caller's active school_admins rows.
    expect(usingClause).toMatch(/school_admins[\s\S]*?"is_active"\s*=\s*true/i);
  });

  it('defines assert_seat_capacity as SECURITY DEFINER with a pinned search_path', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION "public"\."assert_seat_capacity"\("p_school_id" uuid\)/i,
    );
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/SET search_path = public/i);
  });

  it('assert_seat_capacity RAISES seat_capacity_exceeded with SQLSTATE P0001 at the ceiling', () => {
    expect(sql).toMatch(
      /IF\s+v_used\s*>=\s*v_ceiling\s+THEN[\s\S]*?RAISE EXCEPTION 'seat_capacity_exceeded/i,
    );
    expect(sql).toMatch(/USING ERRCODE = 'P0001'/i);
  });

  it('assert_seat_capacity returns the {ok,ceiling,used,remaining} jsonb below the ceiling', () => {
    const m = sql.match(/RETURN jsonb_build_object\(([\s\S]*?)\);/i);
    expect(m).not.toBeNull();
    const obj = m![1];
    for (const key of ['ok', 'ceiling', 'used', 'remaining']) {
      expect(obj).toContain(`'${key}'`);
    }
    // remaining never goes negative.
    expect(obj).toMatch(/GREATEST\(v_ceiling - v_used, 0\)/i);
  });

  it('grants EXECUTE on assert_seat_capacity to authenticated + service_role', () => {
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION "public"\."assert_seat_capacity"\(uuid\) TO "authenticated", "service_role"/i,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART C — RBAC matrix conformance for the 3 NEW codes (mirrors the
// matrix-conformance grant-block extraction style).
// ─────────────────────────────────────────────────────────────────────────────

const NEW_CODES = ['integration.manage', 'public_api.manage', 'ops_team.manage'] as const;

/**
 * True iff the migration grants `code` to `role` via the established
 * `WHERE r.name = '<role>' AND p.code IN ( ... '<code>' ... )` seed-join.
 */
function grantsCodeToRole(code: string, role: string): boolean {
  // Each grant block is an INSERT INTO role_permissions ... WHERE r.name = 'role'
  // AND p.code IN ( ... ) ON CONFLICT. Extract per-role blocks and test membership.
  const blockRe = new RegExp(
    `INSERT INTO role_permissions[\\s\\S]*?WHERE r\\.name = '${role}'[\\s\\S]*?p\\.code IN \\(([\\s\\S]*?)\\)`,
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(sql))) {
    if (m[1].includes(`'${code}'`)) return true;
  }
  return false;
}

describe('Track A migration — PART C: new permission codes seeded', () => {
  const permBlock = (() => {
    const m = sql.match(/INSERT INTO permissions[\s\S]*?ON CONFLICT \(code\) DO NOTHING/i);
    return m ? m[0] : '';
  })();

  it('has a permissions INSERT guarded by ON CONFLICT (code) DO NOTHING', () => {
    expect(permBlock.length).toBeGreaterThan(0);
  });

  it.each(NEW_CODES)('seeds the new permission code "%s"', (code) => {
    expect(permBlock).toContain(`'${code}'`);
  });
});

describe('Track A migration — PART C: RBAC grant conformance', () => {
  it('integration.manage → institution_admin, admin, super_admin', () => {
    expect(grantsCodeToRole('integration.manage', 'institution_admin')).toBe(true);
    expect(grantsCodeToRole('integration.manage', 'super_admin')).toBe(true);
    expect(grantsCodeToRole('integration.manage', 'admin')).toBe(true);
  });

  it('public_api.manage → institution_admin, admin, super_admin', () => {
    expect(grantsCodeToRole('public_api.manage', 'institution_admin')).toBe(true);
    expect(grantsCodeToRole('public_api.manage', 'super_admin')).toBe(true);
    expect(grantsCodeToRole('public_api.manage', 'admin')).toBe(true);
  });

  it('ops_team.manage → admin + super_admin ONLY (NOT institution_admin)', () => {
    expect(grantsCodeToRole('ops_team.manage', 'super_admin')).toBe(true);
    expect(grantsCodeToRole('ops_team.manage', 'admin')).toBe(true);
    // The load-bearing negative: ops_team.manage must NOT reach institution_admin.
    expect(grantsCodeToRole('ops_team.manage', 'institution_admin')).toBe(false);
  });

  it('the institution_admin grant block lists integration+public_api but NOT ops_team', () => {
    const m = sql.match(
      /WHERE r\.name = 'institution_admin'[\s\S]*?p\.code IN \(([\s\S]*?)\)/i,
    );
    expect(m).not.toBeNull();
    const block = m![1];
    expect(block).toContain("'integration.manage'");
    expect(block).toContain("'public_api.manage'");
    expect(block).not.toContain("'ops_team.manage'");
  });
});
