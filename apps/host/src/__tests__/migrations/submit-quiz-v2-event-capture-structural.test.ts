/**
 * REG-352 — Phase 2 event-capture contract (structural pins, 2026-08-05).
 *
 * Pins the quiz_responses event-capture wave (migrations 20260807000200 /
 * 20260807000300 / 20260807000500) at the SQL-text level:
 *
 *   D2 — question_version / content_hash on quiz_responses are SERVER-HELD:
 *        copied from quiz_session_shuffles.options_version_at_serve /
 *        integrity_hash (written by start_quiz_session). ZERO client trust —
 *        the RPC exposes no parameter through which a client could supply
 *        either value.
 *   D3 — answer_method: server whitelist ('mcq','typed','voice','scan'),
 *        unknown/absent normalizes to 'mcq'. Normalize-never-abort.
 *   D6 — confidence: regex-guarded '^[1-5]$', else NULL. Normalize-never-abort
 *        (same pattern as F8 hint_level '^[0-3]$').
 *   D7 — misconception match on the TRUE ORIGINAL-space index (v_selected_orig,
 *        re-derived from the server shuffle snapshot), per-iteration reset;
 *        student_misconceptions open/resolve lifecycle runs in an
 *        ERROR-ISOLATED sub-block (can never abort the P4 submit transaction)
 *        and NEVER writes the free-text columns (P13).
 *
 * Structural-only (no live Postgres execution this session) — same honesty
 * posture as REG-350's migration pins.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'supabase', 'migrations'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repo root (supabase/migrations) not found');
}

function readMigration(name: string): string {
  return fs.readFileSync(
    path.join(findRepoRoot(), 'supabase', 'migrations', name),
    'utf8',
  );
}

const COLUMNS_MIGRATION = '20260807000200_quiz_responses_event_capture_columns.sql';
const MISCONCEPTIONS_MIGRATION =
  '20260807000300_student_misconceptions_writer_support.sql';
const SUBMIT_V2_MIGRATION = '20260807000500_submit_quiz_v2_event_capture.sql';

describe('20260807000200 — quiz_responses event-capture columns (additive, idempotent)', () => {
  const sql = readMigration(COLUMNS_MIGRATION);

  it('adds the five capture columns with IF NOT EXISTS', () => {
    for (const col of [
      'question_version integer',
      'content_hash     text',
      'answer_method    text',
      'confidence       smallint',
      'misconception_id uuid',
    ]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
  });

  it('contains no DROP statement (purely additive)', () => {
    expect(sql).not.toMatch(/^\s*DROP\s/im);
  });
});

describe('20260807000300 — student_misconceptions writer support', () => {
  const sql = readMigration(MISCONCEPTIONS_MIGRATION);

  it('creates the partial unique index the v2 writer targets (one OPEN row per student+pattern+concept)', () => {
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_student_misconceptions_open',
    );
    expect(sql).toContain(
      'ON public.student_misconceptions (student_id, pattern_code, concept_code)',
    );
    expect(sql).toContain('WHERE is_resolved = false');
  });
});

describe('20260807000500 — submit_quiz_results_v2 event capture', () => {
  const sql = readMigration(SUBMIT_V2_MIGRATION);

  it('D2: version/hash are read from the server-held quiz_session_shuffles snapshot', () => {
    expect(sql).toContain('options_version_at_serve, integrity_hash');
    expect(sql).toMatch(/FROM quiz_session_shuffles\s+WHERE session_id = p_session_id AND question_id = v_question_id/);
    // ...and persisted into quiz_responses.
    expect(sql).toContain('question_version, content_hash, answer_method, confidence,');
    expect(sql).toContain('v_options_version_at_serve, v_integrity_hash, v_answer_method, v_confidence,');
  });

  it('D2: ZERO client trust — no RPC parameter can carry version or hash', () => {
    expect(sql).not.toContain('p_question_version');
    expect(sql).not.toContain('p_content_hash');
    expect(sql).not.toContain('p_integrity_hash');
    expect(sql).not.toContain('p_options_version');
  });

  it('D3: answer_method server whitelist normalizes unknown/absent to mcq (never aborts)', () => {
    expect(sql).toContain(
      "WHEN (r->>'answer_method') IN ('mcq', 'typed', 'voice', 'scan')",
    );
    expect(sql).toMatch(/v_answer_method := CASE[\s\S]{0,200}ELSE 'mcq'/);
  });

  it('D6: confidence regex-guarded to 1..5 else NULL (never aborts)', () => {
    expect(sql).toContain("WHEN (r->>'confidence') ~ '^[1-5]$'");
    expect(sql).toMatch(/v_confidence := CASE[\s\S]{0,200}ELSE NULL/);
  });

  it('F8 companion: hint_level regex-guarded to 0..3 else NULL (the pattern D3/D6 copy)', () => {
    expect(sql).toContain("WHEN (r->>'hint_level') ~ '^[0-3]$'");
  });

  it('D7: misconception lookup matches on the ORIGINAL-space index with per-iteration reset', () => {
    // Explicit reset so a correct answer never inherits the prior match.
    expect(sql).toContain('v_misconception_id := NULL;');
    expect(sql).toContain('v_misconception_code := NULL;');
    expect(sql).toContain('AND qm.distractor_index = v_selected_orig');
    expect(sql).toMatch(/IF NOT v_is_correct\s+AND v_selected_orig IS NOT NULL\s+AND v_selected_orig BETWEEN 0 AND 3/);
  });

  it('D7: open/resolve lifecycle is error-isolated (EXCEPTION WHEN OTHERS THEN NULL — P4)', () => {
    expect(sql).toMatch(
      /INSERT INTO student_misconceptions[\s\S]+?ON CONFLICT \(student_id, pattern_code, concept_code\)\s+WHERE is_resolved = false/,
    );
    expect(sql).toContain("resolution_method   = 'quiz_correct'");
    // The lifecycle block swallows all errors.
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN\s+NULL;\s+--\s*lifecycle is best-effort/);
  });

  it('D7/P13: the lifecycle INSERT never writes the free-text columns', () => {
    const insertMatch = sql.match(
      /INSERT INTO student_misconceptions \(([\s\S]*?)\)\s*VALUES/,
    );
    expect(insertMatch).not.toBeNull();
    const insertedColumns = insertMatch![1];
    expect(insertedColumns).not.toContain('question_text');
    expect(insertedColumns).not.toContain('student_answer');
    expect(insertedColumns).not.toContain('correct_answer');
  });
});
