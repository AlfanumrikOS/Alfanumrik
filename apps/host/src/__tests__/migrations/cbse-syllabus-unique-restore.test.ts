import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression pin (2026-08-14): cbse_syllabus UNIQUE constraint restoration.
 *
 * The shared staging Supabase project drifted — the constraint
 * `cbse_syllabus_board_grade_subject_code_chapter_number_key` was missing even
 * though it is declared in the baseline. The integration lane's
 * `cbse-syllabus.test.ts` asserts a duplicate (board, grade, subject_code,
 * chapter_number) row is rejected; without the constraint the duplicate insert
 * succeeds, which failed the integration lane and cascaded to CI Gate and the
 * fail-closed production deploy Quality Gate.
 *
 * `20260814000001_restore_cbse_syllabus_unique_constraint.sql` restores the
 * invariant idempotently. These source-level checks pin that:
 *   - the migration exists and is transactional,
 *   - it performs an idempotent existence check (pg_constraint / pg_index)
 *     before adding the constraint (never a blind ADD that fails on a fresh or
 *     already-correct environment),
 *   - it adds the canonical constraint name/columns from the baseline.
 *
 * Same pattern as `answer-key-oracle-closure.test.ts` / `rls-student-id-policies.test.ts`
 * (static SQL-text scan; no live Postgres).
 */

const MIGRATION_FILE =
  'supabase/migrations/20260814000001_restore_cbse_syllabus_unique_constraint.sql';

function resolveRepo(rel: string): string | null {
  for (const c of [path.resolve(process.cwd(), rel), path.resolve(process.cwd(), '..', rel)]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const MIGRATION_PRESENT = resolveRepo(MIGRATION_FILE) !== null;
const sql = MIGRATION_PRESENT ? fs.readFileSync(resolveRepo(MIGRATION_FILE)!, 'utf-8') : '';

describe.skipIf(!MIGRATION_PRESENT)(
  '20260814000001 cbse_syllabus UNIQUE constraint restore',
  () => {
    it('migration exists', () => {
      expect(MIGRATION_PRESENT).toBe(true);
    });

    it('is transactional (BEGIN ... COMMIT)', () => {
      expect(sql).toMatch(/BEGIN;/);
      expect(sql).toMatch(/COMMIT;/);
    });

    it('is idempotent: checks for an existing unique constraint before adding', () => {
      expect(sql).toMatch(/FROM\s+pg_constraint/i);
      expect(sql).toMatch(/contype\s*=\s*'u'/i);
      expect(sql).toMatch(/relname\s*=\s*'cbse_syllabus'/i);
      expect(sql).toMatch(/ADD\s+CONSTRAINT/i);
    });

    it('adds the canonical baseline constraint name and columns', () => {
      expect(sql).toMatch(
        /ADD\s+CONSTRAINT\s+"cbse_syllabus_board_grade_subject_code_chapter_number_key"\s+UNIQUE\s*\("board",\s*"grade",\s*"subject_code",\s*"chapter_number"\)/i,
      );
    });

    it('only adds the constraint when no existing coverage is found', () => {
      // The ADD must be guarded inside a conditional (DO block) — a blind
      // unconditional ADD would fail on environments that already have it.
      const addIdx = sql.search(/ADD\s+CONSTRAINT/i);
      expect(addIdx).toBeGreaterThan(-1);
      expect(sql.slice(0, addIdx)).toMatch(/IF\s+v_existing_count\s*=\s*0\s+THEN/i);
    });
  },
);
