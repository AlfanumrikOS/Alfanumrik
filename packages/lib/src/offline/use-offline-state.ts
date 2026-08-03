'use client';

/**
 * useOfflineState — connectivity + the local queue, in one hook.
 *
 * Reads only the client stores in ./store. No network call, no server state.
 * Replays the queue automatically when the browser comes back online.
 */

import { useCallback, useEffect, useState } from 'react';
import { authHeader } from '@alfanumrik/lib/api/auth-header';
import {
  listChapters,
  listPending,
  listSavedExplanations,
  replayPending,
  type OfflineChapterRow,
  type PendingWriteRow,
  type SavedExplanationRow,
} from './store';

export interface OfflineSnapshot {
  isOffline: boolean;
  chapters: OfflineChapterRow[];
  pending: PendingWriteRow[];
  savedExplanations: SavedExplanationRow[];
  refresh: () => Promise<void>;
}

export function useOfflineState(): OfflineSnapshot {
  const [isOffline, setIsOffline] = useState(false);
  const [chapters, setChapters] = useState<OfflineChapterRow[]>([]);
  const [pending, setPending] = useState<PendingWriteRow[]>([]);
  const [savedExplanations, setSaved] = useState<SavedExplanationRow[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [c, p, s] = await Promise.all([listChapters(), listPending(), listSavedExplanations()]);
      setChapters(c);
      setPending(p);
      setSaved(s);
    } catch {
      // IndexedDB unavailable (private mode, quota) — degrade to empty, never throw.
    }
  }, []);

  useEffect(() => {
    setIsOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
    void refresh();

    const goOffline = () => setIsOffline(true);
    const goOnline = async () => {
      setIsOffline(false);
      try {
        await replayPending(await authHeader());
      } catch {
        // Replay is best-effort; the next online event retries.
      }
      void refresh();
    };

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [refresh]);

  return { isOffline, chapters, pending, savedExplanations, refresh };
}
