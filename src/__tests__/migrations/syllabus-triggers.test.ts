import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabaseAdmin } from '@/lib/supabase-admin';

describe('syllabus status triggers', () => {
  const testRow = {
    board: 'CBSE', grade: '10', subject_code: 'science_trigger_test',
    subject_display: 'Science', chapter_number: 777, chapter_title: 'Trigger Test',
  };

  beforeAll(async () => {
    // Pollution guard: clean up any leftover rows from a previously-crashed run
    // before inserting. Without this, a UNIQUE violation kills the whole suite.
    await supabaseAdmin.from('cbse_syllabus').delete().match(testRow);
    await supabaseAdmin.from('rag_content_chunks').delete().match({
      subject_code: 'science_trigger_test', chapter_number: 777,
    });
    await supabaseAdmin.from('cbse_syllabus').insert(testRow);
  });

  afterAll(async () => {
    await supabaseAdmin.from('cbse_syllabus').delete().match(testRow);
    await supabaseAdmin.from('rag_content_chunks').delete().match({
      subject_code: 'science_trigger_test', chapter_number: 777,
    });
  });

  it('trigger bumps chunk_count on INSERT to rag_content_chunks', async () => {
    // Simulate a chunk insert with a realistic 1024-dim vector
    const embedding = Array(1024).fill(0.1);
    await supabaseAdmin.from('rag_content_chunks').insert({
      content: 'Test chunk content with some length.',
      source: 'ncert_2025',
      grade_short: '10', subject_code: 'science_trigger_test', chapter_number: 777,
      embedding,
    });
    const { data } = await supabaseAdmin.from('cbse_syllabus').select('chunk_count').match(testRow).single();
    expect(data!.chunk_count).toBeGreaterThan(0);
  });

  it('rag_status becomes partial after trigger with <50 chunks', async () => {
    const { data } = await supabaseAdmin.from('cbse_syllabus').select('rag_status').match(testRow).single();
    expect(data!.rag_status).toBe('partial');
  });
});