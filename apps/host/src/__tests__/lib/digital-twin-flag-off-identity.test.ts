/**
 * Digital-Twin OFF-path flag identity — the core safety guarantee for
 * `ff_digital_twin_v1` (Digital Twin + Knowledge Graph, Slice 1).
 *
 * Unlike the client Learning-OS surfaces (which ship a localStorage-backed
 * synchronous reader hook), the digital twin has NO client-rendered surface: it
 * is a server/edge behavior (cross-subject transfer-edge retrieval widening in
 * the grounded-answer pipeline, twin prompt context, the nightly snapshot cron,
 * and the additive concept_edges branches of detect_knowledge_gaps /
 * generate_learning_path). So its OFF-path identity is enforced in two places,
 * both pinned here:
 *
 *   1. The registry/SSR default. FLAG_DEFAULTS['ff_digital_twin_v1'] === false
 *      and DIGITAL_TWIN_FLAGS.V1 is the exact literal. While the flag row is
 *      absent (fresh/dev DB) BOTH read paths resolve OFF, so every flag-gated
 *      caller behaves byte-identically to today.
 *
 *   2. The Edge-Function reader `isDigitalTwinEnabled(sb)` is fail-CLOSED: only a
 *      DB row with `is_enabled === true` enables the behavior. A missing row, a
 *      non-true value, OR any thrown error (network/permission) resolves FALSE.
 *      It caches for a 60s TTL; `__resetTwinFlagCacheForTests()` clears it.
 *      This is the same fail-closed contract the foxy/learning sync readers pin
 *      on the client — adapted to the server flag's shape (the twin gates a
 *      retrieval-WIDENING behavior, so the safe default on an unreadable flag is
 *      "behave exactly like today" = no widening).
 *
 * Owning agent: testing.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { FLAG_DEFAULTS, DIGITAL_TWIN_FLAGS } from '@alfanumrik/lib/feature-flags';
import {
  isDigitalTwinEnabled,
  __resetTwinFlagCacheForTests,
} from '../../../supabase/functions/grounded-answer/_twin-flag';

// ── Minimal fake Supabase query builder for the single-row flag read ───────────
// Mirrors the chain the reader uses: sb.from(..).select(..).eq(..).single().
function makeSb(behavior: {
  data?: { is_enabled: unknown } | null;
  error?: unknown;
  throws?: boolean;
}) {
  let calls = 0;
  const sb = {
    get singleCalls() {
      return calls;
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async single() {
                  calls++;
                  if (behavior.throws) throw new Error('network down');
                  return { data: behavior.data ?? null, error: behavior.error ?? null };
                },
              };
            },
          };
        },
      };
    },
  };
  return sb;
}

beforeEach(() => {
  __resetTwinFlagCacheForTests();
});

describe('FLAG_DEFAULTS — ff_digital_twin_v1 defaults OFF', () => {
  it('DIGITAL_TWIN_FLAGS.V1 matches the literal AND defaults false', () => {
    expect(DIGITAL_TWIN_FLAGS.V1).toBe('ff_digital_twin_v1');
    expect(FLAG_DEFAULTS[DIGITAL_TWIN_FLAGS.V1]).toBe(false);
    expect(FLAG_DEFAULTS['ff_digital_twin_v1']).toBe(false);
  });

  it('does not accidentally default to true', () => {
    expect(FLAG_DEFAULTS['ff_digital_twin_v1']).not.toBe(true);
  });
});

describe('isDigitalTwinEnabled — default OFF + fail-CLOSED', () => {
  it('missing row (data === null) → FALSE', async () => {
    const sb = makeSb({ data: null });
    expect(await isDigitalTwinEnabled(sb)).toBe(false);
  });

  it('only is_enabled === true enables it (strict boolean true)', async () => {
    expect(await isDigitalTwinEnabled(makeSb({ data: { is_enabled: true } }))).toBe(
      true,
    );
  });

  it('non-true is_enabled values all resolve FALSE (no truthy coercion)', async () => {
    for (const v of [false, null, undefined, 1, 'true', 'on', {}]) {
      __resetTwinFlagCacheForTests();
      const sb = makeSb({ data: { is_enabled: v as unknown } });
      expect(await isDigitalTwinEnabled(sb)).toBe(false);
    }
  });

  it('fail-CLOSED: a thrown DB error → FALSE (never widens on an unreadable flag)', async () => {
    const sb = makeSb({ throws: true });
    expect(await isDigitalTwinEnabled(sb)).toBe(false);
  });

  it('fail-CLOSED: an error object in the response → still reads is_enabled (null) → FALSE', async () => {
    const sb = makeSb({ data: null, error: { message: 'rls denied' } });
    expect(await isDigitalTwinEnabled(sb)).toBe(false);
  });
});

describe('isDigitalTwinEnabled — 60s TTL cache', () => {
  it('caches within the TTL: a second read does not hit the DB again', async () => {
    const sb = makeSb({ data: { is_enabled: true } });
    expect(await isDigitalTwinEnabled(sb)).toBe(true);
    expect(await isDigitalTwinEnabled(sb)).toBe(true);
    expect(sb.singleCalls).toBe(1); // second call served from cache
  });

  it('caches the OFF value too (a fail-closed read is not retried every call)', async () => {
    const sb = makeSb({ throws: true });
    expect(await isDigitalTwinEnabled(sb)).toBe(false);
    expect(await isDigitalTwinEnabled(sb)).toBe(false);
    expect(sb.singleCalls).toBe(1);
  });

  it('__resetTwinFlagCacheForTests clears the cache so the next read re-queries', async () => {
    const onSb = makeSb({ data: { is_enabled: true } });
    expect(await isDigitalTwinEnabled(onSb)).toBe(true);
    __resetTwinFlagCacheForTests();
    const offSb = makeSb({ data: { is_enabled: false } });
    expect(await isDigitalTwinEnabled(offSb)).toBe(false);
    expect(offSb.singleCalls).toBe(1);
  });
});
