/**
 * ALFANUMRIK -- Multi-Tenant Resolution Library
 *
 * Resolves hostnames to school tenants for the B2B white-label platform.
 * Supports subdomain-based (dps.alfanumrik.com) and custom domain (learn.dps.com) resolution.
 *
 * Uses in-memory cache with 5-minute TTL to minimize DB lookups.
 * Negative results (NOT_FOUND) are also cached to prevent repeated misses.
 */

import { cacheGet, cacheSet, cacheDelete } from '@/lib/cache';
import { NULL_TENANT } from '@/lib/types';
import type { TenantContext, SchoolBranding } from '@/lib/types';

/* ─── Constants ─── */

const ALFANUMRIK_DOMAIN = 'alfanumrik.com';

/** Reserved subdomains that are NOT tenant slugs */
const RESERVED_SUBDOMAINS = new Set([
  'app', 'www', 'api', 'admin', 'staging', 'dev',
]);

/** Cache TTL for tenant lookups: 5 minutes */
const TENANT_CACHE_TTL = 5 * 60 * 1000;

/** Cache key prefix */
const CACHE_PREFIX = 'tenant:';

/** Sentinel value for negative cache (school not found) */
const NOT_FOUND_SENTINEL = 'NOT_FOUND';

/** Default Alfanumrik brand colors */
const DEFAULT_PRIMARY = '#7C3AED';
const DEFAULT_SECONDARY = '#F97316';

/** Supabase REST API select fields for schools table */
const SCHOOL_SELECT = 'id,slug,name,subscription_plan,is_active,logo_url,primary_color,secondary_color,tagline,settings';

/* ─── School Record (DB shape) ─── */

export interface SchoolRecord {
  id: string;
  slug: string;
  name: string;
  subscription_plan: string;
  is_active: boolean;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  tagline: string | null;
  settings: Record<string, unknown> | null;
}

/* ─── Domain Helpers ─── */

/**
 * Check if a host is a B2C domain (no tenant resolution needed).
 * B2C domains: alfanumrik.com, www/app.alfanumrik.com, *.vercel.app, localhost
 */
export function isB2CDomain(host: string): boolean {
  // Strip port if present
  const hostname = host.split(':')[0].toLowerCase();

  // localhost is always B2C
  if (hostname === 'localhost') return true;

  // Vercel preview deployments
  if (hostname.endsWith('.vercel.app')) return true;

  // Bare domain or reserved subdomains of alfanumrik.com
  if (hostname === ALFANUMRIK_DOMAIN) return true;

  if (hostname.endsWith(`.${ALFANUMRIK_DOMAIN}`)) {
    const sub = hostname.slice(0, -(ALFANUMRIK_DOMAIN.length + 1));
    return RESERVED_SUBDOMAINS.has(sub);
  }

  return false;
}

/**
 * Extract a tenant slug from a *.alfanumrik.com hostname.
 * Returns null for B2C/reserved domains and non-alfanumrik.com hosts.
 */
export function extractSlugFromHost(host: string): string | null {
  const hostname = host.split(':')[0].toLowerCase();

  // Must be a subdomain of alfanumrik.com
  if (!hostname.endsWith(`.${ALFANUMRIK_DOMAIN}`)) return null;

  const sub = hostname.slice(0, -(ALFANUMRIK_DOMAIN.length + 1));

  // No nested subdomains, no reserved names, no empty
  if (!sub || sub.includes('.') || RESERVED_SUBDOMAINS.has(sub)) return null;

  return sub;
}

/* ─── Tenant Context Builders ─── */

/**
 * Convert a DB school record to a TenantContext.
 * Returns NULL_TENANT for null input.
 * B2B schools always have showPoweredBy=true.
 */
export function buildTenantContext(school: SchoolRecord | null): TenantContext {
  if (!school) return NULL_TENANT;

  const settings = school.settings ?? {};
  const faviconUrl = (typeof settings.favicon_url === 'string' ? settings.favicon_url : null);

  const branding: SchoolBranding = {
    logoUrl: school.logo_url,
    primaryColor: school.primary_color ?? DEFAULT_PRIMARY,
    secondaryColor: school.secondary_color ?? DEFAULT_SECONDARY,
    tagline: school.tagline,
    faviconUrl,
    showPoweredBy: true, // B2B schools always show "Powered by Alfanumrik"
  };

  return {
    schoolId: school.id,
    schoolSlug: school.slug,
    schoolName: school.name,
    plan: school.subscription_plan,
    isActive: school.is_active,
    branding,
  };
}

/* ─── Header Serialization ─── */

/**
 * Generate tenant headers to forward through middleware → API routes.
 * Returns empty object for NULL_TENANT (no school context).
 */
export function tenantHeadersFromContext(
  ctx: TenantContext,
): Record<string, string> {
  if (!ctx.schoolId) return {};

  return {
    'x-school-id': ctx.schoolId,
    'x-school-slug': ctx.schoolSlug ?? '',
    'x-school-plan': ctx.plan,
    'x-school-name': ctx.schoolName ?? '',
  };
}

/**
 * Parse tenant context from incoming request headers.
 * Returns NULL_TENANT if no tenant headers are present.
 */
export function tenantFromHeaders(headers: Headers): TenantContext {
  const schoolId = headers.get('x-school-id');
  if (!schoolId) return NULL_TENANT;

  return {
    schoolId,
    schoolSlug: headers.get('x-school-slug') || null,
    schoolName: headers.get('x-school-name') || null,
    plan: headers.get('x-school-plan') || 'free',
    isActive: true, // If headers are present, assume active (middleware would have blocked inactive)
    branding: NULL_TENANT.branding, // Branding resolved separately by frontend from context
  };
}

/* ─── Resolution (Supabase REST API) ─── */

/**
 * Resolve a hostname to a SchoolRecord via Supabase REST API.
 *
 * Resolution order:
 * 1. Check in-memory cache
 * 2. Try slug resolution (for *.alfanumrik.com)
 * 3. Try custom domain resolution (for external domains)
 * 4. Cache result (including negative results as NOT_FOUND)
 */
export async function resolveHostToSchool(
  host: string,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<SchoolRecord | null> {
  const cacheKey = `${CACHE_PREFIX}${host}`;

  // 1. Check cache
  const cached = cacheGet<SchoolRecord | typeof NOT_FOUND_SENTINEL>(cacheKey);
  if (cached !== null) {
    return cached === NOT_FOUND_SENTINEL ? null : cached;
  }

  // 2. Try slug resolution
  const slug = extractSlugFromHost(host);
  if (slug) {
    const school = await fetchSchoolBySlug(slug, supabaseUrl, serviceRoleKey);
    if (school) {
      cacheSet(cacheKey, school, TENANT_CACHE_TTL);
      return school;
    }
  }

  // 3. Try custom domain resolution
  const hostname = host.split(':')[0].toLowerCase();
  const school = await fetchSchoolByCustomDomain(hostname, supabaseUrl, serviceRoleKey);
  if (school) {
    cacheSet(cacheKey, school, TENANT_CACHE_TTL);
    return school;
  }

  // 4. Cache negative result
  cacheSet(cacheKey, NOT_FOUND_SENTINEL, TENANT_CACHE_TTL);
  return null;
}

/**
 * Invalidate tenant cache for a specific host.
 * Call when school settings are updated.
 */
export function invalidateTenantCache(host: string): void {
  cacheDelete(`${CACHE_PREFIX}${host}`);
}

/* ─── Private Supabase REST Helpers ─── */

async function fetchSchoolBySlug(
  slug: string,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<SchoolRecord | null> {
  const url = `${supabaseUrl}/rest/v1/schools?slug=eq.${encodeURIComponent(slug)}&select=${SCHOOL_SELECT}&limit=1`;
  return fetchSchool(url, serviceRoleKey);
}

async function fetchSchoolByCustomDomain(
  domain: string,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<SchoolRecord | null> {
  const url = `${supabaseUrl}/rest/v1/schools?custom_domain=eq.${encodeURIComponent(domain)}&select=${SCHOOL_SELECT}&limit=1`;
  return fetchSchool(url, serviceRoleKey);
}

async function fetchSchool(
  url: string,
  serviceRoleKey: string,
): Promise<SchoolRecord | null> {
  const response = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) return null;

  const rows: SchoolRecord[] = await response.json();
  return rows.length > 0 ? rows[0] : null;
}
