/**
 * Scan-to-Solve API Route
 *
 * Orchestrates the OCR → NCERT Solver pipeline:
 *   1. Receive image (FormData or base64)
 *   2. Upload to Supabase Storage
 *   3. Call scan-ocr Edge Function to extract text
 *   4. Call ncert-solver Edge Function to solve the question
 *   5. Return combined result
 *
 * Rate limit: 10 scans/day per student (configurable by plan).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { validateSubjectWrite } from '@/lib/subjects';
import { isFeatureEnabled } from '@/lib/feature-flags';

// ─── Rate Limits by Plan ───────────────────────────────────────
const SCAN_LIMITS: Record<string, number> = {
  free: 3,
  basic: 10,
  premium: 30,
  unlimited: 100,
};

const DEFAULT_SCAN_LIMIT = 10;

// ─── Helpers ───────────────────────────────────────────────────

function bilingualError(en: string, hi: string, isHi: boolean) {
  return isHi ? hi : en;
}

async function checkDailyLimit(studentId: string, plan: string | null): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = SCAN_LIMITS[plan || 'free'] ?? DEFAULT_SCAN_LIMIT;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count, error } = await supabaseAdmin
    .from('student_scans')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .gte('created_at', todayStart.toISOString());

  if (error) {
    logger.warn('scan-solve: rate limit check failed', { studentId, error: error.message });
    // Fail open — allow the scan but log the issue
    return { allowed: true, used: 0, limit };
  }

  const used = count ?? 0;
  return { allowed: used < limit, used, limit };
}

// ─── POST Handler ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const isHi = request.headers.get('x-lang') === 'hi';

  try {
    // ── Auth ──
    const auth = await authorizeRequest(request, 'quiz.attempt');
    if (!auth.authorized) return auth.errorResponse!;

    // ── Global AI kill switch (ai_usage_global) ──
    // Seeded by 20260425160000_p0_launch_kill_switches_and_expiry_rpc.sql.
    // Default true. Flip OFF to halt ALL AI/LLM calls (scan-solve invokes
    // the ncert-solver Edge Function, which spends Claude tokens).
    if (!(await isFeatureEnabled('ai_usage_global'))) {
      logger.warn('scan-solve: ai_usage_global kill switch active');
      return new NextResponse(
        JSON.stringify({
          error: bilingualError(
            'Scan-to-solve is temporarily unavailable. Please try again in a minute.',
            'Scan-to-solve abhi available nahi hai. Kripya thodi der baad try karein.',
            isHi,
          ),
        }),
        { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } },
      );
    }

    const userId = auth.userId!;
    const studentId = auth.studentId;

    if (!studentId) {
      return NextResponse.json(
        { error: bilingualError('Student profile not found', 'Student profile nahi mili', isHi) },
        { status: 404 },
      );
    }

    // ── Get student info ──
    const { data: student } = await supabaseAdmin
      .from('students')
      .select('id, grade, subscription_plan, preferred_subject')
      .eq('id', studentId)
      .single();

    if (!student) {
      return NextResponse.json(
        { error: bilingualError('Student not found', 'Student nahi mili', isHi) },
        { status: 404 },
      );
    }

    // ── Rate limit ──
    const rateCheck = await checkDailyLimit(studentId, student.subscription_plan);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: bilingualError(
            `Daily scan limit reached (${rateCheck.used}/${rateCheck.limit}). Upgrade your plan for more scans.`,
            `Aaj ke scan limit ho gaye (${rateCheck.used}/${rateCheck.limit}). Zyada scans ke liye plan upgrade karein.`,
            isHi,
          ),
          limit_reached: true,
          used: rateCheck.used,
          limit: rateCheck.limit,
        },
        { status: 429 },
      );
    }

    // ── Parse input ──
    const contentType = request.headers.get('content-type') || '';
    let imageBase64: string | null = null;
    let fileName = `scan_${Date.now()}.jpg`;
    let fileType = 'image/jpeg';
    // Subject: default to student's preferred_subject. Client-supplied values
    // (form field / JSON body) are accepted only if they pass governance below.
    // The legacy 'x-subject' header is no longer honoured (removed for P13/governance).
    let subject = student.preferred_subject || '';
    let grade = student.grade;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('image') as File | null;
      if (formData.get('subject')) subject = formData.get('subject') as string;
      if (formData.get('grade')) grade = formData.get('grade') as string;

      if (!file) {
        return NextResponse.json(
          { error: bilingualError('Image file required', 'Image file zaroori hai', isHi) },
          { status: 400 },
        );
      }

      if (!file.type.startsWith('image/')) {
        return NextResponse.json(
          { error: bilingualError('Only image files are accepted', 'Sirf image files accepted hain', isHi) },
          { status: 400 },
        );
      }

      // 5MB limit
      if (file.size > 5 * 1024 * 1024) {
        return NextResponse.json(
          { error: bilingualError('Image must be under 5MB', 'Image 5MB se chhoti honi chahiye', isHi) },
          { status: 400 },
        );
      }

      fileName = file.name || fileName;
      fileType = file.type;
      const buffer = await file.arrayBuffer();
      imageBase64 = Buffer.from(buffer).toString('base64');
    } else {
      // JSON body with base64 image
      const body = await request.json();
      imageBase64 = body.image_base64;
      if (body.subject) subject = body.subject;
      if (body.grade) grade = body.grade;
      if (body.file_name) fileName = body.file_name;

      if (!imageBase64) {
        return NextResponse.json(
          { error: bilingualError('image_base64 required', 'image_base64 zaroori hai', isHi) },
          { status: 400 },
        );
      }
    }

    // ── Subject governance ──
    // Reject if caller tried to override subject with a value outside the
    // student's allowed set. Missing subject is allowed (solver falls back).
    if (subject) {
      const subjectValidation = await validateSubjectWrite(studentId, subject, {
        supabase: supabaseAdmin,
      });
      if (!subjectValidation.ok) {
        return NextResponse.json(
          {
            error: subjectValidation.error.code,
            subject: subjectValidation.error.subject,
            reason: subjectValidation.error.reason,
            allowed: subjectValidation.error.allowed,
          },
          { status: 422 },
        );
      }
    }

    // ── Upload to Supabase Storage ──
    const storagePath = `${studentId}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const imageBuffer = Buffer.from(imageBase64, 'base64');

    const { error: uploadErr } = await supabaseAdmin.storage
      .from('student-scans')
      .upload(storagePath, imageBuffer, {
        contentType: fileType,
        upsert: false,
      });

    if (uploadErr) {
      logger.error('scan-solve: storage upload failed', { studentId, error: uploadErr.message });
      return NextResponse.json(
        { error: bilingualError('Failed to upload image', 'Image upload fail ho gayi', isHi) },
        { status: 500 },
      );
    }

    // ── Create scan record ──
    const { data: scanRecord, error: insertErr } = await supabaseAdmin
      .from('student_scans')
      .insert({
        student_id: studentId,
        file_name: fileName,
        file_type: fileType,
        storage_path: storagePath,
        status: 'processing',
      })
      .select('id')
      .single();

    if (insertErr || !scanRecord) {
      logger.error('scan-solve: scan record insert failed', { studentId, error: insertErr?.message });
      return NextResponse.json(
        { error: bilingualError('Failed to create scan record', 'Scan record nahi ban paya', isHi) },
        { status: 500 },
      );
    }

    // ── Step 1: OCR — Get signed URL and extract text ──
    const { data: signedUrlData } = await supabaseAdmin.storage
      .from('student-scans')
      .createSignedUrl(storagePath, 300);

    if (!signedUrlData?.signedUrl) {
      await supabaseAdmin.from('student_scans').update({ status: 'failed', error_message: 'File not accessible' }).eq('id', scanRecord.id);
      return NextResponse.json(
        { error: bilingualError('Could not access uploaded file', 'Uploaded file access nahi ho payi', isHi) },
        { status: 500 },
      );
    }

    // Call scan-ocr Edge Function
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      logger.error('scan-solve: missing Supabase env vars');
      return NextResponse.json(
        { error: bilingualError('Server configuration error', 'Server configuration mein error hai', isHi) },
        { status: 500 },
      );
    }

    const ocrResponse = await fetch(`${supabaseUrl}/functions/v1/scan-ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        action: 'upload_and_process',
        file_name: fileName,
        file_type: fileType,
        storage_path: storagePath,
      }),
    });

    const ocrResult = await ocrResponse.json();

    if (!ocrResponse.ok || ocrResult.status === 'failed' || !ocrResult.text_preview) {
      // Update scan record as failed
      await supabaseAdmin.from('student_scans').update({
        status: 'ocr_failed',
        error_message: 'OCR could not extract text',
        updated_at: new Date().toISOString(),
      }).eq('id', scanRecord.id);

      return NextResponse.json({
        scan_id: scanRecord.id,
        status: 'ocr_failed',
        extracted_text: null,
        solution: null,
        error: bilingualError(
          'Could not read text from this image. Please try a clearer photo.',
          'Is image se text nahi padh paaye. Saaf photo try karein.',
          isHi,
        ),
      }, { status: 200 }); // 200 — not a server error, just OCR failure
    }

    const extractedText = ocrResult.text_preview;

    // ── Step 2: Solve — Call ncert-solver Edge Function ──
    let solution = null;
    let solveError = null;

    try {
      const solverResponse = await fetch(`${supabaseUrl}/functions/v1/ncert-solver`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          question: extractedText,
          subject: subject || 'general',
          grade: grade,
        }),
      });

      if (solverResponse.ok) {
        solution = await solverResponse.json();
      } else {
        const errBody = await solverResponse.json().catch(() => ({}));
        solveError = errBody.error || `Solver returned ${solverResponse.status}`;
        logger.warn('scan-solve: ncert-solver failed', { studentId, status: solverResponse.status, error: solveError });
      }
    } catch (err) {
      solveError = err instanceof Error ? err.message : 'Solver network error';
      logger.error('scan-solve: ncert-solver exception', { studentId, error: solveError });
    }

    // ── Update scan record ──
    await supabaseAdmin.from('student_scans').update({
      status: solution ? 'solved' : 'ocr_completed',
      updated_at: new Date().toISOString(),
    }).eq('id', scanRecord.id);

    // ── Log for analytics (no PII — just IDs and metadata) ──
    logger.info('scan-solve: completed', {
      scanId: scanRecord.id,
      sessionId: studentId, // Not PII — internal DB ID
      hasOCR: true,
      hasSolution: !!solution,
      subject,
      grade,
      textLength: extractedText.length,
      ocrConfidence: ocrResult.confidence,
    });

    // ── Return combined result ──
    return NextResponse.json({
      scan_id: scanRecord.id,
      status: solution ? 'solved' : 'ocr_only',
      extracted_text: extractedText,
      solution: solution ? {
        answer: solution.answer || '',
        steps: solution.steps || [],
        explanation: solution.explanation || '',
        concept: solution.concept || '',
        common_mistake: solution.common_mistake || '',
        formula_used: solution.formula_used || '',
        confidence: solution.confidence || 0,
        verified: solution.verified ?? false,
        question_type: solution.question_type || 'unknown',
        subject: subject || 'general',
        topic: solution.concept || '',
      } : null,
      solve_error: solveError ? bilingualError(
        'Could not solve this question. Try asking Foxy instead.',
        'Is sawaal ka hal nahi mil paaya. Foxy se poochein.',
        isHi,
      ) : null,
      remaining_scans: rateCheck.limit - rateCheck.used - 1,
    });

  } catch (err) {
    logger.error('scan-solve: unhandled error', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: bilingualError('Something went wrong. Please try again.', 'Kuch galat ho gaya. Dobara try karein.', isHi) },
      { status: 500 },
    );
  }
}
