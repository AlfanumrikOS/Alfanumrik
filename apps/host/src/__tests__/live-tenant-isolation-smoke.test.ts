import { describe, expect, it, vi } from 'vitest';
import {
  buildTenantIsolationSmokeChecks,
  evaluateSmokeResponse,
  runTenantIsolationSmokeChecks,
  type TenantIsolationSmokeCheck,
} from '../../../../scripts/verify-live-tenant-isolation-smoke';

describe('RCA-19/RCA-20 live tenant isolation smoke verifier', () => {
  it('builds the expected cross-tenant smoke cases from operator-provided fixture env', () => {
    const checks = buildTenantIsolationSmokeChecks({
      LIVE_TENANT_SMOKE_BASE_URL: 'https://staging.example.test/',
      LIVE_TENANT_SMOKE_PARENT_A_TOKEN: 'parent-token-a',
      LIVE_TENANT_SMOKE_TEACHER_A_TOKEN: 'teacher-token-a',
      LIVE_TENANT_SMOKE_SCHOOL_ADMIN_A_TOKEN: 'admin-token-a',
      LIVE_TENANT_SMOKE_STUDENT_B_ID: 'student-b',
      LIVE_TENANT_SMOKE_CLASS_B_ID: 'class-b',
      LIVE_TENANT_SMOKE_SCHOOL_B_ID: 'school-b',
    });

    expect(checks.map((check) => check.id)).toEqual([
      'parent-a-cannot-export-student-b',
      'parent-a-cannot-report-student-b',
      'teacher-a-cannot-read-class-b-pulse',
      'school-admin-a-cannot-filter-roster-to-school-b',
    ]);
    expect(checks[0]).toMatchObject({
      method: 'GET',
      url: 'https://staging.example.test/api/parent/children/student-b/export',
      token: 'parent-token-a',
      forbiddenMarkers: ['student-b', 'school-b'],
    });
  });

  it('reports missing fixture env without making network calls', () => {
    expect(() => buildTenantIsolationSmokeChecks({})).toThrow(
      /LIVE_TENANT_SMOKE_BASE_URL, LIVE_TENANT_SMOKE_PARENT_A_TOKEN/,
    );
  });

  it('treats 401/403/404 as safe denials and fails on leaked forbidden tenant markers', async () => {
    const denied = await evaluateSmokeResponse(
      {
        id: 'denied',
        route: '/api/example',
        method: 'GET',
        url: 'https://staging.example.test/api/example',
        token: 'token',
        forbiddenMarkers: ['student-b'],
      },
      new Response('Forbidden', { status: 403 }),
    );
    expect(denied).toMatchObject({ ok: true, status: 403, mode: 'denied' });

    const leaked = await evaluateSmokeResponse(
      {
        id: 'leaked',
        route: '/api/example',
        method: 'GET',
        url: 'https://staging.example.test/api/example',
        token: 'token',
        forbiddenMarkers: ['student-b'],
      },
      new Response(JSON.stringify({ id: 'student-b' }), { status: 200 }),
    );
    expect(leaked).toMatchObject({ ok: false, status: 200, mode: 'leaked_marker' });
  });

  it('runs every check with bearer auth, no cache, and read-only methods', async () => {
    const checks: TenantIsolationSmokeCheck[] = [
      {
        id: 'parent-a-cannot-export-student-b',
        route: '/api/parent/children/:studentId/export',
        method: 'GET',
        url: 'https://staging.example.test/api/parent/children/student-b/export',
        token: 'parent-token-a',
        forbiddenMarkers: ['student-b'],
      },
      {
        id: 'parent-a-cannot-report-student-b',
        route: '/api/parent/report',
        method: 'POST',
        url: 'https://staging.example.test/api/parent/report',
        token: 'parent-token-a',
        body: { student_id: 'student-b' },
        forbiddenMarkers: ['student-b'],
      },
    ];
    const fetchImpl = vi.fn(async () => new Response('Forbidden', { status: 403 }));

    const result = await runTenantIsolationSmokeChecks(checks, fetchImpl);

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://staging.example.test/api/parent/children/student-b/export',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        headers: expect.objectContaining({ Authorization: 'Bearer parent-token-a' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://staging.example.test/api/parent/report',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ student_id: 'student-b' }),
        headers: expect.objectContaining({
          Authorization: 'Bearer parent-token-a',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });
});
