/**
 * GET /api/v2/learn/curriculum — plan-gated curriculum tree (mobile Learn screen).
 *
 * Thin read. Reuses the SAME sources the web study path uses:
 *   - get_available_subjects (v1) — authoritative for WHICH subjects appear and
 *     whether each is locked (grade × stream × plan gating), keyed by the auth
 *     user id (same call as /api/student/subjects).
 *   - subjects (id ↔ code lookup) + curriculum_topics (chapters → topics),
 *     the same tables the existing getNextTopics / getChapterTopics helpers read.
 *
 * Builds the tree: subject → chapters (grouped by chapter_number) → topics.
 * No new query logic — just a server-side join + grouping.
 *
 * P5: grade is a string. P13: no PII logged.
 *
 * Auth: study_plan.view (student-scoped read; same as /api/student/daily-plan).
 */
import { NextRequest } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { v2Success, v2Error } from '@alfanumrik/lib/api/v2/envelope';

interface AvailableSubjectRow {
  code: string;
  name: string;
  name_hi: string | null;
  is_locked: boolean;
}

interface TopicRow {
  id: string;
  subject_id: string;
  chapter_number: number | null;
  title: string | null;
  title_hi: string | null;
  parent_topic_id: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeRequest(request, 'study_plan.view', {
      requireStudentId: true,
    });
    if (!auth.authorized || !auth.userId) return auth.errorResponse!;

    const url = new URL(request.url);
    const subjectFilter = url.searchParams.get('subject');

    const admin = getSupabaseAdmin();

    // Resolve the student's grade (P5 string) for topic scoping.
    const { data: student } = await admin
      .from('students')
      .select('grade')
      .eq('id', auth.studentId)
      .maybeSingle();
    if (!student?.grade) {
      return v2Error('No student profile found for this account', 404, 'NO_STUDENT_PROFILE');
    }
    const grade = String(student.grade);

    // 1. Plan-gated subjects (same RPC as /api/student/subjects), keyed by auth user.
    const { data: subjData, error: subjErr } = await admin.rpc('get_available_subjects', {
      p_student_id: auth.userId,
    });
    if (subjErr) {
      logger.error('v2_learn_curriculum_subjects_rpc_failed', { error: subjErr.message });
      return v2Error('Failed to load subjects', 500, 'INTERNAL_ERROR');
    }
    let subjectRows = (subjData ?? []) as AvailableSubjectRow[];
    if (subjectFilter) {
      subjectRows = subjectRows.filter((s) => s.code === subjectFilter);
    }
    if (subjectRows.length === 0) {
      return v2Success({ schemaVersion: 1 as const, grade, subjects: [] });
    }

    // 2. Resolve subject code → subject id (one query).
    const codes = subjectRows.map((s) => s.code);
    const { data: subjectMeta } = await admin
      .from('subjects')
      .select('id, code')
      .in('code', codes);
    const idByCode = new Map<string, string>();
    const codeById = new Map<string, string>();
    for (const m of (subjectMeta ?? []) as Array<{ id: string; code: string }>) {
      idByCode.set(m.code, m.id);
      codeById.set(m.id, m.code);
    }

    // 3. Fetch curriculum topics for these subjects + grade (one query).
    const subjectIds = [...idByCode.values()];
    let topics: TopicRow[] = [];
    if (subjectIds.length > 0) {
      const { data: topicData } = await admin
        .from('curriculum_topics')
        .select('id, subject_id, chapter_number, title, title_hi, parent_topic_id')
        .in('subject_id', subjectIds)
        .eq('grade', grade)
        .eq('is_active', true)
        .order('chapter_number', { ascending: true })
        .order('display_order', { ascending: true });
      topics = (topicData ?? []) as TopicRow[];
    }

    // 4. Group topics by subject → chapter_number.
    //    chapter "title" uses the first top-level (parent_topic_id null) topic's
    //    title for that chapter_number when present, else the first topic's title.
    const subjects = subjectRows.map((s) => {
      const sid = idByCode.get(s.code);
      const subjectTopics = sid ? topics.filter((t) => t.subject_id === sid) : [];

      const byChapter = new Map<number, TopicRow[]>();
      for (const t of subjectTopics) {
        const ch = t.chapter_number ?? 0;
        if (!byChapter.has(ch)) byChapter.set(ch, []);
        byChapter.get(ch)!.push(t);
      }

      const chapters = [...byChapter.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([chapterNumber, chapterTopics]) => {
          const header =
            chapterTopics.find((t) => t.parent_topic_id == null) ?? chapterTopics[0];
          return {
            chapter_number: chapterNumber === 0 ? null : chapterNumber,
            title: header?.title ?? null,
            title_hi: header?.title_hi ?? null,
            topics: chapterTopics.map((t) => ({
              id: t.id,
              title: t.title ?? null,
              title_hi: t.title_hi ?? null,
            })),
          };
        });

      return {
        code: s.code,
        name: s.name,
        name_hi: s.name_hi ?? null,
        is_locked: !!s.is_locked,
        chapters,
      };
    });

    return v2Success({ schemaVersion: 1 as const, grade, subjects });
  } catch (err) {
    logger.error('v2_learn_curriculum_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v2/learn/curriculum',
    });
    return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
  }
}
