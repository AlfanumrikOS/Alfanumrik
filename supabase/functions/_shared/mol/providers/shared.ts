// supabase/functions/_shared/mol/providers/shared.ts

import type { ProviderCallResult } from './base.ts'

/**
 * Per-provider circuit breaker. Shared across the MOL module so all callers
 * see consistent state. Trips OPEN after FAILURE_THRESHOLD failures within
 * the rolling window; resets to HALF-OPEN after RESET_TIMEOUT.
 */
type BreakerState = 'closed' | 'open' | 'half-open'

interface BreakerEntry {
  failures: number
  last_failure_at: number
  state: BreakerState
}

const breakers = new Map<string, BreakerEntry>()
const FAILURE_THRESHOLD = 5
const RESET_TIMEOUT_MS = 60_000

function getEntry(key: string): BreakerEntry {
  let e = breakers.get(key)
  if (!e) {
    e = { failures: 0, last_failure_at: 0, state: 'closed' }
    breakers.set(key, e)
  }
  return e
}

export function canRequest(provider_id: string): boolean {
  const e = getEntry(provider_id)
  if (e.state === 'closed') return true
  if (e.state === 'open') {
    if (Date.now() - e.last_failure_at > RESET_TIMEOUT_MS) {
      e.state = 'half-open'
      return true
    }
    return false
  }
  return true
}

export function recordSuccess(provider_id: string): void {
  const e = getEntry(provider_id)
  e.failures = 0
  e.state = 'closed'
}

export function recordFailure(provider_id: string): void {
  const e = getEntry(provider_id)
  e.failures += 1
  e.last_failure_at = Date.now()
  if (e.failures >= FAILURE_THRESHOLD) e.state = 'open'
}

/**
 * Retries the inner fn up to maxAttempts on retryable failures.
 * Sleeps `backoff_ms_base * 2^attempt` between attempts (capped at 4s).
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<ProviderCallResult>,
  maxAttempts = 2,
  backoff_ms_base = 500,
): Promise<ProviderCallResult> {
  let last: ProviderCallResult | null = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await fn()
    if (last.ok) return last
    if (!last.retryable) return last
    if (attempt < maxAttempts - 1) {
      const delay = Math.min(backoff_ms_base * 2 ** attempt, 4000)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  return last as ProviderCallResult
}

/** Wraps a promise with a hard timeout via AbortController. */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeout_ms: number,
): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout_ms)
  try {
    return await fn(ctrl.signal)
  } finally {
    clearTimeout(timer)
  }
}

/** Classifies HTTP status into retryable / non-retryable. */
export function isRetryable(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 529
}
