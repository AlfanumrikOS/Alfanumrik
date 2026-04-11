'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { SUBJECT_META } from '@/lib/constants';
import { VALID_GRADES } from '@/lib/identity';
import { BottomNav } from '@/components/ui';

// ============================================================
// BILINGUAL HELPERS (P7)
// ============================================================
const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

async function fetchDashboard(teacherId: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/teacher-dashboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
    body: JSON.stringify({ action: 'get_dashboard', teacher_id: teacherId }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

// ── Types ────────────────────────────────────────────────────
interface ClassData {
  id: string;
  name: string;
  grade: string;
  subject?: string;
  student_count: number;
}

interface AssignmentRow {
  id: string;
  title: string;
  class_id: string;
  subject: string;
  grade: string;
  chapter: string;
  difficulty: string;
  question_count: number;
  due_date: string | null;
  type: string;
  created_at: string;
  assignment_submissions: { count: number }[];
}

// ── Helpers ──────────────────────────────────────────────────
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const GRADES = [...VALID_GRADES];

function statusBadge(dueDate: string | null): { label: string; labelHi: string; bg: string; color: string } {
  if (!dueDate) return { label: 'No due date', labelHi: 'कोई अंतिम तिथि नहीं', bg: '#1E293B', color: '#94A3B8' };
  const now = new Date();
  const due = new Date(dueDate);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diff = dueDay.getTime() - today.getTime();
  if (diff < 0) return { label: 'Overdue', labelHi: 'देरी हो चुकी', bg: '#FEF2F2', color: '#DC2626' };
  if (diff === 0) return { label: 'Due Today', labelHi: 'आज देय', bg: '#FFFBEB', color: '#D97706' };
  return { label: 'Upcoming', labelHi: 'आगामी', bg: '#EFF6FF', color: '#2563EB' };
}

function completionPct(submissions: { count: number }[], studentCount: number): number {
  if (!studentCount) return 0;
  const count = submissions?.[0]?.count ?? 0;
  return Math.round((count / studentCount) * 100);
}

const pageStyle: React.CSSProperties = {
  maxWidth: 1100,
  margin: '0 auto',
  padding: '0 16px 100px',
  fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif",
  color: '#E2E8F0',
  backgroundColor: '#0B1120',
  minHeight: '100vh',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  backgroundColor: '#1E293B',
  border: '1px solid #334155',
  borderRadius: 8,
  color: '#E2E8F0',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#94A3B8',
  display: 'block',
  marginBottom: 4,
};

export default function AssignmentsPage() {
  const { teacher, isLoading: authLoading, isLoggedIn, activeRole, isHi } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedClass = searchParams.get('class') || '';

  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formClass, setFormClass] = useState(preselectedClass);
  const [formSubject, setFormSubject] = useState('math');
  const [formChapter, setFormChapter] = useState('');
  const [formDifficulty, setFormDifficulty] = useState('Medium');
  const [formCount, setFormCount] = useState(10);
  const [formDueDate, setFormDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const teacherId = teacher?.id || '';

  // Auth guard
  useEffect(() => {
    if (!authLoading && (!isLoggedIn || (activeRole !== 'teacher' && !teacher))) {
      router.replace('/login');
    }
  }, [authLoading, isLoggedIn, activeRole, teacher, router]);

  const loadData = useCallback(async () => {
    if (!teacherId) return;
    setLoading(true);
    setError('');
    try {
      const [dashData, { data: asgns, error: aErr }] = await Promise.all([
        fetchDashboard(teacherId),
        supabase
          .from('assignments')
          .select('*, assignment_submissions(count)')
          .eq('teacher_id', teacherId)
          .order('created_at', { ascending: false }),
      ]);
      setClasses(dashData?.classes || []);
      if (aErr) throw aErr;
      setAssignments((asgns as AssignmentRow[]) || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tt(isHi, 'Failed to load assignments', 'असाइनमेंट लोड करने में विफल'));
    } finally {
      setLoading(false);
    }
  }, [teacherId, isHi]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-fill grade when class is selected
  const selectedClassData = classes.find(c => c.id === formClass);
  const autoGrade = selectedClassData?.grade || '9';

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg);
    setToastType(type);
    setTimeout(() => setToast(''), 3000);
  };

  const handleCreateAssignment = async () => {
    if (!formTitle.trim()) {
      showToast(tt(isHi, 'Please enter a title', 'कृपया शीर्षक दर्ज करें'), 'error');
      return;
    }
    if (!formClass) {
      showToast(tt(isHi, 'Please select a class', 'कृपया एक कक्षा चुनें'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      const { error: insertErr } = await supabase.from('assignments').insert({
        teacher_id: teacherId,
        class_id: formClass,
        title: formTitle.trim(),
        subject: formSubject,
        grade: autoGrade,
        chapter: formChapter.trim() || null,
        difficulty: formDifficulty.toLowerCase(),
        question_count: formCount,
        due_date: formDueDate || null,
        type: 'quiz',
      });
      if (insertErr) throw insertErr;
      setShowModal(false);
      resetForm();
      showToast(tt(isHi, 'Assignment created successfully!', 'असाइनमेंट सफलतापूर्वक बनाया गया!'));
      await loadData();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : tt(isHi, 'Failed to create assignment', 'असाइनमेंट बनाने में विफल'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormTitle('');
    setFormClass(preselectedClass);
    setFormSubject('math');
    setFormChapter('');
    setFormDifficulty('Medium');
    setFormCount(10);
    setFormDueDate('');
  };

  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: 'center', padding: 80, color: '#64748B' }}>
          <div style={{ width: 40, height: 40, border: '3px solid #1E293B', borderTopColor: '#F97316', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.8s linear infinite' }} />
          {tt(isHi, 'Loading assignments...', 'असाइनमेंट लोड हो रहे हैं...')}
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #2563EB, #1D4ED8)',
        borderRadius: 16,
        padding: '28px 28px 24px',
        marginBottom: 24,
        marginTop: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <button
              onClick={() => router.push('/teacher')}
              style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 6, padding: '4px 10px', color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              &larr; {tt(isHi, 'Dashboard', 'डैशबोर्ड')}
            </button>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: '#fff', margin: 0 }}>
              <span role="img" aria-label="clipboard">📋</span> {tt(isHi, 'My Assignments', 'मेरे असाइनमेंट')}
            </h1>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', margin: '6px 0 0' }}>
              {tt(isHi, 'Create and manage assignments for your classes', 'अपनी कक्षाओं के लिए असाइनमेंट बनाएं और प्रबंधित करें')}
            </p>
          </div>
          <button
            onClick={() => { resetForm(); setShowModal(true); }}
            style={{
              padding: '10px 18px',
              background: 'rgba(255,255,255,0.15)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            + {tt(isHi, 'New Assignment', 'नया असाइनमेंट')}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ backgroundColor: 'rgba(220,38,38,0.1)', border: '1px solid #DC2626', borderRadius: 10, padding: '12px 16px', marginBottom: 16, color: '#FCA5A5', fontSize: 14 }}>
          {error}
          <button onClick={loadData} style={{ marginLeft: 12, color: '#60A5FA', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>
            {tt(isHi, 'Retry', 'पुनः प्रयास')}
          </button>
        </div>
      )}

      {/* Empty state */}
      {assignments.length === 0 && !error && (
        <div style={{ textAlign: 'center', padding: '60px 20px', backgroundColor: '#0F172A', borderRadius: 16, border: '1px solid #1E293B' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>📋</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#F1F5F9', margin: '0 0 8px' }}>
            {tt(isHi, 'No assignments yet', 'अभी तक कोई असाइनमेंट नहीं')}
          </h2>
          <p style={{ fontSize: 14, color: '#64748B', margin: '0 0 24px', maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
            {tt(isHi, 'Create your first assignment to get started.', 'शुरू करने के लिए अपना पहला असाइनमेंट बनाएं।')}
          </p>
          <button
            onClick={() => { resetForm(); setShowModal(true); }}
            style={{ padding: '12px 28px', background: 'linear-gradient(135deg, #2563EB, #1D4ED8)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
          >
            {tt(isHi, 'Create First Assignment', 'पहला असाइनमेंट बनाएं')}
          </button>
        </div>
      )}

      {/* Assignment cards */}
      {assignments.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {assignments.map((asgn, idx) => {
            const cls = classes.find(c => c.id === asgn.class_id);
            const subj = SUBJECT_META.find(s => s.code === asgn.subject);
            const status = statusBadge(asgn.due_date);
            const pct = completionPct(asgn.assignment_submissions, cls?.student_count ?? 0);

            return (
              <div
                key={asgn.id}
                style={{
                  backgroundColor: '#0F172A',
                  borderRadius: 14,
                  border: '1px solid #1E293B',
                  padding: '18px 20px',
                  animation: `fadeIn 0.3s ease ${idx * 0.05}s both`,
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#2563EB'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(37,99,235,0.1)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#1E293B'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                {/* Top row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: '#F1F5F9', margin: 0, flex: 1, marginRight: 8 }}>{asgn.title}</h3>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 9px',
                    borderRadius: 20,
                    backgroundColor: status.bg,
                    color: status.color,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}>
                    {tt(isHi, status.label, status.labelHi)}
                  </span>
                </div>

                {/* Class + Subject */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {cls && (
                    <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, backgroundColor: '#1E293B', color: '#94A3B8' }}>
                      {cls.name}
                    </span>
                  )}
                  {subj && (
                    <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, backgroundColor: subj.color + '20', color: subj.color }}>
                      {subj.icon} {subj.name}
                    </span>
                  )}
                  <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, backgroundColor: '#1E293B', color: '#64748B', textTransform: 'capitalize' }}>
                    {asgn.difficulty}
                  </span>
                  <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, backgroundColor: '#1E293B', color: '#64748B' }}>
                    {asgn.question_count} {tt(isHi, 'Qs', 'प्रश्न')}
                  </span>
                </div>

                {/* Completion bar */}
                {cls && cls.student_count > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: '#64748B' }}>{tt(isHi, 'Completion', 'पूर्णता')}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: pct >= 70 ? '#059669' : pct >= 40 ? '#D97706' : '#94A3B8' }}>
                        {pct}%
                      </span>
                    </div>
                    <div style={{ height: 5, backgroundColor: '#1E293B', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${pct}%`,
                        borderRadius: 3,
                        background: pct >= 70 ? 'linear-gradient(90deg,#059669,#10B981)' : pct >= 40 ? 'linear-gradient(90deg,#D97706,#F59E0B)' : 'linear-gradient(90deg,#475569,#64748B)',
                        transition: 'width 0.6s ease',
                      }} />
                    </div>
                  </div>
                )}

                {/* Due date */}
                {asgn.due_date && (
                  <p style={{ fontSize: 12, color: '#64748B', margin: 0 }}>
                    {tt(isHi, 'Due', 'देय')}: {new Date(asgn.due_date).toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => { resetForm(); setShowModal(true); }}
        style={{
          position: 'fixed', bottom: 28, right: 28,
          width: 56, height: 56, borderRadius: '50%',
          background: 'linear-gradient(135deg, #2563EB, #1D4ED8)',
          color: '#fff', border: 'none', fontSize: 28, fontWeight: 300,
          cursor: 'pointer', boxShadow: '0 4px 20px rgba(37,99,235,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 50, transition: 'transform 0.2s, box-shadow 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 6px 28px rgba(37,99,235,0.5)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(37,99,235,0.4)'; }}
        title={tt(isHi, 'New Assignment', 'नया असाइनमेंट')}
      >
        +
      </button>

      {/* Create Assignment Modal */}
      {showModal && (
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, animation: 'fadeIn 0.2s ease' }}
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div style={{ backgroundColor: '#0F172A', borderRadius: 16, border: '1px solid #1E293B', padding: '28px 24px', width: '100%', maxWidth: 480, margin: '0 16px', maxHeight: '90vh', overflowY: 'auto', animation: 'fadeIn 0.25s ease' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#F1F5F9', margin: '0 0 20px' }}>
              {tt(isHi, 'New Assignment', 'नया असाइनमेंट')}
            </h2>

            {/* Title */}
            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={labelStyle}>{tt(isHi, 'Title', 'शीर्षक')}</span>
              <input
                type="text"
                placeholder={tt(isHi, 'e.g. Chapter 3 Quiz', 'जैसे अध्याय 3 क्विज़')}
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                style={inputStyle}
              />
            </label>

            {/* Class */}
            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={labelStyle}>{tt(isHi, 'Class', 'कक्षा')}</span>
              <select value={formClass} onChange={e => setFormClass(e.target.value)} style={inputStyle}>
                <option value="">{tt(isHi, '— Select a class —', '— एक कक्षा चुनें —')}</option>
                {classes.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({tt(isHi, 'Grade', 'कक्षा')} {c.grade})</option>
                ))}
              </select>
            </label>

            {/* Subject */}
            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={labelStyle}>{tt(isHi, 'Subject', 'विषय')}</span>
              <select value={formSubject} onChange={e => setFormSubject(e.target.value)} style={inputStyle}>
                {SUBJECT_META.map(s => (
                  <option key={s.code} value={s.code}>{s.icon} {s.name}</option>
                ))}
              </select>
            </label>

            {/* Grade (auto-filled) */}
            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={labelStyle}>{tt(isHi, 'Grade (auto-filled from class)', 'कक्षा (वर्ग से स्वतः भरा)')}</span>
              <select value={autoGrade} disabled style={{ ...inputStyle, opacity: 0.6, cursor: 'default' }}>
                {GRADES.map(g => (
                  <option key={g} value={g}>{tt(isHi, `Grade ${g}`, `कक्षा ${g}`)}</option>
                ))}
              </select>
            </label>

            {/* Chapter */}
            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={labelStyle}>{tt(isHi, 'Chapter (optional)', 'अध्याय (वैकल्पिक)')}</span>
              <input
                type="text"
                placeholder={tt(isHi, 'e.g. Motion and Forces', 'जैसे गति और बल')}
                value={formChapter}
                onChange={e => setFormChapter(e.target.value)}
                style={inputStyle}
              />
            </label>

            {/* Difficulty */}
            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={labelStyle}>{tt(isHi, 'Difficulty', 'कठिनाई')}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                {DIFFICULTIES.map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setFormDifficulty(d)}
                    style={{
                      flex: 1,
                      padding: '9px 0',
                      borderRadius: 8,
                      border: '1px solid',
                      borderColor: formDifficulty === d ? '#2563EB' : '#334155',
                      backgroundColor: formDifficulty === d ? '#1E3A8A' : 'transparent',
                      color: formDifficulty === d ? '#60A5FA' : '#94A3B8',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {d === 'Easy' ? tt(isHi, 'Easy', 'आसान') : d === 'Medium' ? tt(isHi, 'Medium', 'मध्यम') : tt(isHi, 'Hard', 'कठिन')}
                  </button>
                ))}
              </div>
            </label>

            {/* Question count slider */}
            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={labelStyle}>{tt(isHi, `Number of Questions: ${formCount}`, `प्रश्नों की संख्या: ${formCount}`)}</span>
              <input
                type="range"
                min={5}
                max={20}
                step={1}
                value={formCount}
                onChange={e => setFormCount(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#2563EB' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748B', marginTop: 2 }}>
                <span>5</span><span>20</span>
              </div>
            </label>

            {/* Due date */}
            <label style={{ display: 'block', marginBottom: 20 }}>
              <span style={labelStyle}>{tt(isHi, 'Due Date (optional)', 'अंतिम तिथि (वैकल्पिक)')}</span>
              <input
                type="date"
                value={formDueDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={e => setFormDueDate(e.target.value)}
                style={{ ...inputStyle, colorScheme: 'dark' }}
              />
            </label>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowModal(false)}
                style={{ flex: 1, padding: '11px 16px', backgroundColor: 'transparent', color: '#94A3B8', border: '1px solid #334155', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
              >
                {tt(isHi, 'Cancel', 'रद्द करें')}
              </button>
              <button
                onClick={handleCreateAssignment}
                disabled={submitting || !formTitle.trim() || !formClass}
                style={{
                  flex: 1, padding: '11px 16px',
                  background: submitting || !formTitle.trim() || !formClass ? '#334155' : 'linear-gradient(135deg, #2563EB, #1D4ED8)',
                  color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
                  cursor: submitting || !formTitle.trim() || !formClass ? 'default' : 'pointer',
                  opacity: submitting || !formTitle.trim() || !formClass ? 0.5 : 1,
                }}
              >
                {submitting ? tt(isHi, 'Creating...', 'बना रहे हैं...') : tt(isHi, 'Create Assignment', 'असाइनमेंट बनाएं')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 96, left: '50%', transform: 'translateX(-50%)',
          backgroundColor: toastType === 'error' ? '#DC2626' : '#059669',
          color: '#fff', padding: '10px 24px', borderRadius: 10, fontSize: 14, fontWeight: 500,
          zIndex: 200, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', animation: 'fadeIn 0.2s ease', whiteSpace: 'nowrap',
        }}>
          {toast}
        </div>
      )}

      <BottomNav />
    </div>
  );
}
