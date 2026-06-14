/**
 * useFoxyLearningActionsFlag — single client-side reader for
 * `ff_foxy_learning_actions_v1`.
 *
 * Gates the redesigned Foxy post-answer action bar (Got it / Explain simpler /
 * Show example / Quiz me on this + a single-path overflow menu) in ChatBubble.
 * Mirrors the proven `use-foxy-os-flag` / `use-student-os-flag` shape
 * (synchronous first paint from a TTL-cached value, async confirm/correct on
 * mount) with one critical contract:
 *
 *   DEFAULT IS OFF.
 *
 * The flag is seeded OFF and the contract is that the OFF path renders the
 * legacy QA-tester bar BYTE-IDENTICALLY to today. So the first-ever paint
 * (no cache) resolves to false — today's bar renders — and the async
 * `getFeatureFlags()` only flips us to the new bar if the DB row is explicitly
 * enabled. This guarantees production users who shouldn't see the redesign
 * never get a flash of it.
 *
 * Cache shape (localStorage key `alfanumrik_foxy_learning_actions_flag_v1`):
 *   { on: boolean, ts: number }
 * 1-hour TTL.
 */

import { useEffect, useState } from 'react';
import { getFeatureFlags } from './supabase';
import { FOXY_LEARNING_ACTIONS_FLAGS } from './feature-flags';

// gitleaks:allow — localStorage key, not a secret.
const CACHE_KEY = 'alfanumrik_foxy_learning_actions_flag_v1'; // gitleaks:allow
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_OFF = false; // production truth: redesign is OFF until explicitly flagged on

interface Cached {
  on: boolean;
  ts: number;
}

/**
 * DEV/PREVIEW-ONLY override. Lets the learning-action bar be previewed on
 * localhost without seeding the DB flag. STRICT no-op in production builds
 * (`NODE_ENV === 'production'`), so it is commit-safe.
 *
 * Enable (in the browser console at localhost, then refresh):
 *   localStorage.setItem('alfanumrik_force_foxy_learning_actions', '1')
 * Disable:
 *   localStorage.removeItem('alfanumrik_force_foxy_learning_actions')
 *
 * When set, this override WINS over the DB value: it short-circuits the
 * synchronous read and survives the async DB reconcile.
 */
function devForcedOn(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('alfanumrik_force_foxy_learning_actions') === '1'; // gitleaks:allow
  } catch {
    return false;
  }
}

function readCache(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return Boolean(parsed.on);
  } catch {
    return null;
  }
}

function writeCache(on: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ on, ts: Date.now() }));
  } catch {
    /* quota / disabled storage — fall back to per-mount fetch */
  }
}

export function clearFoxyLearningActionsFlagCache() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* non-fatal */
  }
}

/** Synchronous read: cached fresh value, else OFF. Never returns null. */
export function getFoxyLearningActionsFlagSync(): boolean {
  if (devForcedOn()) return true;
  const cached = readCache();
  if (cached !== null) return cached;
  return DEFAULT_OFF;
}

/**
 * Returns `true` only when `ff_foxy_learning_actions_v1` resolves ON.
 * Optimistic first paint from cache (defaults OFF), confirmed/corrected by an
 * async fetch.
 */
export function useFoxyLearningActionsFlag(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => getFoxyLearningActionsFlagSync());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flags = await getFeatureFlags();
        if (cancelled) return;
        const on = devForcedOn() || Boolean(flags?.[FOXY_LEARNING_ACTIONS_FLAGS.V1]);
        writeCache(on);
        setEnabled((prev) => (prev !== on ? on : prev));
      } catch {
        /* network/auth failure — keep optimistic value (OFF) */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return enabled;
}
