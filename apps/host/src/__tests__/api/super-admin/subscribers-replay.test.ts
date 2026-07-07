/**
 * /api/super-admin/subscribers/[name]/replay — POST contract tests.
 *
 * Pins:
 *   - authorizeAdmin gate (401 passthrough).
 *   - Retype-name guardrail (expectedSubscriberName must match path).
 *   - Forward-jump rejection (new occurred_at must be < current).
 *   - Happy path: cursor updated + audit recorded.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Auth mock ────────────────────────────────────────────────────────
const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn();
vi.mock('@alfanumrik/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
  logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
}));

// ── Logger silencer ─────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Supabase chain. Each test reseeds tableResults[table] with the
// row the route's query should resolve to. The chain is intentionally
// dumb — terminal `.maybeSingle()` resolves with the seeded row; the
// terminal `.update(...).eq(...)` records the patch.
const tableResults: Record<string, { data: unknown; error: unknown }> = {};
const updateCalls: Array<{ table: string; patch: Record<string, unknown> }> = [];

function chainFor(table: string) {
  const result = () => tableResults[table] ?? { data: null, error: null };
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve(result()),
      }),
    }),
    update: (patch: Record<string, unknown>) => {
      updateCalls.push({ table, patch });
      return {
        eq: () => Promise.resolve({ data: null, error: null }),
      };
    },
  };
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => chainFor(table),
  }),
}));

import { POST } from '@/app/api/super-admin/subscribers/[name]/replay/route';

beforeEach(() => {
  authorizeAdmin.mockReset();
  logAdminAudit.mockReset();
  updateCalls.length = 0;
  for (const k of Object.keys(tableResults)) delete tableResults[k];

  authorizeAdmin.mockResolvedValue({
    authorized: true,
    userId: 'admin-1',
    adminId: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin',
    adminLevel: 'super',
  });
  logAdminAudit.mockResolvedValue(undefined);
});

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/super-admin/subscribers/mastery-state-writer/replay',
    {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : null,
      headers: { 'content-type': 'application/json' },
    },
  );
}

function makeCtx(name: string): { params: Promise<{ name: string }> } {
  return { params: Promise.resolve({ name }) };
}

describe('POST /api/super-admin/subscribers/[name]/replay', () => {
  it('returns 401 when not super-admin (passes helper response through)', async () => {
    authorizeAdmin.mockResolvedValueOnce({
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await POST(
      makeRequest({
        mode: 'reset_to_timestamp',
        target: '2026-05-15T00:00:00.000Z',
        expectedSubscriberName: 'mastery-state-writer',
      }),
      makeCtx('mastery-state-writer'),
    );
    expect(res.status).toBe(401);
    expect(updateCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('returns 400 when expectedSubscriberName does not match the URL path (retype guardrail)', async () => {
    tableResults.subscriber_offsets = {
      data: {
        subscriber_name: 'mastery-state-writer',
        kind_filter: 'learner.mastery_changed',
        last_processed_event_id: null,
        last_processed_occurred_at: '2026-05-16T00:00:00.000Z',
      },
      error: null,
    };
    const res = await POST(
      makeRequest({
        mode: 'reset_to_timestamp',
        target: '2026-05-15T00:00:00.000Z',
        expectedSubscriberName: 'wrong-name',
      }),
      makeCtx('mastery-state-writer'),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(String(body.error)).toMatch(/expectedSubscriberName/i);
    expect(updateCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('returns 400 when the new cursor would jump forward (>= current)', async () => {
    tableResults.subscriber_offsets = {
      data: {
        subscriber_name: 'mastery-state-writer',
        kind_filter: 'learner.mastery_changed',
        last_processed_event_id: null,
        last_processed_occurred_at: '2026-05-10T00:00:00.000Z',
      },
      error: null,
    };
    const res = await POST(
      makeRequest({
        mode: 'reset_to_timestamp',
        // Future target — forward jump
        target: '2026-05-15T00:00:00.000Z',
        expectedSubscriberName: 'mastery-state-writer',
      }),
      makeCtx('mastery-state-writer'),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(String(body.error)).toMatch(/forward/i);
    expect(updateCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('returns 200 and records subscriber.replayed audit on a backward reset_to_timestamp', async () => {
    tableResults.subscriber_offsets = {
      data: {
        subscriber_name: 'mastery-state-writer',
        kind_filter: 'learner.mastery_changed',
        last_processed_event_id: 'evt-current',
        last_processed_occurred_at: '2026-05-15T00:00:00.000Z',
      },
      error: null,
    };
    const res = await POST(
      makeRequest({
        mode: 'reset_to_timestamp',
        // Strictly before current — valid backward replay.
        target: '2026-05-10T00:00:00.000Z',
        expectedSubscriberName: 'mastery-state-writer',
      }),
      makeCtx('mastery-state-writer'),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.old_cursor.last_processed_occurred_at).toBe(
      '2026-05-15T00:00:00.000Z',
    );
    expect(body.new_cursor.last_processed_occurred_at).toBe(
      '2026-05-10T00:00:00.000Z',
    );

    // Update was applied to subscriber_offsets.
    expect(updateCalls).toHaveLength(1);
    const call = updateCalls[0];
    expect(call.table).toBe('subscriber_offsets');
    expect(call.patch.last_processed_occurred_at).toBe('2026-05-10T00:00:00.000Z');
    expect(call.patch.last_processed_event_id).toBeNull();

    // Audit recorded with the contract action + metadata.
    expect(logAdminAudit).toHaveBeenCalledTimes(1);
    const [admin, action, entityType, entityId, metadata] =
      logAdminAudit.mock.calls[0];
    expect(admin).toEqual(expect.objectContaining({ authorized: true }));
    expect(action).toBe('subscriber.replayed');
    expect(entityType).toBe('subscriber');
    expect(entityId).toBe('mastery-state-writer');
    expect(metadata).toEqual(
      expect.objectContaining({
        subscriber_name: 'mastery-state-writer',
        mode: 'reset_to_timestamp',
        target: '2026-05-10T00:00:00.000Z',
        old_cursor: expect.objectContaining({
          last_processed_occurred_at: '2026-05-15T00:00:00.000Z',
        }),
      }),
    );
  });
});
