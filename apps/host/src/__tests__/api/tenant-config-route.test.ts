/**
 * GET /api/tenant/config — Phase B/C/D consumer endpoint.
 *
 * Covers the four behaviours the route guarantees:
 *   1. Missing x-school-id            → { isTenantContext: false }, 200
 *   2. Supabase row not found / error → { isTenantContext: false }, 200
 *   3. Happy path                     → enriched body with tenant + modules + config
 *   4. Resolver throw fallback        → { isTenantContext: false }, 200 (never 500)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── supabaseAdmin mock ────────────────────────────────────────────────
const supabaseSchoolFetch = vi.fn();
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => supabaseSchoolFetch(),
        }),
      }),
    }),
  },
}));

// ── resolver mocks ────────────────────────────────────────────────────
const enabledModulesFor = vi.fn();
const getAllTenantConfig = vi.fn();

vi.mock('@alfanumrik/lib/modules/registry', () => ({
  enabledModulesFor: (...args: unknown[]) => enabledModulesFor(...args),
}));
vi.mock('@alfanumrik/lib/tenant-config', () => ({
  getAllTenantConfig: (...args: unknown[]) => getAllTenantConfig(...args),
}));

import { GET } from '@/app/api/tenant/config/route';

beforeEach(() => {
  supabaseSchoolFetch.mockReset();
  enabledModulesFor.mockReset();
  getAllTenantConfig.mockReset();
});

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/tenant/config', { headers });
}

describe('GET /api/tenant/config', () => {
  it('returns { isTenantContext: false } when x-school-id header is absent', async () => {
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ isTenantContext: false });
    expect(supabaseSchoolFetch).not.toHaveBeenCalled();
  });

  it('falls back to no-tenant shape when supabase returns no row', async () => {
    supabaseSchoolFetch.mockResolvedValueOnce({ data: null, error: null });
    const res = await GET(makeRequest({ 'x-school-id': 'ghost-school' }));
    const body = await res.json();
    expect(body).toEqual({ isTenantContext: false });
  });

  it('falls back to no-tenant shape on supabase error', async () => {
    supabaseSchoolFetch.mockResolvedValueOnce({
      data: null,
      error: { message: 'boom' },
    });
    const res = await GET(makeRequest({ 'x-school-id': 'school-1' }));
    const body = await res.json();
    expect(body).toEqual({ isTenantContext: false });
  });

  it('returns enriched body on happy path', async () => {
    supabaseSchoolFetch.mockResolvedValueOnce({
      data: {
        id: 'school-1',
        slug: 'dps',
        name: 'Delhi Public School',
        subscription_plan: 'family',
        is_active: true,
        logo_url: 'https://cdn/logo.png',
        primary_color: '#123456',
        secondary_color: '#abcdef',
        tagline: 'Learn boldly',
        settings: {},
        tenant_type: 'coaching',
        font_heading: 'Inter',
        font_body: 'system-ui',
        border_radius_px: 10,
      },
      error: null,
    });
    enabledModulesFor.mockResolvedValueOnce({
      lms: true, ai_tutor: true, testing_engine: true, live_classes: true,
      analytics: true, crm: true, assignments: true, attendance: true, communication: true,
    });
    getAllTenantConfig.mockResolvedValueOnce({
      'theme.dark_mode_default': false,
      'ai.personality': 'rigorous_coach',
      'ai.tone': 'neutral',
      'ai.pedagogy': 'worked_example',
      'ai.default_language': 'en',
      'locale.timezone': 'Asia/Kolkata',
      'locale.currency': 'INR',
      'locale.number_format': 'en-IN',
      'communication.from_email_name': 'DPS',
    });

    const res = await GET(makeRequest({ 'x-school-id': 'school-1' }));
    const body = await res.json();

    expect(body.isTenantContext).toBe(true);
    expect(body.tenant.id).toBe('school-1');
    expect(body.tenant.tenantType).toBe('coaching');
    expect(body.tenant.branding.primaryColor).toBe('#123456');
    expect(body.tenant.typography).toEqual({
      fontHeading: 'Inter',
      fontBody: 'system-ui',
      borderRadiusPx: 10,
    });
    expect(body.modules.crm).toBe(true);
    expect(body.config['ai.personality']).toBe('rigorous_coach');

    // Resolvers must have been called with the tenant's own type.
    expect(enabledModulesFor).toHaveBeenCalledWith('school-1', 'coaching');
    expect(getAllTenantConfig).toHaveBeenCalledWith('school-1', 'coaching');
  });

  it('coerces unknown DB tenant_type back to "school" via tenantFromSchool', async () => {
    supabaseSchoolFetch.mockResolvedValueOnce({
      data: {
        id: 'school-1', slug: 's', name: 'S', subscription_plan: 'free',
        is_active: true, logo_url: null, primary_color: null,
        secondary_color: null, tagline: null, settings: null,
        tenant_type: 'monastery',
      },
      error: null,
    });
    enabledModulesFor.mockResolvedValueOnce({} as Record<string, boolean>);
    getAllTenantConfig.mockResolvedValueOnce({} as Record<string, unknown>);

    const res = await GET(makeRequest({ 'x-school-id': 'school-1' }));
    const body = await res.json();
    expect(body.tenant.tenantType).toBe('school');
    expect(enabledModulesFor).toHaveBeenCalledWith('school-1', 'school');
  });

  it('never 500s — resolver throw still returns no-tenant 200', async () => {
    supabaseSchoolFetch.mockResolvedValueOnce({
      data: {
        id: 'school-1', slug: 's', name: 'S', subscription_plan: 'free',
        is_active: true, logo_url: null, primary_color: null,
        secondary_color: null, tagline: null, settings: null,
        tenant_type: 'school',
      },
      error: null,
    });
    enabledModulesFor.mockRejectedValueOnce(new Error('flag service down'));
    getAllTenantConfig.mockResolvedValueOnce({} as Record<string, unknown>);

    const res = await GET(makeRequest({ 'x-school-id': 'school-1' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ isTenantContext: false });
  });

  it('emits Cache-Control: 5 minutes', async () => {
    const res = await GET(makeRequest());
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300');
  });
});
