import { describe, it, expect, beforeAll } from 'vitest';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

describeIntegration('question_bank verification columns', () => {
  // Defensive seed: question_bank.subject has FK -> subjects.code. Production
  // is fully seeded but staging/preview/DR environments may not be - without
  // this beforeAll, the FK violation (SQLSTATE 23503) is reported as the
  // failure rather than the actual contract under test.
  beforeAll(async () => {
    await supabaseAdmin.from('subjects').upsert(
      { code: 'science', name: 'Science', subject_kind: 'cbse_core', is_active: true },
      { onConflict: 'code' }
    );
  });

  it('new rows default to legacy_unverified', async () => {
    const { data, error } = await supabaseAdmin.from('question_bank').insert({
      question_text: 'Test question with sufficient length here.',
      options: ['A', 'B', 'C', 'D'],
      correct_answer_index: 0,
      explanation: 'Test explanation that is long enough to pass validation.',
      subject: 'science', grade: '10', chapter_number: 1,
      difficulty: 2, bloom_level: 'understand',
    }).select('verification_state, verified_against_ncert').single();
    expect(error).toBeNull();
    expect(data!.verification_state).toBe('legacy_unverified');
    expect(data!.verified_against_ncert).toBe(false);
  });

  it('rejects invalid verification_state', async () => {
    const { error } = await supabaseAdmin.from('question_bank').insert({
      question_text: 'Test.', options: ['A','B','C','D'],
      correct_answer_index: 0, explanation: 'x',
      subject: 'science', grade: '10', chapter_number: 1,
      difficulty: 2, bloom_level: 'understand',
      verification_state: 'bogus',
    });
    expect(error).not.toBeNull();
  });
});
