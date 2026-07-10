import { describe, expect, it } from 'vitest';
import {
  buildMobileLegacyTrafficSql,
  compareMobileLegacyTrafficRows,
  normalizeMobileLegacyTrafficRows,
  type LegacyApiInventory,
  type MobileLegacyTrafficRow,
} from '../../../../scripts/verify-mobile-legacy-traffic-live';

const inventory: LegacyApiInventory = {
  entries: [
    {
      id: 'RCA-22-001',
      surface: 'rpc',
      name: 'submit_quiz_results',
      owner: 'assessment-backend',
      risk: 'legacy quiz submit',
      status: 'active_compat',
      deprecationCondition: 'no active clients observed',
      plannedAction: 'revoke after cutover',
      evidence: ['apps/host/src/app/api/quiz/submit/route.ts'],
    },
    {
      id: 'RCA-22-004',
      surface: 'client_direct_rpc',
      name: 'client_direct_submit_quiz_results_v2',
      owner: 'assessment-frontend-mobile',
      risk: 'direct client submit',
      status: 'cutover_pending',
      deprecationCondition: 'mobile uses /v2/quiz/submit',
      plannedAction: 'repoint clients',
      evidence: ['apps/host/src/app/api/v2/quiz/submit/route.ts'],
    },
  ],
};

describe('RCA-04/RCA-22/RCA-25 mobile legacy traffic verifier', () => {
  it('passes when mobile traffic only hits canonical quiz and payment routes', () => {
    const rows: MobileLegacyTrafficRow[] = [
      { path: '/api/v2/quiz/submit', client: 'android', request_count: 42 },
      { path: '/api/payments/create-order', client: 'android', request_count: 8 },
      { path: '/api/payments/verify', client: 'android', request_count: 8 },
    ];

    const result = compareMobileLegacyTrafficRows(inventory, rows);

    expect(result.ok).toBe(true);
    expect(result.checkedRows).toBe(3);
    expect(result.failures).toEqual([]);
  });

  it('fails when mobile traffic still hits legacy quiz RPC or old payment surfaces', () => {
    const rows: MobileLegacyTrafficRow[] = [
      {
        path: '/rest/v1/rpc/submit_quiz_results',
        rpc: 'submit_quiz_results',
        client: 'ios',
        request_count: 3,
        last_seen_at: '2026-07-09T08:00:00.000Z',
      },
      {
        path: '/api/payments/subscribe',
        client: 'android',
        request_count: 1,
        last_seen_at: '2026-07-09T08:05:00.000Z',
      },
    ];

    const result = compareMobileLegacyTrafficRows(inventory, rows);

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        category: 'quiz',
        client: 'ios',
        surface: 'submit_quiz_results',
        observedPath: '/rest/v1/rpc/submit_quiz_results',
        requestCount: 3,
        lastSeenAt: '2026-07-09T08:00:00.000Z',
        canonicalReplacement: '/api/v2/quiz/submit',
        reason: 'legacy quiz submit traffic is still present',
      },
      {
        category: 'payment',
        client: 'android',
        surface: '/api/payments/subscribe',
        observedPath: '/api/payments/subscribe',
        requestCount: 1,
        lastSeenAt: '2026-07-09T08:05:00.000Z',
        canonicalReplacement: '/api/payments/create-order + /api/payments/verify',
        reason: 'legacy payment traffic is still present',
      },
    ]);
  });

  it('prints a read-only telemetry export query for mobile release validation', () => {
    const sql = buildMobileLegacyTrafficSql(inventory);

    expect(sql).toContain('-- RCA-04/RCA-22/RCA-25 mobile legacy traffic export');
    expect(sql).toContain('api_request_logs');
    expect(sql).toContain('submit_quiz_results');
    expect(sql).toContain('/api/payments/subscribe');
    expect(sql).not.toMatch(/\b(update|insert|delete|drop|alter|truncate|create)\b/i);
  });

  it('normalizes Supabase CLI JSON wrappers before comparison', () => {
    const rows = normalizeMobileLegacyTrafficRows({
      rows: [{ path: '/api/v2/quiz/submit', client: 'android', request_count: 1 }],
    });

    expect(rows).toEqual([
      { path: '/api/v2/quiz/submit', client: 'android', request_count: 1 },
    ]);
  });
});
