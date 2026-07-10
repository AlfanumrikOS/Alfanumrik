import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

type CertificationRole =
  | 'student'
  | 'teacher'
  | 'parent'
  | 'school_admin'
  | 'super_admin'
  | 'content_author'
  | 'support_staff';

interface CertificationRoleEntry {
  role: CertificationRole;
  spec: string;
  status: 'ready_to_run_when_gated' | 'known_gap_pinned';
  evidence: string[];
}

interface CertificationArtifact {
  id: string;
  rcaItem: 'RCA-20';
  path: string;
  readinessRole: string;
  evidence: string[];
}

interface CertificationReadinessManifest {
  source: string;
  rcaItem: 'RCA-20';
  liveRunStatus: 'gated_by_environment';
  command: string;
  roles: CertificationRoleEntry[];
  artifacts: CertificationArtifact[];
  blockers: string[];
}

const repoRoot = path.resolve(__dirname, '../../../..');
const repoPath = (relativePath: string) => path.join(repoRoot, relativePath);

const requiredRoles: CertificationRole[] = [
  'student',
  'teacher',
  'parent',
  'school_admin',
  'super_admin',
  'content_author',
  'support_staff',
];

const requiredArtifacts = [
  'playwright-certification-gate',
  'seed-certification-accounts',
  'teardown-certification-tenant',
  'payments-certification-gate',
  'certification-risk-register',
  'certification-traffic-traceability',
  'certification-rollback-procedure',
] as const;

describe('certification readiness manifest (RCA-20)', () => {
  it('pins the selected certification E2E suite, seed/teardown safety, and live blockers', () => {
    const manifestPath = repoPath('scripts/certification-readiness-manifest.json');
    expect(existsSync(manifestPath), 'missing scripts/certification-readiness-manifest.json').toBe(true);

    const manifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    ) as CertificationReadinessManifest;

    expect(manifest.rcaItem).toBe('RCA-20');
    expect(manifest.liveRunStatus).toBe('gated_by_environment');
    expect(manifest.command).toContain('CERTIFICATION_RUN_ENABLED=true');
    expect(manifest.command).toContain('playwright test e2e/certification');

    expect(manifest.blockers.join('\n')).toContain('CERT-17');
    expect(manifest.blockers.join('\n')).toContain('CERT-FE-01');
    expect(manifest.blockers.join('\n')).toContain('CERT-07');

    const rolesByName = new Map(manifest.roles.map((role) => [role.role, role]));
    expect([...rolesByName.keys()].sort()).toEqual([...requiredRoles].sort());

    for (const role of requiredRoles) {
      const entry = rolesByName.get(role);
      expect(entry, `missing certification role ${role}`).toBeDefined();
      expect(existsSync(repoPath(entry!.spec)), `${role} spec does not exist`).toBe(true);
      const source = readFileSync(repoPath(entry!.spec), 'utf8');
      expect(source).toContain('certificationSuiteEnabled');
      for (const snippet of entry!.evidence) {
        expect(source, `${role} spec missing evidence: ${snippet}`).toContain(snippet);
      }
    }

    const artifactIds = manifest.artifacts.map((artifact) => artifact.id).sort();
    expect(artifactIds).toEqual([...requiredArtifacts].sort());

    for (const artifact of manifest.artifacts) {
      expect(artifact.rcaItem).toBe('RCA-20');
      expect(existsSync(repoPath(artifact.path)), `${artifact.id} path does not exist`).toBe(true);
      const source = readFileSync(repoPath(artifact.path), 'utf8');
      for (const snippet of artifact.evidence) {
        expect(source, `${artifact.id} missing evidence: ${snippet}`).toContain(snippet);
      }
    }
  });
});
