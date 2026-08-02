'use client';

/**
 * Offline store — the client substrate behind the offline state (design 14).
 *
 * Three IndexedDB object stores, no server involvement:
 *   offline_chapters   — chapters the student explicitly kept, keyed by
 *                        curriculum_topics.id. Explicit taps only; we never
 *                        spend a student's data plan on a background download.
 *   pending_writes     — queued answer/session writes. Each row carries the
 *                        payload AND the idempotency key generated AT CAPTURE
 *                        TIME. A key minted at replay time is a new key on
 *                        every retry, and a flaky reconnect double-counts.
 *   saved_explanations — Foxy answers the student pressed Save on, so the
 *                        offline screen still has something to offer.
 *
 * Eviction: five chapters, least-recently-opened first (DECISIONS.md §9).
 *
 * No PII beyond what the student already has locally; nothing is logged.
 */

const DB_NAME = 'alfanumrik_offline';
const DB_VERSION = 1;

export const CHAPTERS = 'offline_chapters';
export const PENDING = 'pending_writes';
export const SAVED = 'saved_explanations';

export const MAX_CACHED_CHAPTERS = 5;

export interface OfflineChapterRow {
  /** curriculum_topics.id */
  id: string;
  subjectCode: string;
  title: string;
  chapterNumber: number;
  questionCount: number;
  savedAt: string;
  lastOpenedAt: string;
}

export interface PendingWriteRow {
  /** Idempotency key. Also the primary key — a replayed row collides and is a no-op. */
  idempotencyKey: string;
  kind: 'quiz_answer' | 'quiz_session';
  /** Request path this replays to, e.g. '/api/v2/quiz/submit'. */
  endpoint: string;
  payload: unknown;
  /** When the student actually did the work. Credited date, per DECISIONS.md §7. */
  occurredAt: string;
}

export interface SavedExplanationRow {
  id: string;
  topicId: string | null;
  title: string;
  body: string;
  citation: string | null;
  savedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHAPTERS)) db.createObjectStore(CHAPTERS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PENDING)) db.createObjectStore(PENDING, { keyPath: 'idempotencyKey' });
      if (!db.objectStoreNames.contains(SAVED)) db.createObjectStore(SAVED, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export function listChapters(): Promise<OfflineChapterRow[]> {
  return tx<OfflineChapterRow[]>(CHAPTERS, 'readonly', (s) => s.getAll());
}

export function listPending(): Promise<PendingWriteRow[]> {
  return tx<PendingWriteRow[]>(PENDING, 'readonly', (s) => s.getAll());
}

export function listSavedExplanations(): Promise<SavedExplanationRow[]> {
  return tx<SavedExplanationRow[]>(SAVED, 'readonly', (s) => s.getAll());
}

/** Explicit "keep offline" tap. Evicts the least-recently-opened chapter past the cap. */
export async function keepChapter(row: Omit<OfflineChapterRow, 'savedAt' | 'lastOpenedAt'>): Promise<void> {
  const now = new Date().toISOString();
  await tx(CHAPTERS, 'readwrite', (s) => s.put({ ...row, savedAt: now, lastOpenedAt: now }));
  const all = await listChapters();
  if (all.length <= MAX_CACHED_CHAPTERS) return;
  const evict = all
    .sort((a, b) => a.lastOpenedAt.localeCompare(b.lastOpenedAt))
    .slice(0, all.length - MAX_CACHED_CHAPTERS);
  for (const row of evict) {
    await tx(CHAPTERS, 'readwrite', (s) => s.delete(row.id));
  }
}

export async function touchChapter(id: string): Promise<void> {
  const existing = await tx<OfflineChapterRow | undefined>(CHAPTERS, 'readonly', (s) => s.get(id));
  if (!existing) return;
  await tx(CHAPTERS, 'readwrite', (s) => s.put({ ...existing, lastOpenedAt: new Date().toISOString() }));
}

export function dropChapter(id: string): Promise<void> {
  return tx(CHAPTERS, 'readwrite', (s) => s.delete(id));
}

/**
 * Queue a write. The caller MUST pass the idempotency key it generated when the
 * student acted — this function never mints one, precisely so that a retry
 * cannot produce a second key.
 */
export function queueWrite(row: PendingWriteRow): Promise<void> {
  return tx(PENDING, 'readwrite', (s) => s.put(row));
}

export function clearPending(idempotencyKey: string): Promise<void> {
  return tx(PENDING, 'readwrite', (s) => s.delete(idempotencyKey));
}

export function saveExplanation(row: SavedExplanationRow): Promise<void> {
  return tx(SAVED, 'readwrite', (s) => s.put(row));
}

/**
 * Replay the queue. Each request carries its capture-time idempotency key in
 * the header the server already honours; a duplicate is accepted and dropped
 * server-side. A failed row stays queued for the next attempt.
 */
export async function replayPending(authHeaders: Record<string, string>): Promise<number> {
  const rows = await listPending();
  let replayed = 0;
  for (const row of rows) {
    try {
      const res = await fetch(row.endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': row.idempotencyKey,
          ...authHeaders,
        },
        body: JSON.stringify({ ...(row.payload as object), occurredAt: row.occurredAt }),
      });
      if (res.ok || res.status === 409) {
        await clearPending(row.idempotencyKey);
        replayed++;
      }
    } catch {
      // Still offline or the request failed — leave it queued.
    }
  }
  return replayed;
}
