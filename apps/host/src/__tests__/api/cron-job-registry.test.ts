import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
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
  it('keeps root and host Vercel config in sync', () => {
    expect(existsSync(repoPath('vercel.json'))).toBe(true);
    expect(existsSync(repoPath('apps/host/vercel.json'))).toBe(true);

    const rootVercel = readJson<VercelConfig>('vercel.json');
    const hostVercel = readJson<VercelConfig>('apps/host/vercel.json');

    expect(hostVercel).toEqual(rootVercel);
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
