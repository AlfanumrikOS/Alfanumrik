import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, isValidUUID } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

const VALID_CATEGORIES = [
  'support-call',
  'bug-report',
  'account-issue',
  'observation',
  'escalation',
] as const;

type NoteCategory = (typeof VALID_CATEGORIES)[number];

// GET /api/super-admin/students/[id]/notes — list support notes for a student
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const { id: studentId } = await params;
  if (!isValidUUID(studentId)) {
    return NextResponse.json({ error: 'Invalid student ID' }, { status: 400 });
  }

  try {
    // Fetch notes for this student, ordered by created_at ascending
    const { data: notes, error } = await supabaseAdmin
      .from('admin_support_notes')
      .select('id, student_id, admin_id, category, content, created_at')
      .eq('student_id', studentId)
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Look up admin names from admin_users for all unique admin_ids
    const adminIds = [...new Set((notes || []).map((n) => n.admin_id))];
    let adminNameMap: Record<string, string> = {};

    if (adminIds.length > 0) {
      const { data: admins } = await supabaseAdmin
        .from('admin_users')
        .select('id, name')
        .in('id', adminIds);

      if (admins) {
        adminNameMap = Object.fromEntries(admins.map((a) => [a.id, a.name]));
      }
    }

    // Enrich notes with admin_name
    const enrichedNotes = (notes || []).map((n) => ({
      id: n.id,
      student_id: n.student_id,
      admin_id: n.admin_id,
      admin_name: adminNameMap[n.admin_id] || 'Unknown',
      category: n.category,
      content: n.content,
      created_at: n.created_at,
    }));

    return NextResponse.json({ notes: enrichedNotes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// POST /api/super-admin/students/[id]/notes — create a support note
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const { id: studentId } = await params;
  if (!isValidUUID(studentId)) {
    return NextResponse.json({ error: 'Invalid student ID' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { content, category } = body;

    // Validate content
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json(
        { error: 'content is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    // Validate category
    const noteCategory: NoteCategory = category || 'observation';
    if (!VALID_CATEGORIES.includes(noteCategory)) {
      return NextResponse.json(
        {
          error: `category must be one of: ${VALID_CATEGORIES.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Verify student exists
    const { data: student } = await supabaseAdmin
      .from('students')
      .select('id')
      .eq('id', studentId)
      .single();

    if (!student) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    // Insert the note
    const { data: note, error } = await supabaseAdmin
      .from('admin_support_notes')
      .insert({
        student_id: studentId,
        admin_id: auth.adminId,
        category: noteCategory,
        content: content.trim(),
      })
      .select('id, student_id, admin_id, category, content, created_at')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Audit log
    await logAdminAudit(
      auth,
      'support_note_created',
      'admin_support_notes',
      note.id,
      { student_id: studentId, category: noteCategory },
      request.headers.get('x-forwarded-for') || undefined
    );

    return NextResponse.json(
      {
        note: {
          ...note,
          admin_name: auth.name,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
