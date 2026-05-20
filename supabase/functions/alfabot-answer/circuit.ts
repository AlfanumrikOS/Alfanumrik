// supabase/functions/alfabot-answer/circuit.ts
//
// Lightweight 3-failures-in-10s circuit breaker for AlfaBot upstream calls
// (OpenAI + Voyage). Mirrors the grounded-answer pattern but trimmed: a
// single per-process key (or any short string key) keeps state.
//
// State machine:
//   closed → open after 3 failures inside a 10s sliding window
//   open   → stays open for 30s
//   open   → half-open on the first canProceed() call after 30s
//   half-open → closed on first probe success
//   half-open → open on any probe failure (resets 30s timer)
//
// Single responsibility: state-machine bookkeeping. The caller decides what
// counts as a failure (timeout, 5xx, fetch error) and what counts as a
// success (any 2xx). Per-process in-memory Map; resets on cold start.

export type CircuitState = 'closed' | 'open' | 'half-open';

interface BreakerRecord {
  state: CircuitState;
  failureTimes: number[];
  openedAt: number | null;
  lastStateChange: number;
}

const FAILURES_TO_TRIP = 3;
const WINDOW_MS = 10_000;
const OPEN_MS = 30_000;

const breakers = new Map<string, BreakerRecord>();

function now(): number {
  return Date.now();
}

function getOrCreate(key: string): BreakerRecord {
  const existing = breakers.get(key);
  if (existing) return existing;
  const t = now();
  const fresh: BreakerRecord = {
    state: 'closed',
    failureTimes: [],
    openedAt: null,
    lastStateChange: t,
  };
  breakers.set(key, fresh);
  return fresh;
}

/**
 * Check whether the circuit permits a call right now. If the breaker has
 * been OPEN for OPEN_MS, this transitions to half-open and returns true —
 * the caller's upcoming attempt is the probe.
 */
export function canProceed(key: string): boolean {
  const rec = getOrCreate(key);
  if (rec.state === 'closed') return true;

  if (rec.state === 'open') {
    if (rec.openedAt != null && now() - rec.openedAt >= OPEN_MS) {
      rec.state = 'half-open';
      rec.lastStateChange = now();
      return true;
    }
    return false;
  }

  // half-open: allow the probe.
  return true;
}

export function getState(key: string): CircuitState {
  return getOrCreate(key).state;
}

export function recordFailure(key: string): void {
  const rec = getOrCreate(key);
  const t = now();

  if (rec.state === 'half-open') {
    rec.state = 'open';
    rec.openedAt = t;
    rec.lastStateChange = t;
    rec.failureTimes = [t];
    return;
  }

  rec.failureTimes.push(t);
  const cutoff = t - WINDOW_MS;
  rec.failureTimes = rec.failureTimes.filter((ts) => ts >= cutoff);

  if (rec.failureTimes.length >= FAILURES_TO_TRIP) {
    rec.state = 'open';
    rec.openedAt = t;
    rec.lastStateChange = t;
  }
}

export function recordSuccess(key: string): void {
  const rec = getOrCreate(key);
  if (rec.state === 'half-open') {
    rec.state = 'closed';
    rec.openedAt = null;
    rec.failureTimes = [];
    rec.lastStateChange = now();
    return;
  }
  if (rec.state === 'closed' && rec.failureTimes.length > 0) {
    rec.failureTimes = [];
  }
}

/** Test-only reset. */
export function __resetAllForTests(): void {
  breakers.clear();
}

/**
 * Stable key for one AlfaBot caller surface. We keep it simple — one breaker
 * per audience+upstream pair would be over-engineering for an unauthenticated
 * landing-page chat. A single 'alfabot|openai' key is enough; if OpenAI
 * trips, all four audiences degrade together.
 */
export function alfabotCircuitKey(upstream: 'openai' | 'voyage'): string {
  return `alfabot|${upstream}`;
}
