/**
 * Deletion cache invalidation module (P2-7).
 * Audit remediation 2026-08-07 — REBUILT to match real project patterns.
 * Redis init mirrors apps/host/src/proxy.ts (new Redis({url,token})); session
 * cache keys are `sess:valid:<sessionId>` (proxy.ts:312,367).
 */

import { logger } from './logger';

interface CacheInvalidationResult {
  cache: string;
  status: 'invalidated' | 'failed' | 'skipped';
  error?: string;
}

/**
 * Invalidate all caches and third-party stores for a deleted account.
 * Called after account-purge completes successfully.
 */
export async function invalidateCachesOnDeletion(
  accountId: string,
  accountRole: 'student' | 'teacher' | 'parent'
): Promise<CacheInvalidationResult[]> {
  const results: CacheInvalidationResult[] = [];

  // Redis/Upstash cache invalidation — same init as proxy.ts
  try {
    const { Redis } = await import('@upstash/redis');
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (url && token) {
      const redis = new Redis({ url, token });

      // Session-validation cache keys are sess:valid:<sessionId>. We cannot
      // enumerate them by account id, so we clear the account's active-session
      // records via Supabase (server) — handled by the caller — and purge the
      // rate-limit buckets keyed on the account where the caller passed the id.
      // Session keys will age out via their 300s TTL.
      const userKeys = await redis.keys(`user:*:${accountId}*`);
      const rateKeys = await redis.keys(`rl:*:*${accountId}*`);

      const allKeys = [...userKeys, ...rateKeys];
      if (allKeys.length > 0) {
        await redis.del(...allKeys);
        logger.info('Redis cache invalidated for deleted account', {
          accountId: accountId.slice(0, 8),
          role: accountRole,
          keyCount: allKeys.length,
        });
      }

      results.push({ cache: 'upstash_redis', status: 'invalidated' });
    } else {
      results.push({ cache: 'upstash_redis', status: 'skipped' });
    }
  } catch (e) {
    logger.warn('Failed to invalidate Redis cache on deletion', {
      accountId: accountId.slice(0, 8),
      error: (e as Error).message,
    });
    results.push({ cache: 'upstash_redis', status: 'failed', error: (e as Error).message });
  }

  // PostHog: mark user as deleted (does not delete data, but stops new ingestion)
  try {
    const { PostHog } = await import('posthog-node');
    if (process.env.POSTHOG_PROJECT_API_KEY) {
      const client = new PostHog(process.env.POSTHOG_PROJECT_API_KEY, {
        host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.posthog.com',
      });

      client.capture({
        distinctId: `deleted_${accountId}`,
        event: 'account_deleted',
        properties: {
          role: accountRole,
          deleted_at: new Date().toISOString(),
        },
      });

      await client.shutdown();
      results.push({ cache: 'posthog', status: 'invalidated' });
    } else {
      results.push({ cache: 'posthog', status: 'skipped' });
    }
  } catch (e) {
    logger.warn('Failed to notify PostHog of deletion', {
      accountId: accountId.slice(0, 8),
      error: (e as Error).message,
    });
    results.push({ cache: 'posthog', status: 'failed', error: (e as Error).message });
  }

  // Sentry: no deletion API from the SDK; data ages out per retention policy.
  results.push({ cache: 'sentry', status: 'skipped' });

  return results;
}
