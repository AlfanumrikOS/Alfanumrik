import { describe, it, expect, vi } from 'vitest';

// Mock the legacy tenant module so tenantFromSchool tests don't accidentally
// pull in the cache/Supabase bits — we only exercise pure builders here.
vi.mock('@alfanumrik/lib/cache', () => ({
  cacheGet: vi.fn(() => null),
  cacheSet: vi.fn(),
  cacheDelete: vi.fn(),
}));

import {
  coerceTenantType,
  tenantFromSchool,
  nullTenant,
  type SchoolRecordWithTenantFields,
  type TenantType,
} from '@alfanumrik/lib/tenant-domain';

const baseSchool: SchoolRecordWithTenantFields = {
  id: 'school-1',
  slug: 'dps',
  name: 'Delhi Public School',
  subscription_plan: 'family',
  is_active: true,
  logo_url: null,
  primary_color: null,
  secondary_color: null,
  tagline: null,
  settings: null,
};

describe('coerceTenantType', () => {
  const valid: TenantType[] = ['school', 'coaching', 'corporate', 'government'];

  it.each(valid)('passes through valid type %s', t => {
    expect(coerceTenantType(t)).toBe(t);
  });

  it('returns "school" for unknown strings', () => {
    expect(coerceTenantType('university')).toBe('school');
  });

  it('returns "school" for null/undefined/numbers', () => {
    expect(coerceTenantType(null)).toBe('school');
    expect(coerceTenantType(undefined)).toBe('school');
    expect(coerceTenantType(42)).toBe('school');
  });
});

describe('tenantFromSchool', () => {
  it('returns null for null input', () => {
    expect(tenantFromSchool(null)).toBeNull();
  });

  it('builds a Tenant with default tenant_type=school when column missing', () => {
    const t = tenantFromSchool(baseSchool);
    expect(t).not.toBeNull();
    expect(t!.tenantType).toBe('school');
    expect(t!.schoolId).toBe('school-1');
    expect(t!.schoolSlug).toBe('dps');
  });

  it('reads tenant_type when present', () => {
    const t = tenantFromSchool({ ...baseSchool, tenant_type: 'coaching' });
    expect(t!.tenantType).toBe('coaching');
  });

  it('coerces an unknown tenant_type back to school (DB drift safety)', () => {
    const t = tenantFromSchool({ ...baseSchool, tenant_type: 'monastery' });
    expect(t!.tenantType).toBe('school');
  });

  it('passes through typography fields when set', () => {
    const t = tenantFromSchool({
      ...baseSchool,
      font_heading: 'Inter',
      font_body: 'system-ui',
      border_radius_px: 12,
    });
    expect(t!.typography).toEqual({
      fontHeading: 'Inter',
      fontBody: 'system-ui',
      borderRadiusPx: 12,
    });
  });

  it('clamps border_radius_px out of range to null', () => {
    expect(
      tenantFromSchool({ ...baseSchool, border_radius_px: 99 })!.typography.borderRadiusPx,
    ).toBeNull();
    expect(
      tenantFromSchool({ ...baseSchool, border_radius_px: -1 })!.typography.borderRadiusPx,
    ).toBeNull();
  });

  it('treats non-numeric border_radius as null', () => {
    expect(
      tenantFromSchool({
        ...baseSchool,
        border_radius_px: NaN,
      })!.typography.borderRadiusPx,
    ).toBeNull();
  });

  it('rounds fractional border_radius to nearest int', () => {
    expect(
      tenantFromSchool({ ...baseSchool, border_radius_px: 7.6 })!.typography.borderRadiusPx,
    ).toBe(8);
  });

  it('sets typography to all-null when columns missing (legacy SchoolRecord)', () => {
    const t = tenantFromSchool(baseSchool);
    expect(t!.typography).toEqual({
      fontHeading: null,
      fontBody: null,
      borderRadiusPx: null,
    });
  });
});

describe('nullTenant', () => {
  it('returns a Tenant whose schoolId is null and tenantType defaults to school', () => {
    const t = nullTenant();
    expect(t.schoolId).toBeNull();
    expect(t.tenantType).toBe('school');
    expect(t.typography.fontHeading).toBeNull();
  });
});
