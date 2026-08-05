import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * REG-363 — K5 Play draft quarantine (Foxy North-Star Phase 5).
 *
 * The `teacher_assignment_drafts` table is a PRIVATE teacher workspace for
 * oracle-validated question sets BEFORE publication. Because a draft can
 * hold oracle-flagged defects the teacher chose not to fix, exposing it to
 * students or parents would breach P6 (question quality) and P8 (RLS
 * boundary). This structural pin freezes the DELIBERATELY MINIMAL policy
 * count so a future "add a student can read their own assignments"
 * migration cannot silently open the quarantine.
 *
 * Static SQL-text pin (no live DB) — same pattern as
 * safeguarding-escalations-migration.test.ts (REG-348 companion).
 */

const migrationsDir = join(process.cwd(), '..', '..', 'supabase', 'migrations');
const sql = readFileSync(
  join(migrationsDir, '20260813000004_teacher_assignment_drafts.sql'),
  'utf8',
);

const activeDdl = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('migration 20260813000004 — teacher_assignment_drafts RLS quarantine', () => {
  it('creates the table idempotently and ENABLES RLS in the same migration (P8)', () => {
    expect(activeDdl).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.teacher_assignment_drafts/,
    );
    expect(activeDdl).toMatch(
      /ALTER TABLE public\.teacher_assignment_drafts ENABLE ROW LEVEL SECURITY/,
    );
  });

  it('has EXACTLY TWO policies: teacher_own_all + service_role_all — no student/parent policy', () => {
    const policies = activeDdl.match(/CREATE POLICY/g) ?? [];
    expect(policies).toHaveLength(2);
    expect(activeDdl).toMatch(
      /CREATE POLICY teacher_assignment_drafts_teacher_own_all[\s\S]*?FOR ALL/,
    );
    expect(activeDdl).toMatch(
      /CREATE POLICY teacher_assignment_drafts_service_role_all[\s\S]*?FOR ALL[\s\S]*?TO service_role/,
    );
  });

  it('grants NO authenticated/anon read path outside the teacher-own predicate', () => {
    // The only TO clause in active DDL should be service_role — teacher_own_all
    // is FOR ALL (no TO), scoped by USING(teacher_id -> auth.uid()).
    expect(activeDdl).not.toMatch(/TO authenticated/i);
    expect(activeDdl).not.toMatch(/TO anon/i);
    // No student/parent linkage predicates allowed anywhere in active DDL.
    expect(activeDdl).not.toMatch(/parent_student_links/i);
    expect(activeDdl).not.toMatch(/class_students/i);
    expect(activeDdl).not.toMatch(/student_id/i);
  });

  it('carries the deliberate-quarantine rationale comment so a future "fix" cannot claim ignorance', () => {
    expect(sql).toMatch(/DELIBERATE/i);
    expect(sql).toMatch(/NO student policy/);
    expect(sql).toMatch(/NO parent policy/);
    expect(sql).toMatch(/published_assignment_id/);
  });

  it('constrains status enum to draft/published/discarded and P5-guards grade as string', () => {
    expect(activeDdl).toMatch(
      /status IN \('draft', 'published', 'discarded'\)/,
    );
    // P5: grade is text with a bounded-length CHECK, not an integer column.
    expect(activeDdl).toMatch(/grade\s+text NULL CHECK/);
    expect(activeDdl).not.toMatch(/grade\s+integer/i);
    expect(activeDdl).not.toMatch(/grade\s+int\b/i);
  });

  it('is additive-only: no DROP TABLE/COLUMN, no DELETE, no RBAC UPDATE', () => {
    expect(activeDdl).not.toMatch(/DROP TABLE/i);
    expect(activeDdl).not.toMatch(/DROP COLUMN/i);
    expect(activeDdl).not.toMatch(/\bDELETE FROM\b/i);
    expect(activeDdl).not.toMatch(/UPDATE (permissions|roles|role_permissions)\b/i);
  });
});
