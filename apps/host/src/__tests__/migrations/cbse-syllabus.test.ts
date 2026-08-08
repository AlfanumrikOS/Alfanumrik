import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

describeIntegration('cbse_syllabus migration', () => {
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

  // Shared-staging-DB flakiness hardening (2026-08-08): this lane runs other
  // files in parallel (backfill-cbse-syllabus inserts 128 rows, syllabus-
  // triggers afterAll DELETEs rows from cbse_syllabus). Under that contention
  // the setup INSERT below could transiently fail (lock/connection), leaving
  // no row for the duplicate INSERT to conflict with — which surfaced as the
  // confusing "expected null not to be null" on the SECOND insert. The fix:
  //  1. beforeAll deletes any leftover row from a previously-crashed run
  //     (same pollution guard as syllabus-triggers.test.ts),
  //  2. the setup INSERT is retried a bounded number of times and its error
  //     is asserted fail-fast with a diagnostic (never silently ignored),
  //  3. cleanup runs in afterAll regardless of assertion outcome.
  const UNIQUE_ROW = {
    board: 'CBSE', grade: '10', subject_code: 'science',
    subject_display: 'Science', chapter_number: 99, chapter_title: 'Dup',
  };

  beforeAll(async () => {
    await supabaseAdmin.from('cbse_syllabus').delete().match(UNIQUE_ROW);
  });

  afterAll(async () => {
    await supabaseAdmin.from('cbse_syllabus').delete().match(UNIQUE_ROW);
  });

  it('UNIQUE constraint on (board, grade, subject_code, chapter_number)', async () => {
    // Setup: insert the row. Retry a bounded number of times to absorb the
    // transient lock/connection failures observed under parallel lane load.
    let setupErr: { message: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await supabaseAdmin.from('cbse_syllabus').insert(UNIQUE_ROW);
      setupErr = res.error as { message: string } | null;
      if (!setupErr) break;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
    expect(setupErr, `cbse_syllabus setup INSERT failed: ${setupErr?.message}`).toBeNull();

    // Duplicate insert of the SAME row MUST violate the unique constraint.
    const { error } = await supabaseAdmin.from('cbse_syllabus').insert(UNIQUE_ROW);
    expect(error, `duplicate insert unexpectedly succeeded: ${JSON.stringify(UNIQUE_ROW)}`).not.toBeNull();
  });
});
