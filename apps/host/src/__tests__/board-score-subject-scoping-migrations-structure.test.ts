/**
 * Migration structural pins (unit lane, runs on every PR — no live DB) for
 * the two BoardScore subject-scoping migrations:
 *
 *   - `20260801110000_fix_board_score_social_studies_code.sql`
 *   - `20260801110100_cleanup_stale_board_score_predictions.sql`
 *
 * House style follows the precedent set by
 * `get-plan-limit-school-coverage-structure.test.ts`: assert exact SQL
 * predicates from source text (not behavior — this file cannot execute SQL),
 * idempotency by construction, and that neither migration touches DDL/RLS.
 * The corresponding live-DB behavioral proof does not exist for these two
 * migrations in this pass (see the testing agent's report for the honest
 * gap statement) — this is a SOURCE-CONTRACT pin only.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SOCIAL_STUDIES_FIX_PATH = path.resolve(
  __dirname,
  '../../../../supabase/migrations/20260801110000_fix_board_score_social_studies_code.sql',
);
const CLEANUP_PATH = path.resolve(
  __dirname,
  '../../../../supabase/migrations/20260801110100_cleanup_stale_board_score_predictions.sql',
);

const socialStudiesFixSource = readFileSync(SOCIAL_STUDIES_FIX_PATH, 'utf-8');
const cleanupSource = readFileSync(CLEANUP_PATH, 'utf-8');

// Shared no-DDL/no-RLS canary applied to both files.
function assertNoDdlOrRls(source: string, label: string) {
  expect(source, `${label}: must not DROP anything`).not.toMatch(/\bDROP\s+(TABLE|COLUMN|FUNCTION|POLICY|INDEX)/i);
  expect(source, `${label}: must not CREATE TABLE`).not.toMatch(/\bCREATE\s+TABLE\b/i);
  expect(source, `${label}: must not ALTER TABLE`).not.toMatch(/\bALTER\s+TABLE\b/i);
  expect(source, `${label}: must not touch RLS policies`).not.toMatch(/\bCREATE\s+POLICY\b/i);
  expect(source, `${label}: must not enable/disable RLS`).not.toMatch(/ROW\s+LEVEL\s+SECURITY/i);
  expect(source, `${label}: must not GRANT/REVOKE`).not.toMatch(/\b(GRANT|REVOKE)\b/i);
}

describe('20260801110000_fix_board_score_social_studies_code.sql (structural)', () => {
  it('is a targeted UPDATE on cbse_chapter_weights.subject_code, social_science -> social_studies', () => {
    expect(socialStudiesFixSource).toMatch(/UPDATE\s+public\.cbse_chapter_weights/i);
    expect(socialStudiesFixSource).toContain("SET subject_code = 'social_studies'");
    expect(socialStudiesFixSource).toContain("WHERE subject_code = 'social_science'");
  });

  it('scopes the UPDATE to grade 10 CBSE rows exactly (the documented seed scope)', () => {
    expect(socialStudiesFixSource).toMatch(/AND\s+grade\s*=\s*'10'/i);
    expect(socialStudiesFixSource).toMatch(/AND\s+board\s*=\s*'CBSE'/i);
  });

  it('is idempotent by construction — the WHERE predicate only matches the PRE-fix code, so a second run touches zero rows', () => {
    // The predicate filters on the OLD value ('social_science'). Once
    // applied, no row can match it again — a structural (not just
    // documented) idempotency guarantee, unlike an approach keyed on a
    // migration-run marker. Scope this check to the EXECUTABLE SQL only
    // (between BEGIN; and COMMIT;) — the file's own comment block
    // legitimately documents a manual DOWN that runs the update in reverse
    // ("SET subject_code = 'social_science'"), which must not itself trip
    // this assertion.
    const beginIdx = socialStudiesFixSource.indexOf('BEGIN;');
    const commitIdx = socialStudiesFixSource.indexOf('COMMIT;');
    expect(beginIdx).toBeGreaterThan(-1);
    expect(commitIdx).toBeGreaterThan(beginIdx);
    const executableSql = socialStudiesFixSource.slice(beginIdx, commitIdx);

    expect(executableSql).toMatch(/WHERE\s+subject_code\s*=\s*'social_science'/i);
    // The SET target value must differ from the WHERE-matched value —
    // otherwise the UPDATE would be a true no-op mask rather than a real fix.
    expect(executableSql).not.toMatch(/SET subject_code = 'social_science'/);
    expect(executableSql).toContain("SET subject_code = 'social_studies'");
  });

  it('wraps the UPDATE in an explicit transaction (BEGIN...COMMIT)', () => {
    expect(socialStudiesFixSource).toMatch(/\bBEGIN;/);
    expect(socialStudiesFixSource).toMatch(/\bCOMMIT;/);
  });

  it('touches no DDL and no RLS', () => {
    assertNoDdlOrRls(socialStudiesFixSource, 'social-studies-code-fix');
  });

  it('documents a runnable manual DOWN', () => {
    expect(socialStudiesFixSource).toMatch(/MANUAL DOWN/i);
    expect(socialStudiesFixSource).toContain("SET subject_code = 'social_science'");
  });
});

describe('20260801110100_cleanup_stale_board_score_predictions.sql (structural)', () => {
  it('is a targeted DELETE on board_score_predictions scoped by a NOT EXISTS against students.selected_subjects', () => {
    expect(cleanupSource).toMatch(/DELETE\s+FROM\s+public\.board_score_predictions\s+bsp/i);
    expect(cleanupSource).toMatch(/WHERE\s+NOT\s+EXISTS\s*\(/i);
    expect(cleanupSource).toContain('SELECT 1 FROM public.students s');
    expect(cleanupSource).toContain('WHERE s.id = bsp.student_id');
  });

  it('uses the exact NULL-safe membership predicate from spec §7.2 item 1', () => {
    expect(cleanupSource).toContain(
      "bsp.subject_code = ANY(COALESCE(s.selected_subjects, '{}'))",
    );
  });

  it('is idempotent by construction — a second run always deletes zero additional rows', () => {
    // Every row satisfying the NOT EXISTS predicate is deleted in pass 1;
    // nothing left after that can still satisfy it (the remaining rows are,
    // by definition, the ones for which the EXISTS check succeeds).
    expect(cleanupSource).toMatch(/idempotent/i);
    expect(cleanupSource).toMatch(/GET DIAGNOSTICS/i);
  });

  it('surfaces the deleted-row count via RAISE NOTICE for operational visibility', () => {
    expect(cleanupSource).toMatch(/RAISE NOTICE/i);
    expect(cleanupSource).toMatch(/v_deleted_count/);
  });

  it('touches no DDL and no RLS', () => {
    assertNoDdlOrRls(cleanupSource, 'cleanup-stale-board-score-predictions');
  });

  it('is honest in-file about current impact — documents the zero-row no-op state rather than overclaiming', () => {
    expect(cleanupSource).toMatch(/NO-OP/i);
    expect(cleanupSource).toMatch(/ZERO rows/i);
  });
});
