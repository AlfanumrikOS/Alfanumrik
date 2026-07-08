/**
 * GET /api/tenant/config
 *
 * The Phase B/C/D consumer endpoint. Returns the enriched tenant view that
 * the frontend's TenantContext (and its future module-aware menu builder)
 * needs to render a white-labeled experience:
 *
 *   - tenant_type            → drives copy variants (school/coaching/corp/govt)
 *   - typography             → font_heading, font_body, border_radius_px
 *   - branding               → logo, colors, tagline (mirrors /api/school-config)
 *   - enabled_modules        → which of the 9 product modules render
 *   - config                 → the full typed AI/locale/communication map
 *
 * This is a NEW endpoint, additive to `/api/school-config`. We deliberately
 * do NOT modify /api/school-config or proxy.ts:
 *   - /api/school-config is in the hot path and cached by clients today;
 *     changing its shape risks breaking older client code.
 *   - proxy.ts has a "DO NOT modify" banner around the auth-critical block.
 *
 * Auth: none. Tenant branding/config is public information by design (the
 *       same policy /api/school-config follows). Sensitive values (API keys,
 *       webhook secrets) live in different tables and never flow through here.
 *
 * Source of truth:
 *   - Reads `x-school-id` from request headers — proxy.ts injects this
 *     after Layer-0 host→school resolution. When the header is absent
 *     (B2C / unresolved host) we return `{ isTenantContext: false }` and
 *     the client falls back to default Alfanumrik branding.
 *   - Uses supabaseAdmin (service-role) to fetch the schools row by id.
 *     This bypasses RLS — safe here because the response shape is
 *     deliberately limited to the public branding/config surface.
 *
 * Cache: `Cache-Control: public, max-age=300, s-maxage=300` (5 min) — same
 *        TTL the proxy uses for its in-memory school cache, and matches
 *        /api/school-config so client code can reason about freshness
 *        uniformly.
 *
 * Failure mode: any error during enrichment falls back to the legacy-shape
 *               response (just branding, no modules/config). Frontend treats
 *               missing fields as "use defaults" — never blocks the page.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import {
  tenantFromSchool,
  type SchoolRecordWithTenantFields,
} from '@alfanumrik/lib/tenant-domain';
import { enabledModulesFor, type ModuleKey } from '@alfanumrik/lib/modules/registry';
import { getAllTenantConfig } from '@alfanumrik/lib/tenant-config';

// Columns the enrichment needs. Mirrors the SchoolRecord shape plus the
// Phase B columns added by migration 20260507000004.
const TENANT_SELECT =
  'id,slug,name,subscription_plan,is_active,logo_url,primary_color,secondary_color,tagline,settings,tenant_type,font_heading,font_body,border_radius_px';

const NO_TENANT_BODY = { isTenantContext: false } as const;

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, s-maxage=300',
} as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const schoolId = request.headers.get('x-school-id');

  // No tenant context (B2C / unresolved host). Mirror the
  // /api/school-config no-tenant response so client code is uniform.
  if (!schoolId) {
    return NextResponse.json(NO_TENANT_BODY, { headers: CACHE_HEADERS });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('schools')
      .select(TENANT_SELECT)
      .eq('id', schoolId)
      .maybeSingle();

    if (error || !data) {
      // The header points at a school we can't load — most likely a
      // race between proxy cache and a deleted/disabled school. Return
      // no-tenant; client falls back to default branding.
      return NextResponse.json(NO_TENANT_BODY, { headers: CACHE_HEADERS });
    }

    const tenant = tenantFromSchool(data as SchoolRecordWithTenantFields);
    if (!tenant) {
      return NextResponse.json(NO_TENANT_BODY, { headers: CACHE_HEADERS });
    }

    // Run module + config resolution in parallel — both consult the same
    // feature_flags cache, so fan-out is cheap.
    const [modules, config] = await Promise.all([
      enabledModulesFor(tenant.schoolId, tenant.tenantType),
      getAllTenantConfig(tenant.schoolId, tenant.tenantType),
    ]);

    const body: TenantConfigResponse = {
      isTenantContext: true,
      tenant: {
        id: tenant.schoolId!,
        slug: tenant.schoolSlug,
        name: tenant.schoolName,
        plan: tenant.plan,
        isActive: tenant.isActive,
        tenantType: tenant.tenantType,
        branding: {
          logoUrl: tenant.branding.logoUrl,
          primaryColor: tenant.branding.primaryColor,
          secondaryColor: tenant.branding.secondaryColor,
          tagline: tenant.branding.tagline,
          faviconUrl: tenant.branding.faviconUrl,
          showPoweredBy: tenant.branding.showPoweredBy,
        },
        typography: tenant.typography,
      },
      modules,
      config,
    };

    return NextResponse.json(body, { headers: CACHE_HEADERS });
  } catch {
    // Any failure during enrichment must NOT 500 the page. Fall back
    // to the no-tenant shape; client treats it as default branding.
    return NextResponse.json(NO_TENANT_BODY, { headers: CACHE_HEADERS });
  }
}

// ─── Response shape (exported for client typing) ──────────────────────

export type ModuleEnablementMap = Record<ModuleKey, boolean>;

export interface TenantConfigResponse {
  isTenantContext: true;
  tenant: {
    id: string;
    slug: string | null;
    name: string | null;
    plan: string;
    isActive: boolean;
    tenantType: 'school' | 'coaching' | 'corporate' | 'government';
    branding: {
      logoUrl: string | null;
      primaryColor: string;
      secondaryColor: string;
      tagline: string | null;
      faviconUrl: string | null;
      showPoweredBy: boolean;
    };
    typography: {
      fontHeading: string | null;
      fontBody: string | null;
      borderRadiusPx: number | null;
    };
  };
  modules: ModuleEnablementMap;
  config: Awaited<ReturnType<typeof getAllTenantConfig>>;
}

export type TenantConfigNoContextResponse = typeof NO_TENANT_BODY;
