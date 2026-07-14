/**
 * Phase 0.1 (P12) — output-guard word-masking regression.
 *
 * Root bug: `validateOutput`'s substring BLOCKLIST used to rewrite bare-substring
 * matches to `***`, censoring legitimate CBSE vocabulary that merely *contains*
 * a token — "assertive" → "***ertive", "class" → "cl***", "passage" → "p***age",
 * "shell" → "s***", "sexual reproduction" → "***ual reproduction". That masked
 * text reached students on the legacy/fallback Foxy path.
 *
 * This suite locks BOTH directions of the P12 contract:
 *   (1) legitimate academic vocabulary passes through UNMASKED, and
 *   (2) genuinely unsafe content is STILL blocked by the word-boundary-safe
 *       `screenStudentFacingText` backstop (the real student-facing blocker).
 *
 * Over-masking is a P12 violation in the other direction (it breaks real
 * lessons), so the PASS set is as load-bearing as the BLOCK set.
 *
 * Owner: ai-engineer. Enforces: P12 (AI Safety). Reviewer: assessment, testing.
 */

import { describe, it, expect } from 'vitest';
import {
  validateOutput,
  SAFE_ABSTAIN_MESSAGE,
} from '@alfanumrik/lib/ai/validation/output-guard';
import { screenStudentFacingText } from '@alfanumrik/lib/ai/validation/output-screen';

// Each entry is a realistic student-facing sentence containing a curriculum word
// that collides with an output-guard BLOCKLIST substring
// ('ass' | 'hell' | 'sex' | 'crap' | ...). The masking bug censored every one.
const ACADEMIC_SENTENCES: Array<[string, string, string]> = [
  // [label, sentence, the exact word that MUST survive verbatim]
  ['assertive', 'Being assertive means stating your view clearly and respectfully.', 'assertive'],
  ['assertion', 'Every assertion in a geometry proof must be justified by a theorem.', 'assertion'],
  ['assert', 'We assert that the two triangles are congruent.', 'assert'],
  ['class', 'In a class of 40 students, 24 chose science as an elective.', 'class'],
  ['classify', 'Scientists classify living things into five kingdoms.', 'classify'],
  ['classroom', 'The classroom has thirty desks and a smart board.', 'classroom'],
  ['pass', 'Light rays pass through the convex lens and converge at the focus.', 'pass'],
  ['passage', 'Read the passage carefully and answer the questions that follow.', 'passage'],
  ['passive', 'The passive voice is common in scientific report writing.', 'passive'],
  ['assess', 'You should assess the reasoning before you accept the conclusion.', 'assess'],
  ['assessment', 'This formative assessment checks how well you understood the chapter.', 'assessment'],
  ['mass', 'The mass of the object stays constant even on the Moon.', 'mass'],
  ['brass', 'An alloy of copper and zinc is called brass.', 'brass'],
  ['grass', 'Green grass converts sunlight into food through photosynthesis.', 'grass'],
  ['compass', 'Use a compass to draw a circle of radius five centimetres.', 'compass'],
  ['embarrass', 'Mistakes should not embarrass you; they help you learn.', 'embarrass'],
  ['associate', 'We associate lightning with a sudden build-up of static charge.', 'associate'],
  ['essay', 'Write a short essay on the importance of the water cycle.', 'essay'],
  ['hello', 'Say hello to your science tutor and begin the lesson.', 'hello'],
  ['shell (electron shell)', 'The outermost shell of the atom holds the valence electrons.', 'shell'],
  ['sexual reproduction', 'In sexual reproduction in flowering plants, pollen fertilises the ovule.', 'sexual reproduction'],
  ['therapist', 'A speech therapist helps children pronounce difficult words clearly.', 'therapist'],
  ['analysis', 'Dimensional analysis checks whether a physics equation is consistent.', 'analysis'],
  // ── Phase 0.1 review (assessment) — additional high-frequency CBSE terms that
  // collide with the 'ass' / 'sex' BLOCKLIST substrings. Each MUST survive
  // unmasked AND MUST NOT trip a word-boundary HARD_BLOCK pattern. ──
  // Chemistry
  ['potassium', 'The element potassium reacts vigorously with cold water.', 'potassium'],
  ['molasses', 'Sugar factories produce molasses as a thick brown by-product.', 'molasses'],
  ['glass', 'Light bends as it passes from air into a glass slab.', 'glass'],
  // Physics / Geography
  ['biomass', 'Farmers use biomass such as crop waste as a renewable energy source.', 'biomass'],
  ['landmass', 'Asia is the largest landmass on Earth.', 'landmass'],
  ['sextant', 'A sextant measures the angle between a star and the horizon.', 'sextant'],
  ['Assam', 'Assam is famous for its tea gardens and the Brahmaputra river.', 'Assam'],
  ['Sussex', 'The county of Sussex lies on the south coast of England.', 'Sussex'],
  ['Essex', 'Essex is a county to the north-east of London.', 'Essex'],
  // Civics / Political Science
  ['assembly', 'The state legislative assembly makes laws for the state.', 'assembly'],
  ['ambassador', 'An ambassador represents their country in a foreign nation.', 'ambassador'],
  ['harassment', 'The Constitution protects citizens from harassment and unfair treatment.', 'harassment'],
  ['association', 'Freedom of association lets citizens form unions and clubs.', 'association'],
  // History
  ['assassination', 'The assassination of Mahatma Gandhi took place in 1948.', 'assassination'],
  ['assassinate', 'The conspirators plotted to assassinate the emperor.', 'assassinate'],
  // Maths / Science reasoning
  ['assume', 'In this problem we assume the surface is frictionless.', 'assume'],
  ['assumption', 'State the assumption behind the ideal gas law.', 'assumption'],
  ['classical', "Newton's classical mechanics describes the motion of everyday objects.", 'classical'],
];

describe('Criterion 1 — legitimate CBSE vocabulary is NEVER masked', () => {
  it.each(ACADEMIC_SENTENCES)(
    'validateOutput does not censor %s (no *** rewrite)',
    (_label, sentence, word) => {
      const result = validateOutput(sentence, { grade: '9', subject: 'science' });
      // The whole point: sanitizedContent is byte-identical to the input — the
      // destructive substring `***` rewrite is gone.
      expect(result.sanitizedContent).toBe(sentence);
      expect(result.sanitizedContent).not.toContain('***');
      // The exact curriculum word survives verbatim.
      expect(result.sanitizedContent).toContain(word);
    },
  );

  it.each(ACADEMIC_SENTENCES)(
    'screenStudentFacingText passes %s (safe, not blocklisted)',
    (_label, sentence) => {
      const screen = screenStudentFacingText(sentence, { grade: '9', subject: 'science' });
      expect(screen.safe).toBe(true);
      expect(screen.categories).not.toContain('blocklist');
    },
  );

  it('the exact over-masking examples from the bug report survive', () => {
    // Regression pins for the three cases named in the incident.
    for (const [word, expected] of [
      ['assertive', 'assertive'],
      ['class', 'class'],
      ['passage', 'passage'],
    ] as const) {
      const sentence = `The word "${word}" appears in the CBSE textbook chapter.`;
      const out = validateOutput(sentence).sanitizedContent;
      expect(out).toBe(sentence);
      expect(out).toContain(expected);
      // Explicitly assert the old broken outputs never occur.
      expect(out).not.toContain('***ertive');
      expect(out).not.toContain('cl***');
      expect(out).not.toContain('p***age');
    }
  });
});

const UNSAFE_TEXTS: Array<[string, string]> = [
  ['profanity (fuck)', 'This is a load of fucking nonsense, kid.'],
  ['profanity (shit)', 'That answer is shit and you know it.'],
  ['slur (n-word)', 'You are a nigger.'],
  ['slur (faggot)', 'Only a faggot would get this wrong.'],
  ['self-harm incitement', 'You should just kill yourself.'],
  ['self-harm (kys)', 'Nobody likes you, kys.'],
  ['self-harm (go die)', 'Go and die already.'],
  ['Hindi abuse (Devanagari)', 'यह जवाब चूतिया है।'],
  ['Hindi abuse (Hinglish)', 'Tu bilkul chutiya hai.'],
];

describe('Criterion 2 — genuinely unsafe content is STILL blocked', () => {
  it.each(UNSAFE_TEXTS)('screenStudentFacingText blocks %s', (_label, text) => {
    const screen = screenStudentFacingText(text, { grade: '9', subject: 'science' });
    expect(screen.safe).toBe(false);
    expect(screen.categories).toContain('blocklist');
  });

  it('validateOutput still records an advisory flag for blocklisted profanity', () => {
    // The warn/flag signal is preserved (valid=false) even though it no longer
    // mutates the content — telemetry parity for ops.
    const result = validateOutput('This is fucking wrong.');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // ...but it must NOT have masked anything (non-destructive).
    expect(result.sanitizedContent).toBe('This is fucking wrong.');
  });
});

describe('SAFE_ABSTAIN_MESSAGE is a clean, bilingual, self-screening fallback', () => {
  it('is bilingual (English + Devanagari) and age-appropriate', () => {
    expect(SAFE_ABSTAIN_MESSAGE.length).toBeGreaterThan(10);
    // Contains Devanagari (Hindi) — P7 bilingual.
    expect(/[ऀ-ॿ]/.test(SAFE_ABSTAIN_MESSAGE)).toBe(true);
    // Contains English.
    expect(/[A-Za-z]/.test(SAFE_ABSTAIN_MESSAGE)).toBe(true);
  });

  it('itself passes the screen (re-screening it is a no-op)', () => {
    const screen = screenStudentFacingText(SAFE_ABSTAIN_MESSAGE, { grade: '9', subject: 'science' });
    expect(screen.safe).toBe(true);
    expect(screen.categories).not.toContain('blocklist');
  });
});
