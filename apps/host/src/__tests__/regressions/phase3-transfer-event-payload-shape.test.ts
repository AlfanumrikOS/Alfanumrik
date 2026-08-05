/**
 * Foxy North-Star Phase 3 — `learner.transfer_evidence` payload-shape parity
 * (REG-356 partial anchor, D12 direction-inversion pin).
 *
 * STATIC-SOURCE test. Reads files under apps/, packages/, and supabase/ as
 * TEXT and asserts a structural property — no product code executes.
 *
 * WHY THIS EXISTS
 * ================
 * Assessment review flagged during Phase 3 sign-off that the transfer-evidence
 * event payload was being published with the pure module's own field names
 * (`topicId`/`fromTopicId`) rather than the role-anchored contract shape
 * (`sourceTopicId`/`targetTopicId`) declared in BOTH event registries. The
 * behavioral fix already lives in the build-twin cron (see
 * `apps/host/src/app/api/cron/build-twin-snapshots/route.ts:565-566` and the
 * `build-twin-snapshots-transfer.test.ts` payload pins). This canary pins the
 * NEGATIVE: no OTHER consumer / producer / cross-registry mirror may re-slip
 * to the pre-fix names.
 *
 * WHAT WOULD TURN THIS RED
 * ------------------------
 *   - the Next-side registry (packages/lib/src/state/events/registry.ts) and
 *     the Deno-side registry (supabase/functions/_shared/state-runtime/
 *     events-registry.ts) drift on the `learner.transfer_evidence` payload,
 *   - a new file mentions `'learner.transfer_evidence'` alongside a payload
 *     literal containing the old `topicId`/`fromTopicId` keys,
 *   - a producer publishes with the old field names instead of
 *     `sourceTopicId`/`targetTopicId`.
 *
 * Invariant: D12 (transfer-evidence direction & registry parity).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function findRepoRoot(): string {
  let dir = path.resolve(process.cwd());
  for (let i = 0; i < 8; i += 1) {
    if (
      fs.existsSync(path.join(dir, 'apps')) &&
      fs.existsSync(path.join(dir, 'packages', 'lib', 'src')) &&
      fs.existsSync(path.join(dir, 'supabase'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate the monorepo root from cwd=${process.cwd()}`);
}

const REPO_ROOT = findRepoRoot();

const SEARCH_ROOTS = [
  path.join(REPO_ROOT, 'apps', 'host', 'src'),
  path.join(REPO_ROOT, 'packages'),
  path.join(REPO_ROOT, 'supabase', 'functions'),
];

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist') continue;
      walk(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
}

const ALL_FILES: string[] = [];
for (const root of SEARCH_ROOTS) walk(root, ALL_FILES);

const NEXT_REGISTRY = path.join(
  REPO_ROOT, 'packages', 'lib', 'src', 'state', 'events', 'registry.ts',
);
const DENO_REGISTRY = path.join(
  REPO_ROOT, 'supabase', 'functions', '_shared', 'state-runtime', 'events-registry.ts',
);

describe('D12 transfer-evidence payload shape (preconditions)', () => {
  it('scan discovered a non-trivial set of sources', () => {
    expect(ALL_FILES.length).toBeGreaterThan(200);
  });

  it('both event registries exist on disk', () => {
    expect(fs.existsSync(NEXT_REGISTRY)).toBe(true);
    expect(fs.existsSync(DENO_REGISTRY)).toBe(true);
  });
});

describe('D12 transfer-evidence registry parity (Next ↔ Deno)', () => {
  it('both registries declare the sourceTopicId/targetTopicId payload shape', () => {
    for (const file of [NEXT_REGISTRY, DENO_REGISTRY]) {
      const src = fs.readFileSync(file, 'utf8');
      // Find the LearnerTransferEvidenceSchema block.
      const start = src.indexOf('LearnerTransferEvidenceSchema');
      expect(start).toBeGreaterThan(0);
      const block = src.slice(start, start + 1200);
      expect(block).toContain("kind: z.literal('learner.transfer_evidence')");
      expect(block).toMatch(/sourceTopicId:\s*uuidLike\(\)/);
      expect(block).toMatch(/targetTopicId:\s*uuidLike\(\)/);
      expect(block).toMatch(/sourceMastery:\s*z\.number\(\)/);
      // NEGATIVE: the schema must not carry the old field names.
      expect(block).not.toMatch(/^\s*topicId:\s*uuidLike/m);
      expect(block).not.toMatch(/^\s*fromTopicId:\s*uuidLike/m);
    }
  });
});

describe('D12 transfer-evidence — no consumer/producer still uses the old payload keys', () => {
  // Comment prose is fine (the pure module IS allowed to describe its own
  // {topicId, fromTopicId} record shape), but a KIND literal must not sit
  // next to a payload literal carrying the pre-fix keys.
  const KIND_LITERAL = "'learner.transfer_evidence'";

  it('no non-test source file pairs the kind literal with pre-fix payload keys', () => {
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      const src = fs.readFileSync(file, 'utf8');
      if (!src.includes(KIND_LITERAL)) continue;
      // Look at the ±1200-char window around every kind-literal occurrence.
      let idx = 0;
      while ((idx = src.indexOf(KIND_LITERAL, idx)) !== -1) {
        const window = src.slice(Math.max(0, idx - 400), idx + 1200);
        // A publish/subscribe/handler block references a payload — if that
        // window contains a `payload:` literal, its keys must be the new ones.
        if (/payload\s*:/.test(window)) {
          const hasOldTopicId = /(^|[\s,{])topicId\s*:/.test(window);
          const hasOldFromTopicId = /(^|[\s,{])fromTopicId\s*:/.test(window);
          const hasNewSource = /sourceTopicId\s*:/.test(window);
          const hasNewTarget = /targetTopicId\s*:/.test(window);
          if ((hasOldTopicId || hasOldFromTopicId) && !(hasNewSource && hasNewTarget)) {
            offenders.push(path.relative(REPO_ROOT, file));
            break;
          }
        }
        idx += KIND_LITERAL.length;
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the sole live producer (build-twin cron) uses the new payload shape', () => {
    const cron = path.join(
      REPO_ROOT, 'apps', 'host', 'src', 'app', 'api', 'cron',
      'build-twin-snapshots', 'route.ts',
    );
    expect(fs.existsSync(cron)).toBe(true);
    const src = fs.readFileSync(cron, 'utf8');
    // Publish block anchor.
    expect(src).toMatch(/kind:\s*'learner\.transfer_evidence'/);
    // Payload uses the role-anchored keys, with SOURCE = fromTopicId (the
    // already-solid prereq the pure module names on its return value).
    expect(src).toMatch(/sourceTopicId:\s*rec\.fromTopicId/);
    expect(src).toMatch(/targetTopicId:\s*rec\.topicId/);
    // Canonical write inverts them for record_transfer_evidence RPC.
    expect(src).toMatch(/p_topic_id:\s*rec\.fromTopicId/);
    expect(src).toMatch(/p_from_topic_id:\s*rec\.topicId/);
  });
});
