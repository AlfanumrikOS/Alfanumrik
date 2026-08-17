/**
 * Re-export of TenantConfigResponse + ModuleEnablementMap from the host app's
 * /api/tenant/config route, so packages/lib can type-check independently of
 * apps/host path aliases.
 *
 * Source of truth: apps/host/src/app/api/tenant/config/route.ts:131-158
 */

import type { ModuleKey } from '@alfanumrik/lib/modules/registry';

/** Map of module_key → enabled boolean. Shape mirrors tenant_modules table. */
export type ModuleEnablementMap = Record<ModuleKey, boolean>;

/** Shape returned by GET /api/tenant/config when tenant context is present. */
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
  config: Record<string, unknown>;
}
