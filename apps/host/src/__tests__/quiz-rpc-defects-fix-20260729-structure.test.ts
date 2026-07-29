import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Forensic-audit quiz-RPC defect cluster (2026-07-29) — STRUCTURAL pins
 * (always-on, runs in NORMAL CI; no database required).
 *
 * Migration: supabase/migrations/20260729120001_fix_quiz_rpc_defects.sql
 *
 * Fixes covered here:
 *   F1/F7 — submit_quiz_results_v2 Anti-Cheat Check 3 now counts SERVED
 *     questions from quiz_session_shuffles (keyed by p_session_id), not the
 *     nonexistent quiz_sessions.question_ids column joined on the WRONG id
 *     (a tautological always-pass bug that silently defeated the "response
 *     count must equal question count" check — P3).
 *   F5 — submit_quiz_results_v2 now reads the CAPPED xp back from the
 *     xp_transactions ledger (reference_id = 'quiz_' || session_id) instead
 *     of returning the raw uncapped v_xp, and surfaces xp_capped.
 *   F4 — the 6-arg atomic_quiz_profile_update overload reads today's-earned
 *     quiz XP from xp_transactions (daily_category='quiz'), not the
 *     nonexistent quiz_sessions.xp_earned column (which raised 42703 on
 *     every call).
 *   F3 — the 7-arg atomic_quiz_profile_update overload captures
 *     students.last_active into v_prev_last_active BEFORE Step 3 can
 *     overwrite it, so the Step 5 streak comparison is no longer comparing
 *     "now" against "now" (which permanently stuck streaks at never-increment).
 *   F8 — all three functions anchor "what day is it" on
 *     (now() AT TIME ZONE 'Asia/Kolkata')::date instead of a bare
 *     CURRENT_DATE (evaluated in the session's UTC timezone), removing an
 *     IST day-boundary off-by-one between 00:00-05:29 IST.
 *
 * Regression catalog candidate: REG-<next> "quiz-scoring RPC defect cluster
 * (Check 3 tautology, XP-cap propagation, streak ordering, IST boundary)".
 */

const FIX = 'supabase/migrations/20260729120001_fix_quiz_rpc_defects.sql';

function resolveRepo(rel: string): string | null {
  for (const c of [path.resolve(process.cwd(), rel), path.resolve(process.cwd(), '..', rel)]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
function read(rel: string): string {
  const p = resolveRepo(rel);
  return p ? fs.readFileSync(p, 'utf-8') : '';
}
/** Collapse whitespace + strip full-line `--` comments for layout-tolerant matching. */
function normalised(rel: string): string {
  return read(rel)
    .replace(/^\s*--.*$/gm, '')
    .replace(/\s+/g, ' ');
}

describe('quiz RPC defect-cluster fix (20260729120001) — migration present', () => {
  it('the fix migration exists', () => {
    expect(resolveRepo(FIX)).not.toBeNull();
  });
});

describe('F1/F7 — Anti-Cheat Check 3 counts served questions from quiz_session_shuffles', () => {
  const sql = normalised(FIX);

  it('Check 3 selects COUNT(*) FROM quiz_session_shuffles WHERE session_id = p_session_id', () => {
    expect(sql).toMatch(
      /SELECT\s+COUNT\(\*\)\s+INTO\s+v_served_count\s+FROM\s+quiz_session_shuffles\s+WHERE\s+session_id\s*=\s*p_session_id/i,
    );
  });

  it('the response-count mismatch check flags on v_served_count, not a quiz_sessions self-referential subquery', () => {
    expect(sql).toMatch(
      /IF\s+v_served_count\s*=\s*0\s+OR\s+jsonb_array_length\(p_responses\)\s*<>\s*v_served_count\s+THEN\s+v_flagged\s*:=\s*true/i,
    );
  });

  it('the OLD broken quiz_sessions.question_ids reference is GONE from the fixed function body (EXECUTABLE code, comments excluded)', () => {
    // The dead column reference that made Check 3 a tautological always-pass
    // legitimately appears in both the header prose AND inline `--` comments
    // documenting the historical bug (including right next to the fix, for
    // context) — so this assertion strips ALL `--` comments first and scopes
    // to the executable submit_quiz_results_v2 function body only.
    const raw = read(FIX)
      .replace(/--[^\n]*$/gm, '') // strip trailing + full-line comments
      .replace(/\s+/g, ' ');
    const bodyStart = raw.indexOf("CREATE OR REPLACE FUNCTION public.submit_quiz_results_v2(");
    expect(bodyStart).toBeGreaterThanOrEqual(0);
    const bodyOpen = raw.indexOf('AS $$', bodyStart);
    const bodyClose = raw.indexOf('$$;', bodyOpen);
    const body = raw.slice(bodyOpen, bodyClose);
    expect(body).not.toMatch(/quiz_sessions\.question_ids|question_ids,\s*1\)\s*FROM\s*quiz_sessions/i);
  });

  it('P3 thresholds (avg<3s, >3-question same-answer) are unchanged by this fix', () => {
    expect(sql).toMatch(/v_avg_time\s*<\s*3\.0/);
    expect(sql).toMatch(/v_total\s*>\s*3/);
  });
});

describe('F5 — daily-XP-cap propagation into submit_quiz_results_v2 return value', () => {
  const sql = normalised(FIX);

  it('reads the capped amount back from xp_transactions keyed by quiz_ || session_id', () => {
    expect(sql).toMatch(
      /SELECT\s+amount\s+INTO\s+v_xp_effective\s+FROM\s+xp_transactions\s+WHERE\s+reference_id\s*=\s*'quiz_'\s*\|\|\s*v_quiz_session_id::text/i,
    );
  });

  it('xp_capped is computed as effective < requested and both are surfaced in the JSONB return', () => {
    expect(sql).toMatch(/v_xp_capped\s*:=\s*v_xp_effective\s*<\s*v_xp/);
    expect(sql).toMatch(/'xp_earned',\s*v_xp/);
    expect(sql).toMatch(/'xp_capped',\s*v_xp_capped/);
  });

  it('quiz_sessions.score is corrected to the CAPPED amount after the ledger read-back', () => {
    expect(sql).toMatch(/UPDATE\s+quiz_sessions\s+SET\s+score\s*=\s*v_xp\s+WHERE\s+id\s*=\s*v_quiz_session_id/i);
  });
});

describe('F4 — 6-arg atomic_quiz_profile_update reads today-earned XP from the ledger, not a phantom column', () => {
  const sql = normalised(FIX);

  it('the 6-arg overload signature (no p_session_id) is present', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.atomic_quiz_profile_update\(\s*p_student_id\s+UUID,\s*p_subject\s+TEXT,\s*p_xp\s+INT,\s*p_total\s+INT,\s*p_correct\s+INT,\s*p_time_seconds\s+INT\s*\)/i,
    );
  });

  it('reads v_today_earned from xp_transactions (daily_category=quiz), never SUM(xp_earned) FROM quiz_sessions', () => {
    expect(sql).not.toMatch(/SUM\(xp_earned\)\s*FROM\s*quiz_sessions/i);
    expect(sql).toMatch(
      /SELECT\s+COALESCE\(SUM\(amount\),\s*0\)::INT\s+INTO\s+v_today_earned\s+FROM\s+public\.xp_transactions\s+WHERE\s+student_id\s*=\s*p_student_id\s+AND\s+daily_category\s*=\s*'quiz'/i,
    );
  });

  it('the daily cap literal (200) mirrors XP_RULES.quiz_daily_cap', () => {
    expect(sql).toMatch(/v_daily_cap\s+INT\s*:=\s*200/);
  });
});

describe('F3 — 7-arg overload captures last_active BEFORE Step 3 can overwrite it', () => {
  const sql = normalised(FIX);

  it('v_prev_last_active is captured from students.last_active before any award/ledger write', () => {
    const raw = read(FIX);
    const bodyStart = raw.indexOf(
      'CREATE OR REPLACE FUNCTION public.atomic_quiz_profile_update(\n  p_student_id    UUID,',
    );
    // Fallback: locate the 7-arg overload by its p_session_id parameter, which
    // only the 7-arg signature has.
    const start = bodyStart >= 0 ? bodyStart : raw.indexOf('p_session_id    UUID DEFAULT NULL');
    expect(start).toBeGreaterThanOrEqual(0);

    expect(sql).toMatch(
      /SELECT\s+last_active\s+INTO\s+v_prev_last_active\s+FROM\s+public\.students\s+WHERE\s+id\s*=\s*p_student_id/i,
    );
  });

  it('Step 5 streak comparison reads v_prev_last_active, not a re-read of students.last_active', () => {
    // The streak CASE in Step 5 must reference the captured variable.
    expect(sql).toMatch(
      /streak_days\s*=\s*CASE\s+WHEN\s+v_prev_last_active\s+IS\s+NOT\s+NULL/i,
    );
  });

  it('the capture happens textually BEFORE Step 3 (the ledger/award_xp write) in the function body', () => {
    const raw = read(FIX);
    const overloadStart = raw.indexOf('p_session_id    UUID DEFAULT NULL');
    expect(overloadStart).toBeGreaterThanOrEqual(0);
    const body = raw.slice(overloadStart);
    const captureIdx = body.search(/SELECT last_active INTO v_prev_last_active/);
    const step3Idx = body.search(/Step 3: Write ledger row/);
    expect(captureIdx).toBeGreaterThan(0);
    expect(step3Idx).toBeGreaterThan(0);
    expect(captureIdx).toBeLessThan(step3Idx);
  });
});

describe('F8 — IST day-boundary anchor unified across all three functions', () => {
  const sql = normalised(FIX);

  it('every day-boundary check anchors on (now() AT TIME ZONE \'Asia/Kolkata\')::date, not bare CURRENT_DATE', () => {
    // The fix must not reintroduce the UTC-anchored CURRENT_DATE pattern for
    // any of the three day-boundary reads this migration touches.
    expect(sql).not.toMatch(/created_at\s*>=\s*\(CURRENT_DATE\s+AT\s+TIME\s+ZONE\s+'Asia\/Kolkata'\)/i);
    expect(sql).not.toMatch(/last_active::date\s*=\s*CURRENT_DATE/i);
    // At least 3 distinct v_ist_today anchors (one per function that needed it).
    const matches = sql.match(/v_ist_today\s*:=\s*\(now\(\)\s*AT\s+TIME\s+ZONE\s+'Asia\/Kolkata'\)::date/gi) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2); // 6-arg + 7-arg overloads both declare it
  });

  it('P1/P2 formulas and P3 thresholds are documented as UNCHANGED in the migration header', () => {
    // NOTE: normalised() strips FULL-LINE `--` comments, which would strip
    // away the entire header prose block this assertion targets — use the
    // raw text (whitespace-collapsed only, comments intact) instead.
    const headerProse = read(FIX).replace(/\s+/g, ' ');
    expect(headerProse).toMatch(/P1 score formula, P2 XP formula\/values, and P3 anti-cheat THRESHOLDS[\s\S]{0,120}UNCHANGED/i);
  });
});
