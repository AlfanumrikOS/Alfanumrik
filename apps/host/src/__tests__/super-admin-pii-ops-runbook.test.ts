import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function repoPath(rel: string): string {
  for (const candidate of [
    resolve(process.cwd(), '..', '..', rel),
    resolve(process.cwd(), rel),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return resolve(process.cwd(), '..', '..', rel);
}

describe('RCA-14 lower-tier PII export notification runbook', () => {
  it('pins the operator notification, audit review, and no-loosening guard', () => {
    const runbookPath = repoPath('docs/runbooks/super-admin-pii-export-notification.md');
    expect(existsSync(runbookPath)).toBe(true);

    const runbook = readFileSync(runbookPath, 'utf8');

    expect(runbook).toContain('RCA-14');
    expect(runbook).toContain('lower-tier exporters');
    expect(runbook).toContain('students');
    expect(runbook).toContain('teachers');
    expect(runbook).toContain('parents');
    expect(runbook).toContain('audit');
    expect(runbook).toContain('super_admin');
    expect(runbook).toContain('HTTP 403');
    expect(runbook).toContain('SELECT');
    expect(runbook).toContain('admin_audit_log');
    expect(runbook).toContain('super-admin/reports');
    expect(runbook).toContain('Do not loosen');
  });

  it('is linked from the RCA-14 readiness manifest as an ops follow-up artifact', () => {
    const manifest = JSON.parse(
      readFileSync(repoPath('scripts/super-admin-pii-readiness.json'), 'utf8'),
    ) as {
      artifacts: Array<{
        id: string;
        path: string;
        status: string;
        evidence: string[];
      }>;
    };

    const artifact = manifest.artifacts.find((entry) => entry.id === 'lower-tier-exporter-notification-runbook');
    expect(artifact).toBeDefined();
    expect(artifact?.path).toBe('docs/runbooks/super-admin-pii-export-notification.md');
    expect(artifact?.status).toBe('ops_follow_up');
    expect(artifact?.evidence).toEqual(
      expect.arrayContaining([
        'lower-tier exporters',
        'admin_audit_log',
        'Do not loosen',
      ]),
    );
  });
});
