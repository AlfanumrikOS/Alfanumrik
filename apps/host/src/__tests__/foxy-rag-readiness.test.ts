import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

interface FoxyRagReadinessArtifact {
  id: string;
  rcaItem: 'RCA-13';
  path: string;
  owner: string;
  readinessRole: string;
  status: 'repo_guarded' | 'follow_up';
  evidence: string[];
}

describe('Foxy/RAG readiness manifest (RCA-13)', () => {
  it('tracks grounded-answer safety, streaming behavior, fallback state, and follow-ups', () => {
    const manifestPath = repoPath('scripts/foxy-rag-readiness.json');
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      remainingFollowUps: string[];
      artifacts: FoxyRagReadinessArtifact[];
    };

    expect(manifest.remainingFollowUps.join(' ')).not.toMatch(/FOX-7/i);
    expect(manifest.remainingFollowUps.join(' ')).not.toMatch(/streaming residual/i);
    expect(manifest.remainingFollowUps.join(' ')).not.toMatch(/Hindi/i);

    const required = new Set([
      'grounded-output-backstop',
      'legacy-fallback-output-backstop',
      'streaming-first-paint-output-backstop',
      'hindi-token-output-screen',
      'streaming-contract',
      'json-fallback-abstain',
      'grounded-config-parity',
      'foxy-workflow-status',
      'foxy-backlog-status',
    ]);
    const ids = new Set(manifest.artifacts.map((artifact) => artifact.id));
    for (const id of required) {
      expect(ids.has(id), `${id} missing from RCA-13 Foxy/RAG readiness manifest`).toBe(true);
    }

    for (const artifact of manifest.artifacts) {
      expect(artifact.rcaItem).toBe('RCA-13');
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
