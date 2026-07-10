import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260710020000_xc3_teacher_join_class_rpc.sql',
);

describe('XC-3 teacher join-class RPC migration', () => {
  it('defines a scoped authenticated RPC instead of relying on route service-role writes', () => {
    expect(existsSync(migrationPath), 'missing teacher join-class RPC migration').toBe(true);

    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.teacher_join_class_by_code');
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(sql).toMatch(/auth\.uid\(\)/i);
    expect(sql).toMatch(/FROM\s+public\.teachers[\s\S]*auth_user_id\s*=\s*auth\.uid\(\)/i);
    expect(sql).toMatch(/FROM\s+public\.classes[\s\S]*class_code\s*=[\s\S]*p_class_code/i);
    expect(sql).toMatch(/is_active\s*=\s*true/i);
    expect(sql).toMatch(/deleted_at\s+IS\s+NULL/i);
    expect(sql).toContain('ON CONFLICT (class_id, teacher_id) DO NOTHING');
    expect(sql).toMatch(/UPDATE\s+public\.teachers[\s\S]*school_id\s*=\s*v_class\.school_id/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.teacher_join_class_by_code/i);
    expect(sql).toMatch(/FROM\s+anon/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.teacher_join_class_by_code/i);
    expect(sql).toMatch(/TO\s+authenticated/i);
  });
});
