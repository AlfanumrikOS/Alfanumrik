'use client';

/**
 * useRevisionOverview — typed SWR reader for GET /api/revision/overview, the
 * data spine of the Alfa OS Revision Center (ff_revision_os_v1, Tier 1 /
 * presentation-only).
 *
 * The endpoint is owned by backend; this module only consumes its contract.
 * The happy path returns the bare overview object (NOT a { success, data }
 * envelope); error paths return { success:false, error }. We treat any non-2xx
 * (or an envelope with success:false) as an error so the UI can show a
 * visually-distinct error state (vs. empty).
 *
 * No scoring/XP/mastery logic lives here — masteryProbability is passed through
 * verbatim and only ever rendered as a qualitative label, never as a number.
 */

import useSWR from 'swr';

/** A single due/upcoming review item. Mirrors the route's RevisionItem. */
export interface RevisionItem {
  topicId: string;
  title: string;
  titleHi: string | null;
  subject: string;
  /** YYYY-MM-DD */
  dueDate: string;
  daysOverdue: number;
  /** 0..1 spaced-repetition mastery probability. Never shown as a number. */
  masteryProbability: number;
}

export interface RevisionBucket {
  count: number;
  items: RevisionItem[];
}

export interface RevisionUpcoming extends RevisionBucket {
  byDay: { date: string; count: number }[];
}

export interface RevisionSubjectLoad {
  subject: string;
  dueCount: number;
}

export interface RevisionOverview {
  overdue: RevisionBucket;
  dueToday: RevisionBucket;
  upcoming: RevisionUpcoming;
  estimatedMinutes: number;
  subjects: RevisionSubjectLoad[];
}

async function fetchRevisionOverview(url: string): Promise<RevisionOverview> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const err = new Error('Revision overview fetch failed') as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const json = (await res.json()) as Partial<RevisionOverview> & {
    success?: boolean;
    error?: string;
  };
  // Defensive: route returns the bare object on success, { success:false } on error.
  if (json && json.success === false) {
    throw new Error(json.error || 'Revision overview unavailable');
  }
  return {
    overdue: json.overdue ?? { count: 0, items: [] },
    dueToday: json.dueToday ?? { count: 0, items: [] },
    upcoming: json.upcoming ?? { count: 0, byDay: [], items: [] },
    estimatedMinutes: json.estimatedMinutes ?? 0,
    subjects: json.subjects ?? [],
  };
}

/**
 * Reads the revision overview. Gated by `enabled` (the page only fetches once
 * the flag resolves ON, so the OFF path issues zero requests).
 */
export function useRevisionOverview(enabled: boolean) {
  return useSWR<RevisionOverview>(
    enabled ? '/api/revision/overview' : null,
    fetchRevisionOverview,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
      // 5-min client refresh mirrors the route's private 5-min cache.
      refreshInterval: 300_000,
    }
  );
}
