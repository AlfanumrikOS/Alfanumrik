import { describe, expect, it } from 'vitest';
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
