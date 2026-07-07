import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SM-2 interval clamp + Phase-4 mastery backfill — STRUCTURAL pins
 * (always-on, runs in normal CI; no database required).
 *
 * Companion to the integration-lane e2e (migrations/sm2-clamp-e2e.test.ts).
 * These pins grep the migration SOURCE so the two changes cannot silently
 * regress:
 *
 *   - 20260622080000_clamp_sm2_interval.sql
 *       CREATE OR REPLACE update_learner_state_post_quiz = the prior body
 *       VERBATIM + exactly ONE added line `v_new_interval := LEAST(v_new_interval, 365);`
 *       immediately after the SM-2 interval block. This is the single-source fix
 *       for the LIVE timestamptz overflow (SQLSTATE 22008) that silently froze
 *       mastery for any student reaching ~17 consecutive-correct on one topic.
 *       The 10-arg signature, SECURITY DEFINER + SET search_path, and the
 *       DROP FUNCTION IF EXISTS + CREATE OR REPLACE idempotency guard must all
 *       be retained; the rest of the body must be re-emitted (not a no-op patch).
 *
 *   - 20260622070000_phase4_mastery_backfill_replay.sql
 *       One-shot idempotent backfill that replays persisted quiz_responses
 *       through update_learner_state_post_quiz to populate concept_mastery for
 *       the 9 quiz-takers with zero mastery rows. Guarded by an admin_audit_log
 *       one-shot marker + a zero-existing-row pair guard. It must call ONLY the
 *       learner-state RPC and NEVER touch the score/XP/session writers
 *       (P1/P2 freeze guard). It must be strictly non-destructive (no DROP
 *       TABLE/COLUMN, no DELETE of concept_mastery).
 *
 * THE BUGS THESE WOULD CATCH:
 *   - dropping the `LEAST(v_new_interval, 365)` clamp -> the 22008 overflow
 *     returns and long-streak students silently freeze again.
 *   - changing the 10-arg signature / losing SECURITY DEFINER / search_path ->
 *     the live submit chain that calls this RPC breaks or loses its hardening.
 *   - replacing the full body with a partial patch (the clamp migration MUST
 *     re-emit the verbatim body via DROP + CREATE OR REPLACE).
 *   - the backfill calling atomic_quiz_profile_update / submit_quiz_results_v2
 *     or writing xp_total / quiz_sessions score -> re-grades history, violates
 *     P1 (score accuracy) and P2 (XP economy) on already-settled sessions.
 *   - the backfill becoming destructive (DROP/DELETE on concept_mastery).
 *   - losing the one-shot marker guard -> re-running double-applies mastery.
 *
 * Mirrors the repo's grep-the-migration-file conformance style
 * (adaptive-selection-structure.test.ts, resilient-mastery-perform-structure.test.ts).
 */

const CLAMP =
  'supabase/migrations/20260622080000_clamp_sm2_interval.sql';
const BACKFILL =
  'supabase/migrations/20260622070000_phase4_mastery_backfill_replay.sql';

function resolve(rel: string): string | null {
  for (const c of [path.resolve(process.cwd(), rel), path.resolve(process.cwd(), '..', rel)]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
function read(rel: string): string {
  const p = resolve(rel);
  return p ? fs.readFileSync(p, 'utf-8') : '';
}
/** Collapse whitespace + strip line comments so matching is layout-tolerant and
 *  never matches the RCA prose in the header comments. */
function normalised(rel: string): string {
  return read(rel)
    .replace(/^\s*--.*$/gm, '')
    .replace(/\s+/g, ' ');
}
/**
 * Like normalised(), but ALSO strips the non-executable string-literal prose so
 * NEGATIVE assertions (`.not.toMatch`) don't trip on the header/comment/audit
 * narrative that legitimately names the FORBIDDEN identifiers (e.g. the backfill
 * header explicitly says "does NOT call atomic_quiz_profile_update"). We assert
 * forbidden-call absence against the executable body only.
 */
function codeOnly(rel: string): string {
  let sql = normalised(rel);
  // Drop every COMMENT ON ... ; statement (its IS '...' body holds prose).
  sql = sql.replace(/COMMENT ON [^;]*;/gi, ' ');
  // Drop the audit INSERT (its jsonb VALUES carry the RCA prose) up to its close.
  sql = sql.replace(/INSERT INTO public\.admin_audit_log[\s\S]*?\);/gi, ' ');
  // Drop RAISE NOTICE strings (operational prose).
  sql = sql.replace(/RAISE NOTICE[^;]*;/gi, ' ');
  return sql;
}

// ───────────────────────────────────────────────────────────────────────────
describe('SM-2 clamp / Phase-4 backfill — migrations present', () => {
  it('SM-2 interval clamp migration exists', () => {
    expect(resolve(CLAMP)).not.toBeNull();
  });
  it('Phase-4 mastery backfill migration exists', () => {
    expect(resolve(BACKFILL)).not.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Clamp migration — the one-line fix + the retained RPC contract.
// ───────────────────────────────────────────────────────────────────────────
describe('SM-2 clamp — the LEAST(v_new_interval, 365) fix is present', () => {
  it('asserts the single-source clamp line exists', () => {
    // The exact fix: v_new_interval := LEAST(v_new_interval, 365);
    expect(normalised(CLAMP)).toMatch(
      /v_new_interval\s*:=\s*LEAST\(\s*v_new_interval\s*,\s*365\s*\)\s*;/i,
    );
  });

  it('the clamp follows the SM-2 interval block (interval assigned before it is clamped)', () => {
    const sql = normalised(CLAMP);
    // The geometric growth line ROUND(v_review_interval * v_new_ease) must appear
    // BEFORE the clamp — the clamp caps the value the interval block produced.
    const growthIdx = sql.search(/ROUND\(\s*v_review_interval\s*\*\s*v_new_ease\s*\)/i);
    const clampIdx = sql.search(/v_new_interval\s*:=\s*LEAST\(\s*v_new_interval\s*,\s*365\s*\)/i);
    expect(growthIdx).toBeGreaterThanOrEqual(0);
    expect(clampIdx).toBeGreaterThanOrEqual(0);
    expect(clampIdx).toBeGreaterThan(growthIdx);
  });
});

describe('SM-2 clamp — RPC contract retained (10-arg sig, SECURITY DEFINER, search_path, idempotent re-emit)', () => {
  it('re-emits update_learner_state_post_quiz via CREATE OR REPLACE', () => {
    expect(normalised(CLAMP)).toMatch(
      /CREATE OR REPLACE FUNCTION\s+(public\.)?update_learner_state_post_quiz/i,
    );
  });

  it('drops the EXACT 10-arg overload first (idempotency guard, not data)', () => {
    expect(normalised(CLAMP)).toMatch(
      /DROP FUNCTION IF EXISTS public\.update_learner_state_post_quiz\(\s*UUID\s*,\s*UUID\s*,\s*BOOLEAN\s*,\s*TEXT\s*,\s*TEXT\s*,\s*INT\s*,\s*INT\s*,\s*FLOAT\s*,\s*FLOAT\s*,\s*FLOAT\s*\)/i,
    );
  });

  it('preserves all 10 named parameters in order', () => {
    const sql = normalised(CLAMP);
    expect(sql).toMatch(/p_student_id\s+UUID/i);
    expect(sql).toMatch(/p_topic_id\s+UUID/i);
    expect(sql).toMatch(/p_is_correct\s+BOOLEAN/i);
    expect(sql).toMatch(/p_bloom_level\s+TEXT/i);
    expect(sql).toMatch(/p_error_type\s+TEXT/i);
    expect(sql).toMatch(/p_response_time_ms\s+INT/i);
    expect(sql).toMatch(/p_difficulty\s+INT/i);
    expect(sql).toMatch(/p_p_learn\s+FLOAT/i);
    expect(sql).toMatch(/p_p_slip\s+FLOAT/i);
    expect(sql).toMatch(/p_p_guess\s+FLOAT/i);
  });

  it('retains SECURITY DEFINER and SET search_path = public', () => {
    const sql = normalised(CLAMP);
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/SET search_path = public/i);
    expect(sql).toMatch(/RETURNS JSONB/i);
    expect(sql).toMatch(/LANGUAGE plpgsql/i);
  });

  it('re-emits the body (not a partial patch): BKT update, ease, streak, upsert all present', () => {
    const sql = normalised(CLAMP);
    // Hallmarks of the full verbatim body — proves it was re-emitted, not patched.
    expect(sql).toMatch(/v_p_evidence/i); // BKT evidence calc
    expect(sql).toMatch(/v_new_ease := LEAST\(3\.0, v_ease_factor \+ 0\.1\)/i); // ease block
    expect(sql).toMatch(/INSERT INTO concept_mastery/i); // upsert
    expect(sql).toMatch(/ON CONFLICT \(student_id, topic_id\) DO UPDATE/i); // upsert
    expect(sql).toMatch(/consecutive_wrong/i); // consecutive_wrong maintenance retained
    expect(sql).toMatch(/now\(\) \+ \(v_new_interval \|\| ' days'\)::INTERVAL/i); // next_review_at expr (the overflow site)
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Backfill migration — one-shot marker, learner-state-only, P1/P2 freeze guard,
// non-destructive.
// ───────────────────────────────────────────────────────────────────────────
describe('Phase-4 backfill — one-shot marker guard', () => {
  it('guards on the admin_audit_log one-shot marker action', () => {
    const sql = normalised(BACKFILL);
    expect(sql).toMatch(/data_quality\.phase4_mastery_backfill/i);
    // The guard reads admin_audit_log for that marker before doing anything.
    expect(sql).toMatch(/FROM public\.admin_audit_log/i);
    expect(sql).toMatch(/action = 'data_quality\.phase4_mastery_backfill'/i);
  });

  it('short-circuits (RETURN) when the marker already exists', () => {
    const sql = normalised(BACKFILL);
    expect(sql).toMatch(/IF v_marker_exists THEN/i);
    expect(sql).toMatch(/RETURN;/i);
  });

  it('writes the marker on completion (records the run)', () => {
    expect(normalised(BACKFILL)).toMatch(
      /INSERT INTO public\.admin_audit_log[\s\S]*'data_quality\.phase4_mastery_backfill'/i,
    );
  });
});

describe('Phase-4 backfill — calls ONLY the learner-state RPC', () => {
  it('calls update_learner_state_post_quiz', () => {
    expect(normalised(BACKFILL)).toMatch(
      /PERFORM\s+public\.update_learner_state_post_quiz\s*\(/i,
    );
  });

  it('P1/P2 FREEZE GUARD: never calls atomic_quiz_profile_update', () => {
    expect(codeOnly(BACKFILL)).not.toMatch(/atomic_quiz_profile_update/i);
  });

  it('P1/P2 FREEZE GUARD: never calls submit_quiz_results_v2 (or any submit_quiz_results writer)', () => {
    expect(codeOnly(BACKFILL)).not.toMatch(/submit_quiz_results/i);
  });

  it('P2 FREEZE GUARD: never writes students.xp_total', () => {
    const code = codeOnly(BACKFILL);
    // No UPDATE/INSERT touching xp_total. The marker INSERT is stripped by codeOnly,
    // and it carries no xp_total column anyway.
    expect(code).not.toMatch(/xp_total/i);
  });

  it('P1 FREEZE GUARD: never writes quiz_sessions score / score_percent', () => {
    const code = codeOnly(BACKFILL);
    // The backfill READS quiz_sessions (to find the 9 takers) but must never
    // UPDATE/INSERT it, and must never write a score column.
    expect(code).not.toMatch(/UPDATE\s+(public\.)?quiz_sessions/i);
    expect(code).not.toMatch(/INSERT INTO\s+(public\.)?quiz_sessions/i);
    expect(code).not.toMatch(/score_percent/i);
  });

  it('passes the FIRST 7 POSITIONAL ARGS only (BKT params left default), p_error_type=NULL', () => {
    // Strip the inline trailing `-- ...` per-arg comments so the call shape is
    // matched against the executable arguments only (normalised() only removes
    // FULL comment lines, not mid-line trailing comments).
    const sql = read(BACKFILL)
      .replace(/--[^\n]*$/gm, '') // strip trailing inline + full line comments
      .replace(/\s+/g, ' ');
    // The replay call must NOT pass the p_p_learn/p_p_slip/p_p_guess BKT params.
    // Pin the call shape: student, topic, is_correct, bloom, NULL (error_type),
    // rt_ms, difficulty (exactly 7 positional args).
    expect(sql).toMatch(
      /PERFORM\s+public\.update_learner_state_post_quiz\(\s*v_pair\.student_id\s*,\s*v_pair\.topic_id\s*,\s*v_resp\.is_correct\s*,\s*v_resp\.bloom_level\s*,\s*NULL\s*,\s*v_rt_ms\s*,\s*v_resp\.difficulty\s*\)/i,
    );
  });
});

describe('Phase-4 backfill — non-destructive (no teardown of concept_mastery)', () => {
  it('does not DROP TABLE or DROP COLUMN', () => {
    const sql = normalised(BACKFILL);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });

  it('never DELETEs from concept_mastery (additive-only)', () => {
    const code = codeOnly(BACKFILL);
    expect(code).not.toMatch(/DELETE\s+FROM\s+(public\.)?concept_mastery/i);
    // Defensive: no UPDATE of pre-existing concept_mastery rows either (all writes
    // go through the RPC's upsert on fresh zero-row pairs).
    expect(code).not.toMatch(/UPDATE\s+(public\.)?concept_mastery/i);
  });

  it('processes only ZERO-existing-row (student, topic) pairs (pair guard present)', () => {
    const sql = normalised(BACKFILL);
    // The NOT EXISTS pair guard against concept_mastery is what makes a stray
    // re-run (absent the marker) still a no-op on already-populated pairs.
    expect(sql).toMatch(
      /NOT EXISTS\s*\(\s*SELECT 1 FROM public\.concept_mastery cm/i,
    );
  });

  it('runs inside a single transaction (BEGIN/COMMIT)', () => {
    const sql = normalised(BACKFILL);
    expect(sql).toMatch(/\bBEGIN;/);
    expect(sql).toMatch(/\bCOMMIT;/);
  });
});
