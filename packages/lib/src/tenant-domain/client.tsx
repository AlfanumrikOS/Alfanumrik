'use client';

/**
 * ALFANUMRIK — Client-side TenantConfigProvider (Phase 2 frontend consumer)
 *
 * Companion to the GET /api/tenant/config endpoint shipped in PR #559. Lets
 * components anywhere in the React tree read:
 *
 *   - tenantType                        ('school' | 'coaching' | 'corporate' | 'government')
 *   - typography (font_heading/body, border_radius_px)
 *   - branding (logo, colors, tagline, …)
 *   - per-module enablement boolean
 *   - typed config values (ai.personality, locale.timezone, …)
 *
 * and renders the right white-labeled experience without re-fetching.
 *
 * Why this lives alongside the legacy `SchoolProvider` (src/lib/SchoolContext.tsx)
 * instead of replacing it:
 *
 *   - SchoolProvider is wired into src/app/layout.tsx and consumed by every
 *     `src/components/school/*` component today. Replacing it in one shot
 *     would force a coordinated change across the school component family.
 *   - The two providers are independent; an app can mount BOTH at the root
 *     for incremental migration. New components opt into `useTenantConfig()`;
 *     old components keep working unchanged.
 *
 * Mounting (intentional — this PR does NOT auto-wire to root layout):
 *   ```tsx
 *   import { TenantConfigProvider } from '@alfanumrik/lib/tenant-domain/client';
 *   <TenantConfigProvider>
 *     <YourApp />
 *   </TenantConfigProvider>
 *   ```
 *   Calling code decides where in the tree to mount and whether to apply
 *   typography CSS vars (default: yes).
 *
 * Failure mode: if /api/tenant/config returns `{ isTenantContext: false }`
 * or any error, the provider exposes a "no tenant" state — consumers see
 * sensible defaults and no CSS vars are applied. The page never blocks on
 * a config fetch.
 *
 * Bundle impact: <1.5kB minified. No third-party deps; pure React + fetch.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  TenantConfigResponse,
  ModuleEnablementMap,
} from '@/app/api/tenant/config/route';
import type { ModuleKey } from '@alfanumrik/lib/modules/registry';
import type { ConfigKey, ConfigValue } from '@alfanumrik/lib/tenant-config';
import type { TenantType } from '@alfanumrik/lib/tenant-domain';

// ─── Provider state ────────────────────────────────────────────────────

export type TenantConfigState =
  | { status: 'loading'; tenant: null; modules: null; config: null }
  | { status: 'no_tenant'; tenant: null; modules: null; config: null }
  | {
      status: 'ready';
      tenant: TenantConfigResponse['tenant'];
      modules: ModuleEnablementMap;
      config: TenantConfigResponse['config'];
    };

const NULL_STATE: TenantConfigState = {
  status: 'no_tenant',
  tenant: null,
  modules: null,
  config: null,
};

const TenantConfigCtx = createContext<TenantConfigState>(NULL_STATE);

// ─── Provider component ────────────────────────────────────────────────

export interface TenantConfigProviderProps {
  children: ReactNode;
  /**
   * Skip the network fetch and seed state directly. Useful for SSR-rendered
   * pages where the server already resolved the tenant, or for tests.
   */
  initialState?: TenantConfigState;
  /**
   * If true (default), apply typography + branding CSS variables to
   * document.documentElement when the tenant resolves. Set to false if your
   * app applies these via a server-rendered <style> tag instead.
   */
  applyCssVars?: boolean;
  /**
   * Override the endpoint path. Default: '/api/tenant/config'. Useful for
   * tests or staging-only experiments.
   */
  endpoint?: string;
}

export function TenantConfigProvider({
  children,
  initialState,
  applyCssVars = true,
  endpoint = '/api/tenant/config',
}: TenantConfigProviderProps) {
  const [state, setState] = useState<TenantConfigState>(
    initialState ?? { status: 'loading', tenant: null, modules: null, config: null },
  );

  // Track whether we've already fetched in this provider's lifetime so an
  // initialState-seeded mount doesn't trigger an extra round-trip.
  const fetchedRef = useRef(initialState != null);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    let cancelled = false;
    fetch(endpoint, { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then((body: TenantConfigResponse | { isTenantContext: false } | null) => {
        if (cancelled) return;
        if (!body || body.isTenantContext === false) {
          setState(NULL_STATE);
          return;
        }
        setState({
          status: 'ready',
          tenant: body.tenant,
          modules: body.modules,
          config: body.config,
        });
      })
      .catch(() => {
        if (!cancelled) setState(NULL_STATE);
      });

    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  // Apply CSS vars when state.tenant changes. This is a side-effect
  // separate from the fetch so initialState-seeded providers also get
  // their CSS vars applied on mount.
  useEffect(() => {
    if (!applyCssVars || state.status !== 'ready') return;
    const root = document.documentElement;
    const vars = cssVarsFromTenant(state.tenant);
    for (const [k, v] of Object.entries(vars)) {
      root.style.setProperty(k, v);
    }
    return () => {
      for (const k of Object.keys(vars)) root.style.removeProperty(k);
    };
  }, [applyCssVars, state]);

  // Memoize so consumers using `useTenantConfig()` don't re-render unless
  // the underlying state actually changed. The provider already only calls
  // setState on real transitions, so this is mostly belt-and-braces.
  const value = useMemo(() => state, [state]);

  return <TenantConfigCtx.Provider value={value}>{children}</TenantConfigCtx.Provider>;
}

// ─── Hooks ─────────────────────────────────────────────────────────────

/** Full state — tenant, modules, config, and the load status. */
export function useTenantConfig(): TenantConfigState {
  return useContext(TenantConfigCtx);
}

/**
 * Convenience: is `moduleKey` enabled for the current tenant?
 * Returns true while loading or for B2C — same fail-open semantics as the
 * server-side resolver. Components that need to gate UI strictly should
 * read `useTenantConfig().status === 'ready'` and check `modules` directly.
 */
export function useIsModuleEnabled(moduleKey: ModuleKey): boolean {
  const ctx = useTenantConfig();
  if (ctx.status !== 'ready') return true;
  return ctx.modules[moduleKey] ?? false;
}

/**
 * Read a typed config value. Returns null while loading / no-tenant —
 * caller decides on the default. Use the server-side `getTenantConfig()`
 * (in `src/lib/tenant-config`) when you need a guaranteed value with
 * registry-default fallback.
 */
export function useTenantConfigValue<K extends ConfigKey>(
  key: K,
): ConfigValue<K> | null {
  const ctx = useTenantConfig();
  if (ctx.status !== 'ready') return null;
  return ctx.config[key] as ConfigValue<K>;
}

/** The current tenant type, defaulting to 'school' before load resolves. */
export function useTenantType(): TenantType {
  const ctx = useTenantConfig();
  if (ctx.status !== 'ready') return 'school';
  return ctx.tenant.tenantType;
}

// ─── CSS variables ─────────────────────────────────────────────────────

/**
 * Build the CSS custom-property map for a tenant. Returned shape is
 * deliberately a flat record so callers can `Object.entries` and apply
 * either via `root.style.setProperty` or a server-rendered `<style>`.
 *
 * Variables (mirrors the convention used by the legacy SchoolThemeProvider
 * and adds typography vars introduced in PR #558):
 *   --color-brand-primary
 *   --color-brand-secondary
 *   --tenant-font-heading   (e.g. 'Inter, system-ui, sans-serif')
 *   --tenant-font-body
 *   --tenant-radius         (e.g. '8px')
 */
export function cssVarsFromTenant(
  tenant: TenantConfigResponse['tenant'],
): Record<string, string> {
  const vars: Record<string, string> = {
    '--color-brand-primary': tenant.branding.primaryColor,
    '--color-brand-secondary': tenant.branding.secondaryColor,
  };
  if (tenant.typography.fontHeading) {
    vars['--tenant-font-heading'] = tenant.typography.fontHeading;
  }
  if (tenant.typography.fontBody) {
    vars['--tenant-font-body'] = tenant.typography.fontBody;
  }
  if (tenant.typography.borderRadiusPx != null) {
    vars['--tenant-radius'] = `${tenant.typography.borderRadiusPx}px`;
  }
  return vars;
}

// ─── Re-export for convenience ────────────────────────────────────────
export type { TenantConfigResponse, ModuleEnablementMap };
