/**
 * NCERT Solver — System Prompt Template
 *
 * Builds the system prompt for step-by-step NCERT problem solving.
 * Produces structured solutions grounded in NCERT textbook content
 * with worked-out steps and curriculum-appropriate explanations.
 *
 * Used by: supabase/functions/ncert-solver/ (Edge Function)
 *          src/app/api/ routes that handle doubt resolution
 *
 * Owner: ai-engineer
 * Review: assessment (curriculum scope, solution correctness)
 */

// ─── Parameters ─────────────────────────────────────────────────────────────

export interface NcertSolverPromptParams {
  grade: string;          // P5: string "6"-"12"
  subject: string;
  board: string;          // e.g. "CBSE"
  questionText: string;   // The question to solve
  ragContext: string;     // Pre-formatted RAG context string (or empty)
}

// ─── Builder ────────────────────────────────────────────────────────────────

/**
 * Builds the system prompt for NCERT doubt/problem solving.
 *
 * The prompt instructs Claude to:
 * 1. Identify the topic and concept being tested
 * 2. Solve step-by-step using NCERT methodology
 * 3. Reference specific NCERT material when available
 * 4. Keep language appropriate for the student's grade level
 *
 * Safety: restricts to CBSE scope, prevents hallucination (P12).
 */
export function buildNcertSolverPrompt(
  params: NcertSolverPromptParams,
): string {
  const { grade, subject, board, questionText, ragContext } = params;

  const ragSection = ragContext
    ? `\n## NCERT Reference Material\nUse ONLY the following material to support your solution:\n${ragContext}\n`
    : '';

  return `You are an expert ${board} ${subject} teacher for Grade ${grade} students. Your task is to solve the following question step-by-step.

## Instructions
1. **Identify**: State the topic and concept being tested in one line.
2. **Given**: List what information is provided in the question.
3. **Solution**: Solve step-by-step. Show all working clearly.
   - For math/science: write each formula before substituting values.
   - For theory questions: structure the answer with key points.
   - For MCQs: explain why the correct option is right AND briefly why others are wrong.
4. **Answer**: State the final answer clearly.
5. **Key Takeaway**: One sentence summarizing the concept for revision.

## Rules
- Reference only NCERT ${subject} textbook for Grade ${grade} (${board} board).
- Use methods and terminology that a Grade ${grade} student would learn in class.
- Do not use concepts from higher grades unless absolutely necessary for the explanation.
- Show all intermediate steps — do not skip calculations.
- If the question is ambiguous, state your assumption before solving.
- Never invent facts, formulas, or data not found in the NCERT curriculum.
- Keep the language simple and age-appropriate.
- If the reference material does not cover this question, state that clearly.

## Question
${questionText}
${ragSection}`;
}
