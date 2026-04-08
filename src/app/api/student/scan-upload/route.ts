/**
 * POST /api/student/scan-upload
 *
 * Records a completed image upload (after Supabase Storage upload succeeds client-side).
 * Replaces direct anon-client insert in scan/page.tsx.
 *
 * WHY:
 *   - student_id came from client state — any student could log uploads for another
 *   - No validation that image_url is a valid Supabase Storage URL for this project
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

const ALLOWED_IMAGE_TYPES = ['homework', 'notes', 'textbook', 'whiteboard', 'other'];
const SUPABASE_STORAGE_HOST = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('https://', '') ?? '';

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'student.scan', { requireStudentId: true });
  if (!auth.authorized) return auth.errorResponse!;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return err('Invalid request body', 400); }

  const { image_url, image_type } = body;
  const studentId = auth.studentId!;

  if (typeof image_url !== 'string' || !image_url.trim()) return err('image_url required', 400);
  if (typeof image_type !== 'string' || !ALLOWED_IMAGE_TYPES.includes(image_type)) {
    return err(`image_type must be one of: ${ALLOWED_IMAGE_TYPES.join(', ')}`, 400);
  }

  // Validate URL is from our own Supabase Storage bucket (not an external URL)
  if (SUPABASE_STORAGE_HOST && !image_url.includes(SUPABASE_STORAGE_HOST)) {
    logger.warn('scan_upload_external_url_blocked', { studentId, image_url: image_url.substring(0, 100) });
    return err('image_url must be a Supabase Storage URL for this project', 400);
  }

  const { error } = await supabaseAdmin.from('image_uploads').insert({
    student_id: studentId,
    image_url,
    image_type,
    processing_status: 'pending',
  });

  if (error) {
    logger.error('scan_upload_insert_failed', { error: new Error(error.message), studentId });
    return err('Failed to record upload', 500);
  }

  return NextResponse.json({ success: true });
}
