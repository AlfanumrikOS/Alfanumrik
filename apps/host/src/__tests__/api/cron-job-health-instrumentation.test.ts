import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface JobRegistryEntry {
  path: string;
  lastSuccessMetric: string;
}

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

function routeFileFor(path: string): string {
  return repoPath(`apps/host/src/app${path}/route.ts`);
}

describe('RCA-17 cron job-health instrumentation', () => {
  it('emits the registered last-success metric from every scheduled cron route', () => {
    const registry = JSON.parse(
      readFileSync(repoPath('scripts/job-registry.json'), 'utf8'),
    ) as { jobs: JobRegistryEntry[] };

    for (const job of registry.jobs) {
      const routeFile = routeFileFor(job.path);
      expect(existsSync(routeFile), `${job.path} route should exist`).toBe(true);
      const source = readFileSync(routeFile, 'utf8');

      expect(source, `${job.path} should import recordCronJobHealth`).toContain('recordCronJobHealth');
      expect(source, `${job.path} should emit ${job.lastSuccessMetric}`).toContain(job.lastSuccessMetric);
    }
  });
});
