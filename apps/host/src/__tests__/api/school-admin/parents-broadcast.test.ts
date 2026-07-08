/**
 * /api/school-admin/parents (POST) — bulk parent broadcast contract (Phase 2).
 *
 * Phase 2 routed the EMAIL channel through the send-transactional-email Edge
 * Function (school-parent-broadcast template) and standardised the response to
 * { sent_count, failed_count, channel }. Pins:
 *
 *   1. REQUEST/RESPONSE CONTRACT — { message, target, channel } in →
 *      { success, data:{ sent_count, failed_count, channel } } out. Validation:
 *      missing message → 400; invalid target → 400; invalid channel → 400;
 *      grade target with a non-CBSE grade ('5') → 400 (P5).
 *   2. EMAIL CHANNEL — one send-transactional-email call per approved guardian
 *      WITH a valid email; sent_count counts only json.sent===true responses,
 *      failed_count counts the rest. The template is 'school-parent-broadcast'.
 *   3. AUTHZ — authorizeSchoolAdmin('school.manage_settings'); an unauthorized
 *      caller is rejected verbatim and NO email/audit fires.
 *   4. P13 — neither the logger nor the audit metadata carries a guardian email
 *      address or the message body; the audit records counts/channel/target only.
 *
 * Seams mocked: @alfanumrik/lib/school-admin-auth, @alfanumrik/lib/supabase-admin (getSupabaseAdmin),
 * @alfanumrik/lib/audit (logSchoolAudit), @alfanumrik/lib/logger, and global fetch (the Edge Function).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const SCHOOL = '11111111-1111-4111-a111-111111111111';

const holders = vi.hoisted(() => ({
  authorizeSchoolAdmin: vi.fn(),
  logSchoolAudit: vi.fn(),
  loggerCalls: [] as unknown[],
  // table → rows the in-memory client returns
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  // per-email fetch result: maps recipient email → { ok, sent }
  fetchResults: {} as Record<string, { ok: boolean; sent: boolean }>,
  fetchBodies: [] as Array<Record<string, unknown>>,
}));

vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => holders.authorizeSchoolAdmin(...a),
}));
vi.mock('@alfanumrik/lib/audit', () => ({
  logSchoolAudit: (...a: unknown[]) => holders.logSchoolAudit(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: (...a: unknown[]) => holders.loggerCalls.push(['info', ...a]),
    warn: (...a: unknown[]) => holders.loggerCalls.push(['warn', ...a]),
    error: (...a: unknown[]) => holders.loggerCalls.push(['error', ...a]),
    debug: vi.fn(),
  },
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  function chainFor(table: string) {
    const exec = () => Promise.resolve({ data: holders.tables[table] ?? [], error: null });
    const chain: Record<string, unknown> = {
      select() { return chain; },
      eq() { return chain; },
      in() { return chain; },
      insert() { return Promise.resolve({ error: null }); },
      maybeSingle() { return Promise.resolve({ data: (holders.tables[table] ?? [])[0] ?? null, error: null }); },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) { return exec().then(onF, onR); },
    };
    return chain;
  }
  return {
    getSupabaseAdmin: () => ({ from: (t: string) => chainFor(t) }),
    supabaseAdmin: { from: (t: string) => chainFor(t) },
  };
});

function postReq(body: unknown): import('next/server').NextRequest {
  return new Request('http://localhost/api/school-admin/parents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer fake.jwt' },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

function authOk() {
  holders.authorizeSchoolAdmin.mockResolvedValue({
    authorized: true, userId: 'admin-1', schoolId: SCHOOL, schoolAdminId: 'sa-1', schoolAdminRole: 'principal',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.tables = {};
  holders.fetchResults = {};
  holders.fetchBodies = [];
  holders.loggerCalls = [];
  holders.logSchoolAudit.mockResolvedValue(undefined);

  // Env the email channel needs.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';

  // global fetch → resolve per-recipient based on holders.fetchResults.
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    holders.fetchBodies.push(body);
    const to = body.to as string;
    const r = holders.fetchResults[to] ?? { ok: true, sent: true };
    return {
      ok: r.ok,
      json: async () => ({ sent: r.sent }),
    } as Response;
  }));
});

describe('POST /api/school-admin/parents — validation contract', () => {
  it('400 when message is missing', async () => {
    const { POST } = await import('@/app/api/school-admin/parents/route');
    authOk();
    const res = await POST(postReq({ target: 'all', channel: 'email' }));
    expect(res.status).toBe(400);
  });

  it('400 on invalid target', async () => {
    const { POST } = await import('@/app/api/school-admin/parents/route');
    authOk();
    const res = await POST(postReq({ message: 'Hi', target: 'everyone', channel: 'email' }));
    expect(res.status).toBe(400);
  });

  it('400 on invalid channel', async () => {
    const { POST } = await import('@/app/api/school-admin/parents/route');
    authOk();
    const res = await POST(postReq({ message: 'Hi', target: 'all', channel: 'pigeon' }));
    expect(res.status).toBe(400);
  });

  it('400 P5: grade target with a non-CBSE grade (5)', async () => {
    const { POST } = await import('@/app/api/school-admin/parents/route');
    authOk();
    const res = await POST(postReq({ message: 'Hi', target: 'grade', target_value: '5', channel: 'email' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/school-admin/parents — authz', () => {
  it('rejects an unauthorized caller verbatim and sends nothing', async () => {
    const { POST } = await import('@/app/api/school-admin/parents/route');
    holders.authorizeSchoolAdmin.mockResolvedValue({
      authorized: false, userId: null, schoolId: null, schoolAdminId: null, schoolAdminRole: null,
      errorResponse: new Response(JSON.stringify({ success: false, error: 'Not a school administrator' }), { status: 403 }),
    });
    const res = await POST(postReq({ message: 'Hi', target: 'all', channel: 'email' }));
    expect(res.status).toBe(403);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(holders.logSchoolAudit).not.toHaveBeenCalled();
  });
});

describe('POST /api/school-admin/parents — email broadcast counts', () => {
  function seedTwoApprovedGuardians() {
    holders.tables = {
      students: [{ id: 'stu-1' }, { id: 'stu-2' }],
      guardian_student_links: [{ guardian_id: 'g1' }, { guardian_id: 'g2' }],
      guardians: [
        { id: 'g1', auth_user_id: 'au1', phone: null, email: 'parent1@example.com', preferred_language: 'en' },
        { id: 'g2', auth_user_id: 'au2', phone: null, email: 'parent2@example.com', preferred_language: 'hi' },
      ],
      schools: [{ name: 'Delhi Public School' }],
    };
  }

  it('returns { sent_count, failed_count, channel } and counts json.sent per guardian', async () => {
    const { POST } = await import('@/app/api/school-admin/parents/route');
    authOk();
    seedTwoApprovedGuardians();
    // parent1 succeeds, parent2 fails (sent:false).
    holders.fetchResults = {
      'parent1@example.com': { ok: true, sent: true },
      'parent2@example.com': { ok: true, sent: false },
    };
    const res = await POST(postReq({ message: 'Exams begin Monday', target: 'all', channel: 'email' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ sent_count: 1, failed_count: 1, channel: 'email' });

    // One Edge Function call per guardian-with-email, using the broadcast template.
    expect(holders.fetchBodies).toHaveLength(2);
    for (const b of holders.fetchBodies) {
      expect(b.template).toBe('school-parent-broadcast');
      expect(b.params).toHaveProperty('message', 'Exams begin Monday');
      expect(b.params).toHaveProperty('school_name', 'Delhi Public School');
    }
  });

  it('short-circuits to zero counts when no students match the target', async () => {
    const { POST } = await import('@/app/api/school-admin/parents/route');
    authOk();
    holders.tables = { students: [] };
    const res = await POST(postReq({ message: 'Hi', target: 'all', channel: 'email' }));
    const body = await res.json();
    expect(body.data.sent_count).toBe(0);
    expect(body.data.failed_count).toBe(0);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('P13: neither logs nor audit metadata carry a guardian email or the message body', async () => {
    const { POST } = await import('@/app/api/school-admin/parents/route');
    authOk();
    seedTwoApprovedGuardians();
    const secret = 'Confidential fee-default notice for your ward';
    await POST(postReq({ message: secret, target: 'all', channel: 'email' }));

    // Logger calls carry counts only, not addresses or message text.
    const logSer = JSON.stringify(holders.loggerCalls);
    expect(logSer).not.toContain('parent1@example.com');
    expect(logSer).not.toContain(secret);

    // Audit records the broadcast with metadata (counts/channel/target) only.
    expect(holders.logSchoolAudit).toHaveBeenCalledTimes(1);
    const entry = holders.logSchoolAudit.mock.calls[0][0];
    const auditSer = JSON.stringify(entry);
    expect(auditSer).not.toContain('parent1@example.com');
    expect(auditSer).not.toContain(secret);
    expect(entry.metadata.channel).toBe('email');
    expect(entry.metadata.sent_count).toBe(2); // both default success
    expect(entry.action).toBe('parent_message.sent');
  });
});
