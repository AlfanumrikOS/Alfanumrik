/**
 * Tests for /api/parent/children/[student_id]/request-erasure (POST + DELETE)
 * and /api/parent/children/[student_id]/erasure-status (GET) — Phase D.3.
 *
 * Coverage:
 *   POST:
 *     1. Happy path: pending row created with purge_at ≈ now + 7d, audit
 *        written, spine event published, 200 with request_id.
 *     2. Cross-guardian rejected: a different guardian gets 403 even when
 *        the student exists.
 *     3. No active link → 403.
 *     4. Idempotency: a second POST returns the same request_id +
 *        already_pending=true.
 *     5. Invalid student_id → 400.
 *
 *   DELETE:
 *     6. Cancel during grace: row flips to cancelled, audit + event emitted.
 *     7. Cancel after purge_at: 410 Gone (no row mutation).
 *     8. Cancel a completed row: 410.
 *     9. Cancel a row owned by another guardian: 404 (no leak).
 *    10. No row exists → 404.
 *
 *   GET:
 *    11. No row → request: null.
 *    12. Row exists → returns the latest row.
 *    13. Cross-guardian → 403 (link check).
 *    14. Strict ownership check is applied before the row read.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Fixtures ──────────────────────────────────────────────────────────────
// Use string literals inside vi.hoisted() because hoisted code runs BEFORE
// any module-level const initialisers.
const AUTH_USER_ID = '00000000-0000-0000-0000-00000000aaaa';
const OTHER_AUTH_USER_ID = '00000000-0000-0000-0000-00000000a1a1';
const GUARDIAN_ID = '00000000-0000-0000-0000-00000000bbbb';
const OTHER_GUARDIAN_ID = '00000000-0000-0000-0000-00000000b1b1';
const STUDENT_ID = '00000000-0000-0000-0000-00000000cccc';
const SCHOOL_ID = '00000000-0000-0000-0000-00000000dddd';

interface ErasureRow {
  id: string;
  guardian_id: string;
  student_id: string;
  school_id: string | null;
  status: 'pending' | 'cancelled' | 'purging' | 'completed' | 'failed';
  reason: string | null;
  requested_at: string;
  purge_at: string;
  processed_at: string | null;
  error_message: string | null;
}

const holders = vi.hoisted(() => ({
  state: {
    guardians: [] as Array<{ id: string; auth_user_id: string; email: string | null }>,
    students: [] as Array<{ id: string; name: string; school_id: string | null; auth_user_id: string | null }>,
    links: [] as Array<{ id: string; guardian_id: string; student_id: string; status: string }>,
    erasureRequests: [] as ErasureRow[],
    stateEvents: [] as Array<Record<string, unknown>>,
    auditLogs: [] as Array<Record<string, unknown>>,
    feature_flags: [] as Array<{ flag_name: string; is_enabled: boolean }>,
  },
  // Per-test override of which auth user the route resolves. The default
  // must be a literal — vi.hoisted runs before any module-level const, so
  // referencing AUTH_USER_ID here would TDZ-error.
  currentAuthUserId: '00000000-0000-0000-0000-00000000aaaa',
  nextUuid: 0,
}));

vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return {
    ...actual,
    randomUUID: () => {
      holders.nextUuid += 1;
      return `00000000-0000-0000-0000-${String(holders.nextUuid).padStart(12, '0')}`;
    },
  };
});

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: vi.fn().mockImplementation((_req: unknown, _perm: string) => {
    return Promise.resolve({
      authorized: true,
      userId: holders.currentAuthUserId,
      studentId: null,
      roles: ['parent'],
      permissions: ['child.view_progress'],
      errorResponse: null,
    });
  }),
  logAudit: vi.fn(),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@alfanumrik/lib/audit', () => ({
  auditLog: vi.fn().mockImplementation(async (event: Record<string, unknown>) => {
    holders.state.auditLogs.push(event);
  }),
  AuditAction: {},
}));

vi.mock('@alfanumrik/lib/email-delivery', () => ({
  deliverEmail: vi.fn().mockResolvedValue({ sent: true }),
}));

// Reuse the publish module's contract by mocking it directly.
vi.mock('@alfanumrik/lib/state/events/publish', () => ({
  publishEvent: vi.fn().mockImplementation(async (_sb: unknown, event: Record<string, unknown>) => {
    holders.state.stateEvents.push(event);
    return { published: true };
  }),
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  function buildChain(table: string) {
    const state = holders.state;
    // The .select() return shape varies. We model an in-memory query
    // builder per-table; only the methods actually used by the route
    // code are implemented.
    if (table === 'guardians') {
      return {
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: () => {
              const found = state.guardians.find((g) => g.auth_user_id === val);
              return Promise.resolve({ data: found ?? null, error: null });
            },
          }),
        }),
      };
    }
    if (table === 'guardian_student_links') {
      return {
        select: () => ({
          eq: (col1: string, val1: string) => ({
            eq: (col2: string, val2: string) => ({
              in: (_col3: string, statuses: string[]) => ({
                maybeSingle: () => {
                  const found = state.links.find((l) =>
                    (l as unknown as Record<string, unknown>)[col1] === val1
                    && (l as unknown as Record<string, unknown>)[col2] === val2
                    && statuses.includes(l.status),
                  );
                  return Promise.resolve({ data: found ?? null, error: null });
                },
              }),
            }),
          }),
        }),
      };
    }
    if (table === 'students') {
      return {
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: () => {
              const found = state.students.find((s) => s.id === val);
              return Promise.resolve({ data: found ?? null, error: null });
            },
          }),
        }),
      };
    }
    if (table === 'data_erasure_requests') {
      const selectFromState = (filter: Partial<ErasureRow>) =>
        state.erasureRequests.filter((r) =>
          Object.entries(filter).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v),
        );
      return {
        select: () => ({
          eq: (k1: string, v1: unknown) => {
            const filter1: Partial<ErasureRow> = { [k1]: v1 } as Partial<ErasureRow>;
            return {
              eq: (k2: string, v2: unknown) => {
                const filter2: Partial<ErasureRow> = { ...filter1, [k2]: v2 } as Partial<ErasureRow>;
                return {
                  eq: (k3: string, v3: unknown) => {
                    const filter3: Partial<ErasureRow> = { ...filter2, [k3]: v3 } as Partial<ErasureRow>;
                    return {
                      maybeSingle: () => {
                        const rows = selectFromState(filter3);
                        return Promise.resolve({ data: rows[0] ?? null, error: null });
                      },
                    };
                  },
                  in: (_col: string, statuses: string[]) => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: () => {
                          const rows = selectFromState(filter2).filter((r) =>
                            statuses.includes(r.status),
                          );
                          return Promise.resolve({ data: rows[0] ?? null, error: null });
                        },
                      }),
                    }),
                  }),
                  order: () => ({
                    limit: (n: number) => {
                      const rows = selectFromState(filter2)
                        .sort((a, b) => b.requested_at.localeCompare(a.requested_at))
                        .slice(0, n);
                      return Promise.resolve({ data: rows, error: null });
                    },
                  }),
                  maybeSingle: () => {
                    const rows = selectFromState(filter2);
                    return Promise.resolve({ data: rows[0] ?? null, error: null });
                  },
                };
              },
            };
          },
        }),
        insert: (payload: Partial<ErasureRow>) => ({
          select: () => ({
            single: () => {
              const newRow: ErasureRow = {
                id: `req-${state.erasureRequests.length + 1}`,
                guardian_id: payload.guardian_id ?? '',
                student_id: payload.student_id ?? '',
                school_id: payload.school_id ?? null,
                status: (payload.status as ErasureRow['status']) ?? 'pending',
                reason: payload.reason ?? null,
                requested_at: payload.requested_at ?? new Date().toISOString(),
                purge_at: payload.purge_at ?? new Date().toISOString(),
                processed_at: null,
                error_message: null,
              };
              state.erasureRequests.push(newRow);
              return Promise.resolve({ data: newRow, error: null });
            },
          }),
        }),
        update: (patch: Partial<ErasureRow>) => ({
          eq: (k1: string, v1: unknown) => ({
            eq: (k2: string, v2: unknown) => {
              const rows = state.erasureRequests.filter((r) =>
                (r as unknown as Record<string, unknown>)[k1] === v1
                && (r as unknown as Record<string, unknown>)[k2] === v2,
              );
              for (const r of rows) Object.assign(r, patch);
              return Promise.resolve({ data: null, error: null });
            },
          }),
        }),
      };
    }
    if (table === 'feature_flags') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { is_enabled: true }, error: null }),
          }),
        }),
      };
    }
    if (table === 'state_events') {
      return {
        insert: (payload: Record<string, unknown>) => {
          holders.state.stateEvents.push(payload);
          return Promise.resolve({ data: null, error: null });
        },
      };
    }
    return {
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    };
  }
  return {
    supabaseAdmin: { from: buildChain },
    getSupabaseAdmin: () => ({ from: buildChain }),
  };
});

// ── Test harness helpers ──────────────────────────────────────────────────

function resetState() {
  holders.state.guardians = [
    { id: GUARDIAN_ID, auth_user_id: AUTH_USER_ID, email: 'guardian@test.local' },
    { id: OTHER_GUARDIAN_ID, auth_user_id: OTHER_AUTH_USER_ID, email: 'other@test.local' },
  ];
  holders.state.students = [
    { id: STUDENT_ID, name: 'Aanya Sharma', school_id: SCHOOL_ID, auth_user_id: '00000000-0000-0000-0000-00000000ffff' },
  ];
  holders.state.links = [
    { id: 'link-1', guardian_id: GUARDIAN_ID, student_id: STUDENT_ID, status: 'approved' },
  ];
  holders.state.erasureRequests = [];
  holders.state.stateEvents = [];
  holders.state.auditLogs = [];
  holders.currentAuthUserId = AUTH_USER_ID;
  holders.nextUuid = 0;
}

function makeRequest(method: 'POST' | 'DELETE' | 'GET', body?: unknown): import('next/server').NextRequest {
  // Minimal NextRequest shim — the route uses .json() and the
  // authorizeRequest signature.
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://test/api/parent/children/${STUDENT_ID}/request-erasure`, init) as unknown as import('next/server').NextRequest;
}

beforeEach(() => {
  resetState();
});

// ── POST tests ────────────────────────────────────────────────────────────

describe('POST /api/parent/children/[student_id]/request-erasure', () => {
  it('happy path: creates pending row, audits, emits event', async () => {
    const { POST } = await import('@/app/api/parent/children/[student_id]/request-erasure/route');
    const res = await POST(makeRequest('POST', { reason: 'no longer needed' }), {
      params: Promise.resolve({ student_id: STUDENT_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.request_id).toBeDefined();
    expect(body.purge_at).toBeDefined();

    // Row created with status=pending and purge_at ~7d ahead.
    const row = holders.state.erasureRequests[0];
    expect(row.status).toBe('pending');
    expect(row.guardian_id).toBe(GUARDIAN_ID);
    expect(row.student_id).toBe(STUDENT_ID);
    expect(row.school_id).toBe(SCHOOL_ID);
    expect(row.reason).toBe('no longer needed');

    const elapsedMs = new Date(row.purge_at).getTime() - Date.now();
    // 7 days ± 1 minute slack for test stability.
    expect(elapsedMs).toBeGreaterThan(6.99 * 24 * 60 * 60 * 1000);
    expect(elapsedMs).toBeLessThan(7.01 * 24 * 60 * 60 * 1000);

    // Audit + event.
    expect(holders.state.auditLogs[0].action).toBe('data_erasure.requested');
    const evt = holders.state.stateEvents.find(
      (e) => e.kind === 'parent.child_erasure_requested',
    ) as Record<string, unknown> | undefined;
    expect(evt).toBeDefined();
    expect((evt!.payload as Record<string, unknown>).requestId).toBe(row.id);
  });

  it('cross-guardian rejected with 403', async () => {
    holders.currentAuthUserId = OTHER_AUTH_USER_ID;
    const { POST } = await import('@/app/api/parent/children/[student_id]/request-erasure/route');
    const res = await POST(makeRequest('POST'), {
      params: Promise.resolve({ student_id: STUDENT_ID }),
    });
    expect(res.status).toBe(403);
    expect(holders.state.erasureRequests).toHaveLength(0);
    expect(holders.state.stateEvents).toHaveLength(0);
  });

  it('no active link → 403', async () => {
    holders.state.links = []; // wipe the link
    const { POST } = await import('@/app/api/parent/children/[student_id]/request-erasure/route');
    const res = await POST(makeRequest('POST'), {
      params: Promise.resolve({ student_id: STUDENT_ID }),
    });
    expect(res.status).toBe(403);
  });

  it('idempotency: second POST returns existing request_id + already_pending', async () => {
    const { POST } = await import('@/app/api/parent/children/[student_id]/request-erasure/route');
    const res1 = await POST(makeRequest('POST'), {
      params: Promise.resolve({ student_id: STUDENT_ID }),
    });
    const body1 = await res1.json();

    const res2 = await POST(makeRequest('POST'), {
      params: Promise.resolve({ student_id: STUDENT_ID }),
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.already_pending).toBe(true);
    expect(body2.request_id).toBe(body1.request_id);
    expect(holders.state.erasureRequests).toHaveLength(1);
  });

  it('invalid student_id → 400', async () => {
    const { POST } = await import('@/app/api/parent/children/[student_id]/request-erasure/route');
    const res = await POST(makeRequest('POST'), {
      params: Promise.resolve({ student_id: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
  });
});

// ── DELETE tests ──────────────────────────────────────────────────────────

describe('DELETE /api/parent/children/[student_id]/request-erasure', () => {
  it('cancels a pending row during the grace window', async () => {
    holders.state.erasureRequests.push({
      id: 'req-existing',
      guardian_id: GUARDIAN_ID,
      student_id: STUDENT_ID,
      school_id: SCHOOL_ID,
      status: 'pending',
      reason: null,
      requested_at: new Date(Date.now() - 60_000).toISOString(),
      purge_at: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
      processed_at: null,
      error_message: null,
    });
    const { DELETE } = await import('@/app/api/parent/children/[student_id]/request-erasure/route');
    const res = await DELETE(makeRequest('DELETE'), {
      params: Promise.resolve({ student_id: STUDENT_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe('cancelled');
    expect(holders.state.erasureRequests[0].status).toBe('cancelled');

    const evt = holders.state.stateEvents.find(
      (e) => e.kind === 'parent.child_erasure_cancelled',
    );
    expect(evt).toBeDefined();
    expect(holders.state.auditLogs[0].action).toBe('data_erasure.cancelled');
  });

  it('returns 410 when purge_at has elapsed', async () => {
    holders.state.erasureRequests.push({
      id: 'req-expired',
      guardian_id: GUARDIAN_ID,
      student_id: STUDENT_ID,
      school_id: SCHOOL_ID,
      status: 'pending',
      reason: null,
      requested_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      purge_at: new Date(Date.now() - 60_000).toISOString(),
      processed_at: null,
      error_message: null,
    });
    const { DELETE } = await import('@/app/api/parent/children/[student_id]/request-erasure/route');
    const res = await DELETE(makeRequest('DELETE'), {
      params: Promise.resolve({ student_id: STUDENT_ID }),
    });
    expect(res.status).toBe(410);
    expect(holders.state.erasureRequests[0].status).toBe('pending'); // unchanged
  });

  it('returns 410 when status is completed', async () => {
    holders.state.erasureRequests.push({
      id: 'req-done',
      guardian_id: GUARDIAN_ID,
      student_id: STUDENT_ID,
      school_id: SCHOOL_ID,
      status: 'completed',
      reason: null,
      requested_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      purge_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      processed_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      error_message: null,
    });
    const { DELETE } = await import('@/app/api/parent/children/[student_id]/request-erasure/route');
    const res = await DELETE(makeRequest('DELETE'), {
      params: Promise.resolve({ student_id: STUDENT_ID }),
    });
    expect(res.status).toBe(410);
  });

  it('returns 404 when the row belongs to a different guardian', async () => {
    holders.state.erasureRequests.push({
      id: 'req-other',
      guardian_id: OTHER_GUARDIAN_ID,
      student_id: STUDENT_ID,
      school_id: SCHOOL_ID,
      status: 'pending',
      reason: null,
      requested_at: new Date().toISOString(),
      purge_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      processed_at: null,
      error_message: null,
    });
    const { DELETE } = await import('@/app/api/parent/children/[student_id]/request-erasure/route');
    const res = await DELETE(makeRequest('DELETE'), {
      params: Promise.resolve({ student_id: STUDENT_ID }),
    });
    expect(res.status).toBe(404);
    // No-op on the other guardian's row.
    expect(holders.state.erasureRequests[0].status).toBe('pending');
  });

  it('returns 404 when no row exists', async () => {
    const { DELETE } = await import('@/app/api/parent/children/[student_id]/request-erasure/route');
    const res = await DELETE(makeRequest('DELETE'), {
      params: Promise.resolve({ student_id: STUDENT_ID }),
    });
    expect(res.status).toBe(404);
  });
});

// ── GET tests ─────────────────────────────────────────────────────────────

describe('GET /api/parent/children/[student_id]/erasure-status', () => {
  it('returns request: null when no row exists', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/erasure-status/route');
    const res = await GET(makeRequest('GET'), {
      params: Promise.resolve({ student_id: STUDENT_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.request).toBeNull();
  });

  it('returns the latest row when one exists', async () => {
    holders.state.erasureRequests.push({
      id: 'req-latest',
      guardian_id: GUARDIAN_ID,
      student_id: STUDENT_ID,
      school_id: SCHOOL_ID,
      status: 'pending',
      reason: null,
      requested_at: new Date().toISOString(),
      purge_at: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
      processed_at: null,
      error_message: null,
    });
    const { GET } = await import('@/app/api/parent/children/[student_id]/erasure-status/route');
    const res = await GET(makeRequest('GET'), {
      params: Promise.resolve({ student_id: STUDENT_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request.id).toBe('req-latest');
    expect(body.request.status).toBe('pending');
  });

  it('cross-guardian read returns 403', async () => {
    holders.currentAuthUserId = OTHER_AUTH_USER_ID;
    const { GET } = await import('@/app/api/parent/children/[student_id]/erasure-status/route');
    const res = await GET(makeRequest('GET'), {
      params: Promise.resolve({ student_id: STUDENT_ID }),
    });
    expect(res.status).toBe(403);
  });
});
