import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

interface GradeNormalizationArtifact {
  id: string;
  rcaItem: 'RCA-11';
  kind: 'migration' | 'source_pin' | 'live_verifier' | 'read_path';
  path: string;
  owner: string;
  readinessRole: string;
  status: 'repo_guarded' | 'requires_environment';
  evidence: string[];
}

describe('grade normalization readiness manifest (RCA-11 / AO-10b)', () => {
  it('tracks row-backfill, write-path, read-path, and live verification evidence', () => {
    const manifestPath = repoPath('scripts/grade-normalization-readiness.json');
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      artifacts: GradeNormalizationArtifact[];
      remainingEnvironmentGate: string;
    };

    const required = new Set([
      'ao10b-grade-backfill-migration',
      'ao10b-source-shape-test',
      'grade-format-live-verifier',
      'auth-context-read-normalization',
    ]);
    const ids = new Set(manifest.artifacts.map((artifact) => artifact.id));
    for (const id of required) {
      expect(ids.has(id), `${id} missing from RCA-11 grade normalization manifest`).toBe(true);
    }

    expect(manifest.remainingEnvironmentGate).toMatch(/target DB/i);
    expect(manifest.remainingEnvironmentGate).toMatch(/migration/i);

    for (const artifact of manifest.artifacts) {
      expect(artifact.rcaItem).toBe('RCA-11');
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
