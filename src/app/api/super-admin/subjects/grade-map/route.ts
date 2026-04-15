import { NextRequest, NextResponse } from 'next/server';
import {
  authorizeAdmin,
  logAdminAudit,
  supabaseAdminHeaders,
  supabaseAdminUrl,
} from '../../../../../lib/admin-auth';
import { isValidGrade } from '../../../../../lib/validation';
import { z } from 'zod';

/**
 * Grade × Subject Map API — declares which subjects exist for each
 * (grade, stream) bucket, whether they are core (mandatory) and the
 * minimum number of seeded questions required.
 *
 * Phase E (Subject Governance) — backend.
 */

const SNAKE_CASE = /^[a-z][a-z0-9_]{1,63}$/;
const STREAM_VALUES = ['none', 'science', 'commerce', 'humanities'] as const;

const upsertSchema = z.object({
  grade: z.string().refine(isValidGrade, 'Grade must be string "6"-"12"'),
  subject_code: z.string().regex(SNAKE_CASE, 'subject_code must be snake_case'),
  stream: z.enum(STREAM_VALUES).optional(),
  is_core: z.boolean().optional(),
  min_questions_seeded: z.number().int().min(0).max(100000).optional(),
});

const deleteSchema = z
  .object({
    id: z.string().uuid().optional(),
    grade: z.string().optional(),
    subject_code: z.string().optional(),
    stream: z.enum(STREAM_VALUES).optional(),
  })
  .refine(
    (b) => b.id || (b.grade && b.subject_code),
    'Either id, or (grade + subject_code) required'
  );

async function subjectExists(code: string): Promise<boolean> {
  const res = await fetch(
    supabaseAdminUrl(
      'subjects',
      `select=code&code=eq.${encodeURIComponent(code)}&limit=1`
    ),
    { headers: supabaseAdminHeaders() }
  );
  if (!res.ok) return false;
  const arr = await res.json();
  return Array.isArray(arr) && arr.length > 0;
}

// GET — list all rows
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const fields = 'id,grade,subject_code,stream,is_core,min_questions_seeded,created_at,updated_at';
    const res = await fetch(
      supabaseAdminUrl(
        'grade_subject_map',
        `select=${fields}&order=grade.asc,stream.asc,subject_code.asc&limit=2000`
      ),
      { headers: supabaseAdminHeaders() }
    );
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Fetch failed: ${text}` }, { status: res.status });
    }
    const rowsRaw = await res.json();
    const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
    // Phase I: `data` alias added for frontend compatibility (additive).
    return NextResponse.json({ rows, data: rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// PUT — upsert a row by (grade, subject_code, stream)
export async function PUT(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const stream = data.stream ?? 'none';

    if (!(await subjectExists(data.subject_code))) {
      return NextResponse.json(
        { error: `Unknown subject_code: ${data.subject_code}` },
        { status: 422 }
      );
    }

    const payload: Record<string, unknown> = {
      grade: data.grade,
      subject_code: data.subject_code,
      stream,
      is_core: data.is_core ?? false,
      min_questions_seeded: data.min_questions_seeded ?? 0,
      updated_at: new Date().toISOString(),
    };

    // Upsert via PostgREST: on_conflict on the natural key
    const res = await fetch(
      supabaseAdminUrl(
        'grade_subject_map',
        'on_conflict=grade,subject_code,stream'
      ),
      {
        method: 'POST',
        headers: {
          ...supabaseAdminHeaders('return=representation'),
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Upsert failed: ${text}` }, { status: res.status });
    }

    const upserted = await res.json();
    const row = Array.isArray(upserted) ? upserted[0] : upserted;

    await logAdminAudit(
      auth,
      'grade_subject_map.upserted',
      'grade_subject_map',
      row?.id || `${data.grade}:${data.subject_code}:${stream}`,
      { row: payload }
    );

    return NextResponse.json({ success: true, data: row });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// DELETE — remove by id or by (grade, subject_code, stream)
export async function DELETE(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    let filter: string;
    if (parsed.data.id) {
      filter = `id=eq.${encodeURIComponent(parsed.data.id)}`;
    } else {
      const stream = parsed.data.stream ?? 'none';
      filter =
        `grade=eq.${encodeURIComponent(parsed.data.grade!)}` +
        `&subject_code=eq.${encodeURIComponent(parsed.data.subject_code!)}` +
        `&stream=eq.${encodeURIComponent(stream)}`;
    }

    const res = await fetch(supabaseAdminUrl('grade_subject_map', filter), {
      method: 'DELETE',
      headers: supabaseAdminHeaders('return=representation'),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Delete failed: ${text}` }, { status: res.status });
    }

    const deleted = await res.json();
    if (Array.isArray(deleted) && deleted.length === 0) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 });
    }

    await logAdminAudit(
      auth,
      'grade_subject_map.deleted',
      'grade_subject_map',
      Array.isArray(deleted) ? deleted[0]?.id || '' : '',
      { deleted }
    );

    return NextResponse.json({ success: true, deleted });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
