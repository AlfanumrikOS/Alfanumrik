import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Safeguarding Phase 1 — escalateSafeguarding fan-out contract.
 *
 *   - One notifications row per ACTIVE school admin, type AND
 *     notification_type = 'safeguarding_escalation', delivery_channel
 *     'in_app', sender_type 'system'.
 *   - `data` carries { escalation_id, category } ONLY — the disclosure
 *     excerpt / student message must NEVER ride a notification (P13).
 *   - Zero active admins → no notifications, counts-only result (the case
 *     row still stands in the super-admin queue).
 *   - Null schoolId (B2C) → no lookup fan-out, count 0.
 *   - Never throws — DB failures resolve to count 0.
 */

let _adminsResult: { data: unknown; error: unknown } = { data: [], error: null };
let _notifInsertPayload: unknown[] | null = null;
let _notifInsertResult: { data: unknown; error: unknown } = { data: [], error: null };
let _schoolAdminQueries = 0;

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'school_admins') {
        _schoolAdminQueries += 1;
        return {
          select: () => ({
            eq: () => ({ eq: () => Promise.resolve(_adminsResult) }),
          }),
        };
      }
      if (table === 'notifications') {
        return {
          insert: (rows: unknown[]) => {
            _notifInsertPayload = rows as unknown[];
            return { select: () => Promise.resolve(_notifInsertResult) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  _adminsResult = { data: [], error: null };
  _notifInsertPayload = null;
  _notifInsertResult = { data: [], error: null };
  _schoolAdminQueries = 0;
});

async function run(schoolId: string | null) {
  const { escalateSafeguarding } = await import('@/app/api/foxy/_lib/safeguarding-escalate');
  return escalateSafeguarding({
    escalationId: 'esc-uuid-1',
    schoolId,
    category: 'self_harm',
  });
}

describe('escalateSafeguarding', () => {
  it('inserts one notification per active admin with metadata-only data payload', async () => {
    _adminsResult = { data: [{ id: 'admin-1' }, { id: 'admin-2' }], error: null };
    _notifInsertResult = { data: [{ id: 'n1' }, { id: 'n2' }], error: null };

    const result = await run('school-uuid-1');
    expect(result.notifiedAdminCount).toBe(2);

    const rows = _notifInsertPayload as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.recipient_type).toBe('school_admin');
      expect(row.type).toBe('safeguarding_escalation');
      expect(row.notification_type).toBe('safeguarding_escalation');
      expect(row.delivery_channel).toBe('in_app');
      expect(row.sender_type).toBe('system');
      expect(row.sender_id).toBeNull();
      // data = { escalation_id, category } ONLY.
      expect(Object.keys(row.data as Record<string, unknown>).sort()).toEqual([
        'category',
        'escalation_id',
      ]);
    }
    expect(rows.map((r) => r.recipient_id)).toEqual(['admin-1', 'admin-2']);
  });

  it('NEVER carries the disclosure excerpt / student text anywhere in the notification payload', async () => {
    _adminsResult = { data: [{ id: 'admin-1' }], error: null };
    _notifInsertResult = { data: [{ id: 'n1' }], error: null };
    await run('school-uuid-1');
    const serialized = JSON.stringify(_notifInsertPayload);
    expect(serialized).not.toContain('disclosure');
    expect(serialized).not.toContain('excerpt');
    expect(serialized).not.toMatch(/student_id|name|email|phone/i);
  });

  it('zero active admins → no insert, count 0 (case row still stands)', async () => {
    _adminsResult = { data: [], error: null };
    const result = await run('school-uuid-1');
    expect(result.notifiedAdminCount).toBe(0);
    expect(_notifInsertPayload).toBeNull();
  });

  it('B2C student (null schoolId) → no fan-out at all, count 0', async () => {
    const result = await run(null);
    expect(result.notifiedAdminCount).toBe(0);
    expect(_schoolAdminQueries).toBe(0);
    expect(_notifInsertPayload).toBeNull();
  });

  it('never throws: admin-lookup DB error resolves to count 0', async () => {
    _adminsResult = { data: null, error: { message: 'boom' } };
    const result = await run('school-uuid-1');
    expect(result.notifiedAdminCount).toBe(0);
  });
});
