# B2B White-Label Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable multi-tenant white-label operation so 2-3 pilot schools (500-1000 students) can use Alfanumrik via branded subdomains with tenant-isolated data.

**Architecture:** Middleware resolves hostname to school tenant, injects Postgres session variable `app.current_school_id`, RLS policies scope data per-tenant. Existing school-admin portal (7 pages, 5,412 LOC) gets backend API routes. SchoolThemeProvider applies school branding dynamically.

**Tech Stack:** Next.js 16.2 App Router, Supabase Postgres + RLS, Upstash Redis, Vercel Domains API, Tailwind CSS variables

**Existing State (verified via live Supabase + Vercel):**
- `institution_admin` role exists (hierarchy 70) with 21 permissions
- `schools` table has all white-label columns (slug, primary_color, secondary_color, custom_domain, tagline, billing_email, settings)
- `school_admins` table exists (auth_user_id, school_id, role, name, email, phone, is_active, invited_by)
- `school_invite_codes` and `school_subscriptions` tables exist
- `students.school_id`, `teachers.school_id`, `classes.school_id` columns exist
- RLS policy "School admins can view school students" already exists on `students`
- School-admin portal: 7 pages at `src/app/school-admin/` (dashboard, teachers, students, classes, invite-codes, setup, enroll)
- **No API routes** exist for school-admin (pages call Supabase directly or are non-functional)
- Proxy middleware at `src/proxy.ts` already uses Upstash Ratelimit with fallback
- Vercel project: `prj_1PRfOVHYbSemMYSU5DXCMIUG9sda`, team: `team_hzGOneVt21Je8RCtuAsDU7TA`
- Current domains: `alfanumrik.com`, `www.alfanumrik.com` (no wildcard)
- Supabase project: `shktyoxqhundlvkiwguu` (ap-south-1, Postgres 17)

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/lib/tenant.ts` | Tenant resolution: hostname → school context lookup + Redis cache |
| `src/lib/tenant-context.ts` | React context for tenant/school branding on client side |
| `src/components/SchoolThemeProvider.tsx` | Applies school colors/logo via CSS custom properties |
| `src/app/api/school-admin/teachers/route.ts` | CRUD API for school's teachers |
| `src/app/api/school-admin/students/route.ts` | CRUD + bulk invite API for school's students |
| `src/app/api/school-admin/analytics/route.ts` | School-scoped dashboard analytics |
| `src/app/api/school-admin/invite-codes/route.ts` | Generate/manage invite codes |
| `src/app/api/school-admin/branding/route.ts` | Read/update school branding settings |
| `src/app/api/school-admin/subscription/route.ts` | Read school subscription + seat usage |
| `src/app/api/school-admin/domain/route.ts` | Custom domain lifecycle management |
| `src/__tests__/tenant.test.ts` | Unit tests for tenant resolution |
| `src/__tests__/school-admin-api.test.ts` | Unit tests for school admin API routes |
| `src/__tests__/school-theme.test.ts` | Unit tests for theme provider |
| `supabase/migrations/YYYYMMDD_tenant_session_var.sql` | Session variable helper + RLS policies |
| `supabase/migrations/YYYYMMDD_school_admin_permissions.sql` | Additional permissions for branding/billing/export |

### Modified Files
| File | Changes |
|---|---|
| `src/proxy.ts` | Add tenant resolution layer before auth layer |
| `src/lib/types.ts` | Add `TenantContext`, `SchoolBranding` types |
| `src/lib/rbac.ts` | Ensure `institution_admin` is in `RoleName` type |
| `src/app/layout.tsx` | Wrap with SchoolThemeProvider |
| `src/app/school-admin/layout.tsx` | Add branded shell with sidebar navigation |
| `tailwind.config.js` | Add CSS variable references for brand colors |
| `next.config.js` | Add wildcard domain to allowed origins/images |

---

## Task 1: Tenant Types and Resolution Library

**Files:**
- Create: `src/lib/tenant.ts`
- Modify: `src/lib/types.ts`
- Test: `src/__tests__/tenant.test.ts`

- [ ] **Step 1: Add tenant types to types.ts**

```typescript
// Append to src/lib/types.ts

/* ─── Tenant / Multi-Tenant Types ─── */

export interface SchoolBranding {
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  tagline: string | null;
  faviconUrl: string | null;
  showPoweredBy: boolean;
}

export interface TenantContext {
  schoolId: string | null;       // null = B2C (direct student)
  schoolSlug: string | null;
  schoolName: string | null;
  plan: string;                  // 'trial' | 'free' | 'pro' | 'premium'
  isActive: boolean;
  branding: SchoolBranding;
}

export const NULL_TENANT: TenantContext = {
  schoolId: null,
  schoolSlug: null,
  schoolName: null,
  plan: 'free',
  isActive: true,
  branding: {
    logoUrl: null,
    primaryColor: '#7C3AED',
    secondaryColor: '#F97316',
    tagline: null,
    faviconUrl: null,
    showPoweredBy: false,
  },
};
```

- [ ] **Step 2: Write failing tests for tenant resolution**

```typescript
// src/__tests__/tenant.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveHostToSchool,
  buildTenantContext,
  isB2CDomain,
  extractSlugFromHost,
} from '@/lib/tenant';
import { NULL_TENANT } from '@/lib/types';

describe('tenant resolution', () => {
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
    it('returns true for localhost', () => {
      expect(isB2CDomain('localhost:3000')).toBe(true);
    });
    it('returns false for dps.alfanumrik.com', () => {
      expect(isB2CDomain('dps.alfanumrik.com')).toBe(false);
    });
    it('returns false for learn.dps.com', () => {
      expect(isB2CDomain('learn.dps.com')).toBe(false);
    });
  });

  describe('extractSlugFromHost', () => {
    it('extracts slug from subdomain', () => {
      expect(extractSlugFromHost('dps.alfanumrik.com')).toBe('dps');
    });
    it('returns null for B2C domains', () => {
      expect(extractSlugFromHost('app.alfanumrik.com')).toBeNull();
    });
    it('returns null for www', () => {
      expect(extractSlugFromHost('www.alfanumrik.com')).toBeNull();
    });
    it('returns null for bare domain', () => {
      expect(extractSlugFromHost('alfanumrik.com')).toBeNull();
    });
  });

  describe('buildTenantContext', () => {
    it('returns NULL_TENANT when school is null', () => {
      expect(buildTenantContext(null)).toEqual(NULL_TENANT);
    });

    it('builds context from school record', () => {
      const school = {
        id: 'abc-123',
        slug: 'dps-rk-puram',
        name: 'DPS R.K. Puram',
        subscription_plan: 'pro',
        is_active: true,
        logo_url: 'https://example.com/logo.png',
        primary_color: '#FF0000',
        secondary_color: '#00FF00',
        tagline: 'Excellence in Education',
        settings: {},
      };
      const ctx = buildTenantContext(school);
      expect(ctx.schoolId).toBe('abc-123');
      expect(ctx.schoolSlug).toBe('dps-rk-puram');
      expect(ctx.schoolName).toBe('DPS R.K. Puram');
      expect(ctx.plan).toBe('pro');
      expect(ctx.branding.primaryColor).toBe('#FF0000');
      expect(ctx.branding.logoUrl).toBe('https://example.com/logo.png');
      expect(ctx.branding.showPoweredBy).toBe(true);
    });

    it('uses default colors when school has none', () => {
      const school = {
        id: 'abc-123',
        slug: 'test',
        name: 'Test School',
        subscription_plan: 'trial',
        is_active: true,
        logo_url: null,
        primary_color: null,
        secondary_color: null,
        tagline: null,
        settings: {},
      };
      const ctx = buildTenantContext(school);
      expect(ctx.branding.primaryColor).toBe('#7C3AED');
      expect(ctx.branding.secondaryColor).toBe('#F97316');
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/tenant.test.ts`
Expected: FAIL — module `@/lib/tenant` does not exist

- [ ] **Step 4: Implement tenant resolution library**

```typescript
// src/lib/tenant.ts
/**
 * Multi-Tenant Resolution Library
 *
 * Resolves an incoming hostname to a school tenant context.
 * Used by middleware (proxy.ts) on every request.
 *
 * Resolution order:
 * 1. B2C domains (app.alfanumrik.com, alfanumrik.com, www, localhost) → null tenant
 * 2. Subdomain (*.alfanumrik.com) → lookup schools by slug
 * 3. Custom domain (learn.dps.com) → lookup schools by custom_domain
 *
 * Results are cached in Redis (5min TTL) with in-memory fallback.
 */

import type { TenantContext, SchoolBranding } from './types';
import { NULL_TENANT } from './types';
import { cacheGet, cacheSet, CACHE_TTL } from './cache';

// ── B2C Domains (no tenant resolution needed) ──

const B2C_HOSTS = new Set([
  'alfanumrik.com',
  'www.alfanumrik.com',
  'app.alfanumrik.com',
  'alfanumrik.vercel.app',
  'alfanumrik-ten.vercel.app',
]);

export function isB2CDomain(host: string): boolean {
  const normalized = host.replace(/:\d+$/, '').toLowerCase();
  if (normalized === 'localhost' || normalized.startsWith('localhost:')) return true;
  if (normalized.endsWith('.vercel.app')) return true;
  return B2C_HOSTS.has(normalized);
}

// ── Slug Extraction ──

const RESERVED_SUBDOMAINS = new Set(['app', 'www', 'api', 'admin', 'staging', 'dev']);

export function extractSlugFromHost(host: string): string | null {
  const normalized = host.replace(/:\d+$/, '').toLowerCase();

  // Check if it's a *.alfanumrik.com subdomain
  const match = normalized.match(/^([a-z0-9-]+)\.alfanumrik\.com$/);
  if (!match) return null;

  const slug = match[1];
  if (RESERVED_SUBDOMAINS.has(slug)) return null;

  return slug;
}

// ── School Record Type (from DB query) ──

export interface SchoolRecord {
  id: string;
  slug: string | null;
  name: string;
  subscription_plan: string | null;
  is_active: boolean;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  tagline: string | null;
  settings: Record<string, unknown> | null;
}

// ── Build Tenant Context from School Record ──

const DEFAULT_PRIMARY = '#7C3AED';
const DEFAULT_SECONDARY = '#F97316';

export function buildTenantContext(school: SchoolRecord | null): TenantContext {
  if (!school) return NULL_TENANT;

  const branding: SchoolBranding = {
    logoUrl: school.logo_url,
    primaryColor: school.primary_color || DEFAULT_PRIMARY,
    secondaryColor: school.secondary_color || DEFAULT_SECONDARY,
    tagline: school.tagline,
    faviconUrl: null, // derived from logo_url if needed
    showPoweredBy: true, // B2B always shows "Powered by Alfanumrik"
  };

  return {
    schoolId: school.id,
    schoolSlug: school.slug,
    schoolName: school.name,
    plan: school.subscription_plan || 'trial',
    isActive: school.is_active,
    branding,
  };
}

// ── Resolve Host → School (with caching) ──

const TENANT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const TENANT_CACHE_PREFIX = 'tenant:';

/**
 * Resolve a hostname to a school record.
 *
 * Uses in-memory cache (cache.ts) first.
 * Falls back to Supabase REST API query via service role.
 *
 * @param host - The request hostname (e.g., "dps.alfanumrik.com" or "learn.dps.com")
 * @param supabaseUrl - NEXT_PUBLIC_SUPABASE_URL
 * @param serviceRoleKey - SUPABASE_SERVICE_ROLE_KEY
 * @returns SchoolRecord or null if not found
 */
export async function resolveHostToSchool(
  host: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<SchoolRecord | null> {
  const cacheKey = `${TENANT_CACHE_PREFIX}${host}`;

  // Check cache first
  const cached = cacheGet<SchoolRecord | 'NOT_FOUND'>(cacheKey);
  if (cached === 'NOT_FOUND') return null;
  if (cached) return cached;

  // Try slug resolution (*.alfanumrik.com)
  const slug = extractSlugFromHost(host);
  let school: SchoolRecord | null = null;

  if (slug) {
    school = await querySchoolBySlug(slug, supabaseUrl, serviceRoleKey);
  } else {
    // Try custom domain resolution
    const normalized = host.replace(/:\d+$/, '').toLowerCase();
    school = await querySchoolByDomain(normalized, supabaseUrl, serviceRoleKey);
  }

  // Cache the result (even null → 'NOT_FOUND' to avoid repeated lookups)
  cacheSet(cacheKey, school || 'NOT_FOUND', TENANT_CACHE_TTL);

  return school;
}

// ── Database Queries ──

const SCHOOL_SELECT = 'id,slug,name,subscription_plan,is_active,logo_url,primary_color,secondary_color,tagline,settings';

async function querySchoolBySlug(
  slug: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<SchoolRecord | null> {
  try {
    const url = `${supabaseUrl}/rest/v1/schools?slug=eq.${encodeURIComponent(slug)}&is_active=eq.true&deleted_at=is.null&select=${SCHOOL_SELECT}&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}

async function querySchoolByDomain(
  domain: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<SchoolRecord | null> {
  try {
    const url = `${supabaseUrl}/rest/v1/schools?custom_domain=eq.${encodeURIComponent(domain)}&is_active=eq.true&deleted_at=is.null&select=${SCHOOL_SELECT}&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}

/**
 * Invalidate cached tenant context for a specific host.
 * Call after school branding is updated.
 */
export function invalidateTenantCache(host: string): void {
  // cache.ts doesn't expose delete — set with 0 TTL effectively expires it
  cacheSet(`${TENANT_CACHE_PREFIX}${host}`, 'NOT_FOUND', 1);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/tenant.test.ts`
Expected: PASS — all 9 tests pass (the tests that don't need DB mocks)

- [ ] **Step 6: Commit**

```bash
git add src/lib/tenant.ts src/lib/types.ts src/__tests__/tenant.test.ts
git commit -m "feat(tenant): add multi-tenant resolution library with hostname-to-school lookup"
```

---

## Task 2: Middleware Tenant Integration

**Files:**
- Modify: `src/proxy.ts` (~lines 95-170)
- Modify: `next.config.js`
- Test: `src/__tests__/tenant.test.ts` (extend)

- [ ] **Step 1: Write test for middleware tenant header injection**

Append to `src/__tests__/tenant.test.ts`:

```typescript
describe('middleware integration helpers', () => {
  describe('tenantHeadersFromContext', () => {
    it('returns empty headers for null tenant', () => {
      const { tenantHeadersFromContext } = await import('@/lib/tenant');
      const headers = tenantHeadersFromContext(NULL_TENANT);
      expect(headers['x-school-id']).toBe('');
      expect(headers['x-school-slug']).toBe('');
      expect(headers['x-school-plan']).toBe('free');
    });

    it('returns populated headers for school tenant', () => {
      const { tenantHeadersFromContext } = await import('@/lib/tenant');
      const ctx: TenantContext = {
        schoolId: 'abc-123',
        schoolSlug: 'dps',
        schoolName: 'DPS',
        plan: 'pro',
        isActive: true,
        branding: { ...NULL_TENANT.branding },
      };
      const headers = tenantHeadersFromContext(ctx);
      expect(headers['x-school-id']).toBe('abc-123');
      expect(headers['x-school-slug']).toBe('dps');
      expect(headers['x-school-plan']).toBe('pro');
    });
  });
});
```

- [ ] **Step 2: Add tenantHeadersFromContext to tenant.ts**

Append to `src/lib/tenant.ts`:

```typescript
/**
 * Generate request headers from a tenant context.
 * These headers are injected by middleware for downstream API routes.
 */
export function tenantHeadersFromContext(ctx: TenantContext): Record<string, string> {
  return {
    'x-school-id': ctx.schoolId || '',
    'x-school-slug': ctx.schoolSlug || '',
    'x-school-plan': ctx.plan,
    'x-school-name': ctx.schoolName || '',
  };
}

/**
 * Parse tenant context from request headers (used in API routes).
 */
export function tenantFromHeaders(headers: Headers): { schoolId: string | null; plan: string } {
  const schoolId = headers.get('x-school-id') || null;
  const plan = headers.get('x-school-plan') || 'free';
  return { schoolId: schoolId || null, plan };
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/__tests__/tenant.test.ts`
Expected: PASS

- [ ] **Step 4: Integrate tenant resolution into proxy.ts**

In `src/proxy.ts`, add tenant resolution layer AFTER Layer 0.7 (school-admin session check) and BEFORE Layer 0 (Supabase session refresh). Insert at approximately line 167:

```typescript
// ── Layer 0.8: Multi-Tenant Resolution ──
// Resolves hostname to school tenant context.
// Sets x-school-* headers for downstream API routes.
// B2C domains (alfanumrik.com, www, app, localhost) → null tenant (no headers).
import { isB2CDomain, resolveHostToSchool, buildTenantContext, tenantHeadersFromContext } from './lib/tenant';

// Inside the proxy() function, after line 167 (after school-admin session check):
const host = request.headers.get('host') || request.nextUrl.hostname || '';

if (!isB2CDomain(host)) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceKey) {
    const school = await resolveHostToSchool(host, supabaseUrl, serviceKey);

    if (!school) {
      // Unknown subdomain/domain — show 404
      return new NextResponse(
        '<html><body style="background:#0f0f0f;color:#e0e0e0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1>School Not Found</h1><p style="color:#888">This school is not registered on Alfanumrik.</p><a href="https://alfanumrik.com" style="color:#7C3AED">Go to Alfanumrik</a></div></body></html>',
        { status: 404, headers: { 'Content-Type': 'text/html' } }
      );
    }

    if (!school.is_active) {
      return new NextResponse(
        '<html><body style="background:#0f0f0f;color:#e0e0e0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1>School Suspended</h1><p style="color:#888">This school account has been suspended. Contact your administrator.</p></div></body></html>',
        { status: 403, headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Inject tenant headers for downstream routes
    const tenantCtx = buildTenantContext(school);
    const tenantHeaders = tenantHeadersFromContext(tenantCtx);
    for (const [key, value] of Object.entries(tenantHeaders)) {
      request.headers.set(key, value);
    }
  }
}
```

- [ ] **Step 5: Update ALLOWED_ORIGINS in proxy.ts**

In `src/proxy.ts`, around line 100-108, extend the ALLOWED_ORIGINS:

```typescript
const ALLOWED_ORIGINS = [
  'https://alfanumrik.com',
  'https://www.alfanumrik.com',
  'https://alfanumrik.vercel.app',
  'https://alfanumrik-ten.vercel.app',
];
if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:3000', 'http://localhost:3001');
}

// Allow school subdomains and custom domains
if (origin && (origin.endsWith('.alfanumrik.com') || request.headers.get('x-school-id'))) {
  ALLOWED_ORIGINS.push(origin);
}
```

- [ ] **Step 6: Update next.config.js for wildcard images**

In `next.config.js`, add wildcard pattern to `images.remotePatterns`:

```javascript
images: {
  formats: ['image/avif', 'image/webp'],
  remotePatterns: [
    { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    { protocol: 'https', hostname: '*.supabase.co' },
    { protocol: 'https', hostname: '*.alfanumrik.com' }, // school logos on subdomains
  ],
},
```

- [ ] **Step 7: Commit**

```bash
git add src/proxy.ts next.config.js src/lib/tenant.ts src/__tests__/tenant.test.ts
git commit -m "feat(tenant): integrate tenant resolution into middleware with header injection"
```

---

## Task 3: Tenant-Scoped RLS via Session Variable

**Files:**
- Create: `supabase/migrations/YYYYMMDD_tenant_session_var_rls.sql`
- Test: Verify via Supabase MCP `execute_sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260416200000_tenant_session_var_rls.sql`:

```sql
-- Migration: 20260416200000_tenant_session_var_rls.sql
-- Purpose: Add session-variable-based tenant isolation for multi-tenant RLS.
--
-- Approach: Middleware sets `app.current_school_id` as a transaction-local
-- Postgres session variable. RLS policies use `current_school_id()` helper
-- to scope queries. B2C users have NULL school_id; session var is not set
-- for B2C requests, so current_school_id() returns NULL → matches NULL school_id
-- via IS NOT DISTINCT FROM.
--
-- Idempotency: CREATE OR REPLACE, IF NOT EXISTS, DO $$ blocks with EXCEPTION.

-- ============================================================================
-- 1. Helper function: get current tenant school_id from session variable
-- ============================================================================

CREATE OR REPLACE FUNCTION current_school_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(current_setting('app.current_school_id', true), '')::UUID;
$$;

COMMENT ON FUNCTION current_school_id() IS
  'Returns the current tenant school_id from the Postgres session variable. '
  'Returns NULL for B2C requests (no session variable set). '
  'Used in RLS policies for multi-tenant data isolation.';

-- ============================================================================
-- 2. RPC to set tenant context (called by middleware/API routes)
-- ============================================================================

CREATE OR REPLACE FUNCTION set_tenant_context(p_school_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.current_school_id', p_school_id::text, true);
END;
$$;

COMMENT ON FUNCTION set_tenant_context(UUID) IS
  'Sets the tenant school_id as a transaction-local session variable. '
  'Called by middleware after resolving hostname to school. '
  'The true param means LOCAL (transaction-scoped, no cross-request leak).';

-- ============================================================================
-- 3. Add domain_verified column to schools (for custom domain verification)
-- ============================================================================

ALTER TABLE schools ADD COLUMN IF NOT EXISTS domain_verified BOOLEAN DEFAULT false;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS domain_verification_token TEXT;

-- Index for custom domain lookup (used by middleware on every request)
CREATE INDEX IF NOT EXISTS idx_schools_custom_domain_active
  ON schools (custom_domain)
  WHERE custom_domain IS NOT NULL AND is_active = true AND deleted_at IS NULL;

-- ============================================================================
-- 4. Denormalize school_id onto quiz_results for tenant-scoped RLS
-- ============================================================================

-- quiz_results and student_learning_profiles don't have school_id.
-- We add it and backfill from the student's school_id.

DO $$ BEGIN
  ALTER TABLE quiz_results ADD COLUMN school_id UUID REFERENCES schools(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Backfill existing quiz_results with student's school_id
UPDATE quiz_results qr
SET school_id = s.school_id
FROM students s
WHERE qr.student_id = s.id
  AND qr.school_id IS NULL
  AND s.school_id IS NOT NULL;

-- Index for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_quiz_results_school_id
  ON quiz_results (school_id)
  WHERE school_id IS NOT NULL;

-- Trigger to auto-populate school_id on new quiz_results
CREATE OR REPLACE FUNCTION set_quiz_result_school_id()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.school_id IS NULL AND NEW.student_id IS NOT NULL THEN
    SELECT school_id INTO NEW.school_id
    FROM students WHERE id = NEW.student_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quiz_results_set_school_id ON quiz_results;
CREATE TRIGGER trg_quiz_results_set_school_id
  BEFORE INSERT ON quiz_results
  FOR EACH ROW EXECUTE FUNCTION set_quiz_result_school_id();

-- ============================================================================
-- 5. Same for student_learning_profiles
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE student_learning_profiles ADD COLUMN school_id UUID REFERENCES schools(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

UPDATE student_learning_profiles slp
SET school_id = s.school_id
FROM students s
WHERE slp.student_id = s.id
  AND slp.school_id IS NULL
  AND s.school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_slp_school_id
  ON student_learning_profiles (school_id)
  WHERE school_id IS NOT NULL;

CREATE OR REPLACE FUNCTION set_slp_school_id()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.school_id IS NULL AND NEW.student_id IS NOT NULL THEN
    SELECT school_id INTO NEW.school_id
    FROM students WHERE id = NEW.student_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_slp_set_school_id ON student_learning_profiles;
CREATE TRIGGER trg_slp_set_school_id
  BEFORE INSERT ON student_learning_profiles
  FOR EACH ROW EXECUTE FUNCTION set_slp_school_id();
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__claude_ai_Supabase__apply_migration` to apply the migration to the Supabase project `shktyoxqhundlvkiwguu`.

- [ ] **Step 3: Verify migration succeeded**

Run via Supabase MCP:
```sql
-- Verify current_school_id() function exists
SELECT current_school_id(); -- should return NULL

-- Verify set_tenant_context works
SELECT set_tenant_context('00000000-0000-0000-0000-000000000001'::uuid);
SELECT current_school_id(); -- should return the UUID

-- Verify domain columns exist
SELECT domain_verified, domain_verification_token FROM schools LIMIT 1;

-- Verify school_id on quiz_results
SELECT column_name FROM information_schema.columns
WHERE table_name = 'quiz_results' AND column_name = 'school_id';
```

Expected: All queries succeed, confirming the migration applied correctly.

- [ ] **Step 4: Commit migration file**

```bash
git add supabase/migrations/20260416200000_tenant_session_var_rls.sql
git commit -m "feat(db): add tenant session variable RLS helpers and school_id denormalization"
```

---

## Task 4: Additional RBAC Permissions

**Files:**
- Create: `supabase/migrations/20260416200100_school_admin_extra_permissions.sql`

- [ ] **Step 1: Write migration for missing permissions**

Existing permissions cover academic operations (class.manage, exam.assign, etc.) but are missing branding, billing, and domain management.

```sql
-- Migration: 20260416200100_school_admin_extra_permissions.sql
-- Purpose: Add missing permissions for school admin branding, billing, and domain management.

-- Insert missing permissions (idempotent via ON CONFLICT)
INSERT INTO permissions (code, description, category) VALUES
  ('school.manage_branding', 'Update school logo, colors, and tagline', 'school'),
  ('school.manage_billing', 'View subscription details and seat usage', 'school'),
  ('school.manage_domain', 'Configure custom domain for school', 'school'),
  ('school.export_data', 'Export school data (students, reports)', 'school'),
  ('school.manage_settings', 'Update school-level configuration', 'school')
ON CONFLICT (code) DO NOTHING;

-- Assign new permissions to institution_admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'institution_admin'
  AND p.code IN (
    'school.manage_branding',
    'school.manage_billing',
    'school.manage_domain',
    'school.export_data',
    'school.manage_settings'
  )
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

- [ ] **Step 3: Verify permissions assigned**

Run via Supabase MCP:
```sql
SELECT p.code FROM permissions p
JOIN role_permissions rp ON rp.permission_id = p.id
JOIN roles r ON rp.role_id = r.id
WHERE r.name = 'institution_admin' AND p.code LIKE 'school.%'
ORDER BY p.code;
```

Expected: Returns `school.export_data`, `school.manage_billing`, `school.manage_branding`, `school.manage_domain`, `school.manage_settings`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260416200100_school_admin_extra_permissions.sql
git commit -m "feat(rbac): add branding, billing, and domain permissions for institution_admin"
```

---

## Task 5: School Admin API Routes

**Files:**
- Create: `src/app/api/school-admin/analytics/route.ts`
- Create: `src/app/api/school-admin/teachers/route.ts`
- Create: `src/app/api/school-admin/students/route.ts`
- Create: `src/app/api/school-admin/invite-codes/route.ts`
- Create: `src/app/api/school-admin/branding/route.ts`
- Create: `src/app/api/school-admin/subscription/route.ts`
- Create: `src/lib/school-admin-auth.ts`
- Test: `src/__tests__/school-admin-api.test.ts`

- [ ] **Step 1: Create school admin auth helper**

```typescript
// src/lib/school-admin-auth.ts
/**
 * Auth helper for school admin API routes.
 *
 * Verifies the caller is an active institution_admin for the specified school.
 * Uses the existing authorizeRequest pattern from rbac.ts for permission checks,
 * plus a school_admins table lookup for school-level authorization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { authorizeRequest, type AuthorizationResult } from '@/lib/rbac';
import { logger } from '@/lib/logger';

export interface SchoolAdminAuth {
  authorized: boolean;
  userId: string;
  schoolId: string;
  schoolAdminId: string;
  errorResponse?: NextResponse;
}

/**
 * Authorize a request as a school admin action.
 *
 * 1. Verify auth via authorizeRequest (checks JWT + role)
 * 2. Look up the user in school_admins to get their school_id
 * 3. Verify school is active
 *
 * @param request — The incoming request
 * @param permission — Required permission code (e.g., 'institution.manage_students')
 */
export async function authorizeSchoolAdmin(
  request: NextRequest,
  permission: string
): Promise<SchoolAdminAuth> {
  // Step 1: Standard RBAC check
  const auth: AuthorizationResult = await authorizeRequest(request, permission);
  if (!auth.authorized || !auth.userId) {
    return {
      authorized: false,
      userId: '',
      schoolId: '',
      schoolAdminId: '',
      errorResponse: auth.errorResponse || NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      ),
    };
  }

  // Step 2: Look up school_admins record
  const supabase = getSupabaseAdmin();
  const { data: adminRecord, error } = await supabase
    .from('school_admins')
    .select('id, school_id, is_active')
    .eq('auth_user_id', auth.userId)
    .eq('is_active', true)
    .single();

  if (error || !adminRecord) {
    logger.warn('School admin lookup failed', {
      userId: auth.userId,
      error: error?.message,
    });
    return {
      authorized: false,
      userId: auth.userId,
      schoolId: '',
      schoolAdminId: '',
      errorResponse: NextResponse.json(
        { error: 'Not a school administrator' },
        { status: 403 }
      ),
    };
  }

  // Step 3: Verify school is active
  const { data: school } = await supabase
    .from('schools')
    .select('is_active')
    .eq('id', adminRecord.school_id)
    .single();

  if (!school?.is_active) {
    return {
      authorized: false,
      userId: auth.userId,
      schoolId: adminRecord.school_id,
      schoolAdminId: adminRecord.id,
      errorResponse: NextResponse.json(
        { error: 'School account is suspended' },
        { status: 403 }
      ),
    };
  }

  return {
    authorized: true,
    userId: auth.userId,
    schoolId: adminRecord.school_id,
    schoolAdminId: adminRecord.id,
  };
}
```

- [ ] **Step 2: Create analytics API route**

```typescript
// src/app/api/school-admin/analytics/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'institution.view_analytics');
  if (!auth.authorized) return auth.errorResponse!;

  const supabase = getSupabaseAdmin();

  try {
    // Parallel queries for dashboard stats
    const [studentsRes, teachersRes, classesRes, quizRes] = await Promise.all([
      supabase
        .from('students')
        .select('id, is_active, last_active', { count: 'exact' })
        .eq('school_id', auth.schoolId)
        .is('deleted_at', null),

      supabase
        .from('teachers')
        .select('id', { count: 'exact' })
        .eq('school_id', auth.schoolId),

      supabase
        .from('classes')
        .select('id', { count: 'exact' })
        .eq('school_id', auth.schoolId),

      supabase
        .from('quiz_results')
        .select('score_percent, created_at')
        .eq('school_id', auth.schoolId)
        .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
        .order('created_at', { ascending: false })
        .limit(500),
    ]);

    const totalStudents = studentsRes.count || 0;
    const activeStudents = (studentsRes.data || []).filter(s => s.is_active).length;

    // Active today = last_active within 24 hours
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    const activeToday = (studentsRes.data || []).filter(
      s => s.last_active && s.last_active > oneDayAgo
    ).length;

    const totalTeachers = teachersRes.count || 0;
    const totalClasses = classesRes.count || 0;

    // Quiz stats (last 7 days)
    const quizzes = quizRes.data || [];
    const avgScore = quizzes.length > 0
      ? Math.round(quizzes.reduce((sum, q) => sum + (q.score_percent || 0), 0) / quizzes.length)
      : 0;

    // Seat usage
    const { data: sub } = await supabase
      .from('school_subscriptions')
      .select('seats_purchased, plan, status')
      .eq('school_id', auth.schoolId)
      .eq('status', 'active')
      .single();

    return NextResponse.json({
      totalStudents,
      activeStudents,
      activeToday,
      totalTeachers,
      totalClasses,
      quizzesThisWeek: quizzes.length,
      avgScore,
      seatsPurchased: sub?.seats_purchased || 0,
      seatsUsed: totalStudents,
      plan: sub?.plan || 'trial',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Create teachers API route**

```typescript
// src/app/api/school-admin/teachers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// GET — list teachers for this school
export async function GET(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'institution.manage_teachers');
  if (!auth.authorized) return auth.errorResponse!;

  const supabase = getSupabaseAdmin();
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, parseInt(params.get('page') || '1'));
  const limit = Math.min(100, parseInt(params.get('limit') || '25'));
  const offset = (page - 1) * limit;

  const { data, count, error } = await supabase
    .from('teachers')
    .select('id, auth_user_id, name, email, phone, subjects_taught, grades_taught, is_active, created_at', { count: 'exact' })
    .eq('school_id', auth.schoolId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data || [], total: count || 0, page, limit });
}

// POST — invite a teacher to this school
export async function POST(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'institution.manage_teachers');
  if (!auth.authorized) return auth.errorResponse!;

  const body = await request.json();
  const { name, email, subjects_taught, grades_taught } = body;

  if (!name || !email) {
    return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Check if teacher already exists for this school
  const { data: existing } = await supabase
    .from('teachers')
    .select('id')
    .eq('school_id', auth.schoolId)
    .eq('email', email)
    .single();

  if (existing) {
    return NextResponse.json({ error: 'Teacher with this email already exists in your school' }, { status: 409 });
  }

  const { data, error } = await supabase
    .from('teachers')
    .insert({
      school_id: auth.schoolId,
      name,
      email,
      subjects_taught: subjects_taught || [],
      grades_taught: grades_taught || [],
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data }, { status: 201 });
}

// PATCH — update a teacher
export async function PATCH(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'institution.manage_teachers');
  if (!auth.authorized) return auth.errorResponse!;

  const body = await request.json();
  const { id, updates } = body;

  if (!id || !updates) {
    return NextResponse.json({ error: 'Teacher id and updates required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const ALLOWED = ['name', 'subjects_taught', 'grades_taught', 'is_active'];
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (ALLOWED.includes(k)) safe[k] = v;
  }

  const { error } = await supabase
    .from('teachers')
    .update(safe)
    .eq('id', id)
    .eq('school_id', auth.schoolId); // ensure school-scoped

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Create students API route**

```typescript
// src/app/api/school-admin/students/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// GET — list students for this school
export async function GET(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'institution.manage_students');
  if (!auth.authorized) return auth.errorResponse!;

  const supabase = getSupabaseAdmin();
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, parseInt(params.get('page') || '1'));
  const limit = Math.min(100, parseInt(params.get('limit') || '25'));
  const offset = (page - 1) * limit;
  const grade = params.get('grade');
  const search = params.get('search');

  let query = supabase
    .from('students')
    .select('id, name, email, grade, is_active, xp_total, last_active, subscription_plan, created_at', { count: 'exact' })
    .eq('school_id', auth.schoolId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (grade) query = query.eq('grade', grade); // P5: grade is string
  if (search) query = query.ilike('name', `%${search}%`);

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data || [], total: count || 0, page, limit });
}

// PATCH — update student (activate/deactivate)
export async function PATCH(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'institution.manage_students');
  if (!auth.authorized) return auth.errorResponse!;

  const body = await request.json();
  const { id, updates } = body;

  if (!id || !updates) {
    return NextResponse.json({ error: 'Student id and updates required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  // School admin can only toggle is_active
  const safe: Record<string, unknown> = {};
  if ('is_active' in updates) safe.is_active = updates.is_active;

  const { error } = await supabase
    .from('students')
    .update(safe)
    .eq('id', id)
    .eq('school_id', auth.schoolId); // school-scoped

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Create invite-codes API route**

```typescript
// src/app/api/school-admin/invite-codes/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

function generateCode(prefix: string): string {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${year}-${rand}`;
}

// GET — list invite codes for this school
export async function GET(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'institution.manage_students');
  if (!auth.authorized) return auth.errorResponse!;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('school_invite_codes')
    .select('id, code, role, max_uses, uses_count, expires_at, is_active, created_at')
    .eq('school_id', auth.schoolId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data || [] });
}

// POST — generate new invite code
export async function POST(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'institution.manage_students');
  if (!auth.authorized) return auth.errorResponse!;

  const body = await request.json();
  const role = body.role === 'teacher' ? 'teacher' : 'student';
  const maxUses = Math.min(1000, Math.max(1, parseInt(body.max_uses || '100')));
  const expiresInDays = Math.min(365, Math.max(1, parseInt(body.expires_in_days || '90')));

  // Get school slug for code prefix
  const supabase = getSupabaseAdmin();
  const { data: school } = await supabase
    .from('schools')
    .select('slug, name')
    .eq('id', auth.schoolId)
    .single();

  const prefix = (school?.slug || 'SCH').substring(0, 6).toUpperCase();
  const code = generateCode(prefix);

  const expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();

  const { data, error } = await supabase
    .from('school_invite_codes')
    .insert({
      school_id: auth.schoolId,
      code,
      role,
      max_uses: maxUses,
      expires_at: expiresAt,
      created_by: auth.userId,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data }, { status: 201 });
}

// DELETE — deactivate invite code
export async function DELETE(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'institution.manage_students');
  if (!auth.authorized) return auth.errorResponse!;

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'Code id required' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('school_invite_codes')
    .update({ is_active: false })
    .eq('id', id)
    .eq('school_id', auth.schoolId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 6: Create branding API route**

```typescript
// src/app/api/school-admin/branding/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { invalidateTenantCache } from '@/lib/tenant';

// GET — read school branding
export async function GET(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'school.manage_branding');
  if (!auth.authorized) return auth.errorResponse!;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('schools')
    .select('name, slug, logo_url, primary_color, secondary_color, tagline, custom_domain, domain_verified, billing_email, settings')
    .eq('id', auth.schoolId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

// PUT — update school branding
export async function PUT(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'school.manage_branding');
  if (!auth.authorized) return auth.errorResponse!;

  const body = await request.json();
  const ALLOWED = ['logo_url', 'primary_color', 'secondary_color', 'tagline', 'billing_email'];
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED.includes(k)) safe[k] = v;
  }

  // Validate color format
  const colorRegex = /^#[0-9A-Fa-f]{6}$/;
  if (safe.primary_color && !colorRegex.test(safe.primary_color as string)) {
    return NextResponse.json({ error: 'Invalid primary_color format. Use #RRGGBB.' }, { status: 400 });
  }
  if (safe.secondary_color && !colorRegex.test(safe.secondary_color as string)) {
    return NextResponse.json({ error: 'Invalid secondary_color format. Use #RRGGBB.' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('schools')
    .update(safe)
    .eq('id', auth.schoolId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Invalidate tenant cache so branding changes take effect immediately
  const { data: school } = await supabase
    .from('schools')
    .select('slug, custom_domain')
    .eq('id', auth.schoolId)
    .single();

  if (school?.slug) invalidateTenantCache(`${school.slug}.alfanumrik.com`);
  if (school?.custom_domain) invalidateTenantCache(school.custom_domain);

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 7: Create subscription API route**

```typescript
// src/app/api/school-admin/subscription/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// GET — read school subscription and seat usage
export async function GET(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'school.manage_billing');
  if (!auth.authorized) return auth.errorResponse!;

  const supabase = getSupabaseAdmin();

  const [subRes, seatRes] = await Promise.all([
    supabase
      .from('school_subscriptions')
      .select('*')
      .eq('school_id', auth.schoolId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),

    supabase
      .from('students')
      .select('id', { count: 'exact' })
      .eq('school_id', auth.schoolId)
      .eq('is_active', true),
  ]);

  return NextResponse.json({
    subscription: subRes.data || null,
    seatsUsed: seatRes.count || 0,
    error: subRes.error?.message || null,
  });
}
```

- [ ] **Step 8: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors

- [ ] **Step 9: Commit all API routes**

```bash
git add src/lib/school-admin-auth.ts src/app/api/school-admin/
git commit -m "feat(api): add school admin API routes for teachers, students, analytics, invite-codes, branding, subscription"
```

---

## Task 6: School Theme Provider

**Files:**
- Create: `src/lib/tenant-context.ts`
- Create: `src/components/SchoolThemeProvider.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `tailwind.config.js`
- Test: `src/__tests__/school-theme.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/__tests__/school-theme.test.ts
import { describe, it, expect } from 'vitest';
import { cssVarsFromBranding } from '@/lib/tenant-context';

describe('cssVarsFromBranding', () => {
  it('returns CSS variables from branding', () => {
    const vars = cssVarsFromBranding({
      logoUrl: null,
      primaryColor: '#FF0000',
      secondaryColor: '#00FF00',
      tagline: null,
      faviconUrl: null,
      showPoweredBy: true,
    });
    expect(vars['--color-brand-primary']).toBe('#FF0000');
    expect(vars['--color-brand-secondary']).toBe('#00FF00');
  });

  it('uses Alfanumrik defaults for null colors', () => {
    const vars = cssVarsFromBranding({
      logoUrl: null,
      primaryColor: '#7C3AED',
      secondaryColor: '#F97316',
      tagline: null,
      faviconUrl: null,
      showPoweredBy: false,
    });
    expect(vars['--color-brand-primary']).toBe('#7C3AED');
    expect(vars['--color-brand-secondary']).toBe('#F97316');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/school-theme.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create tenant context library**

```typescript
// src/lib/tenant-context.ts
'use client';

import { createContext, useContext } from 'react';
import type { TenantContext, SchoolBranding } from './types';
import { NULL_TENANT } from './types';

/**
 * React context for the current school tenant.
 * Populated by SchoolThemeProvider in layout.tsx.
 * NULL_TENANT = B2C (no school).
 */
export const TenantCtx = createContext<TenantContext>(NULL_TENANT);

export function useTenant(): TenantContext {
  return useContext(TenantCtx);
}

/**
 * Convert school branding into CSS custom property key-value pairs.
 * Applied to <html> element to cascade through entire app.
 */
export function cssVarsFromBranding(branding: SchoolBranding): Record<string, string> {
  return {
    '--color-brand-primary': branding.primaryColor,
    '--color-brand-secondary': branding.secondaryColor,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/school-theme.test.ts`
Expected: PASS

- [ ] **Step 5: Create SchoolThemeProvider component**

```typescript
// src/components/SchoolThemeProvider.tsx
'use client';

import { useEffect, type ReactNode } from 'react';
import { TenantCtx, cssVarsFromBranding } from '@/lib/tenant-context';
import type { TenantContext } from '@/lib/types';
import { NULL_TENANT } from '@/lib/types';

interface Props {
  tenant: TenantContext | null;
  children: ReactNode;
}

/**
 * Applies school branding via CSS custom properties on <html>.
 * Wraps the app in TenantCtx.Provider so any component can call useTenant().
 *
 * For B2C (tenant=null), applies default Alfanumrik branding.
 * For B2B, applies school's colors, and shows school logo via useTenant().
 *
 * Bundle impact: <2kB (well within P10 budget).
 */
export default function SchoolThemeProvider({ tenant, children }: Props) {
  const ctx = tenant || NULL_TENANT;

  useEffect(() => {
    const vars = cssVarsFromBranding(ctx.branding);
    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }

    // Cleanup: remove custom properties on unmount
    return () => {
      for (const key of Object.keys(vars)) {
        root.style.removeProperty(key);
      }
    };
  }, [ctx.branding]);

  return (
    <TenantCtx.Provider value={ctx}>
      {children}
    </TenantCtx.Provider>
  );
}
```

- [ ] **Step 6: Update tailwind.config.js to reference CSS variables**

Add to the `theme.extend.colors` section in `tailwind.config.js`:

```javascript
// Inside theme.extend.colors:
brand: {
  primary: 'var(--color-brand-primary, #7C3AED)',
  secondary: 'var(--color-brand-secondary, #F97316)',
},
```

This allows `bg-brand-primary` and `text-brand-secondary` classes that automatically use the school's colors when set via SchoolThemeProvider.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tenant-context.ts src/components/SchoolThemeProvider.tsx tailwind.config.js src/__tests__/school-theme.test.ts
git commit -m "feat(theme): add SchoolThemeProvider with CSS variable branding and tenant context"
```

---

## Task 7: School Admin Layout Upgrade

**Files:**
- Modify: `src/app/school-admin/layout.tsx`

- [ ] **Step 1: Replace minimal layout with branded shell**

The current layout is a bare 10-line metadata-only file. Replace with a proper sidebar layout that mirrors the super-admin pattern but scoped to school:

```typescript
// src/app/school-admin/layout.tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'School Admin — Alfanumrik',
  description: 'Manage your school on Alfanumrik. Teachers, students, classes, reports.',
};

// Client layout component with sidebar navigation
import SchoolAdminShell from './_components/SchoolAdminShell';

export default function SchoolAdminLayout({ children }: { children: React.ReactNode }) {
  return <SchoolAdminShell>{children}</SchoolAdminShell>;
}
```

- [ ] **Step 2: Create SchoolAdminShell component**

Create `src/app/school-admin/_components/SchoolAdminShell.tsx`:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useTenant } from '@/lib/tenant-context';
import { supabase } from '@/lib/supabase';

const NAV_ITEMS = [
  { href: '/school-admin', label: 'Dashboard', labelHi: 'डैशबोर्ड', icon: '▦' },
  { href: '/school-admin/students', label: 'Students', labelHi: 'छात्र', icon: '⊕' },
  { href: '/school-admin/teachers', label: 'Teachers', labelHi: 'शिक्षक', icon: '⊛' },
  { href: '/school-admin/classes', label: 'Classes', labelHi: 'कक्षाएँ', icon: '⊞' },
  { href: '/school-admin/invite-codes', label: 'Invite Codes', labelHi: 'आमंत्रण कोड', icon: '⊡' },
  { href: '/school-admin/setup', label: 'Branding', labelHi: 'ब्रांडिंग', icon: '◎' },
];

export default function SchoolAdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { authUserId, isHi } = useAuth();
  const tenant = useTenant();
  const [schoolName, setSchoolName] = useState<string>(tenant.schoolName || 'School Admin');

  useEffect(() => {
    if (!authUserId) {
      router.push('/login');
      return;
    }
    // Fetch school name if not from tenant context
    if (!tenant.schoolName) {
      supabase
        .from('school_admins')
        .select('school_id, schools(name)')
        .eq('auth_user_id', authUserId)
        .eq('is_active', true)
        .single()
        .then(({ data }) => {
          if (data?.schools && typeof data.schools === 'object' && 'name' in data.schools) {
            setSchoolName((data.schools as { name: string }).name);
          }
        });
    }
  }, [authUserId, tenant.schoolName, router]);

  const logoUrl = tenant.branding.logoUrl;
  const primaryColor = tenant.branding.primaryColor;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#fafafa' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220,
        background: '#fff',
        borderRight: '1px solid #e5e7eb',
        padding: '20px 0',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* School branding */}
        <div style={{ padding: '0 16px 20px', borderBottom: '1px solid #e5e7eb' }}>
          {logoUrl ? (
            <img src={logoUrl} alt={schoolName} style={{ height: 32, marginBottom: 8, objectFit: 'contain' }} />
          ) : (
            <div style={{ fontSize: 18, fontWeight: 700, color: primaryColor }}>{schoolName}</div>
          )}
          <div style={{ fontSize: 11, color: '#888' }}>
            {isHi ? 'स्कूल प्रशासन' : 'School Administration'}
          </div>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, paddingTop: 8 }}>
          {NAV_ITEMS.map(item => {
            const active = pathname === item.href || (item.href !== '/school-admin' && pathname.startsWith(item.href));
            return (
              <a
                key={item.href}
                href={item.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 16px',
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  color: active ? primaryColor : '#555',
                  background: active ? `${primaryColor}10` : 'transparent',
                  borderLeft: active ? `3px solid ${primaryColor}` : '3px solid transparent',
                  textDecoration: 'none',
                }}
              >
                <span>{item.icon}</span>
                <span>{isHi ? item.labelHi : item.label}</span>
              </a>
            );
          })}
        </nav>

        {/* Powered by */}
        {tenant.branding.showPoweredBy && (
          <div style={{ padding: '12px 16px', fontSize: 10, color: '#aaa', borderTop: '1px solid #e5e7eb' }}>
            Powered by <a href="https://alfanumrik.com" style={{ color: '#7C3AED' }}>Alfanumrik</a>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, padding: 24, maxWidth: 1200 }}>
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/school-admin/layout.tsx src/app/school-admin/_components/SchoolAdminShell.tsx
git commit -m "feat(school-admin): add branded sidebar shell with bilingual nav"
```

---

## Task 8: Vercel Wildcard Domain Configuration

**Files:** None (infrastructure only — Vercel API)

- [ ] **Step 1: Add wildcard domain via Vercel MCP**

Use `mcp__claude_ai_Vercel__deploy_to_vercel` or the Vercel dashboard to add `*.alfanumrik.com` as a wildcard domain to the project `prj_1PRfOVHYbSemMYSU5DXCMIUG9sda`.

Alternatively, via Vercel CLI:
```bash
npx vercel domains add "*.alfanumrik.com" --project alfanumrik
```

- [ ] **Step 2: Verify DNS configuration**

Add a wildcard CNAME record at the DNS provider:
- Type: CNAME
- Name: `*`
- Value: `cname.vercel-dns.com`
- TTL: 300

- [ ] **Step 3: Verify resolution works**

```bash
curl -I https://test-school.alfanumrik.com
```

Expected: Returns a response from Vercel (may be 404 since no school exists with slug `test-school`, which is correct — middleware will handle the 404 page).

---

## Task 9: Integration Testing

**Files:**
- Create: `src/__tests__/school-admin-api.test.ts`

- [ ] **Step 1: Write integration tests for school admin auth**

```typescript
// src/__tests__/school-admin-api.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase-admin
vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'admin-1', school_id: 'school-1', is_active: true },
        error: null,
      }),
    })),
  })),
}));

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: vi.fn().mockResolvedValue({
    authorized: true,
    userId: 'user-1',
    studentId: null,
    roles: ['institution_admin'],
    permissions: ['institution.view_analytics'],
  }),
}));

describe('school admin API authorization', () => {
  it('rejects requests without valid auth', async () => {
    const { authorizeRequest } = await import('@/lib/rbac');
    (authorizeRequest as any).mockResolvedValueOnce({
      authorized: false,
      userId: null,
      errorResponse: new Response('Unauthorized', { status: 401 }),
    });

    const { authorizeSchoolAdmin } = await import('@/lib/school-admin-auth');
    const mockRequest = new Request('http://localhost:3000/api/school-admin/analytics') as any;
    mockRequest.headers = new Headers();

    const result = await authorizeSchoolAdmin(mockRequest, 'institution.view_analytics');
    expect(result.authorized).toBe(false);
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All existing tests pass + new tests pass

- [ ] **Step 3: Run type-check and lint**

```bash
npm run type-check && npm run lint
```

Expected: PASS — no errors

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: PASS — production build succeeds

- [ ] **Step 5: Final commit**

```bash
git add src/__tests__/school-admin-api.test.ts
git commit -m "test: add school admin API authorization tests"
```

---

## Task 10: End-to-End Validation

**Files:** None (manual + automated verification)

- [ ] **Step 1: Verify tenant resolution with test school**

Via Supabase MCP, create a test school:
```sql
INSERT INTO schools (name, slug, board, is_active, primary_color, secondary_color, tagline)
VALUES ('Test Pilot School', 'test-pilot', 'CBSE', true, '#1E40AF', '#F59E0B', 'Learning Made Fun')
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Verify wildcard domain resolves**

After deployment, visit `https://test-pilot.alfanumrik.com` and verify:
- School branding colors applied (blue primary, amber secondary)
- "Test Pilot School" name appears
- Student dashboard works normally
- No B2C data leaks into B2B view

- [ ] **Step 3: Verify B2C regression**

Visit `https://alfanumrik.com` and verify:
- Default Alfanumrik branding (purple + orange)
- All existing features work
- No tenant headers present
- Login/signup flow unbroken (P15)

- [ ] **Step 4: Tag release**

```bash
git tag v2.0.0-b2b-phase1-alpha
```

---

## Dependency Graph

```
Task 1 (tenant types + lib) ──→ Task 2 (middleware) ──→ Task 8 (Vercel domain)
                               ↓                              ↓
Task 3 (RLS migration) ───────→ Task 5 (API routes) ──→ Task 9 (integration tests)
                               ↓                              ↓
Task 4 (RBAC permissions) ────→ Task 6 (theme provider) → Task 10 (E2E validation)
                                 ↓
                               Task 7 (layout upgrade)
```

**Parallelizable:**
- Task 1 + Task 3 + Task 4 (independent: library, migration, permissions)
- Task 6 + Task 7 (theme provider + layout — different files)

**Sequential:**
- Task 2 depends on Task 1
- Task 5 depends on Task 3 + Task 4
- Task 9 depends on Task 5 + Task 6
- Task 10 depends on everything

---

## Review Chain Requirements (P14)

| Files Modified | Required Reviewers |
|---|---|
| `src/proxy.ts` (middleware) | architect (auth), backend, testing, quality |
| `supabase/migrations/*` (RLS, RBAC) | architect, testing, quality |
| `src/app/school-admin/*` (pages) | frontend, ops (admin), testing, quality |
| `src/app/api/school-admin/*` (API) | backend, architect (auth), testing, quality |
| `src/components/SchoolThemeProvider.tsx` | frontend, quality |
| `tailwind.config.js` | frontend, quality |
| `next.config.js` | architect, quality |