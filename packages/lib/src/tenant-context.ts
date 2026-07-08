'use client';

import { createContext, useContext } from 'react';
import type { TenantContext, SchoolBranding } from './types';
import { NULL_TENANT } from './types';

export const TenantCtx = createContext<TenantContext>(NULL_TENANT);

export function useTenant(): TenantContext {
  return useContext(TenantCtx);
}

export function cssVarsFromBranding(branding: SchoolBranding): Record<string, string> {
  return {
    '--color-brand-primary': branding.primaryColor,
    '--color-brand-secondary': branding.secondaryColor,
  };
}
