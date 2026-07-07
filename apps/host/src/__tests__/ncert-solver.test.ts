import { describe, it, expect } from 'vitest';

/**
 * NCERT Solver Curriculum Grounding Tests — P12 (AI Safety)
 *
 * Tests replicated from supabase/functions/ncert-solver/index.ts:
 * - System prompt includes NCERT-only instructions
 * - Subject-specific safety rules
 * - RAG context handling (present vs absent)
 * - Verification system prompt covers NCERT compliance
 *
 * These are pure-function replications since the Edge Function runs in Deno.
 * The logic is identical to the production code.
 */

// ─── Replicated types from ncert-solver/index.ts ────────────────────

interface ParsedQuestion {
  originalText: string;
  type: 'mcq' | 'numerical' | 'short' | 'long' | 'definition' | 'diagram' | 'hots';
  subject: string;
  grade: string;
  marks: number;
  concepts: string[];
  options: string[];
}

// ─── Replicated buildSolverSystemPrompt from ncert-solver ───────────

function buildSolverSystemPrompt(parsed: ParsedQuestion, ragContext: string | null): string {
  const { grade, subject } = parsed;
  const subjectLower = subject.toLowerCase();

  let subjectSafetyRule = '';
  if (['math', 'mathematics'].includes(subjectLower)) {
    subjectSafetyRule = `\nSUBJECT-SPECIFIC RULE (Math): Do NOT use formulas, theorems, or methods not taught in NCERT for Class ${grade}. For example, do not use L'Hopital's rule in Class 11, or integration by parts in Class 11 if it is a Class 12 topic. If you are unsure whether a method is in the NCERT syllabus for this grade, explicitly say so.`;
  } else if (['physics', 'chemistry', 'science', 'biology'].includes(subjectLower)) {
    subjectSafetyRule = `\nSUBJECT-SPECIFIC RULE (Science): Do NOT state specific numerical values, constants, or experimental results unless you are CERTAIN they match NCERT for Class ${grade}. Use only the formulas and derivations presented in NCERT. If unsure about a specific value or constant, say "Please verify the exact value from your NCERT textbook."`;
  } else if (['history', 'geography', 'civics', 'economics', 'social science', 'political science'].includes(subjectLower)) {
    subjectSafetyRule = `\nSUBJECT-SPECIFIC RULE (Social Studies): Do NOT state specific dates, events, names, or historical claims unless you are CERTAIN they match NCERT for Class ${grade}. If unsure about a specific date or fact, say "Please verify from your NCERT textbook."`;
  }

  let prompt = `You are a CBSE Class ${grade} ${subject} problem-solving engine that strictly follows NCERT.

CORE RULES — FOLLOW WITHOUT EXCEPTION:
- You MUST solve this problem using ONLY methods, formulas, and concepts taught in the NCERT textbook for Class ${grade} ${subject}.
- Do NOT use advanced methods, shortcuts, or concepts not covered in NCERT for this grade.
- Do NOT invent facts, formulas, dates, or definitions not in NCERT.
- NEVER contradict NCERT. If your knowledge differs from NCERT, follow NCERT.
- If you are not confident in your answer, you MUST say so explicitly rather than guessing.
- If unsure about any fact, say "This should be verified against the NCERT textbook" rather than presenting uncertain information as fact.
- Always output valid JSON.
${subjectSafetyRule}`;

  if (ragContext) {
    prompt += `

NCERT REFERENCE MATERIAL (PRIMARY SOURCE — base your solution on this):
---
${ragContext}
---
Your solution MUST be consistent with the above NCERT content. Do not contradict it. If the answer can be directly derived from this material, use it as the authoritative source.`;
  } else {
    prompt += `

WARNING: No NCERT reference material was found for this question.
You may still solve using your general knowledge of the CBSE Class ${grade} ${subject} curriculum, but you MUST:
1. Use ONLY standard methods taught at this grade level
2. NOT fabricate specific NCERT page numbers, exercise numbers, or textbook quotes
3. Add a note in your explanation: "This solution should be verified against the NCERT textbook"
4. If you are uncertain about the correct method or answer, say so explicitly
5. Set your confidence appropriately — do not express high confidence without NCERT backing`;
  }

  return prompt;
}

// ─── Replicated buildVerificationSystemPrompt from ncert-solver ─────

function buildVerificationSystemPrompt(parsed: ParsedQuestion): string {
  const { grade, subject } = parsed;
  return `You are a CBSE Class ${grade} ${subject} answer verification engine.

Your job is to rigorously verify a proposed solution against NCERT standards.

VERIFICATION CHECKLIST — check ALL of the following:
1. Does this solution use ONLY methods taught in NCERT for Class ${grade} ${subject}? Flag any advanced methods not in the syllabus.
2. Are all formulas and values consistent with NCERT for this grade? Check for incorrect constants, wrong formula application.
3. Is the answer format appropriate for a CBSE board exam? (proper units, significant figures, marks-appropriate depth)
4. Are the steps logically correct and complete? Check for arithmetic errors, sign errors, unit conversion errors.
5. Does the explanation match what NCERT teaches, or does it introduce concepts from a different grade level?

If ANY check fails, set "passed" to false and list the specific issues.
If the solution uses a method not in NCERT for this grade, flag it even if the final answer is numerically correct.
Always output valid JSON.`;
}

// ─── Helper to create test parsed questions ─────────────────────────

function createParsedQuestion(overrides: Partial<ParsedQuestion> = {}): ParsedQuestion {
  return {
    originalText: 'What is the speed of light?',
    type: 'short',
    subject: 'science',
    grade: '9',
    marks: 2,
    concepts: ['light', 'speed'],
    options: [],
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('NCERT Solver: Curriculum Grounding', () => {

  describe('Core NCERT-only instructions', () => {
    it('system prompt mandates NCERT-only methods', () => {
      const parsed = createParsedQuestion();
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('ONLY methods, formulas, and concepts taught in the NCERT textbook');
    });

    it('system prompt forbids advanced methods not in NCERT', () => {
      const parsed = createParsedQuestion();
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('Do NOT use advanced methods, shortcuts, or concepts not covered in NCERT');
    });

    it('system prompt forbids inventing facts', () => {
      const parsed = createParsedQuestion();
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('Do NOT invent facts, formulas, dates, or definitions not in NCERT');
    });

    it('system prompt requires NCERT over AI knowledge when they differ', () => {
      const parsed = createParsedQuestion();
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('NEVER contradict NCERT');
      expect(prompt).toContain('If your knowledge differs from NCERT, follow NCERT');
    });

    it('system prompt requires explicit uncertainty disclosure', () => {
      const parsed = createParsedQuestion();
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('you MUST say so explicitly rather than guessing');
    });

    it('includes correct grade and subject in prompt', () => {
      const parsed = createParsedQuestion({ grade: '10', subject: 'physics' });
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('Class 10 physics');
    });
  });

  describe('Subject-specific safety rules', () => {
    it('math: warns about grade-inappropriate formulas (e.g., L\'Hopital)', () => {
      const parsed = createParsedQuestion({ subject: 'math', grade: '11' });
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('SUBJECT-SPECIFIC RULE (Math)');
      expect(prompt).toContain("L'Hopital");
      expect(prompt).toContain('Do NOT use formulas, theorems, or methods not taught in NCERT');
    });

    it('mathematics (alternate spelling) also gets math rules', () => {
      const parsed = createParsedQuestion({ subject: 'mathematics', grade: '9' });
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('SUBJECT-SPECIFIC RULE (Math)');
    });

    it('science: warns about unverified numerical values', () => {
      const parsed = createParsedQuestion({ subject: 'science', grade: '9' });
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('SUBJECT-SPECIFIC RULE (Science)');
      expect(prompt).toContain('Do NOT state specific numerical values');
      expect(prompt).toContain('Please verify the exact value from your NCERT textbook');
    });

    it('physics gets science safety rules', () => {
      const parsed = createParsedQuestion({ subject: 'physics', grade: '11' });
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('SUBJECT-SPECIFIC RULE (Science)');
    });

    it('chemistry gets science safety rules', () => {
      const parsed = createParsedQuestion({ subject: 'chemistry', grade: '12' });
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('SUBJECT-SPECIFIC RULE (Science)');
    });

    it('biology gets science safety rules', () => {
      const parsed = createParsedQuestion({ subject: 'biology', grade: '11' });
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('SUBJECT-SPECIFIC RULE (Science)');
    });

    it('history gets social studies safety rules', () => {
      const parsed = createParsedQuestion({ subject: 'history', grade: '10' });
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('SUBJECT-SPECIFIC RULE (Social Studies)');
      expect(prompt).toContain('Do NOT state specific dates, events, names');
    });

    it('economics gets social studies safety rules', () => {
      const parsed = createParsedQuestion({ subject: 'economics', grade: '12' });
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('SUBJECT-SPECIFIC RULE (Social Studies)');
    });

    it('english gets no subject-specific safety rule (general rules suffice)', () => {
      const parsed = createParsedQuestion({ subject: 'english', grade: '9' });
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).not.toContain('SUBJECT-SPECIFIC RULE');
    });
  });

  describe('RAG context handling', () => {
    it('with RAG context: includes NCERT reference material section', () => {
      const parsed = createParsedQuestion({ subject: 'science', grade: '9' });
      const rag = 'Photosynthesis is the process by which green plants prepare their food.';
      const prompt = buildSolverSystemPrompt(parsed, rag);
      expect(prompt).toContain('NCERT REFERENCE MATERIAL (PRIMARY SOURCE');
      expect(prompt).toContain(rag);
      expect(prompt).toContain('authoritative source');
    });

    it('with RAG context: mandates consistency with NCERT content', () => {
      const parsed = createParsedQuestion();
      const rag = 'Force = mass x acceleration';
      const prompt = buildSolverSystemPrompt(parsed, rag);
      expect(prompt).toContain('MUST be consistent with the above NCERT content');
      expect(prompt).toContain('Do not contradict it');
    });

    it('without RAG context: includes WARNING header', () => {
      const parsed = createParsedQuestion();
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('WARNING: No NCERT reference material was found');
    });

    it('without RAG context: requires textbook verification note', () => {
      const parsed = createParsedQuestion();
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('This solution should be verified against the NCERT textbook');
    });

    it('without RAG context: forbids fabricating page/exercise numbers', () => {
      const parsed = createParsedQuestion();
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('NOT fabricate specific NCERT page numbers, exercise numbers, or textbook quotes');
    });

    it('without RAG context: requires low confidence when unsupported', () => {
      const parsed = createParsedQuestion();
      const prompt = buildSolverSystemPrompt(parsed, null);
      expect(prompt).toContain('do not express high confidence without NCERT backing');
    });
  });

  describe('Verification system prompt', () => {
    it('includes 5-point verification checklist', () => {
      const parsed = createParsedQuestion({ grade: '10', subject: 'science' });
      const prompt = buildVerificationSystemPrompt(parsed);
      expect(prompt).toContain('VERIFICATION CHECKLIST');
      expect(prompt).toContain('1.');
      expect(prompt).toContain('2.');
      expect(prompt).toContain('3.');
      expect(prompt).toContain('4.');
      expect(prompt).toContain('5.');
    });

    it('flags methods not in NCERT even if numerically correct', () => {
      const parsed = createParsedQuestion({ grade: '11', subject: 'math' });
      const prompt = buildVerificationSystemPrompt(parsed);
      expect(prompt).toContain('flag it even if the final answer is numerically correct');
    });

    it('checks for grade-appropriate methods', () => {
      const parsed = createParsedQuestion({ grade: '9', subject: 'science' });
      const prompt = buildVerificationSystemPrompt(parsed);
      expect(prompt).toContain('ONLY methods taught in NCERT for Class 9 science');
    });

    it('checks for CBSE board exam format', () => {
      const parsed = createParsedQuestion({ grade: '12', subject: 'physics' });
      const prompt = buildVerificationSystemPrompt(parsed);
      expect(prompt).toContain('CBSE board exam');
      expect(prompt).toContain('proper units');
    });

    it('requires JSON output', () => {
      const parsed = createParsedQuestion();
      const prompt = buildVerificationSystemPrompt(parsed);
      expect(prompt).toContain('Always output valid JSON');
    });
  });
});
