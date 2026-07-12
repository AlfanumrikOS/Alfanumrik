import type { TenantBranding } from './types';

const HEX = /^#[0-9a-f]{6}$/i;

export const DEFAULT_TENANT_BRANDING: TenantBranding = {
  schoolName: 'Alfanumrik',
  locale: 'en',
  enabledModules: [],
};

/** Normalise tenant branding without allowing status or action semantics to be replaced. */
export function resolveTenantBranding(input?: Partial<TenantBranding> | null): TenantBranding {
  if (!input) return DEFAULT_TENANT_BRANDING;
  return {
    schoolName: input.schoolName?.trim() || DEFAULT_TENANT_BRANDING.schoolName,
    logoUrl: input.logoUrl,
    accent: input.accent && HEX.test(input.accent) ? input.accent : undefined,
    locale: input.locale || DEFAULT_TENANT_BRANDING.locale,
    curriculum: input.curriculum,
    enabledModules: Array.isArray(input.enabledModules) ? [...new Set(input.enabledModules.filter(Boolean))] : [],
  };
}
