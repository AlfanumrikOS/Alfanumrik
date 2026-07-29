/**
 * `get_plan_limit()` school-coverage — STATIC SOURCE CONTRACT canary.
 *
 * ⚠️ SCOPE — READ THIS BEFORE TRUSTING IT ⚠️
 * ─────────────────────────────────────────────────────────────────────────────
 * The three semantic pins architect asked for are BEHAVIOURAL and require a live
 * Postgres to execute plpgsql:
 *
 *   (1) a pure-B2C student's limit is byte-identical pre/post;
 *   (2) a school-covered student on a `trial` school resolves to the `pro` cap;
 *   (3) a personally-`unlimited` student under a `basic` school is NOT downgraded.
 *
 * They CANNOT run in the unit lane (no DB) and this file does NOT pretend to
 * execute them. They are written as real live-DB assertions in
 * `src/__tests__/migrations/get-plan-limit-school-coverage.test.ts`, which runs
 * ONLY under `RUN_INTEGRATION_TESTS=1` with real STAGING_SUPABASE_* secrets and
 * skips cleanly otherwise. **On a normal PR those three pins do not execute.**
 * See REG-329 for the honest coverage statement.
 *
 * What THIS file does — and it is not nothing — is pin the migration's SOURCE
 * against the drift modes that would silently break all three:
 *   - the personal branch stops being byte-identical to the baseline body
 *     (the entire B2C no-op proof rests on that);
 *   - `GREATEST(personal, school)` is replaced by an assignment/override, which
 *     would let school coverage LOWER a student's cap;
 *   - the school→consumer tier map drifts from `effective-plan.ts`;
 *   - the school branch stops failing soft, so a B2B lookup error can fail a
 *     quota check that used to succeed;
 *   - the -1/999999 sentinel adapter is dropped, leaking 999999 into a JSON
 *     contract that has always used -1.
 *
 * This is the same static-source-contract pattern already used across this
 * suite (e.g. `anti-cheat-server-parity`, `atomic-quiz-conflict-42p10-structure`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeSchoolPlanToConsumerCode } from '@alfanumrik/lib/entitlements/effective-plan';

/**
 * The B2B plan strings the SQL twin must map identically. Expected values are
 * NOT hardcoded — they are read from the TypeScript authority at runtime, so a
 * change on either side surfaces as a drift failure rather than a silent split.
 */
const SCHOOL_PLAN_KEYS = [
  'trial',
  'basic',
  'standard',
  'premium',
  'enterprise',
  'school_premium',
] as const;

const MIGRATIONS = resolve(__dirname, '../../../../supabase/migrations');
const COVERAGE_SQL = resolve(MIGRATIONS, '20260729130400_get_plan_limit_school_coverage.sql');
const AUTHORITY_SQL = resolve(
  MIGRATIONS,
  '20260729130500_get_student_usage_single_limit_authority.sql'
);

function read(path: string): string {
  expect(existsSync(path), `missing migration: ${path}`).toBe(true);
  return readFileSync(path, 'utf8');
}

/** Everything after the header comments — i.e. the statements that actually run. */
function executable(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
}

// ══════════════════════════════════════════════════════════════════════════════

describe('20260729130400 — get_plan_limit school coverage (source contract)', () => {
  const sql = read(COVERAGE_SQL);
  const body = executable(sql);

  it('replaces get_plan_limit in place — same signature, same volatility/security posture', () => {
    expect(body).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_plan_limit\(p_student_id uuid, p_feature text\)/
    );
    expect(body).toMatch(/RETURNS integer/);
    expect(body).toMatch(/LANGUAGE plpgsql/);
    expect(body).toMatch(/\bSTABLE\b/);
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/SET search_path TO 'public'/);
    // No DROP: every existing caller (check_and_record_usage, record_ai_usage)
    // must keep resolving.
    expect(body).not.toMatch(/DROP FUNCTION[^;]*get_plan_limit/i);
  });

  it('is idempotent (CREATE OR REPLACE only) and writes no data', () => {
    expect(body).not.toMatch(/\bCREATE FUNCTION\b(?!.*OR REPLACE)/);
    expect(body).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\s+/im);
    expect(body).toMatch(/BEGIN;/);
    expect(body).toMatch(/COMMIT;/);
  });

  it('PIN (1): the personal branch is byte-identical to the baseline body', () => {
    // If this drifts, the "strict no-op for pure B2C" proof in the header — and
    // therefore live-DB pin (1) — is void.
    expect(body).toMatch(
      /SELECT\s+sp\.plan_code,\s*sp\.foxy_chats_per_day,\s*sp\.quizzes_per_day/
    );
    expect(body).toMatch(/FROM\s+student_subscriptions ss/);
    expect(body).toMatch(/JOIN\s+subscription_plans sp ON sp\.plan_code = ss\.plan_code/);
    expect(body).toMatch(/ss\.status IN \('active', 'trial'\)/);
    expect(body).toMatch(/ORDER BY sp\.sort_order DESC/);
    // The free fallback literals, unchanged.
    expect(body).toMatch(/v_plan\s*:=\s*'free';/);
    expect(body).toMatch(/v_foxy_lim\s*:=\s*5;/);
    expect(body).toMatch(/v_quiz_lim\s*:=\s*5;/);
    // The -1 → 999999 unlimited mapping, unchanged.
    expect(body).toMatch(/WHEN v_foxy_lim = -1 THEN 999999 ELSE v_foxy_lim END/);
    expect(body).toMatch(/WHEN v_quiz_lim = -1 THEN 999999 ELSE v_quiz_lim END/);
  });

  it('PIN (3): the return is GREATEST(personal, school) — coverage can only RAISE a cap', () => {
    expect(body).toMatch(/RETURN GREATEST\(v_personal, v_school\)/);
    // There must be no path that returns the school value on its own, which is
    // how a personally-`unlimited` student under a `basic` school would get
    // downgraded.
    expect(body).not.toMatch(/RETURN\s+v_school\s*;/);
    // Every school-branch bail-out returns the pre-change value.
    expect(body).toMatch(/IF v_code IS NULL OR v_code = 'free' THEN\s*\n\s*RETURN v_personal;/);
    expect(body).toMatch(/IF v_s_plan IS NULL THEN\s*\n\s*RETURN v_personal;/);
  });

  it('PIN (2): the school→consumer map matches SCHOOL_PLAN_TO_CONSUMER in effective-plan.ts exactly', () => {
    // Same policy expressed twice; this is the drift detector for that.
    for (const schoolPlan of SCHOOL_PLAN_KEYS) {
      const consumer = normalizeSchoolPlanToConsumerCode(schoolPlan);
      const arm = new RegExp(`WHEN\\s+'${schoolPlan}'\\s*THEN\\s*'${consumer}'`, 'i');
      expect(body, `school plan "${schoolPlan}" → "${consumer}"`).toMatch(arm);
    }
    // The one this batch is actually about: a `trial` school is pro-equivalent.
    expect(normalizeSchoolPlanToConsumerCode('trial')).toBe('pro');
    expect(body).toMatch(/WHEN 'trial'\s+THEN 'pro'/);
  });

  it('an unrecognised school plan fails CLOSED to free on both sides', () => {
    expect(normalizeSchoolPlanToConsumerCode('nonsense_code')).toBe('free');
    // The SQL falls through the same way, and the deploy-log verification block
    // asserts it too.
    expect(body).toMatch(/ELSE public\.normalize_consumer_plan_code\(p_plan\)/);
    expect(body).toMatch(/\('nonsense_code',\s*'free'\)/);
  });

  it('the tier ranking mirrors planTier() (free=0, starter=1, pro=2, unlimited=3)', () => {
    expect(body).toMatch(/WHEN 'starter'\s+THEN 1/);
    expect(body).toMatch(/WHEN 'pro'\s+THEN 2/);
    expect(body).toMatch(/WHEN 'unlimited' THEN 3/);
    expect(body).toMatch(/ELSE 0/);
  });

  it('only ACTIVE or TRIAL school subscriptions can contribute coverage (P11)', () => {
    const schoolStatusFilters = body.match(/ss\.status IN \('active', 'trial'\)/g) ?? [];
    // One for the personal branch, at least one for the school branch.
    expect(schoolStatusFilters.length).toBeGreaterThanOrEqual(2);
    expect(body).not.toMatch(/status IN \([^)]*'cancelled'/);
    expect(body).not.toMatch(/status IN \([^)]*'expired'/);
  });

  it('the school branch fails SOFT — a B2B lookup error can never fail a quota check', () => {
    expect(body).toMatch(/EXCEPTION WHEN OTHERS THEN/);
    expect(body).toMatch(/v_code\s*:=\s*NULL;/);
    // …and every optional table is to_regclass-guarded so a partially-migrated
    // DB degrades instead of erroring.
    expect(body).toMatch(/to_regclass\('public\.school_subscriptions'\)/);
    expect(body).toMatch(/to_regclass\('public\.classes'\)/);
    expect(body).toMatch(/to_regclass\('public\.class_students'\)/);
    expect(body).toMatch(/to_regclass\('public\.class_enrollments'\)/);
  });

  it('the covering-school set is the UNION of all three link definitions (grant-side breadth)', () => {
    expect(body).toMatch(/WITH candidate_schools AS/);
    const unionCount = (body.match(/\n\s*UNION\s*\n/g) ?? []).length;
    expect(unionCount).toBeGreaterThanOrEqual(2);
    expect(body).toMatch(/FROM\s+public\.class_students cs/);
    expect(body).toMatch(/FROM\s+public\.class_enrollments ce/);
    expect(body).toMatch(/FROM\s+public\.students s/);
  });

  it('does NOT change seat billing — _school_active_student_ids is untouched', () => {
    expect(body).not.toMatch(/CREATE OR REPLACE FUNCTION[^;]*_school_active_student_ids/i);
  });

  it('re-asserts the EXECUTE hardening rather than relying on the pre-existing ACL', () => {
    expect(body).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.get_plan_limit\(uuid, text\) FROM PUBLIC;/
    );
    expect(body).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.get_plan_limit\(uuid, text\) FROM anon, authenticated;/
    );
  });

  it('touches no RLS policy, no table DDL and no grade column (P8, P5)', () => {
    expect(body).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY/i);
    expect(body).not.toMatch(/CREATE TABLE|ALTER TABLE|DROP TABLE/i);
    expect(body).not.toMatch(/\bgrade\b/i);
  });

  it('carries an executable manual DOWN (the operational kill switch, no deploy needed)', () => {
    expect(sql).toMatch(/REVERSIBILITY — MANUAL DOWN/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_plan_limit\(p_student_id uuid, p_feature text\)[\s\S]*\$down\$/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('20260729130500 — get_student_usage single limit authority (source contract)', () => {
  const sql = read(AUTHORITY_SQL);
  const body = executable(sql);

  it('delegates ALL FOUR limits to get_plan_limit — no second limit authority survives', () => {
    for (const feature of ['foxy_chat', 'quiz', 'notes', 'ai_total']) {
      expect(body, feature).toMatch(
        new RegExp(`public\\.get_plan_limit\\(p_student_id, '${feature}'\\)`)
      );
    }
    // The deleted local policy must not creep back as literals feeding a limit.
    expect(body).not.toMatch(/v_foxy_limit\s+int/);
    expect(body).not.toMatch(/v_quiz_limit\s+int/);
  });

  it('preserves the -1 display sentinel via the adapter (999999 must not leak into the JSON)', () => {
    expect(body).toMatch(/CREATE OR REPLACE FUNCTION public\.usage_limit_for_display\(p_limit integer\)/);
    expect(body).toMatch(/WHEN p_limit >= 999999 THEN -1/);
    // Every delegated limit passes through the adapter.
    const wrapped = body.match(/usage_limit_for_display\(public\.get_plan_limit\(/g) ?? [];
    expect(wrapped.length).toBe(4);
  });

  it('preserves the five-key JSON return shape exactly', () => {
    for (const key of ['plan', 'foxy', 'quiz', 'notes', 'ai_total']) {
      expect(body, key).toContain(`'${key}'`);
    }
    const usedLimitPairs = (body.match(/'used',/g) ?? []).length;
    expect(usedLimitPairs).toBeGreaterThanOrEqual(4);
  });

  it('resolves the plan LABEL with the same join + status filter as get_plan_limit', () => {
    expect(body).toMatch(/JOIN\s+subscription_plans sp ON sp\.plan_code = ss\.plan_code/);
    expect(body).toMatch(/ss\.status IN \('active', 'trial'\)/);
    // plan_id is no longer read at all.
    expect(body).not.toMatch(/ss\.plan_id\s*=\s*sp\.id/);
  });

  it('is idempotent, signature-preserving and writes nothing', () => {
    expect(body).toMatch(/CREATE OR REPLACE FUNCTION public\.get_student_usage\(p_student_id uuid\)/);
    expect(body).toMatch(/RETURNS jsonb/);
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\s+/im);
    expect(body).not.toMatch(/DROP FUNCTION[^;]*get_student_usage/i);
  });

  it('re-asserts the EXECUTE hardening on both functions', () => {
    expect(body).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_student_usage\(uuid\) FROM PUBLIC;/);
    expect(body).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.usage_limit_for_display\(integer\) FROM anon, authenticated;/
    );
  });

  it('documents the known `used`-always-0 defect rather than silently patching it', () => {
    // The REG-321 precedent: state the gap in the artifact, do not overclaim.
    expect(sql).toMatch(/KNOWN DEFECT DELIBERATELY \*NOT\* FIXED HERE/);
    expect(sql).toMatch(/foxy_chats_used/);
  });

  it('touches no RLS policy, no table DDL and no grade column (P8, P5)', () => {
    expect(body).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY/i);
    expect(body).not.toMatch(/CREATE TABLE|ALTER TABLE|DROP TABLE/i);
    expect(body).not.toMatch(/\bgrade\b/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('sentinel boundary — the two unlimited values are deliberate, not a bug', () => {
  it('the SQL display sentinel (-1) and the TS/enforcement sentinel (999999) are both present and adapted', () => {
    const authority = read(AUTHORITY_SQL);
    expect(authority).toContain('999999');
    expect(authority).toMatch(/THEN -1/);
  });

  it('the TS sentinel matches the value get_plan_limit maps -1 to', async () => {
    const { UNLIMITED_USAGE_SENTINEL } = await import('@alfanumrik/lib/usage-sentinel');
    expect(UNLIMITED_USAGE_SENTINEL).toBe(999999);
    expect(read(COVERAGE_SQL)).toContain('999999');
  });
});
