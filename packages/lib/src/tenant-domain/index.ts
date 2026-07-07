/**
 * ALFANUMRIK — Tenant Abstraction Layer (Phase B of white-label foundation)
 *
 * The platform's storage table is `schools` for backward compatibility, but
 * the *concept* the platform serves is a generic Tenant — a school today, a
 * coaching institute / corporate / government deployment tomorrow. This file
 * is the seam: callers reason about a Tenant; the persistence layer continues
 * to call it a school. Renaming the table would force a coordinated change
 * across 25+ API namespaces, 35 migrations, and a stabilized billing/webhook
 * surface — out of proportion to the benefit.
 *
 * Public surface:
 *   - `TenantType`            — the four supported tenant categories.
 *   - `Tenant`                — the conceptual record returned to callers.
 *   - `tenantFromSchool()`    — build a Tenant from a SchoolRecord.
 *   - `resolveTenant()`       — host → Tenant, delegates to the existing
 *                               resolveHostToSchool() in lib/tenant.ts.
 *   - `tenantHeaders()`       — re-export the school header serializer.
 *   - re-exports of the legacy school-named helpers, so existing call sites
 *     can migrate incrementally without churn.
 *
 * NOTE: src/lib/tenant.ts (the legacy school-named module) remains the
 * source of truth for resolution and caching. Do NOT duplicate its logic
 * here. This file is a thin facade + a richer Tenant type.
 */

import {
  resolveHostToSchool,
  tenantHeadersFromContext,
  tenantFromHeaders as legacyTenantFromHeaders,
  buildTenantContext,
  invalidateTenantCache,
  isB2CDomain,
  extractSlugFromHost,
  type SchoolRecord,
} from '@alfanumrik/lib/tenant';
import type { TenantContext } from '@alfanumrik/lib/types';

// ─── Tenant type taxonomy ──────────────────────────────────────────────

/**
 * The four tenant categories supported by the platform. Mirrors the CHECK
 * constraint in migration 20260507000004_add_tenant_type_and_typography.sql.
 *
 * Stored in `schools.tenant_type` (default 'school'). Read by the abstraction
 * layer to drive default branding palettes, default-enabled modules, and copy
 * variants. UI/copy variants are gated by `ff_tenant_type_v1`; the column
 * itself is always populated.
 */
export type TenantType = 'school' | 'coaching' | 'corporate' | 'government';

const TENANT_TYPES: ReadonlySet<TenantType> = new Set([
  'school',
  'coaching',
  'corporate',
  'government',
]);

/** Narrow an arbitrary string to TenantType, defaulting to 'school'. */
export function coerceTenantType(value: unknown): TenantType {
  return typeof value === 'string' && TENANT_TYPES.has(value as TenantType)
    ? (value as TenantType)
    : 'school';
}

// ─── Typography branding (Phase B) ─────────────────────────────────────

export interface TenantTypography {
  /** CSS font-family string, e.g. 'Inter, system-ui, sans-serif'. null → use default. */
  fontHeading: string | null;
  fontBody: string | null;
  /** Border radius in px, 0–32. null → use default (8). */
  borderRadiusPx: number | null;
}

const NULL_TYPOGRAPHY: TenantTypography = {
  fontHeading: null,
  fontBody: null,
  borderRadiusPx: null,
};

// ─── Tenant — the conceptual record ────────────────────────────────────

/**
 * A Tenant as the platform reasons about it. Strictly a superset of the
 * legacy TenantContext shape: every consumer of TenantContext can read a
 * Tenant without changes.
 *
 * Stored in `public.schools` keyed by `id`. The `tenantType` field decides
 * default branding palettes and default-enabled modules.
 */
export interface Tenant extends TenantContext {
  tenantType: TenantType;
  typography: TenantTypography;
}

// ─── Builders ──────────────────────────────────────────────────────────

/**
 * Extended SchoolRecord that may carry the new typography + tenant_type
 * columns (post-migration 20260507000004). Callers that fetched the legacy
 * column set will simply see undefined for these and we fall back to the
 * type-default branding.
 */
export interface SchoolRecordWithTenantFields extends SchoolRecord {
  tenant_type?: string | null;
  font_heading?: string | null;
  font_body?: string | null;
  border_radius_px?: number | null;
}

/**
 * Build a Tenant from a SchoolRecord. Returns `null` if the input is null —
 * callers decide how to handle the no-tenant case (legacy NULL_TENANT vs.
 * 404 vs. fall through to B2C).
 */
export function tenantFromSchool(school: SchoolRecordWithTenantFields | null): Tenant | null {
  if (!school) return null;

  const baseContext = buildTenantContext(school);
  const tenantType = coerceTenantType(school.tenant_type);

  const typography: TenantTypography = {
    fontHeading: school.font_heading ?? null,
    fontBody: school.font_body ?? null,
    borderRadiusPx: clampRadius(school.border_radius_px),
  };

  return {
    ...baseContext,
    tenantType,
    typography,
  };
}

function clampRadius(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > 32) return null;
  return Math.round(value);
}

// ─── Resolution facade ─────────────────────────────────────────────────

/**
 * Resolve a hostname to a Tenant. Delegates to the cached resolveHostToSchool
 * implementation in lib/tenant.ts; this wrapper just enriches the returned
 * SchoolRecord into a Tenant.
 *
 * Use this from server-side code that wants the full Tenant view. Use the
 * legacy `tenantFromHeaders()` re-export below from API routes that read
 * tenant info off the proxy-injected x-school-* headers — it remains the
 * canonical hot path and is unaffected by this file.
 */
export async function resolveTenant(
  host: string,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<Tenant | null> {
  // We re-fetch via the legacy helper. This file does NOT introduce a second
  // cache; the legacy module's negative-cached result is reused.
  const school = (await resolveHostToSchool(
    host,
    supabaseUrl,
    serviceRoleKey,
  )) as SchoolRecordWithTenantFields | null;
  return tenantFromSchool(school);
}

/**
 * Build the empty Tenant for B2C / unresolved-host requests. Mirrors
 * NULL_TENANT from lib/types but with the additional tenant fields.
 */
export function nullTenant(): Tenant {
  const baseContext = buildTenantContext(null);
  return {
    ...baseContext,
    tenantType: 'school',
    typography: NULL_TYPOGRAPHY,
  };
}

// ─── Re-exports (legacy compatibility) ─────────────────────────────────
//
// Existing call sites import from '@alfanumrik/lib/tenant'. We re-export the legacy
// names from this module so new code can switch to '@alfanumrik/lib/tenant/index' (or
// the implicit '@alfanumrik/lib/tenant' once we move the file later) without churn.
// The legacy module remains the source of truth for resolution + caching.

export {
  tenantHeadersFromContext as tenantHeaders,
  legacyTenantFromHeaders as tenantFromHeaders,
  invalidateTenantCache,
  isB2CDomain,
  extractSlugFromHost,
};
export type { SchoolRecord, TenantContext };
