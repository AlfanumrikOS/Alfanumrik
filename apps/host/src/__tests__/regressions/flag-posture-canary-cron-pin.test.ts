/**
 * flag-posture-canary cron registration pin (REG-286 companion).
 *
 * Static vercel.json check, same family as REG-44 (irt cron-schedule-parity):
 *   - the canary is registered exactly once, at `25 3 * * *` (03:25 UTC —
 *     off-peak IST, avoiding every minute used by the other crons at that
 *     hour), in apps/host/vercel.json — the single deploy config;
 *   - adding the canary did NOT touch any pre-existing cron entry — the
 *     prior path→schedule pairs are pinned verbatim, including REG-44's
 *     irt-calibrate at `50 2 * * *`;
 *
 * 2026-09-01: this suite used to run via
 * `describe.each(['vercel.json', 'apps/host/vercel.json'])` against "the root
 * deploy source of truth and the apps/host mirror". There is no root
 * vercel.json — 7ce6e38a deleted it as a byte-identical duplicate and added
 * ci.yml's "Root vercel.json drift guard" — so repoPath's old per-path
 * fallback silently resolved BOTH names to apps/host/vercel.json and the
 * suite ran twice over one file, reporting doubled results that looked like
 * two-config coverage. Now anchored on the repo root and run once against the
 * real file. (Same defect and fix as cron-job-registry.test.ts.)
 *   - the canary is in scripts/job-registry.json (RCA-17 operations
 *     registry) with a matching schedule;
 *   - the route file exists, exports GET (Vercel Cron invokes GET), and its
 *     header documents the same schedule.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Repo root, anchored once on a root-only marker — see the header note. */
const REPO_ROOT = ((): string => {
  // join, NOT resolve — resolve('scripts', …) yields an absolute path, which
  // would make resolve(base, marker) ignore `base` and re-check one location.
  const marker = join('scripts', 'job-registry.json');
  for (const base of [resolve(process.cwd(), '..', '..'), process.cwd()]) {
    if (existsSync(join(base, marker))) return base;
  }
  throw new Error(`flag-posture-canary cron pin: cannot locate repo root from ${process.cwd()}`);
})();

function repoPath(rel: string): string {
  return resolve(REPO_ROOT, rel);
}

/** The single deploy config. A root vercel.json must not exist (ci.yml guard). */
const VERCEL_CONFIG = 'apps/host/vercel.json';

interface VercelCron {
  path: string;
  schedule: string;
}

function crons(rel: string): VercelCron[] {
  return (JSON.parse(readFileSync(repoPath(rel), 'utf8')) as { crons: VercelCron[] }).crons;
}

const CANARY_PATH = '/api/cron/flag-posture-canary';
const CANARY_SCHEDULE = '25 3 * * *';

/**
 * The cron entries that existed BEFORE the canary and are STILL scheduled —
 * pinned verbatim. This list shrinks only on a deliberate, documented
 * retirement; a path vanishing from vercel.json without being removed here is
 * the accident this pin exists to catch.
 *
 * Retirements so far:
 *   /api/cron/account-purge                 2026-08-30, with the DPDP erasure
 *     subsystem (supabase/migrations/20260830172610_remove_dpdp_erasure_system.sql).
 *   /api/cron/foxy-quality-sample           2026-09-01, unattended Anthropic
 *   /api/internal/cron/fix-failed-questions 2026-09-01, spend disabled on the
 *     CEO's instruction. Route handlers are intact and still manually
 *     invocable — only the schedules are gone.
 */
const PRE_EXISTING: Record<string, string> = {
  '/api/cron/school-operations': '0 2 * * *',
  '/api/cron/daily-cron': '30 2 * * *',
  '/api/cron/irt-calibrate': '50 2 * * *', // REG-44 pin — do not move
  '/api/cron/reconcile-payments': '*/30 * * * *',
  '/api/cron/payments-health': '*/10 * * * *',
  '/api/cron/expired-subscriptions': '15 */6 * * *',
  '/api/cron/pre-debit-notice': '0 */6 * * *',
  '/api/cron/board-score': '0 3 * * *',
  '/api/cron/reverify-domains': '45 3 * * *',
  '/api/cron/streak-guardian': '30 16 * * *',
};

/**
 * Paths deliberately retired above. Pinned as ABSENT so a silent
 * reintroduction — the exact failure mode that let the spend run unnoticed —
 * fails here rather than on the next invoice.
 */
const RETIRED_PATHS = [
  '/api/cron/foxy-quality-sample',
  '/api/internal/cron/fix-failed-questions',
  '/api/cron/synthesis-quality-sample',
];

describe(`flag-posture-canary cron pin — ${VERCEL_CONFIG}`, () => {
  {
    const entries = crons(VERCEL_CONFIG);

    it('registers the canary exactly once at 25 3 * * * (03:25 UTC daily)', () => {
      const matches = entries.filter((c) => c.path === CANARY_PATH);
      expect(matches).toHaveLength(1);
      expect(matches[0].schedule).toBe(CANARY_SCHEDULE);
    });

    it('canary schedule is 5-field with explicit minute 25 / hour 3 (no wildcards in time-of-day)', () => {
      const fields = CANARY_SCHEDULE.split(/\s+/);
      expect(fields).toHaveLength(5);
      expect(fields[0]).toBe('25');
      expect(fields[1]).toBe('3');
      expect(fields.slice(2)).toEqual(['*', '*', '*']);
    });

    it('every still-scheduled pre-existing cron entry is untouched', () => {
      const byPath = new Map(entries.map((c) => [c.path, c.schedule]));
      for (const [path, schedule] of Object.entries(PRE_EXISTING)) {
        expect(byPath.get(path), path).toBe(schedule);
      }
      // Floor, not an exact count — the list legitimately grows as new crons
      // land, and an exact total is a brittle merge race. Derived from
      // PRE_EXISTING so it cannot go stale the way the old hardcoded 14 did
      // (that number already disagreed with the 12-entry map beneath it).
      expect(entries.length).toBeGreaterThanOrEqual(Object.keys(PRE_EXISTING).length + 1);
    });

    it('retired cron paths stay unscheduled', () => {
      const paths = entries.map((c) => c.path);
      for (const retired of RETIRED_PATHS) {
        expect(paths, `${retired} must not be re-scheduled`).not.toContain(retired);
      }
    });

    it('the canary does not collide with another cron at the same minute+hour', () => {
      const sameSlot = entries.filter(
        (c) => c.path !== CANARY_PATH && c.schedule === CANARY_SCHEDULE,
      );
      expect(sameSlot).toEqual([]);
    });
  }
});

describe('flag-posture-canary cron pin — operations registry + route', () => {
  it('scripts/job-registry.json carries the canary with a matching schedule (RCA-17)', () => {
    const registry = JSON.parse(readFileSync(repoPath('scripts/job-registry.json'), 'utf8')) as {
      jobs: Array<{ path: string; platform: string; schedule: string; owner: string }>;
    };
    const job = registry.jobs.find((j) => j.path === CANARY_PATH);
    expect(job, 'canary missing from scripts/job-registry.json').toBeDefined();
    expect(job?.platform).toBe('vercel');
    expect(job?.schedule).toBe(CANARY_SCHEDULE);
    expect(job?.owner).toMatch(/\S/);
  });

  it('the route file exists, exports GET (Vercel Cron invokes GET), and documents 25 3 * * *', () => {
    const routeFile = repoPath('apps/host/src/app/api/cron/flag-posture-canary/route.ts');
    expect(existsSync(routeFile)).toBe(true);
    const src = readFileSync(routeFile, 'utf8');
    expect(src).toMatch(/export\s+async\s+function\s+GET\b/);
    expect(src).toMatch(/25 3 \* \* \*/);
  });
});
