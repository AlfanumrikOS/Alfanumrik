/**
 * Foxy North-Star Phase 2 — rollup re-point + explanation-format stamp.
 *
 * Covers three foxy-side Phase 2 changes:
 *
 * 1. topic_mastery → topic_mastery_rollup re-point (route.ts intent-chip
 *    mastery injection). The old read was silently broken twice: it selected
 *    a nonexistent `topic` column (query errored every call) and
 *    numeric-compared the TEXT `mastery_level` column against 0.5 (always
 *    false) — both no-oped inside the try/catch, so the weak_areas /
 *    study_today chips never received real data. Pins the fixed query shape
 *    (topic_tag select, mastery_probability ordering/threshold) and the
 *    absence of the two broken shapes.
 *
 * 2. P10 goal wiring: ff_goal_aware_foxy is evaluated ONCE at the route and
 *    the resolved academic goal is threaded into loadCognitiveContext (and
 *    from there into the deriveNextAction inputs) only when the flag is ON.
 *    The loader and the learner-model facade stay flag-free.
 *
 * 3. D8 formatUsed stamp: identifyExplanationFormat unit behavior + the
 *    additive `formatUsed` field on BOTH existing foxy.chat audit sinks
 *    (blocking route.ts + streaming.ts) — no new table.
 *
 * Source-pin style mirrors adaptive-differential.test.ts (route.ts is a 3.4k
 * LOC handler; pinning the query/stamp shapes is the cheap, stable check).
 * Owning agent: ai-engineer. Correctness reviewer: assessment.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { identifyExplanationFormat } from '@/app/api/foxy/_lib/explanation-format';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), 'utf-8');
}

/** Strip comments so negative pins never trip on RCA prose naming the old broken shapes. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1 ');
}

const ROUTE = 'src/app/api/foxy/route.ts';
const STREAMING = 'src/app/api/foxy/_lib/streaming.ts';
const COGNITIVE_CONTEXT = 'src/app/api/foxy/_lib/cognitive-context.ts';

// ─── 1. topic_mastery_rollup re-point ────────────────────────────────────────

describe('intent-chip mastery read re-points to topic_mastery_rollup', () => {
  const code = codeOnly(readSource(ROUTE));

  it('queries the topic_mastery_rollup view with topic_tag + mastery_probability + total_attempts', () => {
    expect(code).toMatch(/\.from\('topic_mastery_rollup'\)/);
    expect(code).toMatch(
      /'topic_tag,\s*mastery_percent,\s*mastery_probability,\s*total_attempts'/,
    );
    // Ordered weakest-first by the numeric probability, not the text label.
    expect(code).toMatch(/\.order\('mastery_probability', \{ ascending: true \}\)/);
  });

  it('weak filter: named threshold constant + evidence floor (assessment mandate 2026-08-05)', () => {
    // Threshold is IMPORTED from the learner-model facade, never hardcoded:
    // no `< 0.5` literal in the weak filter.
    expect(code).toMatch(
      /import \{\s*WEAK_AREA_CHIP_THRESHOLD,\s*WEAK_AREA_MIN_ATTEMPTS,\s*\} from '@alfanumrik\/lib\/learner-model'/,
    );
    expect(code).toMatch(/mastery_probability \?\? 0\) < WEAK_AREA_CHIP_THRESHOLD/);
    expect(code).not.toMatch(/mastery_probability \?\? 0\) < 0\.5/);
    // Evidence floor: rows with total_attempts < WEAK_AREA_MIN_ATTEMPTS are
    // excluded from the weak set (thin BKT evidence ≠ "weak").
    expect(code).toMatch(/total_attempts \?\? 0\) >= WEAK_AREA_MIN_ATTEMPTS/);
  });

  it('named constants carry the assessment-mandated values (0.5 cut, 3-attempt floor)', async () => {
    const thresholds = await import('@alfanumrik/lib/learner-model');
    expect(thresholds.WEAK_AREA_CHIP_THRESHOLD).toBe(0.5);
    expect(thresholds.WEAK_AREA_MIN_ATTEMPTS).toBe(3);
  });

  it('grade/subject/student scoping is applied to the rollup read', () => {
    // The rollup read block carries all three .eq scopes (P12: no
    // wrong-grade mastery context can be injected into the prompt).
    const block = code.slice(code.indexOf("from('topic_mastery_rollup')"));
    const window = block.slice(0, 500);
    expect(window).toMatch(/\.eq\('student_id', studentId\)/);
    expect(window).toMatch(/\.eq\('subject', subject\)/);
    expect(window).toMatch(/\.eq\('grade', grade\)/);
  });

  it('the two silently-broken shapes are gone (nonexistent topic column; numeric compare of text mastery_level)', () => {
    // Old table read with the ghost `topic` column select.
    expect(code).not.toMatch(/\.from\('topic_mastery'\)/);
    expect(code).not.toMatch(/'topic,\s*mastery_level/);
    // Old numeric comparison of the TEXT mastery_level column.
    expect(code).not.toMatch(/mastery_level \?\? 0\) < 0\.5/);
    expect(code).not.toMatch(/\.order\('mastery_level'/);
  });
});

// ─── 2. P10 goal threading into the next-action call path ───────────────────

describe('P10: academic goal threads into deriveNextAction only under ff_goal_aware_foxy', () => {
  it('route evaluates ff_goal_aware_foxy once and passes the goal into loadCognitiveContext', () => {
    const code = codeOnly(readSource(ROUTE));
    // Exactly ONE flag evaluation (hoisted above the context load).
    const evals = code.match(/isFeatureEnabled\('ff_goal_aware_foxy'/g) ?? [];
    expect(evals).toHaveLength(1);
    // Goal is threaded gated on the flag verdict — OFF ⇒ null ⇒ pre-P10 ladder.
    expect(code).toMatch(
      /useExpandedPersona && academicGoal \? \{ code: academicGoal \} : null/,
    );
  });

  it('cognitive-context accepts the goal param and forwards it to deriveNextAction, flag-free', () => {
    const code = codeOnly(readSource(COGNITIVE_CONTEXT));
    expect(code).toMatch(/academicGoal: \{ code: string \} \| null = null/);
    // Forwarded into the ladder inputs.
    expect(code).toMatch(/academicGoal,\s*\}\);/);
    // The loader stays flag-free (flag evaluation lives at the route).
    expect(code).not.toMatch(/isFeatureEnabled/);
    expect(code).not.toMatch(/ff_goal_aware_foxy/);
  });

  it('cognitive-context re-exports the canonical learner-model ladder (no local shadow copy)', () => {
    const code = codeOnly(readSource(COGNITIVE_CONTEXT));
    expect(code).toMatch(/from '@alfanumrik\/lib\/learner-model'/);
    expect(code).toMatch(/export \{ deriveNextAction \}/);
    expect(code).not.toMatch(/export function deriveNextAction/);
  });
});

// ─── 3. D8 explanation-format stamp ─────────────────────────────────────────

describe('identifyExplanationFormat (pure)', () => {
  const blocks = (...types: string[]) => ({ blocks: types.map((type) => ({ type })) });

  it('returns null when no validated structured payload exists', () => {
    expect(identifyExplanationFormat(null)).toBeNull();
    expect(identifyExplanationFormat(undefined)).toBeNull();
    expect(identifyExplanationFormat({ blocks: [] })).toBeNull();
    expect(identifyExplanationFormat({ blocks: [null, { type: null }] })).toBeNull();
  });

  it('classifies prose-shaped turns as paragraph', () => {
    expect(identifyExplanationFormat(blocks('paragraph'))).toBe('paragraph');
    expect(identifyExplanationFormat(blocks('paragraph', 'definition', 'answer', 'exam_tip'))).toBe('paragraph');
    expect(identifyExplanationFormat(blocks('math', 'code'))).toBe('paragraph');
  });

  it('classifies worked sequences as steps', () => {
    expect(identifyExplanationFormat(blocks('paragraph', 'step', 'answer'))).toBe('steps');
    expect(identifyExplanationFormat(blocks('vertical_math'))).toBe('steps');
  });

  it('classifies example-led turns as example', () => {
    expect(identifyExplanationFormat(blocks('paragraph', 'example'))).toBe('example');
  });

  it('classifies visual turns as diagram', () => {
    expect(identifyExplanationFormat(blocks('paragraph', 'diagram'))).toBe('diagram');
    expect(identifyExplanationFormat(blocks('mermaid'))).toBe('diagram');
    expect(identifyExplanationFormat(blocks('map', 'step'))).toBe('diagram');
  });

  it('classifies drilled turns as practice (highest precedence)', () => {
    expect(identifyExplanationFormat(blocks('paragraph', 'mcq'))).toBe('practice');
    expect(identifyExplanationFormat(blocks('question'))).toBe('practice');
    expect(identifyExplanationFormat(blocks('diagram', 'step', 'example', 'mcq'))).toBe('practice');
  });
});

describe('formatUsed is stamped onto BOTH existing foxy.chat audit sinks', () => {
  for (const file of [ROUTE, STREAMING]) {
    it(`${file} stamps formatUsed via identifyExplanationFormat (additive field, existing sink)`, () => {
      const code = codeOnly(readSource(file));
      expect(code).toMatch(/formatUsed: identifyExplanationFormat\(structured\)/);
    });
  }

  it('no new table/write was introduced for the stamp', () => {
    const helper = codeOnly(readSource('src/app/api/foxy/_lib/explanation-format.ts'));
    // Pure classifier: no Supabase client, no I/O.
    expect(helper).not.toMatch(/supabase/i);
    expect(helper).not.toMatch(/\.from\(/);
    expect(helper).not.toMatch(/fetch\(/);
  });
});
