import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const recordCronJobHealth = vi.fn();

vi.mock('@alfanumrik/lib/cron-job-health', () => ({
  recordCronJobHealth: (...args: unknown[]) => recordCronJobHealth(...args),
}));

function makeRequest(secret?: string): NextRequest {
  return new NextRequest('http://localhost/api/internal/cron/job-health-smoke', {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  });
}

describe('/api/internal/cron/job-health-smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'cron-secret';
    process.env.NODE_ENV = 'test';
    delete process.env.VERCEL_ENV;
    delete process.env.ENABLE_CRON_JOB_HEALTH_SMOKE;
    recordCronJobHealth.mockResolvedValue(true);
  });

  it('fails closed before writing when the cron secret is missing or wrong', async () => {
    const { POST } = await import('@/app/api/internal/cron/job-health-smoke/route');

    const missing = await POST(makeRequest());
    const wrong = await POST(makeRequest('wrong-secret'));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(recordCronJobHealth).not.toHaveBeenCalled();
  });

  it('is disabled in production unless explicitly enabled', async () => {
    process.env.VERCEL_ENV = 'production';
    const { POST } = await import('@/app/api/internal/cron/job-health-smoke/route');

    const res = await POST(makeRequest('cron-secret'));

    expect(res.status).toBe(403);
    expect(recordCronJobHealth).not.toHaveBeenCalled();
  });

  it('records a smoke job-health event on localhost-style environments', async () => {
    const { POST } = await import('@/app/api/internal/cron/job-health-smoke/route');

    const res = await POST(makeRequest('cron-secret'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      metric: 'ops.cron.job_health_smoke.last_success_at',
      path: '/api/internal/cron/job-health-smoke',
    });
    expect(recordCronJobHealth).toHaveBeenCalledWith(expect.objectContaining({
      path: '/api/internal/cron/job-health-smoke',
      metric: 'ops.cron.job_health_smoke.last_success_at',
      source: 'cron/job-health-smoke',
      context: expect.objectContaining({ smoke: true }),
    }));
  });

  it('returns 500 when the job-health writer reports failure', async () => {
    recordCronJobHealth.mockResolvedValue(false);
    const { POST } = await import('@/app/api/internal/cron/job-health-smoke/route');

    const res = await POST(makeRequest('cron-secret'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ ok: false, error: 'job_health_write_failed' });
  });
});
