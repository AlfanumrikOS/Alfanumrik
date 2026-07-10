import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260710140000_xc3_parent_notifications_rpcs.sql',
);

describe('XC-3 parent notifications scoped RPC migration', () => {
  it('defines authenticated parent notification helpers with guardian-owned scope', () => {
    expect(existsSync(migrationPath), 'missing parent notifications scoped RPC migration').toBe(true);

    const sql = readFileSync(migrationPath, 'utf8');
    const functionNames = [
      'parent_list_notifications',
      'parent_mark_notification_read',
      'parent_mark_all_notifications_read',
    ];

    for (const name of functionNames) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${name}`);
      expect(sql).toMatch(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${name}`, 'i'));
      expect(sql).toMatch(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${name}`, 'i'));
    }

    expect(sql).toMatch(/SECURITY\s+DEFINER/gi);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/gi);
    expect(sql).toMatch(/auth\.uid\(\)/i);
    expect(sql).toMatch(/FROM\s+public\.guardians[\s\S]*auth_user_id\s*=\s*auth\.uid\(\)/i);
    expect(sql).toMatch(/FROM\s+public\.notifications/i);
    expect(sql).toMatch(/UPDATE\s+public\.notifications/i);
    expect(sql).toMatch(/recipient_id\s*=\s*v_guardian_id/i);
    expect(sql).toMatch(/recipient_type\s*=\s*'guardian'/i);
    expect(sql).toMatch(/FROM\s+anon/i);
    expect(sql).toMatch(/TO\s+authenticated/i);
  });
});
