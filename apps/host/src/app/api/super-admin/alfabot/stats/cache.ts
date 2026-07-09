interface CachedPayload<T> {
  body: T;
  expiresAt: number;
}

let cached: CachedPayload<unknown> | null = null;

export function getStatsCache<T>(now: number): T | null {
  if (cached && cached.expiresAt > now) return cached.body as T;
  return null;
}

export function setStatsCache<T>(body: T, expiresAt: number): void {
  cached = { body, expiresAt };
}

export function clearStatsCache(): void {
  cached = null;
}
