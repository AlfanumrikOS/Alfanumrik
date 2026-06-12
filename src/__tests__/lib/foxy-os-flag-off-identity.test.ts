/**
 * Foxy-OS OFF-path flag identity — the core safety guarantee for the
 * `ff_foxy_os_v1` mobile redesign of the /foxy AI tutor workspace.
 *
 * Mirrors `learning-os-flag-off-identity.test.ts`. Every Foxy-OS surface ships
 * behind a DEFAULT-OFF flag whose contract is: "the OFF path is byte-identical
 * to today's /foxy header on every viewport". The unit-testable slice of that
 * guarantee is:
 *
 *   1. The SYNCHRONOUS reader (getFoxyOsFlagSync) resolves FALSE when there is
 *      no cache + no localStorage override. This is the production first-paint
 *      truth — production users never get a flash of the redesign.
 *   2. The dev override (devForcedOn) is a STRICT no-op under
 *      process.env.NODE_ENV === 'production' and only returns TRUE when
 *      NODE_ENV !== 'production' AND the localStorage key
 *      `alfanumrik_force_foxy_os` is exactly '1'. This keeps the override
 *      commit-safe.
 *   3. The TTL cache under `alfanumrik_foxy_os_flag_v1` is honoured (fresh
 *      reads through, expired ignored) and clearFoxyOsFlagCache removes it.
 *   4. FLAG_DEFAULTS['ff_foxy_os_v1'] === false.
 *
 * devForcedOn is not exported; it is exercised through the public sync reader,
 * which short-circuits to `true` the moment devForcedOn() is true. We flip
 * process.env.NODE_ENV per-case to assert the prod no-op vs dev-on behaviour.
 *
 * getFeatureFlags is mocked so importing the hook never touches the network.
 *
 * Owning agent: testing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The sync reader never calls getFeatureFlags(), but the hook module imports it
// at module load. Mock it to an inert stub so the import constructs no real
// Supabase client.
vi.mock('@/lib/supabase', () => ({
  getFeatureFlags: vi.fn(async () => ({})),
}));

import {
  getFoxyOsFlagSync,
  clearFoxyOsFlagCache,
} from '@/lib/use-foxy-os-flag';
import { FLAG_DEFAULTS, FOXY_OS_FLAGS } from '@/lib/feature-flags';

const FORCE_KEY = 'alfanumrik_force_foxy_os'; // gitleaks:allow
const CACHE_KEY = 'alfanumrik_foxy_os_flag_v1'; // gitleaks:allow

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setNodeEnv(value: string) {
  // NODE_ENV is read-only-typed; assign through a cast so we can toggle it.
  (process.env as Record<string, string>).NODE_ENV = value;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  setNodeEnv(ORIGINAL_NODE_ENV ?? 'test');
  localStorage.clear();
});

describe('Foxy-OS sync reader — DEFAULT_OFF (production first-paint truth)', () => {
  it('resolves FALSE with no cache and no override (any env)', () => {
    setNodeEnv('production');
    expect(getFoxyOsFlagSync()).toBe(false);
    setNodeEnv('test');
    expect(getFoxyOsFlagSync()).toBe(false);
  });

  it('a fresh cached { on:false } still reads FALSE', () => {
    setNodeEnv('production');
    localStorage.setItem(CACHE_KEY, JSON.stringify({ on: false, ts: Date.now() }));
    expect(getFoxyOsFlagSync()).toBe(false);
  });

  it('an expired cached { on:true } is ignored → FALSE', () => {
    setNodeEnv('production');
    // ts older than the 1-hour TTL.
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ on: true, ts: twoHoursAgo }));
    expect(getFoxyOsFlagSync()).toBe(false);
  });

  it('a fresh cached { on:true } reads TRUE (post-rollout repeat visit)', () => {
    setNodeEnv('production');
    localStorage.setItem(CACHE_KEY, JSON.stringify({ on: true, ts: Date.now() }));
    expect(getFoxyOsFlagSync()).toBe(true);
  });

  it('a malformed cache entry is ignored → FALSE', () => {
    setNodeEnv('production');
    localStorage.setItem(CACHE_KEY, 'not-json');
    expect(getFoxyOsFlagSync()).toBe(false);
  });
});

describe('Foxy-OS devForcedOn — strict production no-op (commit-safe override)', () => {
  it("override key '1' is IGNORED in production (strict no-op)", () => {
    setNodeEnv('production');
    localStorage.setItem(FORCE_KEY, '1');
    // No cache → DEFAULT_OFF wins because devForcedOn() short-circuited false.
    expect(getFoxyOsFlagSync()).toBe(false);
  });

  it("override key '1' forces TRUE only when NODE_ENV !== production", () => {
    setNodeEnv('development');
    localStorage.setItem(FORCE_KEY, '1');
    expect(getFoxyOsFlagSync()).toBe(true);
    setNodeEnv('test');
    expect(getFoxyOsFlagSync()).toBe(true);
  });

  it('override wins over a fresh cached { on:false } in dev', () => {
    setNodeEnv('development');
    localStorage.setItem(CACHE_KEY, JSON.stringify({ on: false, ts: Date.now() }));
    localStorage.setItem(FORCE_KEY, '1');
    expect(getFoxyOsFlagSync()).toBe(true);
  });

  it("override present but not exactly '1' does NOT force on", () => {
    setNodeEnv('development');
    localStorage.setItem(FORCE_KEY, 'true'); // wrong value
    expect(getFoxyOsFlagSync()).toBe(false);
    localStorage.setItem(FORCE_KEY, '0');
    expect(getFoxyOsFlagSync()).toBe(false);
  });
});

describe('Foxy-OS cache clearer resets to OFF', () => {
  it('clear() removes a fresh ON cache so the reader returns FALSE', () => {
    setNodeEnv('production');
    localStorage.setItem(CACHE_KEY, JSON.stringify({ on: true, ts: Date.now() }));
    expect(getFoxyOsFlagSync()).toBe(true);
    clearFoxyOsFlagCache();
    expect(getFoxyOsFlagSync()).toBe(false);
  });

  it('clear() is a no-op (does not throw) when no cache exists', () => {
    expect(() => clearFoxyOsFlagCache()).not.toThrow();
    expect(getFoxyOsFlagSync()).toBe(false);
  });
});

describe('FLAG_DEFAULTS — ff_foxy_os_v1 defaults OFF', () => {
  it('FOXY_OS_FLAGS.V1 matches the literal AND defaults false', () => {
    expect(FOXY_OS_FLAGS.V1).toBe('ff_foxy_os_v1');
    expect(FLAG_DEFAULTS[FOXY_OS_FLAGS.V1]).toBe(false);
    expect(FLAG_DEFAULTS['ff_foxy_os_v1']).toBe(false);
  });

  it('does not accidentally default to true', () => {
    expect(FLAG_DEFAULTS['ff_foxy_os_v1']).not.toBe(true);
  });
});
