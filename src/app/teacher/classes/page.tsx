'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
// Teacher portal shows the full CBSE subject catalogue regardless of any single
// student's grade/plan. useAllowedSubjects() is student-scoped, so we still
// read the compat shim here until a teacher-scoped subjects service ships.
// eslint-disable-next-line alfanumrik/no-raw-subject-imports
import { SUBJECT_META } from '@/lib/constants';
import { VALID_GRADES } from '@/lib/identity';
import { BottomNav } from '@/components/ui';

// ============================================================
// BILINGUAL HELPERS (P7)
// ============================================================
const tt = (isHi: boolean, en: string, hi: string) => isHi ? hi : en;

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

interface ClassData {
  id: string;
  name: string;
  grade: string;
  section?: string;
  subject?: string;
  student_count: number;
  class_code: string;
  average_mastery: number;
  students?: { id: string; name: string; xp: number; mastery: number }[];
  assignments?: { id: string; title: string; type: string; due_date?: string }[];
  last_activity?: string;
}

const SECTIONS = ['', 'A', 'B', 'C', 'D', 'E'];
const GRADES = VALID_GRADES;

const AVATAR_COLORS = ['#6366F1', '#2563EB', '#0891B2', '#059669', '#D97706', '#DC2626'];

const pageStyle: React.CSSProperties = {
  maxWidth: 1100,
  margin: '0 auto',
  padding: '0 16px 100px',
  fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif",
  color: '#E2E8F0',
  backgroundColor: '#0B1120',
  minHeight: '100vh',
};

export default function TeacherClassesPage() {
  const { teacher, isLoading: authLoading, isLoggedIn, activeRole, isHi } = useAuth();
  const router = useRouter();

  const [classes, setClasses] = useState<ClassData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  // Create class form
  const [formName, setFormName] = useState('');
  const [formGrade, setFormGrade] = useState('9');
  const [formSection, setFormSection] = useState('');
  const [formSubject, setFormSubject] = useState('math');
  const [creating, setCreating] = useState(false);

  // Edit class state
  const [editingClass, setEditingClass] = useState<ClassData | null>(null);
  const [editName, setEditName] = useState('');
  const [editSection, setEditSection] = useState('');
  const [saving, setSaving] = useState(false);

  // Archive confirm state
  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);

  const teacherId = teacher?.id || '';

  // Auth guard
  useEffect(() => {
    if (!authLoading && (!isLoggedIn || (activeRole !== 'teacher' && !teacher))) {
      router.replace('/login');
    }
  }, [authLoading, isLoggedIn, activeRole, teacher, router]);

  const loadClasses = useCallback(async () => {
    if (!teacherId) return;
    setLoading(true);
    setError('');
    try {
      const d = await api('get_dashboard', { teacher_id: teacherId });
      setClasses(d?.classes || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load classes');
    } finally {
      setLoading(false);
    }
  }, [teacherId]);

  useEffect(() => { loadClasses(); }, [loadClasses]);

  const handleCreateClass = async () => {
    const name = formName.trim();
    if (!name) return;
    if (name.length < 2 || name.length > 100) {
      showToast(tt(isHi, 'Class name must be 2–100 characters', 'कक्षा का नाम 2–100 अक्षरों का होना चाहिए'));
      return;
    }
    if (!/^[a-zA-Z0-9\s\-_().]+$/.test(name)) {
      showToast(tt(isHi, 'Class name contains invalid characters', 'कक्षा के नाम में अमान्य अक्षर हैं'));
      return;
    }
    setCreating(true);
    try {
      await supabase.rpc('teacher_create_class', {
        p_teacher_id: teacherId,
        p_name: formName.trim(),
        p_grade: formGrade,
        p_section: formSection || null,
        p_subject: formSubject,
      });
      setShowModal(false);
      setFormName('');
      setFormGrade('9');
      setFormSection('');
      setFormSubject('math');
      showToast(tt(isHi, 'Class created successfully!', 'कक्षा सफलतापूर्वक बनाई गई!'));
      await loadClasses();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to create class');
    } finally {
      setCreating(false);
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const copyClassCode = (code: string, classId: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedId(classId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const openEdit = (cls: ClassData) => {
    setEditingClass(cls);
    setEditName(cls.name);
    setEditSection(cls.section || '');
  };

  const handleSaveEdit = async () => {
    if (!editingClass) return;
    const name = editName.trim();
    if (!name || name.length < 2) {
      showToast(tt(isHi, 'Class name must be at least 2 characters', 'कक्षा का नाम कम से कम 2 अक्षरों का होना चाहिए'));
      return;
    }
    if (!/^[a-zA-Z0-9\s\-_().]+$/.test(name)) {
      showToast(tt(isHi, 'Class name contains invalid characters', 'कक्षा के नाम में अमान्य अक्षर हैं'));
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('classes')
        .update({ name, section: editSection || null, updated_at: new Date().toISOString() })
        .eq('id', editingClass.id);
      if (error) throw error;
      setClasses(prev => prev.map(c => c.id === editingClass.id ? { ...c, name, section: editSection || undefined } : c));
      setEditingClass(null);
      showToast(tt(isHi, 'Class updated!', 'कक्षा अपडेट की गई!'));
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : tt(isHi, 'Failed to update class', 'कक्षा अपडेट करने में विफल'));
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (classId: string) => {
    try {
      const { error } = await supabase
        .from('classes')
        .update({ is_active: false })
        .eq('id', classId);
      if (error) throw error;
      setClasses(prev => prev.filter(c => c.id !== classId));
      setArchiveConfirmId(null);
      showToast(tt(isHi, 'Class archived', 'कक्षा संग्रहीत की गई'));
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : tt(isHi, 'Failed to archive class', 'कक्षा संग्रहीत करने में विफल'));
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const formatTime = (ts?: string) => {
    if (!ts) return tt(isHi, 'No activity yet', 'अभी तक कोई गतिविधि नहीं');
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return tt(isHi, 'Just now', 'अभी');
    if (mins < 60) return tt(isHi, `${mins}m ago`, `${mins} मि. पहले`);
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return tt(isHi, `${hrs}h ago`, `${hrs} घं. पहले`);
    const days = Math.floor(hrs / 24);
    return tt(isHi, `${days}d ago`, `${days} दिन पहले`);
  };

  const getSubjectMeta = (code?: string) => SUBJECT_META.find(s => s.code === code);

  // Loading state
  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: 'center', padding: 80, color: '#64748B' }}>
          <div style={{ width: 40, height: 40, border: '3px solid #1E293B', borderTopColor: '#2563EB', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.8s linear infinite' }} />
          {tt(isHi, 'Loading classes...', 'कक्षाएं लोड हो रही हैं...')}
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
        @keyframes copyPop{0%{transform:scale(1)}50%{transform:scale(1.2)}100%{transform:scale(1)}}
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
              &larr; {tt(isHi, 'डैशबोर्ड', 'Dashboard')}
            </button>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: '#fff', margin: 0 }}>
              <span role="img" aria-label="school">🏫</span> {tt(isHi, 'My Classes', 'मेरी कक्षाएं')}
            </h1>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', margin: '6px 0 0' }}>
              {tt(isHi, 'Manage your classes, students, and assignments', 'अपनी कक्षाओं, छात्रों और असाइनमेंट का प्रबंधन करें')}
            </p>
          </div>
          <button
            onClick={loadClasses}
            style={{
              padding: '8px 18px',
              background: 'rgba(255,255,255,0.15)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
            }}
          >
            {tt(isHi, 'Refresh', 'रिफ्रेश')}
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div style={{
          backgroundColor: 'rgba(220,38,38,0.1)',
          border: '1px solid #DC2626',
          borderRadius: 10,
          padding: '12px 16px',
          marginBottom: 16,
          color: '#FCA5A5',
          fontSize: 14,
        }}>
          {error}
          <button onClick={loadClasses} style={{ marginLeft: 12, color: '#60A5FA', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>
            {tt(isHi, 'Retry', 'पुनः प्रयास')}
          </button>
        </div>
      )}

      {/* Empty state */}
      {classes.length === 0 && !error && (
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          backgroundColor: '#0F172A',
          borderRadius: 16,
          border: '1px solid #1E293B',
        }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🏫</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#F1F5F9', margin: '0 0 8px' }}>
            {tt(isHi, 'You haven\'t created any classes yet', 'आपने अभी तक कोई कक्षा नहीं बनाई')}
          </h2>
          <p style={{ fontSize: 15, color: '#64748B', margin: '0 0 24px', maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
            {tt(isHi, 'Create your first class and share the class code with your students so they can join.', 'अपनी पहली कक्षा बनाएं और छात्रों के साथ कक्षा कोड साझा करें ताकि वे जुड़ सकें।')}
          </p>
          <button
            onClick={() => setShowModal(true)}
            style={{
              padding: '12px 28px',
              background: 'linear-gradient(135deg, #2563EB, #1D4ED8)',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {tt(isHi, 'Create Your First Class', 'अपनी पहली कक्षा बनाएं')}
          </button>
        </div>
      )}

      {/* Class cards grid */}
      {classes.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 16,
        }}>
          {classes.map((cls, idx) => {
            const subj = getSubjectMeta(cls.subject);
            const isExpanded = expandedId === cls.id;
            const isCopied = copiedId === cls.id;

            return (
              <div
                key={cls.id}
                style={{
                  backgroundColor: '#0F172A',
                  borderRadius: 14,
                  border: '1px solid #1E293B',
                  overflow: 'hidden',
                  animation: `fadeIn 0.3s ease ${idx * 0.05}s both`,
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                  gridColumn: isExpanded ? '1 / -1' : undefined,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#2563EB';
                  e.currentTarget.style.boxShadow = '0 4px 24px rgba(37,99,235,0.12)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#1E293B';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                {/* Card header */}
                <div style={{ padding: '18px 20px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {subj && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            backgroundColor: subj.color + '20',
                            fontSize: 16,
                          }}>
                            {subj.icon}
                          </span>
                        )}
                        <h3 style={{ fontSize: 17, fontWeight: 600, color: '#F1F5F9', margin: 0 }}>
                          {cls.name}
                        </h3>
                      </div>
                      <p style={{ fontSize: 13, color: '#64748B', margin: '4px 0 0' }}>
                        {tt(isHi, 'Grade', 'कक्षा')} {cls.grade}{cls.section ? ` - ${tt(isHi, 'Section', 'सेक्शन')} ${cls.section}` : ''}
                        {subj ? ` · ${subj.name}` : ''}
                      </p>
                    </div>
                    <span style={{ fontSize: 11, color: '#64748B', whiteSpace: 'nowrap' }}>
                      {formatTime(cls.last_activity)}
                    </span>
                  </div>

                  {/* Student count with avatar stack */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
                    <div style={{ display: 'flex', marginRight: 2 }}>
                      {[0, 1, 2].map(i => (
                        <div key={i} style={{
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length],
                          border: '2px solid #0F172A',
                          marginLeft: i > 0 ? -8 : 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          fontWeight: 700,
                          color: '#fff',
                          opacity: cls.student_count > i ? 1 : 0.25,
                        }}>
                          {cls.student_count > i ? String.fromCharCode(65 + i) : ''}
                        </div>
                      ))}
                    </div>
                    <span style={{ fontSize: 13, color: '#94A3B8', fontWeight: 500 }}>
                      {cls.student_count} {tt(isHi, cls.student_count !== 1 ? 'students' : 'student', 'छात्र')}
                    </span>
                  </div>

                  {/* Average mastery bar */}
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: '#64748B' }}>{tt(isHi, 'Average Mastery', 'औसत मास्टरी')}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: cls.average_mastery >= 70 ? '#059669' : cls.average_mastery >= 40 ? '#D97706' : '#94A3B8' }}>
                        {cls.average_mastery ?? 0}%
                      </span>
                    </div>
                    <div style={{ height: 6, backgroundColor: '#1E293B', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(cls.average_mastery ?? 0, 100)}%`,
                        borderRadius: 3,
                        background: cls.average_mastery >= 70
                          ? 'linear-gradient(90deg, #059669, #10B981)'
                          : cls.average_mastery >= 40
                            ? 'linear-gradient(90deg, #D97706, #F59E0B)'
                            : 'linear-gradient(90deg, #475569, #64748B)',
                        transition: 'width 0.6s ease',
                      }} />
                    </div>
                  </div>

                  {/* Class code */}
                  <div style={{
                    marginTop: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: '#1E293B',
                    borderRadius: 8,
                    padding: '8px 12px',
                  }}>
                    <div>
                      <span style={{ fontSize: 11, color: '#64748B', display: 'block' }}>{tt(isHi, 'Class Code', 'कक्षा कोड')}</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: '#60A5FA', fontFamily: 'monospace', letterSpacing: 1.5 }}>
                        {cls.class_code}
                      </span>
                    </div>
                    <button
                      onClick={() => copyClassCode(cls.class_code, cls.id)}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: isCopied ? '#059669' : '#2563EB',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'background-color 0.2s, transform 0.15s',
                        animation: isCopied ? 'copyPop 0.3s ease' : undefined,
                      }}
                    >
                      {isCopied ? tt(isHi, 'Copied!', 'कॉपी हो गया!') : tt(isHi, 'Copy', 'कॉपी')}
                    </button>
                  </div>

                  {/* Quick actions */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => toggleExpand(cls.id)}
                      style={{
                        padding: '7px 14px',
                        backgroundColor: isExpanded ? '#2563EB' : 'transparent',
                        color: isExpanded ? '#fff' : '#60A5FA',
                        border: '1px solid #2563EB',
                        borderRadius: 7,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      {isExpanded ? tt(isHi, 'Collapse', 'छोटा करें') : tt(isHi, 'View Students', 'छात्र देखें')}
                    </button>
                    <button
                      onClick={() => router.push(`/teacher/assignments?class=${cls.id}`)}
                      style={{
                        padding: '7px 14px',
                        backgroundColor: 'transparent',
                        color: '#60A5FA',
                        border: '1px solid #334155',
                        borderRadius: 7,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      {tt(isHi, 'Create Assignment', 'असाइनमेंट बनाएं')}
                    </button>
                    <button
                      onClick={() => router.push(`/teacher/reports?class=${cls.id}`)}
                      style={{
                        padding: '7px 14px',
                        backgroundColor: 'transparent',
                        color: '#60A5FA',
                        border: '1px solid #334155',
                        borderRadius: 7,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      {tt(isHi, 'View Reports', 'रिपोर्ट देखें')}
                    </button>
                    <button
                      onClick={() => openEdit(cls)}
                      style={{
                        padding: '7px 12px',
                        backgroundColor: 'transparent',
                        color: '#A78BFA',
                        border: '1px solid #4C1D95',
                        borderRadius: 7,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      ✏️ {tt(isHi, 'Edit', 'संपादित करें')}
                    </button>
                    <button
                      onClick={() => setArchiveConfirmId(cls.id)}
                      style={{
                        padding: '7px 12px',
                        backgroundColor: 'transparent',
                        color: '#F59E0B',
                        border: '1px solid #78350F',
                        borderRadius: 7,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      📦 {tt(isHi, 'Archive', 'संग्रहीत करें')}
                    </button>
                  </div>

                  {/* Archive confirm inline overlay */}
                  {archiveConfirmId === cls.id && (
                    <div style={{
                      marginTop: 12,
                      backgroundColor: '#1C0A00',
                      border: '1px solid #78350F',
                      borderRadius: 10,
                      padding: '14px 16px',
                      animation: 'fadeIn 0.2s ease',
                    }}>
                      <p style={{ fontSize: 13, color: '#FCD34D', margin: '0 0 12px', fontWeight: 500 }}>
                        {tt(isHi, 'Are you sure? This will hide the class from your dashboard.', 'क्या आप निश्चित हैं? यह कक्षा आपके डैशबोर्ड से छुप जाएगी।')}
                      </p>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => setArchiveConfirmId(null)}
                          style={{ flex: 1, padding: '8px 12px', backgroundColor: 'transparent', color: '#94A3B8', border: '1px solid #334155', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                        >
                          {tt(isHi, 'Cancel', 'रद्द करें')}
                        </button>
                        <button
                          onClick={() => handleArchive(cls.id)}
                          style={{ flex: 1, padding: '8px 12px', backgroundColor: '#DC2626', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                        >
                          {tt(isHi, 'Archive', 'संग्रहीत करें')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Expanded detail view */}
                {isExpanded && (
                  <div style={{
                    borderTop: '1px solid #1E293B',
                    padding: '16px 20px',
                    backgroundColor: '#0B1120',
                    animation: 'fadeIn 0.25s ease',
                  }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                      {/* Students list */}
                      <div>
                        <h4 style={{ fontSize: 14, fontWeight: 600, color: '#F1F5F9', margin: '0 0 10px' }}>
                          {tt(isHi, 'Students', 'छात्र')} ({cls.student_count})
                        </h4>
                        {(!cls.students || cls.students.length === 0) ? (
                          <p style={{ fontSize: 13, color: '#64748B', fontStyle: 'italic' }}>
                            {tt(isHi, 'No students have joined yet. Share the class code.', 'अभी तक कोई छात्र नहीं जुड़ा। कक्षा कोड साझा करें।')}
                          </p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                            {cls.students.map((s) => (
                              <div key={s.id} style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '8px 10px',
                                backgroundColor: '#1E293B',
                                borderRadius: 8,
                                fontSize: 13,
                              }}>
                                <span style={{ color: '#E2E8F0', fontWeight: 500 }}>{s.name}</span>
                                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                  <span style={{ color: '#F59E0B', fontSize: 12, fontWeight: 600 }}>{s.xp} XP</span>
                                  <span style={{ color: '#60A5FA', fontSize: 12, fontWeight: 600 }}>{s.mastery}%</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Assignments list */}
                      <div>
                        <h4 style={{ fontSize: 14, fontWeight: 600, color: '#F1F5F9', margin: '0 0 10px' }}>
                          {tt(isHi, 'Assignments', 'असाइनमेंट')}
                        </h4>
                        {(!cls.assignments || cls.assignments.length === 0) ? (
                          <p style={{ fontSize: 13, color: '#64748B', fontStyle: 'italic' }}>
                            {tt(isHi, 'No assignments created for this class.', 'इस कक्षा के लिए कोई असाइनमेंट नहीं बनाया गया।')}
                          </p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                            {cls.assignments.map((a) => (
                              <div key={a.id} style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '8px 10px',
                                backgroundColor: '#1E293B',
                                borderRadius: 8,
                                fontSize: 13,
                              }}>
                                <span style={{ color: '#E2E8F0', fontWeight: 500 }}>{a.title}</span>
                                <span style={{
                                  fontSize: 11,
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                  backgroundColor: '#334155',
                                  color: '#94A3B8',
                                  fontWeight: 500,
                                  textTransform: 'capitalize' as const,
                                }}>
                                  {a.type}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Share class code button */}
                    <div style={{ marginTop: 16, textAlign: 'center' }}>
                      <button
                        onClick={() => copyClassCode(cls.class_code, cls.id)}
                        style={{
                          padding: '10px 24px',
                          background: 'linear-gradient(135deg, #2563EB, #1D4ED8)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 8,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {isCopied ? tt(isHi, 'Copied!', 'कॉपी हो गया!') : tt(isHi, `Share Class Code: ${cls.class_code}`, `कक्षा कोड साझा करें: ${cls.class_code}`)}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Action Button */}
      <button
        onClick={() => setShowModal(true)}
        style={{
          position: 'fixed',
          bottom: 28,
          right: 28,
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #2563EB, #1D4ED8)',
          color: '#fff',
          border: 'none',
          fontSize: 28,
          fontWeight: 300,
          cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(37,99,235,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50,
          transition: 'transform 0.2s, box-shadow 0.2s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.1)';
          e.currentTarget.style.boxShadow = '0 6px 28px rgba(37,99,235,0.5)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 4px 20px rgba(37,99,235,0.4)';
        }}
        title={tt(isHi, 'Create New Class', 'नई कक्षा बनाएं')}
      >
        +
      </button>

      {/* Edit Class Modal */}
      {editingClass && (
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, animation: 'fadeIn 0.2s ease' }}
          onClick={e => { if (e.target === e.currentTarget) setEditingClass(null); }}
        >
          <div style={{ backgroundColor: '#0F172A', borderRadius: 16, border: '1px solid #1E293B', padding: '28px 24px', width: '100%', maxWidth: 440, margin: '0 16px', animation: 'fadeIn 0.25s ease' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#F1F5F9', margin: '0 0 20px' }}>
              {tt(isHi, 'Edit Class', 'कक्षा संपादित करें')}
            </h2>

            {/* Name */}
            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: '#94A3B8', display: 'block', marginBottom: 4 }}>{tt(isHi, 'Class Name', 'कक्षा का नाम')}</span>
              <input
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: 8, color: '#E2E8F0', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
            </label>

            {/* Section */}
            <label style={{ display: 'block', marginBottom: 20 }}>
              <span style={{ fontSize: 13, color: '#94A3B8', display: 'block', marginBottom: 4 }}>{tt(isHi, 'Section', 'सेक्शन')}</span>
              <select
                value={editSection}
                onChange={e => setEditSection(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: 8, color: '#E2E8F0', fontSize: 14, outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}
              >
                {SECTIONS.map(s => (
                  <option key={s} value={s}>{s || tt(isHi, '— None —', '— कोई नहीं —')}</option>
                ))}
              </select>
            </label>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setEditingClass(null)}
                style={{ flex: 1, padding: '11px 16px', backgroundColor: 'transparent', color: '#94A3B8', border: '1px solid #334155', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
              >
                {tt(isHi, 'Cancel', 'रद्द करें')}
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving || !editName.trim()}
                style={{
                  flex: 1, padding: '11px 16px',
                  background: saving || !editName.trim() ? '#334155' : 'linear-gradient(135deg, #7C3AED, #6D28D9)',
                  color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
                  cursor: saving || !editName.trim() ? 'default' : 'pointer',
                  opacity: saving || !editName.trim() ? 0.5 : 1,
                }}
              >
                {saving ? tt(isHi, 'Saving...', 'सहेज रहे हैं...') : tt(isHi, 'Save Changes', 'बदलाव सहेजें')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Class Modal */}
      {showModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            animation: 'fadeIn 0.2s ease',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div style={{
            backgroundColor: '#0F172A',
            borderRadius: 16,
            border: '1px solid #1E293B',
            padding: '28px 24px',
            width: '100%',
            maxWidth: 440,
            margin: '0 16px',
            animation: 'fadeIn 0.25s ease',
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#F1F5F9', margin: '0 0 20px' }}>
              {tt(isHi, 'Create New Class', 'नई कक्षा बनाएं')}
            </h2>

            {/* Class Name */}
            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: '#94A3B8', display: 'block', marginBottom: 4 }}>{tt(isHi, 'Class Name', 'कक्षा का नाम')}</span>
              <input
                type="text"
                placeholder={tt(isHi, 'e.g. 10-A Science', 'जैसे 10-A विज्ञान')}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  color: '#E2E8F0',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </label>

            {/* Grade */}
            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: '#94A3B8', display: 'block', marginBottom: 4 }}>{tt(isHi, 'Grade', 'कक्षा')}</span>
              <select
                value={formGrade}
                onChange={(e) => setFormGrade(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  color: '#E2E8F0',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                  cursor: 'pointer',
                }}
              >
                {GRADES.map(g => (
                  <option key={g} value={g}>{tt(isHi, `Grade ${g}`, `कक्षा ${g}`)}</option>
                ))}
              </select>
            </label>

            {/* Section */}
            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: '#94A3B8', display: 'block', marginBottom: 4 }}>{tt(isHi, 'Section (optional)', 'सेक्शन (वैकल्पिक)')}</span>
              <select
                value={formSection}
                onChange={(e) => setFormSection(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  color: '#E2E8F0',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                  cursor: 'pointer',
                }}
              >
                {SECTIONS.map(s => (
                  <option key={s} value={s}>{s || tt(isHi, '— None —', '— कोई नहीं —')}</option>
                ))}
              </select>
            </label>

            {/* Subject */}
            <label style={{ display: 'block', marginBottom: 20 }}>
              <span style={{ fontSize: 13, color: '#94A3B8', display: 'block', marginBottom: 4 }}>{tt(isHi, 'Subject', 'विषय')}</span>
              <select
                value={formSubject}
                onChange={(e) => setFormSubject(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  color: '#E2E8F0',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                  cursor: 'pointer',
                }}
              >
                {SUBJECT_META.map(s => (
                  <option key={s.code} value={s.code}>{s.icon} {s.name}</option>
                ))}
              </select>
            </label>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  flex: 1,
                  padding: '11px 16px',
                  backgroundColor: 'transparent',
                  color: '#94A3B8',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {tt(isHi, 'Cancel', 'रद्द करें')}
              </button>
              <button
                onClick={handleCreateClass}
                disabled={creating || !formName.trim()}
                style={{
                  flex: 1,
                  padding: '11px 16px',
                  background: creating || !formName.trim()
                    ? '#334155'
                    : 'linear-gradient(135deg, #2563EB, #1D4ED8)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: creating || !formName.trim() ? 'default' : 'pointer',
                  opacity: creating || !formName.trim() ? 0.5 : 1,
                }}
              >
                {creating ? tt(isHi, 'Creating...', 'बना रहे हैं...') : tt(isHi, 'Create Class', 'कक्षा बनाएं')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 96,
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: toast.includes('Failed') || toast.includes('error') ? '#DC2626' : '#059669',
          color: '#fff',
          padding: '10px 24px',
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 500,
          zIndex: 200,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          animation: 'fadeIn 0.2s ease',
          whiteSpace: 'nowrap',
        }}>
          {toast}
        </div>
      )}
      <BottomNav />
    </div>
  );
}
