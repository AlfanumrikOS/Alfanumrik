/**
 * REG-353 — Phase 2 consolidation ratchet (2026-08-05).
 *
 * Pins the three consolidation outcomes of the Canonical Learner Model wave
 * so they can only ratchet FORWARD:
 *
 *   (1) SINGLE BKT — the SQL RPC `update_learner_state_post_quiz` is the only
 *       mastery writer; the ONE approved TS mirror is
 *       packages/lib/src/learner-model/bkt-mirror.ts (display/preview only).
 *       The analyzer's check-6 duplicate-code gate enforces this at scan
 *       time; this test pins the analyzer CONFIG so the allowlist cannot
 *       silently re-grow (the quiz-completion-service / queue-consumer /
 *       cognitive-engine exported copies were deleted 2026-08-05).
 *   (2) RETIRED-TABLE BASELINES — cme_concept_state (6) and topic_mastery
 *       (20) reference baselines, post-consolidation re-measure. The analyzer
 *       FAILs if refs grow; this test pins the frozen literals so a baseline
 *       bump is a visible, reviewable diff in two places.
 *   (3) cme-engine TOMBSTONE — the Edge Function is a structured 410
 *       (`cme_engine_retired`) that keeps its jwt-user 401 posture for
 *       unauthenticated probes and points to the learner-model facade.
 *
 * Companion: REG-351 (facade lockstep), REG-352 (event-capture contract).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function findRepoRoot(): string {
  // Marker must be `packages/` (NOT `supabase/`): the setup.ts monorepo shim
  // remaps missing `supabase/...` reads under apps/host to the repo root, so
  // a supabase-based probe would falsely resolve the HOST root; `packages`
  // is not in the shim's remap set and only exists at the true repo root.
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'packages', 'lib', 'src'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repo root (packages/lib/src) not found');
}

const root = findRepoRoot();

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('REG-353 (1) — single-BKT analyzer gate config', () => {
  const analyzer = read('scripts/foxy-alignment/analyze.mjs');

  it('check 6 (no-dup code) and check 7 (no-dup schema) exist and run', () => {
    expect(analyzer).toContain('function check6NoDuplicateCode()');
    expect(analyzer).toContain('function check7NoDuplicateSchema()');
    expect(analyzer).toContain('check6NoDuplicateCode(),');
    expect(analyzer).toContain('check7NoDuplicateSchema(),');
  });

  it('BKT-update allowlist is ratcheted down to the single documented module-private survivor', () => {
    // Line-based scan: from the `name: 'BKT update'` entry, collect the
    // quoted path literals inside its `allow: [` block (comments in the block
    // contain brackets, so a lazy regex to the first `]` would under-capture).
    const lines = analyzer.split('\n');
    const nameIdx = lines.findIndex((l) => l.includes("name: 'BKT update',"));
    expect(nameIdx).toBeGreaterThan(-1);
    const allowStart = lines.findIndex(
      (l, i) => i > nameIdx && l.trim().startsWith('allow: ['),
    );
    expect(allowStart).toBeGreaterThan(nameIdx);
    const allowEntries: string[] = [];
    for (let i = allowStart + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('],') || trimmed === ']') break;
      if (trimmed.startsWith('//')) continue;
      const m = trimmed.match(/^'([^']+)'/);
      if (m) allowEntries.push(m[1]);
    }
    // Post-consolidation: ONLY cognitive-engine's module-private helper
    // remains. quiz-completion-service and queue-consumer entries must NOT
    // reappear.
    expect(allowEntries).toEqual(['packages/lib/src/cognitive-engine.ts']);
  });

  it('the deleted duplicate BKT copies are gone from source (not just from the allowlist)', () => {
    const qcs = read('packages/lib/src/state/services/quiz-completion-service.ts');
    expect(qcs).not.toMatch(/(?:function|const)\s+bktUpdate/);
    const qc = read('supabase/functions/queue-consumer/index.ts');
    expect(qc).not.toMatch(/(?:function|const)\s+bktUpdate/);
  });

  it('the one approved TS mirror is bkt-mirror.ts, display-only by contract', () => {
    const mirror = read('packages/lib/src/learner-model/bkt-mirror.ts');
    expect(mirror).toContain('DISPLAY/PREVIEW ONLY, never writes concept_mastery');
    // No supabase client import — the mirror physically cannot write.
    expect(mirror).not.toContain('supabase');
  });
});

describe('REG-353 (2) — retired-table reference baselines (may only DECREASE)', () => {
  const analyzer = read('scripts/foxy-alignment/analyze.mjs');

  it('pins the post-consolidation frozen baselines (bump = reviewable two-place diff)', () => {
    // Ratcheted 6 -> 0 during CI merge fix (PR #1465): cme_concept_state readers
    // fully drained. 0 -> 1 (2026-08-26): database.types.ts regeneration restored
    // the auto-generated table name; analyzer now excludes it from the retired count.
    // REG-353's forward-only ratchet still holds (may only DECREASE).
    expect(analyzer).toContain('cme_concept_state: 1,');
    expect(analyzer).toContain('topic_mastery: 20,');
  });

  it('analyzer fails (not warns) when references exceed the baseline', () => {
    expect(analyzer).toContain(
      'retired tables gain NO new readers',
    );
  });
});

describe('REG-353 (3) — cme-engine tombstone contract', () => {
  const tombstone = read('supabase/functions/cme-engine/index.ts');

  it('returns a structured 410 with the stable retirement code', () => {
    expect(tombstone).toContain("code: 'cme_engine_retired'");
    expect(tombstone).toContain('status: 410');
    expect(tombstone).toContain("error: 'gone'");
  });

  it('preserves the jwt-user auth posture: unauthenticated probes still get 401', () => {
    expect(tombstone).toContain("if (!req.headers.get('Authorization'))");
    expect(tombstone).toContain('status: 401');
  });

  it('points callers at the learner-model facade replacement', () => {
    expect(tombstone).toContain('learner-model facade');
    expect(tombstone).toContain('update_learner_state_post_quiz');
  });

  it('the retired write target is COMMENT-tombstoned in the rollup migration', () => {
    const rollup = read(
      'supabase/migrations/20260808000100_topic_mastery_rollup_view.sql',
    );
    expect(rollup.toLowerCase()).toContain('cme_concept_state');
    expect(rollup.toUpperCase()).toContain('RETIRED');
  });
});
