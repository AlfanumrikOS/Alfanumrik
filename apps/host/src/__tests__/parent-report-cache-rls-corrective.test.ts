import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260710030000_xc3_parent_report_cache_guardian_rls.sql',
);

describe('XC-3 parent report cache guardian RLS corrective migration', () => {
  it('replaces student-own cache policies with guardian-link policies for parent_weekly_reports', () => {
    expect(existsSync(migrationPath), 'missing parent report cache RLS corrective migration').toBe(true);

    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('parent_weekly_reports');
    expect(sql).toMatch(/DROP POLICY IF EXISTS "?parent_weekly_reports_own_select"?/i);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "?parent_weekly_reports_own_insert"?/i);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "?parent_weekly_reports_own_update"?/i);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "?parent_weekly_reports_guardian_select"?/i);
    expect(sql).toMatch(/FOR SELECT TO authenticated[\s\S]*is_guardian_of\s*\(\s*"?student_id"?\s*\)/i);
    expect(sql).toMatch(/FOR INSERT TO authenticated[\s\S]*WITH CHECK[\s\S]*is_guardian_of\s*\(\s*"?student_id"?\s*\)/i);
    expect(sql).toMatch(/FOR UPDATE TO authenticated[\s\S]*USING[\s\S]*is_guardian_of\s*\(\s*"?student_id"?\s*\)[\s\S]*WITH CHECK[\s\S]*is_guardian_of\s*\(\s*"?student_id"?\s*\)/i);
    expect(sql).toMatch(/TO service_role[\s\S]*USING\s*\(true\)\s+WITH CHECK\s*\(true\)/i);
  });
});
