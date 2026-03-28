import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';

// Table / field mapping
type ContentType = 'chapter' | 'topic' | 'question';

const TABLE_MAP: Record<ContentType, string> = {
  chapter: 'chapters',
  topic: 'topics',
  question: 'question_bank',
};

const ALLOWED_FIELDS: Record<ContentType, string[]> = {
  chapter: ['title', 'title_hi', 'chapter_number', 'subject_code', 'grade', 'description', 'is_active'],
  topic: ['chapter_id', 'title', 'title_hi', 'topic_order', 'concept_text', 'concept_text_hi', 'is_active'],
  question: ['question_text', 'options', 'correct_option', 'explanation', 'subject', 'grade', 'chapter_title', 'difficulty', 'is_active'],
};

// Plural form used in the GET ?type= query param
const TYPE_PLURAL_MAP: Record<string, ContentType> = {
  chapters: 'chapter',
  topics: 'topic',
  questions: 'question',
  chapter: 'chapter',
  topic: 'topic',
  question: 'question',
};

function resolveType(raw: string | null): ContentType | null {
  if (!raw) return null;
  return TYPE_PLURAL_MAP[raw.toLowerCase()] ?? null;
}

function sanitiseFields(type: ContentType, data: Record<string, unknown>): Record<string, unknown> {
  const allowed = ALLOWED_FIELDS[type];
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (allowed.includes(k)) safe[k] = v;
  }
  return safe;
}

// GET  — list content with filtering & pagination
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const type = resolveType(params.get('type'));
    if (!type) {
      return NextResponse.json({ error: 'Missing or invalid "type" param. Use chapters, topics, or questions.' }, { status: 400 });
    }

    const table = TABLE_MAP[type];
    const page = Math.max(1, parseInt(params.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') || '25')));
    const offset = (page - 1) * limit;

    let queryParts = [`select=*`, `order=created_at.desc`, `offset=${offset}`, `limit=${limit}`];

    // Optional filters
    const subject = params.get('subject');
    const grade = params.get('grade');

    if (subject) {
      // chapters use subject_code, questions use subject
      const col = type === 'chapter' ? 'subject_code' : type === 'question' ? 'subject' : null;
      if (col) queryParts.push(`${col}=eq.${encodeURIComponent(subject)}`);
    }

    if (grade) {
      // chapters and questions have a grade column; topics don't
      if (type === 'chapter' || type === 'question') {
        queryParts.push(`grade=eq.${encodeURIComponent(grade)}`);
      }
    }

    const res = await fetch(supabaseAdminUrl(table, queryParts.join('&')), {
      method: 'GET',
      headers: supabaseAdminHeaders('count=exact'),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Supabase error: ${text}` }, { status: res.status });
    }

    const data = await res.json();
    const range = res.headers.get('content-range');
    const total = range ? parseInt(range.split('/')[1]) || 0 : data.length;

    return NextResponse.json({ data, total, page, limit });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// POST — create new content
export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const type = resolveType(body.type);
    if (!type) {
      return NextResponse.json({ error: 'Missing or invalid "type". Use chapter, topic, or question.' }, { status: 400 });
    }

    const rawData = body.data;
    if (!rawData || typeof rawData !== 'object') {
      return NextResponse.json({ error: 'Missing "data" object.' }, { status: 400 });
    }

    const safe = sanitiseFields(type, rawData);
    if (Object.keys(safe).length === 0) {
      return NextResponse.json({ error: 'No valid fields provided.' }, { status: 400 });
    }

    const table = TABLE_MAP[type];

    const res = await fetch(supabaseAdminUrl(table), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify(safe),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Create failed: ${text}` }, { status: res.status });
    }

    const created = await res.json();
    const createdId = Array.isArray(created) ? created[0]?.id : created?.id;
    await logAdminAudit(auth, `content.${type}.created`, table, createdId || '', { data: safe });
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// PATCH — update existing content
export async function PATCH(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const type = resolveType(body.type);
    if (!type) {
      return NextResponse.json({ error: 'Missing or invalid "type". Use chapter, topic, or question.' }, { status: 400 });
    }

    const { id, updates } = body;
    if (!id || !updates || typeof updates !== 'object') {
      return NextResponse.json({ error: 'Missing "id" or "updates" object.' }, { status: 400 });
    }

    const safe = sanitiseFields(type, updates);
    if (Object.keys(safe).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 });
    }

    const table = TABLE_MAP[type];
    const auditType = type; const auditId = id;

    const res = await fetch(supabaseAdminUrl(table, `id=eq.${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify(safe),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Update failed: ${text}` }, { status: res.status });
    }

    const updated = await res.json();
    if (Array.isArray(updated) && updated.length === 0) {
      return NextResponse.json({ error: 'No record found with that id.' }, { status: 404 });
    }

    await logAdminAudit(auth, `content.${auditType}.updated`, TABLE_MAP[auditType], auditId, { updates: safe });
    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// DELETE — soft delete (set is_active = false)
export async function DELETE(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const type = resolveType(body.type);
    if (!type) {
      return NextResponse.json({ error: 'Missing or invalid "type". Use chapter, topic, or question.' }, { status: 400 });
    }

    const { id } = body;
    if (!id) {
      return NextResponse.json({ error: 'Missing "id".' }, { status: 400 });
    }

    const table = TABLE_MAP[type];

    const res = await fetch(supabaseAdminUrl(table, `id=eq.${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify({ is_active: false }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Soft delete failed: ${text}` }, { status: res.status });
    }

    const updated = await res.json();
    if (Array.isArray(updated) && updated.length === 0) {
      return NextResponse.json({ error: 'No record found with that id.' }, { status: 404 });
    }

    await logAdminAudit(auth, `content.${type}.deleted`, table, id, {});
    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
