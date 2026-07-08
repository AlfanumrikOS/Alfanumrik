/**
 * Migration 20260621000660_track_a6_public_api_webhooks_marketplace.sql — static
 * conformance guard (Track A.6: public API v1 + outbound webhooks + marketplace).
 *
 * Unit tests have no Supabase connection, so — exactly like
 * src/__tests__/track-a-migration-conformance.test.ts — we statically verify the
 * migration TEXT is the source-of-truth artifact:
 *
 *   PART A — outbound webhooks:
 *     - webhook_subscriptions created with RLS ENABLED, a hash-only `secret_hash`
 *       column (NEVER a raw secret), and an https-only target_url CHECK.
 *     - webhook_deliveries created with RLS ENABLED, a status lifecycle CHECK
 *       (pending/delivered/failed/dead_letter), and admin READ-ONLY visibility
 *       (no authenticated INSERT/UPDATE/DELETE policy).
 *   PART B — marketplace:
 *     - integration_listings (world-readable, active-only) + integration_installs
 *       (own-school) created with RLS ENABLED, install status lifecycle CHECK, and
 *       a partial unique index = one active install per (school, listing).
 *   PART C — public-API key reuse: asserts the school_api_keys precondition block
 *     (no new key table).
 *
 * And the whole-file additive/idempotent contract (BEGIN/COMMIT, no
 * DROP TABLE/COLUMN/DELETE/TRUNCATE, IF NOT EXISTS / DROP POLICY IF EXISTS guards).
 *
 * SQL-only RUNTIME behaviour (the RLS policies actually isolating tenants, the
 * CHECK constraints actually rejecting bad rows) requires a live DB and is a
 * documented catalog gap — pinned at the integration tier where that harness runs.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

const MIGRATION_PATH =
  'supabase/migrations/20260621000660_track_a6_public_api_webhooks_marketplace.sql';

const sql = readFileSync(resolve(process.cwd(), MIGRATION_PATH), 'utf8');

// Code-only view (strip `--` comment lines) for destructive-statement scans.
const codeOnly = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const NEW_TABLES = [
  'webhook_subscriptions',
  'webhook_deliveries',
  'integration_listings',
  'integration_installs',
] as const;

describe('Track A.6 migration — additive + idempotent contract', () => {
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
    expect(codeOnly).not.toMatch(/\bUPDATE\s+"?public"?\."?\w+"?\s+SET\b/i);
  });

  it('uses idempotent guards (IF NOT EXISTS / DROP POLICY IF EXISTS + CREATE)', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/i);
    expect(sql).toMatch(/DROP POLICY IF EXISTS/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION/i);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS/i);
  });

  it('the only DROPs are policy/trigger drops (no schema/data drops)', () => {
    const drops = codeOnly.match(/\bDROP\s+\w+/gi) ?? [];
    for (const d of drops) {
      expect(d).toMatch(/DROP\s+(POLICY|TRIGGER)/i);
    }
  });
});

describe('Track A.6 migration — RLS enabled + policies on all 4 new tables (P8)', () => {
  it.each(NEW_TABLES)('enables ROW LEVEL SECURITY on %s', (table) => {
    expect(sql).toMatch(
      new RegExp(`ALTER TABLE "public"\\."${table}" ENABLE ROW LEVEL SECURITY`, 'i'),
    );
  });

  it.each(NEW_TABLES)('ships at least one CREATE POLICY for %s', (table) => {
    const re = new RegExp(`CREATE POLICY[\\s\\S]*?ON "public"\\."${table}"`, 'i');
    expect(sql, `no policy for ${table}`).toMatch(re);
  });

  it('every new table also has a service_role policy', () => {
    for (const table of NEW_TABLES) {
      const re = new RegExp(
        `CREATE POLICY[\\s\\S]*?ON "public"\\."${table}"[\\s\\S]*?TO "service_role"`,
        'i',
      );
      expect(sql, `no service_role policy for ${table}`).toMatch(re);
    }
  });
});

describe('Track A.6 migration — PART A: outbound webhooks', () => {
  it('webhook_subscriptions stores a hash-only secret (secret_hash, never raw)', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "public"\."webhook_subscriptions"/i);
    expect(sql).toMatch(/"secret_hash"\s+text\s+NOT NULL/i);
    // No raw-secret / plaintext column.
    expect(sql).not.toMatch(/"secret"\s+text/i);
    expect(sql).not.toMatch(/"raw_secret"/i);
    expect(sql).not.toMatch(/"signing_secret"\s+text/i);
  });

  it('webhook_subscriptions enforces https-only target_url via CHECK', () => {
    expect(sql).toMatch(/CONSTRAINT "webhook_subscriptions_https_only" CHECK \("target_url" ~\* '\^https:\/\/'\)/i);
  });

  it('webhook_subscriptions is tenant-scoped via is_school_admin_of(school_id)', () => {
    expect(sql).toMatch(
      /CREATE POLICY "webhook_subscriptions_admin_all"[\s\S]*?"public"\."is_school_admin_of"\("school_id"\)/i,
    );
  });

  it('webhook_deliveries has a status lifecycle CHECK', () => {
    expect(sql).toMatch(
      /"status"[\s\S]*?CHECK \("status" IN \('pending', 'delivered', 'failed', 'dead_letter'\)\)/i,
    );
  });

  it('webhook_deliveries is admin READ-ONLY (SELECT policy only; no authenticated write policy)', () => {
    expect(sql).toMatch(
      /CREATE POLICY "webhook_deliveries_admin_select"[\s\S]*?FOR SELECT TO "authenticated"/i,
    );
    // Scope to ONLY the deliveries section (between PART A's deliveries block and the
    // PART B marketplace header) so the scan can't bleed into another table's policy.
    const partBStart = sql.indexOf('PART B — MARKETPLACE');
    const deliveriesStart = sql.indexOf('webhook_deliveries — the delivery LOG');
    const deliveriesSection = sql.slice(deliveriesStart, partBStart);
    // Inside the deliveries section, the ONLY authenticated policy is FOR SELECT.
    const authPolicyVerbs = (
      deliveriesSection.match(/FOR (SELECT|INSERT|UPDATE|DELETE|ALL) TO "authenticated"/gi) ?? []
    );
    expect(authPolicyVerbs.length).toBeGreaterThan(0);
    expect(authPolicyVerbs.every((v) => /FOR SELECT/i.test(v))).toBe(true);
  });
});

describe('Track A.6 migration — PART B: marketplace', () => {
  it('integration_listings is world-readable to authenticated but active-only', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "public"\."integration_listings"/i);
    expect(sql).toMatch(
      /CREATE POLICY "integration_listings_authenticated_select"[\s\S]*?FOR SELECT TO "authenticated"[\s\S]*?USING \("is_active" = true\)/i,
    );
  });

  it('integration_installs has a status lifecycle CHECK + own-school policy', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "public"\."integration_installs"/i);
    expect(sql).toMatch(
      /"status"[\s\S]*?CHECK \("status" IN \('pending', 'active', 'paused', 'uninstalled'\)\)/i,
    );
    expect(sql).toMatch(
      /CREATE POLICY "integration_installs_admin_all"[\s\S]*?"public"\."is_school_admin_of"\("school_id"\)/i,
    );
  });

  it('one active install per (school, listing) via a partial unique index', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "uq_integration_installs_school_listing"[\s\S]*?\("school_id", "listing_id"\)[\s\S]*?WHERE "status" <> 'uninstalled'/i,
    );
  });

  it('integration_installs.config holds non-secret config (no raw secret column)', () => {
    expect(sql).toMatch(/"config"\s+jsonb\s+NOT NULL/i);
    expect(sql).not.toMatch(/"secret"\s+text/i);
  });
});

describe('Track A.6 migration — PART C: public-API keys reuse school_api_keys (no new key table)', () => {
  it('asserts the school_api_keys precondition columns exist (fails loud on a fresh DB)', () => {
    expect(sql).toMatch(/information_schema\.columns/i);
    expect(sql).toMatch(/table_name = 'school_api_keys'/i);
    for (const col of ['key_hash', 'permissions', 'expires_at', 'is_active', 'school_id']) {
      expect(sql).toContain(`'${col}'`);
    }
    expect(sql).toMatch(/RAISE EXCEPTION 'Track A\.6 precondition failed/i);
  });

  it('creates NO new api-key table (reuses the baseline)', () => {
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS "public"\."public_api_keys"/i);
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS "public"\."school_api_keys"/i);
  });
});

describe('Track A.6 migration — every tenant table carries a NOT NULL school_id FK', () => {
  it.each(['webhook_subscriptions', 'webhook_deliveries', 'integration_installs'])(
    '%s has a NOT NULL school_id referencing schools(id)',
    (table) => {
      const block = sql.slice(
        sql.indexOf(`CREATE TABLE IF NOT EXISTS "public"."${table}"`),
        sql.indexOf(`CREATE TABLE IF NOT EXISTS "public"."${table}"`) + 1400,
      );
      expect(block).toMatch(/"school_id" uuid NOT NULL REFERENCES "public"\."schools"\("id"\)/i);
    },
  );
});
