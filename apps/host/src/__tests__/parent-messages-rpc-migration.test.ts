import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROUTES = [
  'src/app/api/parent/messages/route.ts',
  'src/app/api/parent/messages/threads/route.ts',
  'src/app/api/parent/messages/threads/[id]/messages/route.ts',
];

const MIGRATION = path.resolve(
  process.cwd(),
  '..',
  '..',
  'supabase/migrations/20260710190000_xc3_parent_messages_rpcs.sql',
);

describe('XC-3 parent messages RPC migration', () => {
  it('removes route-level service-role imports from parent messaging routes', () => {
    for (const route of ROUTES) {
      const source = fs.readFileSync(path.resolve(process.cwd(), route), 'utf8');
      expect(source).not.toContain('@alfanumrik/lib/supabase-admin');
      expect(source).toContain('@alfanumrik/lib/supabase-server');
    }
  });

  it('defines authenticated auth.uid()-anchored messaging RPCs', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    for (const name of [
      'parent_send_teacher_message',
      'parent_list_message_threads',
      'parent_list_thread_messages',
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}`, 'i'));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}`, 'i'));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}.*FROM anon`, 'i'));
    }
    expect(sql).toMatch(/auth\.uid\(\)/i);
    expect(sql).toMatch(/INSERT INTO public\.state_events/i);
    expect(sql).toMatch(/INSERT INTO public\.notifications/i);
  });
});
