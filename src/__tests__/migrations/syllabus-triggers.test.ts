import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

describeIntegration('syllabus status triggers', () => {
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
    // Build a 1024-dim vector. pgvector accepts JSON arrays via PostgREST,
    // but supabase-js may serialize them inconsistently. Use the explicit
    // pgvector text format `[v1,v2,...]` to remove ambiguity.
    const embedding = `[${Array(1024).fill(0.1).join(',')}]`;
    const { error: chunkErr } = await supabaseAdmin.from('rag_content_chunks').insert({
      chunk_text: 'Test chunk content with some length.',
      source: 'ncert_2025',
      grade: '10', subject: 'science',  // legacy NOT NULL columns; trigger matches on grade_short/subject_code
      grade_short: '10', subject_code: 'science_trigger_test', chapter_number: 777,
      embedding,
    });
    // Fail-fast with a diagnostic if the chunk insert itself failed — the
    // original test silently dropped the error, so a NOT NULL or vector
    // format failure presented as the more confusing "chunk_count = 0".
    expect(chunkErr, `chunk insert failed: ${chunkErr?.message}`).toBeNull();

    const { data } = await supabaseAdmin.from('cbse_syllabus').select('chunk_count').match(testRow).single();
    expect(data!.chunk_count).toBeGreaterThan(0);
  });

  it('rag_status becomes partial after trigger with <50 chunks', async () => {
    const { data } = await supabaseAdmin.from('cbse_syllabus').select('rag_status').match(testRow).single();
    expect(data!.rag_status).toBe('partial');
  });
});
