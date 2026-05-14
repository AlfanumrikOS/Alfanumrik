import { getFeatureFlags as _getFeatureFlags } from './supabase';
import { logger } from './logger';

/**
 * Short server-side cache for feature flags.
 * TTL is intentionally short (30s) to balance freshness with DB load.
 */
let cached: { value: Record<string, boolean>; expiresAt: number } | null = null;
const TTL_MS = Number(process.env.FEATURE_FLAGS_CACHE_TTL_MS ? Number(process.env.FEATURE_FLAGS_CACHE_TTL_MS) : 30000);

export async function getFeatureFlagsCached(context?: { role?: string; institutionId?: string }) {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  try {
    const flags = await _getFeatureFlags(context);
    cached = { value: flags ?? {}, expiresAt: now + TTL_MS };
    return cached.value;
  } catch (err) {
    logger.warn('feature_flags_cache_miss', { err: String(err) });
    // Fail-open to previous cache if available, else return empty object
    if (cached) return cached.value;
    return {};
  }
}

export function invalidateFeatureFlagsCache() {
  cached = null;
}
