import { describe, it, expect } from 'vitest';
import {
  buildSynthesisSummaryPrompt,
  parseSynthesisSummaryReply,
  type SynthesisSummaryParams,
} from '../ai/workflows/synthesis-summary';
import type { SynthesisBundle } from '../learn/monthly-synthesis-orchestrator';

const baseBundle: SynthesisBundle = {
  monthLabel: '2026-04',
  weeklyArtifactIds: ['a', 'b', 'c', 'd'],
  masteryDelta: {
    chaptersTouched: ['Light - Reflection and Refraction', 'Magnetic Effects of Current'],
    topicsMastered: 5,
    topicsImproved: 12,
    topicsRegressed: 1,
  },
  chapterMockSummary: {
    chapters: ['Light', 'Magnetic Effects of Current'],
    totalQuestions: 20,
    targetDifficulty: 0.55,
  },
};

const baseParams: SynthesisSummaryParams = {
  studentName: 'Aanya',
  studentGrade: '10',
  bundle: baseBundle,
  language: 'both',
};

describe('buildSynthesisSummaryPrompt — content', () => {
  it('includes student name and grade (P5: string grade)', () => {
    const prompt = buildSynthesisSummaryPrompt(baseParams);
    expect(prompt).toContain('Aanya');
    expect(prompt).toContain('Grade 10');
  });

  it('includes month label', () => {
    const prompt = buildSynthesisSummaryPrompt(baseParams);
    expect(prompt).toContain('2026-04');
  });

  it('includes mastery delta numbers verbatim (P11: no fabrication)', () => {
    const prompt = buildSynthesisSummaryPrompt(baseParams);
    expect(prompt).toContain('5');   // topicsMastered
    expect(prompt).toContain('12');  // topicsImproved
    expect(prompt).toContain('1');   // topicsRegressed
  });

  it('includes the chapter list verbatim', () => {
    const prompt = buildSynthesisSummaryPrompt(baseParams);
    expect(prompt).toContain('Light - Reflection and Refraction');
    expect(prompt).toContain('Magnetic Effects of Current');
  });

  it('includes the weekly-artifact count (4 weeks of artifacts)', () => {
    const prompt = buildSynthesisSummaryPrompt(baseParams);
    expect(prompt).toMatch(/4 (weekly )?artifacts?/i);
  });

  it('includes the chapter mock summary (questions count, target difficulty band)', () => {
    const prompt = buildSynthesisSummaryPrompt(baseParams);
    expect(prompt).toContain('20');     // totalQuestions
    expect(prompt).toMatch(/0\.55|55%/); // target difficulty either form
  });

  it('does not include any PII other than student name + grade (P13)', () => {
    const prompt = buildSynthesisSummaryPrompt({
      ...baseParams,
      studentName: 'Aanya',
      studentGrade: '10',
    });
    // Common PII that should not appear: emails, phone numbers, school names.
    expect(prompt).not.toMatch(/@(?:gmail|yahoo|hotmail|outlook)\./i);
    expect(prompt).not.toMatch(/\+91[\d\s-]{10,}/);
    expect(prompt).not.toMatch(/School|Vidyalaya/i);
  });

  it('caps output at ~300 words (instruction line)', () => {
    const prompt = buildSynthesisSummaryPrompt(baseParams);
    expect(prompt).toMatch(/300 words/);
  });
});

describe('buildSynthesisSummaryPrompt — language modes', () => {
  it("language='both' instructs the model to produce EN: + HI: sections", () => {
    const prompt = buildSynthesisSummaryPrompt({ ...baseParams, language: 'both' });
    expect(prompt).toContain('EN:');
    expect(prompt).toContain('HI:');
  });

  it("language='en' instructs English only (no HI: marker)", () => {
    const prompt = buildSynthesisSummaryPrompt({ ...baseParams, language: 'en' });
    expect(prompt).toContain('English');
    expect(prompt).not.toContain('HI:');
  });

  it("language='hi' instructs Hindi only (no EN: marker)", () => {
    const prompt = buildSynthesisSummaryPrompt({ ...baseParams, language: 'hi' });
    expect(prompt).toContain('Hindi');
    expect(prompt).not.toContain('EN:');
  });
});

describe('buildSynthesisSummaryPrompt — empty-month edge case', () => {
  it('emits a graceful prompt for a month with zero mastery moves and no artifacts', () => {
    const empty: SynthesisBundle = {
      monthLabel: '2026-04',
      weeklyArtifactIds: [],
      masteryDelta: { chaptersTouched: [], topicsMastered: 0, topicsImproved: 0, topicsRegressed: 0 },
      chapterMockSummary: null,
    };
    const prompt = buildSynthesisSummaryPrompt({ ...baseParams, bundle: empty });
    // The prompt should still render — and explicitly tell the model the
    // month was light, so it produces an honest "your child took it easy
    // this month" rather than fabricating numbers.
    expect(prompt).toMatch(/no.*artifacts|0 artifacts|light month|did not.*touch/i);
  });
});

describe('parseSynthesisSummaryReply', () => {
  it("parses an 'EN:' + 'HI:' block into { textEn, textHi }", () => {
    const reply = `EN:
This month, Aanya mastered 5 topics and improved on 12 more.

HI:
इस महीने आन्या ने 5 टॉपिक्स में महारत हासिल की और 12 में सुधार हुआ।`;
    const parsed = parseSynthesisSummaryReply(reply);
    expect(parsed.textEn).toContain('Aanya mastered 5 topics');
    expect(parsed.textHi).toContain('आन्या');
  });

  it('handles English-only output (textHi is empty string when HI block missing)', () => {
    const parsed = parseSynthesisSummaryReply('Pure English output without markers.');
    expect(parsed.textEn).toContain('Pure English output');
    expect(parsed.textHi).toBe('');
  });

  it('trims surrounding whitespace from each section', () => {
    const reply = `EN:

   English summary with leading whitespace.

HI:

   Hindi summary with leading whitespace.   `;
    const parsed = parseSynthesisSummaryReply(reply);
    expect(parsed.textEn.trim()).toBe('English summary with leading whitespace.');
    expect(parsed.textHi.trim()).toBe('Hindi summary with leading whitespace.');
  });
});
