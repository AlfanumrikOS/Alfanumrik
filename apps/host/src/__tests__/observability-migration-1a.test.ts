import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * SQL assertion tests for the ops_events migration (Cut 1a).
 *
 * Requires a running local Supabase instance with the migration applied.
 * Gracefully skips when SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY are not set,
 * which is the normal case in CI (no local Supabase).
 *
 * Run manually:
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<key> npx vitest run src/__tests__/observability-migration-1a.test.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const shouldRun = Boolean(SUPABASE_URL && SERVICE_KEY);
const describeIfSupabase = shouldRun ? describe : describe.skip;

describeIfSupabase('ops_events migration (Cut 1a)', () => {
  // Lazily initialized in beforeAll to avoid createClient throwing when env vars are absent
  // (describe.skip still evaluates the callback body at module load)
  let sb: SupabaseClient;

  beforeAll(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    sb = createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } });
    await sb.from('ops_events').delete().eq('source', 'migration-test');
  });

  afterAll(async () => {
    if (sb) {
      await sb.from('ops_events').delete().eq('source', 'migration-test');
    }
  });

  it('ops_events table exists and accepts service-role inserts', async () => {
    const { error } = await sb.from('ops_events').insert({
      occurred_at: new Date().toISOString(),
      category: 'health', source: 'migration-test', severity: 'info',
      message: 'schema check', environment: 'development',
    });
    expect(error).toBeNull();
  });

  it('rejects invalid severity via CHECK constraint', async () => {
    const { error } = await sb.from('ops_events').insert({
      occurred_at: new Date().toISOString(),
      category: 'health', source: 'migration-test', severity: 'bogus',
      message: 'should fail', environment: 'development',
    });
    expect(error).not.toBeNull();
  });

  it('v_ops_timeline returns ops_events rows', async () => {
    const { data, error } = await sb
      .from('v_ops_timeline')
      .select('category, source, severity, message')
      .eq('source', 'migration-test').limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('cleanup_ops_events never deletes error/critical rows', async () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60_000).toISOString();
    await sb.from('ops_events').insert([
      { occurred_at: old, category: 'health', source: 'migration-test', severity: 'error', message: 'ancient error', environment: 'development' },
      { occurred_at: old, category: 'health', source: 'migration-test', severity: 'critical', message: 'ancient critical', environment: 'development' },
    ]);
    await sb.rpc('cleanup_ops_events');
    const { data } = await sb.from('ops_events').select('severity, message')
      .eq('source', 'migration-test').in('severity', ['error', 'critical']);
    expect(data?.length).toBeGreaterThanOrEqual(2);
  });

  it('cleanup_ops_events deletes info rows older than 30 days', async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60_000).toISOString();
    await sb.from('ops_events').insert({
      occurred_at: old, category: 'health', source: 'migration-test', severity: 'info',
      message: 'old info', environment: 'development',
    });
    await sb.rpc('cleanup_ops_events');
    const { data } = await sb.from('ops_events').select('message')
      .eq('source', 'migration-test').eq('severity', 'info').eq('message', 'old info');
    expect(data?.length ?? 0).toBe(0);
  });

  it('cleanup_ops_events self-instruments with a cleanup-job event', async () => {
    await sb.rpc('cleanup_ops_events');
    const { data } = await sb.from('ops_events').select('source, category, severity')
      .eq('source', 'cleanup-job').order('occurred_at', { ascending: false }).limit(1);
    expect(data?.[0]?.source).toBe('cleanup-job');
  });
});