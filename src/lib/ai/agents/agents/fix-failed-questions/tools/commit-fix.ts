import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateCandidate } from '@/lib/ai/validation/quiz-oracle';
import { logger } from '@/lib/logger';
import type { ToolDefinition } from '@/lib/ai/agents/types';
import type { FixStrategy, RegenCandidate } from '@/lib/qb-fixer/types';
import { hashCandidate } from './re-verify';

interface CommitInput {
  question_id: string;
  fixed_question: RegenCandidate;
  fix_strategy: FixStrategy;
}

export const commitFixTool: ToolDefinition<CommitInput, { ok: true }> = {
  name: 'commit_fix',
  description:
    'Commit a verified candidate to question_bank. PRECONDITION: a successful re_verify must have stamped ctx.meta with verified_<question_id>_<hash> for THIS candidate. Also enforces validateCandidate (P11 oracle).',
  inputSchema: {
    type: 'object',
    properties: {
      question_id: { type: 'string' },
      fixed_question: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
          correct_answer_index: { type: 'integer', minimum: 0, maximum: 3 },
          explanation: { type: 'string' },
        },
        required: ['question', 'options', 'correct_answer_index', 'explanation'],
      },
      fix_strategy: {
        type: 'string',
        enum: ['index_correction', 'explanation_only', 'full_regen'],
      },
    },
    required: ['question_id', 'fixed_question', 'fix_strategy'],
  },
  handler: async (input, ctx) => {
    // Precondition 1: matching re_verify success in ctx.meta
    const expectedKey = `verified_${input.question_id}_${hashCandidate(input.fixed_question)}`;
    if (ctx.meta[expectedKey] !== true) {
      throw new Error(`commit_fix precondition failed: no re_verify success recorded for ${input.question_id} with this candidate`);
    }

    // Precondition 2: P11 structural oracle
    const validation = await validateCandidate(
      {
        question_text: input.fixed_question.question,
        options: input.fixed_question.options,
        correct_answer_index: input.fixed_question.correct_answer_index,
        explanation: input.fixed_question.explanation,
      },
      { enableLlmGrader: false },
    );
    if (!validation.ok) {
      throw new Error(`commit_fix oracle rejected: ${validation.category} — ${validation.reason}`);
    }

    // Read prior values for history (including verifier_failure_reason directly from question_bank)
    const { data: prior, error: priorErr } = await supabaseAdmin
      .from('question_bank')
      .select('question_text, options, correct_answer_index, explanation, verifier_failure_reason')
      .eq('id', input.question_id)
      .single();
    if (priorErr || !prior) {
      throw new Error(`commit_fix: failed to read prior row: ${priorErr?.message}`);
    }
    type Prior = {
      question_text: string;
      options: string[];
      correct_answer_index: number;
      explanation: string | null;
      verifier_failure_reason: string | null;
    };
    const p = prior as Prior;

    // UPDATE the row
    const { error: updateErr } = await supabaseAdmin
      .from('question_bank')
      .update({
        question_text: input.fixed_question.question,
        options: input.fixed_question.options,
        correct_answer_index: input.fixed_question.correct_answer_index,
        explanation: input.fixed_question.explanation,
        verification_state: 'verified',
        verified_against_ncert: true,
        verification_claimed_by: null,
        verification_claim_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.question_id);
    if (updateErr) {
      throw new Error(`commit_fix UPDATE failed: ${updateErr.message}`);
    }

    // INSERT history row
    const { error: insertErr } = await supabaseAdmin.from('question_bank_fix_history').insert({
      question_id: input.question_id,
      agent_run_id: (ctx.meta.run_id as string | undefined) ?? null,
      fix_strategy: input.fix_strategy,
      prior_question_text: p.question_text,
      prior_options: p.options,
      prior_correct_answer_index: p.correct_answer_index,
      prior_explanation: p.explanation,
      prior_verifier_reason: p.verifier_failure_reason,
      outcome: 'verified',
      attempts: (ctx.meta.regen_attempts as number | undefined) ?? 1,
    });
    if (insertErr) {
      logger.warn('commit_fix history insert failed', { error: insertErr.message });
    }

    return { ok: true };
  },
  redactInTrace: (input, output) => ({ input, output }),
};
