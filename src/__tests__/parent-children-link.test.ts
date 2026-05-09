/**
 * Tests for the parent-session HMAC sessionStorage flow + link-code lockout.
 *
 * Covers `src/app/parent/_components/parent-session.ts`:
 *   - storeParentSession / loadParentSession round-trip
 *   - empty / cleared sessionStorage returns null
 *   - tamper detection: HMAC mismatch clears the bad entry
 *   - expiry: payloads older than SESSION_TTL_MS are rejected
 *   - clearParentSession empties storage
 *   - progressive lockout (3 -> 5 -> 15 -> 60 min) and reset semantics
 *
 * The HMAC is keyed off a per-session random nonce that the helper writes
 * alongside the payload, so we can deterministically tamper with the
 * payload (keeping the original nonce) and observe the verification fail.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  storeParentSession,
  loadParentSession,
  clearParentSession,
  SESSION_KEY,
  SESSION_TTL_MS,
  LOCKOUT_KEY,
  MAX_ATTEMPTS_BEFORE_LOCKOUT,
  LOCKOUT_DURATIONS,
  getLockoutState,
  recordFailedAttempt,
  clearLockoutAttempts,
  isLockedOut,
} from '@/app/parent/_components/parent-session';

const guardian = { id: 'g-1', name: 'Pradeep' };
const student = { id: 's-1', name: 'Aarav', grade: '8' };

beforeEach(() => {
  sessionStorage.clear();
});

describe('parent-session HMAC sessionStorage', () => {
  it('round-trips guardian + student data through store/load', async () => {
    await storeParentSession(guardian, student);
    const loaded = await loadParentSession();
    expect(loaded).not.toBeNull();
    expect(loaded?.guardian).toEqual(guardian);
    expect(loaded?.student).toEqual(student);
  });

  it('returns null when sessionStorage is empty', async () => {
    const loaded = await loadParentSession();
    expect(loaded).toBeNull();
  });

  it('clearParentSession empties storage and subsequent load returns null', async () => {
    await storeParentSession(guardian, student);
    expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull();

    clearParentSession();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();

    const loaded = await loadParentSession();
    expect(loaded).toBeNull();
  });

  it('rejects tampered payload (HMAC mismatch) and removes the bad entry', async () => {
    await storeParentSession(guardian, student);

    const raw = sessionStorage.getItem(SESSION_KEY);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw!) as { payload: string; hmac: string; nonce: string };

    // Mutate the payload — replace guardian.id with an attacker-controlled value —
    // but keep the original hmac + nonce. Because hmac was computed over the
    // original payload string, verification should fail.
    const innerPayload = JSON.parse(stored.payload);
    innerPayload.guardian = { id: 'IMPOSTER', name: 'Attacker' };
    const tamperedPayload = JSON.stringify(innerPayload);
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ payload: tamperedPayload, hmac: stored.hmac, nonce: stored.nonce }),
    );

    const loaded = await loadParentSession();
    expect(loaded).toBeNull();
    // Tampered entry should be cleared so the next call doesn't re-do the work.
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('rejects malformed JSON in sessionStorage (and removes the entry)', async () => {
    sessionStorage.setItem(SESSION_KEY, '{not valid json');
    const loaded = await loadParentSession();
    expect(loaded).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('returns null when stored shape is missing required fields', async () => {
    // Missing hmac + nonce — the early-return branch in loadParentSession.
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ payload: '{}' }));
    const loaded = await loadParentSession();
    expect(loaded).toBeNull();
  });

  describe('expiry', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('rejects sessions older than SESSION_TTL_MS', async () => {
      // Store at t0, then advance the clock past TTL and call load.
      await storeParentSession(guardian, student);

      // Sanity: load while still fresh.
      const fresh = await loadParentSession();
      expect(fresh).not.toBeNull();

      // Re-store so we have a known issuedAt.
      await storeParentSession(guardian, student);

      // Advance Date.now() past TTL (4h + 1ms). Use a Date.now spy rather
      // than fake timers so HMAC's underlying microtask scheduling stays real.
      const realNow = Date.now();
      const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + SESSION_TTL_MS + 1);

      const expired = await loadParentSession();
      expect(expired).toBeNull();
      // Expired entry should be cleared.
      expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();

      dateNowSpy.mockRestore();
    });
  });
});

describe('parent-session progressive lockout', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('initial state has zero attempts and is not locked', () => {
    const state = getLockoutState();
    expect(state).toEqual({ attempts: 0, lockedUntil: 0, lockoutLevel: 0 });
    expect(isLockedOut().locked).toBe(false);
  });

  it('records failed attempts without locking until threshold', () => {
    expect(MAX_ATTEMPTS_BEFORE_LOCKOUT).toBe(3);

    // First two attempts: no lockout message.
    expect(recordFailedAttempt()).toBeNull();
    expect(getLockoutState().attempts).toBe(1);

    expect(recordFailedAttempt()).toBeNull();
    expect(getLockoutState().attempts).toBe(2);

    expect(isLockedOut().locked).toBe(false);
  });

  it('triggers lockout after MAX_ATTEMPTS_BEFORE_LOCKOUT failures', () => {
    recordFailedAttempt();
    recordFailedAttempt();
    const lockoutMsg = recordFailedAttempt();

    expect(lockoutMsg).toMatch(/Locked for 3 minute/);
    const state = getLockoutState();
    // attempts reset, lockoutLevel incremented, lockedUntil in the future.
    expect(state.attempts).toBe(0);
    expect(state.lockoutLevel).toBe(1);
    expect(state.lockedUntil).toBeGreaterThan(Date.now());

    const lock = isLockedOut();
    expect(lock.locked).toBe(true);
    expect(lock.message).toMatch(/Account locked/);
  });

  it('escalates lockout duration on subsequent rounds (3 -> 5 -> 15 -> 60)', () => {
    expect(LOCKOUT_DURATIONS).toEqual([3 * 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]);

    // Round 1: 3 minutes.
    recordFailedAttempt(); recordFailedAttempt();
    expect(recordFailedAttempt()).toMatch(/Locked for 3 minute/);
    expect(getLockoutState().lockoutLevel).toBe(1);

    // Round 2: 5 minutes.
    recordFailedAttempt(); recordFailedAttempt();
    expect(recordFailedAttempt()).toMatch(/Locked for 5 minute/);
    expect(getLockoutState().lockoutLevel).toBe(2);

    // Round 3: 15 minutes.
    recordFailedAttempt(); recordFailedAttempt();
    expect(recordFailedAttempt()).toMatch(/Locked for 15 minute/);
    expect(getLockoutState().lockoutLevel).toBe(3);

    // Round 4: 60 minutes (= 1 hour).
    recordFailedAttempt(); recordFailedAttempt();
    expect(recordFailedAttempt()).toMatch(/Locked for 60 minute/);
    expect(getLockoutState().lockoutLevel).toBe(4);

    // Round 5+: caps at the last entry (60 min).
    recordFailedAttempt(); recordFailedAttempt();
    expect(recordFailedAttempt()).toMatch(/Locked for 60 minute/);
    expect(getLockoutState().lockoutLevel).toBe(5);
  });

  it('isLockedOut reports false once lockedUntil is in the past', () => {
    // Force a state where lockedUntil already expired.
    sessionStorage.setItem(
      LOCKOUT_KEY,
      JSON.stringify({ attempts: 0, lockedUntil: Date.now() - 1000, lockoutLevel: 1 }),
    );
    expect(isLockedOut().locked).toBe(false);
  });

  it('clearLockoutAttempts wipes the lockout state', () => {
    recordFailedAttempt();
    recordFailedAttempt();
    expect(sessionStorage.getItem(LOCKOUT_KEY)).not.toBeNull();

    clearLockoutAttempts();
    expect(sessionStorage.getItem(LOCKOUT_KEY)).toBeNull();
    expect(getLockoutState()).toEqual({ attempts: 0, lockedUntil: 0, lockoutLevel: 0 });
  });

  it('getLockoutState recovers gracefully from corrupt JSON', () => {
    sessionStorage.setItem(LOCKOUT_KEY, '{not valid');
    expect(getLockoutState()).toEqual({ attempts: 0, lockedUntil: 0, lockoutLevel: 0 });
  });
});
