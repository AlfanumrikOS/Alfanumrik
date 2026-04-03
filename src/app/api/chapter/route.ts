import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

// ─── Constants ──────────────────────────────────────────────────

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const VALID_ACTIONS = ['content', 'qa', 'overview', 'media'];

// ─── Types ──────────────────────────────────────────────────────

interface ChapterContentChunk {
  id: string;
  grade: string;
  subject: string;
  chapter_title: string;
  chunk_text: string;
  chunk_index: number;
  topic: string | null;
  concept: string | null;
  page_number: number | null;
  chapter_number: number;
}

interface ChapterQuestion {
  id: string;
  grade: string;
  subject: string;
  chapter_number: number;
  question_text: string;
  options: string[];
  correct_answer_index: number;
  explanation: string;
  difficulty: string;
  bloom_level: string;
  question_type_v2: string | null;
  board_relevance: string | null;
  source_type: string | null;
  answer_text: string | null;
  answer_text_hi: string | null;
  answer_methodology: string | null;
  marks_expected: number | null;
}

interface ContentMedia {
  id: string;
  grade: string;
  subject: string;
  chapter_number: number;
  media_type: string;
  url: string;
  caption: string | null;
  alt_text: string | null;
  display_order: number | null;
  is_active: boolean;
}

// ─── Bilingual Error Messages ───────────────────────────────────

const errors = {
  missingParams: {
    en: 'Missing required parameters: grade, subject, and chapter.',
    hi: 'Grade, subject aur chapter dena zaroori hai.',
  },
  invalidGrade: {
    en: 'Grade must be between 6 and 12.',
    hi: 'Grade 6 se 12 ke beech hona chahiye.',
  },
  invalidChapter: {
    en: 'Chapter must be a positive integer.',
    hi: 'Chapter ek positive number hona chahiye.',
  },
  invalidAction: {
    en: 'Invalid action. Valid actions: content, qa, overview, media.',
    hi: 'Action galat hai. Valid: content, qa, overview, media.',
  },
  invalidSubject: {
    en: 'Subject must be a non-empty string.',
    hi: 'Subject khali nahi ho sakta.',
  },
  serverError: {
    en: 'An internal error occurred. Please try again.',
    hi: 'Server mein error aaya. Dobara try karein.',
  },
} as const;

function errorResponse(
  err: (typeof errors)[keyof typeof errors],
  status: number,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    { success: false, error: err.en, error_hi: err.hi, ...extra },
    { status }
  );
}

// ─── Validation ─────────────────────────────────────────────────

function validateParams(url: URL): {
  valid: true;
  action: string;
  grade: string;
  subject: string;
  chapter: number;
} | {
  valid: false;
  response: NextResponse;
} {
  const action = url.searchParams.get('action');
  const grade = url.searchParams.get('grade');
  const subject = url.searchParams.get('subject');
  const chapterParam = url.searchParams.get('chapter');

  // Validate action
  if (!action || !VALID_ACTIONS.includes(action)) {
    return {
      valid: false,
      response: errorResponse(errors.invalidAction, 400, {
        valid_actions: VALID_ACTIONS,
      }),
    };
  }

  // Validate required params
  if (!grade || !subject || !chapterParam) {
    return {
      valid: false,
      response: errorResponse(errors.missingParams, 400),
    };
  }

  // Validate grade (must be string "6"-"12")
  if (!VALID_GRADES.includes(grade)) {
    return {
      valid: false,
      response: errorResponse(errors.invalidGrade, 400),
    };
  }

  // Validate subject
  if (!subject.trim()) {
    return {
      valid: false,
      response: errorResponse(errors.invalidSubject, 400),
    };
  }

  // Validate chapter number
  const chapter = parseInt(chapterParam, 10);
  if (isNaN(chapter) || chapter < 1) {
    return {
      valid: false,
      response: errorResponse(errors.invalidChapter, 400),
    };
  }

  return { valid: true, action, grade, subject, chapter };
}

// ─── Action Handlers ────────────────────────────────────────────

/**
 * Fetch RAG content chunks for a chapter via get_chapter_rag_content RPC.
 * RAG grade format is "Grade 7", so we convert from "7".
 */
async function handleContent(
  grade: string,
  subject: string,
  chapter: number
): Promise<NextResponse> {
  // RAG table uses "Grade 7" format; convert "7" -> "Grade 7"
  const ragGrade = `Grade ${grade}`;

  const { data, error } = await supabaseAdmin.rpc('get_chapter_rag_content', {
    p_grade: ragGrade,
    p_subject: subject,
    p_chapter_number: chapter,
  });

  if (error) {
    logger.error('chapter_content_rpc_failed', {
      error: new Error(error.message),
      route: '/api/chapter',
      grade,
      subject,
      chapter,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load chapter content.',
        error_hi: 'Chapter content load nahi ho paya.',
      },
      { status: 500 }
    );
  }

  const chunks = (data ?? []) as ChapterContentChunk[];
  const chapterTitle = chunks.length > 0 ? chunks[0].chapter_title : '';

  return NextResponse.json({
    success: true,
    data: {
      chunks,
      chapter_title: chapterTitle,
      total_chunks: chunks.length,
    },
  });
}

/**
 * Fetch Q&A questions for a chapter via get_chapter_qa RPC.
 * Question bank uses grade "7" and subject "math" format.
 */
async function handleQA(
  grade: string,
  subject: string,
  chapter: number,
  sourceType: string | null
): Promise<NextResponse> {
  const params: Record<string, unknown> = {
    p_grade: grade,
    p_subject: subject,
    p_chapter_number: chapter,
  };
  if (sourceType) {
    params.p_source_type = sourceType;
  }

  const { data, error } = await supabaseAdmin.rpc('get_chapter_qa', params);

  if (error) {
    logger.error('chapter_qa_rpc_failed', {
      error: new Error(error.message),
      route: '/api/chapter',
      grade,
      subject,
      chapter,
      sourceType,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load chapter questions.',
        error_hi: 'Chapter questions load nahi ho paye.',
      },
      { status: 500 }
    );
  }

  const questions = (data ?? []) as ChapterQuestion[];

  return NextResponse.json({
    success: true,
    data: {
      questions,
      total: questions.length,
    },
  });
}

/**
 * Fetch content_media for a chapter (diagrams, images).
 */
async function handleMedia(
  grade: string,
  subject: string,
  chapter: number
): Promise<NextResponse> {
  const { data, error } = await supabaseAdmin
    .from('content_media')
    .select('*')
    .eq('grade', grade)
    .eq('subject', subject)
    .eq('chapter_number', chapter)
    .eq('is_active', true);

  if (error) {
    logger.error('chapter_media_query_failed', {
      error: new Error(error.message),
      route: '/api/chapter',
      grade,
      subject,
      chapter,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load chapter media.',
        error_hi: 'Chapter media load nahi ho paya.',
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      media: (data ?? []) as ContentMedia[],
    },
  });
}

/**
 * Combined overview: content chunks + questions + media in parallel.
 * Used for initial chapter page load.
 */
async function handleOverview(
  grade: string,
  subject: string,
  chapter: number
): Promise<NextResponse> {
  const ragGrade = `Grade ${grade}`;

  const [contentResult, qaResult, mediaResult] = await Promise.all([
    supabaseAdmin.rpc('get_chapter_rag_content', {
      p_grade: ragGrade,
      p_subject: subject,
      p_chapter_number: chapter,
    }),
    supabaseAdmin.rpc('get_chapter_qa', {
      p_grade: grade,
      p_subject: subject,
      p_chapter_number: chapter,
    }),
    supabaseAdmin
      .from('content_media')
      .select('*')
      .eq('grade', grade)
      .eq('subject', subject)
      .eq('chapter_number', chapter)
      .eq('is_active', true),
  ]);

  // Log errors but don't fail the whole request if one part fails
  if (contentResult.error) {
    logger.warn('chapter_overview_content_failed', {
      error: new Error(contentResult.error.message),
      route: '/api/chapter',
      grade,
      subject,
      chapter,
    });
  }
  if (qaResult.error) {
    logger.warn('chapter_overview_qa_failed', {
      error: new Error(qaResult.error.message),
      route: '/api/chapter',
      grade,
      subject,
      chapter,
    });
  }
  if (mediaResult.error) {
    logger.warn('chapter_overview_media_failed', {
      error: new Error(mediaResult.error.message),
      route: '/api/chapter',
      grade,
      subject,
      chapter,
    });
  }

  const chunks = (contentResult.data ?? []) as ChapterContentChunk[];
  const questions = (qaResult.data ?? []) as ChapterQuestion[];
  const media = (mediaResult.data ?? []) as ContentMedia[];
  const chapterTitle = chunks.length > 0 ? chunks[0].chapter_title : '';

  return NextResponse.json({
    success: true,
    data: {
      chunks,
      questions,
      media,
      chapter_title: chapterTitle,
    },
  });
}

// ─── GET Handler ────────────────────────────────────────────────

/**
 * GET /api/chapter?action=content|qa|overview|media&grade=10&subject=science&chapter=1
 *
 * Public curriculum data endpoint — no auth required.
 * Serves chapter content (RAG chunks), Q&A questions, media, or combined overview.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);

    // 1. Validate all parameters
    const validation = validateParams(url);
    if (!validation.valid) return validation.response;

    const { action, grade, subject, chapter } = validation;

    // 2. Dispatch by action
    switch (action) {
      case 'content':
        return await handleContent(grade, subject, chapter);

      case 'qa': {
        const sourceType = url.searchParams.get('source_type');
        return await handleQA(grade, subject, chapter, sourceType);
      }

      case 'overview':
        return await handleOverview(grade, subject, chapter);

      case 'media':
        return await handleMedia(grade, subject, chapter);

      default:
        return errorResponse(errors.invalidAction, 400);
    }
  } catch (err) {
    logger.error('chapter_api_get_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/chapter',
    });
    return errorResponse(errors.serverError, 500);
  }
}
