import { describe, expect, it } from 'vitest';
import {
  compareJobHealthRows,
  normalizeJobHealthRows,
  parseAlertThresholdMs,
  type JobHealthRegistry,
  type LiveJobMetricRow,
} from '../../../../scripts/verify-job-health-live';

const registry: JobHealthRegistry = {
  jobs: [
    {
      path: '/api/cron/daily-cron',
      owner: 'learning-platform',
      lastSuccessMetric: 'ops.cron.daily_cron.last_success_at',
      alertThreshold: 'no success for 26h',
    },
    {
      path: '/api/cron/payments-health',
      owner: 'payments',
      lastSuccessMetric: 'ops.cron.payments_health.last_success_at',
      alertThreshold: 'no success for 30m',
    },
  ],
};

describe('RCA-17 live job health verifier', () => {
  it('parses registry alert thresholds into milliseconds', () => {
    expect(parseAlertThresholdMs('no success for 26h')).toBe(26 * 60 * 60 * 1000);
    expect(parseAlertThresholdMs('no success for 90m')).toBe(90 * 60 * 1000);
  });

  it('passes when every live last-success metric is inside its alert threshold', () => {
    const now = new Date('2026-07-09T12:00:00.000Z');
    const rows: LiveJobMetricRow[] = [
      {
        metric: 'ops.cron.daily_cron.last_success_at',
        last_success_at: '2026-07-08T12:30:00.000Z',
      },
      {
        metric: 'ops.cron.payments_health.last_success_at',
        last_success_at: '2026-07-09T11:40:00.000Z',
      },
    ];

    const result = compareJobHealthRows(registry, rows, now);

    expect(result.ok).toBe(true);
    expect(result.checked).toBe(2);
    expect(result.failures).toEqual([]);
  });

  it('accepts Supabase CLI JSON exports wrapped in a rows property', () => {
    const rows = normalizeJobHealthRows({
      boundary: 'ignored',
      rows: [
        {
          metric: 'ops.cron.daily_cron.last_success_at',
          last_success_at: '2026-07-09T11:40:00.000Z',
        },
      ],
    });

    expect(rows).toEqual([
      {
        metric: 'ops.cron.daily_cron.last_success_at',
        last_success_at: '2026-07-09T11:40:00.000Z',
      },
    ]);
  });

  it('fails on missing, stale, or invalid live last-success metrics', () => {
    const now = new Date('2026-07-09T12:00:00.000Z');
    const rows: LiveJobMetricRow[] = [
      {
        metric: 'ops.cron.daily_cron.last_success_at',
        last_success_at: '2026-07-08T08:00:00.000Z',
      },
    ];

    const result = compareJobHealthRows(registry, rows, now);

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        path: '/api/cron/daily-cron',
        metric: 'ops.cron.daily_cron.last_success_at',
        reason: 'last success is 28.0h old, exceeding threshold no success for 26h',
      },
      {
        path: '/api/cron/payments-health',
        metric: 'ops.cron.payments_health.last_success_at',
        reason: 'missing live last-success metric',
      },
    ]);
  });
});
