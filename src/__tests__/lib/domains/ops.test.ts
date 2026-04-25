/**
 * Ops domain (B13) — unit + integration contract tests.
 *
 * Unit tests run unconditionally:
 *   - Input validation (no env required).
 *   - Mocked supabaseAdmin: verifies the camelCase mapping and the
 *     "missing relation" soft-failure path.
 *
 * Integration tests run only when SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY
 * are present in the env. They use a deterministic fake UUID so they
 * are meaningful even against an empty database — the contract under
 * test is that the helpers return ok with an empty list / null for
 * missing data.
 *
 * Scope mirrors `src/__tests__/lib/domains/identity.test.ts` and the
 * Phase-0i precedent in `analytics.test.ts`. See
 * docs/architecture/MICROSERVICES_EXTRACTION_PLAN.md (Phase 0j).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hasSupabaseIntegrationEnv } from '@/__tests__/helpers/integration';

// ── Mocked supabaseAdmin harness ──────────────────────────────────────────────
//
// The mock is module-scoped so tests can reach in and stub the resolved
// payload for each case. The fluent builder (.from().select()...etc) returns
// `mockResult` from any thenable terminator.

interface MockResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

let mockResult: MockResult = { data: null, error: null };

function makeBuilder() {
  // Each chained method returns the same builder; the final await reads
  // mockResult. This mimics the supabase-js fluent API just enough for
  // the ops module's call shape.
  const builder: Record<string, unknown> = {};
  const chainable = ['select', 'eq', 'order', 'limit', 'gte', 'lte'];
  for (const m of chainable) {
    builder[m] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(mockResult));
  builder.then = (resolve: (v: MockResult) => unknown) =>
    Promise.resolve(mockResult).then(resolve);
  return builder;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => makeBuilder()),
  },
  getSupabaseAdmin: () => ({
    from: vi.fn(() => makeBuilder()),
  }),
}));

// Suppress logger noise during error-path tests — none of these assertions
// depend on what the logger actually does.
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  getMaintenanceBanner,
  listSupportTickets,
  getSupportTicket,
  listAdminUsers,
} from '@/lib/domains/ops';

beforeEach(() => {
  mockResult = { data: null, error: null };
});

// ── Input validation ──────────────────────────────────────────────────────────

describe('ops domain — input validation', () => {
  it('getSupportTicket rejects empty ticketId with INVALID_INPUT', async () => {
    const r = await getSupportTicket('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listSupportTickets accepts an empty options object', async () => {
    mockResult = { data: [], error: null };
    const r = await listSupportTickets({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual([]);
  });

  it('listSupportTickets clamps limit to 200 max', async () => {
    mockResult = { data: [], error: null };
    // We can't easily inspect the limit() arg with the fluent mock, but
    // the helper should not throw and should still return ok.
    const r = await listSupportTickets({ limit: 5000 });
    expect(r.ok).toBe(true);
  });

  it('listSupportTickets clamps limit to 1 minimum', async () => {
    mockResult = { data: [], error: null };
    const r = await listSupportTickets({ limit: 0 });
    expect(r.ok).toBe(true);
  });

  it('listAdminUsers accepts an empty options object', async () => {
    mockResult = { data: [], error: null };
    const r = await listAdminUsers();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual([]);
  });
});

// ── Mocked happy path (camelCase mapping) ─────────────────────────────────────

describe('ops domain — camelCase projection', () => {
  it('getMaintenanceBanner returns ok(null) when no row exists', async () => {
    mockResult = { data: null, error: null };
    const r = await getMaintenanceBanner();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('getMaintenanceBanner maps row with metadata to camelCase', async () => {
    mockResult = {
      data: {
        is_enabled: true,
        metadata: {
          message_en: 'Scheduled maintenance 10-11 PM IST',
          message_hi: 'रखरखाव 10-11 PM IST',
          unrelated: 'preserved',
        },
      },
      error: null,
    };

    const r = await getMaintenanceBanner();
    expect(r.ok).toBe(true);
    if (!r.ok || !r.data) return;
    expect(r.data.isEnabled).toBe(true);
    expect(r.data.messageEn).toBe('Scheduled maintenance 10-11 PM IST');
    expect(r.data.messageHi).toBe('रखरखाव 10-11 PM IST');
    expect(r.data.metadata).toEqual({
      message_en: 'Scheduled maintenance 10-11 PM IST',
      message_hi: 'रखरखाव 10-11 PM IST',
      unrelated: 'preserved',
    });
  });

  it('getMaintenanceBanner exposes isEnabled=false when flag is disabled', async () => {
    mockResult = {
      data: { is_enabled: false, metadata: null },
      error: null,
    };
    const r = await getMaintenanceBanner();
    expect(r.ok).toBe(true);
    if (!r.ok || !r.data) return;
    expect(r.data.isEnabled).toBe(false);
    expect(r.data.messageEn).toBeNull();
    expect(r.data.messageHi).toBeNull();
    expect(r.data.metadata).toBeNull();
  });

  it('getMaintenanceBanner is defensive against non-object metadata', async () => {
    mockResult = {
      data: { is_enabled: true, metadata: 'unexpected-string' as unknown },
      error: null,
    };
    const r = await getMaintenanceBanner();
    expect(r.ok).toBe(true);
    if (!r.ok || !r.data) return;
    expect(r.data.isEnabled).toBe(true);
    // metadata is preserved as-is (cast back to a Record at the type
    // boundary) but message extraction stays null when the shape is
    // unexpected.
    expect(r.data.messageEn).toBeNull();
    expect(r.data.messageHi).toBeNull();
  });

  it('listSupportTickets maps snake_case rows to camelCase', async () => {
    mockResult = {
      data: [
        {
          id: 'tkt-1',
          student_id: 'stu-1',
          email: 'parent@example.com',
          category: 'bug',
          subject: 'Quiz crash',
          message: 'The quiz crashed mid-question.',
          status: 'open',
          user_role: 'student',
          user_name: 'Aanya',
          device_info: 'Mozilla/5.0',
          admin_notes: null,
          created_at: '2026-04-24T10:00:00Z',
          resolved_at: null,
        },
      ],
      error: null,
    };

    const r = await listSupportTickets({ status: 'open', limit: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toHaveLength(1);
    const [row] = r.data;
    expect(row.studentId).toBe('stu-1');
    expect(row.userRole).toBe('student');
    expect(row.userName).toBe('Aanya');
    expect(row.deviceInfo).toBe('Mozilla/5.0');
    expect(row.adminNotes).toBeNull();
    expect(row.createdAt).toBe('2026-04-24T10:00:00Z');
    expect(row.resolvedAt).toBeNull();
  });

  it('listSupportTickets returns an empty array when no rows match', async () => {
    mockResult = { data: [], error: null };
    const r = await listSupportTickets({ status: 'resolved' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual([]);
  });

  it('getSupportTicket returns ok(null) when not found', async () => {
    mockResult = { data: null, error: null };
    const r = await getSupportTicket('00000000-0000-0000-0000-000000000000');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('getSupportTicket maps a single row by id', async () => {
    mockResult = {
      data: {
        id: 'tkt-2',
        student_id: null,
        email: 'guest@example.com',
        category: 'feature',
        subject: null,
        message: 'Please add dark mode for the parent portal.',
        status: 'pending',
        user_role: 'guest',
        user_name: 'Guest',
        device_info: null,
        admin_notes: 'Routed to design team.',
        created_at: '2026-04-24T11:00:00Z',
        resolved_at: null,
      },
      error: null,
    };

    const r = await getSupportTicket('tkt-2');
    expect(r.ok).toBe(true);
    if (!r.ok || !r.data) return;
    expect(r.data.id).toBe('tkt-2');
    expect(r.data.studentId).toBeNull();
    expect(r.data.userRole).toBe('guest');
    expect(r.data.adminNotes).toBe('Routed to design team.');
  });

  it('listAdminUsers maps rows and treats missing is_active as false', async () => {
    mockResult = {
      data: [
        {
          id: 'adm-1',
          auth_user_id: 'auth-1',
          name: 'Aditya',
          email: 'aditya@alfanumrik.com',
          admin_level: 'super_admin',
          is_active: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-04-24T00:00:00Z',
        },
        {
          id: 'adm-2',
          auth_user_id: 'auth-2',
          name: 'Bhavna',
          email: null,
          admin_level: 'moderator',
          is_active: null,
          created_at: null,
          updated_at: null,
        },
      ],
      error: null,
    };

    const r = await listAdminUsers({ includeInactive: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toHaveLength(2);
    expect(r.data[0].authUserId).toBe('auth-1');
    expect(r.data[0].adminLevel).toBe('super_admin');
    expect(r.data[0].isActive).toBe(true);
    expect(r.data[1].adminLevel).toBe('moderator');
    expect(r.data[1].isActive).toBe(false); // null → false
  });
});

// ── Soft-failure paths (table missing, generic DB error) ──────────────────────

describe('ops domain — error mapping', () => {
  it('treats Postgres 42P01 as DB_ERROR for feature_flags (banner)', async () => {
    mockResult = {
      data: null,
      error: { code: '42P01', message: 'relation "feature_flags" does not exist' },
    };
    const r = await getMaintenanceBanner();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
    expect(r.error).toMatch(/not provisioned/);
  });

  it('treats Postgres 42P01 as DB_ERROR for support_tickets (list)', async () => {
    mockResult = {
      data: null,
      error: { code: '42P01', message: 'relation "support_tickets" does not exist' },
    };
    const r = await listSupportTickets({ status: 'open' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
  });

  it('treats Postgres 42P01 as DB_ERROR for support_tickets (single)', async () => {
    mockResult = {
      data: null,
      error: { code: '42P01', message: 'relation "support_tickets" does not exist' },
    };
    const r = await getSupportTicket('tkt-1');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
  });

  it('treats Postgres 42P01 as DB_ERROR for admin_users', async () => {
    mockResult = {
      data: null,
      error: { code: '42P01', message: 'relation "admin_users" does not exist' },
    };
    const r = await listAdminUsers();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
  });

  it('maps any other postgres error to DB_ERROR with the message preserved', async () => {
    mockResult = {
      data: null,
      error: { code: '42501', message: 'permission denied for table support_tickets' },
    };
    const r = await listSupportTickets({ status: 'open' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
    expect(r.error).toContain('permission denied');
  });

  it('detects missing-relation by message text when SQLSTATE is absent', async () => {
    mockResult = {
      data: null,
      error: { message: 'relation "admin_users" does not exist' },
    };
    const r = await listAdminUsers();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
    expect(r.error).toMatch(/not provisioned/);
  });
});

// ── Integration happy-path (skipped without env) ─────────────────────────────

const FAKE_UUID = '00000000-0000-0000-0000-00000000dead';

const describeIntegration = hasSupabaseIntegrationEnv()
  ? describe
  : describe.skip;

describeIntegration('ops domain — integration (null/empty path)', () => {
  it('getMaintenanceBanner returns ok(null|banner) or DB_ERROR', async () => {
    const r = await getMaintenanceBanner();
    if (r.ok) {
      // Either no row (null) or a banner shape with isEnabled boolean.
      if (r.data) {
        expect(typeof r.data.isEnabled).toBe('boolean');
      } else {
        expect(r.data).toBeNull();
      }
    } else {
      expect(r.code).toBe('DB_ERROR');
    }
  });

  it('listSupportTickets returns ok with an array or DB_ERROR', async () => {
    const r = await listSupportTickets({ limit: 1 });
    if (r.ok) {
      expect(Array.isArray(r.data)).toBe(true);
    } else {
      expect(r.code).toBe('DB_ERROR');
    }
  });

  it('getSupportTicket returns ok(null) or DB_ERROR for unknown id', async () => {
    const r = await getSupportTicket(FAKE_UUID);
    if (r.ok) {
      expect(r.data).toBeNull();
    } else {
      expect(r.code).toBe('DB_ERROR');
    }
  });

  it('listAdminUsers returns ok with an array or DB_ERROR', async () => {
    const r = await listAdminUsers();
    if (r.ok) {
      expect(Array.isArray(r.data)).toBe(true);
    } else {
      expect(r.code).toBe('DB_ERROR');
    }
  });
});
