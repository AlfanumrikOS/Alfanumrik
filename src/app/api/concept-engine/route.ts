import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeRequest } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { validateSubjectWrite } from '@/lib/subjects';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { callGroundedAnswer, type GroundedRequest } from '@/lib/ai/grounded-client';
import { PER_PLAN_TIMEOUT_MS } from '@/lib/grounding-config';

// ─── Types ───────────────────────────────────────────────────

interface ConceptBlock {
  concept_id: string;
  concept_number: number;
  title: string;
  title_hi: string | null;
  learning_objective: string;
  learning_objective_hi: string | null;
  explanation: string;
  explanation_hi: string | null;
  key_formula: string | null;
  example_title: string | null;
  example_content: string | null;
  example_content_hi: string | null;
  common_mistakes: string[];
  exam_tips: string[];
  diagram_refs: string[];
  diagram_description: string | null;
  practice_question: string | null;
  practice_options: string[] | null;
  practice_correct_index: number | null;
  practice_explanation: string | null;
  difficulty: number;
  bloom_level: string;
  estimated_minutes: number;
}

interface RAGChunk {
  chunk_id: string;
  chunk_text: string;
  topic: string | null;
  concept: string | null;
  chapter_title: string | null;
  chunk_index: number | null;
  page_number: number | null;
  media_url: string | null;
  media_type: string | null;
  media_description: string | null;
  content_type: string;
}

interface RAGQuestion {
  chunk_id: string;
  question_text: string | null;
  answer_text: string | null;
  question_type: string | null;
  ncert_exercise: string | null;
  marks_expected: number | null;
  bloom_level: string | null;
  chunk_text: string;
  topic: string | null;
  concept: string | null;
  chapter_title: string | null;
  media_url: string | null;
  page_number: number | null;
}

interface SearchResult {
  id: string;
  content: string;
  chapter_title: string | null;
  topic: string | null;
  concept: string | null;
  similarity: number;
  media_url: string | null;
  content_type: string;
}

interface QuizQuestion {
  id: string;
  question_text: string;
  question_hi: string | null;
  options: string[];
  correct_answer_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  difficulty: number;
  bloom_level: string;
  source: 'rag' | 'question_bank';
}

// ─── Validation ──────────────────────────────────────────────

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const VALID_ACTIONS = ['chapter', 'search', 'quiz-pool'];

function validateGrade(grade: string | null): string | null {
  if (!grade) return null;
  // Normalize: "Grade 10" -> "10", "grade10" -> "10"
  const normalized = grade.replace(/[^0-9]/g, '');
  return VALID_GRADES.includes(normalized) ? normalized : null;
}

function validateChapterNumber(chapter: string | null): number | null {
  if (!chapter) return null;
  const num = parseInt(chapter, 10);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status }
  );
}

// ─── Voyage Embedding ────────────────────────────────────────

async function generateQueryEmbedding(text: string): Promise<number[] | null> {
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!voyageKey) return null;
  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${voyageKey}`,
      },
      body: JSON.stringify({
        model: 'voyage-3',
        input: [text],
        output_dimension: 1024,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

// ─── Action Handlers ─────────────────────────────────────────

/**
 * action=chapter — Full chapter content with structured concepts, RAG chunks,
 * diagrams, and Q&A.
 */
async function handleChapter(
  grade: string,
  subject: string,
  chapterNumber: number
) {
  // Generate embedding for semantic search (best-effort)
  const semanticQuery = `Grade ${grade} ${subject} Chapter ${chapterNumber} key concepts`;
  const embedding = await generateQueryEmbedding(semanticQuery);

  // Fire all RPCs in parallel
  const [conceptsResult, contentResult, diagramResult, qaResult, semanticResult] =
    await Promise.all([
      // 1. Structured concepts (cached AI output)
      supabaseAdmin.rpc('get_chapter_concepts', {
        p_grade: grade,
        p_subject: subject,
        p_chapter_number: chapterNumber,
      }),
      // 2. RAG content chunks (full chapter text)
      supabaseAdmin.rpc('get_chapter_rag_content', {
        p_grade: grade,
        p_subject: subject,
        p_chapter_number: chapterNumber,
        p_content_type: 'content',
      }),
      // 3. RAG diagram chunks
      supabaseAdmin.rpc('get_chapter_rag_content', {
        p_grade: grade,
        p_subject: subject,
        p_chapter_number: chapterNumber,
        p_content_type: 'diagram',
      }),
      // 4. RAG Q&A
      supabaseAdmin.rpc('get_chapter_qa_from_rag', {
        p_grade: grade,
        p_subject: subject,
        p_chapter_number: chapterNumber,
      }),
      // 5. Semantic search for additional relevant chunks
      embedding
        ? supabaseAdmin.rpc('match_rag_chunks', {
            query_text: semanticQuery,
            p_subject: subject,
            p_grade: grade,
            match_count: 10,
            query_embedding: JSON.stringify(embedding),
          })
        : Promise.resolve({ data: null, error: null }),
    ]);

  // Log any RPC errors but don't fail the whole request
  if (conceptsResult.error) {
    logger.warn('get_chapter_concepts RPC failed', {
      error: conceptsResult.error.message,
      grade,
      subject,
      chapter: chapterNumber,
    });
  }
  if (contentResult.error) {
    logger.warn('get_chapter_rag_content (content) RPC failed', {
      error: contentResult.error.message,
      grade,
      subject,
      chapter: chapterNumber,
    });
  }
  if (diagramResult.error) {
    logger.warn('get_chapter_rag_content (diagram) RPC failed', {
      error: diagramResult.error.message,
      grade,
      subject,
      chapter: chapterNumber,
    });
  }
  if (qaResult.error) {
    logger.warn('get_chapter_qa_from_rag RPC failed', {
      error: qaResult.error.message,
      grade,
      subject,
      chapter: chapterNumber,
    });
  }

  const concepts: ConceptBlock[] = (conceptsResult.data ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (row: any) => ({
      concept_id: row.concept_id,
      concept_number: row.concept_number,
      title: row.title,
      title_hi: row.title_hi,
      learning_objective: row.learning_objective,
      learning_objective_hi: row.learning_objective_hi,
      explanation: row.explanation,
      explanation_hi: row.explanation_hi,
      key_formula: row.key_formula,
      example_title: row.example_title,
      example_content: row.example_content,
      example_content_hi: row.example_content_hi,
      common_mistakes: row.common_mistakes ?? [],
      exam_tips: row.exam_tips ?? [],
      diagram_refs: row.diagram_refs ?? [],
      diagram_description: row.diagram_description,
      practice_question: row.practice_question,
      practice_options: row.practice_options,
      practice_correct_index: row.practice_correct_index,
      practice_explanation: row.practice_explanation,
      difficulty: row.difficulty,
      bloom_level: row.bloom_level,
      estimated_minutes: row.estimated_minutes,
    })
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentChunks: RAGChunk[] = (contentResult.data ?? []).map((row: any) => ({
    chunk_id: row.chunk_id,
    chunk_text: row.chunk_text,
    topic: row.topic,
    concept: row.concept,
    chapter_title: row.chapter_title,
    chunk_index: row.chunk_index,
    page_number: row.page_number,
    media_url: row.media_url,
    media_type: row.media_type,
    media_description: row.media_description,
    content_type: row.content_type,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const diagramChunks: RAGChunk[] = (diagramResult.data ?? []).map((row: any) => ({
    chunk_id: row.chunk_id,
    chunk_text: row.chunk_text,
    topic: row.topic,
    concept: row.concept,
    chapter_title: row.chapter_title,
    chunk_index: row.chunk_index,
    page_number: row.page_number,
    media_url: row.media_url,
    media_type: row.media_type,
    media_description: row.media_description,
    content_type: row.content_type,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qaChunks: RAGQuestion[] = (qaResult.data ?? []).map((row: any) => ({
    chunk_id: row.chunk_id,
    question_text: row.question_text,
    answer_text: row.answer_text,
    question_type: row.question_type,
    ncert_exercise: row.ncert_exercise,
    marks_expected: row.marks_expected,
    bloom_level: row.bloom_level,
    chunk_text: row.chunk_text,
    topic: row.topic,
    concept: row.concept,
    chapter_title: row.chapter_title,
    media_url: row.media_url,
    page_number: row.page_number,
  }));

  // Derive chapter title from the first available source
  const chapterTitle =
    concepts[0]?.title ??
    contentChunks[0]?.chapter_title ??
    diagramChunks[0]?.chapter_title ??
    qaChunks[0]?.chapter_title ??
    `Chapter ${chapterNumber}`;

  const totalChunks =
    contentChunks.length + diagramChunks.length + qaChunks.length;

  return NextResponse.json({
    success: true,
    data: {
      chapter_title: chapterTitle,
      grade,
      subject,
      chapter_number: chapterNumber,
      concepts,
      content_chunks: contentChunks,
      diagram_chunks: diagramChunks,
      qa_chunks: qaChunks,
      source: 'rag' as const,
      total_chunks: totalChunks,
    },
  });
}

/**
 * action=search — Semantic search across RAG chunks using Voyage embeddings.
 *
 * Feature-flag gated: when `ff_grounded_ai_concept_engine` is ON, routes
 * through the grounded-answer service with `retrieve_only: true`. When OFF,
 * falls back to the legacy direct Voyage + match_rag_chunks path. The legacy
 * path is the Phase 3 kill switch and is deleted in Phase 4.
 */
async function handleSearch(
  grade: string,
  subject: string,
  query: string,
  contentType: string | null,
  userId: string | null,
  plan: string,
) {
  const useGroundedService = await isFeatureEnabled('ff_grounded_ai_concept_engine', {
    role: 'student',
    userId: userId ?? undefined,
  });

  if (useGroundedService) {
    return handleSearchViaGrounded(grade, subject, query, contentType, plan);
  }
  return handleSearchLegacy(grade, subject, query, contentType);
}

/**
 * Grounded-answer path (retrieve_only=true). The service runs Voyage +
 * match_rag_chunks with the same RPC, but inside the shared Edge Function
 * so circuit-breaker, timeout, and cache behavior stay consistent across
 * all surface routes.
 *
 * system_prompt_template is unused when retrieve_only=true but the validator
 * requires it to be a registered template — pass foxy_tutor_v1.
 */
async function handleSearchViaGrounded(
  grade: string,
  subject: string,
  query: string,
  contentType: string | null,
  plan: string,
) {
  const groundedRequest: GroundedRequest = {
    caller: 'concept-engine',
    student_id: null,
    query,
    scope: {
      board: 'CBSE',
      grade,
      subject_code: subject,
      chapter_number: null,
      chapter_title: null,
    },
    mode: 'soft',
    generation: {
      model_preference: 'auto',
      max_tokens: 1,
      temperature: 0,
      // Unused when retrieve_only=true, but validator requires a registered
      // template name. foxy_tutor_v1 is the canonical placeholder.
      system_prompt_template: 'foxy_tutor_v1',
      template_variables: {},
    },
    retrieval: { match_count: 10 },
    retrieve_only: true,
    timeout_ms: PER_PLAN_TIMEOUT_MS[plan] ?? 20000,
  };

  const hopTimeoutMs = (PER_PLAN_TIMEOUT_MS[plan] ?? 20000) + 2000;
  const grounded = await callGroundedAnswer(groundedRequest, { hopTimeoutMs });

  if (!grounded.grounded) {
    // Abstain — return empty results but preserve traceId for debugging.
    // chapter_not_ready / no_chunks_retrieved are the expected paths here
    // (service did retrieval but found nothing).
    logger.info('concept_engine_grounded_abstain', {
      grade,
      subject,
      query,
      abstainReason: grounded.abstain_reason,
      traceId: grounded.trace_id,
    });
    return NextResponse.json({
      success: true,
      data: {
        query,
        grade,
        subject,
        content_type: contentType,
        results: [] as SearchResult[],
        total_results: 0,
        has_embedding: true,
        traceId: grounded.trace_id,
        abstainReason: grounded.abstain_reason,
      },
    });
  }

  // Map citations → SearchResult[] for backward compat with existing clients.
  // Citation shape intentionally differs from match_rag_chunks row shape; the
  // mapping below preserves the subset the concept-engine client reads.
  const results: SearchResult[] = grounded.citations.map((c) => ({
    id: c.chunk_id,
    content: c.excerpt,
    chapter_title: c.chapter_title,
    topic: null,                 // Citation doesn't carry topic
    concept: null,               // Citation doesn't carry concept
    similarity: c.similarity,
    media_url: c.media_url,
    content_type: c.media_url ? 'diagram' : 'content',
  }));

  return NextResponse.json({
    success: true,
    data: {
      query,
      grade,
      subject,
      content_type: contentType,
      results,
      total_results: results.length,
      has_embedding: true,
      traceId: grounded.trace_id,
    },
  });
}

/** Legacy direct Voyage + match_rag_chunks path (kill-switch fallback). */
async function handleSearchLegacy(
  grade: string,
  subject: string,
  query: string,
  contentType: string | null,
) {
  // Generate Voyage embedding for the query
  const embedding = await generateQueryEmbedding(query);

  const rpcParams: Record<string, unknown> = {
    query_text: query,
    p_subject: subject,
    p_grade: grade,
    match_count: 10,
  };

  if (embedding) {
    rpcParams.query_embedding = JSON.stringify(embedding);
  }

  if (contentType) {
    rpcParams.p_content_type = contentType;
  }

  const { data, error } = await supabaseAdmin.rpc('match_rag_chunks', rpcParams);

  if (error) {
    logger.error('match_rag_chunks RPC failed in search', {
      error: error.message,
      grade,
      subject,
      query,
    });
    return errorResponse('Search failed. Please try again.', 500);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: SearchResult[] = (data ?? []).map((row: any) => ({
    id: row.id,
    content: row.content,
    chapter_title: row.chapter_title,
    topic: row.topic,
    concept: row.concept,
    similarity: row.similarity,
    media_url: row.media_url,
    content_type: row.content_type,
  }));

  return NextResponse.json({
    success: true,
    data: {
      query,
      grade,
      subject,
      content_type: contentType,
      results,
      total_results: results.length,
      has_embedding: embedding !== null,
    },
  });
}

/**
 * action=quiz-pool — Returns quiz-ready questions from RAG Q&A,
 * with fallback to question_bank.
 */
async function handleQuizPool(
  grade: string,
  subject: string,
  chapterNumber: number,
  count: number,
  studentId: string | null
) {
  const questions: QuizQuestion[] = [];

  // 1. Fetch Q&A chunks from RAG
  const { data: qaData, error: qaError } = await supabaseAdmin.rpc(
    'get_chapter_qa_from_rag',
    {
      p_grade: grade,
      p_subject: subject,
      p_chapter_number: chapterNumber,
    }
  );

  if (qaError) {
    logger.warn('get_chapter_qa_from_rag failed in quiz-pool', {
      error: qaError.message,
      grade,
      subject,
      chapter: chapterNumber,
    });
  }

  // Convert RAG Q&A to quiz-ready format (only MCQ-like questions with options)
  if (qaData && Array.isArray(qaData)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of qaData as any[]) {
      if (questions.length >= count) break;

      // RAG Q&A are mostly short-answer/long-answer; include them as study questions
      questions.push({
        id: row.chunk_id,
        question_text: row.question_text ?? row.chunk_text,
        question_hi: null,
        options: [],
        correct_answer_index: -1,
        explanation: row.answer_text,
        explanation_hi: null,
        difficulty: row.marks_expected ? Math.min(row.marks_expected, 3) : 2,
        bloom_level: row.bloom_level ?? 'understand',
        source: 'rag',
      });
    }
  }

  // 2. If not enough, supplement from question_bank
  if (questions.length < count) {
    const remaining = count - questions.length;

    // Build query for question_bank — grade is TEXT per P5
    let qbQuery = supabaseAdmin
      .from('question_bank')
      .select(
        'id, question_text, question_hi, options, correct_answer_index, explanation, explanation_hi, difficulty, bloom_level'
      )
      .eq('grade', grade)
      .eq('is_active', true)
      .limit(remaining);

    // Filter by subject (question_bank uses lowercase subject codes)
    qbQuery = qbQuery.eq('subject', subject);

    // Filter by chapter if available
    qbQuery = qbQuery.eq('chapter_number', chapterNumber);

    // Apply adaptive filtering if student_id is available
    if (studentId) {
      // Fetch student's recent performance to adjust difficulty
      const { data: recentQuizzes } = await supabaseAdmin
        .from('quiz_sessions')
        .select('score_percent')
        .eq('student_id', studentId)
        .order('completed_at', { ascending: false })
        .limit(5);

      if (recentQuizzes && recentQuizzes.length > 0) {
        const avgScore =
          recentQuizzes.reduce(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (sum: number, q: any) => sum + (q.score_percent ?? 0),
            0
          ) / recentQuizzes.length;

        // Adjust difficulty: low scores -> easier, high scores -> harder
        if (avgScore < 40) {
          qbQuery = qbQuery.eq('difficulty', 1);
        } else if (avgScore > 80) {
          qbQuery = qbQuery.eq('difficulty', 3);
        }
        // else: no difficulty filter (mix of all)
      }
    }

    const { data: qbData, error: qbError } = await qbQuery;

    if (qbError) {
      logger.warn('question_bank query failed in quiz-pool', {
        error: qbError.message,
        grade,
        subject,
        chapter: chapterNumber,
      });
    }

    if (qbData && Array.isArray(qbData)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of qbData as any[]) {
        if (questions.length >= count) break;
        questions.push({
          id: row.id,
          question_text: row.question_text,
          question_hi: row.question_hi ?? null,
          options: row.options ?? [],
          correct_answer_index: row.correct_answer_index ?? 0,
          explanation: row.explanation ?? null,
          explanation_hi: row.explanation_hi ?? null,
          difficulty: row.difficulty ?? 2,
          bloom_level: row.bloom_level ?? 'remember',
          source: 'question_bank',
        });
      }
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      grade,
      subject,
      chapter_number: chapterNumber,
      questions,
      total_questions: questions.length,
      sources: {
        rag: questions.filter((q) => q.source === 'rag').length,
        question_bank: questions.filter((q) => q.source === 'question_bank').length,
      },
    },
  });
}

// ─── Route Handler ───────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const gradeParam = url.searchParams.get('grade');
    const subject = url.searchParams.get('subject');
    const chapterParam = url.searchParams.get('chapter');
    const query = url.searchParams.get('query');
    const contentType = url.searchParams.get('content_type');
    const countParam = url.searchParams.get('count');

    // Validate action
    if (!action || !VALID_ACTIONS.includes(action)) {
      return errorResponse(
        `Invalid or missing action. Must be one of: ${VALID_ACTIONS.join(', ')}`,
        400
      );
    }

    // Validate grade (required for all actions)
    const grade = validateGrade(gradeParam);
    if (!grade) {
      return errorResponse(
        'Invalid or missing grade. Must be 6-12.',
        400
      );
    }

    // Validate subject (required for all actions)
    if (!subject || subject.trim().length === 0) {
      return errorResponse('Missing required parameter: subject', 400);
    }

    // ── action=chapter ──
    if (action === 'chapter') {
      // SECURITY (C5): auth gate — content.read required. Prior to C5 this
      // branch was publicly readable; protected curriculum content and
      // cached AI output must not leak to anonymous callers.
      const auth = await authorizeRequest(request, 'content.read');
      if (!auth.authorized) return auth.errorResponse!;

      const chapterNumber = validateChapterNumber(chapterParam);
      if (!chapterNumber) {
        return errorResponse(
          'Invalid or missing chapter. Must be a positive integer.',
          400
        );
      }

      // Subject governance — applied when the caller is a student.
      if (auth.studentId) {
        const v = await validateSubjectWrite(auth.studentId, subject.trim(), {
          supabase: supabaseAdmin,
        });
        if (!v.ok) {
          return NextResponse.json(
            {
              error: v.error.code,
              subject: v.error.subject,
              reason: v.error.reason,
              allowed: v.error.allowed,
            },
            { status: 422 },
          );
        }
      }

      return handleChapter(grade, subject.trim(), chapterNumber);
    }

    // ── action=search ──
    if (action === 'search') {
      // SECURITY (C5): auth gate — content.read required.
      const auth = await authorizeRequest(request, 'content.read');
      if (!auth.authorized) return auth.errorResponse!;

      if (!query || query.trim().length === 0) {
        return errorResponse('Missing required parameter: query', 400);
      }
      // Validate content_type if provided
      if (contentType && !['content', 'diagram', 'qa'].includes(contentType)) {
        return errorResponse(
          'Invalid content_type. Must be one of: content, diagram, qa',
          400
        );
      }

      let studentPlan = 'free';
      if (auth.studentId) {
        const v = await validateSubjectWrite(auth.studentId, subject.trim(), {
          supabase: supabaseAdmin,
        });
        if (!v.ok) {
          return NextResponse.json(
            {
              error: v.error.code,
              subject: v.error.subject,
              reason: v.error.reason,
              allowed: v.error.allowed,
            },
            { status: 422 },
          );
        }

        // Best-effort plan lookup for per-plan timeout. Non-fatal: on error we
        // fall through with the 'free' default which picks the tightest
        // timeout — conservative for the student.
        try {
          const { data: studentRow } = await supabaseAdmin
            .from('students')
            .select('subscription_plan')
            .eq('id', auth.studentId)
            .single();
          if (studentRow?.subscription_plan) {
            const raw = String(studentRow.subscription_plan);
            studentPlan = raw
              .replace(/_(monthly|yearly)$/, '')
              .replace(/^basic$/, 'starter')
              .replace(/^premium$/, 'pro')
              .replace(/^ultimate$/, 'unlimited');
          }
        } catch { /* use default */ }
      }

      return handleSearch(
        grade,
        subject.trim(),
        query.trim(),
        contentType,
        auth.userId ?? null,
        studentPlan,
      );
    }

    // ── action=quiz-pool ──
    if (action === 'quiz-pool') {
      // Auth required for quiz-pool (student_id needed for adaptive filtering)
      const auth = await authorizeRequest(request, 'quiz.attempt');
      if (!auth.authorized) return auth.errorResponse!;

      const chapterNumber = validateChapterNumber(chapterParam);
      if (!chapterNumber) {
        return errorResponse(
          'Invalid or missing chapter. Must be a positive integer.',
          400
        );
      }

      const count = countParam ? parseInt(countParam, 10) : 10;
      if (!Number.isInteger(count) || count < 1 || count > 50) {
        return errorResponse('count must be an integer between 1 and 50', 400);
      }

      return handleQuizPool(
        grade,
        subject.trim(),
        chapterNumber,
        count,
        auth.studentId
      );
    }

    return errorResponse('Unknown action', 400);
  } catch (err) {
    logger.error('Concept engine unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return errorResponse('Internal server error', 500);
  }
}
