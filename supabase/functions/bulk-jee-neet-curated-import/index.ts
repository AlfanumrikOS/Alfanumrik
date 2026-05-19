/**
 * bulk-jee-neet-curated-import — Alfanumrik Edge Function
 *
 * This is the CURATED ingestion path — admin POSTs fully-formed questions;
 * no AI calls. For the AI-augmented variant that generates explanations
 * from raw PYQs via Claude, see `bulk-jee-neet-import/`.
 *
 * Admin-only curated ingestion path for JEE / NEET / Olympiad / Board /
 * other previous-year questions (PYQs). This is the second PR of the
 * JEE/NEET/Olympiad scaling roadmap. PR-1 (migration
 * 20260520000004_jee_neet_schema_unblock.sql) widened
 * `question_bank.chk_source_type` and added 6 PYQ-tracking columns. A
 * sibling migration (20260520000005) creates the `exam_papers` table that
 * this function writes to first.
 *
 * Flow (admin POST):
 *   1. CORS preflight, method, env checks.
 *   2. Admin auth via Bearer JWT → `admin_users.admin_level IN
 *      ('admin','super_admin')`.
 *   3. Parse + paper-level validate the request body.
 *   4. INSERT into `exam_papers`; 409 on duplicate paper_code.
 *   5. Per-question validate (P5 + P6 + family-subject map + paper_pattern).
 *      Each invalid row collects a structured rejection; valid rows are
 *      transformed for `question_bank` insert with auto-mapped
 *      `source_type` and inherited defaults.
 *   6. INSERT valid rows into `question_bank` (service-role; bypasses RLS).
 *   7. Emit `ops_events` audit event (severity=warn when rejections > 0).
 *   8. Return 200 with paper_id, inserted/rejected counts, and rejections.
 *
 * Auth: Bearer JWT with admin_users.admin_level IN ('admin','super_admin').
 *
 * Constitution alignment:
 *   - P5 (grade is a string) — enforced in validateQuestion.
 *   - P6 (4 distinct non-empty options, idx 0..3, non-empty explanation,
 *         valid difficulty/bloom) — enforced in validateQuestion.
 *   - P8 (RLS) — service-role used inside the function only; this is the
 *         correct admin-only boundary.
 *   - P9 (RBAC) — verifyAdminAuth gates the route.
 *   - P12 — does NOT apply (curated path; no Claude calls).
 *   - P13 — ops_events context contains counts + paper_code only (no PII).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { logOpsEvent } from '../_shared/ops-events.ts';
import {
  ALLOWED_EXAM_FAMILIES,
  ALLOWED_PAPER_PATTERNS,
  ALLOWED_SUBJECTS_BY_EXAM_FAMILY,
  mapSourceType,
  validateBatchSize,
  validatePaper,
  validateQuestion,
  type ImportRequestBody,
  type PaperInput,
  type QuestionInput,
  type QuestionRejection,
} from './validate.ts';

// Re-export the validation surface so unit tests can import either entry
// point. Both paths must remain stable.
export {
  ALLOWED_EXAM_FAMILIES,
  ALLOWED_PAPER_PATTERNS,
  ALLOWED_SUBJECTS_BY_EXAM_FAMILY,
  mapSourceType,
  validateBatchSize,
  validatePaper,
  validateQuestion,
};
export type { ImportRequestBody, PaperInput, QuestionInput, QuestionRejection };

// ─── Environment ──────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';

// ─── Admin auth — mirrors bulk-question-gen/verifyAdminAuth ─────────────────

async function verifyAdminAuth(
  req: Request,
): Promise<{ authorized: true; userId: string } | { authorized: false; error: string; status: number }> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { authorized: false, error: 'Missing or invalid Authorization header', status: 401 };
  }

  const token = authHeader.replace('Bearer ', '');

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return { authorized: false, error: 'Invalid or expired token', status: 401 };
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: adminRecord, error: adminErr } = await adminClient
    .from('admin_users')
    .select('admin_level')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (adminErr || !adminRecord) {
    return { authorized: false, error: 'Admin access required', status: 403 };
  }

  const ADMIN_LEVELS = ['admin', 'super_admin'];
  if (!ADMIN_LEVELS.includes(adminRecord.admin_level)) {
    return { authorized: false, error: 'Admin access required', status: 403 };
  }

  return { authorized: true, userId: user.id };
}

// ─── Row builder for question_bank ───────────────────────────────────────────

interface QuestionBankRow {
  question_text: string;
  question_type: string;
  options: string[];
  correct_answer_index: number;
  explanation: string;
  hint: string | null;
  difficulty: number;
  bloom_level: string;
  subject: string;
  grade: string;
  chapter_title: string | null;
  chapter_number: number | null;
  chapter_id: string | null;
  topic_id: string | null;
  source: string;
  source_type: string;
  is_active: boolean;
  is_verified: boolean;
  verification_state: string;
  exam_paper_id: string;
  paper_pattern: string;
  exam_session: string | null;
  question_number: string | null;
  marks_correct: number | null;
  marks_wrong: number | null;
  paper_section: string | null;
  tags: string[] | null;
  concept_code: string | null;
  cognitive_load: string | null;
  common_mistakes: Array<{ wrong: string; why: string }> | null;
  solution_steps: Array<{ step: number; text: string }> | null;
  created_at: string;
}

function buildQuestionBankRow(
  q: QuestionInput,
  paper: PaperInput,
  paperId: string,
  sourceType: string,
): QuestionBankRow {
  return {
    question_text: q.question_text,
    question_type: 'mcq',
    options: q.options,
    correct_answer_index: q.correct_answer_index,
    explanation: q.explanation,
    hint: q.hint || null,
    difficulty: q.difficulty ?? 3,
    bloom_level: q.bloom_level ?? 'apply',
    subject: q.subject,
    grade: q.grade, // P5: string
    chapter_title: q.chapter_title || null,
    chapter_number: q.chapter_number ?? null,
    chapter_id: q.chapter_id || null,
    topic_id: q.topic_id || null,
    source: 'jee_neet_curated_import',
    source_type: sourceType,
    is_active: true,
    is_verified: false,
    verification_state: 'pending',
    exam_paper_id: paperId,
    paper_pattern: q.paper_pattern ?? paper.paper_pattern,
    exam_session: paper.exam_session || null,
    question_number: q.question_number || null,
    marks_correct: q.marks_correct ?? null,
    marks_wrong: q.marks_wrong ?? null,
    paper_section: q.paper_section || null,
    tags: q.tags && q.tags.length > 0 ? q.tags : null,
    concept_code: q.concept_code || null,
    cognitive_load: q.cognitive_load || null,
    common_mistakes:
      q.common_mistakes && q.common_mistakes.length > 0 ? q.common_mistakes : null,
    solution_steps:
      q.solution_steps && q.solution_steps.length > 0 ? q.solution_steps : null,
    created_at: new Date().toISOString(),
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const cors = getCorsHeaders(origin);

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    return errorResponse('Supabase not configured', 503, origin);
  }

  try {
    // ── 1. Auth check (admin-only) ──────────────────────────────────────────
    const authResult = await verifyAdminAuth(req);
    if (!authResult.authorized) {
      return errorResponse(authResult.error, authResult.status, origin);
    }

    // ── 2. Parse request body ───────────────────────────────────────────────
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse('Invalid JSON body', 400, origin);
    }

    if (!body || typeof body !== 'object') {
      return errorResponse('Body must be a JSON object', 400, origin);
    }
    const { paper: rawPaper, questions: rawQuestions } = body as {
      paper?: unknown;
      questions?: unknown;
    };

    // ── 3. Batch size validation ────────────────────────────────────────────
    const sizeCheck = validateBatchSize(rawQuestions);
    if (!sizeCheck.ok) {
      return errorResponse(sizeCheck.message, 400, origin);
    }
    const questionsArr = rawQuestions as unknown[];

    // ── 4. Paper-level validation ───────────────────────────────────────────
    const paperResult = validatePaper(rawPaper, sizeCheck.n);
    if (!paperResult.ok) {
      return errorResponse(`${paperResult.field}: ${paperResult.message}`, 400, origin);
    }
    const paper = paperResult.paper;
    if (paperResult.warnings.length > 0) {
      console.warn(
        'bulk-jee-neet-curated-import: paper-level warnings',
        JSON.stringify(paperResult.warnings),
      );
    }

    // ── 5. Per-question validation ──────────────────────────────────────────
    // Validation runs BEFORE the exam_papers insert. If every row fails P5/P6
    // we'd otherwise leave an orphan paper row behind.
    const acceptedQuestions: QuestionInput[] = [];
    const rejections: QuestionRejection[] = [];
    for (let i = 0; i < questionsArr.length; i++) {
      const result = validateQuestion(questionsArr[i], i, paper);
      if (result.ok) {
        acceptedQuestions.push(result.q);
      } else {
        rejections.push(result.rejection);
      }
    }

    if (acceptedQuestions.length === 0) {
      // No paper insert happens here — return early with rejections so the
      // caller can fix and retry without polluting exam_papers.
      return jsonResponse(
        {
          paper_id: null,
          paper_code: paper.paper_code,
          exam_family: paper.exam_family,
          total: questionsArr.length,
          inserted: 0,
          rejected: rejections.length,
          rejections,
          questions: [],
          warning: 'All questions failed validation. exam_papers row not created.',
        },
        200,
        {},
        origin,
      );
    }

    // ── 6. Insert exam_papers row ───────────────────────────────────────────
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const paperRow = {
      paper_code: paper.paper_code,
      exam_family: paper.exam_family,
      exam_session: paper.exam_session || null,
      paper_pattern: paper.paper_pattern,
      exam_year: paper.exam_year,
      exam_month: paper.exam_month ?? null,
      shift: paper.shift || null,
      subject_scope: paper.subject_scope,
      total_questions: paper.total_questions ?? null,
      total_marks: paper.total_marks ?? null,
      duration_minutes: paper.duration_minutes ?? null,
      marking_scheme: paper.marking_scheme ?? null,
      source_url: paper.source_url || null,
      source_attribution: paper.source_attribution || null,
      notes: paper.notes || null,
      imported_by: authResult.userId,
      is_active: true,
    };

    const { data: paperInserted, error: paperErr } = await adminClient
      .from('exam_papers')
      .insert(paperRow)
      .select('id')
      .single();

    if (paperErr) {
      // Postgres unique violation → 409 with existing paper id.
      // PostgREST error code 23505 surfaces as code '23505' on .error.code.
      const errCode = (paperErr as { code?: string }).code;
      if (errCode === '23505') {
        const { data: existing } = await adminClient
          .from('exam_papers')
          .select('id')
          .eq('paper_code', paper.paper_code)
          .maybeSingle();
        return jsonResponse(
          {
            error: 'paper_code already exists',
            paper_code: paper.paper_code,
            existing_paper_id: existing?.id ?? null,
          },
          409,
          {},
          origin,
        );
      }
      console.error('bulk-jee-neet-curated-import: exam_papers insert failed:', paperErr.message);
      return errorResponse(`Failed to insert exam_papers row: ${paperErr.message}`, 500, origin);
    }

    const paperId = paperInserted!.id as string;

    // ── 7. Build + insert question_bank rows ────────────────────────────────
    const sourceType = mapSourceType(paper.exam_family);
    const rows: QuestionBankRow[] = acceptedQuestions.map((q) =>
      buildQuestionBankRow(q, paper, paperId, sourceType),
    );

    const { data: insertedRows, error: insertErr } = await adminClient
      .from('question_bank')
      .insert(rows)
      .select();

    if (insertErr) {
      console.error('bulk-jee-neet-curated-import: question_bank insert failed:', insertErr.message);
      // We've already written the exam_papers row. Leaving the orphan is
      // acceptable — admin can retry the import with the same paper_code
      // (will get 409 + existing id) or manually clean up via SQL.
      return errorResponse(
        `Failed to insert question_bank rows: ${insertErr.message}`,
        500,
        origin,
      );
    }

    const insertedArr = insertedRows || [];

    // ── 8. Audit log ────────────────────────────────────────────────────────
    await logOpsEvent({
      category: 'content.pyq_curated_import',
      source: 'bulk-jee-neet-curated-import',
      severity: rejections.length > 0 ? 'warning' : 'info',
      message: 'PYQ batch imported (curated path)',
      context: {
        paper_code: paper.paper_code,
        paper_id: paperId,
        exam_family: paper.exam_family,
        exam_year: paper.exam_year,
        source_type: sourceType,
        requested: questionsArr.length,
        inserted: insertedArr.length,
        rejected: rejections.length,
        rejection_codes: Array.from(new Set(rejections.map((r) => r.code))),
      },
    });

    console.warn(JSON.stringify({
      event: 'bulk_jee_neet_curated_import',
      function_name: 'bulk-jee-neet-curated-import',
      paper_code: paper.paper_code,
      paper_id: paperId,
      exam_family: paper.exam_family,
      source_type: sourceType,
      requested: questionsArr.length,
      inserted: insertedArr.length,
      rejected: rejections.length,
      ts: new Date().toISOString(),
    }));

    return jsonResponse(
      {
        paper_id: paperId,
        paper_code: paper.paper_code,
        exam_family: paper.exam_family,
        total: questionsArr.length,
        inserted: insertedArr.length,
        rejected: rejections.length,
        rejections,
        questions: insertedArr,
      },
      200,
      {},
      origin,
    );
  } catch (err) {
    console.error('bulk-jee-neet-curated-import: unexpected error:', err);
    return errorResponse('Internal server error', 500, origin);
  }
});
