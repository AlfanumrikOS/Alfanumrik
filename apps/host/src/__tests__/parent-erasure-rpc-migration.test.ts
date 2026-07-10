import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260710040000_xc3_parent_erasure_scoped_rpcs.sql',
);
const statusMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260710120000_xc3_parent_erasure_status_rpc.sql',
);

describe('XC-3 parent erasure scoped RPC migration', () => {
  it('defines authenticated request/cancel helpers with guardian ownership checks', () => {
    expect(existsSync(migrationPath), 'missing parent erasure scoped RPC migration').toBe(true);

    const sql = readFileSync(migrationPath, 'utf8');
    for (const fn of ['parent_request_child_erasure', 'parent_cancel_child_erasure']) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
      expect(sql).toMatch(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${fn}`, 'i'));
      expect(sql).toMatch(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fn}`, 'i'));
    }
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(sql).toMatch(/auth\.uid\(\)/i);
    expect(sql).toMatch(/FROM\s+public\.guardians[\s\S]*auth_user_id\s*=\s*auth\.uid\(\)/i);
    expect(sql).toMatch(/guardian_student_links[\s\S]*status\s+IN\s+\('approved',\s*'active'\)/i);
    expect(sql).toContain('data_erasure_requests');
    expect(sql).toMatch(/purge_at[\s\S]*interval\s+'7 days'/i);
    expect(sql).toMatch(/status\s*=\s*'pending'/i);
    expect(sql).toMatch(/UPDATE\s+public\.data_erasure_requests[\s\S]*status\s*=\s*'cancelled'/i);
    expect(sql).toMatch(/FROM\s+anon/i);
    expect(sql).toMatch(/TO\s+authenticated/i);
  });

  it('keeps request/cancel route publishing scoped to authenticated RPCs instead of service role', () => {
    const route = readFileSync(
      path.join(repoRoot, 'apps/host/src/app/api/parent/children/[student_id]/request-erasure/route.ts'),
      'utf8',
    );

    expect(route).toContain("rpc('parent_publish_child_state_event'");
    expect(route).not.toContain('publishEvent(supabaseAdmin');
    expect(route).not.toContain('@alfanumrik/lib/supabase-admin');
    expect(route).not.toContain('@alfanumrik/lib/state/events/publish');
  });

  it('defines an authenticated erasure-status helper and routes GET through it', () => {
    expect(existsSync(statusMigrationPath), 'missing parent erasure status scoped RPC migration').toBe(true);

    const sql = readFileSync(statusMigrationPath, 'utf8');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.parent_child_erasure_status');
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(sql).toMatch(/auth\.uid\(\)/i);
    expect(sql).toMatch(/FROM\s+public\.guardians[\s\S]*auth_user_id\s*=\s*auth\.uid\(\)/i);
    expect(sql).toMatch(/guardian_student_links[\s\S]*status\s+IN\s+\('approved',\s*'active'\)/i);
    expect(sql).toMatch(/FROM\s+public\.data_erasure_requests/i);
    expect(sql).toMatch(/ORDER\s+BY\s+der\.requested_at\s+DESC/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.parent_child_erasure_status/i);
    expect(sql).toMatch(/FROM\s+anon/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.parent_child_erasure_status/i);
    expect(sql).toMatch(/TO\s+authenticated/i);

    const route = readFileSync(
      path.join(repoRoot, 'apps/host/src/app/api/parent/children/[student_id]/erasure-status/route.ts'),
      'utf8',
    );
    expect(route).toContain("rpc('parent_child_erasure_status'");
    expect(route).not.toContain('@alfanumrik/lib/supabase-admin');
  });
});
