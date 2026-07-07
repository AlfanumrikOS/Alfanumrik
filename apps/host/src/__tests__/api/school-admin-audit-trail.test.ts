/**
 * Audit-trail behaviour for /api/school-admin/{modules,tenant-config} PUT.
 *
 * Pins:
 *   - Every successful PUT writes a school_audit_log row via
 *     `logSchoolAudit`.
 *   - Validation rejections (400) DO NOT write audit rows.
 *   - Auth denials (403) DO NOT write audit rows.
 *   - Audit metadata: modules logs is_enabled + config_keys; tenant-config
 *     logs the touched keys (not the values — sensitive copy isn't logged).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Auth + cache mocks ───────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...args: unknown[]) => _authorizeImpl(...args),
}));
function authedAs(schoolId: string, userId = 'user-1') {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    schoolId,
    userId,
    permissions: ['school.manage_modules', 'school.manage_settings'],
  });
}

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── logSchoolAudit spy — the contract under test ────────────────────
const logSchoolAuditSpy = vi.fn();
vi.mock('@alfanumrik/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('@alfanumrik/lib/audit')>('@alfanumrik/lib/audit');
  return {
    ...actual,
    logSchoolAudit: (...args: unknown[]) => logSchoolAuditSpy(...args),
  };
});

// ── Cache invalidation mocks (don't matter for these tests) ─────────
vi.mock('@alfanumrik/lib/modules/registry', async () => {
  const actual = await vi.importActual<typeof import('@alfanumrik/lib/modules/registry')>('@alfanumrik/lib/modules/registry');
  return {
    ...actual,
    invalidateTenantModulesCache: vi.fn(),
  };
});
vi.mock('@alfanumrik/lib/tenant-config', async () => {
  const actual = await vi.importActual<typeof import('@alfanumrik/lib/tenant-config')>('@alfanumrik/lib/tenant-config');
  return {
    ...actual,
    invalidateTenantConfigCache: vi.fn(),
  };
});

// ── Supabase chain ──────────────────────────────────────────────────
const tableResults: Record<string, unknown> = {};

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const result = () => tableResults[table] ?? { data: null, error: null };
      return {
        select: () => ({
          eq: () => Object.assign(
            Promise.resolve(result()),
            { maybeSingle: () => Promise.resolve(result()) },
          ),
        }),
        upsert: () => Object.assign(
          Promise.resolve(result()),
          {
            select: () => ({
              single: () => Promise.resolve(result()),
            }),
          },
        ),
      };
    },
  }),
}));

import { PUT as PutModules } from '@/app/api/school-admin/modules/route';
import { PUT as PutTenantConfig } from '@/app/api/school-admin/tenant-config/route';

beforeEach(() => {
  _authorizeImpl.mockReset();
  logSchoolAuditSpy.mockReset();
  for (const k of Object.keys(tableResults)) delete tableResults[k];
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('PUT /api/school-admin/modules — audit trail', () => {
  it('writes audit row on success with module.toggled action', async () => {
    authedAs('school-1', 'user-42');
    tableResults.tenant_modules = {
      data: { module_key: 'lms', is_enabled: false, config: {} },
      error: null,
    };

    await PutModules(makeRequest('/api/school-admin/modules', {
      moduleKey: 'lms',
      isEnabled: false,
    }));

    expect(logSchoolAuditSpy).toHaveBeenCalledTimes(1);
    expect(logSchoolAuditSpy).toHaveBeenCalledWith(expect.objectContaining({
      schoolId: 'school-1',
      actorId: 'user-42',
      action: 'module.toggled',
      resourceType: 'module',
      resourceId: 'lms',
      metadata: expect.objectContaining({ is_enabled: false }),
    }));
  });

  it('does NOT write audit on validation failure (400)', async () => {
    authedAs('school-1');
    const res = await PutModules(makeRequest('/api/school-admin/modules', {
      moduleKey: 'unknown',
      isEnabled: true,
    }));
    expect(res.status).toBe(400);
    expect(logSchoolAuditSpy).not.toHaveBeenCalled();
  });

  it('does NOT write audit on auth denial', async () => {
    const { NextResponse } = await import('next/server');
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false,
      errorResponse: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    });
    await PutModules(makeRequest('/api/school-admin/modules', {
      moduleKey: 'lms',
      isEnabled: true,
    }));
    expect(logSchoolAuditSpy).not.toHaveBeenCalled();
  });

  it('config_keys metadata reflects what the admin sent', async () => {
    authedAs('school-1');
    tableResults.tenant_modules = {
      data: { module_key: 'live_classes', is_enabled: true, config: { provider: 'meet' } },
      error: null,
    };
    await PutModules(makeRequest('/api/school-admin/modules', {
      moduleKey: 'live_classes',
      isEnabled: true,
      config: { provider: 'meet', max_attendees: 50 },
    }));
    const call = logSchoolAuditSpy.mock.calls[0][0];
    expect(call.metadata.config_keys).toEqual(['provider', 'max_attendees']);
  });
});

describe('PUT /api/school-admin/tenant-config — audit trail', () => {
  it('writes audit row on success with tenant_config.updated action', async () => {
    authedAs('school-2', 'user-99');
    tableResults.tenant_configs = { data: null, error: null };

    await PutTenantConfig(makeRequest('/api/school-admin/tenant-config', {
      entries: [
        { key: 'ai.personality', value: 'rigorous_coach' },
        { key: 'ai.tone', value: 'formal' },
      ],
    }));

    expect(logSchoolAuditSpy).toHaveBeenCalledTimes(1);
    const call = logSchoolAuditSpy.mock.calls[0][0];
    expect(call.schoolId).toBe('school-2');
    expect(call.actorId).toBe('user-99');
    expect(call.action).toBe('tenant_config.updated');
    expect(call.resourceType).toBe('tenant_config');
    expect(call.resourceId).toBe('ai.personality,ai.tone');
    expect(call.metadata.keys).toEqual(['ai.personality', 'ai.tone']);
    expect(call.metadata.count).toBe(2);
  });

  it('audit metadata records WHICH keys (not values) — sensitive copy never logged', async () => {
    authedAs('school-2');
    tableResults.tenant_configs = { data: null, error: null };
    await PutTenantConfig(makeRequest('/api/school-admin/tenant-config', {
      entries: [{ key: 'communication.from_email_name', value: 'SuperSecret Inc' }],
    }));
    const call = logSchoolAuditSpy.mock.calls[0][0];
    // Metadata MUST NOT contain the value 'SuperSecret Inc' — only the key.
    expect(JSON.stringify(call.metadata)).not.toContain('SuperSecret');
    expect(call.metadata.keys).toEqual(['communication.from_email_name']);
  });

  it('does NOT write audit on validation failure', async () => {
    authedAs('school-2');
    const res = await PutTenantConfig(makeRequest('/api/school-admin/tenant-config', {
      entries: [{ key: 'ai.personality', value: 'evil_villain' }], // not in enum
    }));
    expect(res.status).toBe(400);
    expect(logSchoolAuditSpy).not.toHaveBeenCalled();
  });
});
