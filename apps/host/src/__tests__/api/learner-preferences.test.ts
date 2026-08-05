import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * D9/E (Foxy North-Star Phase 2 wave 2b) — PATCH /api/learner/preferences.
 *
 * Pins:
 *   - authorizeRequest('memory.view_own', { requireStudentId: true }) gates it
 *     (self-scope; NO new permission code invented).
 *   - zod whitelist: only the fixed camelCase contract enums pass; anything
 *     else (bad enum, unknown key, empty body) → 400.
 *   - RLS-scoped write (cookie/Bearer client — never supabase-admin): updates
 *     the NEWEST student_learning_profiles row (loadStudentPreferences
 *     row-pick mirror) and ALWAYS sets preferences_set_by_user = true
 *     (explicit-wins guard for the implicit writer).
 *   - 404 when the student has no profile row yet.
 *   - Response is the house { success, data } shape.
 */

let _authResult: Record<string, unknown>;
const _authorizeCalls: unknown[][] = [];
const _logAudit = vi.fn(() => Promise.resolve());
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: vi.fn((...args: unknown[]) => {
    _authorizeCalls.push(args);
    return Promise.resolve(_authResult);
  }),
  logAudit: (...args: unknown[]) => _logAudit(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// RLS-scoped client mock (cookie path — createSupabaseServerClient).
let _pickedRow: { id: string } | null = { id: 'profile-row-1' };
let _updatePayload: Record<string, unknown> | null = null;
let _updateFilters: Array<[string, unknown]> = [];
const _orderCalls: Array<[string, { ascending: boolean }]> = [];
function makeSbMock() {
  return {
    from: (table: string) => {
      if (table !== 'student_learning_profiles') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            order: (col: string, o: { ascending: boolean }) => {
              _orderCalls.push([col, o]);
              return {
                order: (col2: string, o2: { ascending: boolean }) => {
                  _orderCalls.push([col2, o2]);
                  return {
                    limit: () => ({
                      maybeSingle: () => Promise.resolve({ data: _pickedRow, error: null }),
                    }),
                  };
                },
              };
            },
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          _updatePayload = payload;
          _updateFilters = [];
          const chain = {
            eq: (col: string, val: unknown) => {
              _updateFilters.push([col, val]);
              return chain;
            },
            then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
          };
          return chain;
        },
      };
    },
  };
}
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(async () => makeSbMock()),
}));

// The route must never touch the RLS-bypassing admin client.
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  get supabaseAdmin() {
    throw new Error('learner/preferences must not use supabase-admin (P8)');
  },
}));

function makePatch(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/learner/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _authorizeCalls.length = 0;
  _orderCalls.length = 0;
  _pickedRow = { id: 'profile-row-1' };
  _updatePayload = null;
  _updateFilters = [];
  _authResult = {
    authorized: true,
    userId: 'auth-user-1',
    studentId: 'student-uuid-1',
  };
});

describe('PATCH /api/learner/preferences — auth + whitelist + explicit-wins write', () => {
  it('gates with memory.view_own + requireStudentId and 401s through', async () => {
    _authResult = {
      authorized: false,
      errorResponse: NextResponse.json({ error: 'no' }, { status: 401 }),
    };
    const { PATCH } = await import('@/app/api/learner/preferences/route');
    const res = await PATCH(makePatch({ learningStyle: 'visual' }));
    expect(res.status).toBe(401);
    expect(_authorizeCalls[0]?.[1]).toBe('memory.view_own');
    expect(_authorizeCalls[0]?.[2]).toMatchObject({ requireStudentId: true });
  });

  it('400s on a bad enum value', async () => {
    const { PATCH } = await import('@/app/api/learner/preferences/route');
    const res = await PATCH(makePatch({ learningStyle: 'astrology' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(_updatePayload).toBeNull();
  });

  it('400s on unknown keys (strict schema) and on an empty body', async () => {
    const { PATCH } = await import('@/app/api/learner/preferences/route');
    expect((await PATCH(makePatch({ learning_style: 'visual' }))).status).toBe(400);
    expect((await PATCH(makePatch({}))).status).toBe(400);
  });

  it('400s on a bad depth enum', async () => {
    const { PATCH } = await import('@/app/api/learner/preferences/route');
    expect((await PATCH(makePatch({ preferredExplanationDepth: 'ultra' }))).status).toBe(400);
  });

  it('writes the newest row with the mapped columns AND preferences_set_by_user = true', async () => {
    const { PATCH } = await import('@/app/api/learner/preferences/route');
    const res = await PATCH(
      makePatch({ learningStyle: 'example-first', preferredExplanationDepth: 'deep' }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      data: {
        learningStyle: 'example-first',
        preferredExplanationDepth: 'deep',
        preferencesSetByUser: true,
      },
    });
    // Explicit-wins guard column is ALWAYS set.
    expect(_updatePayload).toEqual({
      preferences_set_by_user: true,
      learning_style: 'example-first',
      preferred_explanation_depth: 'deep',
    });
    // Update targets the picked newest row, scoped to the RBAC studentId.
    expect(_updateFilters).toEqual(
      expect.arrayContaining([
        ['id', 'profile-row-1'],
        ['student_id', 'student-uuid-1'],
      ]),
    );
    // Newest-row pick mirrors loadStudentPreferences (updated_at desc, id desc).
    expect(_orderCalls).toEqual([
      ['updated_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
  });

  it('accepts a single-field body (settings page sends one key per tap)', async () => {
    const { PATCH } = await import('@/app/api/learner/preferences/route');
    const res = await PATCH(makePatch({ learningStyle: 'visual' }));
    expect(res.status).toBe(200);
    expect(_updatePayload).toEqual({
      preferences_set_by_user: true,
      learning_style: 'visual',
    });
  });

  it('404s when the student has no profile row yet', async () => {
    _pickedRow = null;
    const { PATCH } = await import('@/app/api/learner/preferences/route');
    const res = await PATCH(makePatch({ learningStyle: 'visual' }));
    expect(res.status).toBe(404);
    expect(_updatePayload).toBeNull();
  });

  it('audits metadata only (fields set, never free text)', async () => {
    const { PATCH } = await import('@/app/api/learner/preferences/route');
    await PATCH(makePatch({ preferredExplanationDepth: 'quick' }));
    expect(_logAudit).toHaveBeenCalledTimes(1);
    const entry = _logAudit.mock.calls[0] as unknown[];
    expect(entry[0]).toBe('auth-user-1');
    expect(entry[1]).toMatchObject({
      action: 'learner.preferences_updated',
      resourceType: 'student_learning_profiles',
      details: {
        set_learning_style: null,
        set_preferred_explanation_depth: 'quick',
        explicit: true,
      },
    });
  });
});
