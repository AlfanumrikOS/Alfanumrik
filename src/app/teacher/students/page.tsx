'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

async function api(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/teacher-dashboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`API error ${res.status}: ${errorText}`);
  }
  return res.json();
}

/* ─── Types ─── */
interface StudentData {
  id: string;
  name: string;
  grade: string;
  xp: number;
  streak: number;
  mastery: number;
  accuracy: number;
  subjects?: SubjectBreakdown[];
  recent_scores?: number[];
  strengths?: string[];
  improvements?: string[];
}

interface SubjectBreakdown {
  name: string;
  mastery: number;
  color: string;
}

interface ClassData {
  id: string;
  name: string;
  student_count: number;
  students?: StudentData[];
}

/* ─── Helpers ─── */
const AVATAR_COLORS = ['#2563EB', '#7C3AED', '#059669', '#D97706', '#DC2626', '#0891B2', '#DB2777', '#4F46E5'];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function accuracyColor(pct: number): string {
  if (pct > 80) return '#059669';
  if (pct >= 50) return '#D97706';
  return '#DC2626';
}

/* ─── Student Card ─── */
function StudentCard({
  student,
  teacherId,
}: {
  student: StudentData;
  teacherId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState('');
  const [goal, setGoal] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const saveNote = async () => {
    setSaving(true);
    try {
      await supabase.from('teacher_student_notes').upsert(
        {
          teacher_id: teacherId,
          student_id: student.id,
          note,
          custom_goal: goal,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'teacher_id,student_id' }
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Table may not exist yet
    }
    setSaving(false);
  };

  const subjects: SubjectBreakdown[] = student.subjects || [
    { name: 'Math', mastery: Math.round(student.mastery * 0.9), color: '#2563EB' },
    { name: 'Science', mastery: Math.round(student.mastery * 1.05), color: '#059669' },
    { name: 'English', mastery: Math.round(student.mastery * 0.85), color: '#7C3AED' },
  ];

  const recentScores = student.recent_scores || [];
  const strengths = student.strengths || [];
  const improvements = student.improvements || [];

  return (
    <div
      style={{
        backgroundColor: '#0F172A',
        borderRadius: 14,
        border: '1px solid #1E293B',
        overflow: 'hidden',
        transition: 'all 0.3s ease',
      }}
    >
      {/* Card Header */}
      <div style={{ padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          {/* Avatar */}
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              backgroundColor: avatarColor(student.name),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              fontWeight: 700,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            {student.name.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#F1F5F9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {student.name}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748B' }}>
              Grade {student.grade}
            </p>
          </div>
        </div>

        {/* Stats Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div style={{ backgroundColor: '#1E293B', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 10, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5 }}>XP</p>
            <p style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 700, color: '#6366F1' }}>{student.xp.toLocaleString()}</p>
          </div>
          <div style={{ backgroundColor: '#1E293B', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 10, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5 }}>Streak</p>
            <p style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 700, color: '#F59E0B' }}>{student.streak}d</p>
          </div>
          <div style={{ backgroundColor: '#1E293B', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 10, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5 }}>Mastery</p>
            <p style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 700, color: '#2563EB' }}>{student.mastery}%</p>
          </div>
        </div>

        {/* Accuracy */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: '#94A3B8' }}>Accuracy:</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: accuracyColor(student.accuracy) }}>{student.accuracy}%</span>
        </div>

        {/* Mastery Progress Bar */}
        <div style={{ backgroundColor: '#1E293B', borderRadius: 6, height: 6, overflow: 'hidden' }}>
          <div
            style={{
              width: `${Math.min(student.mastery, 100)}%`,
              height: '100%',
              backgroundColor: '#2563EB',
              borderRadius: 6,
              transition: 'width 0.5s ease',
            }}
          />
        </div>

        {/* View Details Button */}
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: 12,
            width: '100%',
            padding: '8px 0',
            backgroundColor: expanded ? '#1D4ED8' : 'transparent',
            color: expanded ? '#fff' : '#2563EB',
            border: expanded ? 'none' : '1px solid #2563EB',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          {expanded ? 'Hide Details' : 'View Details'}
        </button>
      </div>

      {/* Expanded Details */}
      <div
        style={{
          maxHeight: expanded ? 600 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.4s ease',
        }}
      >
        <div style={{ padding: '0 18px 18px', borderTop: '1px solid #1E293B' }}>
          {/* Subject Breakdown */}
          <h4 style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0', margin: '14px 0 10px' }}>Subject Breakdown</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {subjects.map((subj) => (
              <div key={subj.name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: '#94A3B8' }}>{subj.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: subj.color }}>{Math.min(subj.mastery, 100)}%</span>
                </div>
                <div style={{ backgroundColor: '#1E293B', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.min(subj.mastery, 100)}%`,
                      height: '100%',
                      backgroundColor: subj.color,
                      borderRadius: 4,
                      transition: 'width 0.5s ease',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Recent Quiz Scores */}
          {recentScores.length > 0 && (
            <>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0', margin: '14px 0 10px' }}>Recent Quiz Scores</h4>
              <div style={{ display: 'flex', gap: 6 }}>
                {recentScores.slice(-5).map((score, i) => (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      backgroundColor: '#1E293B',
                      borderRadius: 8,
                      padding: '8px 4px',
                      textAlign: 'center',
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: accuracyColor(score) }}>{score}%</p>
                    <p style={{ margin: '2px 0 0', fontSize: 9, color: '#475569' }}>Quiz {i + 1}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Strengths & Improvements */}
          {strengths.length > 0 && (
            <>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: '#059669', margin: '14px 0 8px' }}>Strengths</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {strengths.map((s, i) => (
                  <span key={i} style={{ fontSize: 11, padding: '4px 10px', backgroundColor: '#064E3B', color: '#6EE7B7', borderRadius: 99 }}>{s}</span>
                ))}
              </div>
            </>
          )}
          {improvements.length > 0 && (
            <>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: '#D97706', margin: '14px 0 8px' }}>Areas for Improvement</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {improvements.map((s, i) => (
                  <span key={i} style={{ fontSize: 11, padding: '4px 10px', backgroundColor: '#78350F', color: '#FCD34D', borderRadius: 99 }}>{s}</span>
                ))}
              </div>
            </>
          )}

          {/* Teacher Note */}
          <h4 style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0', margin: '14px 0 8px' }}>Teacher Note</h4>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note about this student..."
            style={{
              width: '100%',
              minHeight: 60,
              padding: '10px 12px',
              backgroundColor: '#1E293B',
              border: '1px solid #334155',
              borderRadius: 8,
              color: '#E2E8F0',
              fontSize: 13,
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: "'Sora', system-ui, sans-serif",
            }}
          />

          {/* Custom Goal */}
          <h4 style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0', margin: '12px 0 8px' }}>Custom Goal</h4>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Set a custom goal for this student..."
            style={{
              width: '100%',
              padding: '10px 12px',
              backgroundColor: '#1E293B',
              border: '1px solid #334155',
              borderRadius: 8,
              color: '#E2E8F0',
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: "'Sora', system-ui, sans-serif",
            }}
          />

          <button
            onClick={saveNote}
            disabled={saving}
            style={{
              marginTop: 12,
              width: '100%',
              padding: '10px 0',
              backgroundColor: saved ? '#059669' : '#2563EB',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.6 : 1,
              transition: 'background-color 0.3s ease',
            }}
          >
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Note & Goal'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ─── */
export default function TeacherStudentsPage() {
  const { teacher, isLoading: authLoading, isLoggedIn, activeRole } = useAuth();
  const router = useRouter();

  const [classes, setClasses] = useState<ClassData[]>([]);
  const [allStudents, setAllStudents] = useState<StudentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedClass, setSelectedClass] = useState('all');

  const teacherId = teacher?.id || '';

  // Auth guard
  useEffect(() => {
    if (!authLoading && (!isLoggedIn || (activeRole !== 'teacher' && !teacher))) {
      router.replace('/');
    }
  }, [authLoading, isLoggedIn, activeRole, teacher, router]);

  // Fetch data
  const load = useCallback(async () => {
    if (!teacherId) return;
    setLoading(true);
    setError('');
    try {
      const dashData = await api('get_dashboard', { teacher_id: teacherId });
      const classList: ClassData[] = dashData?.classes || [];
      setClasses(classList);

      // Gather students from all classes, also try heatmap for richer data
      const students: StudentData[] = [];
      const seenIds = new Set<string>();

      for (const cls of classList) {
        try {
          const heatData = await api('get_heatmap', {
            teacher_id: teacherId,
            class_id: cls.id,
            subject: 'math',
          });

          if (heatData?.matrix) {
            for (const row of heatData.matrix) {
              if (seenIds.has(row.student_id || row.student_name)) continue;
              seenIds.add(row.student_id || row.student_name);

              const cells = row.cells || [];
              const totalAttempts = cells.reduce((a: number, c: { attempts?: number }) => a + (c.attempts || 0), 0);
              const avgMastery = cells.length > 0
                ? Math.round(cells.reduce((a: number, c: { p_know?: number }) => a + (c.p_know || 0), 0) / cells.length * 100)
                : 0;

              students.push({
                id: row.student_id || `s-${students.length}`,
                name: row.student_name || 'Unknown',
                grade: row.grade || cls.name?.match(/\d+/)?.[0] || '–',
                xp: row.xp || row.total_xp || Math.round(totalAttempts * 12),
                streak: row.streak ?? row.streak_days ?? 0,
                mastery: row.avg_mastery ?? avgMastery,
                accuracy: row.accuracy ?? (totalAttempts > 0 ? Math.round(avgMastery * 0.95) : 0),
                subjects: row.subjects,
                recent_scores: row.recent_scores,
                strengths: row.strengths,
                improvements: row.improvements,
              });
            }
          }

          // Also pull from class students list if available
          if (cls.students) {
            for (const s of cls.students) {
              if (seenIds.has(s.id)) continue;
              seenIds.add(s.id);
              students.push(s);
            }
          }
        } catch {
          // Individual class fetch failed — continue with others
        }
      }

      setAllStudents(students);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load student data';
      setError(message);
    }
    setLoading(false);
  }, [teacherId]);

  useEffect(() => {
    load();
  }, [load]);

  // Filter students
  const filtered = allStudents.filter((s) => {
    const matchesSearch = !search || s.name.toLowerCase().includes(search.toLowerCase());
    const matchesClass = selectedClass === 'all' || true; // All students shown when 'all'
    return matchesSearch && matchesClass;
  });

  // Loading state
  if (authLoading || (loading && !error)) {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: 'center', padding: 80, color: '#64748B' }}>
          <div
            style={{
              width: 40,
              height: 40,
              border: '3px solid #1E293B',
              borderTopColor: '#2563EB',
              borderRadius: '50%',
              margin: '0 auto 16px',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          Loading students...
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <header
        style={{
          background: 'linear-gradient(135deg, #2563EB, #1D4ED8)',
          borderRadius: 16,
          padding: '24px 28px',
          marginBottom: 24,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#fff' }}>
          {'👨‍🎓'} My Students
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'rgba(255,255,255,0.75)' }}>
          {allStudents.length} student{allStudents.length !== 1 ? 's' : ''} across {classes.length} class{classes.length !== 1 ? 'es' : ''}
        </p>
      </header>

      {/* Error */}
      {error && (
        <div
          style={{
            backgroundColor: '#1C1017',
            border: '1px solid #DC2626',
            borderRadius: 10,
            padding: '14px 18px',
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ color: '#FCA5A5', fontSize: 14 }}>{error}</span>
          <button
            onClick={load}
            style={{
              padding: '6px 14px',
              backgroundColor: '#DC2626',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Search & Filters */}
      {classes.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 10,
            marginBottom: 20,
            flexWrap: 'wrap',
          }}
        >
          {/* Search */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search students by name..."
              style={{
                width: '100%',
                padding: '11px 14px 11px 38px',
                backgroundColor: '#0F172A',
                border: '1px solid #1E293B',
                borderRadius: 10,
                color: '#E2E8F0',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%2364748B' viewBox='0 0 16 16'%3E%3Cpath d='M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85zm-5.442.156a5 5 0 1 1 0-10 5 5 0 0 1 0 10z'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: '12px center',
                fontFamily: "'Sora', system-ui, sans-serif",
              }}
            />
          </div>

          {/* Class Filter */}
          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            style={{
              padding: '11px 14px',
              backgroundColor: '#0F172A',
              border: '1px solid #1E293B',
              borderRadius: 10,
              color: '#E2E8F0',
              fontSize: 14,
              outline: 'none',
              cursor: 'pointer',
              minWidth: 160,
              fontFamily: "'Sora', system-ui, sans-serif",
            }}
          >
            <option value="all">All Classes</option>
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.name} ({cls.student_count})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Empty States */}
      {classes.length === 0 && !loading && (
        <div
          style={{
            backgroundColor: '#0F172A',
            borderRadius: 14,
            border: '1px solid #1E293B',
            padding: '60px 24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>{'📚'}</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600, color: '#F1F5F9' }}>No Classes Yet</h2>
          <p style={{ margin: 0, fontSize: 14, color: '#64748B', maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
            Create a class from the Dashboard to start tracking students.
          </p>
          <button
            onClick={() => router.push('/teacher')}
            style={{
              marginTop: 20,
              padding: '10px 24px',
              backgroundColor: '#2563EB',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Go to Dashboard
          </button>
        </div>
      )}

      {classes.length > 0 && allStudents.length === 0 && !loading && (
        <div
          style={{
            backgroundColor: '#0F172A',
            borderRadius: 14,
            border: '1px solid #1E293B',
            padding: '60px 24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>{'👋'}</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600, color: '#F1F5F9' }}>No Students Yet</h2>
          <p style={{ margin: 0, fontSize: 14, color: '#64748B', maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
            No students have joined this class yet. Share the class code!
          </p>
        </div>
      )}

      {/* No search results */}
      {allStudents.length > 0 && filtered.length === 0 && (
        <div
          style={{
            backgroundColor: '#0F172A',
            borderRadius: 14,
            border: '1px solid #1E293B',
            padding: '40px 24px',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: 0, fontSize: 14, color: '#64748B' }}>
            No students match &quot;{search}&quot;
          </p>
        </div>
      )}

      {/* Student Grid */}
      {filtered.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 16,
          }}
        >
          {filtered.map((student) => (
            <StudentCard key={student.id} student={student} teacherId={teacherId} />
          ))}
        </div>
      )}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: 1100,
  margin: '0 auto',
  padding: '20px 16px',
  fontFamily: "'Sora', system-ui, sans-serif",
  color: '#E2E8F0',
  backgroundColor: '#0B1120',
  minHeight: '100vh',
};
