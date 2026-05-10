import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import type { FailedQuestion } from './types';

export interface ClaimArgs {
  batchSize: number;
  claimedBy: string;
  ttlSeconds: number;
}

interface RpcRow {
  id: string;
  question_text: string;
  options: string[];
  correct_answer_index: number;
  explanation: string | null;
  grade: string;
  subject: string;
  chapter_number: number | null;
  chapter_title: string | null;
}

export async function claimFailedBatch(args: ClaimArgs): Promise<FailedQuestion[]> {
  const { data, error } = await supabaseAdmin.rpc('claim_fix_batch', {
    p_batch_size: args.batchSize,
    p_claimed_by: args.claimedBy,
    p_ttl_seconds: args.ttlSeconds,
  });

  if (error || !data) {
    logger.warn('claim_fix_batch failed', { error: error?.message ?? 'no data' });
    return [];
  }

  const rows = data as RpcRow[];
  return rows.map((r) => ({
    id: r.id,
    question_text: r.question_text,
    options: r.options ?? [],
    claimed_correct_index: r.correct_answer_index,
    explanation: r.explanation ?? '',
    grade: r.grade,
    subject: r.subject,
    chapter_number: r.chapter_number,
    chapter_title: r.chapter_title,
    last_verifier_reason: null,
    last_verifier_correct_index: null,
  }));
}
