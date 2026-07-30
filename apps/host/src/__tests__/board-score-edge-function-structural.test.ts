/**
 * Structural (source-text) pins for `supabase/functions/board-score/index.ts`
 * (Deno Edge Function — not directly executable in the Vitest/Node lane, so
 * these are SOURCE pins, the same posture used elsewhere in this repo for
 * Edge Function correctness where no live-DB Deno harness exists, e.g.
 * REG-318's migration-source structural tests).
 *
 * Two independent concerns pinned here:
 *
 * 1. Bug 1 fix — the broken PostgREST nested-embed
 *    (`curriculum_topics!inner(... subjects!inner(code) ...)` on
 *    `cme_concept_state`, which fails because no FK from
 *    `cme_concept_state.concept_id` to `curriculum_topics.id` is declared)
 *    is GONE, replaced by the flat three-query + in-memory Map join pattern
 *    that mirrors `cme-engine/index.ts`.
 *
 * 2. P1-adjacent formula-untouched guarantee (spec §6, §8 item 8) — the
 *    scoring formula, retention decay, confidence-band widening, chapter
 *    status thresholds, and the `board_score_predictions` upsert shape are
 *    byte-for-byte unchanged by this batch. This was verified by explicit
 *    `git diff` review during this test pass (see PR description / testing
 *    agent report); these pins exist so a FUTURE change to this same file
 *    cannot silently drift the formula without a test failing — the file's
 *    own git history is not a durable guardrail once this diff is merged.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const EDGE_FN_PATH = path.resolve(__dirname, '../../../../supabase/functions/board-score/index.ts');
const source = readFileSync(EDGE_FN_PATH, 'utf-8');

// The fix's own explanatory comment intentionally NAMES the broken pattern
// in prose (e.g. "does NOT use a PostgREST nested embed
// (`curriculum_topics!inner(...)`)") so future readers understand why —
// that mention must not itself trip an "absent" assertion. Strip `//`
// line-comments before checking for EXECUTABLE occurrences of the pattern.
const sourceWithoutLineComments = source
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

describe('board-score Edge Function — PostgREST embed fix (structural)', () => {
  it('does NOT contain the broken nested-embed pattern as EXECUTABLE code (curriculum_topics!inner chained with subjects!inner)', () => {
    // The broken pattern always appeared as a real multiline field list —
    // `curriculum_topics!inner (` followed by a newline and `chapter_number,`
    // — inside a `.select()\` template. The explanatory comment mentions the
    // shorthand `curriculum_topics!inner(...)` (no space, ellipsis, single
    // line) which this stricter pattern does not match.
    expect(sourceWithoutLineComments).not.toMatch(/curriculum_topics!inner\s*\(\s*\n\s*chapter_number/);
    expect(sourceWithoutLineComments).not.toMatch(/subjects!inner\s*\(\s*code\s*\)/);
  });

  it('does NOT filter cme_concept_state by curriculum_topics.* dotted PostgREST embed columns', () => {
    expect(source).not.toMatch(/\.eq\(\s*['"]curriculum_topics\.grade['"]/);
    expect(source).not.toMatch(/\.eq\(\s*['"]curriculum_topics\.subjects\.code['"]/);
  });

  it('DOES contain the flat three-query pattern: subjects lookup, curriculum_topics fetch, cme_concept_state fetch', () => {
    expect(source).toMatch(/\.from\(\s*['"]subjects['"]\s*\)/);
    expect(source).toMatch(/\.from\(\s*['"]curriculum_topics['"]\s*\)/);
    expect(source).toMatch(/\.from\(\s*['"]cme_concept_state['"]\s*\)/);
  });

  it('DOES join in application code via an in-memory Map keyed by curriculum_topics.id', () => {
    expect(source).toMatch(/topicChapterMap\s*=\s*new Map/);
    expect(source).toMatch(/topicChapterMap\.set\(/);
    expect(source).toMatch(/topicChapterMap\.has\(/);
  });

  it('the cme_concept_state fetch no longer filters by subject/grade in the query itself (filtered by the Map join instead)', () => {
    // Post-fix: cme_concept_state is fetched scoped only to student_id, then
    // filtered in JS by concept_id membership in topicChapterMap.
    expect(source).toMatch(/\.from\(\s*['"]cme_concept_state['"]\s*\)[\s\S]{0,400}\.eq\(\s*['"]student_id['"]/);
  });
});

describe('board-score Edge Function — scoring formula byte-for-byte unchanged (P1-adjacent guard)', () => {
  it('retention decay formula is unchanged: masteryMean * exp(-0.693 * hoursSince / halfLifeHours), clamped [0,1]', () => {
    expect(source).toContain(
      'const retention = masteryMean * Math.exp(-0.693 * hoursSince / halfLifeHours)',
    );
    expect(source).toContain('return Math.max(0, Math.min(1, retention))');
  });

  it('classifyMastery thresholds are unchanged: >=0.75 strong, >=0.50 moderate, >=0.25 weak, else critical', () => {
    expect(source).toMatch(/if \(m >= 0\.75\) return 'strong'/);
    expect(source).toMatch(/if \(m >= 0\.50\) return 'moderate'/);
    expect(source).toMatch(/if \(m >= 0\.25\) return 'weak'/);
    expect(source).toMatch(/return 'critical'/);
  });

  it('confidence band widening is unchanged: ±10 default, ±15 when coverage < 60%', () => {
    expect(source).toContain('const bandHalf = coveragePct < 60 ? 15 : 10');
    expect(source).toContain('const confidenceLow  = Math.max(0,   predictedPct - bandHalf)');
    expect(source).toContain('const confidenceHigh = Math.min(100, predictedPct + bandHalf)');
  });

  it('chapter-scoring loop is unchanged: effective_mastery = masteryMean * retentionFactor, predicted_marks = effective_mastery * marks_allocated', () => {
    expect(source).toContain(
      '? Math.max(0, Math.min(1, masteryMean * retentionFactor))',
    );
    expect(source).toContain('const predictedMarks = effectiveMastery * w.marks_allocated');
  });

  it('recovery-plan ranking is unchanged: recoverable marks DESC, top 5, threshold > 0.5', () => {
    expect(source).toContain('const recoverableMarks = w.marks_allocated * (1 - (cs?.effective_mastery ?? 0))');
    expect(source).toContain('.filter((r) => r.recoverable_marks > 0.5)');
    expect(source).toContain('.sort((a, b) => b.recoverable_marks - a.recoverable_marks)');
    expect(source).toContain('.slice(0, 5)');
  });

  it('the board_score_predictions upsert natural key and shape are unchanged', () => {
    expect(source).toContain("{ onConflict: 'student_id,subject_code,grade,score_date' }");
    expect(source).toMatch(/predicted_score:\s*Math\.round\(predictedScore \* 100\) \/ 100/);
    expect(source).toMatch(/predicted_pct:\s*Math\.round\(predictedPct \* 100\) \/ 100/);
    expect(source).toContain('confidence_band_low: Math.round(confidenceLow * 100) / 100');
    expect(source).toContain('confidence_band_high: Math.round(confidenceHigh * 100) / 100');
  });
});

describe('board-score Edge Function — getBoardScores defensive platform_elective filter (spec §7.2 item 2)', () => {
  it('excludes platform_elective subjects from the get action even if a stray row exists', () => {
    expect(source).toMatch(/subject_kind['"]\s*,\s*['"]platform_elective['"]/);
    expect(source).toMatch(/\.not\(\s*['"]subject_code['"]\s*,\s*['"]in['"]/);
  });
});
