'use client';

/**
 * Cosmic redesign — theme runtime (Phase 0 foundation).
 *
 * Single source of truth for whether the cosmic dark visual identity is
 * active, and which of the three accessibility themes is selected. The cosmic
 * skin activates when ANY of four enable signals is true (and no force-off):
 *
 *     cosmicEnabled =
 *       forceOff ? false
 *                : ( dbFlag === true        // ff_cosmic_redesign_v1 ON in DB
 *                    || isPreviewEnv         // Vercel PR preview deploy
 *                    || urlForce             // ?cosmic=1 / ?cosmic=preview
 *                    || localStorageForce )  // sticky ?cosmic=1 from a prior nav
 *
 *   PRODUCTION (NEXT_PUBLIC_VERCEL_ENV==='production' or undefined) with the DB
 *   flag OFF and no url/localStorage force:
 *     - All four signals are false ⇒ `cosmicEnabled` resolves to false.
 *     - NO `data-design` attribute is written to <html>, so the cosmic token
 *       block in globals.css never activates. AuthContext keeps force-light
 *       behavior. The app is byte-identical to today. This is the safety
 *       invariant pinned by cosmic-flag-off-safety.test.tsx (REG-78).
 *
 *   PREVIEW (NEXT_PUBLIC_VERCEL_ENV==='preview', set on every PR deploy):
 *     - `isPreviewEnv` is true ⇒ cosmic auto-enables so the CEO sees the
 *       redesign on the preview URL with zero DB seeding. Production is
 *       unaffected because that env var is 'production' there.
 *
 *   ON (any signal):
 *     - `data-design="cosmic"` is written to <html>, activating the cosmic
 *       token scope (which also re-aliases the legacy semantic tokens so
 *       existing pages inherit the dark theme without a rewrite).
 *     - The user's CosmicThemePreference ('dark' | 'light' | 'hc') is written
 *       as `data-theme` and persisted to localStorage. 'dark' (cosmic) is the
 *       default per the CEO directive; 'light' and 'hc' (high-contrast) stay
 *       selectable so no learner is stranded on a sunlit cheap Android.
 *     - The active role is written as `data-role` so the role-scoped palettes
 *       (parent / teacher / school) apply.
 *
 * Manual override (any env, for A/B + design sign-off):
 *   - `?cosmic=1` (or `?cosmic=preview`) force-ENABLES cosmic and is persisted
 *     to localStorage 'alfanumrik_cosmic_force'='1' so it survives client-side
 *     navigation away from the query string.
 *   - `?cosmic=0` force-DISABLES cosmic (beats every other signal, including a
 *     DB flag ON and a preview deploy) and persists 'alfanumrik_cosmic_force'
 *     ='0', so a tester can pin the legacy look even on a preview.
 *
 * Read path (acceptance criterion 1): the DB flag is read CLIENT-SIDE via the
 * existing `getFeatureFlags()` helper in `src/lib/supabase.ts` (which queries
 * the public-read `feature_flags` table). Absent/unknown flag ⇒ the lookup is
 * `undefined` ⇒ coerced to false ⇒ contributes nothing. SERVER-SIDE callers
 * that need the same answer use `isFeatureEnabled(COSMIC_REDESIGN_FLAGS.V1,...)`
 * from `src/lib/feature-flags.ts`, which also returns false for unknown flags.
 *
 * A localStorage cache (1-hour TTL) lets the very first paint of repeat visits
 * match the resolved flag state without a flash — mirrors the proven
 * `use-atlas-flag` approach. First-ever visit defaults to OFF (the production
 * truth) so we never flash cosmic onto users who shouldn't see it. The preview
 * and url/localStorage overrides are resolved synchronously on the client at
 * mount, so previews + ?cosmic=1 paint cosmic without waiting on the network.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getFeatureFlags } from './supabase';
import { COSMIC_REDESIGN_FLAGS } from './feature-flags';
import { useAuth } from './AuthContext';

/** The three user-selectable themes inside the cosmic identity. */
export type CosmicThemePreference = 'dark' | 'light' | 'hc';

const THEME_KEY = 'alfanumrik_cosmic_theme'; // gitleaks:allow — localStorage key
const FLAG_CACHE_KEY = 'alfanumrik_cosmic_flag_v1'; // gitleaks:allow — localStorage key
const FORCE_KEY = 'alfanumrik_cosmic_force'; // gitleaks:allow — localStorage key (manual override)
const FLAG_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_THEME: CosmicThemePreference = 'dark'; // cosmic dark is the default look when flag ON
const DEFAULT_FLAG_OFF = false; // production truth: cosmic is OFF until explicitly flagged on

const VALID_THEMES: readonly CosmicThemePreference[] = ['dark', 'light', 'hc'];

function isCosmicTheme(v: unknown): v is CosmicThemePreference {
  return typeof v === 'string' && (VALID_THEMES as readonly string[]).includes(v);
}

/* ── flag cache (sync first-paint, async confirm) ───────────────────────── */

function readFlagCache(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(FLAG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { on: boolean; ts: number };
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > FLAG_CACHE_TTL_MS) return null;
    return Boolean(parsed.on);
  } catch {
    return null;
  }
}

function writeFlagCache(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FLAG_CACHE_KEY, JSON.stringify({ on, ts: Date.now() }));
  } catch {
    /* quota / disabled storage — fall back to per-mount fetch */
  }
}

function getCosmicFlagSync(): boolean {
  const cached = readFlagCache();
  if (cached !== null) return cached;
  return DEFAULT_FLAG_OFF;
}

/* ── enable signals: preview env + url/localStorage manual override ──────────
 *
 * These are the three NON-DB enable inputs. They resolve synchronously on the
 * client (no network), so previews and ?cosmic=1 paint cosmic on first render.
 * Every reader is SSR/JSDOM-safe: process.env access is typeof-guarded and
 * window/localStorage access is `typeof window` guarded, so on the server (and
 * in JSDOM tests where NEXT_PUBLIC_VERCEL_ENV is undefined) they all return
 * the OFF-contributing value.
 */

/**
 * True only on Vercel PR preview deploys, where the architect maps
 * NEXT_PUBLIC_VERCEL_ENV='preview' via next.config.js. It is 'production' on the
 * prod deploy and undefined in tests/local — both of which return false here,
 * keeping production strictly OFF unless the DB flag or a manual force says so.
 * Guarded so it never throws if the env mapping hasn't landed yet (it just
 * reads undefined → false).
 */
function isPreviewEnv(): boolean {
  try {
    return (
      typeof process !== 'undefined' &&
      process.env?.NEXT_PUBLIC_VERCEL_ENV === 'preview'
    );
  } catch {
    return false;
  }
}

/** Manual-override tri-state read from the URL query (`?cosmic=…`). */
function readUrlForce(): 'on' | 'off' | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = new URLSearchParams(window.location.search).get('cosmic');
    if (v === null) return null;
    const lower = v.toLowerCase();
    if (lower === '1' || lower === 'preview' || lower === 'true' || lower === 'on') return 'on';
    if (lower === '0' || lower === 'false' || lower === 'off') return 'off';
    return null;
  } catch {
    return null;
  }
}

/** Persisted manual-override tri-state from localStorage 'alfanumrik_cosmic_force'. */
function readStoredForce(): 'on' | 'off' | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(FORCE_KEY);
    if (v === '1') return 'on';
    if (v === '0') return 'off';
    return null;
  } catch {
    return null;
  }
}

function writeStoredForce(state: 'on' | 'off'): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FORCE_KEY, state === 'on' ? '1' : '0');
  } catch {
    /* quota / disabled storage — non-fatal; the URL param still wins this paint */
  }
}

/**
 * Resolve the manual override once, folding the URL param (authoritative this
 * navigation) into the sticky localStorage value. A `?cosmic=1/0` in the URL
 * is persisted so it survives client-side navigation away from the query
 * string. Returns the effective override ('on' | 'off' | null=no-override).
 */
function resolveForceOverride(): 'on' | 'off' | null {
  const url = readUrlForce();
  if (url !== null) {
    // URL is the explicit user intent this navigation — persist + honor it.
    writeStoredForce(url);
    return url;
  }
  return readStoredForce();
}

/**
 * The full enable decision. Pure function of its inputs so it can be reasoned
 * about and unit-tested directly:
 *
 *   forceOff   ? false
 *              : ( dbFlag || isPreview || forceOn )
 *
 * where forceOn/forceOff come from the resolved manual override. A `?cosmic=0`
 * (or stored '0') hard-disables EVERYTHING, including a DB-ON flag and a
 * preview deploy, so any tester can pin the legacy look for an A/B comparison.
 */
function computeCosmicEnabled(args: {
  dbFlag: boolean;
  preview: boolean;
  force: 'on' | 'off' | null;
}): boolean {
  if (args.force === 'off') return false;
  return args.dbFlag || args.preview || args.force === 'on';
}

/*
 * Synchronous first-paint resolution is composed in CosmicThemeProvider from
 * three pieces: the DB flag (optimistic cache via getCosmicFlagSync), the
 * preview env (isPreviewEnv), and the resolved manual override
 * (resolveForceOverride), fed to computeCosmicEnabled. The DB flag is kept a
 * separate state input because only IT is later confirmed asynchronously by
 * getFeatureFlags() — preview + force are stable for the life of the page. The
 * head pre-hydration script in src/app/layout.tsx mirrors this same decision so
 * first paint matches React without a flash.
 */

/* ── theme preference persistence ───────────────────────────────────────── */

function readStoredTheme(): CosmicThemePreference {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    if (isCosmicTheme(raw)) return raw;
  } catch {
    /* disabled storage */
  }
  return DEFAULT_THEME;
}

function writeStoredTheme(pref: CosmicThemePreference): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* non-fatal */
  }
}

/* ── DOM application ─────────────────────────────────────────────────────── */

/** Map an AuthContext role to a cosmic palette role attribute. */
function roleToCosmicRole(activeRole: string): 'student' | 'parent' | 'teacher' | 'school' {
  switch (activeRole) {
    case 'guardian':
      return 'parent';
    case 'teacher':
      return 'teacher';
    case 'institution_admin':
      return 'school';
    default:
      return 'student';
  }
}

/** Write or clear the cosmic attributes on <html>. */
function applyCosmicToDOM(enabled: boolean, theme: CosmicThemePreference, role: string): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  if (!enabled) {
    // Flag OFF — remove the cosmic-only hooks (data-design / data-role) so the
    // cosmic token scope never activates. We deliberately DO NOT touch
    // data-theme: AuthContext owns it in the flag-OFF world (it force-writes
    // "light"). Leaving it alone prevents the two providers from fighting.
    html.removeAttribute('data-design');
    html.removeAttribute('data-role');
    return;
  }
  // Flag ON — cosmic is the authority over all three attributes.
  html.setAttribute('data-design', 'cosmic');
  html.setAttribute('data-theme', theme);
  html.setAttribute('data-role', roleToCosmicRole(role));
}

/* ── context ─────────────────────────────────────────────────────────────── */

interface CosmicThemeState {
  /** True only when ff_cosmic_redesign_v1 resolved ON. */
  cosmicEnabled: boolean;
  /** The active accessibility theme ('dark' default, 'light', 'hc'). */
  cosmicTheme: CosmicThemePreference;
  /** Persisted setter. No-op when cosmic is disabled. */
  setCosmicTheme: (pref: CosmicThemePreference) => void;
  /** Cycle dark → light → hc → dark. Convenience for a single toggle button. */
  cycleCosmicTheme: () => void;
}

const CosmicThemeContext = createContext<CosmicThemeState>({
  cosmicEnabled: false,
  cosmicTheme: DEFAULT_THEME,
  setCosmicTheme: () => {},
  cycleCosmicTheme: () => {},
});

export function useCosmicTheme(): CosmicThemeState {
  return useContext(CosmicThemeContext);
}

/**
 * Mounts inside AuthProvider (so it can read activeRole). Renders nothing —
 * it only resolves the flag, applies attributes to <html>, and exposes state.
 */
export function CosmicThemeProvider({ children }: { children: ReactNode }) {
  const { activeRole } = useAuth();
  // The DB flag is the only ASYNC input. Preview-env + manual override are
  // resolved synchronously and folded in via computeCosmicEnabled, so the
  // optimistic first paint already honors previews and ?cosmic=1.
  const [dbFlag, setDbFlag] = useState<boolean>(() => getCosmicFlagSync());
  const [theme, setThemeState] = useState<CosmicThemePreference>(() => readStoredTheme());

  // The preview env and the resolved manual override are stable for the life of
  // the page (env is build-baked; the URL param is folded into localStorage on
  // mount). Resolve them once. resolveForceOverride() also persists ?cosmic=1/0.
  const [preview] = useState<boolean>(() => isPreviewEnv());
  const [force] = useState<'on' | 'off' | null>(() => resolveForceOverride());

  const enabled = computeCosmicEnabled({ dbFlag, preview, force });

  // Resolve the DB flag once per mount; confirm/correct the optimistic cache.
  // This only ever moves the DB-flag input — preview + force are independent,
  // so a preview deploy stays cosmic even if the DB flag resolves false, and a
  // ?cosmic=0 force stays legacy even if the DB flag resolves true.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const flags = await getFeatureFlags();
        if (cancelled) return;
        const on = Boolean(flags?.[COSMIC_REDESIGN_FLAGS.V1]);
        writeFlagCache(on);
        setDbFlag((prev) => (prev !== on ? on : prev));
      } catch {
        // Network / auth failure — keep optimistic value (defaults to OFF).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply attributes whenever the resolved flag, theme, or role changes.
  useEffect(() => {
    applyCosmicToDOM(enabled, theme, activeRole);
  }, [enabled, theme, activeRole]);

  const setCosmicTheme = useCallback((pref: CosmicThemePreference) => {
    if (!isCosmicTheme(pref)) return;
    setThemeState(pref);
    writeStoredTheme(pref);
  }, []);

  const cycleCosmicTheme = useCallback(() => {
    setThemeState((prev) => {
      const idx = VALID_THEMES.indexOf(prev);
      const next = VALID_THEMES[(idx + 1) % VALID_THEMES.length];
      writeStoredTheme(next);
      return next;
    });
  }, []);

  const value = useMemo<CosmicThemeState>(
    () => ({ cosmicEnabled: enabled, cosmicTheme: theme, setCosmicTheme, cycleCosmicTheme }),
    [enabled, theme, setCosmicTheme, cycleCosmicTheme],
  );

  return <CosmicThemeContext.Provider value={value}>{children}</CosmicThemeContext.Provider>;
}
