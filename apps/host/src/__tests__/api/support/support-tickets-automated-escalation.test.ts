/**
 * /api/support/tickets — Phase 8 item 8.10 automated-escalation dispute intake.
 *
 * Pins, as hard assertions on the POST path:
 *   - The two new categories (automated_escalation_dispute,
 *     synthesis_content_concern) are ACCEPTED (not rejected as invalid enum).
 *   - Each REQUIRES a related_entity_id; omitting it → 400 REFERENCE_REQUIRED,
 *     no row inserted.
 *   - The server STAMPS the entity type from the category
 *     (adaptive_intervention / monthly_synthesis_run) — never trusts the client.
 *   - P13: the persisted row + ops-event context carry the reference by ID only,
 *     no message text / PII.
 *
 * Mirrors the mocking style of support-tickets-guardian.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const holders = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockGetGuardian: vi.fn(),
  mockListChildren: vi.fn(),
  mockLogOps: vi.fn(),
  insertedRows: [] as Array<Record<string, unknown>>,
  insertError: null as { message: string } | null,
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
}));
vi.mock('@alfanumrik/lib/domains/identity', () => ({
  getGuardianByAuthUserId: (...a: unknown[]) => holders.mockGetGuardian(...a),
}));
vi.mock('@alfanumrik/lib/domains/relationship', () => ({
  listChildrenForGuardian: (...a: unknown[]) => holders.mockListChildren(...a),
}));
vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: (...a: unknown[]) => holders.mockLogOps(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  function ticketsChain() {
    let pendingInsert: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      insert(row: Record<string, unknown>) {
        pendingInsert = row;
        return chain;
      },
      select() {
        return chain;
      },
      eq() {
        return chain;
      },
      in() {
        return chain;
      },
      order() {
        return chain;
      },
      single() {
        if (pendingInsert) {
          if (holders.insertError) return Promise.resolve({ data: null, error: holders.insertError });
          holders.insertedRows.push(pendingInsert);
          return Promise.resolve({
            data: { id: 'ticket-esc-id', created_at: '2026-07-22T00:00:00.000Z' },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return chain;
  }
  return { supabaseAdmin: { from: (_t: string) => ticketsChain() } };
});

const STUDENT_ID = '99999999-9999-4999-a999-999999999999';
const INTERVENTION_ID = '11111111-1111-4111-a111-111111111111';
const SYNTHESIS_RUN_ID = '22222222-2222-4222-a222-222222222222';

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/support/tickets', {
    method: 'POST',
    headers: { Authorization: 'Bearer fake.jwt', 'content-type': 'application/json', 'user-agent': 'jsdom' },
    body: JSON.stringify(body),
  });
}

// A distinct student auth per test keeps the module-level rate limiter isolated.
function authAsStudent(userId: string) {
  holders.mockAuthorize.mockImplementation(async (_req: unknown, perm: string) => {
    if (perm === 'foxy.chat') {
      return {
        authorized: true,
        userId,
        studentId: STUDENT_ID,
        roles: ['student'],
        permissions: ['foxy.chat'],
      };
    }
    return { authorized: false, userId, studentId: null, roles: [], permissions: [] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.insertedRows = [];
  holders.insertError = null;
  holders.mockLogOps.mockResolvedValue(undefined);
});

describe('POST /api/support/tickets — automated_escalation_dispute', () => {
  it('accepts the category and stamps related_entity_type=adaptive_intervention', async () => {
    const { POST } = await import('@/app/api/support/tickets/route');
    authAsStudent('a1111111-1111-4111-a111-111111111111');
    const res = await POST(postReq({
      subject: 'Wrongly flagged at-risk',
      description: 'My child was flagged at-risk but has been active.',
      category: 'automated_escalation_dispute',
      related_entity_id: INTERVENTION_ID,
    }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    expect(holders.insertedRows).toHaveLength(1);
    const row = holders.insertedRows[0];
    expect(row.category).toBe('automated_escalation_dispute');
    expect(row.related_entity_type).toBe('adaptive_intervention');
    expect(row.related_entity_id).toBe(INTERVENTION_ID);
  });

  it('rejects with 400 REFERENCE_REQUIRED when related_entity_id is missing — no row inserted', async () => {
    const { POST } = await import('@/app/api/support/tickets/route');
    authAsStudent('a2222222-2222-4222-a222-222222222222');
    const res = await POST(postReq({
      subject: 'Dispute',
      description: 'This flag is wrong.',
      category: 'automated_escalation_dispute',
    }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('REFERENCE_REQUIRED');
    expect(holders.insertedRows).toHaveLength(0);
  });
});

describe('POST /api/support/tickets — synthesis_content_concern', () => {
  it('accepts the category and stamps related_entity_type=monthly_synthesis_run', async () => {
    const { POST } = await import('@/app/api/support/tickets/route');
    authAsStudent('a3333333-3333-4333-a333-333333333333');
    const res = await POST(postReq({
      subject: 'Synthesis says wrong topic',
      description: 'The Monthly Synthesis claims mastery my child never showed.',
      category: 'synthesis_content_concern',
      related_entity_id: SYNTHESIS_RUN_ID,
    }) as never);
    expect(res.status).toBe(200);

    expect(holders.insertedRows).toHaveLength(1);
    const row = holders.insertedRows[0];
    expect(row.category).toBe('synthesis_content_concern');
    expect(row.related_entity_type).toBe('monthly_synthesis_run');
    expect(row.related_entity_id).toBe(SYNTHESIS_RUN_ID);
  });

  it('rejects with 400 REFERENCE_REQUIRED when the id is missing', async () => {
    const { POST } = await import('@/app/api/support/tickets/route');
    authAsStudent('a4444444-4444-4444-a444-444444444444');
    const res = await POST(postReq({
      subject: 'Concern',
      description: 'Content looks wrong.',
      category: 'synthesis_content_concern',
    }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('REFERENCE_REQUIRED');
    expect(holders.insertedRows).toHaveLength(0);
  });
});

describe('POST /api/support/tickets — P13 reference is id-only', () => {
  it('ops-event context carries the reference ids only, never the message text', async () => {
    const { POST } = await import('@/app/api/support/tickets/route');
    authAsStudent('a5555555-5555-4555-a555-555555555555');
    // Phone chosen to not collide with any digit run in the fixture UUIDs.
    const secret = 'CALL ME 8018675309 private complaint text';
    await POST(postReq({
      subject: 'Dispute',
      description: secret,
      category: 'automated_escalation_dispute',
      related_entity_id: INTERVENTION_ID,
    }) as never);

    expect(holders.mockLogOps).toHaveBeenCalledTimes(1);
    const opsArg = holders.mockLogOps.mock.calls[0][0];
    const serialized = JSON.stringify(opsArg);
    expect(serialized).not.toContain('8018675309');
    expect(serialized).not.toContain('private complaint');
    expect(opsArg.context.related_entity_type).toBe('adaptive_intervention');
    expect(opsArg.context.related_entity_id).toBe(INTERVENTION_ID);
  });
});
