/**
 * Track B, Feature 1 — POST /api/students/[id]/invite-guardian
 *
 * Contract under test (P13 + idempotency + ownership):
 *   1. Owner student creates a PENDING guardian_student_links row
 *      (guardian_id NULL, status 'pending', link_code set) AND dispatches the
 *      bilingual parent-guardian-invite email.
 *   2. Idempotent re-invite — the partial unique index guarantees at most one
 *      pending row per student, so a second call REUSES the existing pending row
 *      (no duplicate insert) and returns reused:true.
 *   3. Owner-or-admin enforcement — a non-owner, non-admin caller → 403, no
 *      invite created, no email dispatched.
 *   4. Admin caller may invite for any student.
 *   5. Already-linked child → 200 no-op (alreadyLinked:true), no new invite.
 *   6. P13 — the guardian email NEVER appears in any logger call argument.
 *
 * These tests exercise the REAL route + the REAL createGuardianInvite helper
 * over a mocked supabase-admin / email-delivery / logger seam.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── RBAC mock ────────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

// ── Logger mock — capture EVERY call so we can scan for PII (P13) ─────────────
const loggerCalls: unknown[][] = [];
function recordLog(...args: unknown[]) {
  loggerCalls.push(args);
}
vi.mock('@/lib/logger', () => ({
  logger: {
    info: (...args: unknown[]) => recordLog('info', ...args),
    warn: (...args: unknown[]) => recordLog('warn', ...args),
    error: (...args: unknown[]) => recordLog('error', ...args),
  },
}));

// ── Email delivery mock — spy on the dispatch ────────────────────────────────
const deliverEmailSpy = vi.fn().mockResolvedValue({ sent: true, id: 'prov-1' });
vi.mock('@/lib/email-delivery', () => ({
  deliverEmail: (...args: unknown[]) => deliverEmailSpy(...args),
}));

// ── supabase-admin mock — a tiny guardian_student_links + students store ──────
const STUDENT_OWNER = '11111111-1111-4111-8111-111111111111';
const STUDENT_OTHER = '22222222-2222-4222-8222-222222222222';
const STUDENT_LINKED = '33333333-3333-4333-8333-333333333333';
const STUDENT_NOCODE = '44444444-4444-4444-8444-444444444444';
const GUARDIAN_EMAIL = 'parent.secret.local-part@example.com';

interface StudentRow {
  id: string;
  name: string | null;
  invite_code: string | null;
  is_active: boolean;
}
interface LinkRow {
  id: string;
  student_id: string;
  guardian_id: string | null;
  status: string;
  link_code: string | null;
}

let students: StudentRow[];
let links: LinkRow[];
let linkSeq: number;
let insertCount: number;

function freshStore() {
  students = [
    { id: STUDENT_OWNER, name: 'Asha', invite_code: 'ABCD1234', is_active: true },
    { id: STUDENT_OTHER, name: 'Other', invite_code: 'OTHER999', is_active: true },
    { id: STUDENT_LINKED, name: 'Linked', invite_code: 'LINK5678', is_active: true },
    { id: STUDENT_NOCODE, name: 'NoCode', invite_code: '', is_active: true },
  ];
  links = [];
  linkSeq = 1;
  insertCount = 0;
}

// Chainable query builder over the in-memory tables.
function builder(table: 'students' | 'guardian_student_links') {
  const preds: Array<(r: Record<string, unknown>) => boolean> = [];
  let pendingInsert: Record<string, unknown> | null = null;
  let pendingPatch: Record<string, unknown> | null = null;

  const rows = (): Record<string, unknown>[] =>
    (table === 'students' ? students : links) as unknown as Record<string, unknown>[];

  function settle() {
    if (pendingInsert) {
      const row = { id: `link-${linkSeq++}`, ...pendingInsert } as unknown as LinkRow;
      links.push(row);
      insertCount++;
      return { data: { id: row.id }, error: null };
    }
    if (pendingPatch) {
      const matched = rows().filter((r) => preds.every((p) => p(r)));
      for (const m of matched) Object.assign(m, pendingPatch);
      return { data: matched[0] ?? null, error: null };
    }
    const matched = rows().filter((r) => preds.every((p) => p(r)));
    return { data: matched, error: null };
  }

  const chain: Record<string, unknown> = {
    select: () => chain,
    insert: (v: Record<string, unknown>) => {
      pendingInsert = v;
      return chain;
    },
    update: (v: Record<string, unknown>) => {
      pendingPatch = v;
      return chain;
    },
    eq: (col: string, val: unknown) => {
      preds.push((r) => r[col] === val);
      return chain;
    },
    is: (col: string, val: unknown) => {
      preds.push((r) => (val === null ? r[col] === null : r[col] === val));
      return chain;
    },
    not: (col: string, _op: string, val: unknown) => {
      // .not('guardian_id', 'is', null) → guardian_id IS NOT NULL
      if (val === null) preds.push((r) => r[col] !== null);
      return chain;
    },
    in: (col: string, vals: unknown[]) => {
      preds.push((r) => vals.includes(r[col]));
      return chain;
    },
    limit: () => chain,
    single: () => {
      const s = settle();
      const d = Array.isArray(s.data) ? s.data[0] ?? null : s.data;
      return Promise.resolve({ data: d, error: s.error });
    },
    maybeSingle: () => {
      const s = settle();
      const d = Array.isArray(s.data) ? s.data[0] ?? null : s.data;
      return Promise.resolve({ data: d, error: s.error });
    },
  };
  return chain;
}

const adminClient = {
  from: (table: string) => builder(table as 'students' | 'guardian_student_links'),
};
vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => adminClient,
  supabaseAdmin: adminClient,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
function setAuth(opts: { studentId?: string | null; roles?: string[]; authorized?: boolean }) {
  if (opts.authorized === false) {
    _authorizeImpl.mockResolvedValue({
      authorized: false,
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    return;
  }
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: opts.studentId ?? null,
    roles: opts.roles ?? ['student'],
    permissions: ['profile.view_own'],
    schoolId: null,
  });
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/students/x/invite-guardian', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

// Recursively stringify every logged argument so we can assert the parent email
// (and its local part) never appears anywhere in a log call.
function allLogText(): string {
  return JSON.stringify(loggerCalls, (_k, v) => (v instanceof Error ? v.message : v));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: any;

beforeEach(async () => {
  vi.clearAllMocks();
  loggerCalls.length = 0;
  deliverEmailSpy.mockResolvedValue({ sent: true, id: 'prov-1' });
  freshStore();
  const mod = await import('@/app/api/students/[id]/invite-guardian/route');
  POST = mod.POST;
});

describe('POST /api/students/[id]/invite-guardian', () => {
  it('owner creates a PENDING link (guardian_id NULL, status pending, link_code set) and dispatches the invite email', async () => {
    setAuth({ studentId: STUDENT_OWNER, roles: ['student'] });

    const res = await POST(makeRequest({ guardian_email: GUARDIAN_EMAIL }), ctx(STUDENT_OWNER));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.reused).toBe(false);
    expect(json.data.alreadyLinked).toBe(false);
    expect(json.data.linkId).toBeTruthy();

    // Exactly one pending row, correctly shaped.
    expect(links).toHaveLength(1);
    expect(links[0].guardian_id).toBeNull();
    expect(links[0].status).toBe('pending');
    expect(links[0].link_code).toBe('ABCD1234');

    // Email dispatched with the bilingual template, addressed to the parent.
    expect(deliverEmailSpy).toHaveBeenCalledTimes(1);
    const emailArg = deliverEmailSpy.mock.calls[0][0] as {
      template: string;
      to: string;
      params: { link_code: string; idempotency_key: string };
    };
    expect(emailArg.template).toBe('parent-guardian-invite');
    expect(emailArg.to).toBe(GUARDIAN_EMAIL);
    expect(emailArg.params.link_code).toBe('ABCD1234');
    // Idempotency key is the pending-link row id, NEVER the email.
    expect(emailArg.params.idempotency_key).toBe(links[0].id);
  });

  it('is idempotent: a re-invite REUSES the single pending row (no duplicate insert)', async () => {
    setAuth({ studentId: STUDENT_OWNER, roles: ['student'] });

    const r1 = await POST(makeRequest({ guardian_email: GUARDIAN_EMAIL }), ctx(STUDENT_OWNER));
    const j1 = await r1.json();
    expect(j1.data.reused).toBe(false);

    const r2 = await POST(makeRequest({ guardian_email: GUARDIAN_EMAIL }), ctx(STUDENT_OWNER));
    const j2 = await r2.json();
    expect(r2.status).toBe(200);
    expect(j2.data.reused).toBe(true);
    expect(j2.data.linkId).toBe(j1.data.linkId);

    // Still exactly one row — the second call reused, did not insert.
    expect(links).toHaveLength(1);
    expect(insertCount).toBe(1);
  });

  it('rejects a non-owner non-admin caller with 403 and creates no invite / sends no email', async () => {
    // Caller resolves to STUDENT_OTHER but targets STUDENT_OWNER.
    setAuth({ studentId: STUDENT_OTHER, roles: ['student'] });

    const res = await POST(makeRequest({ guardian_email: GUARDIAN_EMAIL }), ctx(STUDENT_OWNER));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);

    expect(links).toHaveLength(0);
    expect(deliverEmailSpy).not.toHaveBeenCalled();
  });

  it('allows an admin to invite a guardian for any student', async () => {
    // Admin has no studentId of their own but is allowed by role.
    setAuth({ studentId: null, roles: ['admin'] });

    const res = await POST(makeRequest({ guardian_email: GUARDIAN_EMAIL }), ctx(STUDENT_OWNER));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(links).toHaveLength(1);
    expect(deliverEmailSpy).toHaveBeenCalledTimes(1);
  });

  it('already-linked child → 200 no-op (alreadyLinked:true), no new pending invite, no email', async () => {
    setAuth({ studentId: STUDENT_LINKED, roles: ['student'] });
    // Pre-seed an APPROVED guardian link for this child.
    links.push({
      id: 'existing-approved',
      student_id: STUDENT_LINKED,
      guardian_id: 'guardian-xyz',
      status: 'approved',
      link_code: 'LINK5678',
    });

    const res = await POST(makeRequest({ guardian_email: GUARDIAN_EMAIL }), ctx(STUDENT_LINKED));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.alreadyLinked).toBe(true);

    // No NEW pending row inserted; the only link is the pre-existing approved one.
    expect(insertCount).toBe(0);
    expect(links.filter((l) => l.guardian_id === null)).toHaveLength(0);
    expect(deliverEmailSpy).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid guardian_email', async () => {
    setAuth({ studentId: STUDENT_OWNER, roles: ['student'] });
    const res = await POST(makeRequest({ guardian_email: 'not-an-email' }), ctx(STUDENT_OWNER));
    expect(res.status).toBe(400);
    expect(links).toHaveLength(0);
  });

  it('returns 400 on an invalid (non-UUID) student id', async () => {
    setAuth({ studentId: STUDENT_OWNER, roles: ['student'] });
    const res = await POST(makeRequest({ guardian_email: GUARDIAN_EMAIL }), ctx('not-a-uuid'));
    expect(res.status).toBe(400);
  });

  it('propagates the 401 from authorizeRequest when unauthenticated', async () => {
    setAuth({ authorized: false });
    const res = await POST(makeRequest({ guardian_email: GUARDIAN_EMAIL }), ctx(STUDENT_OWNER));
    expect(res.status).toBe(401);
  });

  // ── P13 — parent email never logged in clear ───────────────────────────────
  it('P13: the parent email (and its local part) never appears in any logger call', async () => {
    setAuth({ studentId: STUDENT_OWNER, roles: ['student'] });
    await POST(makeRequest({ guardian_email: GUARDIAN_EMAIL }), ctx(STUDENT_OWNER));

    const text = allLogText();
    // Full email must not leak.
    expect(text).not.toContain(GUARDIAN_EMAIL);
    // The distinctive local part must not leak either (redaction keeps only the
    // first char + domain).
    expect(text).not.toContain('parent.secret.local-part');
    // Sanity: a success log WAS emitted (so the absence above is meaningful).
    expect(text).toContain('guardian_invite_created');
  });
});
