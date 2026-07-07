/**
 * /api/school-admin/branding — Phase B typography extension tests.
 *
 * Covers the new behaviour added on top of the existing GET/PUT:
 *   GET — response includes tenant_type, font_heading, font_body,
 *         border_radius_px (read-only mirrors of the schools row).
 *   PUT — accepts font_heading, font_body, border_radius_px with
 *         validation; ignores tenant_type even if sent (super-admin
 *         scope, not school-admin).
 *
 * Pre-existing GET/PUT semantics for color / tagline / billing_email are
 * not re-tested here — they're stable behaviour the change deliberately
 * left alone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Auth mock ─────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...args: unknown[]) => _authorizeImpl(...args),
}));
function authedAs(schoolId: string) {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    schoolId,
    permissions: ['school.manage_branding'],
  });
}

// ── Logger silencer ──────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Domain layer mock for GET (route uses getSchoolById) ──────────────
const _getSchoolById = vi.fn();
vi.mock('@alfanumrik/lib/domains/tenant', () => ({
  getSchoolById: (...args: unknown[]) => _getSchoolById(...args),
}));

// ── supabaseAdmin mock for PUT (route uses .from('schools').update) ──
// Captures the args passed to .update() so tests can assert on them
// (e.g. tenant_type is NOT in the patch even when sent in the body).
const supabaseUpdate = vi.fn();           // returns { data, error } from .single()
const supabaseUpdateArgs: unknown[] = []; // mutable list of update() calls

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      update: (patch: unknown) => {
        supabaseUpdateArgs.push(patch);
        return {
          eq: () => ({
            select: () => ({
              single: () => supabaseUpdate(),
            }),
          }),
        };
      },
    }),
  }),
}));

import { GET, PUT } from '@/app/api/school-admin/branding/route';

beforeEach(() => {
  _authorizeImpl.mockReset();
  _getSchoolById.mockReset();
  supabaseUpdate.mockReset();
  supabaseUpdateArgs.length = 0;
});

function makeRequest(method: 'GET' | 'PUT', body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/school-admin/branding', {
    method,
    body: body !== undefined ? JSON.stringify(body) : null,
    headers: { 'content-type': 'application/json' },
  });
}

const HAPPY_DOMAIN_SCHOOL = {
  id: 'school-1',
  name: 'DPS',
  code: null,
  slug: 'dps',
  logoUrl: null,
  primaryColor: '#7C3AED',
  secondaryColor: '#F97316',
  tagline: null,
  customDomain: null,
  domainVerified: false,
  billingEmail: null,
  isActive: true,
  tenantType: 'coaching' as const,
  fontHeading: 'Inter, system-ui',
  fontBody: 'system-ui',
  borderRadiusPx: 12,
  settings: {},
};

describe('GET /api/school-admin/branding — Phase B fields', () => {
  it('exposes tenant_type, font_heading, font_body, border_radius_px in the response', async () => {
    authedAs('school-1');
    _getSchoolById.mockResolvedValueOnce({ ok: true, data: HAPPY_DOMAIN_SCHOOL });

    const res = await GET(makeRequest('GET'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.tenant_type).toBe('coaching');
    expect(body.data.font_heading).toBe('Inter, system-ui');
    expect(body.data.font_body).toBe('system-ui');
    expect(body.data.border_radius_px).toBe(12);
  });

  it('returns the legacy fields unchanged alongside the new ones', async () => {
    authedAs('school-1');
    _getSchoolById.mockResolvedValueOnce({ ok: true, data: HAPPY_DOMAIN_SCHOOL });

    const res = await GET(makeRequest('GET'));
    const body = await res.json();

    expect(body.data.id).toBe('school-1');
    expect(body.data.slug).toBe('dps');
    expect(body.data.primary_color).toBe('#7C3AED');
    expect(body.data.secondary_color).toBe('#F97316');
  });
});

describe('PUT /api/school-admin/branding — Phase B accept', () => {
  it('persists font_heading + font_body + border_radius_px', async () => {
    authedAs('school-1');
    supabaseUpdate.mockResolvedValueOnce({
      data: {
        ...HAPPY_DOMAIN_SCHOOL,
        font_heading: 'Roboto', font_body: 'Inter', border_radius_px: 8,
      },
      error: null,
    });

    const res = await PUT(makeRequest('PUT', {
      font_heading: 'Roboto',
      font_body: 'Inter',
      border_radius_px: 8,
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.font_heading).toBe('Roboto');
    expect(body.data.font_body).toBe('Inter');
    expect(body.data.border_radius_px).toBe(8);
  });

  it('accepts null to clear typography fields', async () => {
    authedAs('school-1');
    supabaseUpdate.mockResolvedValueOnce({
      data: { ...HAPPY_DOMAIN_SCHOOL, font_heading: null, font_body: null, border_radius_px: null },
      error: null,
    });
    const res = await PUT(makeRequest('PUT', { font_heading: null, font_body: null, border_radius_px: null }));
    expect(res.status).toBe(200);
  });

  it('accepts the boundary border_radius values 0 and 32', async () => {
    authedAs('school-1');
    supabaseUpdate.mockResolvedValue({ data: HAPPY_DOMAIN_SCHOOL, error: null });

    let res = await PUT(makeRequest('PUT', { border_radius_px: 0 }));
    expect(res.status).toBe(200);

    res = await PUT(makeRequest('PUT', { border_radius_px: 32 }));
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/school-admin/branding — Phase B validation', () => {
  it('rejects font_heading that is not a string or null', async () => {
    authedAs('school-1');
    const res = await PUT(makeRequest('PUT', { font_heading: 42 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/font_heading/);
    expect(supabaseUpdate).not.toHaveBeenCalled();
  });

  it('rejects font_body longer than 200 chars', async () => {
    authedAs('school-1');
    const res = await PUT(makeRequest('PUT', { font_body: 'a'.repeat(201) }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/200 characters/);
  });

  it('rejects border_radius_px out of range', async () => {
    authedAs('school-1');
    // NaN is dropped to null by JSON.stringify so we don't include it here
    // (the route correctly treats null as "clear the field"). Stays in the
    // route's pure-typescript guard for non-JSON callers.
    const cases = [-1, 33, 9999, 1.5, '12'];
    for (const v of cases) {
      const res = await PUT(makeRequest('PUT', { border_radius_px: v }));
      expect(res.status, `value=${String(v)}`).toBe(400);
    }
  });
});

describe('PUT /api/school-admin/branding — tenant_type is intentionally ignored', () => {
  it('does not include tenant_type in the schools UPDATE patch even when sent in the body', async () => {
    authedAs('school-1');
    supabaseUpdate.mockResolvedValueOnce({ data: HAPPY_DOMAIN_SCHOOL, error: null });

    await PUT(makeRequest('PUT', {
      tenant_type: 'corporate',
      font_heading: 'Roboto',
    }));

    expect(supabaseUpdateArgs).toHaveLength(1);
    const patch = supabaseUpdateArgs[0] as Record<string, unknown>;
    expect(patch.font_heading).toBe('Roboto');
    expect(patch).not.toHaveProperty('tenant_type');
  });
});
