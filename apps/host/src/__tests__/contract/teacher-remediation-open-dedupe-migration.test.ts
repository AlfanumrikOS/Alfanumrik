import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const MIGRATION = '20260712043958_teacher_remediation_open_status_dedupe.sql';
const sql = readFileSync(resolve(REPO_ROOT, 'supabase', 'migrations', MIGRATION), 'utf8');
const executableSql = sql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

describe('teacher remediation open-status dedupe migration', () => {
  it('locks cleanup and index replacement in one transaction', () => {
    expect(executableSql).toMatch(/BEGIN\s*;/i);
    expect(executableSql).toMatch(
      /LOCK TABLE public\.teacher_remediation_assignments IN SHARE ROW EXCLUSIVE MODE/i,
    );
    expect(executableSql).toMatch(/COMMIT\s*;/i);
  });

  it('deduplicates both open statuses without deleting audit rows', () => {
    expect(executableSql).toMatch(/WHERE status IN \('assigned', 'in_progress'\)/i);
    expect(executableSql).toMatch(
      /ORDER BY CASE status WHEN 'in_progress' THEN 0 ELSE 1 END[\s\S]*created_at ASC[\s\S]*id ASC/i,
    );
    expect(executableSql).toMatch(/SET status\s*=\s*'dismissed'[\s\S]*resolved_at\s*=\s*now\(\)/i);
    expect(executableSql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('atomically replaces the assigned-only index with an all-open unique index', () => {
    expect(executableSql).toMatch(
      /DROP INDEX IF EXISTS public\.uq_teacher_remediation_assignments_open_dedupe/i,
    );
    expect(executableSql).toMatch(
      /CREATE UNIQUE INDEX uq_teacher_remediation_assignments_open_dedupe[\s\S]*student_id[\s\S]*class_id[\s\S]*COALESCE\(chapter_id,[\s\S]*WHERE status IN \('assigned', 'in_progress'\)/i,
    );
  });
});
