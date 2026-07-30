/**
 * `get_plan_limit()` institution-override floor — STATIC SOURCE CONTRACT canary.
 *
 * ⚠️ SCOPE — READ THIS BEFORE TRUSTING IT ⚠️
 * ─────────────────────────────────────────────────────────────────────────────
 * The BEHAVIOURAL pins for
 * `supabase/migrations/20260729130600_get_plan_limit_institution_override_floor.sql`
 * require a live Postgres to execute plpgsql (the function body is
 * `LANGUAGE plpgsql`, and `coerce_institution_limit_max` needs a real jsonb
 * evaluator). They CANNOT run in the unit lane and this file does NOT pretend
 * to execute them. They are written as real live-DB assertions in
 * `apps/host/src/__tests__/migrations/get-plan-limit-institution-override.test.ts`,
 * which runs ONLY under `RUN_INTEGRATION_TESTS=1` with real `STAGING_SUPABASE_*`
 * secrets and skips cleanly otherwise. **On a normal PR those pins do not
 * execute.** See REG-330 for the honest coverage statement — same shape as
 * REG-329's for `20260729130400`/`20260729130500`.
 *
 * What THIS file does — and it is not nothing — is pin the migration's SOURCE
 * against the drift modes that would silently break the floor semantics:
 *   - the third GREATEST() term is dropped (silently disables the fix this
 *     migration exists to ship);
 *   - the personal (§1) or school-query (§2 query text) blocks stop being
 *     byte-identical to `20260729130400`, voiding the upstream "strict no-op
 *     for pure B2C" proof this migration explicitly inherits rather than
 *     re-derives;
 *   - the `p_feature -> entitlement_key` mapping drifts (e.g. `notes`/
 *     `ai_total` start resolving a key, silently widening this migration's
 *     documented no-op scope for those two features);
 *   - `coerce_institution_limit_max()`'s malformed-value branches collapse
 *     (a bad stored row starts raising, or starts resolving to a number
 *     instead of NULL, either of which can break/over-grant a quota check
 *     that used to succeed safely);
 *   - the `effective_from`/`effective_to` window check is dropped, so an
 *     expired or not-yet-started override silently applies anyway;
 *   - the re-asserted EXECUTE hardening on either function regresses.
 *
 * This is the same static-source-contract pattern already used across this
 * suite (e.g. `get-plan-limit-school-coverage-structure`,
 * `anti-cheat-server-parity`, `atomic-quiz-conflict-42p10-structure`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve(__dirname, '../../../../supabase/migrations');
const OVERRIDE_SQL = resolve(
  MIGRATIONS,
  '20260729130600_get_plan_limit_institution_override_floor.sql'
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

describe('20260729130600 — get_plan_limit institution-override floor (source contract)', () => {
  const sql = read(OVERRIDE_SQL);
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
    // No DROP: every existing caller (check_and_record_usage, get_student_usage
    // via 20260729130500) must keep resolving.
    expect(body).not.toMatch(/DROP FUNCTION[^;]*get_plan_limit/i);
  });

  it('is idempotent (CREATE OR REPLACE only) and writes no data', () => {
    expect(body).not.toMatch(/\bCREATE FUNCTION\b(?!.*OR REPLACE)/);
    expect(body).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\s+/im);
    expect(body).toMatch(/BEGIN;/);
    expect(body).toMatch(/COMMIT;/);
  });

  it('PIN: the personal (§1) branch is byte-identical to the 20260729130400 baseline body', () => {
    // If this drifts, the "strict no-op for pure B2C" proof inherited from
    // 20260729130400 (and this file's own re-statement of it) is void.
    expect(body).toMatch(
      /SELECT\s+sp\.plan_code,\s*sp\.foxy_chats_per_day,\s*sp\.quizzes_per_day/
    );
    expect(body).toMatch(/FROM\s+student_subscriptions ss/);
    expect(body).toMatch(/JOIN\s+subscription_plans sp ON sp\.plan_code = ss\.plan_code/);
    expect(body).toMatch(/ss\.status IN \('active', 'trial'\)/);
    expect(body).toMatch(/ORDER BY sp\.sort_order DESC/);
    expect(body).toMatch(/v_plan\s*:=\s*'free';/);
    expect(body).toMatch(/v_foxy_lim\s*:=\s*5;/);
    expect(body).toMatch(/v_quiz_lim\s*:=\s*5;/);
    expect(body).toMatch(/WHEN v_foxy_lim = -1 THEN 999999 ELSE v_foxy_lim END/);
    expect(body).toMatch(/WHEN v_quiz_lim = -1 THEN 999999 ELSE v_quiz_lim END/);
  });

  it('PIN: the school (§2) candidate-school query is byte-identical to 20260729130400 (unchanged, only its control flow was restructured)', () => {
    expect(body).toMatch(/FROM\s+public\.class_students cs/);
    expect(body).toMatch(/FROM\s+public\.class_enrollments ce/);
    expect(body).toMatch(/ORDER BY public\.consumer_plan_tier\(public\.school_plan_to_consumer_code\(ss\.plan\)\) DESC/);
    // Restructured: no more early `RETURN v_personal` immediately after a
    // failed school lookup — execution must fall through into §2b.
    expect(body).not.toMatch(/IF v_code IS NULL OR v_code = 'free' THEN\s*\n\s*RETURN v_personal;/);
  });

  it('PIN: the return is GREATEST(v_personal, v_school, v_institution_override) — the third floor term', () => {
    expect(body).toMatch(/RETURN GREATEST\(v_personal, v_school, v_institution_override\)/);
    // No path may return the override on its own or assign over v_personal —
    // that is how the floor could turn into a ceiling.
    expect(body).not.toMatch(/RETURN\s+v_institution_override\s*;/);
    expect(body).not.toMatch(/v_personal\s*:=\s*v_institution_override/);
    expect(body).not.toMatch(/v_personal\s*:=\s*GREATEST/);
  });

  it('PIN: the p_feature -> entitlement_key mapping is exactly foxy_chat/quiz, everything else NULL (hard no-op)', () => {
    expect(body).toMatch(
      /v_entitlement_key\s*:=\s*CASE p_feature\s*\n\s*WHEN 'foxy_chat' THEN 'limit\.foxy_chat_daily'\s*\n\s*WHEN 'quiz'\s+THEN 'limit\.quiz_daily'\s*\n\s*ELSE NULL\s*\n\s*END;/
    );
    // Only these two literal keys appear anywhere in the file — 'notes' and
    // 'ai_total' never resolve an entitlement_key.
    const keyLiterals = body.match(/'limit\.\w+'/g) ?? [];
    expect(new Set(keyLiterals)).toEqual(new Set(["'limit.foxy_chat_daily'", "'limit.quiz_daily'"]));
  });

  it('PIN: v_institution_override is guarded by v_entitlement_key IS NOT NULL and an optional-table check', () => {
    expect(body).toMatch(
      /IF v_entitlement_key IS NOT NULL\s*\n\s*AND to_regclass\('public\.institution_entitlements'\) IS NOT NULL THEN/
    );
  });

  it('PIN: the institution-override lookup fails SOFT — a bad optional lookup can never fail a quota check', () => {
    // There must be a second EXCEPTION WHEN OTHERS block beyond the school
    // branch's own (2 total: §2's B2B lookup, §2b's institution lookup).
    const exceptionBlocks = body.match(/EXCEPTION WHEN OTHERS THEN/g) ?? [];
    expect(exceptionBlocks.length).toBeGreaterThanOrEqual(2);
    expect(body).toMatch(/v_institution_override\s*:=\s*NULL;/);
  });

  it('PIN: coerce_institution_limit_max — malformed-value branches all resolve to NULL, never raise', () => {
    expect(body).toMatch(
      /CREATE OR REPLACE FUNCTION public\.coerce_institution_limit_max\(p_value jsonb\)/
    );
    expect(body).toMatch(/RETURNS integer/);
    expect(body).toMatch(/LANGUAGE sql/);
    expect(body).toMatch(/\bIMMUTABLE\b/);
    expect(body).toMatch(/SET search_path TO ''/);

    // Not an object (includes JSON null, arrays, scalars) -> NULL.
    expect(body).toMatch(
      /WHEN p_value IS NULL OR jsonb_typeof\(p_value\) <> 'object' THEN NULL/
    );
    // Missing the 'max' key -> NULL.
    expect(body).toMatch(/WHEN NOT \(p_value \? 'max'\) THEN NULL/);
    // period not one of day/week/month -> NULL.
    expect(body).toMatch(
      /WHEN \(p_value->>'period'\) NOT IN \('day', 'week', 'month'\) THEN NULL/
    );
    // {max: null} -> the shared 999999 unlimited sentinel.
    expect(body).toMatch(/WHEN jsonb_typeof\(p_value->'max'\) = 'null' THEN 999999/);
    // A non-negative integer JSON number -> that integer (negative/non-integer
    // rejected by the >= 0 and = floor(...) guards; anything else falls to
    // the trailing ELSE NULL).
    expect(body).toMatch(/WHEN jsonb_typeof\(p_value->'max'\) = 'number'/);
    expect(body).toMatch(/\(p_value->>'max'\)::numeric >= 0/);
    expect(body).toMatch(
      /\(p_value->>'max'\)::numeric = floor\(\(p_value->>'max'\)::numeric\)/
    );
    expect(body).toMatch(/THEN \(p_value->>'max'\)::integer/);
    // Trailing catch-all — negative, non-integer, non-numeric, wrong type.
    expect(body).toMatch(/ELSE NULL\s*\n\s*END;/);
  });

  it('PIN: a malformed row is excluded from resolution via MAX() aggregation, not a raised error', () => {
    expect(body).toMatch(
      /SELECT\s+MAX\(public\.coerce_institution_limit_max\(ie\.value\)\)/
    );
  });

  it('PIN: effective_from/effective_to windows are honoured on both institution-override query arms', () => {
    const fromChecks = body.match(
      /\(ie\.effective_from IS NULL OR ie\.effective_from <= now\(\)\)/g
    ) ?? [];
    const toChecks = body.match(
      /\(ie\.effective_to\s+IS NULL OR ie\.effective_to\s+>= now\(\)\)/g
    ) ?? [];
    // Two arms: the v_has_roster branch and the direct-link fallback branch.
    expect(fromChecks.length).toBe(2);
    expect(toChecks.length).toBe(2);
  });

  it('PIN: entitlement_key is matched exactly (no LIKE/fuzzy match that could leak a different key)', () => {
    expect(body).toMatch(/ie\.entitlement_key = v_entitlement_key/);
    expect(body).not.toMatch(/entitlement_key\s+(LIKE|ILIKE|~)/);
  });

  it('the candidate-school CTE is duplicated verbatim (not extracted into a shared helper) — appears exactly twice', () => {
    const ctes = body.match(/WITH candidate_schools AS/g) ?? [];
    expect(ctes.length).toBe(2);
  });

  it('re-asserts the EXECUTE hardening on BOTH functions rather than relying on the pre-existing ACL', () => {
    expect(body).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.get_plan_limit\(uuid, text\) FROM PUBLIC;/
    );
    expect(body).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.get_plan_limit\(uuid, text\) FROM anon, authenticated;/
    );
    expect(body).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.coerce_institution_limit_max\(jsonb\) FROM PUBLIC;/
    );
    expect(body).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.coerce_institution_limit_max\(jsonb\) FROM anon, authenticated;/
    );
  });

  it('touches no RLS policy, no table/index DDL and no grade column (P8, P5)', () => {
    expect(body).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY/i);
    expect(body).not.toMatch(/CREATE TABLE|ALTER TABLE|DROP TABLE/i);
    expect(body).not.toMatch(/CREATE INDEX|DROP INDEX/i);
    expect(body).not.toMatch(/\bgrade\b/i);
  });

  it('carries an executable manual DOWN (the operational kill switch, no deploy needed)', () => {
    expect(sql).toMatch(/REVERSIBILITY — MANUAL DOWN/);
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_plan_limit\(p_student_id uuid, p_feature text\)[\s\S]*\$down\$/
    );
    // The DOWN restores 20260729130400's post-change GREATEST(personal, school)
    // — i.e. it removes the institution-override term, not the school term too.
    expect(sql).toMatch(/RETURN GREATEST\(v_personal, v_school\);\s*\n\s*--\s*END;/);
  });

  it('is deliberately NOT gated behind a feature flag (documented, monotonic-floor rationale)', () => {
    expect(sql).toMatch(/FLAG GATING — DELIBERATELY NOT GATED/);
    // No flag read/write anywhere in the executable body.
    expect(body).not.toMatch(/isFeatureEnabled|ff_institution_entitlements_v1/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('sentinel boundary — coerce_institution_limit_max shares the platform unlimited sentinel', () => {
  it('the {max:null} -> 999999 mapping matches UNLIMITED_USAGE_SENTINEL used elsewhere in this migration family', async () => {
    const { UNLIMITED_USAGE_SENTINEL } = await import('@alfanumrik/lib/usage-sentinel');
    expect(UNLIMITED_USAGE_SENTINEL).toBe(999999);
    const body = executable(read(OVERRIDE_SQL));
    expect(body).toMatch(/WHEN jsonb_typeof\(p_value->'max'\) = 'null' THEN 999999/);
  });
});
