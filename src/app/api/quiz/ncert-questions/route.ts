import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

// ─── Constants ──────────────────────────────────────────────────

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];

const VALID_QUESTION_TYPES = [
  'mcq', 'short_answer', 'long_answer', 'numerical',
  'intext', 'exercise', 'example', 'hots',
  // Aliases
  'medium_answer', 'sa', 'la', 'ma',
];

/** Map quiz subject codes to rag_content_chunks.subject values */
const SUBJECT_MAP: Record<string, string> = {
  math: 'Mathematics',
  mathematics: 'Mathematics',
  science: 'Science',
  physics: 'Physics',
  chemistry: 'Chemistry',
  biology: 'Biology',
  english: 'English',
  hindi: 'Hindi',
  social_studies: 'Social Studies',
  sst: 'Social Studies',
  computer_science: 'Computer Science',
  coding: 'Computer Science',
  economics: 'Economics',
  accountancy: 'Accountancy',
  business_studies: 'Business Studies',
  political_science: 'Political Science',
  history_sr: 'History',
  geography: 'Geography',
};

/** Normalise a subject code to the rag_content_chunks format */
function resolveSubject(code: string): string {
  const lower = code.toLowerCase().trim();
  if (SUBJECT_MAP[lower]) return SUBJECT_MAP[lower];
  // Fallback: capitalise words
  return lower
    .split(/[_\s]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Convert quiz grade ("9") to rag_content_chunks format ("Grade 9") */
function resolveGrade(grade: string): string {
  const num = grade.replace(/^Grade\s*/i, '').trim();
  return `Grade ${num}`;
}

/** Normalise type aliases to canonical rag_content_chunks question_type values */
function resolveQuestionType(t: string): string {
  const map: Record<string, string> = {
    sa: 'short_answer',
    la: 'long_answer',
    ma: 'short_answer', // medium_answer maps to short_answer with higher marks
    medium_answer: 'short_answer',
  };
  return map[t] ?? t;
}

/** CBSE type/label metadata */
const CBSE_TYPE_MAP: Record<string, { label: string; timeSeconds: number; wordLimit: number }> = {
  mcq:           { label: 'MCQ',           timeSeconds: 60,  wordLimit: 0   },
  short_answer:  { label: 'Short Answer',  timeSeconds: 120, wordLimit: 40  },
  medium_answer: { label: 'Medium Answer', timeSeconds: 240, wordLimit: 100 },
  long_answer:   { label: 'Long Answer',   timeSeconds: 480, wordLimit: 200 },
  hots:          { label: 'HOTS',          timeSeconds: 360, wordLimit: 150 },
  numerical:     { label: 'Numerical',     timeSeconds: 180, wordLimit: 60  },
  intext:        { label: 'Intext',        timeSeconds: 150, wordLimit: 80  },
  exercise:      { label: 'Exercise',      timeSeconds: 180, wordLimit: 100 },
  example:       { label: 'Example',       timeSeconds: 150, wordLimit: 80  },
};

// ─── GET Handler ────────────────────────────────────────────────

/**
 * GET /api/quiz/ncert-questions?grade=9&subject=science&types=short_answer,long_answer&count=10&chapter=3
 *
 * Fetches NCERT questions directly from rag_content_chunks.
 * Handles grade format ("9" -> "Grade 9") and subject code mapping.
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Auth
    const auth = await authorizeRequest(request, 'quiz.attempt', {
      requireStudentId: true,
    });
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      );
    }

    const url = new URL(request.url);

    // 2. Parse parameters
    const gradeParam = url.searchParams.get('grade');
    const subjectParam = url.searchParams.get('subject');
    const typesParam = url.searchParams.get('types') || 'short_answer,long_answer';
    const countParam = url.searchParams.get('count') || '10';
    const chapterParam = url.searchParams.get('chapter');

    if (!gradeParam || !subjectParam) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: grade and subject.' },
        { status: 400 }
      );
    }

    // Validate grade
    const gradeNum = gradeParam.replace(/^Grade\s*/i, '').trim();
    if (!VALID_GRADES.includes(gradeNum)) {
      return NextResponse.json(
        { success: false, error: 'Grade must be between 6 and 12.' },
        { status: 400 }
      );
    }

    const count = Math.min(Math.max(parseInt(countParam, 10) || 10, 1), 30);
    const chapter = chapterParam ? parseInt(chapterParam, 10) : null;

    // Parse and validate question types
    const rawTypes = typesParam.split(',').map(t => t.trim()).filter(Boolean);
    const resolvedTypes = [...new Set(rawTypes.map(resolveQuestionType))];

    // Convert formats for DB query
    const dbGrade = resolveGrade(gradeNum);
    const dbSubject = resolveSubject(subjectParam);

    // 3. Build query
    let query = supabaseAdmin
      .from('rag_content_chunks')
      .select('id, question_text, answer_text, question_type, marks_expected, bloom_level, chapter_title, chapter_number, content_type, subject, grade')
      .eq('is_active', true)
      .eq('grade', dbGrade)
      .not('question_text', 'is', null)
      .not('answer_text', 'is', null)
      .neq('question_text', '')
      .neq('answer_text', '');

    // Subject matching: try exact match first, then ILIKE fallback
    query = query.eq('subject', dbSubject);

    // Question type filter
    if (resolvedTypes.length === 1) {
      query = query.eq('question_type', resolvedTypes[0]);
    } else if (resolvedTypes.length > 1) {
      query = query.in('question_type', resolvedTypes);
    }

    // Chapter filter (optional)
    if (chapter && chapter > 0) {
      query = query.eq('chapter_number', chapter);
    }

    // Content type filter: only 'qa' rows have question_text populated
    // but also check 'content' rows that got question_text added later
    // Don't filter by content_type -- just filter by question_text presence (already done above)

    // Fetch extra for dedup, then limit
    const fetchCount = Math.min(count * 3, 60);

    const { data: rows, error } = await query.limit(fetchCount);

    if (error) {
      logger.error('ncert_questions_query_failed', {
        error: new Error(error.message),
        route: '/api/quiz/ncert-questions',
        grade: gradeNum,
        subject: subjectParam,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch NCERT questions.' },
        { status: 500 }
      );
    }

    // If exact subject match returns nothing, try ILIKE fallback
    let resultRows = rows ?? [];
    if (resultRows.length === 0) {
      const { data: fallbackRows, error: fallbackError } = await supabaseAdmin
        .from('rag_content_chunks')
        .select('id, question_text, answer_text, question_type, marks_expected, bloom_level, chapter_title, chapter_number, content_type, subject, grade')
        .eq('is_active', true)
        .eq('grade', dbGrade)
        .ilike('subject', `%${subjectParam.replace(/_/g, ' ')}%`)
        .not('question_text', 'is', null)
        .not('answer_text', 'is', null)
        .neq('question_text', '')
        .neq('answer_text', '')
        .in('question_type', resolvedTypes.length > 0 ? resolvedTypes : ['short_answer', 'long_answer', 'intext', 'exercise', 'example', 'hots', 'numerical'])
        .limit(fetchCount);

      if (!fallbackError && fallbackRows && fallbackRows.length > 0) {
        resultRows = fallbackRows;
      }
    }

    // 4. Deduplicate by question_text prefix
    const seen = new Set<string>();
    const deduped = resultRows.filter((q: Record<string, unknown>) => {
      const key = String(q.question_text ?? '').slice(0, 80).toLowerCase().trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 5. Shuffle and take requested count
    const shuffled = deduped.sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, count);

    // 6. Map to Question interface expected by quiz/page.tsx
    const questions = selected.map((chunk: Record<string, unknown>) => {
      const qt = String(chunk.question_type ?? 'short_answer');
      const marks = Number(chunk.marks_expected ?? 2);

      // Determine CBSE type based on question_type and marks
      let cbseType = qt;
      if (qt === 'intext' || (qt === 'short_answer' && marks <= 2)) cbseType = 'short_answer';
      else if (qt === 'short_answer' && marks >= 3) cbseType = 'medium_answer';
      else if (qt === 'example') cbseType = 'short_answer';
      else if (qt === 'exercise') cbseType = marks >= 5 ? 'long_answer' : marks >= 3 ? 'medium_answer' : 'short_answer';

      const meta = CBSE_TYPE_MAP[cbseType] ?? CBSE_TYPE_MAP.short_answer;

      return {
        id: chunk.id as string,
        question_text: chunk.question_text as string,
        question_hi: null,
        question_type: cbseType,
        options: [] as string[],
        correct_answer_index: -1,
        explanation: (chunk.answer_text as string) ?? null,
        explanation_hi: null,
        hint: null,
        difficulty: 2,
        bloom_level: (chunk.bloom_level as string) ?? 'understand',
        chapter_number: (chunk.chapter_number as number) ?? 0,
        // Written answer fields
        marks_possible: marks,
        answer_text: (chunk.answer_text as string) ?? null,
        source_table: 'rag_content_chunks',
        question_id: chunk.id as string,
        cbse_type: cbseType,
        cbse_label: meta.label,
        time_estimate: meta.timeSeconds,
        word_limit: meta.wordLimit,
      };
    });

    return NextResponse.json({
      success: true,
      questions,
      total: questions.length,
      grade: gradeNum,
      subject: subjectParam,
      db_grade: dbGrade,
      db_subject: dbSubject,
    });
  } catch (err) {
    logger.error('ncert_questions_api_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/quiz/ncert-questions',
    });
    return NextResponse.json(
      { success: false, error: 'An internal error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
