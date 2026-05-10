import { callGroundedAnswer, type GroundedRequest } from '@/lib/ai/grounded-client';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { ToolDefinition } from '@/lib/ai/agents/types';
import type { FixStrategy, RegenCandidate } from '@/lib/qb-fixer/types';

interface RegenInput {
  question_id: string;
  fix_strategy: FixStrategy;
  hint?: string;
}

const TIMEOUT_MS = 25_000;
const MAX_TOKENS = 2048;

export const regenerateQuestionTool: ToolDefinition<RegenInput, RegenCandidate> = {
  name: 'regenerate_question',
  description:
    'Regenerate a failed question fresh from NCERT chunks for the same grade/subject/chapter. The fix_strategy and hint are recorded for trace context but the regenerated question is always fresh — the re_verify step is the safety gate.',
  inputSchema: {
    type: 'object',
    properties: {
      question_id: { type: 'string' },
      fix_strategy: {
        type: 'string',
        enum: ['index_correction', 'explanation_only', 'full_regen'],
      },
      hint: { type: 'string' },
    },
    required: ['question_id', 'fix_strategy'],
  },
  handler: async (input) => {
    const { data: row, error } = await supabaseAdmin
      .from('question_bank')
      .select('question_text, options, correct_answer_index, explanation, grade, subject, chapter_number, chapter_title')
      .eq('id', input.question_id)
      .single();

    if (error || !row) {
      throw new Error(`regenerate: row ${input.question_id} not found: ${error?.message}`);
    }

    type Row = {
      question_text: string; options: string[]; correct_answer_index: number;
      explanation: string | null; grade: string; subject: string;
      chapter_number: number | null; chapter_title: string | null;
    };
    const r = row as Row;

    const chapterSuffix = r.chapter_number != null
      ? ` ch.${r.chapter_number}${r.chapter_title ? ` (${r.chapter_title})` : ''}`
      : '';

    const request: GroundedRequest = {
      caller: 'quiz-generator',
      student_id: null,
      // Retrieval query: use the prior question text so the embedding pulls
      // semantically related NCERT chunks for the regen.
      query: r.question_text,
      scope: {
        board: 'CBSE',
        grade: r.grade,
        subject_code: r.subject,
        chapter_number: r.chapter_number,
        chapter_title: r.chapter_title,
      },
      mode: 'strict',
      generation: {
        model_preference: 'haiku',
        max_tokens: MAX_TOKENS,
        temperature: 0.4,
        system_prompt_template: 'quiz_question_generator_v1',
        template_variables: {
          grade: r.grade,
          subject: r.subject,
          chapter_suffix: chapterSuffix,
        },
      },
      retrieval: { match_count: 8 },
      timeout_ms: TIMEOUT_MS,
    };

    const result = await callGroundedAnswer(request, { hopTimeoutMs: TIMEOUT_MS + 2000 });

    if (!result.grounded) {
      throw new Error(`regenerate abstained: ${result.abstain_reason}`);
    }

    let parsed: unknown;
    try {
      const clean = (result.answer ?? '').trim().replace(/^```(?:json)?\n?/, '').replace(/```$/, '');
      parsed = JSON.parse(clean);
    } catch (err) {
      throw new Error(`regenerate: failed to parse JSON answer: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Generator template returns { question_text, options, correct_answer_index, explanation, ... }
    // (note: question_text not question)
    type GeneratorOutput = {
      question_text?: string;
      question?: string; // tolerate either key
      options?: string[];
      correct_answer_index?: number;
      explanation?: string;
      error?: string;
    };
    const out = parsed as GeneratorOutput;

    if (out.error === 'insufficient_source') {
      throw new Error(`regenerate: insufficient_source from generator`);
    }

    const question = out.question_text ?? out.question;
    if (
      typeof question !== 'string' ||
      !Array.isArray(out.options) ||
      out.options.length !== 4 ||
      typeof out.correct_answer_index !== 'number' ||
      typeof out.explanation !== 'string'
    ) {
      throw new Error(`regenerate: malformed candidate shape`);
    }

    return {
      question,
      options: out.options as [string, string, string, string],
      correct_answer_index: out.correct_answer_index as 0 | 1 | 2 | 3,
      explanation: out.explanation,
    };
  },
  redactInTrace: (input, output) => ({ input, output }),
};
