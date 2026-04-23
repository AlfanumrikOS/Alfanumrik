import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

describeIntegration('feedback and failure tables', () => {
  it('content_requests: rate-limit one per (student, chapter, day)', async () => {
    // requires a test student row to exist — skip if not available
    const { data: student } = await supabaseAdmin.from('students').select('id').limit(1).single();
    if (!student) return;
    const row = {
      student_id: student.id, grade: '10', subject_code: 'science',
      chapter_number: 999, request_source: 'foxy',
    };
    const { error: err1 } = await supabaseAdmin.from('content_requests').insert(row);
    expect(err1).toBeNull();
    const { error: err2 } = await supabaseAdmin.from('content_requests').insert(row);
    expect(err2).not.toBeNull();                    // UNIQUE violation
    await supabaseAdmin.from('content_requests').delete().match(row);
  });

  it('ai_issue_reports: rejects unknown reason_category', async () => {
    const { error } = await supabaseAdmin.from('ai_issue_reports').insert({
      student_id: '00000000-0000-0000-0000-000000000000',
      reason_category: 'bogus',
    });
    expect(error).not.toBeNull();
  });

  it('rag_ingestion_failures: accepts a failure row', async () => {
    const { data, error } = await supabaseAdmin.from('rag_ingestion_failures').insert({
      source_file: 'test.pdf', grade: '10', subject_code: 'science',
      chapter_number: 1, reason: 'empty content',
    }).select().single();
    expect(error).toBeNull();
    await supabaseAdmin.from('rag_ingestion_failures').delete().eq('id', data!.id);
  });
});
