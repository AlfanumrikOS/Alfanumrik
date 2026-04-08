/**
 * POST /api/exam/chapters
 *
 * Inserts exam chapter configurations for a newly created exam.
 * Replaces direct anon-client insert in exams/page.tsx.
 *
 * WHY:
 *   - exam_config_id came from client state; no server-side verification
 *     that the exam config belongs to the authenticated student
 *   - chapter data (weightage, mastery) came entirely from client — no validation
 *   - Direct anon insert means RLS misconfiguration = any user inserts any chapter
 *
 * SECURITY:
 *   - exam config ownership verified: exam_configs.student_id must equal auth student
 *   - chapter_number validated as positive integer
 *   - weightage_marks validated as non-negative number
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

interface ChapterInput {
  chapter_number: number;
  chapter_title?: string;
  weightage_marks?: number;
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'exam.write', { requireStudentId: true });
  if (!auth.authorized) return auth.errorResponse!;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const { exam_config_id, chapters } = body;
  const studentId = auth.studentId!;

  if (typeof exam_config_id !== 'string' || !exam_config_id.trim()) {
    return err('exam_config_id required', 400);
  }
  if (!Array.isArray(chapters) || chapters.length === 0) {
    return err('chapters must be a non-empty array', 400);
  }
  if (chapters.length > 50) {
    return err('maximum 50 chapters per exam config', 400);
  }

  // Ownership check: exam_config must belong to authenticated student
  const { data: examConfig, error: configError } = await supabaseAdmin
    .from('exam_configs')
    .select('id, student_id')
    .eq('id', exam_config_id)
    .single();

  if (configError || !examConfig) {
    return err('Exam config not found', 404);
  }

  if (examConfig.student_id !== studentId) {
    logger.warn('exam_chapters_idor_attempt', { studentId, examConfigStudentId: examConfig.student_id, examConfigId: exam_config_id });
    return err('Exam config not found', 404); // 404 prevents enumeration
  }

  // Validate and sanitize chapter inputs
  const validChapters = (chapters as ChapterInput[]).filter(c =>
    typeof c.chapter_number === 'number' &&
    Number.isInteger(c.chapter_number) &&
    c.chapter_number > 0
  );

  if (validChapters.length === 0) {
    return err('No valid chapters provided', 400);
  }

  const rows = validChapters.map(c => ({
    exam_config_id,
    chapter_number: c.chapter_number,
    chapter_title: typeof c.chapter_title === 'string' ? c.chapter_title : `Chapter ${c.chapter_number}`,
    weightage_marks: typeof c.weightage_marks === 'number' && c.weightage_marks >= 0 ? c.weightage_marks : 0,
    mastery_percent: 0,
  }));

  const { error: insertError } = await supabaseAdmin.from('exam_chapters').insert(rows);

  if (insertError) {
    logger.error('exam_chapters_insert_failed', {
      error: new Error(insertError.message),
      studentId,
      examConfigId: exam_config_id,
      chapterCount: rows.length,
    });
    return err('Failed to insert exam chapters', 500);
  }

  return NextResponse.json({ success: true, inserted: rows.length });
}
