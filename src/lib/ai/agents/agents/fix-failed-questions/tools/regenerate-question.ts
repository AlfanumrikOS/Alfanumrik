import { callGroundedAnswer } from '@/lib/ai/grounded-client';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { ToolDefinition } from '@/lib/ai/agents/types';
import type { FixStrategy, RegenCandidate } from '@/lib/qb-fixer/types';

interface RegenInput {
  question_id: string;
  fix_strategy: FixStrategy;
  hint?: string;
}

function buildQuery(
  row: {
    question_text: string;
    options: string[];
    correct_answer_index: number;
    explanation: string;
    grade: string;
    subject: string;
    chapter_title: string | null;
  },
  fixStrategy: FixStrategy,
  hint: string | undefined,
): string {
  return JSON.stringify({
    fix_strategy: fixStrategy,
    hint: hint ?? null,
    grade: row.grade,
    subject: row.subject,
    chapter_title: row.chapter_title,
    prior: {
      question: row.question_text,
      options: row.options,
      correct_answer_index: row.correct_answer_index,
      explanation: row.explanation,
    },
  });
}

export const regenerateQuestionTool: ToolDefinition<RegenInput, RegenCandidate> = {
  name: 'regenerate_question',
  description:
    'Regenerate a failed question per a fix_strategy. Returns a candidate; does NOT commit. Strategies: index_correction (flip index per hint), explanation_only (rewrite explanation), full_regen (rewrite question+options+index+explanation).',
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

    const result = await callGroundedAnswer({
      caller: 'quiz-generator',
      student_id: null,
      session_id: null,
      grade: r.grade,
      subject: r.subject,
      chapter: r.chapter_title ?? null,
      template: 'quiz_question_generator_v1',
      mode: 'strict',
      generation: { temperature: 0.4 },
      query: buildQuery(
        {
          question_text: r.question_text,
          options: r.options ?? [],
          correct_answer_index: r.correct_answer_index,
          explanation: r.explanation ?? '',
          grade: r.grade,
          subject: r.subject,
          chapter_title: r.chapter_title,
        },
        input.fix_strategy,
        input.hint,
      ),
    });

    if (result.abstain_reason) {
      throw new Error(`regenerate abstained: ${result.abstain_reason}`);
    }

    let parsed: unknown;
    try {
      const clean = (result.answer ?? '').trim().replace(/^```(?:json)?\n?/, '').replace(/```$/, '');
      parsed = JSON.parse(clean);
    } catch (err) {
      throw new Error(`regenerate: failed to parse JSON answer: ${err instanceof Error ? err.message : String(err)}`);
    }

    const candidate = parsed as Partial<RegenCandidate>;
    if (
      typeof candidate.question !== 'string' ||
      !Array.isArray(candidate.options) ||
      candidate.options.length !== 4 ||
      typeof candidate.correct_answer_index !== 'number' ||
      typeof candidate.explanation !== 'string'
    ) {
      throw new Error(`regenerate: malformed candidate shape`);
    }

    return {
      question: candidate.question,
      options: candidate.options as [string, string, string, string],
      correct_answer_index: candidate.correct_answer_index as 0 | 1 | 2 | 3,
      explanation: candidate.explanation,
    };
  },
  redactInTrace: (input, output) => ({ input, output }),
};
