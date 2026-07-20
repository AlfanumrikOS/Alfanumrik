/**
 * useFoxyDurableThreadFlag — single client-side reader for
 * `ff_foxy_durable_thread_v1`.
 *
 * Gates the "durable Foxy thread" fix: when ON, the CLIENT owns a stable
 * conversation id (persisted in the URL `?c=` + localStorage `foxy_thread`) and
 * sends it as the existing `session_id` field on EVERY turn — including the
 * first. This closes the "context breaks / I have to re-type my question" bug
 * where a rapid second send (before the server's session frame returns) or a
 * page reload lost the transient React-state session id and the server minted a
 * fresh, empty session.
 *
 * Mirrors the proven `use-foxy-os-flag` / `use-foxy-learning-actions-flag`
 * shape (synchronous first paint from a TTL-cached value, async confirm/correct
 * on mount) with the same critical contract:
 *
 *   DEFAULT IS OFF.
 *
 * The flag is seeded OFF (server-side migration, landing in parallel) and the
 * contract is that the OFF path is BYTE-IDENTICAL to today (transient,
 * server-minted session id). So the first-ever paint (no cache) resolves to
 * false and the async `getFeatureFlags()` only flips us to the durable-thread
 * behavior if the DB row is explicitly enabled.
 *
 * The flag name is referenced as a literal string (the canonical
 * `feature_flags.flag_name` seeded by the parallel migration) rather than via a
 * registry constant, so this client reader carries no coupling to the ops-owned
 * flag registry / environment-matrix generator.
 *
 * Cache shape (localStorage key `alfanumrik_foxy_durable_thread_flag_v1`):
 *   { on: boolean, ts: number }
 * 5-minute TTL.
 */

import { useEffect, useState } from 'react';
import { getFeatureFlags } from './supabase';

/** Canonical DB flag name (seeded OFF by the parallel server-side migration). */
export const FF_FOXY_DURABLE_THREAD_V1 = 'ff_foxy_durable_thread_v1';

// gitleaks:allow — localStorage key, not a secret.
const CACHE_KEY = 'alfanumrik_foxy_durable_thread_flag_v1'; // gitleaks:allow
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — matches the server flag cache (feature-flag RCA)
const DEFAULT_OFF = false; // production truth: durable thread is OFF until explicitly flagged on

interface Cached {
  on: boolean;
  ts: number;
}

/**
 * DEV/PREVIEW-ONLY override. Lets the durable-thread behavior be previewed on
 * localhost without seeding the DB flag. STRICT no-op in production builds
 * (`NODE_ENV === 'production'`), so it is commit-safe.
 *
 * Enable (in the browser console at localhost, then refresh):
 *   localStorage.setItem('alfanumrik_force_foxy_durable_thread', '1')
 * Disable:
 *   localStorage.removeItem('alfanumrik_force_foxy_durable_thread')
 *
 * When set, this override WINS over the DB value: it short-circuits the
 * synchronous read and survives the async DB reconcile.
 */
function devForcedOn(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('alfanumrik_force_foxy_durable_thread') === '1'; // gitleaks:allow
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

export function clearFoxyDurableThreadFlagCache() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* non-fatal */
  }
}

/** Synchronous read: cached fresh value, else OFF. Never returns null. */
export function getFoxyDurableThreadFlagSync(): boolean {
  if (devForcedOn()) return true;
  const cached = readCache();
  if (cached !== null) return cached;
  return DEFAULT_OFF;
}

/**
 * Returns `true` only when `ff_foxy_durable_thread_v1` resolves ON. Optimistic
 * first paint from cache (defaults OFF), confirmed/corrected by an async fetch.
 */
export function useFoxyDurableThreadFlag(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => getFoxyDurableThreadFlagSync());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flags = await getFeatureFlags();
        if (cancelled) return;
        const on = devForcedOn() || Boolean(flags?.[FF_FOXY_DURABLE_THREAD_V1]);
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
