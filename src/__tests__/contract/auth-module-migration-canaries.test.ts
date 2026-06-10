/**
 * Static migration canaries — auth-module security fixes (2026-06-10).
 *
 * Established pattern: REG-47-style static contract canary. These tests read
 * the migration SQL from disk and pin the load-bearing strings so a later
 * `CREATE OR REPLACE` of the same function (RPC redefinitions are routinely
 * copied forward from the previous migration body) cannot silently drop the
 * fix. They run in normal PR CI (this file lives under `contract/`, NOT under
 * `__tests__/migrations/` which is excluded from non-integration runs).
 *
 * 1. 20260610090000_secure_get_user_role.sql (H1 — PII enumeration):
 *    get_user_role is SECURITY DEFINER and returns role/name/grade/school_id
 *    for an arbitrary auth_user_id. The fix adds an early guard: a caller
 *    whose JWT role is not service_role may only query their own identity
 *    (p_auth_user_id must equal auth.uid()). Without the guard, any
 *    authenticated user can enumerate UUIDs and read profile PII (P13).
 *
 * 2. 20260610090100_bootstrap_link_code.sql (M5 — link code never used):
 *    bootstrap_user_profile now calls link_guardian_via_invite_code for
 *    parent signups, FAIL-SOFT (an invalid/expired code must NEVER abort
 *    profile creation — P15 rule: signup never breaks), and returns an
 *    additive 'link_status' key ('linked'|'invalid_code'|'not_attempted')
 *    on every return path. ON CONFLICT markers keep the RPC idempotent
 *    (P15 rule 4: safe to call multiple times).
 *
 * If a test here fails after someone redefines either RPC, the fix being
 * dropped is the bug — update the new migration, not this test.
 *
 * Owner: testing. Catalog: REG-108 (H1 guard), REG-111 (M5 fail-soft).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

function readMigration(filename: string): string {
  return readFileSync(
    resolve(REPO_ROOT, 'supabase', 'migrations', filename),
    'utf8'
  );
}

// ── H1: get_user_role self-binding guard ─────────────────────────

describe('20260610090000_secure_get_user_role.sql — H1 PII-enumeration guard', () => {
  const sql = readMigration('20260610090000_secure_get_user_role.sql');

  it('redefines public.get_user_role(p_auth_user_id uuid) as SECURITY DEFINER', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.get_user_role(p_auth_user_id uuid)'
    );
    expect(sql).toContain('SECURITY DEFINER');
  });

  it('contains the service_role bypass check', () => {
    expect(sql).toMatch(/coalesce\(auth\.role\(\),\s*''\)\s*<>\s*'service_role'/);
  });

  it('contains the auth.uid() self-identity binding', () => {
    expect(sql).toMatch(/p_auth_user_id IS DISTINCT FROM auth\.uid\(\)/);
  });

  it('RAISEs (does not silently return) on cross-user lookup', () => {
    expect(sql).toMatch(
      /RAISE EXCEPTION 'get_user_role: callers may only query their own identity'/
    );
  });

  it('places the guard BEFORE the first role-table read (no PII touched pre-guard)', () => {
    const guardIdx = sql.indexOf('IS DISTINCT FROM auth.uid()');
    const firstTableRead = sql.indexOf('FROM students');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(firstTableRead).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(firstTableRead);
  });

  it('re-asserts the anon EXECUTE revoke (20260515000002 parity)', () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.get_user_role\(uuid\) FROM anon/
    );
  });

  it('pins a safe search_path on the SECURITY DEFINER function', () => {
    expect(sql).toMatch(/SET search_path = public, pg_catalog/);
  });
});

// ── M5: bootstrap_user_profile link-code wiring ──────────────────

describe('20260610090100_bootstrap_link_code.sql — M5 fail-soft guardian link', () => {
  const sql = readMigration('20260610090100_bootstrap_link_code.sql');

  it('redefines public.bootstrap_user_profile with the unchanged 11-parameter signature', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.bootstrap_user_profile(');
    // p_link_code must survive in the signature — it is the M5 input.
    expect(sql).toMatch(/p_link_code\s+TEXT DEFAULT NULL::TEXT/);
  });

  it('calls the existing link_guardian_via_invite_code RPC (not an inlined copy)', () => {
    expect(sql).toMatch(
      /public\.link_guardian_via_invite_code\(p_auth_user_id,\s*v_link_code\)/
    );
  });

  it('attempts the link only for parent/guardian roles with a non-empty code', () => {
    // Two attempt sites: the completed-early-return retry-heal + the main path.
    const predicate = /IF p_role IN \('parent', 'guardian'\) AND v_link_code IS NOT NULL THEN/g;
    const matches = sql.match(predicate) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('wraps every link attempt in a fail-soft exception block (P15: invalid code never aborts signup)', () => {
    const failSoft = /EXCEPTION WHEN OTHERS THEN\s+v_link_status := 'invalid_code';/g;
    const matches = sql.match(failSoft) ?? [];
    // One per attempt site (retry-heal + main path).
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('normalizes p_link_code with nullif(trim(coalesce(...))) so blanks never trigger a link attempt', () => {
    expect(sql).toMatch(/nullif\(trim\(coalesce\(p_link_code, ''\)\), ''\)/);
  });

  it("carries the additive 'link_status' key on EVERY jsonb return path", () => {
    const returns = sql.split('RETURN jsonb_build_object');
    // 4 return paths: already_completed, invalid-role error, exception error, success.
    expect(returns.length - 1).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < returns.length; i++) {
      const upToStatementEnd = returns[i].slice(0, returns[i].indexOf(';'));
      expect(
        upToStatementEnd,
        `RETURN jsonb_build_object #${i} is missing the link_status key`
      ).toContain("'link_status'");
    }
  });

  it("uses exactly the three documented link_status values", () => {
    expect(sql).toContain("v_link_status := 'linked'");
    expect(sql).toContain("v_link_status := 'invalid_code'");
    expect(sql).toContain("v_link_status TEXT := 'not_attempted'");
  });

  it('keeps the ON CONFLICT idempotency markers on all profile inserts (P15 rule 4)', () => {
    expect(sql).toContain('ON CONFLICT (auth_user_id) DO UPDATE'); // onboarding_state
    expect(sql).toContain('ON CONFLICT ON CONSTRAINT students_auth_user_id_unique DO UPDATE');
    expect(sql).toContain('ON CONFLICT ON CONSTRAINT teachers_auth_user_id_unique DO UPDATE');
    expect(sql).toContain('ON CONFLICT ON CONSTRAINT guardians_auth_user_id_unique DO UPDATE');
    expect(sql).toContain('ON CONFLICT (idempotency_key) DO NOTHING'); // state_events publish
  });

  it('retry-heals the link on the already_completed early-return path (3-layer failsafe convergence)', () => {
    const earlyReturnIdx = sql.indexOf("IF v_existing_step = 'completed' THEN");
    const earlyReturnEnd = sql.indexOf("'already_completed'");
    expect(earlyReturnIdx).toBeGreaterThan(-1);
    expect(earlyReturnEnd).toBeGreaterThan(earlyReturnIdx);
    const earlyBlock = sql.slice(earlyReturnIdx, earlyReturnEnd);
    expect(earlyBlock).toContain('link_guardian_via_invite_code');
  });

  it('re-asserts the anon EXECUTE revoke on the full signature', () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.bootstrap_user_profile\(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT\[\], TEXT\[\], TEXT, TEXT\) FROM anon/
    );
  });

  it('audits link_status in the bootstrap_success metadata', () => {
    const auditIdx = sql.indexOf("'bootstrap_success'");
    expect(auditIdx).toBeGreaterThan(-1);
    const auditBlock = sql.slice(auditIdx, auditIdx + 300);
    expect(auditBlock).toContain("'link_status'");
  });
});
