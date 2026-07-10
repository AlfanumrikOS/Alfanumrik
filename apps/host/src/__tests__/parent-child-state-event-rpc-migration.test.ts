import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260710080000_xc3_parent_child_state_event_rpc.sql',
);

describe('XC-3 parent child state-event scoped publisher migration', () => {
  it('defines an authenticated SECURITY DEFINER publisher guarded by guardian ownership', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.parent_publish_child_state_event');
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(sql).toContain('auth.uid()');
    expect(sql).toContain('guardian_student_links');
    expect(sql).toMatch(/status\s+IN\s+\('approved',\s*'active'\)/i);
    expect(sql).toContain('feature_flags');
    expect(sql).toContain('ff_event_bus_v1');
    expect(sql).toContain('state_events');
    expect(sql).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
    expect(sql).toMatch(/p_kind\s+NOT\s+IN\s+\([\s\S]*parent\.child_data_exported[\s\S]*parent\.child_erasure_requested[\s\S]*parent\.child_erasure_cancelled/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.parent_publish_child_state_event/i);
    expect(sql).toMatch(/FROM\s+anon/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.parent_publish_child_state_event/i);
    expect(sql).toMatch(/TO\s+authenticated/i);
  });
});
