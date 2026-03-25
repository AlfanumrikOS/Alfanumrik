import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { sanitizeFilename } from '@/lib/sanitize';

const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * POST /api/v1/upload-assignment — Upload assignment image
 * Permission: image.upload
 * Validates file type, size (max 10MB), and stores metadata.
 */
export async function POST(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'image.upload', {
      requireStudentId: true,
    });
    if (!auth.authorized) return auth.errorResponse!;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const rawImageType = (formData.get('image_type') as string) || 'assignment';
    // Whitelist image_type to prevent arbitrary values in the database
    const VALID_IMAGE_TYPES = ['assignment', 'question_paper', 'notes', 'textbook'];
    const imageType = VALID_IMAGE_TYPES.includes(rawImageType) ? rawImageType : 'assignment';

    // Validate file presence
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File too large (max 10MB)' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed: JPEG, PNG, WebP, HEIC' },
        { status: 400 }
      );
    }

    // Sanitize filename and build storage path
    const sanitizedName = sanitizeFilename(file.name);
    const path = `${auth.studentId}/${Date.now()}_${sanitizedName}`;

    // Upload to Supabase storage
    const { error: uploadErr } = await supabaseAdmin.storage
      .from('uploads')
      .upload(path, file);

    if (uploadErr) {
      return NextResponse.json(
        { error: 'Upload failed' },
        { status: 500 }
      );
    }

    // Use signed URL instead of public URL to prevent unauthorized access.
    // Signed URLs expire after 24 hours — client should refresh via the
    // image_uploads table path column if needed.
    const { data: signedData, error: signedErr } = await supabaseAdmin.storage
      .from('uploads')
      .createSignedUrl(path, 24 * 60 * 60); // 24 hour expiry

    if (signedErr || !signedData?.signedUrl) {
      return NextResponse.json(
        { error: 'Failed to generate secure URL' },
        { status: 500 }
      );
    }

    // Save metadata to database — store both the signed URL (for immediate use)
    // and the storage path (for generating new signed URLs later)
    const { data, error } = await supabaseAdmin
      .from('image_uploads')
      .insert({
        student_id: auth.studentId,
        image_url: signedData.signedUrl,
        storage_path: path,
        image_type: imageType,
        processing_status: 'pending',
      })
      .select()
      .single();

    logAudit(auth.userId, {
      action: 'upload',
      resourceType: 'image',
      resourceId: data?.id,
      details: { image_type: imageType, file_size: file.size },
    });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to save upload metadata' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    logger.error('upload_assignment_failed', { error: err instanceof Error ? err : new Error(String(err)), route: '/api/v1/upload-assignment' });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
