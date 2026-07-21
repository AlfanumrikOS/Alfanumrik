'use client';

/**
 * /assignments — student-facing view of teacher-created assignments.
 *
 * Fills a genuine product gap: teachers can create assignments
 * (apps/host/src/app/teacher/assignments/page.tsx) and review submissions
 * (apps/host/src/app/teacher/submissions/page.tsx), but until this page there
 * was NO student-facing surface to see or attempt them at all.
 *
 * Data model (read-only here — see supabase/migrations/00000000000000_baseline_
 * from_prod.sql for `assignments` / `assignment_submissions`):
 *   - `assignments` is RLS-scoped for students via the "Students can view
 *     class assignments" policy (class_id IN student's active classes) — a
 *     plain `select('*')` here already returns only assignments issued to
 *     this student, no manual class join required.
 *   - `assignment_submissions` is RLS-scoped via "Students can manage own
 *     submissions" (student_id = own students.id) — reading is enough to
 *     know per-assignment status; WRITES go through the dedicated
 *     /api/student/assignments/[id]/complete route (see quiz/page.tsx),
 *     never a direct client insert, so class-membership + already-graded
 *     checks are centrally enforced (see
 *     packages/lib/src/learn/assignment-submission.ts).
 *
 * No fixed question set exists per assignment (no `assignment_questions`
 * table) — teachers only set subject/grade/topic/bloom_level/question_count.
 * "Start" therefore deep-links into the EXISTING quiz engine
 * (/quiz?subject=&count=&chapter=&mode=practice&from=assignment&
 * assignmentId=<id>), which assembles questions from question_bank exactly
 * like a normal practice quiz — reusing the full P1/P2/P3/P4/P6 pipeline
 * instead of building a second one.
 *
 * Scope (reported honestly — see the agent's final report for what's
 * deferred): this is a FIRST CUT. Multi-attempt UI, due-date lockout,
 * per-question review of a graded assignment, and Hindi labels for teacher
 * feedback text are not built here.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@alfanumrik/lib/useRequireAuth';
import { supabase } from '@alfanumrik/lib/supabase';
import { CardListSkeleton, Bone } from '@alfanumrik/ui/Skeleton';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';

const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

interface AssignmentRow {
  id: string;
  class_id: string | null;
  title: string;
  description: string | null;
  assignment_type: string | null;
  subject: string | null;
  grade: string | null;
  topic_id: string | null;
  bloom_level: string | null;
  question_count: number | null;
  due_date: string | null;
  max_attempts: number | null;
  status: string | null;
  created_at: string | null;
}

interface SubmissionRow {
  assignment_id: string;
  status: string | null;
  score: number | null;
  submitted_at: string | null;
  graded_at: string | null;
  teacher_feedback: string | null;
}

interface TopicRow {
  id: string;
  chapter_number: number | null;
  title: string | null;
  title_hi: string | null;
}

type ViewStatus = 'not_started' | 'submitted' | 'graded';

function deriveViewStatus(sub: SubmissionRow | undefined): ViewStatus {
  if (!sub) return 'not_started';
  if (sub.graded_at || sub.status === 'graded' || sub.status === 'reviewed') return 'graded';
  if (sub.submitted_at || sub.status === 'submitted' || sub.status === 'completed') return 'submitted';
  return 'not_started';
}

function dueBadge(dueDate: string | null, isHi: boolean): { label: string; bg: string; color: string } | null {
  if (!dueDate) return null;
  const now = new Date();
  const due = new Date(dueDate);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return { label: tt(isHi, 'Overdue', 'देरी हो चुकी'), bg: '#FEF2F2', color: '#DC2626' };
  if (diffDays === 0) return { label: tt(isHi, 'Due today', 'आज देय'), bg: '#FFFBEB', color: '#D97706' };
  return { label: tt(isHi, `Due in ${diffDays}d`, `${diffDays} दिन में देय`), bg: '#FBE6D9', color: '#C2410C' };
}

const pageStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  padding: '20px 16px 100px',
  fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif",
  color: '#1A1207',
  minHeight: '100dvh',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--surface-1, #FFFFFF)',
  borderRadius: 14,
  border: '1px solid var(--surface-2, #EDE6DC)',
  padding: '16px 18px',
  marginBottom: 12,
};

export default function StudentAssignmentsPage() {
  const { isReady, student, isHi } = useRequireAuth('student');
  const router = useRouter();

  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [submissionsByAssignment, setSubmissionsByAssignment] = useState<Map<string, SubmissionRow>>(new Map());
  const [topicsById, setTopicsById] = useState<Map<string, TopicRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    if (!student?.id) return;
    setLoading(true);
    setError('');
    try {
      // RLS ("Students can view class assignments") already scopes this to
      // assignments issued to a class this student is actively enrolled in.
      const { data: asgns, error: aErr } = await supabase
        .from('assignments')
        .select('*')
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (aErr) throw aErr;
      const rows = (asgns as AssignmentRow[]) || [];
      setAssignments(rows);

      const ids = rows.map(a => a.id);
      if (ids.length > 0) {
        // RLS ("Students can manage own submissions") scopes this to the
        // caller's own rows only.
        const { data: subs, error: sErr } = await supabase
          .from('assignment_submissions')
          .select('assignment_id, status, score, submitted_at, graded_at, teacher_feedback')
          .in('assignment_id', ids);
        if (sErr) throw sErr;
        const map = new Map<string, SubmissionRow>();
        for (const s of (subs as SubmissionRow[]) || []) map.set(s.assignment_id, s);
        setSubmissionsByAssignment(map);
      } else {
        setSubmissionsByAssignment(new Map());
      }

      const topicIds = Array.from(new Set(rows.map(a => a.topic_id).filter((t): t is string => !!t)));
      if (topicIds.length > 0) {
        const { data: topics } = await supabase
          .from('curriculum_topics')
          .select('id, chapter_number, title, title_hi')
          .in('id', topicIds);
        const tmap = new Map<string, TopicRow>();
        for (const t of (topics as TopicRow[]) || []) tmap.set(t.id, t);
        setTopicsById(tmap);
      } else {
        setTopicsById(new Map());
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tt(isHi, 'Failed to load assignments', 'असाइनमेंट लोड करने में विफल'));
    } finally {
      setLoading(false);
    }
  }, [student?.id, isHi]);

  useEffect(() => { if (isReady) loadData(); }, [isReady, loadData]);

  const startAssignment = (a: AssignmentRow) => {
    const topic = a.topic_id ? topicsById.get(a.topic_id) : undefined;
    const params = new URLSearchParams();
    if (a.subject) params.set('subject', a.subject);
    if (a.question_count) params.set('count', String(a.question_count));
    if (topic?.chapter_number) params.set('chapter', String(topic.chapter_number));
    params.set('mode', 'practice');
    params.set('from', 'assignment');
    params.set('assignmentId', a.id);
    router.push(`/quiz?${params.toString()}`);
  };

  if (!isReady || loading) {
    return (
      <div style={pageStyle} role="status" aria-busy="true" aria-label={tt(isHi, 'Loading assignments…', 'असाइनमेंट लोड हो रहे हैं…')}>
        <span className="sr-only">{tt(isHi, 'Loading assignments…', 'असाइनमेंट लोड हो रहे हैं…')}</span>
        <div style={{ marginBottom: 20 }}>
          <Bone width={180} height={26} />
        </div>
        <CardListSkeleton count={4} />
      </div>
    );
  }

  return (
    <SectionErrorBoundary section="Student Assignments">
      <div style={pageStyle}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>
          {tt(isHi, 'My Assignments', 'मेरे असाइनमेंट')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-3, #7D7264)', margin: '0 0 20px' }}>
          {tt(isHi, 'Work assigned by your teachers', 'आपके शिक्षकों द्वारा दिए गए कार्य')}
        </p>

        {error && (
          <div style={{ ...cardStyle, borderColor: 'var(--danger, #DC2626)', color: 'var(--danger, #DC2626)', textAlign: 'center' }}>
            {error}
            <div style={{ marginTop: 8 }}>
              <button
                onClick={loadData}
                style={{ background: 'none', border: 'none', color: 'var(--orange)', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}
              >
                {tt(isHi, 'Retry', 'पुनः प्रयास')}
              </button>
            </div>
          </div>
        )}

        {!error && assignments.length === 0 && (
          <div style={{ ...cardStyle, textAlign: 'center', padding: '48px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
            <p style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>
              {tt(isHi, 'No assignments yet', 'अभी तक कोई असाइनमेंट नहीं')}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-3, #7D7264)', margin: 0 }}>
              {tt(isHi, "When your teacher gives you work, it'll show up here.", 'जब आपके शिक्षक कोई काम देंगे, यह यहाँ दिखेगा।')}
            </p>
          </div>
        )}

        {!error && assignments.length > 0 && (
          <div>
            {assignments.map(a => {
              const sub = submissionsByAssignment.get(a.id);
              const viewStatus = deriveViewStatus(sub);
              const due = dueBadge(a.due_date, isHi);
              const topic = a.topic_id ? topicsById.get(a.topic_id) : undefined;
              const topicLabel = topic ? (isHi && topic.title_hi ? topic.title_hi : topic.title) : null;

              return (
                <div key={a.id} style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, flex: 1 }}>{a.title}</h3>
                    {due && viewStatus === 'not_started' && (
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: due.bg, color: due.color, whiteSpace: 'nowrap' }}>
                        {due.label}
                      </span>
                    )}
                    {viewStatus !== 'not_started' && (
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap',
                        background: viewStatus === 'graded' ? 'rgba(34,197,94,0.15)' : 'rgba(232,88,28,0.12)',
                        color: viewStatus === 'graded' ? '#16A34A' : '#E8581C',
                      }}>
                        {viewStatus === 'graded' ? tt(isHi, 'Reviewed', 'समीक्षा हो चुकी') : tt(isHi, 'Submitted', 'सबमिट किया')}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--text-3, #7D7264)', marginBottom: 12 }}>
                    {a.subject && <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--surface-2, #F5F0EA)' }}>{a.subject}</span>}
                    {topicLabel && <span>{topicLabel}</span>}
                    {a.question_count != null && <span>· {a.question_count} {tt(isHi, 'Qs', 'प्रश्न')}</span>}
                  </div>

                  {viewStatus === 'not_started' && (
                    <button
                      onClick={() => startAssignment(a)}
                      style={{
                        width: '100%', padding: '10px 0', minHeight: 44,
                        background: 'linear-gradient(135deg, var(--orange, #E8581C), #C2410C)',
                        color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      {tt(isHi, 'Start Assignment', 'असाइनमेंट शुरू करें')}
                    </button>
                  )}

                  {viewStatus !== 'not_started' && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-2, #4A4033)' }}>
                        {tt(isHi, 'Score', 'स्कोर')}: <strong>{sub?.score ?? '—'}%</strong>
                      </span>
                    </div>
                  )}

                  {viewStatus === 'graded' && sub?.teacher_feedback && (
                    <p style={{ marginTop: 10, fontSize: 12, color: 'var(--text-3, #7D7264)', fontStyle: 'italic', borderTop: '1px solid var(--surface-2, #EDE6DC)', paddingTop: 8 }}>
                      &ldquo;{sub.teacher_feedback}&rdquo;
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SectionErrorBoundary>
  );
}
