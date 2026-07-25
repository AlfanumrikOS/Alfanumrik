/**
 * useGenAiContentFlags — DEFAULT-OFF identity for the two student-facing GenAI
 * generation flags surfaced inside the /foxy workspace.
 *
 *   ff_content_generation_v1 → the "Diagram" affordance
 *   ff_lesson_generation_v1  → the "Lesson notes" affordance
 *
 * This is the P10/no-op safety pin for the FIRST user-visible surface of the
 * Lesson + Content(Diagram) GenAI agents. The contract is:
 *
 *   1. First paint with no cache resolves BOTH to false — production students
 *      never get a flash of an un-ramped surface.
 *   2. An unavailable / throwing flag source keeps the value OFF (fail-closed).
 *   3. The two flags resolve INDEPENDENTLY — either can be ON while the other
 *      is OFF (they ramp on separate schedules).
 *   4. The dev override is a STRICT no-op under NODE_ENV === 'production'.
 *   5. The 5-minute TTL cache is honoured (fresh reads through, expired
 *      ignored, corrupt ignored) and the clear helper removes it.
 *   6. The hook reads its flag constants from the flags REGISTRY module, not
 *      from the `feature-flags` barrel (the barrel is vi.mock'ed by the
 *      existing Foxy tests; importing it here would break them).
 *
 * `getFeatureFlags` is mocked so importing the hook never constructs a real
 * Supabase client or touches the network.
 *
 * Owning agent: testing. Under test: frontend (hook) + ops (flag registry).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

const getFeatureFlagsMock = vi.fn(async () => ({}) as Record<string, boolean>);

vi.mock('@alfanumrik/lib/supabase', () => ({
  getFeatureFlags: (...args: unknown[]) =>
    (getFeatureFlagsMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

import {
  useGenAiContentFlags,
  getGenAiContentFlagsSync,
  clearGenAiContentFlagsCache,
  GENAI_CONTENT_FLAGS_DEFAULT,
} from '@/app/foxy/_hooks/useGenAiContentFlags';
import {
  CONTENT_GENERATION_FLAGS,
  LESSON_GENERATION_FLAGS,
} from '@alfanumrik/lib/flags/registries/foxy';

const CACHE_KEY = 'alfanumrik_genai_content_flags_v1'; // gitleaks:allow
const FORCE_KEY = 'alfanumrik_force_genai_content'; // gitleaks:allow

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setNodeEnv(value: string) {
  // NODE_ENV is read-only-typed; assign through a cast so we can toggle it.
  (process.env as Record<string, string>).NODE_ENV = value;
}

beforeEach(() => {
  localStorage.clear();
  getFeatureFlagsMock.mockReset();
  getFeatureFlagsMock.mockResolvedValue({});
});

afterEach(() => {
  setNodeEnv(ORIGINAL_NODE_ENV ?? 'test');
  localStorage.clear();
});

// ── 1. Flag identity ─────────────────────────────────────────────────────────

describe('Foxy GenAI content flags — flag identity', () => {
  it('pins the two flag names to the registry values', () => {
    expect(CONTENT_GENERATION_FLAGS.V1).toBe('ff_content_generation_v1');
    expect(LESSON_GENERATION_FLAGS.V1).toBe('ff_lesson_generation_v1');
  });

  it('declares BOTH defaults as false', () => {
    expect(GENAI_CONTENT_FLAGS_DEFAULT).toEqual({ diagram: false, lesson: false });
  });

  it('imports its flag constants from the REGISTRY module, never the feature-flags barrel', () => {
    const source = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../app/foxy/_hooks/useGenAiContentFlags.ts',
      ),
      'utf8',
    );
    expect(source).toContain("@alfanumrik/lib/flags/registries/foxy");
    // The barrel pulls server-side flag machinery and is vi.mock'ed by the
    // existing Foxy suite — importing it here would break those 400+ tests.
    expect(source).not.toMatch(/from\s+['"]@alfanumrik\/lib\/feature-flags['"]/);
  });
});

// ── 2. Synchronous first paint (production truth) ────────────────────────────

describe('Foxy GenAI content flags — synchronous first paint is OFF', () => {
  it('resolves BOTH false with no cache and no override (production)', () => {
    setNodeEnv('production');
    expect(getGenAiContentFlagsSync()).toEqual({ diagram: false, lesson: false });
  });

  it('resolves BOTH false with no cache and no override (test env)', () => {
    setNodeEnv('test');
    expect(getGenAiContentFlagsSync()).toEqual({ diagram: false, lesson: false });
  });

  it('reads a FRESH cache through, per-flag', () => {
    setNodeEnv('production');
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ diagram: true, lesson: false, ts: Date.now() }),
    );
    expect(getGenAiContentFlagsSync()).toEqual({ diagram: true, lesson: false });
  });

  it('ignores an EXPIRED cache (>5 min) and falls back to OFF', () => {
    setNodeEnv('production');
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        diagram: true,
        lesson: true,
        ts: Date.now() - (5 * 60 * 1000 + 1),
      }),
    );
    expect(getGenAiContentFlagsSync()).toEqual({ diagram: false, lesson: false });
  });

  it('ignores a CORRUPT cache payload and falls back to OFF', () => {
    setNodeEnv('production');
    localStorage.setItem(CACHE_KEY, '{not-json');
    expect(getGenAiContentFlagsSync()).toEqual({ diagram: false, lesson: false });
  });

  it('ignores a cache with no timestamp and falls back to OFF', () => {
    setNodeEnv('production');
    localStorage.setItem(CACHE_KEY, JSON.stringify({ diagram: true, lesson: true }));
    expect(getGenAiContentFlagsSync()).toEqual({ diagram: false, lesson: false });
  });

  it('clearGenAiContentFlagsCache removes the cached value', () => {
    setNodeEnv('production');
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ diagram: true, lesson: true, ts: Date.now() }),
    );
    clearGenAiContentFlagsCache();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    expect(getGenAiContentFlagsSync()).toEqual({ diagram: false, lesson: false });
  });
});

// ── 3. Dev override is commit-safe ───────────────────────────────────────────

describe('Foxy GenAI content flags — dev override', () => {
  it('is a STRICT no-op under NODE_ENV=production', () => {
    setNodeEnv('production');
    localStorage.setItem(FORCE_KEY, '1');
    expect(getGenAiContentFlagsSync()).toEqual({ diagram: false, lesson: false });
  });

  it("forces BOTH on for '1' outside production", () => {
    setNodeEnv('development');
    localStorage.setItem(FORCE_KEY, '1');
    expect(getGenAiContentFlagsSync()).toEqual({ diagram: true, lesson: true });
  });

  it("forces ONLY diagram for 'diagram'", () => {
    setNodeEnv('development');
    localStorage.setItem(FORCE_KEY, 'diagram');
    expect(getGenAiContentFlagsSync()).toEqual({ diagram: true, lesson: false });
  });

  it("forces ONLY lesson for 'lesson'", () => {
    setNodeEnv('development');
    localStorage.setItem(FORCE_KEY, 'lesson');
    expect(getGenAiContentFlagsSync()).toEqual({ diagram: false, lesson: true });
  });

  it('ignores an unrecognised override value', () => {
    setNodeEnv('development');
    localStorage.setItem(FORCE_KEY, 'yes-please');
    expect(getGenAiContentFlagsSync()).toEqual({ diagram: false, lesson: false });
  });
});

// ── 4. Hook: async reconcile, fail-closed, independent ramps ─────────────────

describe('Foxy GenAI content flags — useGenAiContentFlags hook', () => {
  it('starts OFF and stays OFF when the flag map has neither flag', async () => {
    setNodeEnv('production');
    getFeatureFlagsMock.mockResolvedValue({ ff_something_else: true });
    const { result } = renderHook(() => useGenAiContentFlags());
    expect(result.current).toEqual({ diagram: false, lesson: false });
    await waitFor(() => expect(getFeatureFlagsMock).toHaveBeenCalled());
    expect(result.current).toEqual({ diagram: false, lesson: false });
  });

  it('stays OFF when the flag source THROWS (fail-closed)', async () => {
    setNodeEnv('production');
    getFeatureFlagsMock.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useGenAiContentFlags());
    await waitFor(() => expect(getFeatureFlagsMock).toHaveBeenCalled());
    expect(result.current).toEqual({ diagram: false, lesson: false });
  });

  it('stays OFF when the flag source resolves undefined (unavailable)', async () => {
    setNodeEnv('production');
    getFeatureFlagsMock.mockResolvedValue(
      undefined as unknown as Record<string, boolean>,
    );
    const { result } = renderHook(() => useGenAiContentFlags());
    await waitFor(() => expect(getFeatureFlagsMock).toHaveBeenCalled());
    expect(result.current).toEqual({ diagram: false, lesson: false });
  });

  it('turns ONLY diagram on when only ff_content_generation_v1 is enabled', async () => {
    setNodeEnv('production');
    getFeatureFlagsMock.mockResolvedValue({
      [CONTENT_GENERATION_FLAGS.V1]: true,
      [LESSON_GENERATION_FLAGS.V1]: false,
    });
    const { result } = renderHook(() => useGenAiContentFlags());
    await waitFor(() =>
      expect(result.current).toEqual({ diagram: true, lesson: false }),
    );
  });

  it('turns ONLY lesson on when only ff_lesson_generation_v1 is enabled', async () => {
    setNodeEnv('production');
    getFeatureFlagsMock.mockResolvedValue({
      [CONTENT_GENERATION_FLAGS.V1]: false,
      [LESSON_GENERATION_FLAGS.V1]: true,
    });
    const { result } = renderHook(() => useGenAiContentFlags());
    await waitFor(() =>
      expect(result.current).toEqual({ diagram: false, lesson: true }),
    );
  });

  it('CORRECTS a stale ON cache back to OFF when the DB says off', async () => {
    setNodeEnv('production');
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ diagram: true, lesson: true, ts: Date.now() }),
    );
    getFeatureFlagsMock.mockResolvedValue({});
    const { result } = renderHook(() => useGenAiContentFlags());
    // Optimistic first paint uses the cache…
    expect(result.current).toEqual({ diagram: true, lesson: true });
    // …then the DB truth wins.
    await waitFor(() =>
      expect(result.current).toEqual({ diagram: false, lesson: false }),
    );
  });

  it('writes the reconciled value back to the TTL cache', async () => {
    setNodeEnv('production');
    getFeatureFlagsMock.mockResolvedValue({
      [CONTENT_GENERATION_FLAGS.V1]: true,
    });
    renderHook(() => useGenAiContentFlags());
    await waitFor(() => {
      const raw = localStorage.getItem(CACHE_KEY);
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw as string);
      expect(parsed.diagram).toBe(true);
      expect(parsed.lesson).toBe(false);
      expect(typeof parsed.ts).toBe('number');
    });
  });

  it('reads the whole flag map in ONE call (no per-flag round trip)', async () => {
    setNodeEnv('production');
    getFeatureFlagsMock.mockResolvedValue({});
    renderHook(() => useGenAiContentFlags());
    await waitFor(() => expect(getFeatureFlagsMock).toHaveBeenCalled());
    expect(getFeatureFlagsMock).toHaveBeenCalledTimes(1);
  });
});
