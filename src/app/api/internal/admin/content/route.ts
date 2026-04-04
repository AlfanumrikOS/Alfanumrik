import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSecret, logAdminAction } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

// GET /api/internal/admin/content
// ?resource=topics|questions|subjects&subject_code=&grade=&chapter=&page=&limit=&search=
export async function GET(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const sp = new URL(request.url).searchParams;
  const resource = sp.get('resource') || 'questions';
  const subject_code = sp.get('subject') || '';
  const grade = sp.get('grade') || '';
  const chapter = sp.get('chapter') || '';
  const search = sp.get('search') || '';
  const page = Math.max(1, parseInt(sp.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '25')));
  const offset = (page - 1) * limit;

  try {
    if (resource === 'subjects') {
      const { data, error } = await supabase
        .from('subjects')
        .select('id, code, name, icon, color')
        .eq('is_active', true)
        .order('display_order');
      if (error) throw error;
      return NextResponse.json({ data, total: data?.length ?? 0 });
    }

    if (resource === 'topics') {
      // Resolve subject_code → subject_id upfront for accurate filtering
      let subjectId: string | null = null;
      if (subject_code) {
        const { data: subj } = await supabase.from('subjects').select('id').eq('code', subject_code).single();
        subjectId = subj?.id ?? null;
        if (!subjectId) return NextResponse.json({ data: [], total: 0, page, limit });
      }

      let q = supabase
        .from('curriculum_topics')
        .select('id, grade, chapter_number, title, difficulty_level, estimated_minutes, is_active, display_order, subject:subject_id(code, name)', { count: 'exact' })
        .order('grade').order('chapter_number').order('display_order')
        .range(offset, offset + limit - 1);

      if (subjectId) q = q.eq('subject_id', subjectId);
      if (grade) q = q.eq('grade', grade);
      if (chapter) q = q.eq('chapter_number', parseInt(chapter));
      if (search) q = q.ilike('title', `%${search}%`);

      const { data, count, error } = await q;
      if (error) throw error;
      return NextResponse.json({ data, total: count ?? 0, page, limit });
    }

    if (resource === 'questions') {
      let q = supabase
        .from('question_bank')
        .select('id, subject, grade, chapter_number, question_text, question_type, difficulty, bloom_level, is_active, is_verified, created_at', { count: 'exact' })
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (subject_code) q = q.eq('subject', subject_code);
      if (grade) q = q.eq('grade', grade);
      if (chapter) q = q.eq('chapter_number', parseInt(chapter));
      if (search) q = q.ilike('question_text', `%${search}%`);

      const { data, count, error } = await q;
      if (error) throw error;
      return NextResponse.json({ data, total: count ?? 0, page, limit });
    }

    return NextResponse.json({ error: 'Invalid resource' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// POST /api/internal/admin/content — create question (topics require subject_id lookup)
export async function POST(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const ip = request.headers.get('x-forwarded-for') || '';

  try {
    const { resource, ...fields } = await request.json();

    if (resource === 'topic') {
      // Resolve subject_code → subject_id
      const required = ['subject_code', 'grade', 'chapter_number', 'title'];
      for (const f of required) {
        if (!fields[f]) return NextResponse.json({ error: `${f} is required` }, { status: 400 });
      }
      const { data: subj } = await supabase.from('subjects').select('id').eq('code', fields.subject_code).single();
      if (!subj) return NextResponse.json({ error: `Subject '${fields.subject_code}' not found` }, { status: 404 });

      const { subject_code: _sc, ...topicFields } = fields;
      const { data, error } = await supabase.from('curriculum_topics').insert({
        ...topicFields,
        subject_id: subj.id,
        display_order: fields.display_order ?? 999,
        is_active: fields.is_active ?? false,
      }).select().single();

      if (error) throw error;
      await logAdminAction({ action: 'create_topic', entity_type: 'curriculum_topic', entity_id: data.id, ip });
      return NextResponse.json({ success: true, data });
    }

    if (resource === 'question') {
      const required = ['subject', 'grade', 'chapter_number', 'question_text', 'question_type'];
      for (const f of required) {
        if (!fields[f]) return NextResponse.json({ error: `${f} is required` }, { status: 400 });
      }
      const { data, error } = await supabase.from('question_bank').insert({
        ...fields,
        is_active: fields.is_active ?? true,
        is_verified: false,
      }).select().single();

      if (error) throw error;
      await logAdminAction({ action: 'create_question', entity_type: 'question_bank', entity_id: data.id, ip });
      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json({ error: 'Invalid resource' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// PATCH /api/internal/admin/content — update topic or question
export async function PATCH(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const ip = request.headers.get('x-forwarded-for') || '';

  try {
    const { resource, id, ...updates } = await request.json();
    if (!id || !resource) return NextResponse.json({ error: 'id and resource required' }, { status: 400 });

    const table = resource === 'topic' ? 'curriculum_topics' : resource === 'question' ? 'question_bank' : null;
    if (!table) return NextResponse.json({ error: 'Invalid resource' }, { status: 400 });

    // Allowlist editable fields per resource
    const ALLOWED: Record<string, string[]> = {
      curriculum_topics: ['title', 'difficulty_level', 'estimated_minutes', 'is_active', 'display_order', 'chapter_number'],
      question_bank: ['question_text', 'difficulty', 'bloom_level', 'is_active', 'is_verified', 'question_type'],
    };
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (ALLOWED[table]?.includes(k)) safe[k] = v;
    }

    const { error } = await supabase.from(table).update(safe).eq('id', id);
    if (error) throw error;

    await logAdminAction({ action: `update_${resource}`, entity_type: table, entity_id: id, ip });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// DELETE /api/internal/admin/content?resource=topic|question&id=
export async function DELETE(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const ip = request.headers.get('x-forwarded-for') || '';
  const sp = new URL(request.url).searchParams;
  const resource = sp.get('resource') || '';
  const id = sp.get('id') || '';

  if (!id || !resource) return NextResponse.json({ error: 'resource and id required' }, { status: 400 });

  try {
    if (resource === 'question') {
      // Soft delete — preserve analytics
      const { error } = await supabase.from('question_bank').update({ deleted_at: new Date().toISOString(), is_active: false }).eq('id', id);
      if (error) throw error;
    } else if (resource === 'topic') {
      const { error } = await supabase.from('curriculum_topics').update({ is_active: false }).eq('id', id);
      if (error) throw error;
    } else {
      return NextResponse.json({ error: 'Invalid resource' }, { status: 400 });
    }

    await logAdminAction({ action: `delete_${resource}`, entity_type: resource, entity_id: id, ip });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
