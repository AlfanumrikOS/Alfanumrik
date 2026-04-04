import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

// CSV template columns
const REQUIRED_COLUMNS = ['name', 'grade', 'email'];
const OPTIONAL_COLUMNS = ['phone', 'board', 'section', 'roll_number'];
const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];

/**
 * POST — Accepts CSV file, validates rows, creates student accounts in bulk.
 * Max 1000 students per upload. Grades must be string "6"-"12" (P5).
 * Emails are redacted in audit logs (P13).
 */
export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const schoolId = formData.get('school_id') as string | null;

    if (!file || !file.name.endsWith('.csv')) {
      return NextResponse.json({ error: 'Please upload a CSV file' }, { status: 400 });
    }

    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());

    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV must have a header row and at least one data row' }, { status: 400 });
    }

    if (lines.length > 1001) {
      return NextResponse.json({ error: 'Maximum 1000 students per upload' }, { status: 400 });
    }

    // Parse header
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const missingRequired = REQUIRED_COLUMNS.filter(c => !headers.includes(c));
    if (missingRequired.length > 0) {
      return NextResponse.json(
        { error: `Missing required columns: ${missingRequired.join(', ')}` },
        { status: 400 }
      );
    }

    // Create job record for tracking
    const { data: job, error: jobError } = await supabaseAdmin
      .from('bulk_upload_jobs')
      .insert({
        school_id: schoolId,
        uploaded_by: auth.adminId,
        filename: file.name,
        total_rows: lines.length - 1,
        status: 'processing',
      })
      .select()
      .single();

    // If bulk_upload_jobs table doesn't exist yet, proceed without job tracking
    const jobId = job?.id || null;

    // Process rows
    const errors: Array<{ row: number; field: string; message: string }> = [];
    let successCount = 0;
    const seenEmails = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] || '';
      });

      // Validate name
      if (!row.name || row.name.length < 2) {
        errors.push({ row: i + 1, field: 'name', message: 'Name is required (min 2 chars)' });
        continue;
      }

      // Validate grade — must be string "6"-"12" per P5
      if (!VALID_GRADES.includes(row.grade)) {
        errors.push({ row: i + 1, field: 'grade', message: `Invalid grade "${row.grade}". Must be 6-12` });
        continue;
      }

      // Validate email
      if (!row.email || !row.email.includes('@')) {
        errors.push({ row: i + 1, field: 'email', message: 'Valid email is required' });
        continue;
      }

      // Check for duplicates within the upload
      const emailLower = row.email.toLowerCase();
      if (seenEmails.has(emailLower)) {
        errors.push({ row: i + 1, field: 'email', message: 'Duplicate email in this upload' });
        continue;
      }
      seenEmails.add(emailLower);

      // Check if email already exists in the system
      const { data: existing } = await supabaseAdmin
        .from('students')
        .select('id')
        .eq('email', emailLower)
        .maybeSingle();

      if (existing) {
        errors.push({ row: i + 1, field: 'email', message: 'Student with this email already exists' });
        continue;
      }

      // Create auth user + student record
      try {
        const tempPassword = `Alf${Math.random().toString(36).slice(2, 8)}!${Math.floor(Math.random() * 100)}`;

        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email: emailLower,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { name: row.name, role: 'student', grade: row.grade },
        });

        if (authError) {
          errors.push({ row: i + 1, field: 'email', message: authError.message });
          continue;
        }

        // The student record is auto-created by the handle_new_user trigger.
        // Update school assignment if provided.
        if (schoolId && authUser?.user?.id) {
          await supabaseAdmin
            .from('students')
            .update({ school_id: schoolId })
            .eq('auth_user_id', authUser.user.id);
        }

        successCount++;
      } catch (err) {
        errors.push({
          row: i + 1,
          field: 'system',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    // Update job status if job tracking is available
    if (jobId) {
      await supabaseAdmin
        .from('bulk_upload_jobs')
        .update({
          status: 'completed',
          processed_rows: lines.length - 1,
          success_count: successCount,
          error_count: errors.length,
          errors: errors,
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    }

    // Audit log — redact emails per P13
    await logAdminAudit(auth, 'bulk_student_upload', 'bulk_upload_jobs', jobId || 'no-job', {
      filename: file.name,
      total_rows: lines.length - 1,
      success_count: successCount,
      error_count: errors.length,
      school_id: schoolId || null,
    });

    return NextResponse.json({
      success: true,
      data: {
        job_id: jobId,
        total_rows: lines.length - 1,
        success_count: successCount,
        error_count: errors.length,
        errors: errors.slice(0, 50), // Return first 50 errors
        status: 'completed',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

/**
 * GET — Download CSV template or list recent upload jobs.
 * Query params: ?action=template | ?action=jobs
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const action = new URL(request.url).searchParams.get('action');

  if (action === 'template') {
    const template = [
      [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].join(','),
      'Rahul Sharma,9,rahul@school.edu,9876543210,CBSE,A,101',
      'Priya Singh,10,priya@school.edu,9876543211,CBSE,B,201',
    ].join('\n');

    return new NextResponse(template, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename=alfanumrik_student_upload_template.csv',
      },
    });
  }

  if (action === 'jobs') {
    const { data, error } = await supabaseAdmin
      .from('bulk_upload_jobs')
      .select('id,school_id,uploaded_by,filename,total_rows,success_count,error_count,status,created_at,completed_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch upload jobs' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: data || [] });
  }

  return NextResponse.json(
    { success: false, error: 'Invalid action. Use ?action=template or ?action=jobs' },
    { status: 400 }
  );
}
