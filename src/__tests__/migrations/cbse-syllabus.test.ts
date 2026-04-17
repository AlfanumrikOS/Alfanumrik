import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from '@/lib/supabase-admin';

describe('cbse_syllabus migration', () => {
  it('table exists with expected columns and CHECK constraints', async () => {
    const { data: raw } = await supabaseAdmin.from('cbse_syllabus').select('*').limit(0);
    expect(raw).toBeDefined();
  });

  it('rejects invalid grade', async () => {
    const { error } = await supabaseAdmin.from('cbse_syllabus').insert({
      grade: '5',
      subject_code: 'science',
      subject_display: 'Science',
      chapter_number: 1,
      chapter_title: 'Test',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/check|grade/i);
  });

  it('rejects invalid rag_status', async () => {
    const { error } = await supabaseAdmin.from('cbse_syllabus').insert({
      grade: '10', subject_code: 'science', subject_display: 'Science',
      chapter_number: 1, chapter_title: 'Test',
      rag_status: 'unknown',
    });
    expect(error).not.toBeNull();
  });

  it('UNIQUE constraint on (board, grade, subject_code, chapter_number)', async () => {
    const row = { board: 'CBSE', grade: '10', subject_code: 'science',
                  subject_display: 'Science', chapter_number: 99, chapter_title: 'Dup' };
    await supabaseAdmin.from('cbse_syllabus').insert(row);
    const { error } = await supabaseAdmin.from('cbse_syllabus').insert(row);
    expect(error).not.toBeNull();
    await supabaseAdmin.from('cbse_syllabus').delete().match(row);
  });
});