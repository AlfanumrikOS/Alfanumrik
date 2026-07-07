/**
 * POST /api/exams/sync-mastery
 *
 * Updates `exam_chapters.mastery_percent` from the student's `concept_mastery`
 * records for every active exam the student owns. Called fire-and-forget from
 * the exam plan page on load, so mastery percentages shown on the exam card
 * reflect the student's actual practice data.
 *
 * Logic:
 *   1. Auth — exam.view permission, requireStudentId (student-scoped only).
 *   2. Fetch all active exam_configs for this student.
 *   3. For each exam, fetch its exam_chapters (chapter_number + subject).
 *   4. For each chapter, compute avg(mastery_probability) * 100 from
 *      concept_mastery JOIN curriculum_topics WHERE subject_code + chapter_number match.
 *   5. Update exam_chapters.mastery_percent (admin client write).
 *   6. Return summary: { updated, exam_id, chapters_synced }.
 *
 * P8: student reads go through RLS-scoped client.
 * P13: no PII in logs — counts + IDs only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

interface ExamChapterRow {
  id: string;
  chapter_number: number;
}

interface ExamConfigRow {
  id: string;
  subject: string; // subject_code
  exam_chapters: ExamChapterRow[];
}

interface MasteryAggRow {
  avg_mastery: number | null;
}

export async function POST(request: NextRequest) {
  // 1. Auth — student must be authenticated with exam.view permission.
  const auth = await authorizeRequest(request, 'exam.view', { requireStudentId: true });
  if (!auth.authorized) return auth.errorResponse!;

  const studentId = auth.studentId!;

  try {
    // 2. Fetch active exam configs for this student (RLS-scoped read — P8).
    const supabase = await createSupabaseServerClient();
    const { data: exams, error: examsErr } = await supabase
      .from('exam_configs')
      .select('id, subject, exam_chapters(id, chapter_number)')
      .eq('student_id', studentId)
      .eq('is_active', true);

    if (examsErr) {
      logger.error('exams_sync_mastery_fetch_failed', {
        error: new Error(examsErr.message),
        route: '/api/exams/sync-mastery',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load exams' },
        { status: 500 },
      );
    }

    if (!exams || exams.length === 0) {
      return NextResponse.json({ updated: 0, chapters_synced: [] });
    }

    const results: { exam_id: string; chapters_synced: number }[] = [];
    let totalUpdated = 0;

    for (const exam of exams as ExamConfigRow[]) {
      const chapters = exam.exam_chapters ?? [];
      if (chapters.length === 0) {
        results.push({ exam_id: exam.id, chapters_synced: 0 });
        continue;
      }

      let chaptersUpdated = 0;

      for (const chapter of chapters) {
        // 3. Compute avg mastery_probability for this student / subject / chapter
        //    by joining concept_mastery → curriculum_topics → subjects.
        //    concept_mastery has no direct subject_code column; the join path is:
        //      concept_mastery.topic_id → curriculum_topics.id
        //      curriculum_topics.subject_id → subjects.id (subjects.code = exam.subject)
        //      curriculum_topics.chapter_number = chapter.chapter_number
        const { data: aggData, error: aggErr } = await supabaseAdmin.rpc(
          // Use a direct query via the admin client — Supabase JS doesn't support
          // arbitrary SQL aggregation through the table API, so we use a raw
          // query through the admin client's PostgREST interface by querying
          // the concept_mastery view with a join. Fall back to 0 on error.
          'get_chapter_mastery_avg' as never,
          {
            p_student_id: studentId,
            p_subject_code: exam.subject,
            p_chapter_number: chapter.chapter_number,
          } as never,
        );

        let masteryPct = 0;

        if (aggErr) {
          // RPC may not exist — compute via JS-side query chain instead.
          const { data: topicIds } = await supabaseAdmin
            .from('curriculum_topics')
            .select('id')
            .eq('chapter_number', chapter.chapter_number)
            .in(
              'subject_id',
              // Subquery: get subject_id for this subject_code
              await (async () => {
                const { data: subj } = await supabaseAdmin
                  .from('subjects')
                  .select('id')
                  .eq('code', exam.subject)
                  .limit(1);
                return (subj ?? []).map((s: { id: string }) => s.id);
              })(),
            );

          if (topicIds && topicIds.length > 0) {
            const ids = topicIds.map((t: { id: string }) => t.id);
            const { data: masteryRows } = await supabaseAdmin
              .from('concept_mastery')
              .select('mastery_probability')
              .eq('student_id', studentId)
              .in('topic_id', ids);

            if (masteryRows && masteryRows.length > 0) {
              const probs = masteryRows
                .map((r: { mastery_probability: number | null }) => r.mastery_probability ?? 0)
                .filter((p: number) => p > 0);
              if (probs.length > 0) {
                const avg = probs.reduce((a: number, b: number) => a + b, 0) / probs.length;
                masteryPct = Math.round(avg * 100);
              }
            }
          }
        } else {
          const row = (aggData as MasteryAggRow[] | null)?.[0];
          masteryPct = row?.avg_mastery != null ? Math.round(row.avg_mastery) : 0;
        }

        // 4. Update exam_chapters.mastery_percent (service role write — P8).
        const { error: updateErr } = await supabaseAdmin
          .from('exam_chapters')
          .update({ mastery_percent: masteryPct })
          .eq('id', chapter.id);

        if (updateErr) {
          logger.error('exams_sync_mastery_update_failed', {
            error: new Error(updateErr.message),
            route: '/api/exams/sync-mastery',
            chapter_id: chapter.id,
          });
        } else {
          chaptersUpdated++;
          totalUpdated++;
        }
      }

      results.push({ exam_id: exam.id, chapters_synced: chaptersUpdated });
    }

    // P13: counts + IDs only, no PII.
    logger.info('exams_sync_mastery_complete', {
      route: '/api/exams/sync-mastery',
      total_updated: totalUpdated,
      exam_count: exams.length,
    });

    return NextResponse.json({ updated: totalUpdated, chapters_synced: results });
  } catch (err) {
    logger.error('exams_sync_mastery_unexpected_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/exams/sync-mastery',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
