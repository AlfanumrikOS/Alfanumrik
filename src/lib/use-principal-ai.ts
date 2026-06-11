/**
 * usePrincipalAi — the single client hook that gates the Track 2 PRINCIPAL AI
 * ASSISTANT surface (the /school-admin/ai-assistant chat workspace + its nav
 * entry).
 *
 * It mirrors `useSchoolAdminRbac` (src/lib/use-school-admin-rbac.ts) EXACTLY in
 * structure — only the flag name + cache key differ. The capability check itself
 * (`institution.use_principal_ai`, principal-only) is SERVER-authoritative: the
 * GET/POST route 404s entirely while `ff_principal_ai_v1` is OFF and 403s for any
 * non-principal regardless of this hook. This client hook is purely a UI gate so
 * the chat surface + nav entry render only once enforcement is actually live. It
 * is NOT a security boundary (P9).
 *
 * Flash-avoidance + byte-identical-OFF discipline (identical to the rbac hook):
 *   - The flag DEFAULTS OFF (FLAG_DEFAULTS[ff_principal_ai_v1] = false) and is not
 *     seeded ON for any current user. We initialise to `false` (DEFAULT_OFF) — the
 *     very first paint shows today's school-admin portal, exactly what
 *     "byte-identical when OFF" requires. No first-paint flash for production users.
 *   - A small localStorage cache (1-hour TTL) lets a principal who HAS the flag on
 *     (post-rollout) skip the OFF→ON flash on repeat visits: the cached `true` is
 *     read synchronously on mount.
 *   - The async `getFeatureFlags` fetch then confirms/corrects and re-caches.
 */

import { useEffect, useState } from 'react';
import { getFeatureFlags } from './supabase';
import { PRINCIPAL_AI_FLAGS } from './feature-flags';

// gitleaks:allow — localStorage key, not a secret.
const CACHE_KEY = 'alfanumrik_principal_ai_flag_v1'; // gitleaks:allow
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_OFF = false; // flag default-OFF ⇒ resolves OFF; legacy is the safe paint

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
 * React hook: returns `true` when the Principal AI Assistant UI should render
 * (the chat workspace + its nav entry). Initial value is read synchronously from
 * cache (no first-render flash on repeat visits); an async fetch confirms/corrects
 * and re-caches. Pair this with a principal-role check at the call site — the
 * server enforces the principal-only capability regardless (P9).
 */
export function usePrincipalAi(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => getFlagSync());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flags = await getFeatureFlags({ role: 'school_admin' });
        if (cancelled) return;
        const resolved = Boolean(flags[PRINCIPAL_AI_FLAGS.V1]);
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
