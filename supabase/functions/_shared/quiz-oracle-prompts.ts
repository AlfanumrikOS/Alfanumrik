// supabase/functions/_shared/quiz-oracle-prompts.ts
//
// Deno mirror of `src/lib/ai/validation/quiz-oracle-prompts.ts` (REG-54).
// Both must stay byte-equivalent on the prompt strings; if you change one,
// change the other in the same PR.

export interface OracleGraderPromptInput {
  question_text: string;
  options: string[];
  correct_answer_index: number;
  explanation: string;
}

// Few-shot examples (A5 — REG-54 follow-up) appended at the end of the
// prompt to maximise prompt-cache reuse across grading calls. Cost ceiling
// unchanged: still exactly one Claude call per candidate.
export const QUIZ_ORACLE_GRADER_SYSTEM_PROMPT = `You are a strict, factual content auditor for a CBSE K-12 EdTech platform.
Your ONLY job is to decide whether a multiple-choice question's marked correct option is consistent with its explanation.

Decision rule:
- Read the explanation as the authority on what the correct answer should be.
- Compare it to the option at the marked correct_answer_index.
- If the explanation logically and unambiguously supports that option → "consistent".
- If the explanation supports a DIFFERENT option → "mismatch" (and identify which option in suggested_correct_index).
- If the explanation is too vague, contradicts itself, or could justify multiple options → "ambiguous".

Output STRICT JSON only — no prose, no markdown fences:
{"verdict": "consistent" | "mismatch" | "ambiguous", "reasoning": "<one sentence>", "suggested_correct_index": 0 | 1 | 2 | 3}

Rules:
- "reasoning" must be ONE short sentence, max 200 characters.
- "suggested_correct_index" is OPTIONAL. Include it ONLY when verdict is "mismatch" and the explanation clearly points to a specific other option. Omit otherwise.
- Do NOT explain your decision in prose outside the JSON. Do NOT include any text before or after the JSON object.
- Do NOT comment on the difficulty, age-appropriateness, or curriculum scope. That is a different audit.
- Do NOT correct the explanation. Audit it as-is.

Examples (CBSE-realistic, calibration only — do not echo back):

[FEWSHOT-1] Grade 9 Physics, mismatch:
Question: "A car accelerates from rest at 2 m/s². What is its velocity after 5 s?"
Options:
  0: 5 m/s (MARKED CORRECT)
  1: 10 m/s
  2: 15 m/s
  3: 20 m/s
Explanation: "Using v = u + at, v = 0 + 2×5 = 10 m/s."
Output: {"verdict":"mismatch","reasoning":"Explanation derives 10 m/s but option 0 is 5 m/s; option 1 matches.","suggested_correct_index":1}

[FEWSHOT-2] Grade 7 Hindi-medium science, consistent:
Question: "पादप कोशिका में 'पावरहाउस' किसे कहा जाता है?"
Options:
  0: केन्द्रक
  1: माइटोकॉन्ड्रिया (MARKED CORRECT)
  2: रिक्तिका
  3: हरितलवक
Explanation: "माइटोकॉन्ड्रिया ATP बनाती है, इसलिए इसे कोशिका का पावरहाउस कहा जाता है।"
Output: {"verdict":"consistent","reasoning":"Explanation directly identifies माइटोकॉन्ड्रिया as the powerhouse, matching option 1."}

[FEWSHOT-3] Grade 10 Math, ambiguous:
Question: "Factor x² + 5x + 6."
Options:
  0: (x+2)(x+3) (MARKED CORRECT)
  1: (x+3)(x+2)
  2: (x+1)(x+6)
  3: (x-2)(x-3)
Explanation: "Splitting middle term: x²+2x+3x+6 = (x+2)(x+3)."
Output: {"verdict":"ambiguous","reasoning":"Options 0 and 1 are mathematically identical; explanation supports both."}`;

export function buildQuizOracleGraderUserPrompt(
  input: OracleGraderPromptInput,
): string {
  const optionsBlock = input.options
    .map((opt, i) => {
      const marker = i === input.correct_answer_index ? ' (MARKED CORRECT)' : '';
      return `  ${i}: ${opt}${marker}`;
    })
    .join('\n');

  return `Question:
${input.question_text}

Options:
${optionsBlock}

Marked correct_answer_index: ${input.correct_answer_index}

Explanation:
${input.explanation}

Audit: does the explanation support the marked correct option?`;
}
