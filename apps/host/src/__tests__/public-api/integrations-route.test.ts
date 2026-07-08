/**
 * Track A.6 — Marketplace install / uninstall route tests.
 * (`src/app/api/school-admin/integrations/{install,uninstall}/route.ts`)
 * ============================================================================
 * Covers (per the testing brief, item 7):
 *   - Lifecycle: fresh install → 201 active; transition of an existing non-
 *     uninstalled row → 200; uninstall sets status='uninstalled' (terminal).
 *   - One active install per (school, listing): a 23505 unique-violation on insert
 *     surfaces as 409 (not 500).
 *   - config rejects secret-shaped keys (secret/api_key/key/token/password) → 400.
 *   - own-school only: school_id from auth, never the body; every mutation is
 *     scoped to auth.schoolId.
 *   - permission gate public_api.manage; 403 short-circuits before DB I/O.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockAuthorize, mockLogSchoolAudit, db } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockLogSchoolAudit: vi.fn().mockResolvedValue(undefined),
  db: {
    listing: { id: 'listing-1', is_active: true } as Record<string, unknown> | null,
    existingInstall: null as Record<string, unknown> | null,
    insertError: null as { code?: string; message: string } | null,
    inserts: [] as Array<Record<string, unknown>>,
    updates: [] as Array<{ patch: Record<string, unknown>; eqs: Array<{ col: string; val: unknown }> }>,
    uninstallResult: { id: 'inst-1', listing_id: 'listing-1', status: 'uninstalled' } as Record<string, unknown> | null,
  },
}));

vi.mock('@alfanumrik/lib/school-admin-auth', () => ({ authorizeSchoolAdmin: (...a: unknown[]) => mockAuthorize(...a) }));
vi.mock('@alfanumrik/lib/audit', () => ({ logSchoolAudit: (...a: unknown[]) => mockLogSchoolAudit(...a) }));
vi.mock('@alfanumrik/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'integration_listings') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.listing, error: null }) }) }),
        };
      }
      if (table === 'integration_installs') {
        const builder: Record<string, unknown> = {};
        // INSTALL lookup: .select().eq('school_id').eq('listing_id').neq('status').maybeSingle()
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.neq = () => builder;
        builder.maybeSingle = async () => ({ data: db.existingInstall, error: null });
        // INSTALL insert: .insert(row).select().single()
        builder.insert = (row: Record<string, unknown>) => {
          db.inserts.push(row);
          return {
            select: () => ({
              single: async () =>
                db.insertError
                  ? { data: null, error: db.insertError }
                  : { data: { id: 'inst-new', status: row.status }, error: null },
            }),
          };
        };
        // INSTALL transition + UNINSTALL: .update(patch).eq(...).{select().single() | select().maybeSingle()}
        builder.update = (patch: Record<string, unknown>) => {
          const rec = { patch, eqs: [] as Array<{ col: string; val: unknown }> };
          db.updates.push(rec);
          const chain: Record<string, unknown> = {};
          chain.eq = (col: string, val: unknown) => {
            rec.eqs.push({ col, val });
            return chain;
          };
          chain.neq = () => chain;
          chain.select = () => ({
            single: async () => ({ data: { id: 'inst-1', status: patch.status }, error: null }),
            maybeSingle: async () => ({ data: db.uninstallResult, error: null }),
          });
          return chain;
        };
        return builder;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { POST as INSTALL } from '@/app/api/school-admin/integrations/install/route';
import { POST as UNINSTALL } from '@/app/api/school-admin/integrations/uninstall/route';

const SCHOOL_A = 'school-A';
const SCHOOL_B = 'school-B';

function authedAs(schoolId = SCHOOL_A) {
  mockAuthorize.mockResolvedValue({ authorized: true, schoolId, userId: 'admin-1', schoolAdminId: 'r' });
}
function denied(status = 403) {
  mockAuthorize.mockResolvedValue({
    authorized: false, schoolId: null, userId: null,
    errorResponse: new Response(JSON.stringify({ success: false, error: 'Forbidden' }), { status }),
  });
}
function installReq(body: unknown) {
  return new Request('http://localhost/api/school-admin/integrations/install', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function uninstallReq(body: unknown) {
  return new Request('http://localhost/api/school-admin/integrations/uninstall', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.listing = { id: 'listing-1', is_active: true };
  db.existingInstall = null;
  db.insertError = null;
  db.inserts.length = 0;
  db.updates.length = 0;
  db.uninstallResult = { id: 'inst-1', listing_id: 'listing-1', status: 'uninstalled' };
});

describe('integrations install — lifecycle', () => {
  it('fresh install → 201 active', async () => {
    authedAs();
    const res = await INSTALL(installReq({ listing_id: 'listing-1' }) as never);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { status: string } };
    expect(json.data.status).toBe('active');
    expect(db.inserts).toHaveLength(1);
  });

  it('transition of an existing non-uninstalled row → 200 (update, no new insert)', async () => {
    authedAs();
    db.existingInstall = { id: 'inst-1', status: 'active' };
    const res = await INSTALL(installReq({ listing_id: 'listing-1', status: 'paused' }) as never);
    expect(res.status).toBe(200);
    expect(db.inserts).toHaveLength(0);
    expect(db.updates[0].patch).toMatchObject({ status: 'paused' });
  });

  it('uninstall sets status="uninstalled" (terminal)', async () => {
    authedAs();
    const res = await UNINSTALL(uninstallReq({ listing_id: 'listing-1' }) as never);
    expect(res.status).toBe(200);
    expect(db.updates[0].patch).toMatchObject({ status: 'uninstalled' });
  });

  it('uninstall with no active install → 404', async () => {
    authedAs();
    db.uninstallResult = null;
    const res = await UNINSTALL(uninstallReq({ listing_id: 'listing-1' }) as never);
    expect(res.status).toBe(404);
  });

  it('install of an inactive/missing listing → 404', async () => {
    authedAs();
    db.listing = null;
    const res = await INSTALL(installReq({ listing_id: 'gone' }) as never);
    expect(res.status).toBe(404);
    expect(db.inserts).toHaveLength(0);
  });
});

describe('integrations install — one active install per (school, listing)', () => {
  it('a 23505 unique violation on insert surfaces as 409, not 500', async () => {
    authedAs();
    db.insertError = { code: '23505', message: 'duplicate key' };
    const res = await INSTALL(installReq({ listing_id: 'listing-1' }) as never);
    expect(res.status).toBe(409);
  });
});

describe('integrations install — config secret rejection (P13)', () => {
  it.each(['secret', 'api_key', 'apiKey', 'KEY', 'token', 'password'])(
    'rejects a config containing a secret-shaped key: %s',
    async (k) => {
      authedAs();
      const res = await INSTALL(installReq({ listing_id: 'listing-1', config: { [k]: 'REDACTED_FAKE_VALUE' } }) as never);
      expect(res.status).toBe(400);
      expect(db.inserts).toHaveLength(0);
    },
  );

  it('accepts a benign config', async () => {
    authedAs();
    const res = await INSTALL(installReq({ listing_id: 'listing-1', config: { region: 'in', sync_interval: 60 } }) as never);
    expect(res.status).toBe(201);
  });

  it('rejects a non-object config', async () => {
    authedAs();
    const res = await INSTALL(installReq({ listing_id: 'listing-1', config: ['x'] }) as never);
    expect(res.status).toBe(400);
  });
});

describe('integrations — own-school tenant isolation', () => {
  it('install persists school_id from auth, never the body', async () => {
    authedAs(SCHOOL_A);
    await INSTALL(installReq({ school_id: SCHOOL_B, listing_id: 'listing-1' }) as never);
    expect(db.inserts[0].school_id).toBe(SCHOOL_A);
    expect(db.inserts[0].school_id).not.toBe(SCHOOL_B);
  });

  it('install transition is scoped to auth.schoolId', async () => {
    authedAs(SCHOOL_A);
    db.existingInstall = { id: 'inst-1', status: 'active' };
    await INSTALL(installReq({ school_id: SCHOOL_B, listing_id: 'listing-1', status: 'paused' }) as never);
    const eqs = db.updates[0].eqs;
    expect(eqs.some((e) => e.col === 'school_id' && e.val === SCHOOL_A)).toBe(true);
    expect(eqs.some((e) => e.col === 'school_id' && e.val === SCHOOL_B)).toBe(false);
  });

  it('uninstall is scoped to auth.schoolId', async () => {
    authedAs(SCHOOL_A);
    await UNINSTALL(uninstallReq({ school_id: SCHOOL_B, listing_id: 'listing-1' }) as never);
    const eqs = db.updates[0].eqs;
    expect(eqs.some((e) => e.col === 'school_id' && e.val === SCHOOL_A)).toBe(true);
    expect(eqs.some((e) => e.col === 'school_id' && e.val === SCHOOL_B)).toBe(false);
  });
});

describe('integrations — permission gate (public_api.manage)', () => {
  it('install requests public_api.manage', async () => {
    authedAs();
    await INSTALL(installReq({ listing_id: 'listing-1' }) as never);
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), 'public_api.manage');
  });

  it('install + uninstall return 403 and do no DB I/O when unauthorized', async () => {
    denied(403);
    const r1 = await INSTALL(installReq({ listing_id: 'listing-1' }) as never);
    const r2 = await UNINSTALL(uninstallReq({ listing_id: 'listing-1' }) as never);
    expect(r1.status).toBe(403);
    expect(r2.status).toBe(403);
    expect(db.inserts).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
  });
});
