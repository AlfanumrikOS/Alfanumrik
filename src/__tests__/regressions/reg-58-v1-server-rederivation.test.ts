/**
 * REG-58 — Legacy v1 `submit_quiz_results` RPC re-derives `is_correct`
 * server-side from `question_bank.correct_answer_index` (P1 score accuracy).
 *
 * The v1 RPC remains callable until mobile cuts over to v2 (per REG-51's
 * notes). Even on the legacy path, the server must NEVER trust the client's
 * `is_correct` field — it must compare the client's `selected_option`
 * against the authoritative `correct_answer_index` on `question_bank`.
 *
 * Strategy: static-source inspection of the v1 migration. We verify:
 *   1. `v_actual_correct` is read from `question_bank.correct_answer_index`.
 *   2. `v_is_correct` is computed as `v_selected = v_actual_correct`.
 *   3. The RPC does NOT pull `is_correct` directly from the client payload
 *      (e.g. `(r->>'is_correct')::BOOLEAN`) and use it for scoring.
 *
 * Source migration: 20260403500000_fix_submit_quiz_the_one_fix.sql in the
 * archived `_legacy/timestamped/` chain (post-Section-10 cleanup, 2026-05-03).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function resolveMigration(name: string): string | null {
  const candidates = [
    resolve(process.cwd(), 'supabase/migrations', name),
    resolve(process.cwd(), 'supabase/migrations/_legacy/timestamped', name),
    resolve(process.cwd(), 'supabase/migrations/_legacy', name),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

describe('REG-58 — v1 submit_quiz_results re-derives is_correct server-side', () => {
  const migPath = resolveMigration('20260403500000_fix_submit_quiz_the_one_fix.sql');

  it('the v1 migration exists in either active or _legacy/timestamped path', () => {
    expect(migPath, 'expected to find 20260403500000_fix_submit_quiz_the_one_fix.sql').not.toBeNull();
  });

  it('reads v_actual_correct from question_bank.correct_answer_index', () => {
    if (!migPath) return; // guarded by the prior test
    const sql = readFileSync(migPath, 'utf8');
    // Pin the SELECT that pulls the authoritative correct index.
    expect(sql).toMatch(/SELECT\s+correct_answer_index\s+INTO\s+v_actual_correct/);
  });

  it('computes v_is_correct as v_selected = v_actual_correct (not from client payload)', () => {
    if (!migPath) return;
    const sql = readFileSync(migPath, 'utf8');
    expect(sql).toMatch(/v_is_correct\s*:=\s*\([^;]*v_selected\s*=\s*v_actual_correct[^;]*\)/);
  });

  it('does NOT cast (r->>\'is_correct\') and use it for scoring', () => {
    if (!migPath) return;
    const sql = readFileSync(migPath, 'utf8');
    // The client payload may CARRY is_correct (older v1 callers do), but the
    // SQL function MUST NOT use it for scoring. We assert the dangerous
    // BOOLEAN coercion of the client field never appears in this migration.
    expect(sql).not.toMatch(/r->>'is_correct'.*::\s*BOOLEAN/i);
  });

  it('uses v_selected from selected_option (the click index), not from a client correctness flag', () => {
    if (!migPath) return;
    const sql = readFileSync(migPath, 'utf8');
    // Pin the v_selected source so the RPC keeps comparing CLICKS against
    // the truthsource, not flags against flags.
    expect(sql).toMatch(/v_selected\s*:=\s*\(\s*r->>'selected_option'\s*\)::\s*INTEGER/i);
  });
});
