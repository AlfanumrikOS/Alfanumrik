import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Audit remediation regression (2026-08-09): delete_student_account null-safe
 * ownership guard + PUBLIC/anon EXECUTE revocation.
 *
 * Pins the security posture introduced by
 * `supabase/migrations/20260814000003_delete_student_account_null_safe_owner_guard.sql`:
 *
 *   Critical: `public.delete_student_account(uuid)` is SECURITY DEFINER and
 *     carried the baseline default PUBLIC EXECUTE grant, so anon could invoke it
 *     over PostgREST. Its in-body guard
 *         `IF v_auth_uid IS NULL OR v_auth_uid != auth.uid()`
 *     FAILED OPEN for an anonymous caller (auth.uid() NULL → the `!=` inequality
 *     is SQL NULL → `FALSE OR NULL` is NULL → PL/pgSQL skips the THEN branch and
 *     proceeds to delete). The fix (a) REVOKEs ALL from PUBLIC + anon and
 *     re-grants authenticated + service_role, and (b) rewrites the guard to the
 *     NULL-safe house form
 *         `auth.uid() IS NOT NULL AND (v_auth_uid IS NULL OR v_auth_uid <> auth.uid())`.
 *
 * These are source-level structural checks (same pattern as
 * `answer-key-oracle-closure.test.ts`): we do NOT run Postgres from Vitest, but
 * the checks catch accidental reverts or regressions during refactors.
 */

const MIGRATION_FILE =
  'supabase/migrations/20260814000003_delete_student_account_null_safe_owner_guard.sql';

function resolveRepo(rel: string): string | null {
  for (const c of [path.resolve(process.cwd(), rel), path.resolve(process.cwd(), '..', rel)]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function readFile(rel: string): string {
  const resolved = resolveRepo(rel);
  if (!resolved) return '';
  return fs.readFileSync(resolved, 'utf-8');
}

/** Strip `--` comment lines so header comments quoting the OLD buggy guard
 *  cannot satisfy assertions about the ACTIVE ddl. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n');
}

const MIGRATION_PRESENT = resolveRepo(MIGRATION_FILE) !== null;

const CHILD_DELETE_TARGETS = [
  'question_responses',
  'cognitive_session_metrics',
  'bloom_progression',
  'learning_velocity',
  'knowledge_gaps',
  'quiz_responses',
  'quiz_sessions',
  'study_plan_tasks',
  'study_plans',
  'spaced_repetition_cards',
  'concept_mastery',
  'topic_mastery',
  'student_learning_profiles',
  'daily_activity',
  'chat_sessions',
  'notifications',
  'competition_participants',
  'student_simulation_progress',
  'class_students',
  'guardian_student_links',
];

describe.skipIf(!MIGRATION_PRESENT)(
  '20260814000003 delete_student_account null-safe owner guard',
  () => {
    const sql = readFile(MIGRATION_FILE);
    const active = stripComments(sql);

    it('migration exists', () => {
      expect(MIGRATION_PRESENT).toBe(true);
    });

    it('is transactional (BEGIN ... COMMIT)', () => {
      expect(sql).toMatch(/BEGIN;/);
      expect(sql).toMatch(/COMMIT;/);
    });

    describe('grant surface: PUBLIC + anon EXECUTE revoked', () => {
      it('REVOKEs EXECUTE/ALL on delete_student_account(uuid) FROM PUBLIC and anon', () => {
        expect(active).toMatch(
          /REVOKE\s+(ALL|EXECUTE)\s+ON\s+FUNCTION\s+public\.delete_student_account\(uuid\)\s+FROM\s+PUBLIC\s*,\s*anon/i,
        );
      });

      it('GRANTs EXECUTE to authenticated and service_role', () => {
        expect(active).toMatch(
          /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.delete_student_account\(uuid\)\s+TO\s+authenticated\s*,\s*service_role/i,
        );
      });
    });

    describe('in-body guard: NULL-safe ownership check', () => {
      it('contains the NULL-safe guard in the ACTIVE ddl', () => {
        expect(active).toMatch(
          /auth\.uid\(\)\s+IS\s+NOT\s+NULL\s+AND\s+\(\s*v_auth_uid\s+IS\s+NULL\s+OR\s+v_auth_uid\s+<>\s+auth\.uid\(\)\s*\)/i,
        );
      });

      it('regression witness: the old fail-open `!=` form is gone from executable SQL', () => {
        expect(active).not.toMatch(/v_auth_uid\s+!=\s+auth\.uid\(\)/i);
      });
    });

    describe('destructive body preserved (deletion coverage not dropped)', () => {
      for (const target of CHILD_DELETE_TARGETS) {
        it(`still DELETEs from ${target}`, () => {
          expect(active).toMatch(
            new RegExp(`DELETE\\s+FROM\\s+${target}\\s+WHERE`, 'i'),
          );
        });
      }

      it('still soft-deletes the students row', () => {
        expect(active).toMatch(
          /UPDATE\s+students\s+SET\s+deleted_at\s*=\s*now\(\)[\s\S]*account_status\s*=\s*'deleted'\s+WHERE\s+id\s*=\s*p_student_id/i,
        );
      });
    });
  },
);
