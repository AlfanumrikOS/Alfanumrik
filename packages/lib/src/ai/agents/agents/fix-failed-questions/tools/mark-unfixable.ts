import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import type { ToolDefinition } from '@alfanumrik/lib/ai/agents/types';

interface MarkInput {
  question_id: string;
  reason: string;
}

export const markUnfixableTool: ToolDefinition<MarkInput, { ok: true }> = {
  name: 'mark_unfixable',
  description: 'Give up on this row. Updates state to failed_unfixable for human review. Use when verifier reason is unfixable (no NCERT chunks for chapter) or after exhausting regen attempts.',
  inputSchema: {
    type: 'object',
    properties: {
      question_id: { type: 'string' },
      reason: { type: 'string' },
    },
    required: ['question_id', 'reason'],
  },
  handler: async (input, ctx) => {
    const { error: updateErr } = await supabaseAdmin
      .from('question_bank')
      .update({
        verification_state: 'failed_unfixable',
        verification_claimed_by: null,
        verification_claim_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.question_id);
    if (updateErr) {
      throw new Error(`mark_unfixable UPDATE failed: ${updateErr.message}`);
    }

    const { error: insertErr } = await supabaseAdmin.from('question_bank_fix_history').insert({
      question_id: input.question_id,
      agent_run_id: (ctx.meta.run_id as string | undefined) ?? null,
      fix_strategy: 'unfixable',
      prior_verifier_reason: input.reason,
      outcome: 'marked_unfixable',
      attempts: (ctx.meta.regen_attempts as number | undefined) ?? 0,
    });
    if (insertErr) {
      logger.warn('mark_unfixable history insert failed', { error: insertErr.message });
    }

    return { ok: true };
  },
  redactInTrace: (input, output) => ({ input, output }),
};
