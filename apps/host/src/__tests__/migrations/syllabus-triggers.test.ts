import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

describeIntegration('syllabus status triggers', () => {
  const testRow = {
    board: 'CBSE', grade: '10', subject_code: 'science_trigger_test',
    subject_display: 'Science', chapter_number: 777, chapter_title: 'Trigger Test',
  };

  beforeAll(async () => {
    // Pollution guard: clean up any leftover rows from a previously-crashed
    // run before inserting. Without this, a UNIQUE violation kills the
    // whole suite.
    await supabaseAdmin.from('cbse_syllabus').delete().match(testRow);
    await supabaseAdmin.from('rag_content_chunks').delete().match({
      subject_code: 'science_trigger_test', chapter_number: 777,
    });

    // Fail-fast diagnostics. The previous version of this test silently
    // dropped the seed INSERT error and the seed-row-not-findable case,
    // which presented as the confusing `Cannot read properties of null
    // (reading 'chunk_count')`. Surfacing both failure modes here means
    // a future regression points to the actual cause (BEFORE trigger
    // mutation, schema drift, RLS) instead of the trigger that's
    // innocently testing-time-too-late to do anything about it.
    const { error: seedErr } = await supabaseAdmin
      .from('cbse_syllabus')
      .insert(testRow);
    if (seedErr) {
      throw new Error(`syllabus-triggers: cbse_syllabus seed INSERT failed: ${seedErr.message}`);
    }
    const { data: seedReadback, error: readErr } = await supabaseAdmin
      .from('cbse_syllabus')
      .select('board, grade, subject_code, subject_display, chapter_number, chapter_title')
      .match(testRow);
    if (readErr) {
      throw new Error(`syllabus-triggers: cbse_syllabus seed read-back failed: ${readErr.message}`);
    }
    if (!seedReadback || seedReadback.length !== 1) {
      throw new Error(
        `syllabus-triggers: seed row not findable by the test's .match() shape. ` +
        `Found ${seedReadback?.length ?? 0} rows. Most likely a BEFORE INSERT trigger on ` +
        `cbse_syllabus mutated one of: ${JSON.stringify(testRow)}. Inspect cbse_syllabus ` +
        `triggers or check for staging drift (see migration ` +
        `supabase/migrations/20260524110000_syllabus_triggers_reapply_v3.sql).`,
      );
    }
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

    const { data, error: readErr } = await supabaseAdmin
      .from('cbse_syllabus')
      .select('chunk_count')
      .match(testRow)
      .single();
    // Fail-fast: a null `data` means `.single()` got 0 rows — the seed
    // row vanished or doesn't match the test fixture. Surface that
    // distinctly from a real "trigger didn't bump chunk_count" failure.
    expect(readErr, `cbse_syllabus read-back error: ${readErr?.message}`).toBeNull();
    expect(
      data,
      'cbse_syllabus row not findable after chunk INSERT. ' +
      'Either the trigger silently deleted the row, or a BEFORE trigger ' +
      'mutated the row identity columns. See migration ' +
      'supabase/migrations/20260524110000_syllabus_triggers_reapply_v3.sql.',
    ).not.toBeNull();
    expect(data!.chunk_count).toBeGreaterThan(0);
  });

  it('rag_status becomes partial after trigger with <50 chunks', async () => {
    const { data, error: readErr } = await supabaseAdmin
      .from('cbse_syllabus')
      .select('rag_status')
      .match(testRow)
      .single();
    expect(readErr, `cbse_syllabus read-back error: ${readErr?.message}`).toBeNull();
    expect(
      data,
      'cbse_syllabus row not findable when checking rag_status. ' +
      'Same diagnosis as the chunk_count test — staging drift.',
    ).not.toBeNull();
    expect(data!.rag_status).toBe('partial');
  });
});
