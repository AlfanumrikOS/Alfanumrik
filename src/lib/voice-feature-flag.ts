/**
 * voice-feature-flag.ts — Voice 2 client-side flag reader.
 *
 * Resolves whether THIS student should be routed to the Python Cloud Run
 * voice stack (Whisper STT + Azure neural TTS) for THIS session. Stable
 * within a session: we hash the student_id so the same student doesn't
 * flip between Python and Web Speech mid-chat.
 *
 * The hash function is PORTED byte-for-byte from
 *   supabase/functions/_shared/python-ai-proxy.ts:hashBucket
 *   supabase/functions/_shared/mol/feature-flag.ts:inRolloutBucket
 *
 * so server-side and client-side bucket calculations always agree. A future
 * server-side analytics join on bucket membership will produce identical
 * partitions.
 *
 * Safety contract (NEVER violate):
 *   - studentId null → always returns false (no anonymous voice routing).
 *   - flag fetch error → returns false. P12 forbids accidentally enabling
 *     on a transient flag-server outage.
 *   - kill_switch on → returns false even when rollout_pct = 100.
 *   - rollout_pct = 0 → returns false even when enabled = true.
 *
 * The hook does NOT decide whether to attempt the Python call — that's
 * src/lib/voice.ts. It only computes the per-student bucket eligibility.
 */

import useSWR from 'swr';

/** Shape mirrored from /api/feature-flags/voice. */
export interface VoiceFlagState {
  enabled: boolean;
  killSwitch: boolean;
  rolloutPct: number;
}

const FLAG_ENDPOINT = '/api/feature-flags/voice';

const SAFE_DEFAULT: VoiceFlagState = {
  enabled: false,
  killSwitch: false,
  rolloutPct: 0,
};

/**
 * Deterministic 0-99 bucket from a student_id. Identical xor-shift to
 * `supabase/functions/_shared/python-ai-proxy.ts:hashBucket` and
 * `supabase/functions/_shared/mol/feature-flag.ts:inRolloutBucket` so the
 * client and server compute the same bucket for the same input.
 *
 * Exported for unit tests; consumers should use `usePythonVoiceEnabled`.
 */
export function hashStudentBucket(studentId: string): number {
  let h = 0;
  for (let i = 0; i < studentId.length; i++) {
    h = ((h << 5) - h + studentId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}

async function fetchVoiceFlag(): Promise<VoiceFlagState> {
  try {
    const res = await fetch(FLAG_ENDPOINT, { cache: 'default' });
    if (!res.ok) return SAFE_DEFAULT;
    const data = (await res.json()) as Partial<VoiceFlagState>;
    return {
      enabled: data.enabled === true,
      killSwitch: data.killSwitch === true,
      rolloutPct:
        typeof data.rolloutPct === 'number' && Number.isFinite(data.rolloutPct)
          ? Math.max(0, Math.min(100, data.rolloutPct))
          : 0,
    };
  } catch {
    return SAFE_DEFAULT;
  }
}

/**
 * Pure decision function. Returns true iff:
 *   1. studentId is non-empty
 *   2. flag.enabled
 *   3. !flag.killSwitch
 *   4. hash(studentId) % 100 < flag.rolloutPct
 *
 * Exported for unit tests AND for the (rare) non-React caller that already
 * has a flag snapshot.
 */
export function decidePythonVoice(
  studentId: string | null | undefined,
  flag: VoiceFlagState,
): boolean {
  if (!studentId) return false;
  if (!flag.enabled) return false;
  if (flag.killSwitch) return false;
  if (!Number.isFinite(flag.rolloutPct) || flag.rolloutPct <= 0) return false;
  return hashStudentBucket(studentId) < flag.rolloutPct;
}

/**
 * Hook returning whether THIS student should use the Python voice stack
 * for THIS session.
 *
 * Stability:
 *   - Cached in SWR with a stable key (`voice-flag`) so all consumers in a
 *     page share one fetch.
 *   - Re-renders ONLY when the underlying flag envelope changes. The hash
 *     bucket is deterministic, so the same (studentId, flag) tuple always
 *     yields the same boolean.
 *   - On fetch error: SWR data === undefined → falls through to SAFE_DEFAULT
 *     → returns false. Never accidentally routes voice to Cloud Run.
 *
 * Anonymous (studentId === null) → returns false. No voice routing without
 * an authenticated student.
 */
export function usePythonVoiceEnabled(studentId: string | null): boolean {
  const { data } = useSWR<VoiceFlagState>(FLAG_ENDPOINT, fetchVoiceFlag, {
    // Match the route's 60s cache.
    dedupingInterval: 60_000,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    // Never retry on error — Web Speech is the safety net.
    shouldRetryOnError: false,
  });
  const flag = data ?? SAFE_DEFAULT;
  return decidePythonVoice(studentId, flag);
}
