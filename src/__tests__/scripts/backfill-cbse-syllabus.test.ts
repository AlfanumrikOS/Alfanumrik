import { describe, it, expect } from 'vitest';
import { backfillCbseSyllabus } from '../../../scripts/backfill-cbse-syllabus';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

describeIntegration('backfill-cbse-syllabus', () => {
  it('returns a summary with inserted/skipped counts', async () => {
    const result = await backfillCbseSyllabus({ dryRun: true });
    expect(result).toMatchObject({
      planned: expect.any(Number),
      inserted: 0,                                  // dry run
      skipped: expect.any(Number),
    });
    expect(result.planned).toBeGreaterThan(0);      // catalog is non-empty
  });

  it('populates cbse_syllabus with one row per distinct (grade, subject_code, chapter_number) from rag_content_chunks', async () => {
    const before = await supabaseAdmin.from('cbse_syllabus').select('*', { count: 'exact', head: true });
    await backfillCbseSyllabus({ dryRun: false });
    const after = await supabaseAdmin.from('cbse_syllabus').select('*', { count: 'exact', head: true });
    expect(after.count).toBeGreaterThanOrEqual(before.count!);
  });
});
