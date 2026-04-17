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
}

const breakers = new Map<string, BreakerRecord>();

function now(): number {
  return Date.now();
}

function getOrCreate(key: string): BreakerRecord {
  const existing = breakers.get(key);
  if (existing) return existing;
  const fresh: BreakerRecord = {
    state: 'closed',
    failureTimes: [],
    openedAt: null,
    probeSuccesses: 0,
  };
  breakers.set(key, fresh);
  return fresh;
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
 */
export function canProceed(key: string): boolean {
  const rec = getOrCreate(key);
  if (rec.state === 'closed') return true;

  if (rec.state === 'open') {
    if (rec.openedAt != null && now() - rec.openedAt >= CIRCUIT_BREAKER_OPEN_MS) {
      rec.state = 'half-open';
      rec.probeSuccesses = 0;
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