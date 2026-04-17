import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from '@/lib/supabase-admin';

describe('rag_content_chunks constraints', () => {
  it('rejects source other than ncert_2025', async () => {
    const { error } = await supabaseAdmin.from('rag_content_chunks').insert({
      content: 'test', source: 'wikipedia',
      grade_short: '10', subject_code: 'science', chapter_number: 1,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/source|check/i);
  });

  it('rejects invalid grade_short', async () => {
    const { error } = await supabaseAdmin.from('rag_content_chunks').insert({
      content: 'test', source: 'ncert_2025',
      grade_short: '13', subject_code: 'science', chapter_number: 1,
    });
    expect(error).not.toBeNull();
  });
});