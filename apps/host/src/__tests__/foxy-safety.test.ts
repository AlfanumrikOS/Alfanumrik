import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Foxy Tutor Safety Tests — P12 (AI Safety) & RAG Fallback
 *
 * Tests replicated from supabase/functions/foxy-tutor/index.ts:
 * 1. checkInputSafety: blocks inappropriate content, allows educational content
 * 2. RAG fallback: when no context found, system prompt includes disclaimers
 *
 * These are pure-function replications since the Edge Function runs in Deno,
 * not Node. The logic is identical to the production code.
 */

// ─── Replicated checkInputSafety from foxy-tutor/index.ts ──────────────

interface SafetyResult {
  safe: boolean;
  category?: string;
}

function checkInputSafety(message: string): SafetyResult {
  const normalized = message
    .toLowerCase()
    .replace(/[\s_\-.*+]+/g, ' ')
    .replace(/[0@][o0]/gi, 'oo')
    .trim();

  const SAFETY_PATTERNS: Array<{ category: string; pattern: RegExp }> = [
    {
      category: 'violence',
      pattern: /\b(how to (make|build|create) (a )?(bomb|weapon|gun|explosive)|kill (someone|people|myself|yourself)|murder (someone|people)|school shoot|mass shoot|terrorist attack|how to hurt)\b/,
    },
    {
      category: 'sexual_content',
      pattern: /\b(porn|pornograph|sex video|nude photo|naked (photo|pic|image|video)|sexting|hookup|onlyfans|xxx rated)\b/,
    },
    {
      category: 'self_harm',
      pattern: /\b(how to (commit suicide|kill myself|end my life|cut myself|hurt myself)|suicide method|want to die|ways to die)\b/,
    },
    {
      category: 'substance_abuse',
      pattern: /\b(how to (make|cook|brew|grow) (meth|cocaine|heroin|weed|drugs|lsd)|buy (drugs|weed|cocaine|meth)|get (high|drunk|stoned) (fast|easily|quickly))\b/,
    },
    {
      category: 'hate_speech',
      pattern: /\b(hate (all )?(muslims|hindus|christians|jews|blacks|whites|dalits)|kill (all )?(muslims|hindus|christians|jews|blacks|whites)|ethnic cleansing|racial supremacy|white power|genocide is good)\b/,
    },
    {
      category: 'pii_request',
      pattern: /\b(give me (the )?(phone|mobile|address|email|password|aadhaar|aadhar) (number |of )|hack (into|someone|account)|stalk (someone|person)|find (someone|person).{0,20}(address|location|phone))\b/,
    },
  ];

  for (const { category, pattern } of SAFETY_PATTERNS) {
    if (pattern.test(normalized)) {
      return { safe: false, category };
    }
  }

  return { safe: true };
}

// ─── Replicated RAG fallback prompt logic from foxy-tutor/index.ts ─────

function buildSystemPromptNoRagSection(
  grade: string,
  subject: string,
  language: string,
  ragContext: string | null,
  syllabusContext: string | null,
): { hasDisclaimer: boolean; hasConfidenceRating: boolean; hasOpeningLine: boolean; prompt: string } {
  let prompt = '';
  let hasDisclaimer = false;
  let hasConfidenceRating = false;
  let hasOpeningLine = false;

  if (ragContext) {
    prompt += `\n\nNCERT TEXTBOOK CONTENT (PRIMARY SOURCE — base your answer on this):\n${ragContext}\n\nYour answer MUST be consistent with the above NCERT content. Do not contradict it.`;
  }

  if (!ragContext && !syllabusContext) {
    const disclaimerBadge = language === 'hi'
      ? '⚠️ **NCERT संदर्भ नहीं मिला** — यह उत्तर सामान्य CBSE पाठ्यक्रम ज्ञान पर आधारित है। कृपया अपनी पाठ्यपुस्तक से सत्यापित करें।'
      : '⚠️ **No NCERT reference found** — This answer is based on general CBSE curriculum knowledge. Please verify from your textbook.';

    const openingLine = language === 'hi'
      ? '📚 मेरे पास इसके लिए सटीक NCERT पृष्ठ नहीं है, लेकिन CBSE कक्षा ' + grade + ' ' + subject + ' पाठ्यक्रम के आधार पर मुझे यह पता है...'
      : '📚 I don\'t have the exact NCERT page for this, but here\'s what I know from the CBSE Class ' + grade + ' ' + subject + ' curriculum...';

    prompt += `\n\n⚠️ NO-REFERENCE SAFETY MODE (CRITICAL — follow ALL rules below):
No specific NCERT textbook content or syllabus reference was found for this question.
1. You MUST begin your response with this EXACT disclaimer badge on its own line:
   "${disclaimerBadge}"
2. You MUST follow the disclaimer badge with this opening line:
   "${openingLine}"
3. Keep your answer strictly within the CBSE syllabus scope for Class ${grade}
4. Recommend the student verify your answer from their NCERT textbook

CONFIDENCE RATING (MANDATORY — include at the END of your response):
- **Confidence: HIGH** — Standard curriculum knowledge, very likely correct
- **Confidence: MEDIUM** — Likely correct but student should verify from textbook
- **Confidence: LOW** — Not sure about grade-specific details.`;

    hasDisclaimer = prompt.includes(disclaimerBadge);
    hasConfidenceRating = prompt.includes('Confidence: HIGH') && prompt.includes('Confidence: MEDIUM') && prompt.includes('Confidence: LOW');
    hasOpeningLine = prompt.includes(openingLine);
  }

  return { hasDisclaimer, hasConfidenceRating, hasOpeningLine, prompt };
}

// ─── Input Safety Tests ──────────────────────────────────────

describe('checkInputSafety — P12 AI Safety', () => {
  describe('blocks inappropriate content', () => {
    it('blocks violence: "how to make a bomb"', () => {
      const result = checkInputSafety('how to make a bomb');
      expect(result.safe).toBe(false);
      expect(result.category).toBe('violence');
    });

    it('blocks violence: "how to build a weapon"', () => {
      const result = checkInputSafety('how to build a weapon');
      expect(result.safe).toBe(false);
      expect(result.category).toBe('violence');
    });

    it('blocks sexual content: "porn"', () => {
      const result = checkInputSafety('show me porn');
      expect(result.safe).toBe(false);
      expect(result.category).toBe('sexual_content');
    });

    it('blocks self-harm: "how to commit suicide"', () => {
      const result = checkInputSafety('how to commit suicide');
      expect(result.safe).toBe(false);
      expect(result.category).toBe('self_harm');
    });

    it('blocks substance abuse: "how to make meth"', () => {
      const result = checkInputSafety('how to make meth');
      expect(result.safe).toBe(false);
      expect(result.category).toBe('substance_abuse');
    });

    it('blocks hate speech: "hate all muslims"', () => {
      const result = checkInputSafety('hate all muslims');
      expect(result.safe).toBe(false);
      expect(result.category).toBe('hate_speech');
    });

    it('blocks PII harvesting: "hack into someone account"', () => {
      const result = checkInputSafety('hack into someone account');
      expect(result.safe).toBe(false);
      expect(result.category).toBe('pii_request');
    });

    it('blocks with mixed case and extra spaces', () => {
      const result = checkInputSafety('  HOW  TO  MAKE  A  BOMB  ');
      expect(result.safe).toBe(false);
      expect(result.category).toBe('violence');
    });

    it('blocks "kill someone"', () => {
      const result = checkInputSafety('tell me how to kill someone');
      expect(result.safe).toBe(false);
      expect(result.category).toBe('violence');
    });

    it('blocks "want to die"', () => {
      const result = checkInputSafety('I want to die');
      expect(result.safe).toBe(false);
      expect(result.category).toBe('self_harm');
    });
  });

  describe('allows legitimate educational content', () => {
    it('allows "what is photosynthesis"', () => {
      const result = checkInputSafety('what is photosynthesis');
      expect(result.safe).toBe(true);
    });

    it('allows "explain chemical reactions"', () => {
      const result = checkInputSafety('explain chemical reactions in Class 10 science');
      expect(result.safe).toBe(true);
    });

    it('allows "sexual reproduction in plants" (biology topic)', () => {
      const result = checkInputSafety('explain sexual reproduction in plants');
      expect(result.safe).toBe(true);
    });

    it('allows "drugs and medicines" (biology/chemistry)', () => {
      const result = checkInputSafety('what are drugs and medicines used for');
      expect(result.safe).toBe(true);
    });

    it('allows "nuclear energy" (physics topic)', () => {
      const result = checkInputSafety('how does nuclear energy work');
      expect(result.safe).toBe(true);
    });

    it('allows "Indian independence movement" (history)', () => {
      const result = checkInputSafety('what happened during the Indian independence movement');
      expect(result.safe).toBe(true);
    });

    it('allows "solve quadratic equation"', () => {
      const result = checkInputSafety('solve x^2 + 5x + 6 = 0');
      expect(result.safe).toBe(true);
    });

    it('allows "explain force and motion" (Newton)', () => {
      const result = checkInputSafety('explain Newton\'s laws of motion');
      expect(result.safe).toBe(true);
    });

    it('allows empty string', () => {
      const result = checkInputSafety('');
      expect(result.safe).toBe(true);
    });

    it('allows Hindi educational queries', () => {
      const result = checkInputSafety('प्रकाश संश्लेषण क्या है');
      expect(result.safe).toBe(true);
    });

    it('allows "chemical weapons treaty" (history context)', () => {
      const result = checkInputSafety('tell me about the chemical weapons treaty');
      expect(result.safe).toBe(true);
    });
  });
});

// ─── RAG Fallback Safety Tests ───────────────────────────────

describe('Foxy RAG fallback safety', () => {
  it('includes mandatory disclaimer when no RAG context is found (English)', () => {
    const result = buildSystemPromptNoRagSection('9', 'science', 'en', null, null);
    expect(result.hasDisclaimer).toBe(true);
    expect(result.prompt).toContain('No NCERT reference found');
    expect(result.prompt).toContain('Please verify from your textbook');
  });

  it('includes mandatory disclaimer in Hindi when language is hi', () => {
    const result = buildSystemPromptNoRagSection('9', 'science', 'hi', null, null);
    expect(result.hasDisclaimer).toBe(true);
    expect(result.prompt).toContain('NCERT संदर्भ नहीं मिला');
  });

  it('includes confidence rating instructions when no RAG context', () => {
    const result = buildSystemPromptNoRagSection('9', 'science', 'en', null, null);
    expect(result.hasConfidenceRating).toBe(true);
    expect(result.prompt).toContain('Confidence: HIGH');
    expect(result.prompt).toContain('Confidence: MEDIUM');
    expect(result.prompt).toContain('Confidence: LOW');
  });

  it('includes opening line when no RAG context (English)', () => {
    const result = buildSystemPromptNoRagSection('9', 'science', 'en', null, null);
    expect(result.hasOpeningLine).toBe(true);
    expect(result.prompt).toContain("I don't have the exact NCERT page for this");
    expect(result.prompt).toContain('Class 9');
    expect(result.prompt).toContain('science');
  });

  it('does NOT include disclaimer when RAG context IS provided', () => {
    const result = buildSystemPromptNoRagSection(
      '9', 'science', 'en',
      'Photosynthesis is the process by which plants make food.',
      null,
    );
    expect(result.hasDisclaimer).toBe(false);
    expect(result.hasConfidenceRating).toBe(false);
    expect(result.prompt).toContain('NCERT TEXTBOOK CONTENT');
    expect(result.prompt).toContain('PRIMARY SOURCE');
  });

  it('does NOT include disclaimer when syllabus context IS provided', () => {
    const result = buildSystemPromptNoRagSection(
      '9', 'science', 'en',
      null,
      'Chapter 6: Tissues - Types of plant tissues',
    );
    expect(result.hasDisclaimer).toBe(false);
    expect(result.hasConfidenceRating).toBe(false);
  });

  it('includes NO-REFERENCE SAFETY MODE header when no context', () => {
    const result = buildSystemPromptNoRagSection('10', 'math', 'en', null, null);
    expect(result.prompt).toContain('NO-REFERENCE SAFETY MODE');
    expect(result.prompt).toContain('CRITICAL');
  });

  it('instructs to stay within CBSE syllabus scope for the grade', () => {
    const result = buildSystemPromptNoRagSection('10', 'math', 'en', null, null);
    expect(result.prompt).toContain('CBSE syllabus scope for Class 10');
  });

  it('instructs to recommend textbook verification', () => {
    const result = buildSystemPromptNoRagSection('9', 'science', 'en', null, null);
    expect(result.prompt).toContain('verify your answer from their NCERT textbook');
  });
});

// ─── FOXY_SAFETY_RAILS constant (D3 Step 4 — ported rules) ────────────
// FOXY_SAFETY_RAILS is module-private in src/app/api/foxy/route.ts. We
// assert its content by reading the file source so this regression test
// catches accidental deletion of the ported factual-integrity and
// RAG-only-refusal rules without needing to export the constant.

describe('FOXY_SAFETY_RAILS — D3 Step 4 ported rules (P12)', () => {
  // FOXY_SAFETY_RAILS + buildSystemPrompt were extracted byte-identical into
  // src/lib/foxy/prompt-sections.ts (H1 REFACTOR M2). Read BOTH files so this
  // anti-deletion guard follows the content wherever it lives — it still fails
  // if the rails are deleted from the prompt-sections module.
  const routeSrc =
    readFileSync(join(process.cwd(), 'src/app/api/foxy/route.ts'), 'utf8') +
    readFileSync(join(process.cwd(), 'src/lib/foxy/prompt-sections.ts'), 'utf8');

  it('includes the factual-integrity rule (legacy foxy-tutor:209)', () => {
    expect(routeSrc).toContain('Factual integrity');
    expect(routeSrc).toContain(
      'Never change your answer when a student pressures you',
    );
    expect(routeSrc).toContain('stick with X');
    expect(routeSrc).toContain('walk through their reasoning');
  });

  it('includes the RAG-only-refusal rule (legacy foxy-tutor:213)', () => {
    expect(routeSrc).toContain('RAG-only refusal');
    expect(routeSrc).toContain(
      "I don't have a verified source for this in your textbook",
    );
    expect(routeSrc).toContain("which chapter you're studying");
    expect(routeSrc).toContain("I'll look again");
  });

  // P7 bilingual parity (launch-readiness, 2026-05-05): the RAG-only
  // refusal MUST also exist in Hindi so a Devanagari-script question
  // gets a Devanagari-script refusal. The model is instructed to pick
  // the variant matching the student's language. Both variants must
  // remain present for parity to hold.
  it('includes the Hindi parity refusal (P7 launch-readiness)', () => {
    // Devanagari opening — "I don't have a verified source for this in
    // your textbook" — uses पाठ्यपुस्तक (textbook) and सत्यापित स्रोत
    // (verified source).
    expect(routeSrc).toContain(
      'मेरे पास आपकी पाठ्यपुस्तक में इसके लिए सत्यापित स्रोत नहीं है',
    );
    // Devanagari follow-up — "tell me which chapter you're studying,
    // I'll look again" — uses अध्याय (chapter) and फिर से देखूंगा
    // (will look again).
    expect(routeSrc).toContain('कौन सा अध्याय पढ़ रहे हैं');
    expect(routeSrc).toContain('मैं फिर से देखूंगा');
  });

  it('instructs the model to pick the language variant matching the student', () => {
    // The rule must explicitly steer the model to language-match so the
    // Hindi refusal isn't dead text — it has to fire on Hindi questions.
    // Use a regex that tolerates the natural newline break in the rendered
    // prompt ("…matches\n   the language the student wrote in").
    expect(routeSrc).toMatch(/matches\s+the language the student wrote in/);
    expect(routeSrc).toContain('Devanagari script');
  });

  it('preserves the original five safety rails (additive change)', () => {
    expect(routeSrc).toContain('1. Scope:');
    expect(routeSrc).toContain('2. Age appropriateness:');
    expect(routeSrc).toContain('3. Bilingual style:');
    expect(routeSrc).toContain('4. Honesty:');
    expect(routeSrc).toContain('5. Grounding:');
    // New rules are 6 and 7, slotted in after 5.
    expect(routeSrc).toContain('6. Factual integrity:');
    expect(routeSrc).toContain('7. RAG-only refusal:');
  });
});
