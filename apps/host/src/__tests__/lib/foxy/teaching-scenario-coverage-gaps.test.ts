// apps/host/src/__tests__/lib/foxy/teaching-scenario-coverage-gaps.test.ts
//
// Foxy MOL audit, requirement 10 — end-to-end teaching scenarios.
//
// Eight scenarios were specified. This file is the honest record of the four
// that CANNOT be tested today, plus machine-checkable tripwires that will FAIL
// the moment the missing implementation ships — so the gap cannot quietly
// persist and the skipped tests cannot quietly rot.
//
//   (a) student answers CORRECTLY          -> .skip  (no multi-turn tutor state)
//   (b) student answers with a MISCONCEPTION -> .skip (no multi-turn tutor state)
//   (c) student struggles REPEATEDLY       -> .skip  (no multi-turn tutor state)
//   (d) student is FRUSTRATED (SEL)        -> .todo  (essentially no implementation)
//
// Covered elsewhere, deliberately NOT duplicated here:
//   (e) direct-answer demand must not answer-dump
//         -> live-template-render-pins.test.ts (homework Socratic ladder,
//            asserted on the RENDERED foxy_tutor_doubt_v1 prompt)
//   (f) insufficient curriculum evidence  -> existing grounded-answer coverage
//   (g) prompt injection / unsafe disclosure -> existing grounded-answer coverage
//   (h) Anthropic failure -> OpenAI fallback
//         -> grounded-answer/__tests__/claude.test.ts (routing + session context)
//            and grounded-answer/__tests__/provider-parity.test.ts (prompt parity)
//
// WHY (a)/(b)/(c) CANNOT BE TESTED — the specific missing thing:
//
//   All three are assertions about how Foxy's NEXT turn changes in response to
//   what the student did on the PREVIOUS turn. That requires server-side
//   turn-to-turn tutor state: "Foxy asked X; the student's next message is the
//   answer to X; it was right / wrong / wrong again."
//
//   The only mechanism that ever existed for this is
//   `foxy_pending_expectations` + the ANSWERING_NOW prompt block, gated by
//   `ff_foxy_pending_expectations_v1`. That flag is seeded OFF (is_enabled=false,
//   rollout_percentage=0) and has NEVER been ramped — most recently re-seeded OFF
//   by migration 20260831031808_m7_restore_foxy_pending_expectations_ledger_drift.sql.
//   With it OFF, `/api/foxy` writes no expectation row and injects no
//   ANSWERING_NOW block, so turn coherence rests on raw chat history alone and
//   there is no correctness signal at all for the previous turn.
//
//   There is additionally NO `tutor_state` module, table, or column anywhere in
//   the repo (grep returns zero hits), so there is no second implementation that
//   could carry the signal instead.
//
//   Writing a green test for (a)/(b)/(c) today would therefore mean asserting on
//   a prompt string we constructed ourselves in the test — i.e. asserting that
//   our own fixture contains our own fixture. That is precisely the vacuous
//   shape that let the safety-rails gap survive a green suite for months.
//
// WHY (d) HAS NO TEST AT ALL — not even a skipped one:
//
//   (a)-(c) have a named, existing, flag-gated implementation to wait for.
//   (d) does not. Searching the whole prompt surface for SEL/frustration
//   handling yields exactly ONE line — "If the student seems frustrated, be
//   extra encouraging" in `buildFoxySystemPrompt`
//   (packages/lib/src/ai/prompts/foxy-system.ts) — and that prompt is NOT on the
//   live path: no registered template declares a `{{foxy_system_prompt}}` slot,
//   so `resolveTemplate` discards it on every grounded turn. It is consumed only
//   by the legacy intent-router fallback (`runLegacyFoxyFlow`, reached via the
//   `ff_grounded_ai_foxy` kill switch or a grounded failure).
//   `packages/lib/src/companion/casel-map.ts` exists but has no importer outside
//   the barrel and its own unit test — no route consumes it.
//   So there is no behaviour to skip a test AGAINST. It is recorded as `it.todo`
//   and reported as a product gap for assessment, not as test debt.
//
// Owner: testing. Reported to: assessment (SEL policy), ai-engineer (tutor state).

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'supabase', 'migrations'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate supabase/migrations walking up from ${process.cwd()}`);
}

const REPO_ROOT = findRepoRoot();
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');
const FLAG = 'ff_foxy_pending_expectations_v1';

// ─────────────────────────────────────────────────────────────────────────────
// Tripwires — real assertions that make the gap machine-checkable.
//
// These are green TODAY because the gap is real. They turn RED the moment the
// missing implementation lands, which is exactly when the skipped scenarios
// below must be written for real.
// ─────────────────────────────────────────────────────────────────────────────

describe('scenario (a)/(b)/(c) precondition tripwire — multi-turn tutor state is still absent', () => {
  const migrationSources = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf8') }))
    .filter(({ sql }) => sql.includes(FLAG));

  it('the flag exists in the migration ledger (guard: this test is not searching for nothing)', () => {
    expect(migrationSources.length).toBeGreaterThan(0);
  });

  it(`${FLAG} is seeded OFF in every migration that seeds it`, () => {
    // If this fails, the flag has been ramped -> write the three .skip'd
    // scenarios below for real and delete this tripwire.
    const seeds = migrationSources.filter(({ sql }) =>
      new RegExp(`'${FLAG}'\\s*,\\s*(true|false)`).test(sql),
    );
    expect(seeds.length).toBeGreaterThan(0);
    for (const { file, sql } of seeds) {
      const m = sql.match(new RegExp(`'${FLAG}'\\s*,\\s*(true|false)\\s*,\\s*(\\d+)`));
      expect(m, `${file}: could not parse the seed tuple`).toBeTruthy();
      expect(m![1], `${file}: ${FLAG} is no longer seeded OFF`).toBe('false');
      expect(m![2], `${file}: ${FLAG} rollout_percentage is no longer 0`).toBe('0');
    }
  });

  it('no `tutor_state` implementation exists anywhere (the alternative carrier)', () => {
    // Cheap structural check over the two source trees that could hold one.
    const roots = [
      join(REPO_ROOT, 'packages', 'lib', 'src'),
      join(REPO_ROOT, 'supabase', 'functions', 'grounded-answer'),
    ];
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          if (readFileSync(full, 'utf8').includes('tutor_state')) hits.push(full);
        }
      }
    };
    for (const root of roots) if (existsSync(root)) walk(root);
    expect(hits, `tutor_state now exists — write scenarios (a)/(b)/(c) for real`).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The four uncoverable scenarios.
// ─────────────────────────────────────────────────────────────────────────────

describe('requirement 10 — teaching scenarios blocked on missing implementation', () => {
  // TODO(ai-engineer): re-enable when `ff_foxy_pending_expectations_v1` is
  // ramped above 0% (or an equivalent turn-to-turn correctness signal ships).
  // Blocked on: no server-side record that the previous Foxy turn asked a
  // question, and no evaluation of the student's reply against it. Until then
  // the "next turn advances" assertion has nothing to read.
  it.skip('(a) student answers CORRECTLY -> the next turn advances instead of re-teaching', () => {
    throw new Error(
      'not implemented: needs ff_foxy_pending_expectations_v1 ON (seeded OFF, rollout 0) ' +
        'so the ANSWERING_NOW block carries the prior question and its correctness verdict',
    );
  });

  // TODO(ai-engineer + assessment): re-enable with the same flag. Additionally
  // needs the misconception verdict to be persisted per turn — today
  // {{misconception_section}} is populated from the curated ontology
  // (historical, cross-session), not from what the student just said.
  it.skip('(b) student answers with a MISCONCEPTION -> the next turn names and repairs it', () => {
    throw new Error(
      'not implemented: needs ff_foxy_pending_expectations_v1 ON plus a per-turn ' +
        'misconception verdict; {{misconception_section}} is cross-session, not this-turn',
    );
  });

  // TODO(ai-engineer + assessment): re-enable with the same flag. Additionally
  // needs a consecutive-failure counter scoped to the open expectation — the
  // existing struggle detection is session/mastery-level, not turn-level, so it
  // cannot distinguish "wrong twice about THIS question" from "weak chapter".
  it.skip('(c) student struggles REPEATEDLY -> Foxy de-escalates difficulty and changes approach', () => {
    throw new Error(
      'not implemented: needs ff_foxy_pending_expectations_v1 ON plus a per-expectation ' +
        'consecutive-failure counter; existing struggle detection is session-level',
    );
  });

  // TODO(assessment): there is no SEL/frustration behaviour to test. Define the
  // expected behaviour first (what Foxy should DO on a frustration signal, in
  // which modes, in which language), then ai-engineer implements it on the LIVE
  // grounded path, then this becomes a real test. Do NOT convert this to a
  // passing test by asserting on the one dead-path line in buildFoxySystemPrompt.
  it.todo(
    '(d) student is FRUSTRATED -> Foxy responds with SEL support (NO IMPLEMENTATION — assessment must define expected behaviour first)',
  );
});
