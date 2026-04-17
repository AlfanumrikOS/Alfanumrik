// supabase/functions/grounded-answer/circuit.ts
// Three-state circuit breaker for upstream failures (Voyage + Claude).
// Spec §6.7.
//
// Single responsibility: per-key state machine that tracks consecutive
// upstream failures, opens the breaker after 3 failures in a sliding 10s
// window, holds open for 30s, then half-opens to allow a single probe.
// Two consecutive probe successes close the breaker; one probe failure
// reopens it for another 30s.
//
// Key: "${caller}|${subject_code}|${grade}".
// State lives in-memory per Edge Function instance. A blue/green deploy
// resets all breakers; that's acceptable because the window is short.
//
// Memory bound (C7 fix):
//   - CLOSED breakers idle for >10 min are pruned on each canProceed() call.
//     Pruning happens inline — Deno Edge runtime has no persistent interval
//     scheduler we can trust across invocations.
//   - Hard cap of 1000 entries. On insert, if the map is at cap we evict
//     the entry with the oldest lastStateChange (approximate LRU). Without
//     this, a caller spraying unique (caller, subject, grade) tuples could
//     grow the map unbounded.

import {
  CIRCUIT_BREAKER_FAILURES_TO_TRIP,
  CIRCUIT_BREAKER_OPEN_MS,
  CIRCUIT_BREAKER_PROBE_SUCCESS_COUNT,
  CIRCUIT_BREAKER_WINDOW_MS,
} from './config.ts';

export type CircuitState = 'closed' | 'open' | 'half-open';

interface BreakerRecord {
  state: CircuitState;
  failureTimes: number[]; // sliding window of recent failure timestamps
  openedAt: number | null;
  probeSuccesses: number; // consecutive successes in half-open
  lastStateChange: number; // ms epoch of last state transition OR creation
}

const breakers = new Map<string, BreakerRecord>();

/** Max entries in the breakers map. Exceeding this triggers LRU eviction. */
export const BREAKER_MAP_HARD_CAP = 1000;

/**
 * A CLOSED breaker whose lastStateChange is older than this is considered
 * idle and is pruned on the next canProceed() call. 10 min is far longer
 * than the 10s trip window + 30s open timer, so we never prune active
 * state — only stale entries for keys no one is calling anymore.
 */
export const IDLE_PRUNE_MS = 10 * 60_000;

function now(): number {
  return Date.now();
}

/**
 * Remove CLOSED breakers whose lastStateChange is older than IDLE_PRUNE_MS.
 * We DON'T prune open/half-open breakers even if idle — their state is
 * protecting upstream; losing it would silently re-allow traffic.
 * Exported for tests only; normal callers go through canProceed().
 */
export function pruneClosedIdleBreakers(): number {
  const cutoff = now() - IDLE_PRUNE_MS;
  let removed = 0;
  for (const [key, rec] of breakers) {
    if (rec.state === 'closed' && rec.lastStateChange < cutoff) {
      breakers.delete(key);
      removed++;
    }
  }
  return removed;
}

/**
 * Evict the single entry with the oldest lastStateChange. Called when the
 * map is at BREAKER_MAP_HARD_CAP and we need to insert a new entry.
 * Intentionally evicts open/half-open breakers too — at 1000 entries we
 * are in pathological territory and the soft-fail (brief traffic to a
 * previously-tripped upstream) is preferable to unbounded growth.
 */
function evictOldest(): void {
  let oldestKey: string | null = null;
  let oldestTs = Number.POSITIVE_INFINITY;
  for (const [key, rec] of breakers) {
    if (rec.lastStateChange < oldestTs) {
      oldestTs = rec.lastStateChange;
      oldestKey = key;
    }
  }
  if (oldestKey != null) breakers.delete(oldestKey);
}

function getOrCreate(key: string): BreakerRecord {
  const existing = breakers.get(key);
  if (existing) return existing;
  if (breakers.size >= BREAKER_MAP_HARD_CAP) evictOldest();
  const t = now();
  const fresh: BreakerRecord = {
    state: 'closed',
    failureTimes: [],
    openedAt: null,
    probeSuccesses: 0,
    lastStateChange: t,
  };
  breakers.set(key, fresh);
  return fresh;
}

/** For tests — inspect current map size without mutating. */
export function __breakerMapSizeForTests(): number {
  return breakers.size;
}

export function circuitKey(
  caller: string,
  subject_code: string,
  grade: string,
): string {
  return `${caller}|${subject_code}|${grade}`;
}

/**
 * Check whether the circuit permits a call RIGHT NOW. If the breaker has
 * been open long enough we transition to half-open and return true (the
 * caller's upcoming attempt is the probe).
 *
 * Contract: this is the ONLY entry point that advances state from
 * open → half-open. Do not duplicate that logic in other files.
 *
 * Also opportunistically prunes CLOSED idle breakers. Pruning here keeps
 * the map bounded without a timer (Deno Edge has no persistent intervals).
 */
export function canProceed(key: string): boolean {
  pruneClosedIdleBreakers();
  const rec = getOrCreate(key);
  if (rec.state === 'closed') return true;

  if (rec.state === 'open') {
    if (rec.openedAt != null && now() - rec.openedAt >= CIRCUIT_BREAKER_OPEN_MS) {
      rec.state = 'half-open';
      rec.probeSuccesses = 0;
      rec.lastStateChange = now();
      return true; // this caller IS the probe
    }
    return false;
  }

  // half-open: one probe at a time. We don't gate concurrent probes here
  // — the Edge runtime is single-request-at-a-time per instance, so the
  // race window is negligible.
  return true;
}

/** Get the current state without mutating (for trace logging + tests). */
export function getState(key: string): CircuitState {
  return getOrCreate(key).state;
}

/**
 * Record an upstream failure (Voyage or Claude timeout / server_error /
 * unknown / circuit-relevant fetch error). In closed state, this may
 * trip the breaker to open. In half-open, ANY failure reopens the
 * breaker for a fresh 30s timeout.
 */
export function recordFailure(key: string): void {
  const rec = getOrCreate(key);
  const t = now();

  if (rec.state === 'half-open') {
    rec.state = 'open';
    rec.openedAt = t;
    rec.probeSuccesses = 0;
    rec.lastStateChange = t;
    // Start a fresh window so a subsequent close+immediate trip path is clean.
    rec.failureTimes = [t];
    return;
  }

  // closed: record failure, drop out-of-window entries, check trip.
  rec.failureTimes.push(t);
  const cutoff = t - CIRCUIT_BREAKER_WINDOW_MS;
  rec.failureTimes = rec.failureTimes.filter((ts) => ts >= cutoff);

  if (rec.failureTimes.length >= CIRCUIT_BREAKER_FAILURES_TO_TRIP) {
    rec.state = 'open';
    rec.openedAt = t;
    rec.probeSuccesses = 0;
    rec.lastStateChange = t;
  }
}

/**
 * Record an upstream success. In half-open, this advances the probe
 * counter; PROBE_SUCCESS_COUNT consecutive successes close the breaker.
 */
export function recordSuccess(key: string): void {
  const rec = getOrCreate(key);
  if (rec.state === 'half-open') {
    rec.probeSuccesses++;
    if (rec.probeSuccesses >= CIRCUIT_BREAKER_PROBE_SUCCESS_COUNT) {
      rec.state = 'closed';
      rec.openedAt = null;
      rec.probeSuccesses = 0;
      rec.failureTimes = [];
      rec.lastStateChange = now();
    }
    return;
  }
  // closed: clear transient failures that didn't accumulate to a trip.
  // (Leaving them in the window is fine too, but this keeps memory bounded.)
  if (rec.state === 'closed' && rec.failureTimes.length > 0) {
    rec.failureTimes = [];
  }
}

/** Reset ALL breakers. For tests only. */
export function __resetAllForTests(): void {
  breakers.clear();
}