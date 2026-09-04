// src/app/api/search/route.ts
//
// Gate-2 Phase C — global cross-entity search. GET /api/search?q=&scope=.
//
// SCOPE, deliberately narrower than the plan's original ask: super-admin
// only for now (authorizeRequest 'super_admin.access'), matching this
// engagement's established "one role first, as a template" pattern (see
// Gate-2 B3/D4). Cross-tenant search for teacher/school-admin/parent/student
// each need their OWN tenant-scoping design (a teacher's "students" scope
// must be roster-limited via resolveTeacherRosterScope, a school-admin's
// must be school_id-limited, etc.) -- building all of those correctly in one
// pass, for a feature that spans real cross-tenant student/teacher/school PII,
// is a separate follow-up, not attempted here. Extending this route to
// another role means adding a real tenant-scoped branch, not loosening the
// super_admin gate.
//
// ENTITIES: students, teachers, schools, chapters (curriculum_topics),
// questions (question_bank). "worksheets" (named in the original plan text)
// does not exist as a distinct entity -- verified live: no worksheets table
// exists anywhere in the schema; the teacher worksheets UI is a themed view
// over question_bank, already covered by the "questions" scope.
//
// students/teachers/schools have no search_vector column (baseline schema),
// so this route uses ILIKE '%q%' against `name`, which the new trigram
// indexes (migration 20260905000000) accelerate. chapters/questions DO have
// a pre-existing GIN-indexed search_vector (baseline schema) and use
// .textSearch() (websearch_to_tsquery semantics) instead.
//
// Column allowlists are intentionally narrow (P13/P-01 precedent, matching
// api/super-admin/users/route.ts) -- search results are compact identifiers
// for navigation, not full record dumps.
//
// Service-role client: genuinely required, not convenience. Cross-tenant
// search must see every school's students/teachers/schools; RLS on those
// tables is own-row/own-school scoped and would silently zero-row a
// cross-tenant super-admin query. Same "super-admin-by-design" justification
// as the already-ledgered sibling routes (ai-quality, foxy-report,
// synthesis-health) -- see scripts/admin-client-allowlist.json.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

export const runtime = 'nodejs';

const SCOPES = ['students', 'teachers', 'schools', 'chapters', 'questions', 'all'] as const;
type Scope = (typeof SCOPES)[number];

const QuerySchema = z.object({
  q: z.string().trim().min(2, 'q must be at least 2 characters').max(100, 'q is too long'),
  scope: z.enum(SCOPES).default('all'),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

interface SearchResult {
  type: 'student' | 'teacher' | 'school' | 'chapter' | 'question';
  id: string;
  title: string;
  subtitle?: string | null;
}

async function searchStudents(q: string, limit: number): Promise<SearchResult[]> {
  const { data, error } = await supabaseAdmin
    .from('students')
    .select('id, name, grade, school_id')
    .ilike('name', `%${q}%`)
    .limit(limit);
  if (error) {
    logger.error('global_search_students_failed', { error: new Error(error.message) });
    return [];
  }
  return (data ?? []).map((r) => ({
    type: 'student' as const,
    id: r.id as string,
    title: (r.name as string) ?? '(unnamed)',
    subtitle: r.grade ? `Grade ${r.grade}` : null,
  }));
}

async function searchTeachers(q: string, limit: number): Promise<SearchResult[]> {
  const { data, error } = await supabaseAdmin
    .from('teachers')
    .select('id, name, school_id')
    .ilike('name', `%${q}%`)
    .limit(limit);
  if (error) {
    logger.error('global_search_teachers_failed', { error: new Error(error.message) });
    return [];
  }
  return (data ?? []).map((r) => ({
    type: 'teacher' as const,
    id: r.id as string,
    title: (r.name as string) ?? '(unnamed)',
    subtitle: null,
  }));
}

async function searchSchools(q: string, limit: number): Promise<SearchResult[]> {
  const { data, error } = await supabaseAdmin
    .from('schools')
    .select('id, name, city, state')
    .ilike('name', `%${q}%`)
    .limit(limit);
  if (error) {
    logger.error('global_search_schools_failed', { error: new Error(error.message) });
    return [];
  }
  return (data ?? []).map((r) => ({
    type: 'school' as const,
    id: r.id as string,
    title: (r.name as string) ?? '(unnamed)',
    subtitle: [r.city, r.state].filter(Boolean).join(', ') || null,
  }));
}

async function searchChapters(q: string, limit: number): Promise<SearchResult[]> {
  // Deliberately NOT using the cached getActiveTopicsForSubjects() helper
  // (ADR-007, apps/host/src/lib/curriculum/cached-taxonomy.ts) that
  // alfanumrik/no-inline-taxonomy-reads normally requires: that helper takes
  // a specific (grade, subjectIds[]) pair for a cacheable "browse this grade's
  // syllabus" access pattern, not an arbitrary free-text query across every
  // grade/subject. Routing search through it would mean fetching the entire
  // catalogue and filtering in Node instead of using search_vector's GIN
  // index directly — worse on every axis (latency, DB load, cache-key
  // explosion). This inline read is the correct tool for this access pattern.
  const { data, error } = await supabaseAdmin
    .from('curriculum_topics')
    .select('id, title, grade, chapter_number')
    .textSearch('search_vector', q, { type: 'websearch' })
    .eq('is_active', true)
    .limit(limit);
  if (error) {
    logger.error('global_search_chapters_failed', { error: new Error(error.message) });
    return [];
  }
  return (data ?? []).map((r) => ({
    type: 'chapter' as const,
    id: r.id as string,
    title: (r.title as string) ?? '(untitled)',
    subtitle: r.grade ? `Grade ${r.grade}${r.chapter_number ? ` · Ch. ${r.chapter_number}` : ''}` : null,
  }));
}

async function searchQuestions(q: string, limit: number): Promise<SearchResult[]> {
  const { data, error } = await supabaseAdmin
    .from('question_bank')
    .select('id, question_text, subject, grade')
    .textSearch('search_vector', q, { type: 'websearch' })
    .eq('is_active', true)
    .limit(limit);
  if (error) {
    logger.error('global_search_questions_failed', { error: new Error(error.message) });
    return [];
  }
  return (data ?? []).map((r) => {
    const text = (r.question_text as string) ?? '';
    return {
      type: 'question' as const,
      id: r.id as string,
      title: text.length > 120 ? `${text.slice(0, 120)}…` : text,
      subtitle: [r.subject, r.grade ? `Grade ${r.grade}` : null].filter(Boolean).join(' · ') || null,
    };
  });
}

const SEARCHERS: Record<Exclude<Scope, 'all'>, (q: string, limit: number) => Promise<SearchResult[]>> = {
  students: searchStudents,
  teachers: searchTeachers,
  schools: searchSchools,
  chapters: searchChapters,
  questions: searchQuestions,
};

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  const parsed = QuerySchema.safeParse({
    q: request.nextUrl.searchParams.get('q') ?? '',
    scope: request.nextUrl.searchParams.get('scope') ?? 'all',
    limit: request.nextUrl.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid query' },
      { status: 400 },
    );
  }
  const { q, scope, limit } = parsed.data;

  try {
    const scopesToRun: Exclude<Scope, 'all'>[] =
      scope === 'all' ? (Object.keys(SEARCHERS) as Exclude<Scope, 'all'>[]) : [scope];

    const resultsByScope = await Promise.all(
      scopesToRun.map((s) => SEARCHERS[s](q, limit)),
    );

    return NextResponse.json({
      success: true,
      query: q,
      results: resultsByScope.flat(),
    });
  } catch (err) {
    logger.error('global_search_unhandled', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json({ success: false, error: 'Search failed' }, { status: 500 });
  }
}
