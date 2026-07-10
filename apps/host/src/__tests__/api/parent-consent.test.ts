/**
 * /api/parent/consent — Phase D.1 contract tests.
 *
 * Pins the XC-3 route-level service-role drain: guardian resolution,
 * ownership, DPDP consent writes, state events, and audit rows live behind
 * auth.uid()-anchored RPCs. The route keeps session/body validation and
 * response mapping only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { mockAuthGetUser, mockRpc } = vi.hoisted(() => ({
  mockAuthGetUser: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: (...a: unknown[]) => mockAuthGetUser(...a) },
    rpc: (...a: unknown[]) => mockRpc(...a),
  }),
}));

import { POST, DELETE, GET } from '@/app/api/parent/consent/route';

const G1_AUTH = '00000000-aaaa-4000-8000-000000000001';
const S1_ID = '33333333-3333-4333-8333-333333333333';
const S2_ID = '44444444-4444-4444-8444-444444444444';
const MIGRATION = path.resolve(
  process.cwd(),
  '..',
  '..',
  'supabase/migrations/20260710180000_xc3_parent_consent_rpcs.sql',
);

function authedAs(authUserId: string | null) {
  if (authUserId === null) {
    mockAuthGetUser.mockResolvedValue({ data: { user: null }, error: null });
  } else {
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: authUserId } }, error: null });
  }
}

function makePost(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/parent/consent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function makeDelete(body: unknown): Request {
  return new Request('http://localhost/api/parent/consent', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeGet(): Request {
  return new Request('http://localhost/api/parent/consent', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  authedAs(G1_AUTH);
  mockRpc.mockResolvedValue({ data: { success: true, consent_id: 'c-1', consent_version: 'v1-2026-05' }, error: null });
});

describe('parent consent XC-3 route boundary', () => {
  it('does not import the route-level service-role client', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/api/parent/consent/route.ts'),
      'utf8',
    );
    expect(source).not.toContain('@alfanumrik/lib/supabase-admin');
  });

  it('defines authenticated RPCs with auth.uid() and no anon execute grant', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.parent_record_consent/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.parent_revoke_consent/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.parent_list_active_consents/i);
    expect(sql).toMatch(/auth\.uid\(\)/i);
    expect(sql).toMatch(/INSERT INTO public\.state_events/i);
    expect(sql).toMatch(/INSERT INTO public\.audit_logs/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.parent_record_consent/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.parent_record_consent.*FROM anon/i);
  });
});

describe('POST /api/parent/consent', () => {
  it('happy path calls parent_record_consent and returns consent id', async () => {
    const res = await POST(
      makePost({
        studentId: S1_ID,
        scopes: { curriculum_access: true, performance_data_sharing_with_teacher: true },
      }, { 'x-forwarded-for': '203.0.113.10', 'user-agent': 'vitest' }) as never,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      consentId: 'c-1',
      consentVersion: 'v1-2026-05',
    });
    expect(mockRpc).toHaveBeenCalledWith('parent_record_consent', expect.objectContaining({
      p_student_id: S1_ID,
      p_scopes: { curriculum_access: true, performance_data_sharing_with_teacher: true },
      p_ip_address: '203.0.113.10',
      p_user_agent: 'vitest',
    }));
  });

  it('returns 400 when curriculum_access scope is missing before RPC', async () => {
    const res = await POST(makePost({ studentId: S1_ID, scopes: { marketing_emails: true } }) as never);
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 403 when RPC rejects unlinked student', async () => {
    mockRpc.mockResolvedValue({ data: { success: false, error_code: 'not_linked', error: 'Not linked to that student' }, error: null });
    const res = await POST(makePost({ studentId: S2_ID, scopes: { curriculum_access: true } }) as never);
    expect(res.status).toBe(403);
  });

  it('returns 401 when no Supabase session', async () => {
    authedAs(null);
    const res = await POST(makePost({ studentId: S1_ID, scopes: { curriculum_access: true } }) as never);
    expect(res.status).toBe(401);
  });

  it('returns 403 when guardian profile is missing', async () => {
    mockRpc.mockResolvedValue({ data: { success: false, error_code: 'no_guardian', error: 'Guardian account not found' }, error: null });
    const res = await POST(makePost({ studentId: S1_ID, scopes: { curriculum_access: true } }) as never);
    expect(res.status).toBe(403);
  });

  it('returns 400 on invalid UUID studentId before RPC', async () => {
    const res = await POST(makePost({ studentId: 'not-a-uuid', scopes: { curriculum_access: true } }) as never);
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 409 on unique-active conflict', async () => {
    mockRpc.mockResolvedValue({ data: { success: false, error_code: 'conflict', error: 'Active consent already exists for this guardian/student pair' }, error: null });
    const res = await POST(makePost({ studentId: S1_ID, scopes: { curriculum_access: true } }) as never);
    expect(res.status).toBe(409);
  });

  it('strips unknown scope keys before RPC', async () => {
    const res = await POST(
      makePost({ studentId: S1_ID, scopes: { curriculum_access: true, hacker_scope: true } }) as never,
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('parent_record_consent', expect.objectContaining({
      p_scopes: { curriculum_access: true },
    }));
  });
});

describe('DELETE /api/parent/consent', () => {
  it('happy path calls parent_revoke_consent', async () => {
    const res = await DELETE(makeDelete({ studentId: S1_ID }) as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, consentId: 'c-1' });
    expect(mockRpc).toHaveBeenCalledWith('parent_revoke_consent', expect.objectContaining({
      p_student_id: S1_ID,
    }));
  });

  it('returns 404 when there is no active row to revoke', async () => {
    mockRpc.mockResolvedValue({ data: { success: false, error_code: 'not_found', error: 'No active consent to revoke' }, error: null });
    const res = await DELETE(makeDelete({ studentId: S1_ID }) as never);
    expect(res.status).toBe(404);
  });

  it('returns 403 when guardian is not linked to studentId', async () => {
    mockRpc.mockResolvedValue({ data: { success: false, error_code: 'not_linked', error: 'Not linked to that student' }, error: null });
    const res = await DELETE(makeDelete({ studentId: S2_ID }) as never);
    expect(res.status).toBe(403);
  });

  it('returns 401 when no Supabase session', async () => {
    authedAs(null);
    const res = await DELETE(makeDelete({ studentId: S1_ID }) as never);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/parent/consent', () => {
  it('returns the caller active consents and current version', async () => {
    mockRpc.mockResolvedValue({
      data: {
        success: true,
        items: [{ id: 'c-1', studentId: S1_ID, consentVersion: 'v1-2026-05' }],
      },
      error: null,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.items).toHaveLength(1);
    expect(json.items[0].studentId).toBe(S1_ID);
    expect(typeof json.currentVersion).toBe('string');
    expect(mockRpc).toHaveBeenCalledWith('parent_list_active_consents');
  });

  it('returns 401 when unauthenticated', async () => {
    authedAs(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns an empty list when caller has no consents', async () => {
    mockRpc.mockResolvedValue({ data: { success: true, items: [] }, error: null });
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, items: [] });
  });
});
