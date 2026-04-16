import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NULL_TENANT } from '@/lib/types';
import type { TenantContext } from '@/lib/types';

// Mock the cache module before importing tenant
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
  invalidateTenantCache,
  resolveHostToSchool,
} from '@/lib/tenant';
import type { SchoolRecord } from '@/lib/tenant';
import { cacheGet, cacheSet, cacheDelete } from '@/lib/cache';

describe('isB2CDomain', () => {
  it('returns true for app.alfanumrik.com', () => {
    expect(isB2CDomain('app.alfanumrik.com')).toBe(true);
  });

  it('returns true for alfanumrik.com', () => {
    expect(isB2CDomain('alfanumrik.com')).toBe(true);
  });

  it('returns true for www.alfanumrik.com', () => {
    expect(isB2CDomain('www.alfanumrik.com')).toBe(true);
  });

  it('returns true for localhost:3000', () => {
    expect(isB2CDomain('localhost:3000')).toBe(true);
  });

  it('returns true for localhost without port', () => {
    expect(isB2CDomain('localhost')).toBe(true);
  });

  it('returns true for vercel.app preview deployments', () => {
    expect(isB2CDomain('alfanumrik-abc123.vercel.app')).toBe(true);
  });

  it('returns false for dps.alfanumrik.com', () => {
    expect(isB2CDomain('dps.alfanumrik.com')).toBe(false);
  });

  it('returns false for learn.dps.com (custom domain)', () => {
    expect(isB2CDomain('learn.dps.com')).toBe(false);
  });
});

describe('extractSlugFromHost', () => {
  it("extracts 'dps' from 'dps.alfanumrik.com'", () => {
    expect(extractSlugFromHost('dps.alfanumrik.com')).toBe('dps');
  });

  it("extracts 'greenvalley' from 'greenvalley.alfanumrik.com'", () => {
    expect(extractSlugFromHost('greenvalley.alfanumrik.com')).toBe('greenvalley');
  });

  it('returns null for B2C domain alfanumrik.com', () => {
    expect(extractSlugFromHost('alfanumrik.com')).toBeNull();
  });

  it('returns null for www.alfanumrik.com (reserved)', () => {
    expect(extractSlugFromHost('www.alfanumrik.com')).toBeNull();
  });

  it('returns null for app.alfanumrik.com (reserved)', () => {
    expect(extractSlugFromHost('app.alfanumrik.com')).toBeNull();
  });

  it('returns null for api.alfanumrik.com (reserved)', () => {
    expect(extractSlugFromHost('api.alfanumrik.com')).toBeNull();
  });

  it('returns null for admin.alfanumrik.com (reserved)', () => {
    expect(extractSlugFromHost('admin.alfanumrik.com')).toBeNull();
  });

  it('returns null for staging.alfanumrik.com (reserved)', () => {
    expect(extractSlugFromHost('staging.alfanumrik.com')).toBeNull();
  });

  it('returns null for dev.alfanumrik.com (reserved)', () => {
    expect(extractSlugFromHost('dev.alfanumrik.com')).toBeNull();
  });

  it('returns null for localhost', () => {
    expect(extractSlugFromHost('localhost:3000')).toBeNull();
  });

  it('returns null for custom domains (non-alfanumrik.com)', () => {
    expect(extractSlugFromHost('learn.dps.com')).toBeNull();
  });
});

describe('buildTenantContext', () => {
  it('returns NULL_TENANT for null input', () => {
    const result = buildTenantContext(null);
    expect(result).toEqual(NULL_TENANT);
  });

  it('builds correct context from school record with colors/logo', () => {
    const school: SchoolRecord = {
      id: 'school-123',
      slug: 'dps',
      name: 'Delhi Public School',
      subscription_plan: 'pro',
      is_active: true,
      logo_url: 'https://example.com/logo.png',
      primary_color: '#003366',
      secondary_color: '#FFD700',
      tagline: 'Excellence in Education',
      settings: { favicon_url: 'https://example.com/favicon.ico' },
    };

    const result = buildTenantContext(school);

    expect(result).toEqual({
      schoolId: 'school-123',
      schoolSlug: 'dps',
      schoolName: 'Delhi Public School',
      plan: 'pro',
      isActive: true,
      branding: {
        logoUrl: 'https://example.com/logo.png',
        primaryColor: '#003366',
        secondaryColor: '#FFD700',
        tagline: 'Excellence in Education',
        faviconUrl: 'https://example.com/favicon.ico',
        showPoweredBy: true,
      },
    });
  });

  it('uses default Alfanumrik colors when school has none', () => {
    const school: SchoolRecord = {
      id: 'school-456',
      slug: 'gvs',
      name: 'Green Valley School',
      subscription_plan: 'starter',
      is_active: true,
      logo_url: null,
      primary_color: null,
      secondary_color: null,
      tagline: null,
      settings: null,
    };

    const result = buildTenantContext(school);

    expect(result.branding.primaryColor).toBe('#7C3AED');
    expect(result.branding.secondaryColor).toBe('#F97316');
    expect(result.branding.logoUrl).toBeNull();
    expect(result.branding.faviconUrl).toBeNull();
    expect(result.branding.showPoweredBy).toBe(true);
  });

  it('sets showPoweredBy to true for B2B schools', () => {
    const school: SchoolRecord = {
      id: 'school-789',
      slug: 'abc',
      name: 'ABC School',
      subscription_plan: 'free',
      is_active: false,
      logo_url: null,
      primary_color: null,
      secondary_color: null,
      tagline: null,
      settings: null,
    };

    const result = buildTenantContext(school);
    expect(result.branding.showPoweredBy).toBe(true);
    expect(result.isActive).toBe(false);
  });
});

describe('tenantHeadersFromContext', () => {
  it('returns empty headers for null tenant (NULL_TENANT)', () => {
    const headers = tenantHeadersFromContext(NULL_TENANT);
    expect(Object.keys(headers)).toHaveLength(0);
  });

  it('returns populated headers for school tenant', () => {
    const ctx: TenantContext = {
      schoolId: 'school-123',
      schoolSlug: 'dps',
      schoolName: 'Delhi Public School',
      plan: 'pro',
      isActive: true,
      branding: {
        logoUrl: 'https://example.com/logo.png',
        primaryColor: '#003366',
        secondaryColor: '#FFD700',
        tagline: 'Excellence in Education',
        faviconUrl: null,
        showPoweredBy: true,
      },
    };

    const headers = tenantHeadersFromContext(ctx);

    expect(headers['x-school-id']).toBe('school-123');
    expect(headers['x-school-slug']).toBe('dps');
    expect(headers['x-school-plan']).toBe('pro');
    expect(headers['x-school-name']).toBe('Delhi Public School');
  });
});

describe('tenantFromHeaders', () => {
  it('parses school_id and plan from Headers object', () => {
    const headers = new Headers();
    headers.set('x-school-id', 'school-123');
    headers.set('x-school-slug', 'dps');
    headers.set('x-school-plan', 'pro');
    headers.set('x-school-name', 'Delhi Public School');

    const result = tenantFromHeaders(headers);

    expect(result.schoolId).toBe('school-123');
    expect(result.schoolSlug).toBe('dps');
    expect(result.plan).toBe('pro');
    expect(result.schoolName).toBe('Delhi Public School');
  });

  it('returns NULL_TENANT when no tenant headers present', () => {
    const headers = new Headers();
    const result = tenantFromHeaders(headers);
    expect(result).toEqual(NULL_TENANT);
  });
});

describe('invalidateTenantCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls cacheDelete with the correct key', () => {
    invalidateTenantCache('dps.alfanumrik.com');
    expect(cacheDelete).toHaveBeenCalledWith('tenant:dps.alfanumrik.com');
  });
});

describe('resolveHostToSchool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('returns cached result when cache hit', async () => {
    const cached: SchoolRecord = {
      id: 'school-123',
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
    vi.mocked(cacheGet).mockReturnValueOnce(cached);

    const result = await resolveHostToSchool(
      'dps.alfanumrik.com',
      'https://test.supabase.co',
      'test-key',
    );

    expect(result).toEqual(cached);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns null for cached NOT_FOUND', async () => {
    vi.mocked(cacheGet).mockReturnValueOnce('NOT_FOUND');

    const result = await resolveHostToSchool(
      'unknown.alfanumrik.com',
      'https://test.supabase.co',
      'test-key',
    );

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resolves slug via Supabase REST API on cache miss', async () => {
    vi.mocked(cacheGet).mockReturnValueOnce(null);

    const mockSchool: SchoolRecord = {
      id: 'school-123',
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

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([mockSchool]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await resolveHostToSchool(
      'dps.alfanumrik.com',
      'https://test.supabase.co',
      'test-key',
    );

    expect(result).toEqual(mockSchool);
    expect(cacheSet).toHaveBeenCalledWith(
      'tenant:dps.alfanumrik.com',
      mockSchool,
      5 * 60 * 1000,
    );
  });

  it('tries custom domain resolution when no slug match', async () => {
    vi.mocked(cacheGet).mockReturnValueOnce(null);

    const mockSchool: SchoolRecord = {
      id: 'school-789',
      slug: 'dps',
      name: 'DPS Custom Domain',
      subscription_plan: 'pro',
      is_active: true,
      logo_url: null,
      primary_color: null,
      secondary_color: null,
      tagline: null,
      settings: null,
    };

    // Custom domain is not *.alfanumrik.com, so only 1 fetch (custom_domain lookup)
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([mockSchool]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await resolveHostToSchool(
      'learn.dps.com',
      'https://test.supabase.co',
      'test-key',
    );

    expect(result).toEqual(mockSchool);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cacheSet).toHaveBeenCalledWith(
      'tenant:learn.dps.com',
      mockSchool,
      5 * 60 * 1000,
    );
  });

  it('caches NOT_FOUND for negative results', async () => {
    vi.mocked(cacheGet).mockReturnValueOnce(null);

    // Slug query: empty
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    // Custom domain query: empty
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await resolveHostToSchool(
      'unknown.alfanumrik.com',
      'https://test.supabase.co',
      'test-key',
    );

    expect(result).toBeNull();
    expect(cacheSet).toHaveBeenCalledWith(
      'tenant:unknown.alfanumrik.com',
      'NOT_FOUND',
      5 * 60 * 1000,
    );
  });
});
