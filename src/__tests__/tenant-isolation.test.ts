import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NULL_TENANT } from '@/lib/types';
import type { TenantContext } from '@/lib/types';

/**
 * Tenant Isolation Verification Tests
 *
 * Critical security tests verifying multi-tenant isolation:
 *   - B2C vs B2B domain detection
 *   - Reserved subdomain protection
 *   - NULL_TENANT for B2C contexts
 *   - Header serialization/deserialization roundtrip
 *   - Branding defaults for B2B schools
 *
 * These complement the existing tenant.test.ts with additional security-focused
 * edge cases and boundary conditions.
 */

// ── Mock cache module ─────────────────────────────────────────────────────────

vi.mock('@/lib/cache', () => ({
  cacheGet: vi.fn(() => null),
  cacheSet: vi.fn(),
  cacheDelete: vi.fn(),
}));

import {
  isB2CDomain,
  extractSlugFromHost,
  buildTenantContext,
  tenantHeadersFromContext,
  tenantFromHeaders,
} from '@/lib/tenant';
import type { SchoolRecord } from '@/lib/tenant';

// ═══════════════════════════════════════════════════════════════════════════════
// B2C DOMAIN DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tenant Isolation: isB2CDomain', () => {
  it('correctly identifies B2C domains', () => {
    const b2cDomains = [
      'alfanumrik.com',
      'www.alfanumrik.com',
      'app.alfanumrik.com',
      'localhost',
      'localhost:3000',
      'admin.alfanumrik.com',
      'staging.alfanumrik.com',
      'dev.alfanumrik.com',
      'api.alfanumrik.com',
      'alfanumrik-preview-abc.vercel.app',
    ];

    for (const domain of b2cDomains) {
      expect(isB2CDomain(domain)).toBe(true);
    }
  });

  it('correctly identifies B2B domains (tenant subdomains)', () => {
    const b2bDomains = [
      'dps.alfanumrik.com',
      'greenvalley.alfanumrik.com',
      'ryan.alfanumrik.com',
      'kvs.alfanumrik.com',
    ];

    for (const domain of b2bDomains) {
      expect(isB2CDomain(domain)).toBe(false);
    }
  });

  it('treats custom domains as B2B (not B2C)', () => {
    expect(isB2CDomain('learn.dps.com')).toBe(false);
    expect(isB2CDomain('portal.greenvalley.edu.in')).toBe(false);
    expect(isB2CDomain('school.custom-domain.org')).toBe(false);
  });

  it('handles case insensitivity', () => {
    expect(isB2CDomain('APP.ALFANUMRIK.COM')).toBe(true);
    expect(isB2CDomain('DPS.ALFANUMRIK.COM')).toBe(false);
  });

  it('strips port before comparison', () => {
    expect(isB2CDomain('app.alfanumrik.com:443')).toBe(true);
    expect(isB2CDomain('dps.alfanumrik.com:443')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESERVED SUBDOMAIN PROTECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tenant Isolation: extractSlugFromHost — reserved subdomains', () => {
  it('returns null for all reserved subdomains', () => {
    const reserved = ['www', 'app', 'api', 'admin', 'staging', 'dev'];

    for (const sub of reserved) {
      expect(extractSlugFromHost(`${sub}.alfanumrik.com`)).toBeNull();
    }
  });

  it('returns null for bare alfanumrik.com (no subdomain)', () => {
    expect(extractSlugFromHost('alfanumrik.com')).toBeNull();
  });

  it('returns null for localhost', () => {
    expect(extractSlugFromHost('localhost')).toBeNull();
    expect(extractSlugFromHost('localhost:3000')).toBeNull();
  });

  it('returns null for nested subdomains (sub.sub.alfanumrik.com)', () => {
    expect(extractSlugFromHost('a.b.alfanumrik.com')).toBeNull();
  });

  it('extracts valid tenant slug', () => {
    expect(extractSlugFromHost('dps.alfanumrik.com')).toBe('dps');
    expect(extractSlugFromHost('greenvalley.alfanumrik.com')).toBe('greenvalley');
  });

  it('returns null for non-alfanumrik.com custom domains', () => {
    expect(extractSlugFromHost('learn.dps.com')).toBeNull();
    expect(extractSlugFromHost('portal.school.edu.in')).toBeNull();
  });

  it('handles slug extraction case-insensitively', () => {
    expect(extractSlugFromHost('DPS.ALFANUMRIK.COM')).toBe('dps');
    expect(extractSlugFromHost('GreenValley.alfanumrik.com')).toBe('greenvalley');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TENANT CONTEXT BUILDING
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tenant Isolation: buildTenantContext', () => {
  it('returns NULL_TENANT for null school (B2C)', () => {
    const ctx = buildTenantContext(null);
    expect(ctx).toEqual(NULL_TENANT);
    expect(ctx.schoolId).toBeNull();
    expect(ctx.schoolSlug).toBeNull();
    expect(ctx.plan).toBe('free');
    expect(ctx.isActive).toBe(true);
    expect(ctx.branding.showPoweredBy).toBe(false); // B2C: no "Powered by" banner
  });

  it('sets showPoweredBy=true for B2B schools', () => {
    const school: SchoolRecord = {
      id: 'school-001',
      slug: 'dps',
      name: 'Delhi Public School',
      subscription_plan: 'pro',
      is_active: true,
      logo_url: null,
      primary_color: null,
      secondary_color: null,
      tagline: null,
      settings: null,
    };

    const ctx = buildTenantContext(school);
    expect(ctx.branding.showPoweredBy).toBe(true);
  });

  it('populates all fields for a B2B school', () => {
    const school: SchoolRecord = {
      id: 'school-full',
      slug: 'ryan',
      name: 'Ryan International',
      subscription_plan: 'enterprise',
      is_active: true,
      logo_url: 'https://cdn.example.com/ryan.png',
      primary_color: '#1A237E',
      secondary_color: '#FBC02D',
      tagline: 'Building Leaders',
      settings: { favicon_url: 'https://cdn.example.com/ryan-fav.ico' },
    };

    const ctx = buildTenantContext(school);

    expect(ctx.schoolId).toBe('school-full');
    expect(ctx.schoolSlug).toBe('ryan');
    expect(ctx.schoolName).toBe('Ryan International');
    expect(ctx.plan).toBe('enterprise');
    expect(ctx.isActive).toBe(true);
    expect(ctx.branding.logoUrl).toBe('https://cdn.example.com/ryan.png');
    expect(ctx.branding.primaryColor).toBe('#1A237E');
    expect(ctx.branding.secondaryColor).toBe('#FBC02D');
    expect(ctx.branding.tagline).toBe('Building Leaders');
    expect(ctx.branding.faviconUrl).toBe('https://cdn.example.com/ryan-fav.ico');
    expect(ctx.branding.showPoweredBy).toBe(true);
  });

  it('uses default Alfanumrik colors when school has no custom colors', () => {
    const school: SchoolRecord = {
      id: 'school-default',
      slug: 'plainschool',
      name: 'Plain School',
      subscription_plan: 'starter',
      is_active: true,
      logo_url: null,
      primary_color: null,
      secondary_color: null,
      tagline: null,
      settings: null,
    };

    const ctx = buildTenantContext(school);

    expect(ctx.branding.primaryColor).toBe('#7C3AED'); // Alfanumrik purple
    expect(ctx.branding.secondaryColor).toBe('#F97316'); // Alfanumrik orange
    expect(ctx.branding.logoUrl).toBeNull();
    expect(ctx.branding.faviconUrl).toBeNull();
  });

  it('handles inactive school correctly', () => {
    const school: SchoolRecord = {
      id: 'school-inactive',
      slug: 'oldschool',
      name: 'Closed School',
      subscription_plan: 'free',
      is_active: false,
      logo_url: null,
      primary_color: null,
      secondary_color: null,
      tagline: null,
      settings: null,
    };

    const ctx = buildTenantContext(school);
    expect(ctx.isActive).toBe(false);
    expect(ctx.schoolId).toBe('school-inactive');
  });

  it('handles settings without favicon_url gracefully', () => {
    const school: SchoolRecord = {
      id: 'school-no-fav',
      slug: 'nofavschool',
      name: 'No Favicon School',
      subscription_plan: 'pro',
      is_active: true,
      logo_url: null,
      primary_color: null,
      secondary_color: null,
      tagline: null,
      settings: { some_other_setting: true },
    };

    const ctx = buildTenantContext(school);
    expect(ctx.branding.faviconUrl).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HEADER SERIALIZATION / DESERIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tenant Isolation: header roundtrip', () => {
  it('null tenant (B2C) has no schoolId in headers', () => {
    const headers = tenantHeadersFromContext(NULL_TENANT);
    expect(Object.keys(headers)).toHaveLength(0);
    expect(headers['x-school-id']).toBeUndefined();
  });

  it('school tenant has all required fields populated in headers', () => {
    const ctx: TenantContext = {
      schoolId: 'school-hdr-1',
      schoolSlug: 'dps',
      schoolName: 'Delhi Public School',
      plan: 'pro',
      isActive: true,
      branding: {
        logoUrl: null,
        primaryColor: '#003366',
        secondaryColor: '#FFD700',
        tagline: null,
        faviconUrl: null,
        showPoweredBy: true,
      },
    };

    const headers = tenantHeadersFromContext(ctx);

    expect(headers['x-school-id']).toBe('school-hdr-1');
    expect(headers['x-school-slug']).toBe('dps');
    expect(headers['x-school-plan']).toBe('pro');
    expect(headers['x-school-name']).toBe('Delhi Public School');
  });

  it('tenantFromHeaders parses headers correctly', () => {
    const headers = new Headers();
    headers.set('x-school-id', 'school-parse-1');
    headers.set('x-school-slug', 'greenvalley');
    headers.set('x-school-plan', 'enterprise');
    headers.set('x-school-name', 'Green Valley School');

    const ctx = tenantFromHeaders(headers);

    expect(ctx.schoolId).toBe('school-parse-1');
    expect(ctx.schoolSlug).toBe('greenvalley');
    expect(ctx.plan).toBe('enterprise');
    expect(ctx.schoolName).toBe('Green Valley School');
  });

  it('returns NULL_TENANT when no tenant headers present', () => {
    const headers = new Headers();
    const ctx = tenantFromHeaders(headers);
    expect(ctx).toEqual(NULL_TENANT);
  });

  it('roundtrip: serialize then deserialize preserves identity', () => {
    const original: TenantContext = {
      schoolId: 'school-roundtrip',
      schoolSlug: 'kvs',
      schoolName: 'Kendriya Vidyalaya Sangathan',
      plan: 'pro',
      isActive: true,
      branding: {
        logoUrl: null,
        primaryColor: '#7C3AED',
        secondaryColor: '#F97316',
        tagline: null,
        faviconUrl: null,
        showPoweredBy: true,
      },
    };

    const headerObj = tenantHeadersFromContext(original);
    const headers = new Headers();
    for (const [k, v] of Object.entries(headerObj)) {
      headers.set(k, v);
    }

    const parsed = tenantFromHeaders(headers);

    expect(parsed.schoolId).toBe(original.schoolId);
    expect(parsed.schoolSlug).toBe(original.schoolSlug);
    expect(parsed.schoolName).toBe(original.schoolName);
    expect(parsed.plan).toBe(original.plan);
  });

  it('null tenant roundtrip: serialize returns empty, deserialize returns NULL_TENANT', () => {
    const headerObj = tenantHeadersFromContext(NULL_TENANT);
    expect(Object.keys(headerObj)).toHaveLength(0);

    const headers = new Headers();
    for (const [k, v] of Object.entries(headerObj)) {
      headers.set(k, v);
    }

    const parsed = tenantFromHeaders(headers);
    expect(parsed).toEqual(NULL_TENANT);
  });

  it('defaults plan to "free" when x-school-plan header is missing', () => {
    const headers = new Headers();
    headers.set('x-school-id', 'school-no-plan');
    headers.set('x-school-slug', 'testschool');
    headers.set('x-school-name', 'Test School');
    // x-school-plan intentionally omitted

    const ctx = tenantFromHeaders(headers);
    expect(ctx.plan).toBe('free');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT ISOLATION PROPERTIES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tenant Isolation: security properties', () => {
  it('two different schools produce different contexts', () => {
    const schoolA: SchoolRecord = {
      id: 'school-A',
      slug: 'schoola',
      name: 'School A',
      subscription_plan: 'pro',
      is_active: true,
      logo_url: null,
      primary_color: '#111111',
      secondary_color: '#222222',
      tagline: null,
      settings: null,
    };

    const schoolB: SchoolRecord = {
      id: 'school-B',
      slug: 'schoolb',
      name: 'School B',
      subscription_plan: 'starter',
      is_active: true,
      logo_url: null,
      primary_color: '#333333',
      secondary_color: '#444444',
      tagline: null,
      settings: null,
    };

    const ctxA = buildTenantContext(schoolA);
    const ctxB = buildTenantContext(schoolB);

    expect(ctxA.schoolId).not.toBe(ctxB.schoolId);
    expect(ctxA.branding.primaryColor).not.toBe(ctxB.branding.primaryColor);
  });

  it('null school context has no data leakage from previous tenant', () => {
    const school: SchoolRecord = {
      id: 'school-leak-test',
      slug: 'leaktest',
      name: 'Leak Test School',
      subscription_plan: 'pro',
      is_active: true,
      logo_url: 'https://cdn.example.com/logo.png',
      primary_color: '#FF0000',
      secondary_color: '#00FF00',
      tagline: 'Test',
      settings: null,
    };

    // Build a school context, then build null
    const _schoolCtx = buildTenantContext(school);
    const nullCtx = buildTenantContext(null);

    // NULL_TENANT should not contain school data
    expect(nullCtx.schoolId).toBeNull();
    expect(nullCtx.schoolSlug).toBeNull();
    expect(nullCtx.schoolName).toBeNull();
    expect(nullCtx.branding.logoUrl).toBeNull();
    expect(nullCtx.branding.primaryColor).toBe('#7C3AED'); // Alfanumrik default, not school color
  });

  it('NULL_TENANT is a consistent reference', () => {
    // NULL_TENANT should always be the same shape
    expect(NULL_TENANT.schoolId).toBeNull();
    expect(NULL_TENANT.plan).toBe('free');
    expect(NULL_TENANT.isActive).toBe(true);
    expect(NULL_TENANT.branding.showPoweredBy).toBe(false);
  });
});
