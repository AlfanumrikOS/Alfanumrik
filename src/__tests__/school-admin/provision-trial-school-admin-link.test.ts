/**
 * provisionTrialSchool() — Track A admin-linkage additions.
 *
 * Pins the NEW behaviour layered onto the trial provisioner in
 * src/lib/school-provisioning.ts:
 *
 *   - On a fresh create, a 'principal' school_admins link is established (via the
 *     find-or-create auth user path) and the result reports admin_linked=true.
 *   - The principal's invite_code row is issued with role_type 'admin' (NOT
 *     'teacher' — the Track A change) so the principal claims an ADMIN seat.
 *   - A one-time claim token is minted and only its HASH is stored
 *     (school_admin_claim_tokens never receives the raw token).
 *   - Idempotency: when the principal's auth user already exists (createUser
 *     errors "already registered"), the helper LISTS + matches rather than
 *     failing — provisioning still links + succeeds.
 *   - sendEmail:false (dry-run) suppresses the transactional mail entirely.
 *
 * Pure unit test against a per-table in-memory fake admin client + a stubbed
 * GoTrue admin API (mirrors the fake-client style in
 * src/__tests__/api/schools-trial-email-delivery.test.ts). No live DB.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Capture email dispatches; never actually send.
const deliverEmail = vi.fn().mockResolvedValue({ sent: true });
vi.mock('@/lib/email-delivery', () => ({
  deliverEmail: (...a: unknown[]) => deliverEmail(...a),
  truncateInviteCode: (c: string) => `${c.slice(0, 2)}***`,
}));

// ── Captured writes ────────────────────────────────────────────────────
interface Captured {
  inviteCodeInserts: Array<Record<string, unknown>>;
  schoolAdminInserts: Array<Record<string, unknown>>;
  claimTokenInserts: Array<Record<string, unknown>>;
  createdUsers: Array<{ email: string }>;
  listUsersCalled: number;
}

let cap: Captured;

interface AdminOpts {
  /** Simulate "auth user already registered" → createUser errors, list+match path. */
  authUserAlreadyExists?: boolean;
  /** Simulate an existing school_admins link for the principal (idempotent reuse). */
  existingSchoolAdminLink?: boolean;
}

function makeAdmin(opts: AdminOpts = {}) {
  return {
    auth: {
      admin: {
        createUser: async ({ email }: { email: string }) => {
          if (opts.authUserAlreadyExists) {
            return { data: { user: null }, error: { message: 'A user with this email already exists' } };
          }
          cap.createdUsers.push({ email });
          return { data: { user: { id: 'auth-new' } }, error: null };
        },
        listUsers: async () => {
          cap.listUsersCalled++;
          return {
            data: { users: [{ id: 'auth-existing', email: 'principal@track-a.example.in' }] },
            error: null,
          };
        },
      },
    },
    from(table: string) {
      switch (table) {
        case 'schools':
          return {
            select: () => ({
              eq: () => ({
                // slug uniqueness check + email-dup check both use maybeSingle → null.
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: async () => ({ data: { id: 'school-1', code: 'track-a-school' }, error: null }),
              }),
            }),
          };
        case 'school_subscriptions':
          return { insert: async () => ({ error: null }) };
        case 'school_invite_codes':
          return {
            insert: async (row: Record<string, unknown>) => {
              cap.inviteCodeInserts.push(row);
              return { error: null };
            },
          };
        case 'school_admins':
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: opts.existingSchoolAdminLink
                      ? { id: 'sa-existing', is_active: true }
                      : null,
                    error: null,
                  }),
                }),
              }),
            }),
            insert: (row: Record<string, unknown>) => {
              cap.schoolAdminInserts.push(row);
              return {
                select: () => ({
                  single: async () => ({ data: { id: 'sa-new' }, error: null }),
                }),
              };
            },
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        case 'school_admin_claim_tokens':
          return {
            insert: async (row: Record<string, unknown>) => {
              cap.claimTokenInserts.push(row);
              return { error: null };
            },
          };
        default:
          throw new Error(`unexpected table ${table}`);
      }
    },
  };
}

const adminRef = { current: makeAdmin() };
vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => adminRef.current,
}));

import { provisionTrialSchool } from '@/lib/school-provisioning';

const BASE_INPUT = {
  school_name: 'Track A Public School',
  principal_name: 'Anita Verma',
  principal_email: 'principal@track-a.example.in',
  board: 'CBSE',
};

beforeEach(() => {
  cap = {
    inviteCodeInserts: [],
    schoolAdminInserts: [],
    claimTokenInserts: [],
    createdUsers: [],
    listUsersCalled: 0,
  };
  deliverEmail.mockClear();
  adminRef.current = makeAdmin();
});

describe('provisionTrialSchool — principal admin linkage (Track A)', () => {
  it('establishes a principal school_admins link and reports admin_linked=true', async () => {
    const res = await provisionTrialSchool({ ...BASE_INPUT, sendEmail: false });
    expect(res.status).toBe('created');
    if (res.status !== 'created') return;
    expect(res.admin_linked).toBe(true);
    expect(res.school_admin_id).toBe('sa-new');

    // The inserted school_admins row is role 'principal' + active.
    expect(cap.schoolAdminInserts.length).toBe(1);
    expect(cap.schoolAdminInserts[0]).toMatchObject({
      school_id: 'school-1',
      role: 'principal',
      is_active: true,
    });
  });

  it("issues the principal invite with role_type 'admin', NOT 'teacher'", async () => {
    await provisionTrialSchool({ ...BASE_INPUT, sendEmail: false });
    expect(cap.inviteCodeInserts.length).toBe(1);
    expect(cap.inviteCodeInserts[0].role_type).toBe('admin');
    expect(cap.inviteCodeInserts[0].role_type).not.toBe('teacher');
  });

  it('mints a claim token and stores only its HASH (raw token never persisted)', async () => {
    await provisionTrialSchool({ ...BASE_INPUT, sendEmail: false });
    expect(cap.claimTokenInserts.length).toBe(1);
    const row = cap.claimTokenInserts[0];
    // A SHA-256 hex digest is 64 lowercase hex chars; the raw token is base64url.
    expect(typeof row.token_hash).toBe('string');
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row).not.toHaveProperty('token');
    expect(row).not.toHaveProperty('raw_token');
    expect(row.school_admin_id).toBe('sa-new');
  });
});

describe('provisionTrialSchool — idempotent auth user (already registered)', () => {
  it('links via list+match when createUser reports the user already exists', async () => {
    adminRef.current = makeAdmin({ authUserAlreadyExists: true });
    const res = await provisionTrialSchool({ ...BASE_INPUT, sendEmail: false });
    expect(res.status).toBe('created');
    if (res.status !== 'created') return;
    // The link did NOT fail even though createUser errored — it fell back to list.
    expect(res.admin_linked).toBe(true);
    expect(cap.listUsersCalled).toBeGreaterThan(0);
    expect(cap.createdUsers.length).toBe(0); // no fresh user created
    // The new school_admins row links the EXISTING auth user.
    expect(cap.schoolAdminInserts[0].auth_user_id).toBe('auth-existing');
  });

  it('reuses an existing school_admins link rather than inserting a duplicate', async () => {
    adminRef.current = makeAdmin({ existingSchoolAdminLink: true });
    const res = await provisionTrialSchool({ ...BASE_INPUT, sendEmail: false });
    expect(res.status).toBe('created');
    if (res.status !== 'created') return;
    expect(res.admin_linked).toBe(true);
    // No new school_admins INSERT — the existing row was reused.
    expect(cap.schoolAdminInserts.length).toBe(0);
    expect(res.school_admin_id).toBe('sa-existing');
  });
});

describe('provisionTrialSchool — dry-run email suppression', () => {
  it('sendEmail:false suppresses the transactional email entirely', async () => {
    const res = await provisionTrialSchool({ ...BASE_INPUT, sendEmail: false });
    expect(res.status).toBe('created');
    if (res.status !== 'created') return;
    expect(res.email_dispatched).toBe(false);
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  it('default (sendEmail unset) DOES dispatch the email after the invite persists', async () => {
    const res = await provisionTrialSchool({ ...BASE_INPUT });
    expect(res.status).toBe('created');
    if (res.status !== 'created') return;
    expect(res.email_dispatched).toBe(true);
    expect(deliverEmail).toHaveBeenCalledTimes(1);
    // The dispatched email carries the ADMIN invite code as the claim code.
    const payload = deliverEmail.mock.calls[0][0] as { template: string; params: { invite_code: string } };
    expect(payload.template).toBe('school-trial-provisioned');
    expect(payload.params.invite_code).toMatch(/^[A-Z0-9]{8}$/);
  });
});
