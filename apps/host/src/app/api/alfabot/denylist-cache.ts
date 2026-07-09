interface DenylistEntry {
  denied: boolean;
  expiresAt: number;
}

const caches = new Map<string, Map<string, DenylistEntry>>();

function cacheFor(namespace: string): Map<string, DenylistEntry> {
  let cache = caches.get(namespace);
  if (!cache) {
    cache = new Map<string, DenylistEntry>();
    caches.set(namespace, cache);
  }
  return cache;
}

export function getDenylistCache(namespace: string, anonId: string): DenylistEntry | null {
  const cached = cacheFor(namespace).get(anonId);
  if (cached && cached.expiresAt > Date.now()) return cached;
  return null;
}

export function setDenylistCache(namespace: string, anonId: string, denied: boolean, ttlMs: number): void {
  cacheFor(namespace).set(anonId, { denied, expiresAt: Date.now() + ttlMs });
}

export function clearDenylistCache(namespace?: string): void {
  if (namespace) {
    cacheFor(namespace).clear();
    return;
  }
  for (const cache of caches.values()) cache.clear();
}
