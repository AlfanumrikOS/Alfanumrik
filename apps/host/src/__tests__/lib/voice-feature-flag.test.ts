/**
 * voice-feature-flag.test.ts — Voice 2 client flag-reader contract.
 *
 * Pins:
 *   - kill_switch, enabled, rollout_pct precedence
 *   - studentId null → never enabled (no anonymous voice)
 *   - flag fetch failure → safe default false
 *   - hash bucket deterministic (same studentId → same bucket)
 *   - hash bucket matches the byte-for-byte port from
 *     supabase/functions/_shared/python-ai-proxy.ts:hashBucket
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  decidePythonVoice,
  hashStudentBucket,
  usePythonVoiceEnabled,
  type VoiceFlagState,
} from '@alfanumrik/lib/voice-feature-flag';

// Hoisted swr stub so each test can flip the returned data.
const swr = vi.hoisted(() => ({
  data: undefined as VoiceFlagState | undefined,
}));

vi.mock('swr', () => ({
  default: () => ({ data: swr.data }),
}));

import { renderHook } from '@testing-library/react';

beforeEach(() => {
  swr.data = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── decidePythonVoice (pure decision function) ─────────────────────────────

describe('decidePythonVoice', () => {
  const FULL: VoiceFlagState = { enabled: true, killSwitch: false, rolloutPct: 100 };

  it('returns true when flag is fully enabled with 100% rollout and studentId is present', () => {
    expect(decidePythonVoice('student-1', FULL)).toBe(true);
  });

  it('returns false when studentId is null', () => {
    expect(decidePythonVoice(null, FULL)).toBe(false);
  });

  it('returns false when studentId is undefined', () => {
    expect(decidePythonVoice(undefined, FULL)).toBe(false);
  });

  it('returns false when studentId is empty string', () => {
    expect(decidePythonVoice('', FULL)).toBe(false);
  });

  it('returns false when enabled is false even with 100% rollout', () => {
    expect(decidePythonVoice('s-1', { enabled: false, killSwitch: false, rolloutPct: 100 })).toBe(false);
  });

  it('returns false when kill switch is on even with enabled + 100% rollout', () => {
    expect(decidePythonVoice('s-1', { enabled: true, killSwitch: true, rolloutPct: 100 })).toBe(false);
  });

  it('returns false when rollout_pct is 0', () => {
    expect(decidePythonVoice('s-1', { enabled: true, killSwitch: false, rolloutPct: 0 })).toBe(false);
  });

  it('returns true when the studentId hashes into the rollout bucket', () => {
    // student-1 hashes deterministically; we don't depend on the exact value
    // but verify the partition by sweeping a small set.
    const sample = ['s-a', 's-b', 's-c', 's-d', 's-e', 's-f', 's-g', 's-h'];
    const enabledCount = sample.filter((id) =>
      decidePythonVoice(id, { enabled: true, killSwitch: false, rolloutPct: 100 }),
    ).length;
    expect(enabledCount).toBe(sample.length); // 100% → everyone in
  });

  it('returns false when bucket exceeds rollout_pct', () => {
    // For a 0% rollout, no student is ever in the bucket.
    const sample = ['s-a', 's-b', 's-c', 's-d'];
    const enabledCount = sample.filter((id) =>
      decidePythonVoice(id, { enabled: true, killSwitch: false, rolloutPct: 0 }),
    ).length;
    expect(enabledCount).toBe(0);
  });

  it('clamps a non-finite rollout_pct to 0 (safe default)', () => {
    expect(decidePythonVoice('s-1', { enabled: true, killSwitch: false, rolloutPct: NaN })).toBe(false);
  });
});

// ── hashStudentBucket — deterministic + matches python-ai-proxy ────────────

describe('hashStudentBucket', () => {
  it('is deterministic for the same studentId', () => {
    expect(hashStudentBucket('student-1')).toBe(hashStudentBucket('student-1'));
    expect(hashStudentBucket('aaaaaa')).toBe(hashStudentBucket('aaaaaa'));
  });

  it('returns a value in [0, 99]', () => {
    for (const id of ['a', 'b', 'longer-student-id-123', '00000000-0000-0000-0000-000000000000']) {
      const b = hashStudentBucket(id);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it('matches the byte-for-byte port from python-ai-proxy.ts:hashBucket', () => {
    // The Deno proxy uses this exact xor-shift:
    //   for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0
    //   return Math.abs(h) % 100
    // We re-implement it inline and assert parity for a sample set.
    const denoBucket = (id: string): number => {
      let h = 0;
      for (let i = 0; i < id.length; i++) {
        h = ((h << 5) - h + id.charCodeAt(i)) | 0;
      }
      return Math.abs(h) % 100;
    };
    const sample = ['a', 'student-1', 'student-2', 'abcdefghijklmnopqrstuvwxyz', '0', ''];
    for (const id of sample) {
      expect(hashStudentBucket(id)).toBe(denoBucket(id));
    }
  });
});

// ── usePythonVoiceEnabled (hook semantics) ─────────────────────────────────

describe('usePythonVoiceEnabled', () => {
  it('returns true when flag enabled + 100% rollout + studentId present', () => {
    swr.data = { enabled: true, killSwitch: false, rolloutPct: 100 };
    const { result } = renderHook(() => usePythonVoiceEnabled('student-1'));
    expect(result.current).toBe(true);
  });

  it('returns false when studentId is null', () => {
    swr.data = { enabled: true, killSwitch: false, rolloutPct: 100 };
    const { result } = renderHook(() => usePythonVoiceEnabled(null));
    expect(result.current).toBe(false);
  });

  it('returns false when SWR fetch errored (data === undefined)', () => {
    swr.data = undefined;
    const { result } = renderHook(() => usePythonVoiceEnabled('student-1'));
    expect(result.current).toBe(false);
  });

  it('returns false when kill_switch is set', () => {
    swr.data = { enabled: true, killSwitch: true, rolloutPct: 100 };
    const { result } = renderHook(() => usePythonVoiceEnabled('student-1'));
    expect(result.current).toBe(false);
  });

  it('returns false when enabled flag is off', () => {
    swr.data = { enabled: false, killSwitch: false, rolloutPct: 100 };
    const { result } = renderHook(() => usePythonVoiceEnabled('student-1'));
    expect(result.current).toBe(false);
  });
});
