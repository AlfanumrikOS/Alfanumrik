// src/lib/ai/validation/quiz-oracle-prompts.ts
//
// Single source of truth for the quiz-oracle LLM-grader prompt (REG-54).
//
// Both the Next.js call site and the Deno mirror in
// `supabase/functions/_shared/quiz-oracle-prompts.ts` use the same prompt
// strings. If the prompts change here, change the Deno mirror in the same PR.
//
// The grader is instructed to return STRICT JSON. The reasoning field is
// short on purpose — we only log the first 300 chars to ops_events and we
// never show it to students (P12). The grader does not see the student's
// identity, grade, or any PII — only the candidate question content.

export interface OracleGraderPromptInput {
  question_text: string;
  options: string[];
  correct_answer_index: number;
  explanation: string;
}

/**
 * System prompt for the quiz-oracle LLM grader.
 *
 * Stable across calls; cached identically by Anthropic when prompt-cache is on.
 */
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
- Do NOT correct the explanation. Audit it as-is.`;

/**
 * Build the user-message payload for the grader. Numbers options as 0..3 to
 * match `correct_answer_index`'s 0-indexed convention.
 */
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
