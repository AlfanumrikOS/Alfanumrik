import { logger } from '@alfanumrik/lib/logger';
import type { Ratelimit as RatelimitType } from '@upstash/ratelimit';
import type { Redis as RedisType } from '@upstash/redis';

const BURST_LIMIT = 6;
const BURST_WINDOW = '60 s' as const;
const DAILY_LIMIT = 30;
const DAILY_WINDOW = '24 h' as const;
const IP_DAILY_LIMIT = 60;
const IP_DAILY_WINDOW = '24 h' as const;

let redis: RedisType | null = null;
let burstLimiter: RatelimitType | null = null;
let dailyLimiter: RatelimitType | null = null;
let ipDailyLimiter: RatelimitType | null = null;
let leadLimiter: RatelimitType | null = null;
let upstashInit: Promise<void> | null = null;
let upstashReady = false;

async function ensureUpstash(): Promise<void> {
  if (upstashReady) return;
  if (upstashInit) return upstashInit;
  upstashInit = (async () => {
    try {
      if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
        const [{ Redis }, { Ratelimit }] = await Promise.all([
          import('@upstash/redis'),
          import('@upstash/ratelimit'),
        ]);
        redis = new Redis({
          url: process.env.UPSTASH_REDIS_REST_URL,
          token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
        burstLimiter = new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(BURST_LIMIT, BURST_WINDOW),
          prefix: 'alfabot:burst',
        });
        dailyLimiter = new Ratelimit({
          redis,
          limiter: Ratelimit.fixedWindow(DAILY_LIMIT, DAILY_WINDOW),
          prefix: 'alfabot:day',
        });
        ipDailyLimiter = new Ratelimit({
          redis,
          limiter: Ratelimit.fixedWindow(IP_DAILY_LIMIT, IP_DAILY_WINDOW),
          prefix: 'alfabot:ipday',
        });
        leadLimiter = new Ratelimit({
          redis,
          limiter: Ratelimit.fixedWindow(3, '24 h'),
          prefix: 'alfabot:lead',
        });
      }
    } catch (err) {
      logger.warn('alfabot.upstash_init_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      redis = null;
      burstLimiter = null;
      dailyLimiter = null;
      ipDailyLimiter = null;
      leadLimiter = null;
    } finally {
      upstashReady = true;
    }
  })();
  return upstashInit;
}

const MAX_FALLBACK_ENTRIES = 10_000;

interface MemoryBucket {
  hits: number[];
}

const memoryStore = new Map<string, MemoryBucket>();

function evictIfFull(): void {
  if (memoryStore.size < MAX_FALLBACK_ENTRIES) return;
  const firstKey = memoryStore.keys().next().value;
  if (firstKey) memoryStore.delete(firstKey);
}

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetMs: number;
}

function checkMemoryLimit(key: string, limit: number, windowMs: number): LimitResult {
  const now = Date.now();
  let bucket = memoryStore.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    evictIfFull();
    memoryStore.set(key, bucket);
  }
  const cutoff = now - windowMs;
  while (bucket.hits.length > 0 && bucket.hits[0] < cutoff) bucket.hits.shift();
  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    return {
      allowed: false,
      remaining: 0,
      limit,
      resetMs: oldest + windowMs,
    };
  }
  bucket.hits.push(now);
  return {
    allowed: true,
    remaining: limit - bucket.hits.length,
    limit,
    resetMs: now + windowMs,
  };
}

export async function applyLimit(
  bucketName: 'burst' | 'day' | 'ip' | 'lead',
  key: string,
): Promise<LimitResult> {
  await ensureUpstash();
  const upstashLimiter =
    bucketName === 'burst'
      ? burstLimiter
      : bucketName === 'day'
        ? dailyLimiter
        : bucketName === 'ip'
          ? ipDailyLimiter
          : leadLimiter;
  const memoryConfig = (() => {
    switch (bucketName) {
      case 'burst':
        return { limit: BURST_LIMIT, windowMs: 60_000 };
      case 'day':
        return { limit: DAILY_LIMIT, windowMs: 24 * 60 * 60_000 };
      case 'ip':
        return { limit: IP_DAILY_LIMIT, windowMs: 24 * 60 * 60_000 };
      case 'lead':
        return { limit: 3, windowMs: 24 * 60 * 60_000 };
    }
  })();
  const fullKey = `${bucketName}:${key}`;
  if (upstashLimiter) {
    try {
      const result = await upstashLimiter.limit(key);
      return {
        allowed: result.success,
        remaining: result.remaining,
        limit: memoryConfig.limit,
        resetMs: result.reset,
      };
    } catch (err) {
      logger.warn('alfabot.rate_limit_upstash_failed', {
        bucket: bucketName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return checkMemoryLimit(fullKey, memoryConfig.limit, memoryConfig.windowMs);
}

const budgetMemory = new Map<string, number>();

function budgetKey(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `alfabot:budget:usd:${yyyy}${mm}${dd}`;
}

export async function getBudgetSpentUsd(): Promise<number> {
  await ensureUpstash();
  if (redis) {
    try {
      const v = await redis.get<number | string | null>(budgetKey());
      if (v === null || v === undefined) return 0;
      return typeof v === 'number' ? v : Number(v) || 0;
    } catch {
      /* fall through */
    }
  }
  return budgetMemory.get(budgetKey()) ?? 0;
}

export async function addBudgetSpentUsd(amount: number): Promise<void> {
  if (amount <= 0) return;
  await ensureUpstash();
  if (redis) {
    try {
      const cents = Math.round(amount * 100);
      const next = await redis.incrby(budgetKey() + ':cents', cents);
      await redis.expire(budgetKey() + ':cents', 24 * 60 * 60);
      const dollars = next / 100;
      await redis.set(budgetKey(), dollars, { ex: 24 * 60 * 60 });
      return;
    } catch {
      /* fall through */
    }
  }
  const cur = budgetMemory.get(budgetKey()) ?? 0;
  budgetMemory.set(budgetKey(), cur + amount);
}

export function resetMemoryStore(): void {
  memoryStore.clear();
}

export function resetBudgetMemory(): void {
  budgetMemory.clear();
}
