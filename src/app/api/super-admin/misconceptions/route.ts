// src/app/api/super-admin/misconceptions/route.ts
// Phase 3 of Foxy moat plan — editorial curation surface for the
// misconception ontology. Pairs with the read-only `misconception_candidates`
// view (migration 20260428000500) and writes curated rows into
// `question_misconceptions`.
//
// GET  — lists candidates (pending|curated|all), paginated
// POST — inserts a curated misconception annotation
//
// Auth: super_admin.access (matches the qm_super_admin_write RLS policy).

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logOpsEvent } from '@/lib/ops-events';
import { logger } from '@/lib/logger';
import { validateCuratePayload } from '@/lib/super-admin/misconception-validation';

export const runtime = 'nodejs';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

interface Candidate {
  question_id: string;
  distractor_index: number;
  times_picked: number;
  times_wrong: number;
  total_responses: number;
  wrong_rate: number;
  question_text: string;
  options: string[];
  correct_answer_index: number;
  subject: string;
  grade: string;
  chapter_number: number | null;
  has_curated_misconception: boolean;
}

function clampLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function decodeCursor(raw: string | null): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const url = request.nextUrl;
    const status = url.searchParams.get('status') ?? 'pending';
    const subject = url.searchParams.get('subject');
    const grade = url.searchParams.get('grade');
    const limit = clampLimit(url.searchParams.get('limit'));
    const offset = decodeCursor(url.searchParams.get('cursor'));

    let query = supabaseAdmin
      .from('misconception_candidates')
      .select('*', { count: 'exact' })
      .order('wrong_rate', { ascending: false });

    if (status === 'pending') {
      query = query.eq('has_curated_misconception', false);
    } else if (status === 'curated') {
      query = query.eq('has_curated_misconception', true);
    }

    if (subject) query = query.eq('subject', subject);
    if (grade)   query = query.eq('grade', grade);

    const { data, error, count } = await query.range(offset, offset + limit - 1);

    if (error) {
      logger.error('misconceptions_list_failed', { error });
      return NextResponse.json(
        { error: 'list_failed', message: error.message },
        { status: 500 },
      );
    }

    const items = (data ?? []) as Candidate[];
    const nextCursor =
      count != null && offset + items.length < count
        ? String(offset + items.length)
        : null;

    return NextResponse.json({
      items,
      next_cursor: nextCursor,
      total: count ?? items.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('misconceptions_list_unhandled', { message });
    return NextResponse.json(
      { error: 'unhandled', message },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const validated = validateCuratePayload(body);
  if (typeof validated === 'string') {
    return NextResponse.json({ error: validated }, { status: 400 });
  }

  // Sanity: confirm question exists and the distractor isn't the correct
  // answer (curating the right answer as a misconception would be a
  // confusing data state — block server-side).
  const { data: q, error: qErr } = await supabaseAdmin
    .from('question_bank')
    .select('id, correct_answer_index')
    .eq('id', validated.question_id)
    .maybeSingle();
  if (qErr || !q) {
    return NextResponse.json({ error: 'question_not_found' }, { status: 404 });
  }
  if (validated.distractor_index === q.correct_answer_index) {
    return NextResponse.json({ error: 'distractor_is_correct_answer' }, { status: 422 });
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('question_misconceptions')
    .insert({
      question_id: validated.question_id,
      distractor_index: validated.distractor_index,
      misconception_code: validated.misconception_code,
      misconception_label: validated.misconception_label,
      misconception_label_hi: validated.misconception_label_hi ?? null,
      remediation_chunk_id: validated.remediation_chunk_id ?? null,
      remediation_concept_id: validated.remediation_concept_id ?? null,
      curator_id: auth.userId ?? null,
    })
    .select('id')
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      return NextResponse.json({ error: 'already_curated' }, { status: 409 });
    }
    logger.error('misconception_insert_failed', { error: insertErr });
    return NextResponse.json(
      { error: 'insert_failed', message: insertErr.message },
      { status: 500 },
    );
  }

  void logOpsEvent({
    category: 'content.curation',
    source: 'super-admin.misconceptions',
    severity: 'info',
    message: `misconception curated: ${validated.misconception_code}`,
    context: {
      question_id: validated.question_id,
      distractor_index: validated.distractor_index,
      curator_id: auth.userId,
    },
  }).catch(() => {});

  return NextResponse.json({ id: inserted!.id, ok: true }, { status: 201 });
}
