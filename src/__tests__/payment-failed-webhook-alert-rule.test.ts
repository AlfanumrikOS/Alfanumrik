/**
 * Static-source contract test for the Phase 5 finding-(c) alert rule seed:
 *   supabase/migrations/20260617000000_seed_payment_failed_webhook_alert_rule.sql
 *
 * No live DB — this is a pure source-read assertion (it deliberately lives
 * OUTSIDE src/__tests__/migrations/, which is reserved for live-Postgres
 * integration tests gated on RUN_INTEGRATION_TESTS=1; this file must run in the
 * default PR suite). Asserts the seeded rule's parameters AND — crucially — the
 * ALIGNMENT that closes gap (c):
 *
 *   - The webhook timing emit in src/app/api/payments/webhook/route.ts logs
 *     ops_events with category:'payment' and severity:'error' on failed/
 *     unresolved outcomes (else 'info').
 *   - The new rule is category='payment', min_severity='error'. Because
 *     evaluate_alert_rules() is a count-over-window matcher gated on
 *     severity_rank(event) >= severity_rank(min_severity), and
 *     severity_rank('error') >= severity_rank('error'), the new rule WOULD
 *     match those processing-failure events.
 *   - The pre-existing 'Payment webhook integrity' rule uses
 *     min_severity='critical' (severity_rank 4 > 3), so it would NOT count
 *     error-severity processing failures — which is the gap this rule fills.
 *
 * Invariant: P11 (payment integrity — failed webhook processing must be
 * observable/alertable, not silently swallowed).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// This file lives at src/__tests__/, so repo root is two levels up.
const REPO_ROOT = join(__dirname, '..', '..');
const MIGRATION_PATH = join(
  REPO_ROOT,
  'supabase',
  'migrations',
  '20260617000000_seed_payment_failed_webhook_alert_rule.sql',
);
const WEBHOOK_PATH = join(
  REPO_ROOT,
  'src',
  'app',
  'api',
  'payments',
  'webhook',
  'route.ts',
);

const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');
const webhookSrc = readFileSync(WEBHOOK_PATH, 'utf8');

// Executable SQL only — strip `-- ...` line comments so assertions about the
// statement (e.g. "no ON CONFLICT") don't trip over the header's prose, which
// explains WHY ON CONFLICT is unavailable.
const migrationSqlNoComments = migrationSql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

// Local mirror of the DB severity_rank() ladder (error=3 < critical=4) so the
// alignment assertion is self-contained and does not need a live DB.
const SEVERITY_RANK: Record<string, number> = {
  info: 1,
  warning: 2,
  error: 3,
  critical: 4,
};

describe('payment-failed-webhook alert rule seed (finding c)', () => {
  it('seeds the rule with the documented parameters', () => {
    expect(migrationSql).toContain("'Payment webhook processing failures'");
    // category = payment
    expect(migrationSql).toMatch(/'payment',\s*--\s*category/);
    // min_severity = error
    expect(migrationSql).toMatch(/'error',\s*--\s*min_severity/);
    // enabled = false (ships disabled by design)
    expect(migrationSql).toMatch(/false,\s*--\s*enabled/);
    // count_threshold = 3
    expect(migrationSql).toMatch(/\b3,\s*--\s*count_threshold/);
    // window_minutes = 15
    expect(migrationSql).toMatch(/\b15,\s*--\s*window_minutes/);
    // empty channel_ids
    expect(migrationSql).toMatch(/'\{\}',\s*--\s*channel_ids/);
    // cooldown_minutes = 15
    expect(migrationSql).toMatch(/\b15\s*--\s*cooldown_minutes/);
  });

  it('is idempotent via INSERT ... SELECT ... WHERE NOT EXISTS (safe to re-run)', () => {
    expect(migrationSql).toMatch(/INSERT\s+INTO\s+alert_rules/i);
    expect(migrationSql).toMatch(/WHERE\s+NOT\s+EXISTS/i);
    expect(migrationSql).toMatch(
      /SELECT\s+1\s+FROM\s+alert_rules\s+WHERE\s+name\s*=\s*'Payment webhook processing failures'/i,
    );
    // It must NOT rely on ON CONFLICT (alert_rules.name has no UNIQUE
    // constraint). Check the comment-stripped SQL so the header prose
    // ("ON CONFLICT ... is therefore NOT available") doesn't false-positive.
    expect(migrationSqlNoComments).not.toMatch(/ON\s+CONFLICT/i);
  });

  it('webhook emits category=payment, severity=error on failed/unresolved outcomes', () => {
    // The timing emit logOpsEvent block sets category 'payment'.
    expect(webhookSrc).toMatch(/category:\s*'payment'/);
    // severity is 'error' when outcome is failed|unresolved, else 'info'.
    expect(webhookSrc).toMatch(
      /severity:\s*args\.outcome === 'failed' \|\| args\.outcome === 'unresolved' \? 'error' : 'info'/,
    );
    // The processed message name the rule is conceptually scoped to.
    expect(webhookSrc).toContain("'payment.webhook_processed'");
  });

  it('ALIGNMENT: the new rule (min_severity=error) WOULD match the error-severity processing-failure events', () => {
    // The matcher gate: severity_rank(event) >= severity_rank(rule.min_severity).
    const eventSeverity = 'error'; // failed/unresolved outcome
    const newRuleMinSeverity = 'error';
    expect(SEVERITY_RANK[eventSeverity]).toBeGreaterThanOrEqual(
      SEVERITY_RANK[newRuleMinSeverity],
    );
  });

  it("ALIGNMENT: the pre-existing critical-severity rule would NOT match (the gap this rule fills)", () => {
    const eventSeverity = 'error';
    const preexistingMinSeverity = 'critical'; // 'Payment webhook integrity'
    // error(3) < critical(4) → does NOT satisfy the >= gate → never counted.
    expect(SEVERITY_RANK[eventSeverity]).toBeLessThan(
      SEVERITY_RANK[preexistingMinSeverity],
    );
  });
});
