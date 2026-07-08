'use client';

/**
 * src/lib/state/rules/client.ts — client-side hook for rule-engine decisions.
 *
 * Phase 4 of the unified state architecture. React surfaces (sidebar,
 * dashboard cards, upsell banner, parent digest preview) call
 * `useLearnerDecisions()` and consume the typed `Decision[]`. The hook
 * wraps SWR around `/api/state/decisions`, so multiple surfaces on the
 * same page share one fetch.
 *
 * Behavior when the rule engine is gated off:
 *   - The route returns `{ decisions: [], reason: 'flag_off' }`.
 *   - The hook surfaces that as `decisions: []` and `isFlagOff: true`.
 *   - Surfaces should branch on `isFlagOff` to render the legacy in-line
 *     check until the cutover PR removes it.
 *
 * No SWR config = use whatever the app's SWRConfig provider sets. Most
 * Alfanumrik pages already configure SWR via the root layout.
 */

import useSWR from 'swr';
import type { Decision } from './engine';

const ENDPOINT = '/api/state/decisions';

export interface UseLearnerDecisionsOptions {
  /** Filter the server response to these decision slugs. */
  slugs?: readonly string[];
  /** Minimum priority to surface. */
  minPriority?: number;
  /** When false, skip the fetch entirely. Useful for guests. */
  enabled?: boolean;
}

export interface UseLearnerDecisionsResult {
  decisions: Decision[];
  isLoading: boolean;
  isError: boolean;
  /** True iff the server returned reason='flag_off' (flag not on for this user). */
  isFlagOff: boolean;
  /** Re-fetch on demand. */
  mutate: () => Promise<unknown>;
}

const fetcher = async (url: string): Promise<{ decisions: Decision[]; reason: string }> => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`decisions fetch failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    success?: boolean;
    data?: { decisions?: Decision[]; reason?: string };
  };
  if (!body.success || !body.data) {
    throw new Error('decisions fetch: malformed response');
  }
  return {
    decisions: Array.isArray(body.data.decisions) ? body.data.decisions : [],
    reason: body.data.reason ?? 'unknown',
  };
};

export function useLearnerDecisions(
  opts: UseLearnerDecisionsOptions = {},
): UseLearnerDecisionsResult {
  const enabled = opts.enabled !== false;
  const search = new URLSearchParams();
  if (opts.slugs && opts.slugs.length > 0) {
    search.set('slug', opts.slugs.join(','));
  }
  if (typeof opts.minPriority === 'number') {
    search.set('minPriority', String(opts.minPriority));
  }
  const key = enabled
    ? `${ENDPOINT}${search.toString() ? `?${search.toString()}` : ''}`
    : null;

  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    // Decisions are derived from StudentState; the server caches that for 5s,
    // so polling more aggressively than the server's TTL is wasteful. Page
    // navigation already invalidates via SWR's cache.
    dedupingInterval: 5_000,
  });

  return {
    decisions: data?.decisions ?? [],
    isLoading,
    isError: !!error,
    isFlagOff: data?.reason === 'flag_off',
    mutate: () => mutate(),
  };
}

/**
 * Narrowed hook: returns the top (highest-priority) decision for one
 * specific slug, or null. Convenience for surfaces that only care
 * about a single decision (e.g. the upsell banner asks for
 * 'upsell.show').
 */
export function useLearnerDecision(slug: string): {
  decision: Decision | null;
  isLoading: boolean;
  isFlagOff: boolean;
} {
  const { decisions, isLoading, isFlagOff } = useLearnerDecisions({ slugs: [slug] });
  return {
    decision: decisions[0] ?? null,
    isLoading,
    isFlagOff,
  };
}
