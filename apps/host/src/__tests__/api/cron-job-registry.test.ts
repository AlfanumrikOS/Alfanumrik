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
  it('has an operations registry for every scheduled Vercel cron path', () => {
    expect(existsSync(repoPath('scripts/job-registry.json'))).toBe(true);

    const vercel = readJson<{ crons: VercelCron[] }>('vercel.json');
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
});
