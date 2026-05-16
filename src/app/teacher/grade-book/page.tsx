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
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { BottomNav } from '@/components/ui';

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

/* ─── Styles ─── */
const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  backgroundColor: '#0B1120',
  color: '#E2E8F0',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: '24px 20px 80px',
  maxWidth: 1100,
  margin: '0 auto',
};

const cardStyle: React.CSSProperties = {
  background: '#0F172A',
  borderRadius: 14,
  padding: '18px 20px',
  border: '1px solid #1E293B',
  marginBottom: 16,
};

const spinnerStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  border: '3px solid #1E293B',
  borderTopColor: '#2563EB',
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
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 50, padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0F172A', borderRadius: 14, padding: 22, maxWidth: 420,
          width: '100%', border: '1px solid #1E293B',
        }}
      >
        <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: '#F1F5F9' }}>
          {studentName}
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: '#94A3B8' }}>
          {column.label} <span style={{ color: '#475569' }}>·</span> {column.kind}
        </p>

        <label style={{ display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 4 }}>
          {tt(isHi, 'Score', 'अंक')}
        </label>
        <input
          type="number"
          value={score}
          onChange={e => setScore(e.target.value)}
          style={{
            width: '100%', padding: '8px 10px', backgroundColor: '#1E293B',
            color: '#E2E8F0', border: '1px solid #334155', borderRadius: 8,
            fontSize: 13, marginBottom: 12, outline: 'none', boxSizing: 'border-box',
          }}
        />

        <label style={{ display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 4 }}>
          {tt(isHi, 'Max score', 'अधिकतम अंक')}
        </label>
        <input
          type="number"
          value={maxScore}
          onChange={e => setMaxScore(e.target.value)}
          style={{
            width: '100%', padding: '8px 10px', backgroundColor: '#1E293B',
            color: '#E2E8F0', border: '1px solid #334155', borderRadius: 8,
            fontSize: 13, marginBottom: 12, outline: 'none', boxSizing: 'border-box',
          }}
        />

        <label style={{ display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 4 }}>
          {tt(isHi, 'Notes (optional)', 'टिप्पणी (वैकल्पिक)')}
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder={tt(isHi, 'Internal notes — not shown to learners', 'आंतरिक टिप्पणी — विद्यार्थियों को नहीं दिखेगी')}
          style={{
            width: '100%', padding: '8px 10px', backgroundColor: '#1E293B',
            color: '#E2E8F0', border: '1px solid #334155', borderRadius: 8,
            fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        {error && (
          <p style={{ color: '#FCA5A5', fontSize: 12, margin: '10px 0 0' }}>{error}</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '8px 16px', background: 'transparent', color: '#94A3B8',
              border: '1px solid #334155', borderRadius: 8, fontSize: 13, fontWeight: 500,
              cursor: saving ? 'wait' : 'pointer',
            }}
          >
            {tt(isHi, 'Cancel', 'रद्द करें')}
          </button>
          <button
            onClick={submit}
            disabled={saving}
            style={{
              padding: '8px 18px', background: saving ? '#1E40AF' : '#2563EB',
              color: '#fff', border: 'none', borderRadius: 8, fontSize: 13,
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
        <p style={{ fontSize: 15, fontWeight: 600, color: '#CBD5E1', margin: '8px 0 4px' }}>
          {tt(isHi, 'No students in this class yet', 'इस कक्षा में अभी कोई छात्र नहीं है')}
        </p>
        <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
          {tt(isHi, 'Add students from the Classes tab to populate the grade book.', 'ग्रेड बुक में जोड़ने के लिए कक्षा टैब से छात्र जोड़ें।')}
        </p>
      </div>
    );
  }

  return (
    <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
        <thead>
          <tr style={{ background: '#1E293B' }}>
            <th style={{
              padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600,
              color: '#CBD5E1', position: 'sticky', left: 0, background: '#1E293B', zIndex: 1,
              minWidth: 160,
            }}>
              {tt(isHi, 'Student', 'छात्र')}
            </th>
            {data.columns.map(col => (
              <th key={col.key} style={{
                padding: '10px 14px', textAlign: 'center', fontSize: 12, fontWeight: 600,
                color: '#CBD5E1', minWidth: 90, whiteSpace: 'nowrap',
              }}>
                {col.label}
                <div style={{ fontSize: 10, color: '#64748B', fontWeight: 400 }}>
                  ({tt(isHi, col.kind, col.kind === 'subject' ? 'विषय' : col.kind === 'attendance' ? 'उपस्थिति' : 'इकाई')})
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.students.map((stu, idx) => (
            <tr key={stu.id} style={{ background: idx % 2 === 0 ? '#0F172A' : 'rgba(15,23,42,0.5)' }}>
              <td style={{
                padding: '10px 14px', fontSize: 13, fontWeight: 500, color: '#F1F5F9',
                borderTop: '1px solid #1E293B', position: 'sticky', left: 0,
                background: idx % 2 === 0 ? '#0F172A' : '#0B1326',
              }}>
                {stu.name}
              </td>
              {data.columns.map(col => {
                const cell = data.cells[stu.id]?.[col.key];
                const display = cell?.score != null ? `${cell.score}/${cell.max_score}` : '—';
                const color = cell?.score != null
                  ? cell.score / cell.max_score >= 0.6
                    ? '#22C55E'
                    : cell.score / cell.max_score >= 0.4
                      ? '#F59E0B'
                      : '#EF4444'
                  : '#475569';
                return (
                  <td
                    key={col.key}
                    onClick={() => onCellClick(stu.id, stu.name, col)}
                    style={{
                      padding: '10px 14px', fontSize: 13, fontWeight: 600,
                      color, textAlign: 'center', borderTop: '1px solid #1E293B',
                      cursor: 'pointer', transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(37,99,235,0.12)')}
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

/* ─── Main page ─── */
export default function TeacherGradeBookPage() {
  const { teacher, isLoading: authLoading, isLoggedIn, activeRole, isHi } = useAuth();
  const router = useRouter();

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [term, setTerm] = useState<'current' | 'previous'>('current');
  const [data, setData] = useState<GradeBookData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        <div style={{ textAlign: 'center', padding: 80, color: '#64748B' }}>
          <div style={spinnerStyle} />
          {tt(isHi, 'Loading grade book...', 'ग्रेड बुक लोड हो रही है...')}
        </div>
      </div>
    );
  }

  if (!classesLoading && classes.length === 0) {
    return (
      <div style={pageStyle}>
        <header style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #1E293B' }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#F8FAFC', margin: 0 }}>
            {tt(isHi, 'Grade Book', 'ग्रेड बुक')}
          </h1>
        </header>
        <div style={{ ...cardStyle, textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📚</div>
          <p style={{ fontSize: 15, fontWeight: 600, color: '#CBD5E1', margin: '8px 0 4px' }}>
            {tt(isHi, 'No classes yet', 'अभी कोई कक्षा नहीं')}
          </p>
          <p style={{ fontSize: 13, color: '#64748B', margin: '0 0 16px' }}>
            {tt(isHi, 'Create a class first to start tracking grades.', 'ग्रेड ट्रैक करने के लिए पहले एक कक्षा बनाएं।')}
          </p>
          <button
            onClick={() => router.push('/teacher/classes')}
            style={{
              padding: '8px 18px', background: '#2563EB', color: '#fff', border: 'none',
              borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {tt(isHi, 'Go to Classes', 'कक्षाओं पर जाएं')} →
          </button>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #1E293B', flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <button
            onClick={() => router.push('/teacher')}
            style={{
              background: 'rgba(37,99,235,0.15)', border: 'none', borderRadius: 6,
              padding: '4px 10px', color: '#60A5FA', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', marginBottom: 8,
            }}
          >
            &larr; {tt(isHi, 'Dashboard', 'डैशबोर्ड')}
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#F8FAFC', margin: 0 }}>
            {tt(isHi, 'Grade Book', 'ग्रेड बुक')}
          </h1>
          <p style={{ fontSize: 14, color: '#64748B', margin: '4px 0 0' }}>
            {tt(isHi, 'Roll-up of scores across subjects and units — exportable for term reports.', 'विषयों और इकाइयों के लिए अंकों का सारांश — टर्म रिपोर्ट के लिए निर्यात योग्य।')}
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={loading || !data || data.students.length === 0}
          style={{
            padding: '8px 16px', background: '#22C55E', color: '#fff', border: 'none',
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
        <label style={{ fontSize: 12, color: '#94A3B8' }}>
          {tt(isHi, 'Class', 'कक्षा')}:
        </label>
        <select
          value={selectedClassId}
          onChange={e => setSelectedClassId(e.target.value)}
          style={{
            padding: '6px 10px', background: '#1E293B', color: '#E2E8F0',
            border: '1px solid #334155', borderRadius: 6, fontSize: 13, outline: 'none',
            minWidth: 200,
          }}
        >
          {classes.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <div style={{
          marginLeft: 'auto', display: 'flex', gap: 4, background: '#1E293B',
          borderRadius: 8, padding: 4,
        }}>
          {(['current', 'previous'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTerm(t)}
              style={{
                padding: '6px 12px', border: 'none', borderRadius: 6, fontSize: 12,
                fontWeight: 600,
                background: term === t ? '#2563EB' : 'transparent',
                color: term === t ? '#fff' : '#94A3B8',
                cursor: 'pointer',
              }}
            >
              {t === 'current' ? tt(isHi, 'Current term', 'वर्तमान टर्म') : tt(isHi, 'Previous term', 'पिछला टर्म')}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ ...cardStyle, borderColor: '#EF4444', color: '#FCA5A5', textAlign: 'center', fontSize: 14 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 48 }}>
          <div style={spinnerStyle} />
          <p style={{ color: '#94A3B8', fontSize: 13, margin: 0 }}>
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

      <BottomNav />
    </div>
  );
}
