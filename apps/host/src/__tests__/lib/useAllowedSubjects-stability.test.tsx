/**
 * useAllowedSubjects — referential-stability regression test.
 *
 * WHY THIS FILE EXISTS — pins the fix for the documented "infinite re-render
 * loop / flicker" bug:
 *
 *   Root cause: `useAllowedSubjects()` derived `subjects`, `unlocked`, `locked`
 *   via `data?.subjects ?? []` + `.filter()` and `refresh` as an inline closure
 *   — so it returned BRAND-NEW references on EVERY render. ~24 consumers
 *   (Foxy tutor, dashboard, quiz, leaderboard) put those values in
 *   useEffect / useMemo / useCallback dependency arrays. A fresh reference each
 *   render meant the dependency arrays never compared equal, which re-fired the
 *   effects → setState → re-render → fresh references → ... an infinite loop
 *   that surfaced as Foxy flicker and dashboard/quiz/leaderboard thrash.
 *
 *   Fix (src/lib/useAllowedSubjects.ts):
 *     subjects = useMemo(() => data?.subjects ?? [], [data])
 *     unlocked = useMemo(() => subjects.filter(s => !s.isLocked), [subjects])
 *     locked   = useMemo(() => subjects.filter(s =>  s.isLocked), [subjects])
 *     refresh  = useCallback(() => { mutate(); }, [mutate])
 *
 * This test is the exact contract that prevents that loop:
 *   A) stability     — unchanged SWR `data` => SAME (===) refs across rerenders
 *   B) correctness    — unlocked/locked partition matches isLocked
 *   C) invalidation  — new SWR `data` ref => NEW derived refs (recomputed)
 *
 * Regression catalog: this fits the catalog convention in
 * `.claude/regression-catalog.md` (next free id REG-70 as of 2026-05-24) as a
 * P7-adjacent UI-stability invariant. Catalog edit intentionally NOT performed
 * here per task scope.
 *
 * Mocking strategy mirrors the established pattern in
 * `src/__tests__/useAllowedSubjects.test.tsx` (mock the `swr` default export)
 * but uses a hoisted mutable holder so the test controls `data` between
 * renders while keeping `mutate` a STABLE vi.fn() (a fresh `mutate` each render
 * would defeat the useCallback identity check we are asserting).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Hoisted mutable holder: the test flips `swr.data` between renders. `mutate`
// is created once and reused so `refresh`'s useCallback dep is stable.
const swr = vi.hoisted(() => ({
  data: undefined as { subjects: Array<{ code: string; isLocked: boolean }> } | undefined,
  error: null as unknown,
  isLoading: false,
  mutate: vi.fn(),
}));

vi.mock('swr', () => ({
  default: () => ({
    data: swr.data,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: swr.mutate,
  }),
}));

// The hook imports `supabase` from '@alfanumrik/lib/supabase-client' for the fetcher's
// Bearer header. Under the mocked useSWR the fetcher never runs, but the import
// must still resolve — so we provide a minimal stub (no real network/auth).
vi.mock('@alfanumrik/lib/supabase-client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  },
}));

import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';

// A fixed data object reused across the stability + correctness tests. Reusing
// the SAME object reference is what lets the hook's `[data]` memo short-circuit.
const FIXED_DATA = {
  subjects: [
    { code: 'science', isLocked: false },
    { code: 'math', isLocked: true },
  ],
};

describe('useAllowedSubjects — referential stability (render-loop fix)', () => {
  beforeEach(() => {
    swr.error = null;
    swr.isLoading = false;
    swr.mutate.mockReset();
  });

  it('A: returns identical (===) subjects/unlocked/locked/refresh refs across rerenders when data is unchanged', () => {
    swr.data = FIXED_DATA;
    const { result, rerender } = renderHook(() => useAllowedSubjects());

    const first = {
      subjects: result.current.subjects,
      unlocked: result.current.unlocked,
      locked: result.current.locked,
      refresh: result.current.refresh,
    };

    // Re-render with the SAME swr.data object reference (unchanged data).
    rerender();

    // The contract that prevents the infinite loop: every derived value the
    // ~24 consumers depend on keeps its identity across renders.
    expect(result.current.subjects).toBe(first.subjects);
    expect(result.current.unlocked).toBe(first.unlocked);
    expect(result.current.locked).toBe(first.locked);
    expect(result.current.refresh).toBe(first.refresh);

    // Re-render a second time to be sure identity is stable beyond one rerender.
    rerender();
    expect(result.current.subjects).toBe(first.subjects);
    expect(result.current.unlocked).toBe(first.unlocked);
    expect(result.current.locked).toBe(first.locked);
    expect(result.current.refresh).toBe(first.refresh);
  });

  it('B: partitions subjects into unlocked (non-locked) and locked correctly', () => {
    swr.data = FIXED_DATA;
    const { result } = renderHook(() => useAllowedSubjects());

    expect(result.current.subjects.map((s) => s.code)).toEqual(['science', 'math']);
    expect(result.current.unlocked.map((s) => s.code)).toEqual(['science']);
    expect(result.current.locked.map((s) => s.code)).toEqual(['math']);
  });

  it('C: returns NEW refs when SWR data changes (memo invalidates on new data ref)', () => {
    swr.data = FIXED_DATA;
    const { result, rerender } = renderHook(() => useAllowedSubjects());

    const prevSubjects = result.current.subjects;
    const prevUnlocked = result.current.unlocked;
    const prevLocked = result.current.locked;

    // New `data` object reference with different contents.
    swr.data = {
      subjects: [
        { code: 'english', isLocked: false },
        { code: 'science', isLocked: false },
        { code: 'history', isLocked: true },
      ],
    };
    rerender();

    // Identity must change so consumers recompute against the new data.
    expect(result.current.subjects).not.toBe(prevSubjects);
    expect(result.current.unlocked).not.toBe(prevUnlocked);
    expect(result.current.locked).not.toBe(prevLocked);

    // ...and the new partition reflects the new data.
    expect(result.current.subjects.map((s) => s.code)).toEqual(['english', 'science', 'history']);
    expect(result.current.unlocked.map((s) => s.code)).toEqual(['english', 'science']);
    expect(result.current.locked.map((s) => s.code)).toEqual(['history']);
  });
});
