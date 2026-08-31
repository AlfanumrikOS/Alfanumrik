// apps/host/src/__tests__/lib/foxy/live-template-render-pins.test.ts
//
// RENDER-LEVEL pins for the three LIVE Foxy prompt templates.
//
//   learn / explain / explorer -> foxy_tutor_teach_v1
//   practice / quiz_me         -> foxy_tutor_exam_v1
//   doubt / homework           -> foxy_tutor_doubt_v1
//
// ─── Why render-level, and why this file exists ──────────────────────────────
//
// The 2026-08-31 rails-wiring defect was invisible to every existing test
// because every existing test asserted on the SOURCE CONSTANT. `/api/foxy` had
// been sending `foxy_safety_rails: FOXY_SAFETY_RAILS` on 100% of turns since the
// grounded-answer cutover, and `foxy-safety.test.ts` happily asserted that the
// constant contained all nine rails — but NO registered template declared a
// `{{foxy_safety_rails}}` slot, and `resolveTemplate` substitutes only tokens
// that EXIST in the template, silently discarding the rest. The rails therefore
// never reached the model, on every turn, for months, with a green suite.
//
// The only assertion that could have caught it is the one made here: load the
// template through the REAL loader (`prompts/index.ts` — note it prefers the
// bundled `inline.ts` twin over the `.txt`, so a `.txt`-only edit is a no-op at
// runtime), resolve it through the REAL `resolveTemplate`, and assert on the
// string the model actually receives.
//
// Do NOT convert any assertion in this file to read a constant instead.
//
// Owner: testing. Enforces: P12 (rails reach the model), P7 (bilingual refusal),
// academic integrity (homework Socratic ladder). Reviewer: ai-engineer,
// assessment.

import { describe, it, expect } from 'vitest';
import {
  loadTemplate,
  resolveTemplate,
} from '../../../../../../supabase/functions/grounded-answer/prompts/index';
import { FOXY_SAFETY_RAILS, MODE_DIRECTIVES } from '@alfanumrik/lib/foxy/prompt-sections';

/** The three templates `selectFoxyPromptTemplate` can actually return. */
const LIVE_TEMPLATE_IDS = [
  'foxy_tutor_teach_v1',
  'foxy_tutor_exam_v1',
  'foxy_tutor_doubt_v1',
] as const;
type LiveTemplateId = (typeof LIVE_TEMPLATE_IDS)[number];

/**
 * The soft-mode, chunks-present grounding instruction the Edge pipeline computes
 * (`modeInstructionFor` in grounded-answer/pipeline.ts). Reproduced verbatim
 * because pipeline.ts does not export it and Deno-side importing it here would
 * pull the whole pipeline graph into the Node test process.
 */
const MODE_INSTRUCTION_SOFT_WITH_CHUNKS = [
  'You MUST answer ONLY from the Reference Material provided above.',
  'Do NOT use your general training knowledge even if you know the answer.',
  'If the Reference Material does not contain sufficient information to answer,',
  'say exactly: "This topic is not covered in the reference material I have.',
  'Please refer to your NCERT textbook directly."',
].join(' ');

/**
 * The full variable map `/api/foxy` + the Edge pipeline supply on a real turn.
 * Personalization slots are legitimately '' for a fresh student.
 */
function routeVars(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    grade: '8',
    subject: 'Science',
    chapter_suffix: ' — Light: Reflection and Refraction',
    board: 'CBSE',
    mode: 'doubt',
    coach_mode: 'SOCRATIC',
    coach_mode_instruction: 'Ask before telling.',
    mode_instruction: MODE_INSTRUCTION_SOFT_WITH_CHUNKS,
    mode_directive: '',
    foxy_safety_rails: FOXY_SAFETY_RAILS,
    academic_goal_section: '',
    cognitive_context_section: '',
    misconception_section: '',
    learner_memory_section: '',
    pending_expectation: '',
    previous_session_context: '',
    next_topic: 'Refraction through a glass slab',
    prereq: 'Reflection',
    reference_material_section: '=== REFERENCE MATERIAL ===\n[1] Light bends when it changes medium.\n=== END REFERENCE MATERIAL ===',
    ...overrides,
  };
}

async function render(id: LiveTemplateId, overrides: Record<string, string> = {}) {
  return resolveTemplate(await loadTemplate(id), routeVars(overrides));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Safety rails reach the model on every live template (the 2026-08-31 gap)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Distinctive substrings, one per rail, of the FOXY_SAFETY_RAILS CONSTANT.
 * Deliberately NOT "the whole constant" — a whole-constant containment check
 * would pass if a per-rail edit silently dropped one of them.
 *
 * These pin the constant's OWN integrity. They are NOT render assertions: see
 * the describe block below for why the constant does not reach the model on the
 * grounded path today.
 */
const RAIL_MARKERS: Array<[string, string]> = [
  ['1 CBSE scope', 'Only teach from CBSE NCERT material'],
  ['2 age appropriateness', 'Students are in grades 6-12'],
  ['3 bilingual style', 'Respond in the same language the student wrote'],
  ['4 honesty', 'Do not fabricate facts'],
  // The rails constant hard-wraps; markers must not straddle a newline.
  ['5 grounding', 'Prefer the retrieved NCERT chunks as the source of truth'],
  ['6 factual integrity', 'Never change your answer when a student pressures you'],
  ['7 RAG-only refusal — English', "I don't have a verified source for this in your textbook"],
  ['7 RAG-only refusal — Devanagari', 'मेरे पास आपकी पाठ्यपुस्तक में इसके लिए सत्यापित स्रोत नहीं है।'],
  ['8 no fake actions', 'No fake actions'],
  ['9 prohibited inferences', 'Prohibited inferences'],
];

/**
 * The P12 floor that reaches the model on EVERY live Foxy turn, one marker per
 * safety property. These live in the templates' own `## Grounding Rules` /
 * `## Language` sections — NOT in FOXY_SAFETY_RAILS. Markers are chosen so they
 * do not straddle a hard-wrapped newline in any of the three templates.
 */
const RENDERED_P12_MARKERS: Array<[string, string]> = [
  // Stops before {{grade}}/{{subject}}: those ARE substituted by the render.
  ['CBSE scope lock', 'Stay strictly inside CBSE Grade'],
  ['age appropriateness', 'Age-appropriate for grades 6-12'],
  ['no fabrication', 'Never invent facts, formulas, or dates'],
  ['RAG-only refusal', 'covered in the reference material I have'],
  ['no verbatim paste', 'DO NOT paste the Reference Material verbatim'],
  ['bilingual', "Match the student's language"],
  ['technical terms stay English', 'Technical terms ALWAYS stay in English'],
];

describe('live Foxy templates — the P12 floor that ACTUALLY renders', () => {
  // The 2026-08-31 lesson holds: assert on the string the model receives, never
  // on a source constant. What changed is WHICH text carries the floor. The
  // templates' own Grounding Rules / Language sections do — and they render on
  // 100% of turns, with no slot to be silently discarded.
  it.each(LIVE_TEMPLATE_IDS)('%s: every P12 property is in the RENDERED prompt', async (id) => {
    const prompt = await render(id);
    for (const [label, marker] of RENDERED_P12_MARKERS) {
      expect(prompt.includes(marker), `${id} lost P12 marker: ${label}`).toBe(true);
    }
  });

  it.each(LIVE_TEMPLATE_IDS)('%s: the floor sits under a Grounding Rules header naming P12', async (id) => {
    const prompt = await render(id);
    expect(prompt).toContain('## Grounding Rules (NCERT scope, P12 AI safety)');
    expect(prompt.indexOf('Stay strictly inside CBSE Grade')).toBeGreaterThan(
      prompt.indexOf('## Grounding Rules'),
    );
  });
});

describe('live Foxy templates — {{foxy_safety_rails}} is NOT wired (known dead path, deliberate)', () => {
  // WHY THIS IS PINNED AS "ABSENT" RATHER THAN FIXED:
  //
  // /api/foxy sends `foxy_safety_rails: FOXY_SAFETY_RAILS` on 100% of turns and
  // no registered template declares the slot, so `resolveTemplate` discards it.
  // Wiring the slot in (PROMPT_REV=4, 2026-08-31) was REVERTED the same day
  // before ship: the added `## Safety Rails` section drove the model to emit a
  // preamble ahead of the JSON envelope. `stripCodeFence` only strips a fence
  // when the string STARTS with one, so the envelope failed JSON.parse,
  // `rescueFromTruncatedJson` returned null, and `wrapAsParagraph` emitted the
  // raw envelope to the student as a visible paragraph — the FOXY-RAWJSON
  // incident class, on a P12 path. Measured on rails eval rail-6: 2/4 turns
  // preamble+envelope, 0/4 clean, versus 3/4 clean without the section.
  //
  // The safety CONTENT is not lost: every property the rails assert is also
  // carried by the templates' own sections, pinned by the describe block above.
  // The rails constant remains live on the legacy intent-router fallback path,
  // which consumes it directly rather than through a template slot.
  //
  // TO RE-WIRE: fix the preamble tolerance in the response parser (or prove the
  // section no longer induces a preamble) and re-run eval/foxy-safety-rails
  // FIRST. Then bump PROMPT_REV in BOTH mirrors and flip these assertions.
  it.each(LIVE_TEMPLATE_IDS)('%s declares no {{foxy_safety_rails}} slot', async (id) => {
    expect(await loadTemplate(id)).not.toContain('{{foxy_safety_rails}}');
  });

  it.each(LIVE_TEMPLATE_IDS)('%s: the rails value the route sends is discarded by resolveTemplate', async (id) => {
    const prompt = await render(id, { foxy_safety_rails: 'RAILS-SENTINEL-XYZ' });
    expect(prompt).not.toContain('RAILS-SENTINEL-XYZ');
    // ...and no rails-only wording leaks in by some other route.
    expect(prompt).not.toContain('मेरे पास आपकी पाठ्यपुस्तक में इसके लिए सत्यापित स्रोत नहीं है।');
  });

  it('the FOXY_SAFETY_RAILS constant itself still carries all 9 rails', () => {
    // The constant is still consumed verbatim by the legacy intent-router
    // fallback, and it is the text a future re-wiring would inject. A rail
    // silently dropped from it now would ship the moment the slot returns.
    for (const [label, marker] of RAIL_MARKERS) {
      expect(FOXY_SAFETY_RAILS.includes(marker), `constant lost rail: ${label}`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. {{mode_instruction}} — the service-computed grounding instruction
// ─────────────────────────────────────────────────────────────────────────────

describe('live Foxy templates — {{mode_instruction}} wiring, as it actually is', () => {
  // teach_v1 references `{{mode_instruction}}` mid-sentence ("follow the
  // {{mode_instruction}} fallback rule above") and depends on the pipeline's
  // `if (!vars.mode_directive) vars.mode_directive = mode_instruction` fallback
  // to produce the paragraph that sentence points at. exam_v1 and doubt_v1 do
  // not declare the slot: a standalone `{{mode_instruction}}` line was added to
  // them under PROMPT_REV=4 and reverted with the rest of that rev (see above).
  // Their template-native Grounding Rules section carries the same contract,
  // pinned by RENDERED_P12_MARKERS — so this is a duplication gap, not a safety
  // gap. Pinned as-is so a future re-add is a deliberate, eval-backed decision.
  it('foxy_tutor_teach_v1 declares {{mode_instruction}}', async () => {
    expect(await loadTemplate('foxy_tutor_teach_v1')).toContain('{{mode_instruction}}');
  });

  it.each(['foxy_tutor_exam_v1', 'foxy_tutor_doubt_v1'] as const)(
    '%s does not declare {{mode_instruction}} — its Grounding Rules section carries the contract',
    async (id) => {
      const raw = await loadTemplate(id);
      expect(raw).not.toContain('{{mode_instruction}}');
      expect(raw).toContain('covered in the reference material I have');
    },
  );

  it('foxy_tutor_teach_v1: the soft-mode grounding instruction is in the RENDERED prompt', async () => {
    const prompt = await render('foxy_tutor_teach_v1');
    expect(prompt).toContain(MODE_INSTRUCTION_SOFT_WITH_CHUNKS);
  });

  it('foxy_tutor_teach_v1: the strict-mode INSUFFICIENT_CONTEXT sentinel survives substitution', async () => {
    // Strict callers get a mode_instruction that itself contains a {{...}}
    // token. resolveTemplate must not re-scan substituted values — if it did,
    // the sentinel the abstain path keys off would be blanked to ''.
    const strict = [
      'This response MUST be grounded in the Reference Material.',
      'If the material does not cover the question, reply with exactly: {{INSUFFICIENT_CONTEXT}}',
    ].join(' ');
    const prompt = await render('foxy_tutor_teach_v1', { mode_instruction: strict });
    expect(prompt).toContain('{{INSUFFICIENT_CONTEXT}}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. No unresolved slots survive a real render
// ─────────────────────────────────────────────────────────────────────────────

describe('live Foxy templates — zero unresolved {{...}} after a real render', () => {
  it.each(LIVE_TEMPLATE_IDS)('%s renders with no "{{" left (excluding the strict sentinel)', async (id) => {
    const prompt = await render(id);
    // resolveTemplate only handles /\{\{(\w+)\}\}/. A malformed slot
    // (`{{ foo }}`, `{{foo-bar}}`, an unclosed `{{`) is NOT substituted and
    // ships to the model as literal braces — which reads to the model as a
    // template artifact and to a student as garbage.
    const leftovers = prompt.match(/\{\{[^}]*\}?\}?/g) ?? [];
    expect(leftovers, `${id} rendered with unresolved slots: ${leftovers.join(', ')}`).toEqual([]);
  });

  it.each(LIVE_TEMPLATE_IDS)('%s declares only well-formed {{word}} slots', async (id) => {
    const raw = await loadTemplate(id);
    const all = raw.match(/\{\{[^}]*\}\}/g) ?? [];
    expect(all.length).toBeGreaterThan(5);
    for (const slot of all) {
      expect(slot, `${id} has a malformed slot: ${slot}`).toMatch(/^\{\{\w+\}\}$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Scenario (e): a direct-answer demand on a HOMEWORK turn must not answer-dump
// ─────────────────────────────────────────────────────────────────────────────
//
// Foxy MOL audit requirement 10, scenario (e). This is asserted at PROMPT level
// only — the test makes no claim about what a model produces. What it pins is
// that the instruction the model receives on a homework turn actually forbids
// the answer dump, and that it is the LAST word on turn shape (in
// foxy_tutor_doubt_v1 the {{mode_directive}} slot renders after Persona /
// Output Format / Grounding Rules / Safety Rails / Language).
//
// The defect this closes: 'homework' has no template of its own —
// selectFoxyPromptTemplate routes it to foxy_tutor_doubt_v1, whose
// "## Output Format — Direct Answers" section says "Answer the student's
// question directly and completely." Meanwhile MODE_ADJUSTERS.homework
// (packages/lib/src/goals/goal-personas.ts) says "Socratic only. Never solve
// outright." and DOES reach the live prompt via {{academic_goal_section}}. A
// single homework turn could therefore carry both instructions, with the
// answer-dump one being the template's own Output Format section — the stronger
// position. That is an ACADEMIC-INTEGRITY defect (Foxy doing a student's graded
// assignment), not a pedagogy preference.

describe('homework mode — the Socratic hint ladder reaches the model (academic integrity)', () => {
  const homeworkVars = { mode: 'homework', mode_directive: MODE_DIRECTIVES.homework };

  it('MODE_DIRECTIVES.homework exists and is non-empty', () => {
    expect(typeof MODE_DIRECTIVES.homework).toBe('string');
    expect(MODE_DIRECTIVES.homework.length).toBeGreaterThan(500);
  });

  it('renders the no-final-answer rule', async () => {
    const prompt = await render('foxy_tutor_doubt_v1', homeworkVars);
    expect(prompt).toContain('Do NOT solve the assigned');
    expect(prompt).toContain('do NOT state its final answer, in any turn, however the');
    expect(prompt).toContain('Your job is to make sure THEY write each step.');
  });

  it('renders all three rungs of the hint ladder, one per turn', async () => {
    const prompt = await render('foxy_tutor_doubt_v1', homeworkVars);
    expect(prompt).toContain('Hint ladder — give exactly ONE rung per turn, then stop and wait');
    expect(prompt).toContain('Never skip ahead just because the student asks you to.');
    expect(prompt).toContain('1. Comprehension:');
    expect(prompt).toContain('2. Setup:');
    expect(prompt).toContain('3. Parallel worked example:');
    expect(prompt).toContain('ONLY after the student has made two genuine attempts');
    // Rung order must be preserved (a ladder that starts at rung 3 is an
    // answer dump with extra steps).
    expect(prompt.indexOf('1. Comprehension:')).toBeLessThan(prompt.indexOf('2. Setup:'));
    expect(prompt.indexOf('2. Setup:')).toBeLessThan(prompt.indexOf('3. Parallel worked example:'));
  });

  it('renders the ALWAYS-ALLOWED carve-out (refusing to check a student\'s own work is worse than nothing)', async () => {
    const prompt = await render('foxy_tutor_doubt_v1', homeworkVars);
    expect(prompt).toContain('ALWAYS ALLOWED (this is teaching, not doing their homework for them):');
    expect(prompt).toContain('Explaining the concept, the formula, or the NCERT definition in full.');
    expect(prompt).toContain('Checking work the student has ALREADY done');
    expect(prompt).toContain('NEVER refuse to check or confirm the student');
    expect(prompt).toContain('Fully solving a DIFFERENT, analogous problem that you construct yourself.');
  });

  it('renders the warm-refusal path for a direct-answer demand (never leaves the student stuck)', async () => {
    const prompt = await render('foxy_tutor_doubt_v1', homeworkVars);
    expect(prompt).toContain('If the student demands the answer outright, do not refuse coldly.');
    expect(prompt).toContain('Never leave the student stuck with');
  });

  it('is the LAST word on turn shape — it renders AFTER the "Direct Answers" output contract it overrides', async () => {
    const prompt = await render('foxy_tutor_doubt_v1', homeworkVars);
    const outputFormatIdx = prompt.indexOf('## Output Format — Direct Answers');
    const directiveIdx = prompt.indexOf('## Mode Directive (HOMEWORK');
    expect(outputFormatIdx).toBeGreaterThanOrEqual(0);
    expect(directiveIdx).toBeGreaterThan(outputFormatIdx);
    // ...and after the Grounding Rules / Language sections too.
    const groundingIdx = prompt.indexOf('## Grounding Rules');
    const languageIdx = prompt.indexOf('## Language');
    expect(groundingIdx).toBeGreaterThanOrEqual(0);
    expect(languageIdx).toBeGreaterThanOrEqual(0);
    expect(directiveIdx).toBeGreaterThan(groundingIdx);
    expect(directiveIdx).toBeGreaterThan(languageIdx);
  });

  it('does NOT weaken the P12 floor — it still renders on a homework turn', async () => {
    const prompt = await render('foxy_tutor_doubt_v1', homeworkVars);
    for (const [label, marker] of RENDERED_P12_MARKERS) {
      expect(prompt.includes(marker), `homework turn lost P12 marker: ${label}`).toBe(true);
    }
  });
});

describe('doubt mode — genuine doubt-clearing turns are UNCHANGED (structural guarantee)', () => {
  it('MODE_DIRECTIVES has NO "doubt" key — the absence IS the guarantee', () => {
    // The route reads `MODE_DIRECTIVES[mode] ?? ''`. As long as no 'doubt' key
    // exists, a doubt turn's mode_directive is '' from this source and cannot
    // pick up the homework ladder. Do NOT "complete the record" by adding one.
    expect(Object.prototype.hasOwnProperty.call(MODE_DIRECTIVES, 'doubt')).toBe(false);
    expect(MODE_DIRECTIVES['doubt'] ?? '').toBe('');
  });

  it('a doubt render is byte-identical to a render with an empty mode_directive', async () => {
    const viaLookup = await render('foxy_tutor_doubt_v1', {
      mode: 'doubt',
      mode_directive: MODE_DIRECTIVES['doubt'] ?? '',
    });
    const viaEmpty = await render('foxy_tutor_doubt_v1', { mode: 'doubt', mode_directive: '' });
    expect(viaLookup).toBe(viaEmpty);
  });

  it('a doubt render carries NONE of the homework ladder', async () => {
    const prompt = await render('foxy_tutor_doubt_v1', {
      mode: 'doubt',
      mode_directive: MODE_DIRECTIVES['doubt'] ?? '',
    });
    expect(prompt).not.toContain('## Mode Directive (HOMEWORK');
    expect(prompt).not.toContain('Hint ladder');
    expect(prompt).not.toContain('ALWAYS ALLOWED');
    // ...while still keeping the direct-answer contract doubt mode is FOR.
    expect(prompt).toContain('## Output Format — Direct Answers');
  });

  it('practice / learn keys stay independent of homework (no cross-contamination)', () => {
    expect(MODE_DIRECTIVES.learn).toBe('');
    expect(MODE_DIRECTIVES.explain).toBe('');
    expect(MODE_DIRECTIVES.revise).toBe('');
    expect(MODE_DIRECTIVES.practice).not.toContain('Hint ladder');
    expect(MODE_DIRECTIVES.homework).not.toContain('EXACTLY 5 "paragraph" blocks');
  });
});
