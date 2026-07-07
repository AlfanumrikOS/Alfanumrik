import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * SQL assertion tests for the alerting migration (Cut 1b).
 *
 * Requires a running local Supabase instance with the 1b migration applied.
 * Gracefully skips when SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY are not set,
 * which is the normal case in CI (no local Supabase).
 *
 * Run manually:
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<key> npx vitest run src/__tests__/observability-migration-1b.test.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const shouldRun = Boolean(SUPABASE_URL && SERVICE_KEY);
const describeIfSupabase = shouldRun ? describe : describe.skip;

describeIfSupabase('alerting migration (Cut 1b)', () => {
  // Lazily initialized in beforeAll to avoid createClient throwing when env vars are absent
  // (describe.skip still evaluates the callback body at module load)
  let sb: SupabaseClient;
  let testChannelId: string;
  let testRuleId: string;
  let critRuleId: string | null = null;

  beforeAll(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    sb = createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } });

    // Clean up any prior test data
    await sb.from('alert_dispatches').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await sb.from('alert_rules').delete().eq('name', 'test-rule-1b');
    await sb.from('alert_rules').delete().eq('name', 'crit-test-1b');
    await sb.from('notification_channels').delete().eq('name', 'test-channel-1b');
    await sb.from('ops_events').delete().eq('source', 'migration-test-1b');

    // Create test channel
    const { data: ch, error: chErr } = await sb.from('notification_channels')
      .insert({ name: 'test-channel-1b', type: 'slack_webhook', config: { webhook_url: 'https://test.invalid' } })
      .select().single();
    if (chErr) throw new Error(`Failed to create test channel: ${chErr.message}`);
    testChannelId = ch!.id;

    // Create test rule (threshold=2, window=60min, cooldown=1min)
    const { data: rule, error: ruleErr } = await sb.from('alert_rules')
      .insert({
        name: 'test-rule-1b', min_severity: 'error', count_threshold: 2,
        window_minutes: 60, channel_ids: [testChannelId], cooldown_minutes: 1, enabled: true,
      })
      .select().single();
    if (ruleErr) throw new Error(`Failed to create test rule: ${ruleErr.message}`);
    testRuleId = rule!.id;
  });

  afterAll(async () => {
    if (!sb) return;
    // Clean up in dependency order
    if (critRuleId) {
      await sb.from('alert_dispatches').delete().eq('rule_id', critRuleId);
      await sb.from('alert_rules').delete().eq('id', critRuleId);
    }
    await sb.from('alert_dispatches').delete().eq('rule_id', testRuleId);
    await sb.from('alert_rules').delete().eq('id', testRuleId);
    await sb.from('notification_channels').delete().eq('id', testChannelId);
    await sb.from('ops_events').delete().eq('source', 'migration-test-1b');
  });

  it('severity_rank returns correct ordinals', async () => {
    // severity_rank(sev text) -> int
    const results: Record<string, number> = {};
    for (const sev of ['info', 'warning', 'error', 'critical']) {
      const { data } = await sb.rpc('severity_rank', { sev });
      results[sev] = data;
    }
    expect(results.info).toBe(1);
    expect(results.warning).toBe(2);
    expect(results.error).toBe(3);
    expect(results.critical).toBe(4);
  });

  it('evaluate_alert_rules does NOT fire when threshold is not met', async () => {
    // Insert only 1 event (threshold is 2)
    await sb.from('ops_events').insert({
      occurred_at: new Date().toISOString(),
      category: 'ai', source: 'migration-test-1b', severity: 'error',
      message: 'test event 1', environment: 'development',
    });

    const { data: fires } = await sb.rpc('evaluate_alert_rules');
    expect(fires).toBe(0);
  });

  it('evaluate_alert_rules FIRES when threshold is met', async () => {
    // Insert a second event to meet threshold of 2
    await sb.from('ops_events').insert({
      occurred_at: new Date().toISOString(),
      category: 'ai', source: 'migration-test-1b', severity: 'error',
      message: 'test event 2', environment: 'development',
    });

    const { data: fires } = await sb.rpc('evaluate_alert_rules');
    expect(fires).toBeGreaterThanOrEqual(1);

    // Verify a pending dispatch was created for our test rule
    const { data: dispatches } = await sb.from('alert_dispatches')
      .select('status, rule_id')
      .eq('rule_id', testRuleId)
      .eq('status', 'pending');
    expect(dispatches!.length).toBeGreaterThanOrEqual(1);
  });

  it('evaluate_alert_rules respects cooldown', async () => {
    // Re-evaluate immediately — cooldown should prevent new dispatches
    const { data: fires } = await sb.rpc('evaluate_alert_rules');
    expect(fires).toBe(0);
  });

  it('critical-event trigger fires for severity=critical', async () => {
    // Clean prior dispatches for the test rule
    await sb.from('alert_dispatches').delete().eq('rule_id', testRuleId);

    // Create a critical-matching rule (threshold=1, category=payment)
    const { data: critRule, error: critErr } = await sb.from('alert_rules')
      .insert({
        name: 'crit-test-1b', min_severity: 'critical', count_threshold: 1,
        window_minutes: 5, channel_ids: [testChannelId], cooldown_minutes: 1,
        enabled: true, category: 'payment',
      })
      .select().single();
    if (critErr) throw new Error(`Failed to create critical rule: ${critErr.message}`);
    critRuleId = critRule!.id;

    // Insert a critical payment event — the on-insert trigger should fire
    await sb.from('ops_events').insert({
      occurred_at: new Date().toISOString(),
      category: 'payment', source: 'migration-test-1b', severity: 'critical',
      message: 'trigger test event', environment: 'development',
    });

    // The trigger should have created a pending dispatch for the critical rule
    const { data: dispatches } = await sb.from('alert_dispatches')
      .select('status, rule_id')
      .eq('rule_id', critRuleId!)
      .eq('status', 'pending');
    expect(dispatches!.length).toBeGreaterThanOrEqual(1);
  });
});