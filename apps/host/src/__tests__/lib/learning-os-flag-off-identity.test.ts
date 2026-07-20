/**
 * Learning-OS OFF-path flag identity — the core safety guarantee.
 *
 * Every Alfa OS surface ships behind a DEFAULT-OFF flag whose contract is:
 * "the OFF path is byte-identical to today". The unit-testable slice of that
 * guarantee is:
 *
 *   1. The SYNCHRONOUS reader (getXxxOsFlagSync / getFlagSync via the hook's
 *      DEFAULT_OFF) resolves FALSE when there is no cache + no localStorage
 *      override. This is the production first-paint truth.
 *   2. The dev override (devForcedOn) is a STRICT no-op under
 *      process.env.NODE_ENV === 'production' and only returns TRUE when
 *      NODE_ENV !== 'production' AND the localStorage key is exactly '1'.
 *   3. FLAG_DEFAULTS contains every new OS flag = false.
 *
 * devForcedOn is not exported; it is exercised through the public sync reader,
 * which short-circuits to `true` the moment devForcedOn() is true. We flip
 * process.env.NODE_ENV per-case to assert the prod no-op vs dev-on behaviour.
 *
 * getFeatureFlags is mocked so importing the hooks never touches the network.
 *
 * Owning agent: testing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The sync readers never call getFeatureFlags(), but the hook modules import it
// at module load. Mock it to a never-resolving-by-default stub so the import is
// inert and no real Supabase client is constructed.
vi.mock('@alfanumrik/lib/supabase', () => ({
  getFeatureFlags: vi.fn(async () => ({})),
}));

import {
  getSubjectsOsFlagSync,
  clearSubjectsOsFlagCache,
} from '@alfanumrik/lib/use-subjects-os-flag';
import {
  getRevisionOsFlagSync,
  clearRevisionOsFlagCache,
} from '@alfanumrik/lib/use-revision-os-flag';
import {
  getPracticeOsFlagSync,
  clearPracticeOsFlagCache,
} from '@alfanumrik/lib/use-practice-os-flag';
import {
  getTestOsFlagSync,
  clearTestOsFlagCache,
} from '@alfanumrik/lib/use-test-os-flag';
import {
  FLAG_DEFAULTS,
  SUBJECTS_OS_FLAGS,
  REVISION_OS_FLAGS,
  PRACTICE_OS_FLAGS,
  TEST_OS_FLAGS,
  EDUCATION_INTELLIGENCE_FLAGS,
  PRINCIPAL_AI_FLAGS,
} from '@alfanumrik/lib/feature-flags';

// ── Each sync reader + its dev-force localStorage key + cache-clearer ──────────
// Note: student OS flag (ff_student_os_v1) is now always-on; its reader has
// been removed from this suite. Remaining readers cover the other OS surfaces.
const READERS = [
  {
    name: 'subjects',
    read: getSubjectsOsFlagSync,
    clear: clearSubjectsOsFlagCache,
    forceKey: 'alfanumrik_force_subjects_os',
    cacheKey: 'alfanumrik_subjects_os_flag_v1',
  },
  {
    name: 'revision',
    read: getRevisionOsFlagSync,
    clear: clearRevisionOsFlagCache,
    forceKey: 'alfanumrik_force_revision_os',
    cacheKey: 'alfanumrik_revision_os_flag_v1',
  },
  {
    name: 'practice',
    read: getPracticeOsFlagSync,
    clear: clearPracticeOsFlagCache,
    forceKey: 'alfanumrik_force_practice_os',
    cacheKey: 'alfanumrik_practice_os_flag_v1',
  },
  {
    name: 'test',
    read: getTestOsFlagSync,
    clear: clearTestOsFlagCache,
    forceKey: 'alfanumrik_force_test_os',
    cacheKey: 'alfanumrik_test_os_flag_v1',
  },
] as const;

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

describe('Learning-OS sync readers — DEFAULT_OFF (production first-paint truth)', () => {
  for (const r of READERS) {
    it(`${r.name}: resolves FALSE with no cache and no override (any env)`, () => {
      // Production: no dev override possible.
      setNodeEnv('production');
      expect(r.read()).toBe(false);
      // Non-production but no override key set: still OFF.
      setNodeEnv('test');
      expect(r.read()).toBe(false);
    });

    it(`${r.name}: a fresh cached { on:false } still reads FALSE`, () => {
      setNodeEnv('production');
      localStorage.setItem(r.cacheKey, JSON.stringify({ on: false, ts: Date.now() }));
      expect(r.read()).toBe(false);
    });

    it(`${r.name}: an expired cached { on:true } is ignored → FALSE`, () => {
      setNodeEnv('production');
      // ts older than the 5-minute TTL (feature-flag RCA: TTL cut from 1h to 5min).
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      localStorage.setItem(r.cacheKey, JSON.stringify({ on: true, ts: twoHoursAgo }));
      expect(r.read()).toBe(false);
    });

    it(`${r.name}: a fresh cached { on:true } reads TRUE (post-rollout repeat visit)`, () => {
      setNodeEnv('production');
      localStorage.setItem(r.cacheKey, JSON.stringify({ on: true, ts: Date.now() }));
      expect(r.read()).toBe(true);
    });
  }
});

describe('Learning-OS devForcedOn — strict production no-op', () => {
  for (const r of READERS) {
    it(`${r.name}: override key '1' is IGNORED in production (strict no-op)`, () => {
      setNodeEnv('production');
      localStorage.setItem(r.forceKey, '1');
      // No cache → DEFAULT_OFF wins because devForcedOn() short-circuited false.
      expect(r.read()).toBe(false);
    });

    it(`${r.name}: override key '1' forces TRUE only when NODE_ENV !== production`, () => {
      setNodeEnv('development');
      localStorage.setItem(r.forceKey, '1');
      expect(r.read()).toBe(true);
      setNodeEnv('test');
      expect(r.read()).toBe(true);
    });

    it(`${r.name}: override present but not exactly '1' does NOT force on`, () => {
      setNodeEnv('development');
      localStorage.setItem(r.forceKey, 'true'); // wrong value
      expect(r.read()).toBe(false);
      localStorage.setItem(r.forceKey, '0');
      expect(r.read()).toBe(false);
    });
  }
});

describe('Learning-OS cache clearers do not throw and reset to OFF', () => {
  for (const r of READERS) {
    it(`${r.name}: clear() removes a fresh ON cache so the reader returns FALSE`, () => {
      setNodeEnv('production');
      localStorage.setItem(r.cacheKey, JSON.stringify({ on: true, ts: Date.now() }));
      expect(r.read()).toBe(true);
      r.clear();
      expect(r.read()).toBe(false);
    });
  }
});

describe('FLAG_DEFAULTS — every Learning-OS + Track-2 flag defaults OFF', () => {
  // Note: ff_student_os_v1 is now always-on and its reader has been removed.
  const NEW_FLAGS: Record<string, string> = {
    'ff_subjects_os_v1': SUBJECTS_OS_FLAGS.V1,
    'ff_revision_os_v1': REVISION_OS_FLAGS.V1,
    'ff_practice_os_v1': PRACTICE_OS_FLAGS.V1,
    'ff_test_os_v1': TEST_OS_FLAGS.V1,
    'ff_education_intelligence': EDUCATION_INTELLIGENCE_FLAGS.V1,
    'ff_principal_ai_v1': PRINCIPAL_AI_FLAGS.V1,
  };

  for (const [literal, constVal] of Object.entries(NEW_FLAGS)) {
    it(`${literal}: registry constant matches the literal AND defaults false`, () => {
      expect(constVal).toBe(literal);
      expect(FLAG_DEFAULTS[constVal]).toBe(false);
      expect(FLAG_DEFAULTS[literal]).toBe(false);
    });
  }

  it('contains no Learning-OS flag accidentally defaulting to true', () => {
    for (const literal of Object.keys(NEW_FLAGS)) {
      expect(FLAG_DEFAULTS[literal]).not.toBe(true);
    }
  });
});
