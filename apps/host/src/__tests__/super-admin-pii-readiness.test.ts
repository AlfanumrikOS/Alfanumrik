import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

interface SuperAdminPiiArtifact {
  id: string;
  rcaItem: 'RCA-14';
  path: string;
  owner: string;
  readinessRole: string;
  status: 'repo_guarded' | 'ops_follow_up';
  evidence: string[];
}

describe('super-admin PII readiness manifest (RCA-14 / SAO-1/5)', () => {
  it('tracks export tiering, egress redaction, regression pins, and ops notification state', () => {
    const manifestPath = repoPath('scripts/super-admin-pii-readiness.json');
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      decision: string;
      remainingOpsFollowUp: string;
      artifacts: SuperAdminPiiArtifact[];
    };

    expect(manifest.decision).toMatch(/super_admin/i);
    expect(manifest.remainingOpsFollowUp).toMatch(/notify/i);
    expect(manifest.remainingOpsFollowUp).toMatch(/lower-tier/i);

    const required = new Set([
      'reports-route-pii-tiering',
      'reports-pii-tier-regression',
      'observability-export-redaction',
      'observability-export-regression',
      'ops-redactor-barrel',
      'backlog-ops-notification',
    ]);
    const ids = new Set(manifest.artifacts.map((artifact) => artifact.id));
    for (const id of required) {
      expect(ids.has(id), `${id} missing from RCA-14 PII readiness manifest`).toBe(true);
    }

    for (const artifact of manifest.artifacts) {
      expect(artifact.rcaItem).toBe('RCA-14');
      expect(artifact.owner).toMatch(/\S/);
      expect(artifact.readinessRole).toMatch(/\S/);
      expect(artifact.evidence.length).toBeGreaterThan(0);
      expect(existsSync(repoPath(artifact.path)), `${artifact.id} path missing`).toBe(true);

      const source = readFileSync(repoPath(artifact.path), 'utf8');
      for (const snippet of artifact.evidence) {
        expect(source, `${artifact.id} missing evidence: ${snippet}`).toContain(snippet);
      }
    }
  });
});
