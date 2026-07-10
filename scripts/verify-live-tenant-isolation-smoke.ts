#!/usr/bin/env -S npx tsx
/**
 * RCA-19/RCA-20 live tenant isolation smoke verifier.
 *
 * This script is intentionally read-only from the operator side: it uses seeded
 * role bearer tokens, never a service-role key, and only attempts cross-tenant
 * reads/report-generation requests that must be denied or sanitized by the app.
 *
 * Required fixture env:
 *   LIVE_TENANT_SMOKE_BASE_URL
 *   LIVE_TENANT_SMOKE_PARENT_A_TOKEN
 *   LIVE_TENANT_SMOKE_TEACHER_A_TOKEN
 *   LIVE_TENANT_SMOKE_SCHOOL_ADMIN_A_TOKEN
 *   LIVE_TENANT_SMOKE_STUDENT_B_ID
 *   LIVE_TENANT_SMOKE_CLASS_B_ID
 *   LIVE_TENANT_SMOKE_SCHOOL_B_ID
 */

export type TenantIsolationSmokeMethod = 'GET' | 'POST';

export interface TenantIsolationSmokeCheck {
  id: string;
  route: string;
  method: TenantIsolationSmokeMethod;
  url: string;
  token: string;
  body?: Record<string, unknown>;
  forbiddenMarkers: string[];
}

export interface TenantIsolationSmokeResult {
  id: string;
  route: string;
  ok: boolean;
  status: number;
  mode: 'denied' | 'sanitized' | 'leaked_marker' | 'unexpected_status' | 'network_error';
  detail: string;
}

export interface TenantIsolationSmokeSummary {
  ok: boolean;
  results: TenantIsolationSmokeResult[];
}

type EnvLike = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const REQUIRED_ENV = [
  'LIVE_TENANT_SMOKE_BASE_URL',
  'LIVE_TENANT_SMOKE_PARENT_A_TOKEN',
  'LIVE_TENANT_SMOKE_TEACHER_A_TOKEN',
  'LIVE_TENANT_SMOKE_SCHOOL_ADMIN_A_TOKEN',
  'LIVE_TENANT_SMOKE_STUDENT_B_ID',
  'LIVE_TENANT_SMOKE_CLASS_B_ID',
  'LIVE_TENANT_SMOKE_SCHOOL_B_ID',
] as const;

function requireEnv(env: EnvLike, key: (typeof REQUIRED_ENV)[number]): string {
  const value = env[key]?.trim();
  if (!value) {
    const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
    throw new Error(`Missing live tenant smoke fixture env: ${missing.join(', ')}`);
  }
  return value;
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function buildTenantIsolationSmokeChecks(env: EnvLike): TenantIsolationSmokeCheck[] {
  const baseUrl = requireEnv(env, 'LIVE_TENANT_SMOKE_BASE_URL');
  const parentAToken = requireEnv(env, 'LIVE_TENANT_SMOKE_PARENT_A_TOKEN');
  const teacherAToken = requireEnv(env, 'LIVE_TENANT_SMOKE_TEACHER_A_TOKEN');
  const schoolAdminAToken = requireEnv(env, 'LIVE_TENANT_SMOKE_SCHOOL_ADMIN_A_TOKEN');
  const studentBId = requireEnv(env, 'LIVE_TENANT_SMOKE_STUDENT_B_ID');
  const classBId = requireEnv(env, 'LIVE_TENANT_SMOKE_CLASS_B_ID');
  const schoolBId = requireEnv(env, 'LIVE_TENANT_SMOKE_SCHOOL_B_ID');

  return [
    {
      id: 'parent-a-cannot-export-student-b',
      route: '/api/parent/children/:studentId/export',
      method: 'GET',
      url: joinUrl(baseUrl, `/api/parent/children/${encodeURIComponent(studentBId)}/export`),
      token: parentAToken,
      forbiddenMarkers: [studentBId, schoolBId],
    },
    {
      id: 'parent-a-cannot-report-student-b',
      route: '/api/parent/report',
      method: 'POST',
      url: joinUrl(baseUrl, '/api/parent/report'),
      token: parentAToken,
      body: { student_id: studentBId },
      forbiddenMarkers: [studentBId, schoolBId],
    },
    {
      id: 'teacher-a-cannot-read-class-b-pulse',
      route: '/api/pulse/class/:classId',
      method: 'GET',
      url: joinUrl(baseUrl, `/api/pulse/class/${encodeURIComponent(classBId)}`),
      token: teacherAToken,
      forbiddenMarkers: [classBId, studentBId, schoolBId],
    },
    {
      id: 'school-admin-a-cannot-filter-roster-to-school-b',
      route: '/api/school-admin/students?school_id=:schoolBId',
      method: 'GET',
      url: joinUrl(baseUrl, `/api/school-admin/students?school_id=${encodeURIComponent(schoolBId)}`),
      token: schoolAdminAToken,
      forbiddenMarkers: [schoolBId, studentBId],
    },
  ];
}

export async function evaluateSmokeResponse(
  check: TenantIsolationSmokeCheck,
  response: Response,
): Promise<TenantIsolationSmokeResult> {
  const text = await response.text();

  if ([401, 403, 404].includes(response.status)) {
    return {
      id: check.id,
      route: check.route,
      ok: true,
      status: response.status,
      mode: 'denied',
      detail: `cross-tenant probe denied with ${response.status}`,
    };
  }

  const leaked = check.forbiddenMarkers.find((marker) => marker && text.includes(marker));
  if (leaked) {
    return {
      id: check.id,
      route: check.route,
      ok: false,
      status: response.status,
      mode: 'leaked_marker',
      detail: `response body contained forbidden marker: ${leaked}`,
    };
  }

  if (response.status >= 200 && response.status < 300) {
    return {
      id: check.id,
      route: check.route,
      ok: true,
      status: response.status,
      mode: 'sanitized',
      detail: 'response succeeded but contained none of the forbidden tenant markers',
    };
  }

  return {
    id: check.id,
    route: check.route,
    ok: false,
    status: response.status,
    mode: 'unexpected_status',
    detail: `unexpected status ${response.status}`,
  };
}

export async function runTenantIsolationSmokeChecks(
  checks: TenantIsolationSmokeCheck[],
  fetchImpl: FetchLike = fetch,
): Promise<TenantIsolationSmokeSummary> {
  const results: TenantIsolationSmokeResult[] = [];

  for (const check of checks) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${check.token}`,
      Accept: 'application/json',
    };
    if (check.body) headers['Content-Type'] = 'application/json';

    try {
      const response = await fetchImpl(check.url, {
        method: check.method,
        headers,
        body: check.body ? JSON.stringify(check.body) : undefined,
        cache: 'no-store',
      });
      results.push(await evaluateSmokeResponse(check, response));
    } catch (error) {
      results.push({
        id: check.id,
        route: check.route,
        ok: false,
        status: 0,
        mode: 'network_error',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ok: results.every((result) => result.ok), results };
}

function formatSummary(summary: TenantIsolationSmokeSummary): string {
  const lines = ['Live tenant isolation smoke', '===========================', ''];
  for (const result of summary.results) {
    lines.push(
      `${result.ok ? '[PASS]' : '[FAIL]'} ${result.id} (${result.route}) ` +
        `${result.status} ${result.mode} - ${result.detail}`,
    );
  }
  lines.push('', `Summary: ${summary.results.filter((result) => result.ok).length}/${summary.results.length} checks passed.`);
  return lines.join('\n');
}

async function main(): Promise<void> {
  const checks = buildTenantIsolationSmokeChecks(process.env);
  const summary = await runTenantIsolationSmokeChecks(checks);
  // eslint-disable-next-line no-console
  console.log(formatSummary(summary));
  process.exit(summary.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
