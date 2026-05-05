/**
 * GET /api/lab-notebook/list
 *
 * Returns the list of students whose STEM Lab Notebook the caller is allowed
 * to view. Supports the three notebook audiences:
 *   • Student   — themselves (1 row)
 *   • Guardian  — every approved/active linked child
 *   • Teacher   — every student in any class they teach
 *   • Admin     — empty list here (admins use super-admin tooling instead;
 *                 keeping this endpoint scoped avoids accidentally surfacing
 *                 an unbounded student dump to the parent UI)
 *
 * Each entry includes a quick experiment count so a multi-child parent can
 * decide which child's notebook is worth printing.
 *
 * Response shape (P9 standard):
 *   { success: true, data: { students: [{ student_id, name, grade, total_experiments, last_activity_at }] } }
 *
 * Auth: authorizeRequest() — any authenticated user with a role.
 *       Per-row authorization comes from the underlying lookups
 *       (guardian_student_links.status='approved'/'active', class_students,
 *       students.auth_user_id = authUserId).  We use the service-role client
 *       here for join performance but every row is filtered by the caller's
 *       identity below.
 *
 * P5: grade is TEXT '6'..'12'.
 * P13: returns student name + grade only — no email, phone, school, or other PII.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

interface NotebookStudent {
  student_id: string;
  name: string;
  grade: string;
  total_experiments: number;
  last_activity_at: string | null;
  /** How the caller can see this student: 'self' | 'guardian' | 'teacher'. */
  relation: 'self' | 'guardian' | 'teacher';
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request);
  if (!auth.authorized) return auth.errorResponse!;
  const authUserId = auth.userId!;

  try {
    // Discover the caller's student / guardian / teacher internal IDs in one
    // round-trip each. We don't gate on roles[] here because a single auth
    // user can be both a guardian (themselves) and a student (their own
    // child account on a shared device) in our data model.
    const [studentSelfRes, guardianSelfRes, teacherSelfRes] = await Promise.all([
      supabaseAdmin
        .from('students')
        .select('id, name, grade')
        .eq('auth_user_id', authUserId)
        .maybeSingle(),
      supabaseAdmin
        .from('guardians')
        .select('id')
        .eq('auth_user_id', authUserId)
        .maybeSingle(),
      supabaseAdmin
        .from('teachers')
        .select('id')
        .eq('auth_user_id', authUserId)
        .maybeSingle(),
    ]);

    // Build a deduped student set keyed by student_id, preferring 'self' >
    // 'guardian' > 'teacher' for the relation label so parents seeing their
    // own dashboard get the friendliest label.
    const byId = new Map<string, NotebookStudent>();
    const upsert = (s: NotebookStudent) => {
      const existing = byId.get(s.student_id);
      if (!existing) {
        byId.set(s.student_id, s);
        return;
      }
      const rank = (r: NotebookStudent['relation']) =>
        r === 'self' ? 3 : r === 'guardian' ? 2 : 1;
      if (rank(s.relation) > rank(existing.relation)) {
        byId.set(s.student_id, { ...existing, relation: s.relation });
      }
    };

    // ── 1. Self (student role) ────────────────────────────────────────
    if (studentSelfRes.data?.id) {
      const s = studentSelfRes.data;
      upsert({
        student_id: s.id,
        name: s.name,
        grade: String(s.grade), // P5: ensure string even if a row has a stray int
        total_experiments: 0,
        last_activity_at: null,
        relation: 'self',
      });
    }

    // ── 2. Guardian → linked children (status approved/active) ────────
    if (guardianSelfRes.data?.id) {
      const { data: linked } = await supabaseAdmin
        .from('guardian_student_links')
        .select('student_id, status, students!inner(id, name, grade)')
        .eq('guardian_id', guardianSelfRes.data.id)
        .in('status', ['approved', 'active']);

      for (const row of linked ?? []) {
        const s = (row as unknown as {
          student_id: string;
          students: { id: string; name: string; grade: string | number } | null;
        }).students;
        if (!s) continue;
        upsert({
          student_id: s.id,
          name: s.name,
          grade: String(s.grade),
          total_experiments: 0,
          last_activity_at: null,
          relation: 'guardian',
        });
      }
    }

    // ── 3. Teacher → enrolled students across their classes ───────────
    if (teacherSelfRes.data?.id) {
      // class_students join: only classes the teacher is assigned to
      // via class_teachers (matching export-report's pattern).
      const { data: teacherClasses } = await supabaseAdmin
        .from('class_teachers')
        .select('class_id')
        .eq('teacher_id', teacherSelfRes.data.id);

      const classIds = (teacherClasses ?? []).map(c => c.class_id);
      if (classIds.length > 0) {
        const { data: enrolled } = await supabaseAdmin
          .from('class_students')
          .select('student_id, students!inner(id, name, grade)')
          .in('class_id', classIds);

        for (const row of enrolled ?? []) {
          const s = (row as unknown as {
            student_id: string;
            students: { id: string; name: string; grade: string | number } | null;
          }).students;
          if (!s) continue;
          upsert({
            student_id: s.id,
            name: s.name,
            grade: String(s.grade),
            total_experiments: 0,
            last_activity_at: null,
            relation: 'teacher',
          });
        }
      }
    }

    const studentIds = Array.from(byId.keys());
    if (studentIds.length === 0) {
      return NextResponse.json({ success: true, data: { students: [] } });
    }

    // ── Pull experiment counts + last activity in a single query ─────
    // Use the streak rollup table for total_experiments and an aggregate
    // for last_activity. Keeps the query surface to two cheap reads.
    const [streakRes, lastActivityRes] = await Promise.all([
      supabaseAdmin
        .from('student_lab_streaks')
        .select('student_id, total_experiments, last_activity_date')
        .in('student_id', studentIds),
      supabaseAdmin
        .from('experiment_observations')
        .select('student_id, created_at')
        .in('student_id', studentIds)
        .order('created_at', { ascending: false }),
    ]);

    const streakMap = new Map<string, { count: number; lastDate: string | null }>();
    for (const r of streakRes.data ?? []) {
      streakMap.set(r.student_id, {
        count: r.total_experiments ?? 0,
        lastDate: r.last_activity_date ?? null,
      });
    }
    const lastByStudent = new Map<string, string>();
    for (const r of lastActivityRes.data ?? []) {
      if (!lastByStudent.has(r.student_id)) {
        lastByStudent.set(r.student_id, r.created_at);
      }
    }

    const students: NotebookStudent[] = Array.from(byId.values()).map(s => {
      const streak = streakMap.get(s.student_id);
      const lastIso = lastByStudent.get(s.student_id) ?? streak?.lastDate ?? null;
      return {
        ...s,
        total_experiments: streak?.count ?? 0,
        last_activity_at: lastIso,
      };
    });

    // Sort by most-recent activity, then by name
    students.sort((a, b) => {
      if (a.last_activity_at && b.last_activity_at) {
        return b.last_activity_at.localeCompare(a.last_activity_at);
      }
      if (a.last_activity_at) return -1;
      if (b.last_activity_at) return 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ success: true, data: { students } });
  } catch (err) {
    logger.error('lab_notebook_list_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: 'lab-notebook/list',
    });
    return NextResponse.json(
      { success: false, error: 'Failed to load notebook list' },
      { status: 500 },
    );
  }
}
