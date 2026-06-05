'use client';

/**
 * Cosmic redesign — theme runtime (Phase 0 foundation).
 *
 * Single source of truth for whether the cosmic dark visual identity is
 * active, and which of the three accessibility themes is selected. Everything
 * here is gated on `ff_cosmic_redesign_v1`:
 *
 *   FLAG OFF (default, and the state of production today):
 *     - `cosmicEnabled` resolves to false.
 *     - NO `data-design` attribute is written to <html>, so the cosmic token
 *       block in globals.css never activates. AuthContext keeps force-light
 *       behavior. The app is pixel-identical to today.
 *
 *   FLAG ON:
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
 * Read path (acceptance criterion 1): the flag is read CLIENT-SIDE via the
 * existing `getFeatureFlags()` helper in `src/lib/supabase.ts` (which queries
 * the public-read `feature_flags` table). Absent/unknown flag ⇒ the lookup is
 * `undefined` ⇒ coerced to false ⇒ OFF. SERVER-SIDE callers that need the same
 * answer use `isFeatureEnabled(COSMIC_REDESIGN_FLAGS.V1, ...)` from
 * `src/lib/feature-flags.ts`, which also returns false for unknown flags.
 *
 * A localStorage cache (1-hour TTL) lets the very first paint of repeat visits
 * match the resolved flag state without a flash — mirrors the proven
 * `use-atlas-flag` approach. First-ever visit defaults to OFF (the production
 * truth) so we never flash cosmic onto users who shouldn't see it.
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
  const [enabled, setEnabled] = useState<boolean>(() => getCosmicFlagSync());
  const [theme, setThemeState] = useState<CosmicThemePreference>(() => readStoredTheme());

  // Resolve the flag once per mount; confirm/correct the optimistic cache.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const flags = await getFeatureFlags();
        if (cancelled) return;
        const on = Boolean(flags?.[COSMIC_REDESIGN_FLAGS.V1]);
        writeFlagCache(on);
        setEnabled((prev) => (prev !== on ? on : prev));
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
