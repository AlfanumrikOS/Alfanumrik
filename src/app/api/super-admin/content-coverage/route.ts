import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';
import { VALID_GRADES } from '@/lib/identity';

/**
 * GET /api/super-admin/content-coverage
 *
 * Returns aggregated content coverage data for the super-admin dashboard:
 * - Summary: total/active questions, total/covered/uncovered topics, thin coverage count
 * - Breakdown by grade and by subject
 * - Gap list: topics with zero or fewer than 5 active questions
 */

// Helper: fetch from Supabase REST API with admin headers
async function supabaseRest(table: string, params: string = '', method: string = 'GET') {
  return fetch(supabaseAdminUrl(table, params), {
    method,
    headers: supabaseAdminHeaders(method === 'HEAD' ? 'count=exact' : ''),
  });
}

// Safe JSON parse with fallback
async function safeJson<T>(res: Response): Promise<T[]> {
  try {
    const d = await res.json();
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

// Parse count from content-range header (HEAD requests with Prefer: count=exact)
function parseCount(res: Response): number {
  const range = res.headers.get('content-range');
  if (range) {
    const total = range.split('/')[1];
    return parseInt(total) || 0;
  }
  return 0;
}

interface QuestionRow {
  grade: string;
  subject: string;
  chapter_number: number | null;
  chapter_title: string | null;
  is_active: boolean;
}

interface TopicRow {
  id: string;
  grade: string;
  subject_code: string;
  chapter_number: number | null;
  title: string | null;
  is_active: boolean;
}

interface SubjectRow {
  id: string;
  code: string;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    // Fire all queries in parallel
    const [questionsRes, topicsRes, subjectsRes] = await Promise.all([
      // All questions with grade, subject, chapter_number, is_active
      supabaseRest(
        'question_bank',
        'select=grade,subject,chapter_number,chapter_title,is_active&limit=50000'
      ),
      // All curriculum topics (non-deleted) with grade, subject_id, chapter_number
      // We use subjects(code) to get the subject code via foreign key embed
      supabaseRest(
        'curriculum_topics',
        'select=id,grade,subject_id,chapter_number,title,is_active&deleted_at=is.null&limit=50000'
      ),
      // All subjects for mapping subject_id -> code
      supabaseRest('subjects', 'select=id,code&limit=200'),
    ]);

    const [questions, topics, subjects] = await Promise.all([
      safeJson<QuestionRow>(questionsRes),
      safeJson<{ id: string; grade: string; subject_id: string; chapter_number: number | null; title: string | null; is_active: boolean }>(topicsRes),
      safeJson<SubjectRow>(subjectsRes),
    ]);

    // Build subject_id -> code mapping
    const subjectIdToCode: Record<string, string> = {};
    for (const s of subjects) {
      subjectIdToCode[s.id] = s.code;
    }

    // Normalize topics with subject code
    const normalizedTopics: TopicRow[] = topics.map((t) => ({
      id: t.id,
      grade: t.grade,
      subject_code: subjectIdToCode[t.subject_id] || 'unknown',
      chapter_number: t.chapter_number,
      title: t.title,
      is_active: t.is_active !== false,
    }));

    // --- Aggregate questions by grade+subject+chapter_number ---
    type ComboKey = string; // "grade::subject::chapter_number"
    const makeKey = (grade: string, subject: string, chapter: number | null): ComboKey =>
      `${grade}::${subject}::${chapter ?? 0}`;

    const questionCombos: Record<ComboKey, { total: number; active: number }> = {};
    let totalQuestions = 0;
    let activeQuestions = 0;

    for (const q of questions) {
      totalQuestions++;
      const isActive = q.is_active !== false;
      if (isActive) activeQuestions++;

      const key = makeKey(q.grade, q.subject, q.chapter_number);
      if (!questionCombos[key]) {
        questionCombos[key] = { total: 0, active: 0 };
      }
      questionCombos[key].total++;
      if (isActive) questionCombos[key].active++;
    }

    // --- Questions per grade ---
    const gradeQuestions: Record<string, { total: number; active: number }> = {};
    for (const q of questions) {
      if (!gradeQuestions[q.grade]) gradeQuestions[q.grade] = { total: 0, active: 0 };
      gradeQuestions[q.grade].total++;
      if (q.is_active !== false) gradeQuestions[q.grade].active++;
    }

    // --- Questions per subject ---
    const subjectQuestions: Record<string, { total: number; active: number }> = {};
    for (const q of questions) {
      if (!subjectQuestions[q.subject]) subjectQuestions[q.subject] = { total: 0, active: 0 };
      subjectQuestions[q.subject].total++;
      if (q.is_active !== false) subjectQuestions[q.subject].active++;
    }

    // --- Topics per grade ---
    const gradeTopics: Record<string, { total: number; covered: number }> = {};
    // --- Topics per subject ---
    const subjectTopics: Record<string, { total: number; covered: number }> = {};

    // Track coverage per topic
    let totalTopics = 0;
    let coveredTopics = 0;
    let thinCoverage = 0;

    interface GapEntry {
      grade: string;
      subject: string;
      chapterNumber: number | null;
      title: string | null;
      questionCount: number;
      status: 'uncovered' | 'thin';
    }
    const gaps: GapEntry[] = [];

    for (const topic of normalizedTopics) {
      if (!topic.is_active) continue;

      totalTopics++;
      const key = makeKey(topic.grade, topic.subject_code, topic.chapter_number);
      const combo = questionCombos[key];
      const activeCount = combo?.active ?? 0;

      // Grade topic counts
      if (!gradeTopics[topic.grade]) gradeTopics[topic.grade] = { total: 0, covered: 0 };
      gradeTopics[topic.grade].total++;

      // Subject topic counts
      if (!subjectTopics[topic.subject_code]) subjectTopics[topic.subject_code] = { total: 0, covered: 0 };
      subjectTopics[topic.subject_code].total++;

      if (activeCount === 0) {
        gaps.push({
          grade: topic.grade,
          subject: topic.subject_code,
          chapterNumber: topic.chapter_number,
          title: topic.title,
          questionCount: 0,
          status: 'uncovered',
        });
      } else {
        coveredTopics++;
        gradeTopics[topic.grade].covered++;
        subjectTopics[topic.subject_code].covered++;

        if (activeCount < 5) {
          thinCoverage++;
          gaps.push({
            grade: topic.grade,
            subject: topic.subject_code,
            chapterNumber: topic.chapter_number,
            title: topic.title,
            questionCount: activeCount,
            status: 'thin',
          });
        }
      }
    }

    const uncoveredTopics = totalTopics - coveredTopics;
    const coveragePercent = totalTopics > 0
      ? Math.round((coveredTopics / totalTopics) * 1000) / 10
      : 0;

    // --- Build grade breakdown (grades "6" through "12") ---
    const GRADES = VALID_GRADES;
    const byGrade = GRADES
      .filter((g) => gradeQuestions[g] || gradeTopics[g])
      .map((g) => ({
        grade: g,
        questions: gradeQuestions[g]?.total ?? 0,
        active: gradeQuestions[g]?.active ?? 0,
        topics: gradeTopics[g]?.total ?? 0,
        covered: gradeTopics[g]?.covered ?? 0,
      }));

    // --- Build subject breakdown ---
    const allSubjects = new Set([
      ...Object.keys(subjectQuestions),
      ...Object.keys(subjectTopics),
    ]);
    const bySubject = Array.from(allSubjects)
      .sort()
      .map((s) => ({
        subject: s,
        questions: subjectQuestions[s]?.total ?? 0,
        active: subjectQuestions[s]?.active ?? 0,
        topics: subjectTopics[s]?.total ?? 0,
        covered: subjectTopics[s]?.covered ?? 0,
      }));

    // Sort gaps: uncovered first, then thin, then by grade/subject/chapter
    gaps.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'uncovered' ? -1 : 1;
      const gradeComp = a.grade.localeCompare(b.grade, undefined, { numeric: true });
      if (gradeComp !== 0) return gradeComp;
      const subjComp = a.subject.localeCompare(b.subject);
      if (subjComp !== 0) return subjComp;
      return (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0);
    });

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalQuestions,
          activeQuestions,
          totalTopics,
          coveredTopics,
          uncoveredTopics,
          thinCoverage,
          coveragePercent,
        },
        byGrade,
        bySubject,
        gaps,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
