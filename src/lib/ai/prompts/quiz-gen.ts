/**
 * Quiz Generator — System Prompt Template
 *
 * Builds the system prompt for AI-based quiz question generation.
 * Produces structured JSON output with questions that comply with
 * product invariant P6 (question quality).
 *
 * Used by: supabase/functions/quiz-generator/ (Edge Function)
 *          Any quiz generation workflow in the AI layer
 *
 * Owner: ai-engineer
 * Review: assessment (difficulty distribution, Bloom's levels, CBSE scope)
 */

// ─── Parameters ─────────────────────────────────────────────────────────────

export interface QuizGenPromptParams {
  grade: string;          // P5: string "6"-"12"
  subject: string;
  chapter: string;
  topic: string;
  count: number;          // Number of questions to generate
  difficulty: number;     // 1-5 scale (1=easy, 5=very hard)
  bloomLevel: string;     // e.g. "remember", "understand", "apply", "analyze"
}

// ─── Difficulty label mapping ───────────────────────────────────────────────

const DIFFICULTY_LABELS: Record<number, string> = {
  1: 'Very Easy — basic recall, definitions, and direct textbook facts',
  2: 'Easy — straightforward application of a single concept',
  3: 'Medium — requires understanding and simple application',
  4: 'Hard — multi-step reasoning or application across concepts',
  5: 'Very Hard — higher-order thinking, analysis, or novel scenarios',
};

// ─── Builder ────────────────────────────────────────────────────────────────

/**
 * Builds the system prompt for AI quiz question generation.
 *
 * The prompt instructs Claude to return a JSON array of questions,
 * each compliant with P6 (question quality invariant):
 * - Non-empty text (no placeholders)
 * - Exactly 4 distinct non-empty options
 * - correctAnswerIndex in range 0-3
 * - Non-empty explanation
 * - Valid difficulty and bloomLevel
 *
 * Safety: restricts to CBSE scope for the given grade (P12).
 */
export function buildQuizGenPrompt(params: QuizGenPromptParams): string {
  const { grade, subject, chapter, topic, count, difficulty, bloomLevel } =
    params;

  const difficultyLabel =
    DIFFICULTY_LABELS[difficulty] ?? DIFFICULTY_LABELS[3];

  return `You are a CBSE question paper setter for Grade ${grade} ${subject}. Generate exactly ${count} multiple-choice questions.

## Topic
- Subject: ${subject}
- Chapter: ${chapter}
- Topic: ${topic}
- Grade: ${grade}

## Difficulty
Level ${difficulty}/5: ${difficultyLabel}

## Bloom's Taxonomy Level
Target: ${bloomLevel}
- remember: recall facts, definitions, formulas
- understand: explain concepts, interpret, summarize
- apply: use knowledge in new situations, solve problems
- analyze: break down, compare, contrast, find patterns
- evaluate: judge, justify, critique
- create: design, construct, propose

## Output Format
Return ONLY a valid JSON array. No markdown, no explanation outside the JSON.

\`\`\`json
[
  {
    "text": "Clear question text without placeholders like {{}} or [BLANK]",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswerIndex": 0,
    "explanation": "Clear explanation of why this answer is correct",
    "difficulty": "${difficulty <= 2 ? 'easy' : difficulty <= 3 ? 'medium' : 'hard'}",
    "bloomLevel": "${bloomLevel}"
  }
]
\`\`\`

## Quality Rules (strictly enforced)
1. Every question MUST have non-empty text. No placeholder text like "{{variable}}" or "[BLANK]".
2. Every question MUST have exactly 4 options. All options must be distinct and non-empty.
3. correctAnswerIndex MUST be an integer from 0 to 3.
4. Every question MUST have a non-empty explanation.
5. Options should be plausible — avoid obviously wrong distractors.
6. Questions must come from the CBSE Grade ${grade} ${subject} syllabus ONLY.
7. Do not repeat questions or create near-duplicates.
8. Do not include questions that require diagrams, images, or external resources.
9. Use language appropriate for Grade ${grade} students.
10. Distribute the correct answer index across 0-3 (avoid all answers being the same index).

## Validation
Before returning, verify each question meets ALL quality rules above. If a question fails any rule, fix it or replace it. The output must contain exactly ${count} valid questions.`;
}
