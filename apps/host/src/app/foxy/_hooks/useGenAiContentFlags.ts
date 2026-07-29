'use client';

/**
 * useGenAiContentFlags — the single CLIENT-side reader for the two GenAI
 * student-facing generation flags surfaced inside the /foxy workspace:
 *
 *   ff_content_generation_v1  →  the "Diagram" affordance   (POST /api/content/diagram)
 *   ff_lesson_generation_v1   →  the "Lesson notes" affordance (GET /api/lesson)
 *
 * Shape mirrors the proven `use-foxy-os-flag` precedent EXACTLY (synchronous
 * first paint from a TTL-cached value, async confirm/correct on mount) with the
 * same critical property:
 *
 *   DEFAULT IS OFF — BOTH FLAGS.
 *
 * Neither flag is seeded ON in any environment, and the contract is that the
 * OFF path leaves /foxy BYTE-IDENTICAL to today. So the first-ever paint (no
 * cache) resolves both to false — no button renders, no chunk is fetched, no
 * request is made — and the async `getFeatureFlags()` only flips an affordance
 * on if the DB row is explicitly enabled. This guarantees production students
 * who shouldn't see the surface never get a flash of it.
 *
 * The two flags are read together in ONE `getFeatureFlags()` call (it returns
 * the whole map anyway) but resolve INDEPENDENTLY — either affordance can be
 * ON while the other is OFF, matching the independent-ramp posture documented
 * in the flags registry.
 *
 * Flag constants are imported from the flags REGISTRY module
 * (`@alfanumrik/lib/flags/registries/foxy`) and NOT from the `feature-flags`
 * barrel — the barrel pulls server-side flag machinery that breaks the existing
 * Foxy `vi.mock` test setup.
 *
 * Cache shape (localStorage key `alfanumrik_genai_content_flags_v1`):
 *   { diagram: boolean, lesson: boolean, ts: number }
 * 5-minute TTL — matches the server flag cache.
 */

import { useEffect, useState } from 'react';
import { getFeatureFlags } from '@alfanumrik/lib/supabase';
import {
  CONTENT_GENERATION_FLAGS,
  LESSON_GENERATION_FLAGS,
} from '@alfanumrik/lib/flags/registries/foxy';

export interface GenAiContentFlags {
  /** ff_content_generation_v1 — gates the "Diagram" / "आरेख" affordance. */
  diagram: boolean;
  /** ff_lesson_generation_v1 — gates the "Lesson notes" / "पाठ नोट्स" affordance. */
  lesson: boolean;
}

/** Production truth: both surfaces are OFF until explicitly flagged on. */
export const GENAI_CONTENT_FLAGS_DEFAULT: GenAiContentFlags = {
  diagram: false,
  lesson: false,
};

// gitleaks:allow — localStorage key, not a secret.
const CACHE_KEY = 'alfanumrik_genai_content_flags_v1'; // gitleaks:allow
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface Cached extends GenAiContentFlags {
  ts: number;
}

/**
 * DEV/PREVIEW-ONLY override. Lets the two affordances be previewed on localhost
 * without seeding the DB flags. STRICT no-op in production builds
 * (`NODE_ENV === 'production'`), so it is commit-safe.
 *
 * Enable (browser console at localhost, then refresh):
 *   localStorage.setItem('alfanumrik_force_genai_content', '1')   // both
 *   localStorage.setItem('alfanumrik_force_genai_content', 'diagram')
 *   localStorage.setItem('alfanumrik_force_genai_content', 'lesson')
 * Disable:
 *   localStorage.removeItem('alfanumrik_force_genai_content')
 *
 * When set, this override WINS over the DB value: it short-circuits the
 * synchronous read and survives the async DB reconcile.
 */
function devForced(): Partial<GenAiContentFlags> {
  if (process.env.NODE_ENV === 'production') return {};
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem('alfanumrik_force_genai_content'); // gitleaks:allow
    if (!raw) return {};
    if (raw === '1' || raw === 'all') return { diagram: true, lesson: true };
    if (raw === 'diagram') return { diagram: true };
    if (raw === 'lesson') return { lesson: true };
    return {};
  } catch {
    return {};
  }
}

function readCache(): GenAiContentFlags | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return { diagram: Boolean(parsed.diagram), lesson: Boolean(parsed.lesson) };
  } catch {
    return null;
  }
}

function writeCache(flags: GenAiContentFlags) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ...flags, ts: Date.now() }),
    );
  } catch {
    /* quota / disabled storage — fall back to per-mount fetch */
  }
}

export function clearGenAiContentFlagsCache() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* non-fatal */
  }
}

/** Synchronous read: cached fresh value, else BOTH OFF. Never returns null. */
export function getGenAiContentFlagsSync(): GenAiContentFlags {
  const forced = devForced();
  const cached = readCache() ?? GENAI_CONTENT_FLAGS_DEFAULT;
  return {
    diagram: forced.diagram === true ? true : cached.diagram,
    lesson: forced.lesson === true ? true : cached.lesson,
  };
}

/**
 * Returns `{ diagram, lesson }`, each `true` ONLY when its flag resolves ON.
 * Optimistic first paint from cache (defaults OFF), confirmed/corrected by an
 * async fetch. Never throws — a network/auth failure keeps the optimistic
 * (OFF) value so the OFF contract holds.
 */
export function useGenAiContentFlags(): GenAiContentFlags {
  const [flags, setFlags] = useState<GenAiContentFlags>(() =>
    getGenAiContentFlagsSync(),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await getFeatureFlags();
        if (cancelled) return;
        const forced = devForced();
        const next: GenAiContentFlags = {
          diagram:
            forced.diagram === true ||
            Boolean(all?.[CONTENT_GENERATION_FLAGS.V1]),
          lesson:
            forced.lesson === true ||
            Boolean(all?.[LESSON_GENERATION_FLAGS.V1]),
        };
        writeCache(next);
        setFlags((prev) =>
          prev.diagram !== next.diagram || prev.lesson !== next.lesson
            ? next
            : prev,
        );
      } catch {
        /* network/auth failure — keep the optimistic value (OFF) */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return flags;
}
