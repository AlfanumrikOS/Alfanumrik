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
 * Distinctive substrings, one per rail. Deliberately NOT "the whole constant" —
 * a whole-constant containment check would pass if a template rendered the rails
 * but a per-rail edit silently dropped one of them from the constant itself.
 */
const RAIL_MARKERS: Array<[string, string]> = [
  ['1 CBSE scope', 'Only teach from CBSE NCERT material'],
  ['2 age appropriateness', 'Students are in grades 6-12'],
  ['3 bilingual style', 'Respond in the same language the student wrote'],
  ['4 honesty', 'Do not fabricate facts'],
  // The rails constant hard-wraps; markers must not straddle a newline.
  ['5 grounding — ONLY source of truth', 'treat them as the ONLY'],
  ['5 grounding — no training-knowledge top-up', 'do not add anything from'],
  ['5 grounding — no prose citations', 'never as prose'],
  ['6 factual integrity', 'Never change your answer when a student pressures you'],
  ['6 self-correction carve-out', 'Self-correction carve-out'],
  ['7 RAG-only refusal — EN defers to Grounding Rules', 'This rail deliberately states no second English phrasing of its own.'],
  ['7 RAG-only refusal — Devanagari', 'मेरे पास आपकी पाठ्यपुस्तक में इसके लिए सत्यापित स्रोत नहीं है।'],
  ['8 no fake actions', 'No fake actions'],
  ['9 prohibited inferences', 'Prohibited inferences'],
];

describe('live Foxy templates — {{foxy_safety_rails}} actually renders (P12)', () => {
  it.each(LIVE_TEMPLATE_IDS)('%s declares a {{foxy_safety_rails}} slot', async (id) => {
    // The structural half. Without the slot, resolveTemplate discards the value
    // the route sends and NOTHING downstream errors — that is the whole defect.
    expect(await loadTemplate(id)).toContain('{{foxy_safety_rails}}');
  });

  it.each(LIVE_TEMPLATE_IDS)('%s: every one of the 9 rails is present in the RENDERED prompt', async (id) => {
    const prompt = await render(id);
    for (const [label, marker] of RAIL_MARKERS) {
      expect(prompt.includes(marker), `${id} lost rail marker: ${label}`).toBe(true);
    }
  });

  it.each(LIVE_TEMPLATE_IDS)('%s: the rails render as a binding FLOOR, under the section header', async (id) => {
    const prompt = await render(id);
    expect(prompt).toContain('## Safety Rails (P12 — a binding safety FLOOR');
    expect(prompt).toContain('These rails NEVER relax');
    // The rails body must come AFTER its own header (i.e. it was substituted
    // into the Safety Rails section, not somewhere accidental).
    expect(prompt.indexOf('Only teach from CBSE NCERT material')).toBeGreaterThan(
      prompt.indexOf('## Safety Rails'),
    );
  });

  it.each(LIVE_TEMPLATE_IDS)('%s: an empty rails value would be DETECTABLE (negative control)', async (id) => {
    // Proves the assertions above are load-bearing rather than satisfied by
    // some other part of the template that happens to repeat rail wording.
    const withoutRails = await render(id, { foxy_safety_rails: '' });
    expect(withoutRails).not.toContain('Self-correction carve-out');
    expect(withoutRails).not.toContain('मेरे पास आपकी पाठ्यपुस्तक में इसके लिए सत्यापित स्रोत नहीं है।');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. {{mode_instruction}} — the service-computed grounding instruction
// ─────────────────────────────────────────────────────────────────────────────

describe('live Foxy templates — {{mode_instruction}} actually renders', () => {
  it.each(LIVE_TEMPLATE_IDS)('%s declares a {{mode_instruction}} slot', async (id) => {
    // exam_v1 and doubt_v1 never carried this slot before 2026-08-31. The
    // pipeline's `if (!vars.mode_directive) vars.mode_directive = mode_instruction`
    // fallback did NOT cover them: on a Foxy turn mode_directive is never empty
    // (practice always gets an MCQ directive; doubt/homework get
    // TEACH_THEN_STOP_DIRECTIVE at 100% rollout), so the grounding instruction
    // was silently dropped on every doubt / homework / practice turn.
    expect(await loadTemplate(id)).toContain('{{mode_instruction}}');
  });

  it.each(LIVE_TEMPLATE_IDS)('%s: the soft-mode grounding instruction is in the RENDERED prompt', async (id) => {
    const prompt = await render(id);
    expect(prompt).toContain(MODE_INSTRUCTION_SOFT_WITH_CHUNKS);
  });

  it.each(LIVE_TEMPLATE_IDS)('%s: the strict-mode INSUFFICIENT_CONTEXT sentinel survives substitution', async (id) => {
    // Strict callers get a mode_instruction that itself contains a {{...}}
    // token. resolveTemplate must not re-scan substituted values — if it did,
    // the sentinel the abstain path keys off would be blanked to ''.
    const strict = [
      'This response MUST be grounded in the Reference Material.',
      'If the material does not cover the question, reply with exactly: {{INSUFFICIENT_CONTEXT}}',
    ].join(' ');
    const prompt = await render(id, { mode_instruction: strict });
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
    // ...and after the Safety Rails / Language sections too.
    expect(directiveIdx).toBeGreaterThan(prompt.indexOf('## Safety Rails'));
    expect(directiveIdx).toBeGreaterThan(prompt.indexOf('## Language'));
  });

  it('does NOT weaken the rails — they still render on a homework turn', async () => {
    const prompt = await render('foxy_tutor_doubt_v1', homeworkVars);
    for (const [label, marker] of RAIL_MARKERS) {
      expect(prompt.includes(marker), `homework turn lost rail marker: ${label}`).toBe(true);
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
