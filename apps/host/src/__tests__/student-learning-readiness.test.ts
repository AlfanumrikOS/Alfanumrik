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
 * ── Superseded manifest evidence ─────────────────────────────────────────
 *
 * The manifest's `evidence` strings are a PROXY: "this substring is still in
 * the artifact" stands in for "the artifact still does the thing". That proxy
 * rots the moment the artifact is legitimately re-baselined, and it can rot
 * while still looking authoritative.
 *
 * `pre-rollout-shuffle-map-check` rotted exactly that way. It pinned the
 * comment sentence `Our spec says 5` inside `scripts/pre-rollout-checklist.ts`
 * — i.e. it pinned an exact COUNT of `shuffle_map` push sites in the quiz
 * page. That count was the WEAKEST thing in the check it guarded: it was
 * silent about the VALUE (five sites writing `shuffle_map: buildLocalMap()`
 * would have satisfied it, which is precisely the P1/REG-51 defect the check
 * exists to prevent) and it broke on any honest new response construction.
 * Phase 4's session-resume path (b008c20c7) legitimately added a sixth; all
 * six write `null`. Commit 717265e6b turned the check into a property pin:
 * `MIN_SHUFFLE_MAP_PUSH_SITES` is a FLOOR, plus an assertion that every
 * captured value is exactly `null`.
 *
 * So an entry here is NOT a skip. Three things happen instead, and all three
 * must hold:
 *
 *   1. The superseded snippet is asserted ABSENT. If it ever reappears the
 *      artifact has been reverted, and this test fails demanding the entry be
 *      deleted — so the table cannot quietly outlive its reason.
 *   2. The named replacement pin must exist on disk, so the guarantee is
 *      re-homed rather than dropped.
 *   3. `ADDITIONAL_EVIDENCE` below re-pins the artifact on the load-bearing
 *      property instead, using strings that survive a floor re-baseline.
 *
 * Keep this table empty unless you can state, as below, what replaced the
 * claim. The correct durable fix is to update the evidence strings in
 * `scripts/student-learning-readiness.json` itself; that file is outside this
 * agent's ownership, so the reconciliation lives here.
 */
const SUPERSEDED_EVIDENCE: Record<
  string,
  Array<{ snippet: string; replacementPin: string }>
> = {
  'pre-rollout-shuffle-map-check': [
    {
      snippet: 'Our spec says 5',
      replacementPin: 'apps/host/src/__tests__/quiz/shuffle-map-push-site-check.test.ts',
    },
  ],
};

/**
 * Test-owned evidence, asserted IN ADDITION to whatever the manifest declares.
 * Never a replacement for it.
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
      const superseded = SUPERSEDED_EVIDENCE[artifact.id] ?? [];

      for (const snippet of artifact.evidence) {
        const entry = superseded.find((s) => s.snippet === snippet);
        if (entry) {
          expect(
            source,
            `${artifact.id}: superseded evidence "${snippet}" is present again — ` +
              'the artifact was reverted, or the SUPERSEDED_EVIDENCE entry is stale. ' +
              'Delete the entry and restore the direct pin.',
          ).not.toContain(snippet);
          expect(
            existsSync(repoPath(entry.replacementPin)),
            `${artifact.id}: replacement pin ${entry.replacementPin} is missing — ` +
              'superseded evidence must be re-homed, never dropped.',
          ).toBe(true);
          continue;
        }
        expect(source, `${artifact.id} missing evidence: ${snippet}`).toContain(snippet);
      }

      for (const snippet of ADDITIONAL_EVIDENCE[artifact.id] ?? []) {
        expect(
          source,
          `${artifact.id} missing test-owned evidence: ${snippet}`,
        ).toContain(snippet);
      }
    }

    // Guard the tables themselves: an id that no longer exists in the manifest
    // means the reconciliation is addressing a ghost.
    const byId = new Map(manifest.artifacts.map((a) => [a.id, a]));
    for (const id of [...Object.keys(SUPERSEDED_EVIDENCE), ...Object.keys(ADDITIONAL_EVIDENCE)]) {
      expect(byId.has(id), `evidence table names unknown artifact: ${id}`).toBe(true);
    }

    // ...and a supersession whose snippet the manifest no longer declares is
    // dead weight. This is what fires the day `scripts/student-learning-
    // readiness.json` is corrected at source: the entry stops having anything
    // to supersede and must be deleted, rather than lingering as a permanent
    // exemption for a string nobody asserts.
    for (const [id, entries] of Object.entries(SUPERSEDED_EVIDENCE)) {
      for (const entry of entries) {
        expect(
          byId.get(id)?.evidence ?? [],
          `SUPERSEDED_EVIDENCE["${id}"] still exempts "${entry.snippet}", but the manifest ` +
            'no longer declares it. The manifest was fixed at source — delete the entry.',
        ).toContain(entry.snippet);
      }
    }
  });
});
