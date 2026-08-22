'use client';

/**
 * usePracticeHistory — typed SWR reader for GET /api/practice/history, the data
 * spine of the Alfa OS Practice Center (ff_practice_os_v1, Tier 1+ /
 * presentation-only).
 *
 * The endpoint is owned by backend; this module only CONSUMES its contract:
 *
 *   {
 *     sessions:    [{ id, subject, topicTitle, scorePercent, totalQuestions,
 *                     correctAnswers, difficultyLevel, completedAt }],
 *     stats:       { totalSessions, last7Days, avgScore, dueReviewCount },
 *     errorPatterns:    [{ type, count }],
 *     bloomDistribution: [{ bloomLevel, attempted, correct }]
 *   }
 *
 * The happy path returns this bare object (NOT a { success, data } envelope);
 * error paths return { success:false, error }. We treat any non-2xx (or an
 * envelope with success:false) as an error so the UI can show a visually
 * DISTINCT error state (vs. empty).
 *
 * No scoring/XP/mastery logic lives here — `scorePercent` (a real past quiz
 * score) and `avgScore` are passed through VERBATIM and only ever rendered as
 * given. The component must NEVER recompute a score.
 */

import useSWR from 'swr';

/** One completed quiz session row. Mirrors the route's session shape. */
export interface PracticeSession {
  id: string;
  subject: string;
  topicTitle: string | null;
  /** Real past quiz score (server-computed). Shown verbatim — never recomputed. */
  scorePercent: number;
  totalQuestions: number;
  correctAnswers: number;
  difficultyLevel: number | null;
  /** ISO timestamp. */
  completedAt: string;
}

export interface PracticeStats {
  totalSessions: number;
  /** Sessions completed in the last 7 days — drives "sessions this week". */
  last7Days: number;
  /** Average past quiz score across history (server-computed). Shown verbatim. */
  avgScore: number;
  /** Topics due for practice right now (spaced-repetition signal). */
  dueReviewCount: number;
}

export interface PracticeErrorPattern {
  type: string;
  count: number;
}

export interface PracticeBloomRow {
  bloomLevel: string;
  attempted: number;
  correct: number;
}

export interface PracticeHistory {
  sessions: PracticeSession[];
  stats: PracticeStats;
  errorPatterns: PracticeErrorPattern[];
  bloomDistribution: PracticeBloomRow[];
}

const EMPTY_STATS: PracticeStats = {
  totalSessions: 0,
  last7Days: 0,
  avgScore: 0,
  dueReviewCount: 0,
};

async function fetchPracticeHistory(url: string): Promise<PracticeHistory> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const err = new Error('Practice history fetch failed') as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const json = (await res.json()) as Partial<PracticeHistory> & {
    success?: boolean;
    error?: string;
  };
  // Defensive: route returns the bare object on success, { success:false } on error.
  if (json && json.success === false) {
    throw new Error(json.error || 'Practice history unavailable');
  }
  return {
    sessions: Array.isArray(json.sessions) ? json.sessions : [],
    stats: { ...EMPTY_STATS, ...(json.stats ?? {}) },
    errorPatterns: Array.isArray(json.errorPatterns) ? json.errorPatterns : [],
    bloomDistribution: Array.isArray(json.bloomDistribution) ? json.bloomDistribution : [],
  };
}

/**
 * Reads the practice history. Gated by `enabled` (the page only fetches once
 * the flag resolves ON, so the OFF path issues zero requests).
 */
export function usePracticeHistory(enabled: boolean) {
  return useSWR<PracticeHistory>(
    enabled ? '/api/practice/history' : null,
    fetchPracticeHistory,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
      refreshInterval: 300_000,
    }
  );
}
