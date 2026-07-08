/**
 * REG-44: IRT calibration cron schedule parity
 *
 * Pins the IRT 2PL recalibration cron schedule to a single source of truth
 * (`vercel.json`) so docs cannot drift from production reality.
 *
 * Background — there are TWO unrelated nightly jobs in this codebase that
 * are easy to confuse:
 *
 *   1. Vercel cron `/api/cron/irt-calibrate`
 *      - Runs at `50 2 * * *` (02:50 UTC = 08:20 IST)
 *      - Calls `recalibrate_question_irt_2pl(NULL, 30)` for IRT 2PL fits
 *      - Configured in `vercel.json` (this is what this test pins)
 *
 *   2. pg_cron `alfanumrik-daily-cron`
 *      - Runs at `30 18 * * *` (18:30 UTC = 00:00 IST midnight)
 *      - Hits the `daily-cron` Supabase Edge Function (streaks, leaderboards,
 *        parent digests, queue cleanup) — NOT IRT
 *      - Configured in `supabase/migrations/20260404000002_pg_cron_daily.sql`
 *
 * The constitution (`.claude/CLAUDE.md`) and IP-filing doc
 * (`docs/architecture/cognitive-model.md`) both cite the IRT cron at
 * 02:50 UTC, which matches `vercel.json`. This test is the static check
 * that locks the schedule string in place: if anyone moves the cron in
 * `vercel.json` without updating the docs (or vice-versa), this fails.
 *
 * Production reality (the live `vercel.json` deployed to Vercel) is the
 * source of truth. Docs follow.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Resolve from the repo root rather than from the test file so this is
// stable in both worktree and root checkouts.
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

interface VercelCronEntry {
  path: string;
  schedule: string;
}

interface VercelConfig {
  crons?: VercelCronEntry[];
}

function loadVercelConfig(): VercelConfig {
  const raw = readFileSync(resolve(REPO_ROOT, 'vercel.json'), 'utf8');
  return JSON.parse(raw) as VercelConfig;
}

describe('REG-44: IRT calibration cron schedule parity', () => {
  it('vercel.json registers exactly one /api/cron/irt-calibrate entry', () => {
    const config = loadVercelConfig();
    expect(Array.isArray(config.crons)).toBe(true);
    const matches = (config.crons ?? []).filter(
      (c) => c.path === '/api/cron/irt-calibrate',
    );
    expect(matches).toHaveLength(1);
  });

  it('IRT calibration cron runs at 02:50 UTC daily (`50 2 * * *`)', () => {
    const config = loadVercelConfig();
    const irt = (config.crons ?? []).find(
      (c) => c.path === '/api/cron/irt-calibrate',
    );
    expect(irt).toBeDefined();
    // Pinned schedule. Changing this requires updating:
    //   - .claude/CLAUDE.md (Foxy moat plan row)
    //   - docs/architecture/cognitive-model.md §4.4 + Appendix B
    //   - this test
    expect(irt!.schedule).toBe('50 2 * * *');
  });

  it('IRT cron schedule conforms to the 5-field cron format', () => {
    const config = loadVercelConfig();
    const irt = (config.crons ?? []).find(
      (c) => c.path === '/api/cron/irt-calibrate',
    );
    expect(irt).toBeDefined();
    const fields = irt!.schedule.split(/\s+/);
    expect(fields).toHaveLength(5);
    // minute=50, hour=2 — explicit, not wildcards or ranges
    expect(fields[0]).toBe('50');
    expect(fields[1]).toBe('2');
    // day-of-month, month, day-of-week all wildcard for "every day"
    expect(fields[2]).toBe('*');
    expect(fields[3]).toBe('*');
    expect(fields[4]).toBe('*');
  });

  it('IRT cron is scheduled AFTER daily-cron so quiz_responses are settled', () => {
    // Documented invariant: the IRT cron runs 20 minutes after daily-cron
    // so the day's quiz_responses rows are committed before recalibration
    // reads them. See cognitive-model.md §4.4.
    const config = loadVercelConfig();
    const daily = (config.crons ?? []).find(
      (c) => c.path === '/api/cron/daily-cron',
    );
    const irt = (config.crons ?? []).find(
      (c) => c.path === '/api/cron/irt-calibrate',
    );
    expect(daily?.schedule).toBe('30 2 * * *');
    expect(irt?.schedule).toBe('50 2 * * *');
    // 50 - 30 = 20 minute gap, both at hour 2 UTC.
    const [dailyMin, dailyHour] = daily!.schedule.split(/\s+/).map(Number);
    const [irtMin, irtHour] = irt!.schedule.split(/\s+/).map(Number);
    expect(irtHour).toBe(dailyHour);
    expect(irtMin - dailyMin).toBe(20);
  });

  it('the IRT cron route file documents the 02:50 UTC schedule', () => {
    // Belt-and-suspenders: the route source has a header comment citing the
    // schedule. If someone changes vercel.json without updating the route
    // header (or vice versa) the docs will drift. Pin both.
    const routeSrc = readFileSync(
      resolve(REPO_ROOT, 'src', 'app', 'api', 'cron', 'irt-calibrate', 'route.ts'),
      'utf8',
    );
    expect(routeSrc).toMatch(/02:50 UTC/);
    expect(routeSrc).toMatch(/\/api\/cron\/irt-calibrate/);
  });

  it('the unrelated pg_cron daily-cron migration is at 18:30 UTC, NOT 02:50 UTC', () => {
    // Anti-confusion guard. The pg_cron migration handles the streaks /
    // leaderboards / parent-digests Edge Function — it does NOT calibrate
    // IRT. If someone confuses the two and tries to "align" them, this
    // test fails and forces a re-read of the architecture.
    // Section 10 cleanup (2026-05-03): pre-baseline migrations were moved to
    // `supabase/migrations/_legacy/timestamped/`. Search both locations.
    const candidates = [
      resolve(REPO_ROOT, 'supabase', 'migrations', '20260404000002_pg_cron_daily.sql'),
      resolve(REPO_ROOT, 'supabase', 'migrations', '_legacy', 'timestamped', '20260404000002_pg_cron_daily.sql'),
    ];
    const migrationPath = candidates.find((p) => existsSync(p)) ?? candidates[0];
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/'30 18 \* \* \*'/);
    expect(sql).not.toMatch(/'50 2 \* \* \*'/);
    // The pg_cron job MUST NOT mention IRT — IRT lives in vercel.json only.
    expect(sql).not.toMatch(/irt/i);
  });
});
