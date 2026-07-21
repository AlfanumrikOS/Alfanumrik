'use client';

import { useState } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase } from '@alfanumrik/lib/supabase';
import { useTeacherAllowedSubjects } from '@alfanumrik/lib/useTeacherAllowedSubjects';
import { authHeader } from '@alfanumrik/lib/api/auth-header';

const tt = (hi: boolean, en: string, hiText: string) => hi ? hiText : en;

export default function TeacherProfilePage() {
  const { teacher, isLoggedIn, isLoading: authLoading, activeRole, signOut, isHi } = useAuth();
  const { subjects } = useTeacherAllowedSubjects();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  if (authLoading) return <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}><div style={{ fontSize: 48 }}>👩‍🏫</div></div>;
  if (!isLoggedIn || (activeRole !== 'teacher' && !teacher)) { router.replace('/login'); return null; }

  const startEdit = () => {
    setName(teacher?.name || '');
    setSchoolName(teacher?.school_name || '');
    setEditing(true);
  };

  const handleSave = async () => {
    if (!teacher?.id) return;
    const trimmedName = name.trim();
    const trimmedSchool = schoolName.trim();
    if (!trimmedName || trimmedName.length < 2 || trimmedName.length > 100) {
      setToast(tt(isHi, 'Name must be 2–100 characters', 'नाम 2–100 अक्षरों का होना चाहिए')); return;
    }
    if (trimmedSchool && trimmedSchool.length > 200) {
      setToast(tt(isHi, 'School name too long', 'स्कूल का नाम बहुत लंबा है')); return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/teacher/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ name: trimmedName, school_name: trimmedSchool }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setToast(tt(isHi, 'Profile updated!', 'प्रोफ़ाइल अपडेट हो गई!'));
      setEditing(false);
      setTimeout(() => setToast(''), 3000);
    } catch { setToast(tt(isHi, 'Failed to save', 'सहेजने में विफल')); }
    setSaving(false);
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/login');
  };

  const subjectNames = (teacher?.subjects_taught || []).map(
    (code: string) => subjects.find(s => s.code === code)?.name || code
  );

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingBottom: 100 }}>
      <div style={{ background: 'linear-gradient(135deg, #E8581C 0%, #C2410C 100%)', padding: '32px 20px 28px', color: '#fff', position: 'relative' }}>
        <button
          onClick={() => router.push('/teacher')}
          style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 8, padding: '6px 12px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          &larr; {tt(isHi, 'Dashboard', 'डैशबोर्ड')}
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto 12px' }}>
            {teacher?.name?.[0]?.toUpperCase() || '👩‍🏫'}
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{teacher?.name || (isHi ? 'शिक्षक' : 'Teacher')}</h1>
          <p style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>{teacher?.school_name || 'Alfanumrik Educator'}</p>
        </div>
      </div>

      {toast && (
        <div role="alert" style={{ margin: '16px 20px 0', padding: '10px 16px', borderRadius: 10, background: toast.includes('Failed') || toast.includes('must') || toast.includes('too long') ? '#FEE2E2' : '#D1FAE5', color: toast.includes('Failed') || toast.includes('must') || toast.includes('too long') ? '#DC2626' : '#059669', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
          {toast}
        </div>
      )}

      <div style={{ padding: '20px' }}>
        {!editing ? (
          <div style={{ background: '#FFFFFF', borderRadius: 16, padding: 20, border: '1px solid var(--surface-2)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: '#1A1207' }}>{tt(isHi, 'Profile Details', 'प्रोफ़ाइल विवरण')}</div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#7D7264', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{tt(isHi, 'Name', 'नाम')}</div>
              <div style={{ fontSize: 15, color: '#1A1207', fontWeight: 500 }}>{teacher?.name || '—'}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#7D7264', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{tt(isHi, 'School', 'स्कूल')}</div>
              <div style={{ fontSize: 15, color: '#1A1207', fontWeight: 500 }}>{teacher?.school_name || '—'}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#7D7264', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{tt(isHi, 'Subjects', 'विषय')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {subjectNames.length > 0 ? subjectNames.map((s: string, i: number) => (
                  <span key={i} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, background: 'rgba(124,58,237,0.10)', color: '#7C3AED', fontWeight: 500 }}>{s}</span>
                )) : <span style={{ fontSize: 13, color: '#7D7264' }}>{tt(isHi, 'Not set', 'सेट नहीं')}</span>}
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#7D7264', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{tt(isHi, 'Grades', 'कक्षाएँ')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(teacher?.grades_taught || []).length > 0 ? (teacher?.grades_taught || []).map((g: string, i: number) => (
                  <span key={i} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, background: '#F0FDF4', color: '#16A34A', fontWeight: 500 }}>Class {g}</span>
                )) : <span style={{ fontSize: 13, color: '#7D7264' }}>{tt(isHi, 'Not set', 'सेट नहीं')}</span>}
              </div>
            </div>

            <button onClick={startEdit} style={{ marginTop: 8, padding: '10px 24px', borderRadius: 10, border: '1.5px solid #E8581C', background: '#fff', color: '#E8581C', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {tt(isHi, 'Edit Profile', 'प्रोफ़ाइल संपादित करें')}
            </button>
          </div>
        ) : (
          <div style={{ background: '#FFFFFF', borderRadius: 16, padding: 20, border: '1px solid var(--surface-2)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: '#1A1207' }}>{tt(isHi, 'Edit Profile', 'प्रोफ़ाइल संपादित करें')}</div>
            <div style={{ marginBottom: 12 }}>
              <label htmlFor="teacher-name" style={{ fontSize: 12, fontWeight: 600, color: '#7D7264', display: 'block', marginBottom: 4 }}>{tt(isHi, 'Name', 'नाम')}</label>
              <input id="teacher-name" value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--surface-2)', fontSize: 16, outline: 'none' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="teacher-school" style={{ fontSize: 12, fontWeight: 600, color: '#7D7264', display: 'block', marginBottom: 4 }}>{tt(isHi, 'School Name', 'स्कूल का नाम')}</label>
              <input id="teacher-school" value={schoolName} onChange={e => setSchoolName(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--surface-2)', fontSize: 16, outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleSave} disabled={saving} style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: 'var(--orange)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {saving ? tt(isHi, 'Saving...', 'सहेज रहे हैं...') : tt(isHi, 'Save', 'सहेजें')}
              </button>
              <button onClick={() => setEditing(false)} style={{ padding: '10px 24px', borderRadius: 10, border: '1.5px solid var(--surface-2)', background: '#fff', color: '#7D7264', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {tt(isHi, 'Cancel', 'रद्द करें')}
              </button>
            </div>
          </div>
        )}

        {/* Quick links */}
        <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button onClick={() => router.push('/teacher/classes')} style={{ padding: '14px', borderRadius: 12, border: '1px solid var(--surface-2)', background: '#fff', cursor: 'pointer', textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>🏫</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#7D7264' }}>{tt(isHi, 'Classes', 'कक्षाएँ')}</div>
          </button>
          <button onClick={() => router.push('/teacher/reports')} style={{ padding: '14px', borderRadius: 12, border: '1px solid var(--surface-2)', background: '#fff', cursor: 'pointer', textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>📊</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#7D7264' }}>{tt(isHi, 'Reports', 'रिपोर्ट')}</div>
          </button>
        </div>

        <button onClick={handleSignOut} style={{ marginTop: 20, width: '100%', padding: '12px', borderRadius: 12, border: '1.5px solid var(--danger)', background: 'var(--danger-light)', color: 'var(--danger)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          {tt(isHi, 'Sign Out', 'साइन आउट')}
        </button>
      </div>

    </div>
  );
}
