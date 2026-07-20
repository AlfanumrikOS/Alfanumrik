/**
 * flag-posture-canary cron registration pin (REG-286 companion).
 *
 * Static vercel.json check, same family as REG-44 (irt cron-schedule-parity):
 *   - the canary is registered exactly once, at `25 3 * * *` (03:25 UTC —
 *     off-peak IST, avoiding every minute used by the other crons at that
 *     hour), in BOTH the root vercel.json (deploy source of truth) and the
 *     apps/host mirror (their equality is separately enforced by
 *     cron-job-registry.test.ts);
 *   - adding the canary did NOT touch any pre-existing cron entry — the 13
 *     prior path→schedule pairs are pinned verbatim, including REG-44's
 *     irt-calibrate at `50 2 * * *`;
 *   - the canary is in scripts/job-registry.json (RCA-17 operations
 *     registry) with a matching schedule;
 *   - the route file exists, exports GET (Vercel Cron invokes GET), and its
 *     header documents the same schedule.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

interface VercelCron {
  path: string;
  schedule: string;
}

function crons(rel: string): VercelCron[] {
  return (JSON.parse(readFileSync(repoPath(rel), 'utf8')) as { crons: VercelCron[] }).crons;
}

const CANARY_PATH = '/api/cron/flag-posture-canary';
const CANARY_SCHEDULE = '25 3 * * *';

/** The 13 cron entries that existed BEFORE the canary — pinned verbatim. */
const PRE_EXISTING: Record<string, string> = {
  '/api/cron/school-operations': '0 2 * * *',
  '/api/cron/daily-cron': '30 2 * * *',
  '/api/cron/irt-calibrate': '50 2 * * *', // REG-44 pin — do not move
  '/api/cron/reconcile-payments': '*/30 * * * *',
  '/api/cron/payments-health': '*/10 * * * *',
  '/api/cron/expired-subscriptions': '15 */6 * * *',
  '/api/cron/account-purge': '0 4 * * *',
  '/api/cron/pre-debit-notice': '0 */6 * * *',
  '/api/cron/board-score': '0 3 * * *',
  '/api/cron/reverify-domains': '45 3 * * *',
  '/api/cron/foxy-quality-sample': '40 3 * * *',
  '/api/internal/cron/fix-failed-questions': '*/15 * * * *',
  '/api/cron/streak-guardian': '30 16 * * *',
};

describe.each(['vercel.json', 'apps/host/vercel.json'])(
  'flag-posture-canary cron pin — %s',
  (file) => {
    const entries = crons(file);

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

    it('every pre-existing cron entry is untouched (all 13 pinned path→schedule pairs)', () => {
      const byPath = new Map(entries.map((c) => [c.path, c.schedule]));
      for (const [path, schedule] of Object.entries(PRE_EXISTING)) {
        expect(byPath.get(path), path).toBe(schedule);
      }
      // Exactly 13 pre-existing + the canary — nothing dropped, nothing extra.
      expect(entries).toHaveLength(14);
    });

    it('the canary does not collide with another cron at the same minute+hour', () => {
      const sameSlot = entries.filter(
        (c) => c.path !== CANARY_PATH && c.schedule === CANARY_SCHEDULE,
      );
      expect(sameSlot).toEqual([]);
    });
  },
);

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
