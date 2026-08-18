/**
 * Static SQL content pins for
 * 20260816000008_analyst_role_and_admin_tier_rbac_sync.sql (Phase 1 of the
 * CEO-authorized super-admin Mission Control overhaul, 2026-08-16).
 *
 * Pattern: static parse of the migration file (no DB, no network, fully
 * deterministic) — matches the established convention in this repo for
 * pinning migration content (see the sibling
 * admin-session-repair-migrations.test.ts, which lives directly under
 * src/__tests__/ for the same reason this file does: src/__tests__/migrations/**
 * is entirely carved out of the normal Vitest lane into the live-DB
 * integration lane — see vitest.config.ts — and this test has no DB
 * dependency, so it belongs in the normal lane). A live-DB integration test
 * tier (CI's "integration tests" job) is the appropriate place for true
 * end-to-end trigger-fires-and-writes-a-row verification; that is out of
 * scope for a Vitest unit test and tracked as a follow-up.
 *
 * Covers the CEO release-blocker requirements this migration must satisfy:
 *   (a) admin_users tier changes -> matching RBAC role membership, for ALL
 *       6 tiers (not just super_admin, unlike the old one-time
 *       20260803140000 backfill) — pinned via the CASE mapping covering all
 *       6 admin_level values, the AFTER INSERT OR UPDATE trigger scope, and
 *       the generalized (not super_admin-only) backfill INSERT.
 *   (c) demoting/revoking a tier deactivates ONLY the specific
 *       (auth_user_id, old-tier role_id) row — never a bare
 *       "WHERE auth_user_id = ..." update that would touch every role the
 *       user holds.
 *   Plus: analyst role/grants are read-only (CEO mandate: never *.manage,
 *   role.manage, system.config, or user.manage), idempotency, RLS/security
 *   posture (SECURITY DEFINER justification, EXECUTE revoked from
 *   PUBLIC/anon/authenticated), and no DROP/DELETE/TRUNCATE anywhere.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260816000008_analyst_role_and_admin_tier_rbac_sync.sql',
);

function readMigration(): string {
  expect(existsSync(migrationPath), 'missing analyst role + admin tier RBAC sync migration').toBe(true);
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

describe('20260816000008 — analyst role (CEO-approved, read-only)', () => {
  it('inserts the analyst role idempotently (ON CONFLICT (name) DO NOTHING)', () => {
    const sql = readMigration();
    expect(sql).toMatch(/INSERT INTO roles[\s\S]*?'analyst'[\s\S]*?ON CONFLICT \(name\) DO NOTHING/);
  });

  it('grants ONLY read-only permission codes to analyst — never a *.manage/role.manage/system.config/user.manage code', () => {
    const sql = readMigration();
    const code = executableSql(sql);

    // Locate the analyst grant block.
    const grantMatch = code.match(/WHERE r\.name = 'analyst' AND p\.code IN \(([\s\S]*?)\)/);
    expect(grantMatch, 'analyst role_permissions grant block not found').not.toBeNull();
    const grantBlock = grantMatch![1];

    // CEO mandate: never any of these.
    expect(grantBlock).not.toMatch(/role\.manage/);
    expect(grantBlock).not.toMatch(/system\.config/);
    expect(grantBlock).not.toMatch(/user\.manage/);
    expect(grantBlock).not.toMatch(/\.manage'/); // catches any `<x>.manage` code

    // Expected read-only grants are present.
    expect(grantBlock).toMatch(/'system\.audit'/);
    expect(grantBlock).toMatch(/'analytics\.global'/);
    expect(grantBlock).toMatch(/'support\.view_tickets'/);
    // Explicitly NOT support.manage_tickets (mutation).
    expect(grantBlock).not.toMatch(/support\.manage_tickets/);
  });

  it('grant insert is idempotent (ON CONFLICT (role_id, permission_id) DO NOTHING)', () => {
    const sql = readMigration();
    expect(sql).toMatch(
      /WHERE r\.name = 'analyst' AND p\.code IN[\s\S]*?ON CONFLICT \(role_id, permission_id\) DO NOTHING/,
    );
  });
});

describe('20260816000008 — sync_admin_level_to_rbac_role() trigger (ongoing, all 6 tiers)', () => {
  it('maps all 6 admin_level tiers to their matching RBAC role name (NEW and OLD)', () => {
    const sql = readMigration();
    const tiers = ['support', 'analyst', 'content_manager', 'finance', 'admin', 'super_admin'];

    // Two CASE blocks (v_new_role_name from NEW.admin_level, v_old_role_name
    // from OLD.admin_level) — both must cover all 6 tiers.
    const caseBlocks = sql.match(/CASE (NEW|OLD)\.admin_level[\s\S]*?END;/g);
    expect(caseBlocks, 'expected two CASE admin_level blocks (NEW + OLD)').not.toBeNull();
    expect(caseBlocks!.length).toBe(2);

    for (const block of caseBlocks!) {
      for (const tier of tiers) {
        expect(block, `tier "${tier}" missing from a CASE admin_level block`).toMatch(
          new RegExp(`WHEN '${tier}'\\s+THEN '${tier}'`),
        );
      }
    }
  });

  it('is SECURITY DEFINER with a pinned search_path (documented justification for the RLS-write requirement)', () => {
    const sql = readMigration();
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.sync_admin_level_to_rbac_role() RETURNS trigger');
    expect(sql).toMatch(/SECURITY\s+DEFINER/);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/);
    // Justification comment present (P8 RLS-interaction note).
    expect(sql).toMatch(/RLS interaction check \(P8\)/);
  });

  it('revokes EXECUTE from PUBLIC/anon/authenticated (never directly callable)', () => {
    const sql = readMigration();
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.sync_admin_level_to_rbac_role\(\) FROM PUBLIC, anon, authenticated/,
    );
  });

  it('fires on AFTER INSERT OR UPDATE OF admin_level, is_active (fail-closed on suspension)', () => {
    const sql = readMigration();
    expect(sql).toMatch(
      /CREATE TRIGGER trg_sync_admin_level_to_rbac_role\s+AFTER INSERT OR UPDATE OF admin_level, is_active ON public\.admin_users/,
    );
    // Idempotent trigger creation.
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_sync_admin_level_to_rbac_role ON public\.admin_users/);
  });

  it('scopes the demotion UPDATE to the EXACT (auth_user_id, old tier role_id) row — never a bare auth_user_id filter', () => {
    const sql = readMigration();
    const code = executableSql(sql);

    // The revoke-previous-tier UPDATE must filter on BOTH auth_user_id AND
    // role_id (and is_active=true) — this is what guarantees roles outside
    // the 6-tier set (teacher, tutor, institution_admin, reviewer, ...) held
    // by the same user are never touched (part (c) of the release blocker).
    const updateMatch = code.match(
      /UPDATE user_roles\s+SET is_active = false\s+WHERE auth_user_id = OLD\.auth_user_id\s+AND role_id = v_old_role_id\s+AND is_active = true;/,
    );
    expect(updateMatch, 'demotion UPDATE must be scoped to auth_user_id AND role_id AND is_active=true').not.toBeNull();

    // Exactly one UPDATE statement in the whole migration (the demotion path) —
    // proves there is no second, broader mutation of user_roles anywhere else.
    const updates = code.match(/\bUPDATE\s+user_roles\b/gi) ?? [];
    expect(updates).toHaveLength(1);
  });

  it('revokes the OLD tier role when the tier changes OR the row is deactivated', () => {
    const sql = readMigration();
    expect(sql).toMatch(
      /v_old_role_name IS DISTINCT FROM v_new_role_name OR NEW\.is_active = false/,
    );
  });

  it('grants the NEW tier role idempotently via ON CONFLICT ... DO UPDATE (reactivate stale rows only)', () => {
    const sql = readMigration();
    const code = executableSql(sql);
    expect(code).toMatch(
      /INSERT INTO public\.user_roles AS tgt \(auth_user_id, role_id, is_active, assigned_by, expires_at\)\s+VALUES \(NEW\.auth_user_id, v_new_role_id, true, NULL, NULL\)\s+ON CONFLICT ON CONSTRAINT user_roles_auth_user_id_role_id_key DO UPDATE/,
    );
    expect(code).toMatch(/WHERE tgt\.is_active IS NOT TRUE OR tgt\.expires_at IS NOT NULL;/);
  });

  it('never grants when the admin_users row is inactive, unlinked, or an unmapped tier', () => {
    const sql = readMigration();
    expect(sql).toMatch(
      /IF NEW\.auth_user_id IS NULL OR NEW\.is_active = false OR v_new_role_name IS NULL THEN\s+RETURN NEW;\s+END IF;/,
    );
  });
});

describe('20260816000008 — one-time backfill (all 6 tiers, not just super_admin)', () => {
  it('backfills every tier via a VALUES map, not a single hardcoded admin_level filter', () => {
    const sql = readMigration();
    const tiers = ['support', 'analyst', 'content_manager', 'finance', 'admin', 'super_admin'];

    const backfillMatch = sql.match(
      /INSERT INTO public\.user_roles AS tgt[\s\S]*?JOIN \(VALUES([\s\S]*?)\) AS tier_map/,
    );
    expect(backfillMatch, 'backfill VALUES tier map not found').not.toBeNull();
    const valuesBlock = backfillMatch![1];

    for (const tier of tiers) {
      expect(valuesBlock, `tier "${tier}" missing from backfill VALUES map`).toMatch(
        new RegExp(`\\('${tier}',\\s*'${tier}'\\)`),
      );
    }

    // Unlike 20260803140000 (super_admin only), this backfill must NOT filter
    // by a single hardcoded admin_level = 'super_admin' predicate.
    expect(sql).not.toMatch(/WHERE\s+a\.admin_level\s*=\s*'super_admin'/);
  });

  it('is guarded by NOT EXISTS (idempotent — matches zero rows on a fully-synced DB)', () => {
    const sql = readMigration();
    expect(sql).toMatch(/NOT EXISTS \(\s*SELECT 1\s*FROM public\.user_roles ur/);
  });
});

describe('20260816000008 — general migration hygiene', () => {
  it('contains no DROP TABLE / DROP COLUMN / DELETE / TRUNCATE in executable SQL (additive only)', () => {
    const sql = readMigration();
    // `DROP TRIGGER IF EXISTS ... ; CREATE TRIGGER ...` is the established
    // idempotent-trigger-recreation pattern used elsewhere in this repo
    // (e.g. sync_school_admin_role's own trigger) — it is NOT a destructive
    // schema change (no table/column is dropped) and is explicitly allowed
    // by the Migration Rules (only DROP TABLE/DROP COLUMN require approval).
    const code = executableSql(sql).replace(/DROP TRIGGER IF EXISTS[^;]*;/gi, '');
    expect(code).not.toMatch(/\bDROP TABLE\b/i);
    expect(code).not.toMatch(/\bDROP COLUMN\b/i);
    expect(code).not.toMatch(/\b(DELETE|TRUNCATE)\b/i);
    expect(code).not.toMatch(/\bDROP\b/i);
  });

  it('is wrapped in a single BEGIN/COMMIT transaction', () => {
    const sql = readMigration();
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
  });

  it('resolves roles by name, never by hardcoded UUID', () => {
    const sql = readMigration();
    const code = executableSql(sql);
    // No bare UUID literal assigned as a role id anywhere in executable SQL.
    expect(code).not.toMatch(/role_id\s*=\s*'[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});
