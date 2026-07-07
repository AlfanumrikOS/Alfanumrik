import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import type { ToolDefinition } from '@alfanumrik/lib/ai/agents/types';
import type { FailedQuestion } from '@alfanumrik/lib/qb-fixer/types';

export const readFailedQuestionTool: ToolDefinition<
  { question_id: string },
  FailedQuestion
> = {
  name: 'read_failed_question',
  description:
    'Fetch a failed question_bank row including the verifier_failure_reason text.',
  inputSchema: {
    type: 'object',
    properties: { question_id: { type: 'string' } },
    required: ['question_id'],
  },
  handler: async (input) => {
    const { data: row, error } = await supabaseAdmin
      .from('question_bank')
      .select(
        'id, question_text, options, correct_answer_index, explanation, grade, subject, chapter_number, chapter_title, verifier_failure_reason',
      )
      .eq('id', input.question_id)
      .single();

    if (error || !row) {
      throw new Error(`question_bank row ${input.question_id} not found: ${error?.message ?? 'no data'}`);
    }

    type Row = {
      id: string; question_text: string; options: string[];
      correct_answer_index: number; explanation: string | null;
      grade: string; subject: string;
      chapter_number: number | null; chapter_title: string | null;
      verifier_failure_reason: string | null;
    };
    const r = row as Row;

    return {
      id: r.id,
      question_text: r.question_text,
      options: r.options ?? [],
      claimed_correct_index: r.correct_answer_index,
      explanation: r.explanation ?? '',
      grade: r.grade,
      subject: r.subject,
      chapter_number: r.chapter_number,
      chapter_title: r.chapter_title,
      last_verifier_reason: r.verifier_failure_reason ?? null,
      last_verifier_correct_index: null,
    };
  },
  redactInTrace: (input, output) => ({ input, output }),
};
