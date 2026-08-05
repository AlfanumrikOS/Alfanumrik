/**
 * POST /api/telemetry/irt-shadow — write-only IRT shadow-divergence sink.
 *
 * Pins (Foxy North-Star Phase 3, backend E2):
 *   - auth: authorizeRequest('progress.view_own', { requireStudentId }) gate
 *   - zod: NaN / out-of-range / bad grade → 400, nothing written
 *   - flag: ff_irt_shadow_v1 re-checked SERVER-side; OFF → 204 + no write
 *   - sink: logSystemMetric('irt_shadow_divergence', value=spearmanRho,
 *     tags = UUIDs + numbers + short codes only — P13)
 *   - ALWAYS 204 after auth+validation, even when the sink fails
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const authorizeRequestMock = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => authorizeRequestMock(...(args as [])),
}));

const isFeatureEnabledMock = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => isFeatureEnabledMock(...(args as [])),
}));

const logSystemMetricMock = vi.fn(async () => undefined);
vi.mock('@alfanumrik/lib/monitoring/log-event', () => ({
  logSystemMetric: (...args: unknown[]) => logSystemMetricMock(...(args as [])),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/telemetry/irt-shadow/route';

const VALID_BODY = {
  theta: -0.4,
  nCandidates: 40,
  nCalibrated: 22,
  spearmanRho: 0.63,
  top5Overlap: 0.8,
  top10Overlap: 0.7,
  subject: 'math',
  grade: '9',
};

function mkReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/telemetry/irt-shadow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authorizeRequestMock.mockReset();
  authorizeRequestMock.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: '00000000-0000-0000-0000-0000000000aa',
  });
  isFeatureEnabledMock.mockReset();
  isFeatureEnabledMock.mockResolvedValue(true);
  logSystemMetricMock.mockClear();
  logSystemMetricMock.mockResolvedValue(undefined);
});

describe('POST /api/telemetry/irt-shadow', () => {
  it('returns the auth errorResponse when unauthorized (and writes nothing)', async () => {
    authorizeRequestMock.mockResolvedValue({
      authorized: false,
      errorResponse: new Response('{}', { status: 401 }),
    });
    const res = await POST(mkReq(VALID_BODY));
    expect(res.status).toBe(401);
    expect(logSystemMetricMock).not.toHaveBeenCalled();
  });

  it('rejects NaN theta with 400 (zod rejects non-finite numbers)', async () => {
    const res = await POST(mkReq({ ...VALID_BODY, theta: Number.NaN }));
    expect(res.status).toBe(400);
    expect(logSystemMetricMock).not.toHaveBeenCalled();
  });

  it.each([
    ['spearmanRho out of range', { spearmanRho: 1.5 }],
    ['theta out of range', { theta: 42 }],
    ['negative nCandidates', { nCandidates: -1 }],
    ['non-integer nCalibrated', { nCalibrated: 2.5 }],
    ['top5Overlap > 1', { top5Overlap: 1.2 }],
    ['integer grade (P5)', { grade: 9 }],
    ['grade outside 6-12', { grade: '5' }],
    ['empty subject', { subject: '' }],
  ])('rejects %s with 400', async (_label, patch) => {
    const res = await POST(mkReq({ ...VALID_BODY, ...patch }));
    expect(res.status).toBe(400);
    expect(logSystemMetricMock).not.toHaveBeenCalled();
  });

  it('flag OFF → 204 and NO write (server does not trust the client gate)', async () => {
    isFeatureEnabledMock.mockResolvedValue(false);
    const res = await POST(mkReq(VALID_BODY));
    expect(res.status).toBe(204);
    expect(logSystemMetricMock).not.toHaveBeenCalled();
    expect(isFeatureEnabledMock).toHaveBeenCalledWith(
      'ff_irt_shadow_v1',
      expect.objectContaining({ role: 'student' }),
    );
  });

  it('flag ON → 204 and logs irt_shadow_divergence with value=spearmanRho', async () => {
    const res = await POST(mkReq(VALID_BODY));
    expect(res.status).toBe(204);
    expect(logSystemMetricMock).toHaveBeenCalledOnce();
    const metric = logSystemMetricMock.mock.calls[0][0] as {
      metric_name: string; value: number; tags: Record<string, unknown>;
    };
    expect(metric.metric_name).toBe('irt_shadow_divergence');
    expect(metric.value).toBe(0.63);
    // P13: UUIDs + numbers + short codes only — exact key allowlist.
    expect(Object.keys(metric.tags).sort()).toEqual([
      'grade', 'nCalibrated', 'nCandidates', 'studentId',
      'subject', 'theta', 'top10Overlap', 'top5Overlap',
    ]);
    expect(metric.tags.studentId).toBe('00000000-0000-0000-0000-0000000000aa');
  });

  it('still 204 when the sink throws (telemetry never errors the client)', async () => {
    logSystemMetricMock.mockRejectedValue(new Error('db down'));
    const res = await POST(mkReq(VALID_BODY));
    expect(res.status).toBe(204);
  });

  it('still 204 (no write) when flag evaluation throws (fail-closed)', async () => {
    isFeatureEnabledMock.mockRejectedValue(new Error('flag store down'));
    const res = await POST(mkReq(VALID_BODY));
    expect(res.status).toBe(204);
    expect(logSystemMetricMock).not.toHaveBeenCalled();
  });
});
