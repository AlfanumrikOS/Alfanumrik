import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

interface StudentLearningArtifact {
  id: string;
  rcaItem: 'RCA-04' | 'RCA-06';
  path: string;
  status: 'repo_guarded' | 'follow_up' | 'operator_gate';
  readinessRole: string;
  evidence: string[];
}

interface StudentLearningReadinessManifest {
  source: string;
  remainingFollowUps: string[];
  artifacts: StudentLearningArtifact[];
}

const repoRoot = path.resolve(__dirname, '../../../..');
const repoPath = (relativePath: string) => path.join(repoRoot, relativePath);

const requiredArtifactIds = [
  'slc1-single-xp-writer',
  'slc1-historical-xp-quantification',
  'slc4-fallback-cap-alignment',
  'slc5-anticheat-advisory-convergence',
  'quiz-submit-route-session-id',
  'v2-quiz-submit-route-session-id',
  'pre-rollout-shuffle-map-check',
  'student-learning-workflow-status',
] as const;

describe('student learning readiness manifest (RCA-04/RCA-06)', () => {
  it('pins SLC-1/SLC-4/SLC-5 quiz-submit readiness and residual follow-ups', () => {
    const manifestPath = repoPath('scripts/student-learning-readiness.json');
    expect(existsSync(manifestPath), 'missing scripts/student-learning-readiness.json').toBe(true);

    const manifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    ) as StudentLearningReadinessManifest;

    expect(manifest.source).toContain('RCA-04');
    const followUps = manifest.remainingFollowUps.join('\n');
    expect(followUps).toContain('SLC-1-backfill');
    expect(followUps).toContain('SLC-5');
    expect(followUps).toContain('SLC-8');

    const ids = manifest.artifacts.map((artifact) => artifact.id).sort();
    expect(ids).toEqual([...requiredArtifactIds].sort());

    for (const artifact of manifest.artifacts) {
      expect(['RCA-04', 'RCA-06']).toContain(artifact.rcaItem);
      expect(existsSync(repoPath(artifact.path)), `${artifact.id} path does not exist`).toBe(true);
      const source = readFileSync(repoPath(artifact.path), 'utf8');
      for (const snippet of artifact.evidence) {
        expect(source, `${artifact.id} missing evidence: ${snippet}`).toContain(snippet);
      }
    }
  });
});
