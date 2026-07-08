'use client';

/**
 * /teacher/grade-book — Phase C.2 grade book screen.
 *
 * Roll-up of student grades for a class as a matrix:
 *   rows    = students
 *   columns = subjects + units + attendance
 *
 * Three actions in the teacher-dashboard Edge Function feed this page:
 *   - get_grade_book        — fetch the matrix for (class, term)
 *   - set_grade_book_cell   — record one cell (emits teacher.grade_entry_set)
 *   - export_grade_book_csv — download CSV blob
 *
 * The Edge Function binds the caller to its JWT-derived teacher_id (P13);
 * a teacher cannot pull another teacher's grade book by passing a foreign
 * teacher_id in the body.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase } from '@alfanumrik/lib/supabase';
import { useTeacherGradebookDepth } from '@alfanumrik/lib/use-teacher-gradebook-depth';
import { BLOOM_LEVEL_ORDER } from '@alfanumrik/lib/types';
import type { ClassMasteryBloomSummary } from '@alfanumrik/lib/types';

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

/* ─── Styles (Atlas warm theme) ─── */
const pageStyle: React.CSSProperties = {
  minHeight: '100dvh',
  backgroundColor: 'var(--surface-2)',
  color: 'var(--text-1)',
  fontFamily: 'inherit',
  padding: 'clamp(12px, 4vw, 24px) clamp(12px, 4vw, 20px) 80px',
  maxWidth: 1100,
  margin: '0 auto',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--surface-1)',
  borderRadius: 14,
  padding: '18px 20px',
  border: '1px solid var(--surface-3)',
  marginBottom: 16,
};

const spinnerStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  border: '3px solid var(--surface-3)',
  borderTopColor: 'var(--orange)',
  borderRadius: '50%',
  margin: '0 auto 16px',
  animation: 'spin 0.8s linear infinite',
};

/* ─── Types ─── */
interface ClassRow { id: string; name: string }

interface GradeBookColumn {
  key: string;
  label: string;
  kind: 'subject' | 'unit' | 'attendance';
}

interface GradeBookCell {
  score: number | null;
  max_score: number;
  status: 'graded' | 'pending' | 'absent';
}

interface GradeBookData {
  class: { id: string; name: string };
  term: 'current' | 'previous';
  students: Array<{ id: string; name: string }>;
  columns: GradeBookColumn[];
  cells: Record<string, Record<string, GradeBookCell>>;
}

/* ─── Cell edit modal ─── */
function CellEditModal({
  studentName,
  column,
  cell,
  onClose,
  onSave,
  saving,
  isHi,
}: {
  studentName: string;
  column: GradeBookColumn;
  cell: GradeBookCell | null;
  onClose: () => void;
  onSave: (score: number, maxScore: number, notes: string) => void;
  saving: boolean;
  isHi: boolean;
}) {
  const [score, setScore] = useState<string>(cell?.score != null ? String(cell.score) : '');
  const [maxScore, setMaxScore] = useState<string>(String(cell?.max_score || 100));
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const submit = () => {
    setError('');
    const s = Number(score);
    const m = Number(maxScore);
    if (!Number.isFinite(s)) {
      setError(tt(isHi, 'Enter a valid number', 'मान्य संख्या दर्ज करें'));
      return;
    }
    if (!Number.isFinite(m) || m <= 0) {
      setError(tt(isHi, 'Max score must be a positive number', 'अधिकतम अंक धनात्मक संख्या होनी चाहिए'));
      return;
    }
    if (s < 0 || s > m) {
      setError(tt(isHi, `Score must be between 0 and ${m}`, `अंक 0 और ${m} के बीच होने चाहिए`));
      return;
    }
    onSave(s, m, notes.trim());
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'var(--scrim)',
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        zIndex: 70, padding: isMobile ? 0 : 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface-1)',
          borderRadius: isMobile ? '14px 14px 0 0' : '14px',
          padding: 22,
          paddingBottom: isMobile ? 'max(20px, env(safe-area-inset-bottom, 20px))' : '22px',
          maxWidth: 'min(420px, calc(100vw - 32px))',
          width: '100%', border: '1px solid var(--surface-2)',
        }}
      >
        <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>
          {studentName}
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-3)' }}>
          {column.label} <span style={{ color: 'var(--text-3)' }}>·</span> {column.kind}
        </p>

        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>
          {tt(isHi, 'Score', 'अंक')}
        </label>
        <input
          type="number"
          value={score}
          onChange={e => setScore(e.target.value)}
          style={{
            width: '100%', padding: '8px 10px', backgroundColor: 'var(--surface-2)',
            color: 'var(--text-1)', border: '1px solid var(--surface-3)', borderRadius: 8,
            fontSize: 13, marginBottom: 12, outline: 'none', boxSizing: 'border-box',
          }}
        />

        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>
          {tt(isHi, 'Max score', 'अधिकतम अंक')}
        </label>
        <input
          type="number"
          value={maxScore}
          onChange={e => setMaxScore(e.target.value)}
          style={{
            width: '100%', padding: '8px 10px', backgroundColor: 'var(--surface-2)',
            color: 'var(--text-1)', border: '1px solid var(--surface-3)', borderRadius: 8,
            fontSize: 13, marginBottom: 12, outline: 'none', boxSizing: 'border-box',
          }}
        />

        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>
          {tt(isHi, 'Notes (optional)', 'टिप्पणी (वैकल्पिक)')}
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder={tt(isHi, 'Internal notes — not shown to learners', 'आंतरिक टिप्पणी — विद्यार्थियों को नहीं दिखेगी')}
          style={{
            width: '100%', padding: '8px 10px', backgroundColor: 'var(--surface-2)',
            color: 'var(--text-1)', border: '1px solid var(--surface-3)', borderRadius: 8,
            fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        {error && (
          <p style={{ color: 'var(--danger)', fontSize: 12, margin: '10px 0 0' }}>{error}</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '8px 16px', background: 'transparent', color: 'var(--text-3)',
              border: '1px solid var(--surface-3)', borderRadius: 8, fontSize: 13, fontWeight: 500,
              cursor: saving ? 'wait' : 'pointer',
            }}
          >
            {tt(isHi, 'Cancel', 'रद्द करें')}
          </button>
          <button
            onClick={submit}
            disabled={saving}
            style={{
              padding: '8px 18px', background: saving ? 'var(--orange)' : 'var(--orange)',
              color: 'white', border: 'none', borderRadius: 8, fontSize: 13,
              fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
            }}
          >
            {saving ? tt(isHi, 'Saving…', 'सहेज रहा है…') : tt(isHi, 'Save', 'सहेजें')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Grade book matrix view ─── */
function MatrixView({
  data,
  onCellClick,
  isHi,
}: {
  data: GradeBookData;
  onCellClick: (studentId: string, studentName: string, column: GradeBookColumn) => void;
  isHi: boolean;
}) {
  if (data.students.length === 0) {
    return (
      <div style={{ ...cardStyle, textAlign: 'center', padding: 48 }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
        <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)', margin: '8px 0 4px' }}>
          {tt(isHi, 'No students in this class yet', 'इस कक्षा में अभी कोई छात्र नहीं है')}
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
          {tt(isHi, 'Add students from the Classes tab to populate the grade book.', 'ग्रेड बुक में जोड़ने के लिए कक्षा टैब से छात्र जोड़ें।')}
        </p>
      </div>
    );
  }

  return (
    <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
        <thead>
          <tr style={{ background: 'var(--surface-2)' }}>
            <th style={{
              padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600,
              color: 'var(--text-2)', position: 'sticky', left: 0, background: 'var(--surface-2)', zIndex: 1,
              minWidth: 160,
            }}>
              {tt(isHi, 'Student', 'छात्र')}
            </th>
            {data.columns.map(col => (
              <th key={col.key} style={{
                padding: '10px 14px', textAlign: 'center', fontSize: 12, fontWeight: 600,
                color: 'var(--text-2)', minWidth: 90, whiteSpace: 'nowrap',
              }}>
                {col.label}
                <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>
                  ({tt(isHi, col.kind, col.kind === 'subject' ? 'विषय' : col.kind === 'attendance' ? 'उपस्थिति' : 'इकाई')})
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.students.map((stu, idx) => (
            <tr key={stu.id} style={{ background: idx % 2 === 0 ? 'var(--surface-1)' : 'var(--surface-2)' }}>
              <td style={{
                padding: '14px 14px', fontSize: 13, fontWeight: 500, color: 'var(--text-1)',
                borderTop: '1px solid var(--surface-2)', position: 'sticky', left: 0,
                background: idx % 2 === 0 ? 'var(--surface-1)' : 'var(--surface-2)',
              }}>
                {stu.name}
              </td>
              {data.columns.map(col => {
                const cell = data.cells[stu.id]?.[col.key];
                const display = cell?.score != null ? `${cell.score}/${cell.max_score}` : '—';
                const color = cell?.score != null
                  ? cell.score / cell.max_score >= 0.6
                    ? 'var(--success)'
                    : cell.score / cell.max_score >= 0.4
                      ? 'var(--warning)'
                      : 'var(--danger)'
                  : 'var(--text-3)';
                return (
                  <td
                    key={col.key}
                    onClick={() => onCellClick(stu.id, stu.name, col)}
                    style={{
                      padding: '14px 14px', fontSize: 13, fontWeight: 600,
                      color, textAlign: 'center', borderTop: '1px solid var(--surface-2)',
                      cursor: 'pointer', transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Phase 3A Wave C — class mastery + Bloom's depth view ─── */
// Renders get_class_mastery_bloom_summary above the score matrix when the
// ff_teacher_gradebook_depth flag is ON. Weakest concepts first + the class's
// weakest Bloom's level. mastery_pct / accuracy_pct are display figures the
// assessment layer owns — rendered VERBATIM (no scoring math here). Bloom's
// level NAMES are technical terms — never translated (P7 exception).
function heatColorPct(pct: number): string {
  if (pct >= 95) return 'var(--success)';
  if (pct >= 80) return 'var(--purple)';
  if (pct >= 60) return 'var(--orange)';
  if (pct >= 30) return 'var(--warning)';
  if (pct > 10) return 'var(--warning)';
  return 'var(--surface-3)'; // empty bar — muted warm fill on the cream-2 track
}

function ClassDepthView({
  summary,
  loading,
  error,
  isHi,
  onRetry,
}: {
  summary: ClassMasteryBloomSummary | null;
  loading: boolean;
  error: boolean;
  isHi: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div style={{ ...cardStyle }} data-testid="class-depth-loading">
        <div style={{ height: 120, borderRadius: 10, background: 'var(--surface-2)' }} />
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ ...cardStyle, textAlign: 'center' }} data-testid="class-depth-error">
        <p style={{ color: 'var(--text-3)', fontSize: 13, margin: '0 0 12px' }}>
          {tt(isHi, "Couldn't load the mastery summary", 'मास्टरी सारांश लोड नहीं हो सका')}
        </p>
        <button
          onClick={onRetry}
          style={{
            padding: '8px 16px', background: 'var(--orange)', color: 'white', border: 'none',
            borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {tt(isHi, 'Retry', 'पुनः प्रयास करें')}
        </button>
      </div>
    );
  }
  if (!summary) return null;

  // Project the Bloom rollup onto the canonical 6-level ladder so the picture is
  // complete + stable; unattempted levels render muted.
  const byLevel = new Map(
    (summary.bloom.by_level || []).map((r) => [r.bloom_level.trim().toLowerCase(), r]),
  );
  const ladder = BLOOM_LEVEL_ORDER.map((level) => {
    const row = byLevel.get(level);
    return {
      level,
      attempted: !!row && row.total > 0,
      accuracy_pct: row?.accuracy_pct ?? 0,
      correct: row?.correct ?? 0,
      total: row?.total ?? 0,
    };
  });
  const weakest = summary.bloom.weakest_level
    ? summary.bloom.weakest_level.trim().toLowerCase()
    : null;
  // Weakest concepts first (already weakest-first from the Edge); show top 6.
  const weakestConcepts = (summary.mastery.by_concept || []).slice(0, 6);

  return (
    <div style={{ ...cardStyle }} data-testid="class-depth-view">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>
          {tt(isHi, 'Mastery & Bloom depth', 'मास्टरी और Bloom गहराई')}
        </h2>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {summary.student_count} {tt(isHi, 'students', 'छात्र')}
          {' · '}
          {tt(isHi, 'Overall', 'कुल')} {summary.mastery.overall_pct}%
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 18, marginTop: 16 }}>
        {/* Weakest concepts */}
        <div data-testid="class-depth-concepts">
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 0 10px' }}>
            {tt(isHi, 'Weakest concepts', 'सबसे कमज़ोर अवधारणाएं')}
          </h3>
          {weakestConcepts.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
              {tt(isHi, 'No mastery data yet.', 'अभी कोई मास्टरी डेटा नहीं।')}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {weakestConcepts.map((c) => (
                <div key={c.topic_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-2)', width: '46%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.concept}>
                    {c.concept}
                  </span>
                  <div style={{ flex: 1, height: 16, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, c.avg_mastery_pct))}%`, background: heatColorPct(c.avg_mastery_pct) }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', width: 40, textAlign: 'right' }}>
                    {c.avg_mastery_pct}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bloom's distribution — canonical 6 levels; weakest highlighted.
            Bloom's level NAMES are technical terms — NOT translated (P7). */}
        <div data-testid="class-depth-bloom">
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 0 10px' }}>
            {/* "Bloom's" is a technical term — kept verbatim (P7 exception). */}
            {tt(isHi, "Bloom's distribution", "Bloom's वितरण")}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ladder.map((b) => {
              const isWeakest = weakest === b.level && b.attempted;
              return (
                <div
                  key={b.level}
                  data-testid={`class-bloom-row-${b.level}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '3px 6px', borderRadius: 6,
                    background: isWeakest ? 'var(--red-soft)' : 'transparent',
                    border: isWeakest ? '1px solid var(--red-soft)' : '1px solid transparent',
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)', width: 84, textTransform: 'capitalize' }}>
                    {b.level}
                  </span>
                  <div style={{ flex: 1, height: 14, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}>
                    {b.attempted && (
                      <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, b.accuracy_pct))}%`, background: heatColorPct(b.accuracy_pct) }} />
                    )}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: b.attempted ? 'var(--text-1)' : 'var(--text-3)', width: 40, textAlign: 'right' }}>
                    {b.attempted ? `${b.accuracy_pct}%` : '—'}
                  </span>
                  {isWeakest && (
                    <span data-testid="class-bloom-weakest" style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                      {tt(isHi, 'Weakest', 'सबसे कमज़ोर')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Main page ─── */
export default function TeacherGradeBookPage() {
  const { teacher, isLoading: authLoading, isLoggedIn, activeRole, isHi } = useAuth();
  const router = useRouter();

  // Wave C — gate the mastery/Bloom depth view. Default OFF ⇒ the page is the
  // existing score matrix only (byte-identical).
  const gradebookDepthEnabled = useTeacherGradebookDepth();

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [term, setTerm] = useState<'current' | 'previous'>('current');
  const [data, setData] = useState<GradeBookData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading) {
        setLoading(false);
        setError(tt(isHi, "Loading timed out. Please try again.", "लोडिंग टाइम आउट। कृपया पुनः प्रयास करें।"));
      }
    }, 10000);
    return () => clearTimeout(timer);
  }, [loading, isHi]);


  // Wave C — class mastery + Bloom's summary state.
  const [depth, setDepth] = useState<ClassMasteryBloomSummary | null>(null);
  const [depthLoading, setDepthLoading] = useState(false);
  const [depthError, setDepthError] = useState(false);

  const [editCell, setEditCell] = useState<{
    studentId: string;
    studentName: string;
    column: GradeBookColumn;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const teacherId = teacher?.id || '';

  // Auth guard.
  useEffect(() => {
    if (!authLoading && (!isLoggedIn || (activeRole !== 'teacher' && !teacher))) {
      router.replace('/login');
    }
  }, [authLoading, isLoggedIn, activeRole, teacher, router]);

  // Load teacher's classes (dashboard endpoint already returns these).
  const loadClasses = useCallback(async () => {
    if (!teacherId) return;
    setClassesLoading(true);
    try {
      const dash = await api('get_dashboard', { teacher_id: teacherId });
      const cls = (dash?.classes || []) as ClassRow[];
      setClasses(cls);
      if (cls.length > 0 && !selectedClassId) setSelectedClassId(cls[0].id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tt(isHi, 'Failed to load classes', 'कक्षाएं लोड करने में विफल'));
    } finally {
      setClassesLoading(false);
    }
  }, [teacherId, selectedClassId, isHi]);

  useEffect(() => { loadClasses(); }, [loadClasses]);

  // Load the grade book whenever class or term changes.
  const loadGradeBook = useCallback(async () => {
    if (!teacherId || !selectedClassId) return;
    setLoading(true);
    setError('');
    try {
      const body = await api('get_grade_book', {
        teacher_id: teacherId,
        class_id: selectedClassId,
        term,
      });
      setData(body as GradeBookData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tt(isHi, 'Failed to load grade book', 'ग्रेड बुक लोड करने में विफल'));
    } finally {
      setLoading(false);
    }
  }, [teacherId, selectedClassId, term, isHi]);

  useEffect(() => { loadGradeBook(); }, [loadGradeBook]);

  // Wave C — load the class mastery/Bloom depth summary. Only fetched when the
  // flag is ON, so flag-OFF makes zero extra requests (byte-identical behaviour).
  const loadDepth = useCallback(async () => {
    if (!gradebookDepthEnabled || !teacherId || !selectedClassId) return;
    setDepthLoading(true);
    setDepthError(false);
    try {
      const body = await api('get_class_mastery_bloom_summary', {
        teacher_id: teacherId,
        class_id: selectedClassId,
      });
      setDepth(body as ClassMasteryBloomSummary);
    } catch {
      // P13: no PII in logs — surface a retryable error in the depth view only.
      setDepth(null);
      setDepthError(true);
    } finally {
      setDepthLoading(false);
    }
  }, [gradebookDepthEnabled, teacherId, selectedClassId]);

  useEffect(() => { loadDepth(); }, [loadDepth]);

  const handleSaveCell = async (score: number, maxScore: number, notes: string) => {
    if (!editCell || !selectedClassId) return;
    setSaving(true);
    try {
      const params: Record<string, unknown> = {
        teacher_id: teacherId,
        class_id: selectedClassId,
        student_id: editCell.studentId,
        column_key: editCell.column.key,
        score,
        max_score: maxScore,
      };
      if (notes) params.notes = notes;
      await api('set_grade_book_cell', params);
      setEditCell(null);
      await loadGradeBook();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tt(isHi, 'Failed to save grade', 'अंक सहेजने में विफल'));
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (!teacherId || !selectedClassId) return;
    setError('');
    try {
      const result = await api('export_grade_book_csv', {
        teacher_id: teacherId,
        class_id: selectedClassId,
        term,
      });
      const filename = String(result?.filename || 'gradebook.csv');
      const content = String(result?.csv_content || '');
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tt(isHi, 'Failed to export CSV', 'CSV निर्यात करने में विफल'));
    }
  };

  if (authLoading || classesLoading) {
    return (
      <div style={pageStyle}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-3)' }}>
          <div style={spinnerStyle} />
          {tt(isHi, 'Loading grade book...', 'ग्रेड बुक लोड हो रही है...')}
        </div>
      </div>
    );
  }

  if (!classesLoading && classes.length === 0) {
    return (
      <div style={pageStyle}>
        <header style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--surface-2)' }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>
            {tt(isHi, 'Grade Book', 'ग्रेड बुक')}
          </h1>
        </header>
        <div style={{ ...cardStyle, textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📚</div>
          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)', margin: '8px 0 4px' }}>
            {tt(isHi, 'No classes yet', 'अभी कोई कक्षा नहीं')}
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 16px' }}>
            {tt(isHi, 'Create a class first to start tracking grades.', 'ग्रेड ट्रैक करने के लिए पहले एक कक्षा बनाएं।')}
          </p>
          <button
            onClick={() => router.push('/teacher/classes')}
            style={{
              padding: '8px 18px', background: 'var(--orange)', color: 'white', border: 'none',
              borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {tt(isHi, 'Go to Classes', 'कक्षाओं पर जाएं')} →
          </button>
        </div>
        
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--surface-2)', flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <button
            onClick={() => router.push('/teacher')}
            style={{
              background: 'var(--surface-2)', border: 'none', borderRadius: 6,
              padding: '4px 10px', color: 'var(--orange)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', marginBottom: 8,
            }}
          >
            &larr; {tt(isHi, 'Dashboard', 'डैशबोर्ड')}
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>
            {tt(isHi, 'Grade Book', 'ग्रेड बुक')}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-3)', margin: '4px 0 0' }}>
            {tt(isHi, 'Roll-up of scores across subjects and units — exportable for term reports.', 'विषयों और इकाइयों के लिए अंकों का सारांश — टर्म रिपोर्ट के लिए निर्यात योग्य।')}
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={loading || !data || data.students.length === 0}
          style={{
            padding: '8px 16px', background: 'var(--success)', color: 'white', border: 'none',
            borderRadius: 8, fontSize: 13, fontWeight: 600,
            cursor: loading || !data || data.students.length === 0 ? 'not-allowed' : 'pointer',
            opacity: loading || !data || data.students.length === 0 ? 0.5 : 1,
          }}
        >
          {tt(isHi, 'Export CSV', 'CSV निर्यात')}
        </button>
      </header>

      {/* Class + term selectors */}
      <div style={{ ...cardStyle, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {tt(isHi, 'Class', 'कक्षा')}:
        </label>
        <select
          value={selectedClassId}
          onChange={e => setSelectedClassId(e.target.value)}
          style={{
            padding: '6px 10px', background: 'var(--surface-2)', color: 'var(--text-1)',
            border: '1px solid var(--surface-3)', borderRadius: 6, fontSize: 13, outline: 'none',
            minWidth: 200,
          }}
        >
          {classes.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <div style={{
          marginLeft: 'auto', display: 'flex', gap: 4, background: 'var(--surface-2)',
          borderRadius: 8, padding: 4,
        }}>
          {(['current', 'previous'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTerm(t)}
              style={{
                padding: '6px 12px', border: 'none', borderRadius: 6, fontSize: 12,
                fontWeight: 600,
                background: term === t ? 'var(--orange)' : 'transparent',
                color: term === t ? 'var(--surface-1)' : 'var(--text-3)',
                cursor: 'pointer',
              }}
            >
              {t === 'current' ? tt(isHi, 'Current term', 'वर्तमान टर्म') : tt(isHi, 'Previous term', 'पिछला टर्म')}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ ...cardStyle, borderColor: 'var(--danger)', color: 'var(--danger)', textAlign: 'center', fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Wave C — mastery + Bloom's depth view (flag-gated; above the matrix). */}
      {gradebookDepthEnabled && (
        <ClassDepthView
          summary={depth}
          loading={depthLoading}
          error={depthError}
          isHi={isHi}
          onRetry={loadDepth}
        />
      )}

      {loading ? (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 48 }}>
          <div style={spinnerStyle} />
          <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>
            {tt(isHi, 'Loading grade book...', 'ग्रेड बुक लोड हो रही है...')}
          </p>
        </div>
      ) : data ? (
        <MatrixView
          data={data}
          onCellClick={(studentId, studentName, column) =>
            setEditCell({ studentId, studentName, column })
          }
          isHi={isHi}
        />
      ) : null}

      {editCell && (
        <CellEditModal
          studentName={editCell.studentName}
          column={editCell.column}
          cell={data?.cells[editCell.studentId]?.[editCell.column.key] || null}
          onClose={() => setEditCell(null)}
          onSave={handleSaveCell}
          saving={saving}
          isHi={isHi}
        />
      )}

      
    </div>
  );
}
