import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

describeIntegration('ingestion_gaps view', () => {
  it('returns rows for non-ready in-scope chapters', async () => {
    await supabaseAdmin.from('cbse_syllabus').insert({
      grade: '10', subject_code: 'gaps_test', subject_display: 'Gaps',
      chapter_number: 888, chapter_title: 'Gap Test',
      rag_status: 'missing', chunk_count: 0, verified_question_count: 0,
    });
    const { data } = await supabaseAdmin.from('ingestion_gaps')
      .select('*').eq('subject_code', 'gaps_test').single();
    expect(data).not.toBeNull();
    expect(data!.severity).toBe('critical');
    await supabaseAdmin.from('cbse_syllabus').delete()
      .match({ subject_code: 'gaps_test', chapter_number: 888 });
  });

  it('excludes ready chapters', async () => {
    await supabaseAdmin.from('cbse_syllabus').insert({
      grade: '10', subject_code: 'ready_test', subject_display: 'Ready',
      chapter_number: 889, chapter_title: 'Ready Test',
      rag_status: 'ready', chunk_count: 100, verified_question_count: 50,
    });
    const { data } = await supabaseAdmin.from('ingestion_gaps')
      .select('*').eq('subject_code', 'ready_test');
    expect(data).toEqual([]);
    await supabaseAdmin.from('cbse_syllabus').delete()
      .match({ subject_code: 'ready_test', chapter_number: 889 });
  });
});
