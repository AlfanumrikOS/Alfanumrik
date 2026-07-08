/**
 * useSchoolPulseFlag — the single client hook that gates the School Pulse
 * section of the school-admin Command Center behind `ff_school_pulse_v1`
 * (default OFF — independent kill switch, per the ops de-dup review
 * 2026-06-12).
 *
 * It mirrors `useSchoolProvisioning` (src/lib/use-school-provisioning.ts) and
 * `useSchoolCommandCenter` (src/lib/use-school-command-center.ts) EXACTLY in
 * structure — only the flag name + cache key differ. This hook is purely a UI
 * gate, NOT a security boundary (P9): /api/pulse/school enforces
 * `institution.view_analytics` + school membership server-side regardless.
 *
 * Flag-name note: ops owns the flag DEFINITION (`SCHOOL_PULSE_FLAGS` in
 * `src/lib/feature-flags.ts`, seeded OFF by migration
 * 20260619000100_seed_ff_school_pulse_v1.sql); this hook only consumes it.
 *
 * Flash-avoidance + byte-identical-OFF discipline (identical to the sibling
 * flag hooks):
 *   - The flag DEFAULTS OFF and is not yet seeded in `feature_flags`, so the
 *     resolved value is OFF for every current user. We initialise to `false`
 *     (DEFAULT_OFF) — the very first paint omits the Pulse section, which is
 *     exactly what "byte-identical when OFF" requires. There is no first-paint
 *     flash for production users (flag absent ⇒ stays false).
 *   - A small localStorage cache (1-hour TTL) lets an admin who HAS the flag
 *     on (post-rollout) skip the OFF→ON flash on repeat visits: the cached
 *     `true` is read synchronously on mount.
 *   - The async `getFeatureFlags` fetch then confirms/corrects and re-caches.
 *
 * Fetch-suppression contract: the Command Center renders <SchoolPulseSection>
 * (and therefore mounts `useSchoolPulse`) ONLY when this hook returns true —
 * so while the flag is OFF / unresolved, no SWR key exists and
 * /api/pulse/school is never called.
 */

import { useEffect, useState } from 'react';
import { getFeatureFlags } from './supabase';
import { SCHOOL_PULSE_FLAGS } from './feature-flags';

// gitleaks:allow — localStorage key, not a secret.
const CACHE_KEY = 'alfanumrik_school_pulse_flag_v1'; // gitleaks:allow
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_OFF = false; // flag unseeded ⇒ resolves OFF; no-Pulse is the safe paint

interface CachedFlag {
  enabled: boolean;
  ts: number;
}

function readCache(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedFlag;
    if (!parsed || typeof parsed.ts !== 'number' || typeof parsed.enabled !== 'boolean') {
      return null;
    }
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.enabled;
  } catch {
    return null;
  }
}

function writeCache(enabled: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ enabled, ts: Date.now() }));
  } catch {
    /* quota or disabled storage — fall back to per-request fetch */
  }
}

/** Synchronous read of the cached flag; DEFAULT_OFF when no fresh cache. */
function getFlagSync(): boolean {
  const cached = readCache();
  return cached ?? DEFAULT_OFF;
}

/**
 * React hook: returns `true` when the School Pulse section should render.
 * Initial value is read synchronously from cache (no first-render flash on
 * repeat visits); an async fetch confirms/corrects and re-caches.
 */
export function useSchoolPulseFlag(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => getFlagSync());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flags = await getFeatureFlags({ role: 'school_admin' });
        if (cancelled) return;
        const resolved = Boolean(flags[SCHOOL_PULSE_FLAGS.V1]);
        writeCache(resolved);
        if (resolved !== enabled) setEnabled(resolved);
      } catch {
        /* network/auth failure — keep optimistic (default-OFF) value */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Fetch runs once per mount; intentionally not depending on `enabled`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return enabled;
}
