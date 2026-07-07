import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * GUARD #2 (static half) + GUARD #1 (defense-in-depth, static).
 *
 * Source-scan guards on the NEW Phase-1 learning-action files. These complement
 * the behavioral mock suite: even if a future refactor changes the mock surface,
 * these grep-style assertions fail loudly if someone:
 *   - hardcodes an XP literal in the route or the new components (P2 says XP
 *     constants live only in src/lib/xp-rules.ts);
 *   - calls submitQuizResults / atomic_quiz_profile_update from the route;
 *   - inserts/updates/upserts a mastery surface from the route source.
 *
 * Reading the file off disk (not importing) keeps this a pure text guard with no
 * module-eval side effects.
 */

const ROOT = resolve(__dirname, '../../../..');
function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

/** Strip /* block *​/ and // line comments so we scan executable code only. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '')) // line comments
    .join('\n');
}

const ROUTE = 'src/app/api/foxy/learning-action/route.ts';
const NEW_COMPONENT_FILES = [
  ROUTE,
  'src/components/foxy/FoxyStructuredRenderer.tsx',
  'src/components/foxy/ChatBubble.tsx',
  'src/lib/use-foxy-learning-actions-flag.ts',
];

const FORBIDDEN_MASTERY_TABLES = [
  'concept_mastery',
  'cme_concept_state',
  'student_skill_state',
  'knowledge_gaps',
  'learner_mastery',
  'cme_error_log',
  'quiz_sessions',
  'student_learning_profiles',
  'bloom_progression',
];

describe('GUARD #2 (static) — no hardcoded XP in the new learning-action files', () => {
  for (const rel of NEW_COMPONENT_FILES) {
    it(`${rel} contains no hardcoded XP literal patterns`, () => {
      // strip block + line comments so prose like "Award 0 XP" / "awards no XP"
      // doesn't trip us.
      const code = stripComments(read(rel));
      // Classic XP-math signatures the quiz-integrity skill greps for.
      expect(code).not.toMatch(/\*\s*10\b/); // correct * 10
      expect(code).not.toMatch(/\+\s*20\b/); // high-score bonus
      expect(code).not.toMatch(/\+\s*50\b/); // perfect bonus
      // No XP_RULES import sneaking XP awards into a telemetry route.
      expect(code).not.toMatch(/XP_RULES/);
      expect(code).not.toMatch(/xp_earned|xpEarned|quiz_per_correct/);
    });
  }
});

describe('GUARD #2 (static) — route never calls the quiz-submit / XP path', () => {
  it('route CODE (comments stripped) does not call submitQuizResults or atomic_quiz_profile_update', () => {
    // The route's docstring deliberately NAMES these as forbidden ("Never calls
    // submitQuizResults / atomic_quiz_profile_update"). That is documentation,
    // not a call — so we strip block + line comments before scanning the code.
    const code = stripComments(read(ROUTE));
    expect(code).not.toMatch(/submitQuizResults/);
    expect(code).not.toMatch(/atomic_quiz_profile_update/);
  });
});

describe('GUARD #1 (static) — route source writes no mastery surface', () => {
  const src = stripComments(read(ROUTE));
  for (const table of FORBIDDEN_MASTERY_TABLES) {
    it(`route never performs an insert/update/upsert against ${table}`, () => {
      // Look for a .from('<table>') ... <mutating op> on the SAME logical chain.
      // We assert the table name does not appear immediately adjacent to a write
      // op anywhere in the source. The route legitimately reads
      // foxy_chat_messages (select) and writes student_bookmarks (insert) +
      // foxy_pending_expectations (via the imported helper) — none of which are
      // in FORBIDDEN_MASTERY_TABLES.
      const fromCall = new RegExp(`\\.from\\(\\s*['"\`]${table}['"\`]`);
      expect(src).not.toMatch(fromCall);
    });
  }

  it('the only .from() write targets in the route are student_bookmarks (insert) + foxy_chat_messages (read)', () => {
    const fromTargets = [...src.matchAll(/\.from\(\s*['"`]([a-z_]+)['"`]/g)].map((m) => m[1]);
    const unique = [...new Set(fromTargets)].sort();
    // foxy_pending_expectations is touched only through the imported
    // foxy-expectations helpers, not a direct .from() in this file.
    expect(unique).toEqual(['foxy_chat_messages', 'student_bookmarks']);
  });
});
