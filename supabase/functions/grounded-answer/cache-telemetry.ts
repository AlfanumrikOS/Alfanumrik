// supabase/functions/grounded-answer/cache-telemetry.ts
//
// PII-free structured counters for the response-cache v2 tiers (design
// item 8). Follows the existing logSystemMetric-style structured-console
// pattern already used across the pipeline (console.warn('cache_l2_hit',
// {…}) / logDeprecatedEdgeFunctionHit): a stable metric name + a small
// dimensions object of enums/counters ONLY.
//
// P13 hard rule: nothing here may ever carry (or be extended to carry) a
// value matching /name|email|phone|message|answer/i — dimensions are
// caller (enum), grade (curriculum scope, not identity), subject (enum),
// and tokens_avoided (a counter derived from the stored response's
// meta.tokens_used, i.e. the spend a cache hit avoided).

export type CacheMetric =
  | 'cache_l2_hit'
  | 'cache_l2_miss'
  | 'cache_l2_shadow_hit'
  | 'cache_l3_hit';

export interface CacheMetricDims {
  caller: string;
  grade: string;
  subject: string;
  /** Tokens the hit avoided re-spending (stored meta.tokens_used). */
  tokens_avoided?: number;
}

export function logCacheMetric(metric: CacheMetric, dims: CacheMetricDims): void {
  console.warn(metric, {
    caller: dims.caller,
    grade: dims.grade,
    subject: dims.subject,
    ...(typeof dims.tokens_avoided === 'number' ? { tokens_avoided: dims.tokens_avoided } : {}),
  });
}
