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
} from '@alfanumrik/lib/tenant-domain/types';
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

/**
 * Does this response body carry EVERYTHING the `ready` state promises?
 *
 * ── Why a positive guard (2026-08-08) ────────────────────────────────────
 * This used to be a NEGATIVE guard — `if (!body || body.isTenantContext ===
 * false) → no_tenant`, everything else → `ready`. That treats "the failure
 * marker is absent" as "the success payload is present", which is not the
 * same claim. Any truthy 200 JSON that is merely SHAPED differently (`{}`,
 * `[]`, the repo's `{ success: false, error }` envelope, a stale
 * service-worker cache entry, an intercepting proxy) was promoted to
 * `status: 'ready'` with `tenant: undefined`. The CSS-vars effect below then
 * dereferenced `tenant.branding.primaryColor` and threw
 * `TypeError: Cannot read properties of undefined (reading 'branding')`
 * from inside a useEffect.
 *
 * That throw is not survivable in this app: `TenantConfigProvider` is
 * mounted in the ROOT LAYOUT *outside* the layout's <ErrorBoundary> (which
 * only wraps `children`), so React unwound to the root and Next.js rendered
 * `app/global-error.tsx` — the full-page "Something went wrong / The app
 * could not load." white screen — instead of the page. One malformed 200 on
 * a purely COSMETIC branding endpoint took down every student surface.
 *
 * The sibling provider `SchoolContext.tsx` already guards positively
 * (`if (data && data.isSchoolContext)`); this brings the two in line and
 * makes the code honour this file's own documented contract: "if
 * /api/tenant/config returns { isTenantContext: false } OR ANY ERROR, the
 * provider exposes a 'no tenant' state ... The page never blocks on a
 * config fetch."
 *
 * The guard requires exactly the fields a consumer will dereference while
 * `status === 'ready'` — no more (so a legitimate response is never
 * downgraded) and no less (so `ready` cannot lie):
 *   - `tenant.branding` + `tenant.typography` → cssVarsFromTenant()
 *   - `tenant.tenantType`                     → useTenantType()
 *   - `modules`                               → useIsModuleEnabled()
 *   - `config`                                → useTenantConfigValue()
 * Anything short of that is `no_tenant`, i.e. default Alfanumrik branding —
 * which is the correct, non-fatal outcome for a branding lookup.
 */
function isCompleteTenantConfig(body: unknown): body is TenantConfigResponse {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const candidate = body as Partial<TenantConfigResponse>;
  if (candidate.isTenantContext !== true) return false;

  const isRecord = (v: unknown): boolean => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isRecord(candidate.tenant)) return false;
  if (!isRecord(candidate.modules) || !isRecord(candidate.config)) return false;

  const tenant = candidate.tenant as TenantConfigResponse['tenant'];
  return isRecord(tenant.branding) && isRecord(tenant.typography);
}

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
      // A non-OK status, a non-JSON body (an HTML error page from a proxy),
      // or a rejected fetch all land in `.catch()` / resolve to null below.
      .then(r => (r.ok ? r.json() : null))
      .then((body: unknown) => {
        if (cancelled) return;
        // Positive guard: only a body that carries every field the `ready`
        // state promises may become `ready`. See isCompleteTenantConfig().
        if (!isCompleteTenantConfig(body)) {
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
/**
 * Defense in depth: the provider above can no longer hand this an incomplete
 * tenant, but this helper is EXPORTED and is also called with server-resolved
 * data (SSR seeding, `initialState`), where the type system is the only thing
 * standing between a partial row and a thrown TypeError. Building a CSS
 * variable map is cosmetic work — an absent field must yield an absent
 * variable (so the stylesheet's own default wins), never an exception.
 *
 * Field presence is checked with `typeof === 'string'` rather than
 * truthiness so a legitimate empty string keeps its previous behaviour; only
 * genuinely missing/undefined values are skipped.
 */
export function cssVarsFromTenant(
  tenant: TenantConfigResponse['tenant'] | null | undefined,
): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!tenant || typeof tenant !== 'object') return vars;

  const branding = tenant.branding as TenantConfigResponse['tenant']['branding'] | undefined;
  if (typeof branding?.primaryColor === 'string') {
    vars['--color-brand-primary'] = branding.primaryColor;
  }
  if (typeof branding?.secondaryColor === 'string') {
    vars['--color-brand-secondary'] = branding.secondaryColor;
  }

  const typography = tenant.typography as TenantConfigResponse['tenant']['typography'] | undefined;
  if (typography?.fontHeading) {
    vars['--tenant-font-heading'] = typography.fontHeading;
  }
  if (typography?.fontBody) {
    vars['--tenant-font-body'] = typography.fontBody;
  }
  if (typography?.borderRadiusPx != null) {
    vars['--tenant-radius'] = `${typography.borderRadiusPx}px`;
  }
  return vars;
}

// ─── Re-export for convenience ────────────────────────────────────────
export type { TenantConfigResponse, ModuleEnablementMap };
