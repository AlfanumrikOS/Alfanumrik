'use client';

/**
 * /teacher/submissions — Phase C.1 submission review screen.
 *
 * Three-step drill-in:
 *   1. Assignment list (own assignments only)
 *   2. Submissions list for a chosen assignment (per-student status)
 *   3. Per-question breakdown for a chosen submission + feedback input
 *
 * All data goes through the teacher-dashboard Edge Function via the same
 * api() helper used by /teacher/reports. The Edge Function binds the
 * caller to its JWT-derived teacher_id (P13), so a teacher cannot pull
 * another teacher's assignments by passing a foreign id.
 */

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { calculateScorePercent } from '@alfanumrik/lib/scoring';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@alfanumrik/lib/supabase';
import { Bone, TeacherTableSkeleton } from '@alfanumrik/ui/Skeleton';

const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

async function api(action: string, params: Record<string, unknown> = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON,
  };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch { /* no session — Edge Function will reject */ }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/teacher-dashboard`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`API error ${res.status}: ${errorText}`);
  }
  return res.json();
}

/* ─── Styles (matched to /teacher/reports — Atlas warm theme) ─── */
const pageStyle: React.CSSProperties = {
  minHeight: '100dvh',
  backgroundColor: '#FBF8F4',
  color: '#1A1207',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: '24px 20px 80px',
  maxWidth: 900,
  margin: '0 auto',
};

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 14,
  padding: '18px 20px',
  border: '1px solid #EDE6DC',
  marginBottom: 16,
};


/* ─── Interfaces ─── */
interface AssignmentRow {
  id: string;
  title: string;
  subject: string | null;
  grade: string | null;
  chapter: string | null;
  difficulty: string | null;
  question_count: number | null;
  due_date: string | null;
  class_id: string | null;
  created_at: string | null;
  type?: string | null;
}

interface SubmissionRow {
  student_id: string;
  student_name: string;
  submission_id: string | null;
  submitted_at: string | null;
  score_percent: number | null;
  time_spent_sec: number;
  status: 'pending' | 'submitted' | 'graded';
  questions_total: number;
  questions_correct: number;
}

interface AnswerRow {
  question_id: string;
  question_text: string;
  student_answer: unknown;
  correct_answer: unknown;
  correct: boolean;
  time_spent: number;
}

interface SubmissionDetail {
  submission: {
    id: string;
    score: number | null;
    teacher_feedback: string | null;
    status: 'pending' | 'submitted' | 'graded';
    submitted_at: string | null;
    graded_at: string | null;
    questions_total: number | null;
    questions_correct: number | null;
  };
  answers: AnswerRow[];
  student: { id: string; name: string; grade: string } | null;
  assignment: AssignmentRow | null;
}

/* ─── Helpers ─── */
function statusBadgeStyle(status: SubmissionRow['status']): { bg: string; color: string; label: { en: string; hi: string } } {
  switch (status) {
    case 'graded':
      return { bg: 'rgba(22,163,74,0.15)', color: '#22C55E', label: { en: 'Reviewed', hi: 'समीक्षा हो चुकी' } };
    case 'submitted':
      return { bg: 'rgba(232,88,28,0.12)', color: '#E8581C', label: { en: 'Submitted', hi: 'सबमिट किया' } };
    default:
      return { bg: 'rgba(125,114,100,0.12)', color: '#7D7264', label: { en: 'Pending', hi: 'लंबित' } };
  }
}

function formatDate(iso: string | null, isHi: boolean): string {
  if (!iso) return tt(isHi, 'No date', 'कोई तिथि नहीं');
  try {
    return new Date(iso).toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function renderAnswer(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return '—'; }
}

/* ─── View: assignment list ─── */
function AssignmentListView({
  assignments,
  isHi,
  onSelect,
}: {
  assignments: AssignmentRow[];
  isHi: boolean;
  onSelect: (a: AssignmentRow) => void;
}) {
  if (assignments.length === 0) {
    return (
      <div style={{ ...cardStyle, textAlign: 'center', padding: 48 }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
        <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)', margin: '8px 0 4px' }}>
          {tt(isHi, 'No assignments yet', 'अभी तक कोई असाइनमेंट नहीं')}
        </p>
        <p style={{ fontSize: 13, color: '#7D7264', margin: 0 }}>
          {tt(isHi, 'Create one from the Assignments tab to see student submissions here.', 'छात्र सबमिशन देखने के लिए असाइनमेंट टैब से एक बनाएं।')}
        </p>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {assignments.map(a => (
        <button
          key={a.id}
          onClick={() => onSelect(a)}
          style={{
            ...cardStyle,
            marginBottom: 0,
            textAlign: 'left',
            cursor: 'pointer',
            background: '#FFFFFF',
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = '#E8581C')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--surface-2)')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1A1207', margin: '0 0 4px' }}>
                {a.title}
              </h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: '#7D7264' }}>
                {a.subject && <span>{a.subject}</span>}
                {a.grade && <span>· {tt(isHi, 'Grade', 'कक्षा')} {a.grade}</span>}
                {a.chapter && <span>· {a.chapter}</span>}
                {a.question_count != null && <span>· {a.question_count} {tt(isHi, 'questions', 'प्रश्न')}</span>}
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#7D7264', whiteSpace: 'nowrap' }}>
              {a.due_date
                ? `${tt(isHi, 'Due', 'देय')} ${formatDate(a.due_date, isHi)}`
                : formatDate(a.created_at, isHi)}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ─── View: submissions list ─── */
function SubmissionListView({
  assignment,
  rows,
  loading,
  isHi,
  onBack,
  onSelect,
}: {
  assignment: AssignmentRow;
  rows: SubmissionRow[];
  loading: boolean;
  isHi: boolean;
  onBack: () => void;
  onSelect: (r: SubmissionRow) => void;
}) {
  const submittedCount = rows.filter(r => r.status !== 'pending').length;
  const gradedCount = rows.filter(r => r.status === 'graded').length;

  return (
    <div>
      <button
        onClick={onBack}
        style={{ background: 'rgba(232,88,28,0.12)', border: 'none', borderRadius: 6, padding: '4px 10px', color: 'var(--orange)', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 12 }}
      >
        &larr; {tt(isHi, 'Back to assignments', 'असाइनमेंट पर वापस')}
      </button>
      <div style={cardStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1A1207', margin: '0 0 4px' }}>{assignment.title}</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, color: '#7D7264' }}>
          {assignment.subject && <span>{assignment.subject}</span>}
          {assignment.grade && <span>· {tt(isHi, 'Grade', 'कक्षा')} {assignment.grade}</span>}
          <span>· {submittedCount}/{rows.length} {tt(isHi, 'submitted', 'सबमिट')}</span>
          <span>· {gradedCount} {tt(isHi, 'reviewed', 'समीक्षित')}</span>
        </div>
      </div>

      {loading ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">{tt(isHi, 'Loading submissions…', 'सबमिशन लोड हो रहे हैं…')}</span>
          <TeacherTableSkeleton rows={6} />
        </div>
      ) : rows.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📝</div>
          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)', margin: '8px 0 4px' }}>
            {tt(isHi, 'No submissions yet', 'अभी तक कोई सबमिशन नहीं')}
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
            {tt(isHi, 'Students will appear here once they start the assignment.', 'जब छात्र असाइनमेंट शुरू करेंगे, वे यहां दिखाई देंगे।')}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => {
            const badge = statusBadgeStyle(r.status);
            const clickable = r.status !== 'pending' && !!r.submission_id;
            return (
              <button
                key={r.student_id}
                disabled={!clickable}
                onClick={() => clickable && onSelect(r)}
                style={{
                  ...cardStyle,
                  marginBottom: 0,
                  textAlign: 'left',
                  cursor: clickable ? 'pointer' : 'default',
                  opacity: clickable ? 1 : 0.7,
                  transition: 'border-color 0.15s',
                  background: '#FFFFFF',
                }}
                onMouseEnter={e => clickable && (e.currentTarget.style.borderColor = '#E8581C')}
                onMouseLeave={e => clickable && (e.currentTarget.style.borderColor = 'var(--surface-2)')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1207' }}>{r.student_name}</div>
                    <div style={{ fontSize: 12, color: '#7D7264', marginTop: 2 }}>
                      {r.submitted_at ? formatDate(r.submitted_at, isHi) : tt(isHi, 'Not started', 'शुरू नहीं हुआ')}
                      {r.score_percent != null && ` · ${r.score_percent}%`}
                    </div>
                  </div>
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    background: badge.bg,
                    color: badge.color,
                    fontSize: 11,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}>
                    {tt(isHi, badge.label.en, badge.label.hi)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── View: submission detail + feedback ─── */
function SubmissionDetailView({
  detail,
  loading,
  isHi,
  teacherId,
  onBack,
  onSaved,
}: {
  detail: SubmissionDetail | null;
  loading: boolean;
  isHi: boolean;
  teacherId: string;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [feedback, setFeedback] = useState('');
  const [scoreOverride, setScoreOverride] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (detail?.submission) {
      setFeedback(detail.submission.teacher_feedback || '');
      setScoreOverride(detail.submission.score != null ? String(detail.submission.score) : '');
      setSuccess(false);
      setError('');
    }
  }, [detail?.submission?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !detail) {
    return (
      <div>
        <button
          onClick={onBack}
          style={{ background: 'rgba(232,88,28,0.12)', border: 'none', borderRadius: 6, padding: '4px 10px', color: 'var(--orange)', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 12 }}
        >
          &larr; {tt(isHi, 'Back', 'वापस')}
        </button>
        <div style={{ ...cardStyle, padding: 20 }} role="status" aria-busy="true">
          <span className="sr-only">{tt(isHi, 'Loading submission…', 'सबमिशन लोड हो रहा है…')}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Bone width="55%" height={18} />
            <Bone width="35%" height={12} />
            <Bone height={80} radius={12} />
            <Bone height={44} radius={12} />
          </div>
        </div>
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      const params: Record<string, unknown> = {
        teacher_id: teacherId,
        submission_id: detail.submission.id,
      };
      if (feedback.trim()) params.feedback = feedback.trim();
      const overrideNum = scoreOverride.trim() === '' ? null : Number(scoreOverride);
      if (overrideNum != null && Number.isFinite(overrideNum)) {
        params.score_override = overrideNum;
      }
      await api('mark_submission_reviewed', params);
      setSuccess(true);
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tt(isHi, 'Failed to save feedback', 'फ़ीडबैक सहेजने में विफल'));
    } finally {
      setSaving(false);
    }
  };

  const accuracy = detail.submission.questions_total && detail.submission.questions_total > 0
    ? calculateScorePercent(detail.submission.questions_correct ?? 0, detail.submission.questions_total)
    : detail.submission.score ?? 0;

  return (
    <div>
      <button
        onClick={onBack}
        style={{ background: 'rgba(232,88,28,0.12)', border: 'none', borderRadius: 6, padding: '4px 10px', color: 'var(--orange)', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 12 }}
      >
        &larr; {tt(isHi, 'Back to submissions', 'सबमिशन पर वापस')}
      </button>

      {/* Header card */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1A1207', margin: '0 0 4px' }}>
              {detail.student?.name || tt(isHi, 'Student', 'छात्र')}
            </h2>
            <div style={{ fontSize: 12, color: '#7D7264' }}>
              {detail.assignment?.title}
              {detail.student?.grade && ` · ${tt(isHi, 'Grade', 'कक्षा')} ${detail.student.grade}`}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: accuracy >= 60 ? '#22C55E' : accuracy >= 40 ? '#F59E0B' : '#EF4444' }}>
              {detail.submission.score ?? accuracy}%
            </div>
            <div style={{ fontSize: 11, color: '#7D7264' }}>
              {detail.submission.questions_correct ?? 0}/{detail.submission.questions_total ?? 0} {tt(isHi, 'correct', 'सही')}
            </div>
          </div>
        </div>
      </div>

      {/* Per-question breakdown */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1A1207', margin: '0 0 12px' }}>
          {tt(isHi, 'Per-question breakdown', 'प्रश्न-वार विश्लेषण')}
        </h3>
        {detail.answers.length === 0 ? (
          <p style={{ color: '#7D7264', fontSize: 13, fontStyle: 'italic', margin: 0 }}>
            {tt(isHi, 'No per-question responses recorded for this submission.', 'इस सबमिशन के लिए प्रश्न-वार उत्तर रिकॉर्ड नहीं हैं।')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {detail.answers.map((a, i) => (
              <div key={a.question_id} style={{
                padding: '12px 14px',
                background: 'var(--surface-2)',
                borderRadius: 10,
                borderLeft: `3px solid ${a.correct ? '#22C55E' : '#EF4444'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1207', flex: 1 }}>
                    {tt(isHi, `Q${i + 1}.`, `प्र${i + 1}.`)} {a.question_text}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: a.correct ? '#22C55E' : '#EF4444' }}>
                    {a.correct ? '✓' : '✗'}
                  </span>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-2)' }}>
                  <span style={{ color: '#7D7264' }}>{tt(isHi, 'Answer', 'उत्तर')}:</span> {renderAnswer(a.student_answer)}
                </div>
                {!a.correct && a.correct_answer != null && (
                  <div style={{ marginTop: 4, fontSize: 12, color: '#7D7264' }}>
                    <span style={{ color: '#7D7264' }}>{tt(isHi, 'Expected', 'अपेक्षित')}:</span> {renderAnswer(a.correct_answer)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Feedback form */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1A1207', margin: '0 0 12px' }}>
          {tt(isHi, 'Teacher feedback', 'शिक्षक फ़ीडबैक')}
        </h3>
        <textarea
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder={tt(isHi, 'Write feedback for the student (optional)…', 'छात्र के लिए फ़ीडबैक लिखें (वैकल्पिक)…')}
          style={{
            width: '100%',
            padding: '10px 12px',
            backgroundColor: 'var(--surface-2)',
            color: '#1A1207',
            border: '1px solid #EDE6DC',
            borderRadius: 8,
            fontSize: 13,
            fontFamily: 'inherit',
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: '#7D7264' }}>
            {tt(isHi, 'Score override (0–100)', 'स्कोर ओवरराइड (0–100)')}:
          </label>
          <input
            type="number"
            min={0}
            max={100}
            value={scoreOverride}
            onChange={e => setScoreOverride(e.target.value)}
            style={{
              width: 90,
              padding: '6px 10px',
              backgroundColor: 'var(--surface-2)',
              color: '#1A1207',
              border: '1px solid #EDE6DC',
              borderRadius: 6,
              fontSize: 13,
              outline: 'none',
            }}
          />
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              marginLeft: 'auto',
              padding: '8px 18px',
              background: saving ? '#C2410C' : '#E8581C',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? 'wait' : 'pointer',
            }}
          >
            {saving
              ? tt(isHi, 'Saving…', 'सहेज रहा है…')
              : tt(isHi, 'Save review', 'समीक्षा सहेजें')}
          </button>
        </div>
        {error && (
          <p style={{ marginTop: 10, color: 'var(--danger)', fontSize: 12 }}>{error}</p>
        )}
        {success && !error && (
          <p style={{ marginTop: 10, color: '#22C55E', fontSize: 12 }}>
            {tt(isHi, 'Review saved.', 'समीक्षा सहेजी गई।')}
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Main page ─── */
function TeacherSubmissionsPageContent() {
  const { teacher, isLoading: authLoading, isLoggedIn, activeRole, isHi } = useAuth();
  const router = useRouter();
  // Phase 3A Wave B — deep-link target. The Command Center's grading queue
  // links here as /teacher/submissions?assignment=<id>&submission=<id> to drop
  // the teacher straight into the per-question review + feedback form. Absent
  // params ⇒ the legacy assignment-list landing renders unchanged.
  const searchParams = useSearchParams();
  const deepAssignmentId = searchParams.get('assignment') || '';
  const deepSubmissionId = searchParams.get('submission') || '';

  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AssignmentRow | null>(null);
  const [subRows, setSubRows] = useState<SubmissionRow[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [activeSub, setActiveSub] = useState<SubmissionRow | null>(null);
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Fire the deep-link drill-in exactly once so backing out doesn't re-trigger.
  const deepLinkConsumed = useRef(false);

  const teacherId = teacher?.id || '';

  // Auth guard.
  useEffect(() => {
    if (!authLoading && (!isLoggedIn || (activeRole !== 'teacher' && !teacher))) {
      router.replace('/login');
    }
  }, [authLoading, isLoggedIn, activeRole, teacher, router]);

  // Load assignments list. The list itself is teacher-scoped via the
  // `assignments.teacher_id` column; we hit the Edge Function for any
  // future ownership-aware shaping, but the legacy supabase client is
  // fine here (page already does this on /teacher/assignments).
  const loadAssignments = useCallback(async () => {
    if (!teacherId) return;
    setLoading(true);
    setError('');
    try {
      // Column-name note (production incident, 2026-07-21): `assignments` has
      // no `type` column — it has `assignment_type`. Alias it to `type` here
      // so the AssignmentRow shape below (and the rest of this file) is
      // unchanged; `chapter`/`difficulty` are real columns as of migration
      // 20260721000300_assignments_add_chapter_difficulty.sql.
      const { data, error: e } = await supabase
        .from('assignments')
        .select('id, title, subject, grade, chapter, difficulty, question_count, due_date, class_id, created_at, type:assignment_type')
        .eq('teacher_id', teacherId)
        .order('created_at', { ascending: false });
      if (e) throw e;
      setAssignments((data as AssignmentRow[]) || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tt(isHi, 'Failed to load assignments', 'असाइनमेंट लोड करने में विफल'));
    } finally {
      setLoading(false);
    }
  }, [teacherId, isHi]);

  useEffect(() => { loadAssignments(); }, [loadAssignments]);

  // Drill-in: open an assignment → fetch submissions list. Returns the loaded
  // rows so the deep-link path can chain straight into a submission.
  const openAssignment = useCallback(async (a: AssignmentRow): Promise<SubmissionRow[]> => {
    setSelected(a);
    setActiveSub(null);
    setDetail(null);
    setSubRows([]);
    setSubsLoading(true);
    try {
      const data = await api('get_assignment_submissions', { teacher_id: teacherId, assignment_id: a.id });
      const rows: SubmissionRow[] = data?.submissions || [];
      setSubRows(rows);
      return rows;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tt(isHi, 'Failed to load submissions', 'सबमिशन लोड करने में विफल'));
      return [];
    } finally {
      setSubsLoading(false);
    }
  }, [teacherId, isHi]);

  // Drill-in deeper: open a single submission. Accepts the full roster row when
  // clicked from the list, or a minimal { submission_id } when arriving via a
  // deep-link (the detail call only needs the id; get_submission_detail returns
  // the student + assignment context the header renders).
  const openSubmission = useCallback(async (row: Pick<SubmissionRow, 'submission_id'> & Partial<SubmissionRow>) => {
    if (!row.submission_id) return;
    setActiveSub(row as SubmissionRow);
    setDetail(null);
    setDetailLoading(true);
    try {
      const data = await api('get_submission_detail', { teacher_id: teacherId, submission_id: row.submission_id });
      setDetail(data as SubmissionDetail);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tt(isHi, 'Failed to load submission detail', 'सबमिशन विवरण लोड करने में विफल'));
    } finally {
      setDetailLoading(false);
    }
  }, [teacherId, isHi]);

  // Deep-link drill-in (Wave B). Once assignments have loaded and both query
  // params are present, open the assignment then the submission automatically —
  // dropping the teacher into the existing review UI without rebuilding it.
  // Guarded by a ref so it runs once; the teacher can Back out normally after.
  useEffect(() => {
    if (deepLinkConsumed.current) return;
    if (!deepAssignmentId || !deepSubmissionId) return;
    if (loading || assignments.length === 0) return;

    const target = assignments.find((a) => a.id === deepAssignmentId);
    if (!target) {
      // The teacher may not own (or no longer have) this assignment — land them
      // on the list rather than a dead deep-link. Mark consumed so we don't loop.
      deepLinkConsumed.current = true;
      return;
    }
    deepLinkConsumed.current = true;
    (async () => {
      const rows = await openAssignment(target);
      const match = rows.find((r) => r.submission_id === deepSubmissionId);
      // Prefer the real roster row (carries name/status); fall back to the id
      // alone so a queue row still opens even if the roster row isn't present.
      await openSubmission(match ?? { submission_id: deepSubmissionId });
    })();
  }, [
    deepAssignmentId,
    deepSubmissionId,
    loading,
    assignments,
    openAssignment,
    openSubmission,
  ]);

  // After saving feedback: refresh both the list and the detail.
  const handleSaved = useCallback(async () => {
    if (selected) {
      try {
        const data = await api('get_assignment_submissions', { teacher_id: teacherId, assignment_id: selected.id });
        setSubRows(data?.submissions || []);
      } catch { /* keep list stale rather than error-banner over success */ }
    }
  }, [selected, teacherId]);

  if (authLoading || (loading && assignments.length === 0 && !error)) {
    return (
      <div
        style={pageStyle}
        role="status"
        aria-busy="true"
        aria-label={tt(isHi, 'Loading submissions…', 'सबमिशन लोड हो रहे हैं…')}
      >
        <span className="sr-only">{tt(isHi, 'Loading submissions…', 'सबमिशन लोड हो रहे हैं…')}</span>
        <div style={{ paddingTop: 16, marginBottom: 20 }}>
          <Bone width={200} height={28} />
        </div>
        <TeacherTableSkeleton rows={6} />
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--surface-2)' }}>
        <div>
          <button
            onClick={() => router.push('/teacher')}
            style={{ background: 'rgba(232,88,28,0.12)', border: 'none', borderRadius: 6, padding: '4px 10px', color: 'var(--orange)', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            &larr; {tt(isHi, 'Dashboard', 'डैशबोर्ड')}
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1207', margin: 0 }}>
            {tt(isHi, 'Submissions', 'सबमिशन')}
          </h1>
          <p style={{ fontSize: 14, color: '#7D7264', margin: '4px 0 0' }}>
            {tt(isHi, 'Review student work, give feedback, mark complete', 'छात्र कार्य की समीक्षा करें, फ़ीडबैक दें, पूर्ण के रूप में चिह्नित करें')}
          </p>
        </div>
        {!selected && (
          <button
            onClick={loadAssignments}
            style={{ padding: '8px 16px', background: 'transparent', color: 'var(--orange)', border: '1px solid var(--orange)', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
          >
            {tt(isHi, 'Refresh', 'रिफ्रेश')}
          </button>
        )}
      </header>

      {error && (
        <div style={{ ...cardStyle, borderColor: 'var(--danger)', color: 'var(--danger)', textAlign: 'center', fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* View routing */}
      {!selected && (
        <AssignmentListView assignments={assignments} isHi={isHi} onSelect={openAssignment} />
      )}
      {selected && !activeSub && (
        <SubmissionListView
          assignment={selected}
          rows={subRows}
          loading={subsLoading}
          isHi={isHi}
          onBack={() => setSelected(null)}
          onSelect={openSubmission}
        />
      )}
      {selected && activeSub && (
        <SubmissionDetailView
          detail={detail}
          loading={detailLoading}
          isHi={isHi}
          teacherId={teacherId}
          onBack={() => { setActiveSub(null); setDetail(null); }}
          onSaved={handleSaved}
        />
      )}

      
    </div>
  );
}


export default function TeacherSubmissionsPage() {
  return (
    <Suspense>
      <TeacherSubmissionsPageContent />
    </Suspense>
  );
}