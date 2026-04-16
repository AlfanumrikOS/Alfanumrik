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