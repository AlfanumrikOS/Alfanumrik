'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { logger } from '@alfanumrik/lib/logger';
import { supabase } from '@alfanumrik/lib/supabase';

// PostgREST code for "0 rows returned by .single()". Expected here whenever the
// signed-in parent simply has no guardian row / no approved link yet (a B2C
// parent), so it must NOT be logged as a failure.
const PGRST_NO_ROWS = 'PGRST116';

function t(isHi: boolean, en: string, hi: string): string { return isHi ? hi : en; }

interface ExamItem {
  id: string;
  title: string;
  subject: string;
  start_time: string;
  duration_minutes: number;
}

/**
 * Upcoming exams view for parent portal.
 * Shows exams for the parent's child's school.
 * Returns null if child not in a B2B school.
 */
export default function ParentExamSchedule() {
  const { authUserId, isHi } = useAuth();
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [childName, setChildName] = useState('');

  useEffect(() => {
    // Every path through this effect (including the early-return when
    // signed out, and any unexpected error) must resolve `loading` to
    // false exactly once, or the component gets stuck rendering its
    // loading skeleton forever. A try/catch/finally also ensures a
    // failure here never becomes an unhandled promise rejection that
    // could surface as noise in an unrelated part of the app/tests.
    let cancelled = false;

    if (!authUserId) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        // Get linked child's school
        const { data: guardian, error: guardianError } = await supabase
          .from('guardians')
          .select('id')
          .eq('auth_user_id', authUserId)
          .single();

        if (cancelled) return;
        // supabase-js resolves {data, error} and never throws — the catch
        // below is unreachable for query failures, so check `error` here.
        // P13: pg error code only, never the auth user id.
        if (guardianError && guardianError.code !== PGRST_NO_ROWS) {
          logger.warn('parent exam schedule: guardian lookup failed', { code: guardianError.code });
          return;
        }
        if (!guardian) return;

        // Matches both terminal link statuses ('active' from the self-service
        // OTP flow, 'approved' from the signup-time bootstrap flow) -- see
        // parent-dashboard RCA Finding A / migration
        // 20260720170000_parent_dashboard_rca_fixes.sql. A bare
        // .eq('status', 'approved') here would silently show no exams for a
        // guardian linked via the OTP flow, the same class of bug fixed
        // elsewhere in this migration.
        const { data: link, error: linkError } = await supabase
          .from('guardian_student_links')
          .select('student_id, students(name, school_id)')
          .eq('guardian_id', guardian.id)
          .in('status', ['active', 'approved'])
          .limit(1)
          .single();

        if (cancelled) return;
        // P13: pg error code only — never the guardian/student id or name.
        if (linkError && linkError.code !== PGRST_NO_ROWS) {
          logger.warn('parent exam schedule: link lookup failed', { code: linkError.code });
          return;
        }
        if (!link?.students) return;

        const student = link.students as unknown as { name: string; school_id: string | null };
        if (!student.school_id) return;

        setChildName(student.name);

        const { data, error: examsError } = await supabase
          .from('school_exams')
          .select('id, title, subject, start_time, duration_minutes')
          .eq('school_id', student.school_id)
          .in('status', ['scheduled', 'active'])
          .gt('start_time', new Date().toISOString())
          .order('start_time', { ascending: true })
          .limit(5);

        if (cancelled) return;
        // A failure here is indistinguishable from "no upcoming exams" in the
        // rendered output (this card hides itself when empty), so the log is
        // the only signal. P13: pg error code only, never the school id.
        if (examsError) {
          logger.warn('parent exam schedule: exam fetch failed', { code: examsError.code });
          return;
        }
        setExams(data || []);
      } catch {
        // Fail closed: no exams shown, no crash, no unhandled rejection.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [authUserId]);

  if (loading) return <div style={{ padding: 16, background: '#f9fafb', borderRadius: 12, height: 80 }} />;
  if (exams.length === 0) return null;

  return (
    <div style={{
      padding: 16,
      background: '#fff',
      borderRadius: 12,
      border: '1px solid #e5e7eb',
      marginBottom: 16,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: '#111' }}>
        {t(isHi, `Upcoming Exams for ${childName}`, `${childName} की आगामी परीक्षाएँ`)}
      </div>
      {exams.map(exam => {
        const date = new Date(exam.start_time);
        const daysUntil = Math.ceil((date.getTime() - Date.now()) / 86400000);
        const urgencyColor = daysUntil <= 1 ? '#EF4444' : daysUntil <= 3 ? '#EAB308' : '#22C55E';

        return (
          <div key={exam.id} style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 0',
            borderBottom: '1px solid #f3f4f6',
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{exam.title}</div>
              <div style={{ fontSize: 11, color: '#888' }}>
                {exam.subject} • {exam.duration_minutes} {t(isHi, 'min', 'मिनट')}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: urgencyColor }}>
                {daysUntil <= 0
                  ? t(isHi, 'Today', 'आज')
                  : daysUntil === 1
                    ? t(isHi, 'Tomorrow', 'कल')
                    : t(isHi, `In ${daysUntil} days`, `${daysUntil} दिन में`)}
              </div>
              <div style={{ fontSize: 10, color: '#aaa' }}>
                {date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}