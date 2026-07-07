import { describe, it, expect, beforeAll } from 'vitest';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
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
    // Use a unique question_text per test run to avoid colliding with the
    // idx_question_bank_unique_text unique index (lower(btrim(question_text)))
    // when staging has pollution from previous test runs.
    const uniqueText = `Test question for verification-state test - run ${Date.now()}.`;
    // Defensive cleanup in case a prior run with the same timestamp got
    // killed mid-insert (extremely rare but cheap).
    await supabaseAdmin.from('question_bank').delete().eq('question_text', uniqueText);

    const { data, error } = await supabaseAdmin.from('question_bank').insert({
      question_text: uniqueText,
      options: ['A', 'B', 'C', 'D'],
      correct_answer_index: 0,
      explanation: 'Test explanation that is long enough to pass validation.',
      subject: 'science', grade: '10', chapter_number: 1,
      difficulty: 2, bloom_level: 'understand',
    }).select('id, verification_state, verified_against_ncert').single();
    expect(error).toBeNull();
    expect(data!.verification_state).toBe('legacy_unverified');
    expect(data!.verified_against_ncert).toBe(false);

    // Cleanup: remove the row we just inserted so future runs don't see it.
    await supabaseAdmin.from('question_bank').delete().eq('id', data!.id);
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
