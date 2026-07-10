import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260710130000_xc3_parent_profile_update_rpc.sql',
);

describe('XC-3 parent profile scoped RPC migration', () => {
  it('defines an authenticated own-profile update helper and routes PATCH through it', () => {
    expect(existsSync(migrationPath), 'missing parent profile scoped RPC migration').toBe(true);

    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.parent_update_own_profile');
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(sql).toMatch(/auth\.uid\(\)/i);
    expect(sql).toMatch(/FROM\s+public\.guardians[\s\S]*auth_user_id\s*=\s*auth\.uid\(\)/i);
    expect(sql).toMatch(/UPDATE\s+public\.guardians/i);
    expect(sql).toMatch(/WHERE\s+id\s*=\s*v_guardian\.id/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.parent_update_own_profile/i);
    expect(sql).toMatch(/FROM\s+anon/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.parent_update_own_profile/i);
    expect(sql).toMatch(/TO\s+authenticated/i);

    const route = readFileSync(
      path.join(repoRoot, 'apps/host/src/app/api/parent/profile/route.ts'),
      'utf8',
    );
    expect(route).toContain("rpc('parent_update_own_profile'");
    expect(route).not.toContain('@alfanumrik/lib/supabase-admin');
  });
});
