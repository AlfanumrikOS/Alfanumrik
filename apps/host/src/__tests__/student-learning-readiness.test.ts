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

/**
 * ── Why there is no SUPERSEDED_EVIDENCE table here ────────────────────────
 *
 * The manifest's `evidence` strings are a PROXY: "this substring is still in
 * the artifact" stands in for "the artifact still does the thing". That proxy
 * rots the moment the artifact is legitimately re-baselined, and it can rot
 * while still looking authoritative.
 *
 * `pre-rollout-shuffle-map-check` rotted exactly that way: it pinned the
 * comment sentence `Our spec says 5` in `scripts/pre-rollout-checklist.ts`,
 * i.e. an exact COUNT of `shuffle_map` push sites. That count was the WEAKEST
 * thing in the check it guarded — silent about the VALUE (five sites writing
 * `shuffle_map: buildLocalMap()` satisfied it, which is exactly the P1/REG-51
 * defect the check exists to prevent) and broken by any honest new response
 * construction. Commit 717265e6b re-based the check on the property instead:
 * `MIN_SHUFFLE_MAP_PUSH_SITES` is a FLOOR, plus an assertion that every
 * captured value is exactly `null`.
 *
 * This file used to reconcile that here, via a `SUPERSEDED_EVIDENCE` table
 * that asserted the stale snippet ABSENT, required a named replacement pin on
 * disk, and — crucially — failed the day the manifest stopped declaring the
 * snippet, demanding its own deletion. Ops fixed
 * `scripts/student-learning-readiness.json` at source, that guard fired, and
 * the table went with it. `git show 37e02a250` has the full mechanism if the
 * situation ever recurs.
 *
 * The correct fix is always to repair the evidence strings in the manifest.
 * Re-introduce a reconciliation table here only if that file is genuinely
 * unreachable, and only with a guard that deletes it again.
 */

/**
 * Test-owned evidence, asserted IN ADDITION to whatever the manifest declares.
 * Never a replacement for it.
 *
 * Two of these three strings are ALSO declared by the manifest today. That
 * overlap is deliberate, not leftover. `scripts/` is outside this agent's
 * ownership, so a future manifest edit could drop the P1 value pin without
 * this file changing at all — and that pin is the load-bearing one. Asserting
 * it from here too means the guarantee survives any edit to the manifest. The
 * third string (`a response construction lost its stamp`) is intentionally
 * test-owned only, so the floor-failure branch stays pinned from here
 * regardless of what the manifest declares.
 *
 * Every string here is deliberately free of any site count, so re-baselining
 * `MIN_SHUFFLE_MAP_PUSH_SITES` (which happens whenever a response
 * construction is legitimately added) does not touch this test. Each one is
 * absent from a count-only implementation, so reverting the check — or
 * dropping just the `null` assertion — fails here.
 */
const ADDITIONAL_EVIDENCE: Record<string, string[]> = {
  'pre-rollout-shuffle-map-check': [
    // The value assertion itself: the client never fabricates a map.
    "values.filter((v) => v !== 'null')",
    // ...and the two failure modes stay distinguishable, so a CI failure says
    // which defect it caught.
    'client fabricated a shuffle_map (P1)',
    'a response construction lost its stamp',
  ],
};

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

      for (const snippet of ADDITIONAL_EVIDENCE[artifact.id] ?? []) {
        expect(
          source,
          `${artifact.id} missing test-owned evidence: ${snippet}`,
        ).toContain(snippet);
      }
    }

    // Guard the table itself: an id that no longer exists in the manifest
    // means the test-owned evidence is addressing a ghost.
    const byId = new Map(manifest.artifacts.map((a) => [a.id, a]));
    for (const id of Object.keys(ADDITIONAL_EVIDENCE)) {
      expect(byId.has(id), `evidence table names unknown artifact: ${id}`).toBe(true);
    }
  });
});
