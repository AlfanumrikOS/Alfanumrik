/**
 * REG: chapter-reader-flag-no-rerender — Fix A regression
 *
 * Pins the removal of the `chapterReaderV2FlagOn` React state variable from
 * src/app/learn/[subject]/[chapter]/page.tsx (removed 2026-06-20).
 *
 * Background: `chapterReaderV2FlagOn` was a useState(false) with no JSX reads.
 * Its two setChapterReaderV2FlagOn() calls inside the flag-fetch useEffect
 * caused the effect's dep-array ([student?.id, load]) to fire twice on every
 * flag fetch — because updating any state inside the effect retriggers all
 * effects that depend on component state, indirectly rerunning load(). This
 * produced a double content load on every chapter open.
 *
 * The fix: remove the state and the setter calls; keep the ref
 * (chapterReaderV2FlagRef) which is the only authority consulted inside load().
 *
 * These tests read the raw source text to assert structural invariants about
 * which identifiers exist or don't exist. They intentionally do NOT mount the
 * component (which has >30 imports and Next.js platform dependencies).
 *
 * Path note: __dirname here is src/__tests__/learn/, so three levels up
 * reaches the project root (D:\Alfa_local\Alfanumrik), then we descend into
 * src/app/learn/[subject]/[chapter]/page.tsx.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// __dirname = <project-root>/src/__tests__/learn
// ../../..  = <project-root>
const PAGE_PATH = resolve(
  __dirname,
  '../../..',                              // project root
  'src/app/learn/[subject]/[chapter]/page.tsx',
);

const source = readFileSync(PAGE_PATH, 'utf-8');

describe('Fix A — chapterReaderV2FlagOn state variable removed', () => {
  it('chapterReaderV2FlagOn is NOT declared as a useState variable in the learn page source', () => {
    // The pattern we are guarding against:
    //   const [chapterReaderV2FlagOn, setChapterReaderV2FlagOn] = useState(false);
    // A comment referencing the name is allowed (it explains the removal).
    // We match for the destructured assignment pattern specifically.
    const stateDeclarationPattern =
      /const\s+\[chapterReaderV2FlagOn[^\]]*\]\s*=\s*useState/;

    expect(stateDeclarationPattern.test(source)).toBe(false);
  });

  it('setChapterReaderV2FlagOn is NOT called anywhere in the source (setter removed with the state)', () => {
    // Both of the previous setChapterReaderV2FlagOn(true/false) calls inside
    // the flag-fetch effect must be absent. Any occurrence is a regression.
    expect(source.includes('setChapterReaderV2FlagOn')).toBe(false);
  });

  it('chapterReaderV2FlagRef is still present in the source as the authoritative flag carrier inside load()', () => {
    // The ref replaces the state. If it disappears, load() loses its flag
    // access entirely — the chapter reader v2 feature would silently regress
    // to always using the legacy RAG path.
    expect(source.includes('chapterReaderV2FlagRef')).toBe(true);
  });
});
