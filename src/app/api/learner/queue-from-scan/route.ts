/**
 * POST /api/learner/queue-from-scan — turn an OCR'd scan into a
 *                                      flashcard in the unified queue.
 *
 * Phase 5 of ADR-001. The final substrate piece: scan output stops
 * dying on the /scan results page. When a learner scans homework, the
 * OCR result (front_text = extracted question; back_text = solver's
 * answer if available, else a placeholder) becomes a row in
 * spaced_repetition_cards with source='scan'. That row enters the
 * normal /review SRS queue and the /api/learner/next resolver's
 * review_due_cards branch can react to it.
 *
 * Body:
 *   { scanId: uuid }   the public.student_scans row id
 *
 * Behaviour:
 *   1. Auth + ownership check (scan must belong to caller's student_id).
 *   2. Read scan row — must be 'ocr_completed' or 'solved' (have text).
 *   3. Insert spaced_repetition_cards row with:
 *        - card_type = 'scan_question'
 *        - subject = student's preferred_subject (best effort)
 *        - grade = student's grade
 *        - front_text = scan.extracted_text (trimmed)
 *        - back_text = "(Solve to reveal the answer)" — the scan-solve
 *                      flow doesn't persist the solver's answer on the
 *                      student_scans row today; a future PR can plumb
 *                      that through. The card is still useful as a
 *                      re-encounter prompt — student sees the front,
 *                      tries to solve, then graders.
 *        - source = 'scan'
 *        - source_id = scanId
 *   4. Idempotent: if a card already exists with source_id=scanId for
 *      this student, return the existing one rather than duplicating.
 *
 * Gating: ff_scan_to_queue_v1. When OFF, 404s.
 *
 * Response (200):
 *   { ok: true, cardId: uuid, created: boolean }
 *
 * Errors:
 *   400 invalid body / scan has no extracted text
 *   401 unauthenticated
 *   403 scan belongs to a different student
 *   404 flag off / no profile / scan not found
 *   500 DB write failed
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const FLAG_NAME = 'ff_scan_to_queue_v1';

const RequestSchema = z.object({
  scanId: z.string().uuid(),
});

interface StudentRow {
  id: string;
  grade: string | null;
  preferred_subject: string | null;
}

interface ScanRow {
  id: string;
  student_id: string;
  status: string | null;
  extracted_text: string | null;
}

interface ExistingCardRow {
  id: string;
}

/**
 * Pure: derive the card payload from a scan + student snapshot. Exported
 * for testing. Falls back to safe defaults when student fields are
 * sparse (subject 'general', grade '0').
 */
export function buildFlashcardPayload(args: {
  scanId: string;
  studentId: string;
  extractedText: string;
  subject: string | null;
  grade: string | null;
}): {
  student_id: string;
  card_type: string;
  subject: string;
  grade: string;
  front_text: string;
  back_text: string;
  source: string;
  source_id: string;
} {
  const front = args.extractedText.trim().slice(0, 1000);
  return {
    student_id: args.studentId,
    card_type: 'scan_question',
    subject: (args.subject ?? 'general').toLowerCase(),
    grade: args.grade ?? '0',
    front_text: front,
    back_text: '(Solve to reveal the answer)',
    source: 'scan',
    source_id: args.scanId,
  };
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'quiz.attempt', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse!;

  const userId = auth.userId!;
  const studentId = auth.studentId!;

  // Flag gate.
  const flagOn = await isFeatureEnabled(FLAG_NAME, {
    userId, role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Body validate.
  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_body', detail: (err as Error).message.slice(0, 300) },
      { status: 400 },
    );
  }
  const { scanId } = body;

  // Read the scan, verify ownership.
  const { data: scanRaw, error: scanErr } = await supabaseAdmin
    .from('student_scans')
    .select('id, student_id, status, extracted_text')
    .eq('id', scanId)
    .maybeSingle();
  if (scanErr) {
    logger.warn('queue-from-scan: scan read failed', { scanId, error: scanErr.message });
    return NextResponse.json({ error: 'scan_read_failed' }, { status: 500 });
  }
  const scan = scanRaw as ScanRow | null;
  if (!scan) {
    return NextResponse.json({ error: 'scan_not_found' }, { status: 404 });
  }
  if (scan.student_id !== studentId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!scan.extracted_text || scan.extracted_text.trim().length === 0) {
    return NextResponse.json(
      { error: 'scan_has_no_text', detail: 'OCR did not extract usable text from this scan.' },
      { status: 400 },
    );
  }

  // Idempotency: a card already exists for this scan? Return it.
  const { data: existingRaw } = await supabaseAdmin
    .from('spaced_repetition_cards')
    .select('id')
    .eq('student_id', studentId)
    .eq('source', 'scan')
    .eq('source_id', scanId)
    .maybeSingle();
  const existing = existingRaw as ExistingCardRow | null;
  if (existing) {
    return NextResponse.json(
      { ok: true, cardId: existing.id, created: false },
      { status: 200 },
    );
  }

  // Read student for subject/grade context. Best-effort — defaults if missing.
  const { data: studentRaw } = await supabaseAdmin
    .from('students')
    .select('id, grade, preferred_subject')
    .eq('id', studentId)
    .maybeSingle();
  const student = studentRaw as StudentRow | null;

  const payload = buildFlashcardPayload({
    scanId,
    studentId,
    extractedText: scan.extracted_text,
    subject: student?.preferred_subject ?? null,
    grade: student?.grade ?? null,
  });

  const { data: insertedRaw, error: insertErr } = await supabaseAdmin
    .from('spaced_repetition_cards')
    .insert(payload)
    .select('id')
    .single();
  if (insertErr || !insertedRaw) {
    logger.warn('queue-from-scan: card insert failed', {
      scanId, error: insertErr?.message,
    });
    return NextResponse.json({ error: 'card_insert_failed' }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, cardId: (insertedRaw as { id: string }).id, created: true },
    { status: 200 },
  );
}
