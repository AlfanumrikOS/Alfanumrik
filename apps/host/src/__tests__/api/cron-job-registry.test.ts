import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Repo root, anchored once on a marker that exists ONLY at the root
 * (apps/host has its own scripts/ dir, but no job-registry.json in it).
 *
 * This replaces a PER-PATH fallback — `if (!existsSync(root/rel)) return
 * resolve(cwd, rel)` — which silently rewrote a missing repo-root path into an
 * apps/host-relative one. That is how the vercel.json assertion below used to
 * compare apps/host/vercel.json to ITSELF and could never fail: it asserted a
 * ROOT vercel.json must exist, while ci.yml's "Root vercel.json drift guard"
 * fails the build if one does. Two directly contradictory rules, both green,
 * because the fallback resolved both arguments to the same file.
 *
 * Anchoring the root once and resolving from it keeps the dual-cwd support
 * that fallback was there for (vitest runs from apps/host in CI, repo root
 * locally) without letting a missing file masquerade as a present one.
 */
const REPO_ROOT = ((): string => {
  const marker = join('scripts', 'job-registry.json');
  for (const base of [resolve(process.cwd(), '..', '..'), process.cwd()]) {
    if (existsSync(join(base, marker))) return base;
  }
  throw new Error(`cron-job-registry: cannot locate repo root from ${process.cwd()}`);
})();

function repoPath(rel: string): string {
  return resolve(REPO_ROOT, rel);
}

interface VercelCron {
  path: string;
  schedule: string;
}

interface VercelConfig {
  framework?: string;
  regions?: string[];
  functions?: Record<string, unknown>;
  crons: VercelCron[];
  cleanUrls?: boolean;
  trailingSlash?: boolean;
}

interface JobRegistryEntry {
  path: string;
  platform: 'vercel';
  owner: string;
  schedule: string;
  idempotencyKey: string;
  lastSuccessMetric: string;
  alertThreshold: string;
}

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(repoPath(rel), 'utf8')) as T;
}

describe('Vercel cron job registry (RCA-17)', () => {
  it('keeps apps/host/vercel.json the single deploy config', () => {
    // 7ce6e38a deleted the root copy ("byte-identical duplicate"; Vercel's
    // project root dir IS apps/host) and added the ci.yml drift guard that
    // fails the build when a root vercel.json reappears. Mirror that guard
    // here — the assertion this replaced demanded the opposite and only
    // passed because repoPath's old fallback aliased both paths to one file.
    expect(existsSync(repoPath('apps/host/vercel.json'))).toBe(true);
    expect(existsSync(repoPath('vercel.json'))).toBe(false);

    const hostVercel = readJson<VercelConfig>('apps/host/vercel.json');
    expect(Array.isArray(hostVercel.crons)).toBe(true);
    expect(hostVercel.crons.length).toBeGreaterThan(0);
  });

  it('has an operations registry for every scheduled Vercel cron path', () => {
    expect(existsSync(repoPath('scripts/job-registry.json'))).toBe(true);

    const vercel = readJson<VercelConfig>('apps/host/vercel.json');
    const registry = readJson<{ jobs: JobRegistryEntry[] }>('scripts/job-registry.json');

    const vercelByPath = new Map(vercel.crons.map((cron) => [cron.path, cron.schedule]));
    const registryByPath = new Map(registry.jobs.map((job) => [job.path, job]));

    expect([...vercelByPath.keys()].sort()).toEqual([...registryByPath.keys()].sort());

    for (const [path, schedule] of vercelByPath) {
      const job = registryByPath.get(path);
      expect(job, `${path} is missing from scripts/job-registry.json`).toBeDefined();
      expect(job?.platform).toBe('vercel');
      expect(job?.schedule).toBe(schedule);
      expect(job?.owner).toMatch(/\S/);
      expect(job?.idempotencyKey).toMatch(/\S/);
      expect(job?.lastSuccessMetric).toMatch(/\S/);
      expect(job?.alertThreshold).toMatch(/\S/);
    }
  });

  it('dry-runs the GitHub production cron runner for a registered path', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'alfanumrik-cron-runner-'));
    const summaryPath = join(tempDir, 'summary.json');
    const output = execFileSync(process.execPath, [repoPath('scripts/run-production-crons.mjs')], {
      cwd: repoPath('apps/host'),
      encoding: 'utf8',
      env: {
        ...process.env,
        CRON_RUNNER_SUMMARY_PATH: summaryPath,
        DRY_RUN: '1',
        JOB_PATH: '/api/cron/payments-health',
        TARGET_URL: 'https://example.invalid',
      },
    });

    expect(output).toContain('Production cron runner selector: path:/api/cron/payments-health');
    expect(output).toContain('[PASS] /api/cron/payments-health');

    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
      ok: boolean;
      dry_run: boolean;
      total_jobs: number;
      failed_jobs: number;
      results: Array<{ path: string; dry_run: boolean; ok: boolean }>;
    };

    expect(summary).toMatchObject({
      ok: true,
      dry_run: true,
      total_jobs: 1,
      failed_jobs: 0,
    });
    expect(summary.results[0]).toMatchObject({
      path: '/api/cron/payments-health',
      dry_run: true,
      ok: true,
    });
  });

  it('rejects manual all-job break-glass execution', () => {
    const result = spawnSync(process.execPath, [repoPath('scripts/run-production-crons.mjs')], {
      cwd: repoPath('apps/host'),
      encoding: 'utf8',
      env: { ...process.env, DRY_RUN: '1', GITHUB_EVENT_NAME: 'workflow_dispatch', JOB_PATH: 'all' },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('all is forbidden');
  });

  it('rejects a non-canonical live target before sending the cron secret', () => {
    const secret = 'must-not-leave-canonical-origin';
    const result = spawnSync(process.execPath, [repoPath('scripts/run-production-crons.mjs')], {
      cwd: repoPath('apps/host'),
      encoding: 'utf8',
      env: {
        ...process.env,
        DRY_RUN: '0',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        JOB_PATH: '/api/cron/payments-health',
        TARGET_URL: 'https://attacker.invalid',
        CRON_SECRET: secret,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('canonical https://alfanumrik.com origin');
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
  });

  it('exposes GET for every scheduled Vercel cron path', () => {
    const registry = readJson<{ jobs: JobRegistryEntry[] }>('scripts/job-registry.json');

    for (const job of registry.jobs) {
      const routePath = repoPath(`apps/host/src/app${job.path}/route.ts`);
      expect(existsSync(routePath), `${job.path} route should exist`).toBe(true);
      const source = readFileSync(routePath, 'utf8');

      const hasGetFunction = /export\s+async\s+function\s+GET\b/.test(source);
      const hasGetAlias = /export\s+const\s+GET\s*=/.test(source);
      expect(
        hasGetFunction || hasGetAlias,
        `${job.path} must export GET because Vercel Cron invokes scheduled paths with GET`,
      ).toBe(true);
    }
  });
});
