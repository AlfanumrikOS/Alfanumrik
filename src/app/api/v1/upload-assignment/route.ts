import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { createClient } from '@supabase/supabase-js';

function getDb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
}

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
    const imageType = (formData.get('image_type') as string) || 'assignment';

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
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const path = `${auth.studentId}/${Date.now()}_${sanitizedName}`;

    // Upload to Supabase storage
    const { error: uploadErr } = await getDb().storage
      .from('uploads')
      .upload(path, file);

    if (uploadErr) {
      return NextResponse.json(
        { error: 'Upload failed' },
        { status: 500 }
      );
    }

    const url = getDb().storage.from('uploads').getPublicUrl(path).data
      .publicUrl;

    // Save metadata to database
    const { data, error } = await getDb()
      .from('image_uploads')
      .insert({
        student_id: auth.studentId,
        image_url: url,
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
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
