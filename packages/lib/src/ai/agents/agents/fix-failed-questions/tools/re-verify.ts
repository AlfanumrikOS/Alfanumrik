import { createHash } from 'node:crypto';
import { callGroundedAnswer, type GroundedRequest } from '@alfanumrik/lib/ai/grounded-client';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import type { ToolDefinition } from '@alfanumrik/lib/ai/agents/types';
import type { RegenCandidate } from '@alfanumrik/lib/qb-fixer/types';

interface ReVerifyInput {
  question_id: string;
  candidate: RegenCandidate;
}

interface ReVerifyOutput {
  verified: boolean;
  correct_option_index: number | null;
  reason: string;
}

interface VerifierAnswer {
  verified?: boolean;
  correct_option_index?: number | null;
  supporting_chunk_ids?: string[];
  reason?: string;
}

const TIMEOUT_MS = 25_000;

export function hashCandidate(c: RegenCandidate): string {
  return createHash('sha256')
    .update(JSON.stringify({ q: c.question, o: c.options, i: c.correct_answer_index, e: c.explanation }))
    .digest('hex')
    .slice(0, 16);
}

export const reVerifyTool: ToolDefinition<ReVerifyInput, ReVerifyOutput> = {
  name: 're_verify',
  description:
    'Re-run the verifier on a candidate. Does NOT touch the row. On success, stamps the agent context so a subsequent commit_fix can verify a re_verify happened.',
  inputSchema: {
    type: 'object',
    properties: {
      question_id: { type: 'string' },
      candidate: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
          correct_answer_index: { type: 'integer', minimum: 0, maximum: 3 },
          explanation: { type: 'string' },
        },
        required: ['question', 'options', 'correct_answer_index', 'explanation'],
      },
    },
    required: ['question_id', 'candidate'],
  },
  handler: async (input, ctx) => {
    const { data: row, error } = await supabaseAdmin
      .from('question_bank')
      .select('grade, subject, chapter_number, chapter_title')
      .eq('id', input.question_id)
      .single();
    if (error || !row) {
      throw new Error(`re_verify: row ${input.question_id} not found`);
    }
    type Row = { grade: string; subject: string; chapter_number: number | null; chapter_title: string | null };
    const r = row as Row;

    const questionJson = JSON.stringify({
      question: input.candidate.question,
      options: input.candidate.options,
      claimed_correct_index: input.candidate.correct_answer_index,
      explanation: input.candidate.explanation,
    });

    const request: GroundedRequest = {
      caller: 'quiz-generator',
      student_id: null,
      query: input.candidate.question,
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
        max_tokens: 1024,
        temperature: 0,
        system_prompt_template: 'quiz_answer_verifier_v1',
        template_variables: { question_json: questionJson },
      },
      retrieval: { match_count: 8 },
      timeout_ms: TIMEOUT_MS,
    };

    const result = await callGroundedAnswer(request, { hopTimeoutMs: TIMEOUT_MS + 2000 });

    if (!result.grounded) {
      throw new Error(`re_verify abstained: ${result.abstain_reason}`);
    }

    let parsed: VerifierAnswer = {};
    try {
      const clean = (result.answer ?? '').trim().replace(/^```(?:json)?\n?/, '').replace(/```$/, '');
      parsed = JSON.parse(clean) as VerifierAnswer;
    } catch {
      // fall through with verified=false
    }

    const verifiedRaw = parsed.verified === true;
    const idxAgrees =
      typeof parsed.correct_option_index === 'number' &&
      parsed.correct_option_index === input.candidate.correct_answer_index;
    const verified = verifiedRaw && idxAgrees;

    if (verified) {
      const key = `verified_${input.question_id}_${hashCandidate(input.candidate)}`;
      ctx.meta[key] = true;
    }

    return {
      verified,
      correct_option_index:
        typeof parsed.correct_option_index === 'number' ? parsed.correct_option_index : null,
      reason: parsed.reason ?? '',
    };
  },
  redactInTrace: (input, output) => ({ input, output }),
};
