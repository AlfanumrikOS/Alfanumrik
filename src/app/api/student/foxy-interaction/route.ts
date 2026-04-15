/**
 * POST /api/student/foxy-interaction
 *
 * Handles two write actions triggered from the Foxy tutor chat:
 *   action: "save_flashcard"  → inserts into spaced_repetition_cards
 *   action: "report_response" → inserts into ai_response_reports + calls track_ai_quality RPC
 *
 * WHY:
 *   Both were direct anon-client inserts in foxy/page.tsx.
 *   student_id came from client state — any student could spoof another student's ID.
 *   ai_response_reports contained student_name and session content, PII that should
 *   never traverse a client write without auth validation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { validateSubjectWrite } from '@/lib/subjects';

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

async function guardSubject(studentId: string, subject: string) {
  const v = await validateSubjectWrite(studentId, subject, { supabase: supabaseAdmin });
  if (v.ok) return null;
  return NextResponse.json(
    {
      error: v.error.code,
      subject: v.error.subject,
      reason: v.error.reason,
      allowed: v.error.allowed,
    },
    { status: 422 },
  );
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'foxy.interact', { requireStudentId: true });
  if (!auth.authorized) return auth.errorResponse!;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const { action } = body;
  const studentId = auth.studentId!;

  // ── save_flashcard ────────────────────────────────────────────────────────
  if (action === 'save_flashcard') {
    const { subject, topic, question, answer } = body;

    if (typeof subject !== 'string' || !subject.trim()) return err('subject required', 400);
    if (typeof answer !== 'string' || !answer.trim()) return err('answer required', 400);

    const guard = await guardSubject(studentId, subject);
    if (guard) return guard;

    const { error } = await supabaseAdmin.from('spaced_repetition_cards').insert({
      student_id: studentId,
      subject,
      topic: typeof topic === 'string' ? topic : null,
      question: typeof question === 'string' ? question : `Review: ${subject}${topic ? ` — ${topic}` : ''}`,
      answer: (answer as string).substring(0, 2000),
      source: 'foxy_chat',
      difficulty: 2,
    });

    if (error) {
      logger.error('foxy_flashcard_insert_failed', { error: new Error(error.message), studentId, subject });
      return err('Failed to save flashcard', 500);
    }

    return NextResponse.json({ success: true });
  }

  // ── report_response ───────────────────────────────────────────────────────
  if (action === 'report_response') {
    const {
      session_id, student_message, foxy_response, report_reason,
      student_correction, subject, grade, topic_title, session_mode, language,
    } = body;

    if (typeof subject !== 'string' || !subject.trim()) return err('subject required', 400);
    if (typeof report_reason !== 'string' || !report_reason.trim()) return err('report_reason required', 400);
    if (typeof foxy_response !== 'string' || !foxy_response.trim()) return err('foxy_response required', 400);

    const reportGuard = await guardSubject(studentId, subject);
    if (reportGuard) return reportGuard;

    // Insert report
    const { error: insertError } = await supabaseAdmin.from('ai_response_reports').insert({
      student_id: studentId,
      session_id: typeof session_id === 'string' ? session_id : null,
      student_message: typeof student_message === 'string' ? student_message : null,
      foxy_response: (foxy_response as string).substring(0, 4000),
      report_reason,
      student_correction: typeof student_correction === 'string' ? student_correction || null : null,
      subject,
      grade: typeof grade === 'string' ? grade : null,
      topic_title: typeof topic_title === 'string' ? topic_title || null : null,
      session_mode: typeof session_mode === 'string' ? session_mode : null,
      language: typeof language === 'string' ? language : null,
    });

    if (insertError) {
      logger.error('foxy_report_insert_failed', { error: new Error(insertError.message), studentId, subject });
      return err('Failed to submit report', 500);
    }

    // Track AI quality — non-blocking, log failure but don't fail the request
    const { error: rpcError } = await supabaseAdmin.rpc('track_ai_quality', {
      p_subject: subject,
      p_is_report: true,
    });
    if (rpcError) {
      logger.warn('track_ai_quality_rpc_failed', { error: new Error(rpcError.message), subject });
    }

    return NextResponse.json({ success: true });
  }

  return err(`Unknown action: ${action}`, 400);
}
