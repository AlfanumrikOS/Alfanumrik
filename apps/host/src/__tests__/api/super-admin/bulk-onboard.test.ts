/**
 * POST /api/super-admin/institutions/bulk-onboard
 *
 * Pins the contract added in this PR:
 *
 *   - dry_run=true returns row-by-row outcomes WITHOUT calling the
 *     underlying provisioner. No school row, no invite code, no email.
 *   - dry_run=false routes through `provisionTrialSchool` and reports
 *     `created` outcomes with the returned school_id.
 *   - Rows whose email already exists in `schools` are reported as
 *     `skipped: 'already_exists'` (not failed) so re-uploading the same
 *     CSV is idempotent.
 *   - Pre-validation errors (missing required fields, malformed email)
 *     fail the row WITHOUT incrementing created or skipped counters.
 *   - Mixed CSV: a single payload with valid + invalid + duplicate rows
 *     aggregates the totals correctly.
 *   - 200-row cap enforced — 201 rows returns 413 with no provisioning.
 *
 * Mocking style mirrors the other super-admin route tests in this dir.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Module mocks (hoisted before route import) ────────────────────────

const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn();

vi.mock('@alfanumrik/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
  logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
}));

// Per-test state for the supabase-admin mock — toggled by setExistingEmails().
const existingEmails = new Set<string>();

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      if (table === 'schools') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: existingEmails.has(String(val).toLowerCase())
                    ? { id: `existing-${val}` }
                    : null,
                  error: null,
                }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        }),
        insert: () => Promise.resolve({ error: null }),
      };
    },
  }),
}));

// Mock the provisioner — we test the orchestration in this route, not the
// provisioner itself (the provisioner has its own coverage via the
// schools-trial-email-delivery test pinned for the trial route).
const provisionTrialSchool = vi.fn();
const validateEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

vi.mock('@alfanumrik/lib/school-provisioning', () => ({
  provisionTrialSchool: (...args: unknown[]) => provisionTrialSchool(...args),
  validateEmail: (e: string) => validateEmail(e),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Import route AFTER mocks ─────────────────────────────────────────
import { POST, MAX_ROWS_PER_CSV } from '@/app/api/super-admin/institutions/bulk-onboard/route';

// ── Helpers ──────────────────────────────────────────────────────────

function makeAuthOk() {
  authorizeAdmin.mockResolvedValue({
    authorized: true,
    userId: 'user-1',
    adminId: 'admin-1',
    email: 'admin@alfanumrik.com',
    name: 'Admin',
    adminLevel: 'super',
  });
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/institutions/bulk-onboard', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const HEADER =
  'school_name,principal_name,principal_email,phone,board,city,state,grade_range_min,grade_range_max,admin_email';

function csvOf(rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

function setExistingEmails(...emails: string[]) {
  existingEmails.clear();
  for (const e of emails) existingEmails.add(e.toLowerCase());
}

beforeEach(() => {
  authorizeAdmin.mockReset();
  logAdminAudit.mockReset();
  provisionTrialSchool.mockReset();
  setExistingEmails();
  makeAuthOk();
  logAdminAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────

describe('POST /api/super-admin/institutions/bulk-onboard', () => {
  it('rejects unauthenticated requests with the auth helper response', async () => {
    authorizeAdmin.mockResolvedValueOnce({
      authorized: false,
      response: new Response(JSON.stringify({ error: 'nope' }), { status: 401 }),
    });
    const res = await POST(
      makeRequest({
        csv: csvOf(['Foo School,Anita,a@b.co,,,,,,,']),
        dry_run: true,
      }),
    );
    expect(res.status).toBe(401);
    expect(provisionTrialSchool).not.toHaveBeenCalled();
  });

  it('rejects an invalid JSON body with 400', async () => {
    const req = new NextRequest('http://localhost/api/super-admin/institutions/bulk-onboard', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects a CSV missing required columns', async () => {
    const res = await POST(
      makeRequest({
        csv: 'school_name,principal_name\nFoo,Bar',
        dry_run: true,
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/missing required columns/i);
    expect(provisionTrialSchool).not.toHaveBeenCalled();
  });

  it('dry_run=true does NOT call the provisioner and reports would-be-created rows', async () => {
    const res = await POST(
      makeRequest({
        csv: csvOf([
          'Alpha School,Anita Verma,principal-a@example.in,,,,,,,',
          'Beta School,Rajesh Kumar,principal-b@example.in,,,,,,,',
        ]),
        dry_run: true,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(provisionTrialSchool).not.toHaveBeenCalled();
    expect(body.data.dry_run).toBe(true);
    expect(body.data.created).toBe(2);
    expect(body.data.skipped).toBe(0);
    expect(body.data.failed).toBe(0);
    expect(body.data.rows.every((r: { status: string }) => r.status === 'created')).toBe(true);
  });

  it('dry_run=true with an existing email reports skipped: already_exists (no provisioning)', async () => {
    setExistingEmails('dupe@example.in');
    const res = await POST(
      makeRequest({
        csv: csvOf([
          'Alpha School,Anita,fresh@example.in,,,,,,,',
          'Dupe School,Anita,dupe@example.in,,,,,,,',
        ]),
        dry_run: true,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(provisionTrialSchool).not.toHaveBeenCalled();
    expect(body.data.created).toBe(1);
    expect(body.data.skipped).toBe(1);
    expect(body.data.failed).toBe(0);
    const dupeRow = body.data.rows.find((r: { row_index: number }) => r.row_index === 3);
    expect(dupeRow.status).toBe('skipped');
    expect(dupeRow.reason).toBe('already_exists');
  });

  it('dry_run=false routes through provisionTrialSchool and returns the school_id', async () => {
    provisionTrialSchool.mockResolvedValue({
      status: 'created',
      school_id: 'school-xyz',
      slug: 'alpha-school',
      subdomain: 'alpha-school.alfanumrik.com',
      invite_code: 'ABCD1234',
      trial_days: 30,
      seats: 50,
      subscription_created: true,
      invite_stored: true,
      email_dispatched: true,
    });
    const res = await POST(
      makeRequest({
        csv: csvOf(['Alpha School,Anita,a@example.in,,,,,,,']),
        dry_run: false,
      }),
    );
    expect(res.status).toBe(200);
    expect(provisionTrialSchool).toHaveBeenCalledTimes(1);
    const call = provisionTrialSchool.mock.calls[0][0];
    expect(call.school_name).toBe('Alpha School');
    expect(call.principal_email).toBe('a@example.in');
    expect(call.sendEmail).toBe(true);
    const body = await res.json();
    expect(body.data.created).toBe(1);
    expect(body.data.rows[0].school_id).toBe('school-xyz');
  });

  it('duplicates are skipped not failed (idempotent re-runs)', async () => {
    setExistingEmails('already@example.in');
    provisionTrialSchool.mockResolvedValue({
      status: 'created',
      school_id: 'school-new',
      slug: 'new',
      subdomain: 'new.alfanumrik.com',
      trial_days: 30,
      seats: 50,
      subscription_created: true,
      invite_stored: true,
      email_dispatched: true,
    });
    const res = await POST(
      makeRequest({
        csv: csvOf([
          'New School,Anita,new@example.in,,,,,,,',
          'Old School,Rajesh,already@example.in,,,,,,,',
        ]),
        dry_run: false,
      }),
    );
    const body = await res.json();
    // Only the non-duplicate row reached the provisioner.
    expect(provisionTrialSchool).toHaveBeenCalledTimes(1);
    expect(body.data.created).toBe(1);
    expect(body.data.skipped).toBe(1);
    expect(body.data.failed).toBe(0);
    const dupe = body.data.rows.find((r: { reason?: string }) => r.reason === 'already_exists');
    expect(dupe).toBeTruthy();
  });

  it('invalid rows are reported as failed with a reason, no provisioning', async () => {
    const res = await POST(
      makeRequest({
        csv: csvOf([
          ',Anita,a@example.in,,,,,,,', // missing school_name
          'Beta School,,b@example.in,,,,,,,', // missing principal_name
          'Gamma School,Anita,not-an-email,,,,,,,', // bad email
        ]),
        dry_run: true,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(provisionTrialSchool).not.toHaveBeenCalled();
    expect(body.data.created).toBe(0);
    expect(body.data.failed).toBe(3);
    expect(body.data.rows.every((r: { status: string; error?: string }) => r.status === 'failed' && r.error)).toBe(true);
  });

  it('mixed CSV aggregates created/skipped/failed correctly', async () => {
    setExistingEmails('dupe@example.in');
    provisionTrialSchool
      .mockResolvedValueOnce({
        status: 'created',
        school_id: 'school-1',
        slug: 'alpha',
        subdomain: 'alpha.alfanumrik.com',
        trial_days: 30,
        seats: 50,
        subscription_created: true,
        invite_stored: true,
        email_dispatched: true,
      })
      .mockResolvedValueOnce({
        status: 'failed',
        error: 'DB exploded',
      });
    const res = await POST(
      makeRequest({
        csv: csvOf([
          'Alpha,Anita,alpha@example.in,,,,,,,', // → created
          'Beta,Rajesh,dupe@example.in,,,,,,,', // → skipped (existing email)
          ',Anita,gamma@example.in,,,,,,,', // → failed (no school_name)
          'Delta,Anita,delta@example.in,,,,,,,', // → failed (provisioner returns failed)
        ]),
        dry_run: false,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.total).toBe(4);
    expect(body.data.created).toBe(1);
    expect(body.data.skipped).toBe(1);
    expect(body.data.failed).toBe(2);
    expect(provisionTrialSchool).toHaveBeenCalledTimes(2); // not called for skipped or failed-validation rows
  });

  it('within-CSV duplicate emails are skipped on the 2nd occurrence', async () => {
    provisionTrialSchool.mockResolvedValue({
      status: 'created',
      school_id: 'school-1',
      slug: 'alpha',
      subdomain: 'alpha.alfanumrik.com',
      trial_days: 30,
      seats: 50,
      subscription_created: true,
      invite_stored: true,
      email_dispatched: true,
    });
    const res = await POST(
      makeRequest({
        csv: csvOf([
          'Alpha,Anita,same@example.in,,,,,,,',
          'Beta,Rajesh,same@example.in,,,,,,,',
        ]),
        dry_run: false,
      }),
    );
    const body = await res.json();
    expect(body.data.created).toBe(1);
    expect(body.data.skipped).toBe(1);
    expect(provisionTrialSchool).toHaveBeenCalledTimes(1);
    const dupe = body.data.rows.find((r: { reason?: string }) => r.reason === 'duplicate_in_csv');
    expect(dupe).toBeTruthy();
  });

  it('CSV with more than the row cap is rejected with 413 — no provisioning', async () => {
    const tooMany = Array.from(
      { length: MAX_ROWS_PER_CSV + 1 },
      (_, i) => `School ${i},Anita,p${i}@example.in,,,,,,,`,
    );
    const res = await POST(
      makeRequest({
        csv: csvOf(tooMany),
        dry_run: true,
      }),
    );
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toMatch(/200/);
    expect(provisionTrialSchool).not.toHaveBeenCalled();
  });

  it('writes super_admin.bulk_onboard_started and _completed audit entries', async () => {
    provisionTrialSchool.mockResolvedValue({
      status: 'created',
      school_id: 'school-1',
      slug: 'alpha',
      subdomain: 'alpha.alfanumrik.com',
      trial_days: 30,
      seats: 50,
      subscription_created: true,
      invite_stored: true,
      email_dispatched: true,
    });
    await POST(
      makeRequest({
        csv: csvOf(['Alpha,Anita,alpha@example.in,,,,,,,']),
        dry_run: false,
        csv_filename: 'pune-batch.csv',
      }),
    );
    const actions = logAdminAudit.mock.calls.map((c) => c[1]);
    expect(actions).toContain('super_admin.bulk_onboard_started');
    expect(actions).toContain('super_admin.bulk_onboard_completed');
    expect(actions).toContain('school.bulk_onboarded');
    // per-row audit carries csv_filename
    const perRow = logAdminAudit.mock.calls.find((c) => c[1] === 'school.bulk_onboarded');
    expect(perRow?.[4].csv_filename).toBe('pune-batch.csv');
    expect(perRow?.[4].row_index).toBe(2);
  });
});
