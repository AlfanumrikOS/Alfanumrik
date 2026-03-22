'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { SUBJECT_META } from '@/lib/constants';

export default function TeacherProfilePage() {
  const { teacher, isLoggedIn, isLoading: authLoading, activeRole, signOut } = useAuth();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  if (authLoading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}><div style={{ fontSize: 48 }}>👩‍🏫</div></div>;
  if (!isLoggedIn || (activeRole !== 'teacher' && !teacher)) { router.replace('/'); return null; }

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
      setToast('Name must be 2–100 characters'); return;
    }
    if (trimmedSchool && trimmedSchool.length > 200) {
      setToast('School name too long'); return;
    }
    setSaving(true);
    try {
      await supabase.from('teachers').update({
        name: trimmedName,
        school_name: trimmedSchool,
      }).eq('id', teacher.id);
      setToast('Profile updated!');
      setEditing(false);
      setTimeout(() => setToast(''), 3000);
    } catch { setToast('Failed to save'); }
    setSaving(false);
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/');
  };

  const subjectNames = (teacher?.subjects_taught || []).map(
    (code: string) => SUBJECT_META.find(s => s.code === code)?.name || code
  );

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', paddingBottom: 100 }}>
      <div style={{ background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)', padding: '32px 20px 28px', color: '#fff', textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto 12px' }}>
          {teacher?.name?.[0]?.toUpperCase() || '👩‍🏫'}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{teacher?.name || 'Teacher'}</h1>
        <p style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>{teacher?.school_name || 'Alfanumrik Educator'}</p>
      </div>

      {toast && (
        <div style={{ margin: '16px 20px 0', padding: '10px 16px', borderRadius: 10, background: '#D1FAE5', color: '#059669', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
          {toast}
        </div>
      )}

      <div style={{ padding: '20px' }}>
        {!editing ? (
          <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: '#1a1a1a' }}>Profile Details</div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Name</div>
              <div style={{ fontSize: 15, color: '#1a1a1a', fontWeight: 500 }}>{teacher?.name || '—'}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>School</div>
              <div style={{ fontSize: 15, color: '#1a1a1a', fontWeight: 500 }}>{teacher?.school_name || '—'}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Subjects</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {subjectNames.length > 0 ? subjectNames.map((s: string, i: number) => (
                  <span key={i} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, background: '#EFF6FF', color: '#2563EB', fontWeight: 500 }}>{s}</span>
                )) : <span style={{ fontSize: 13, color: '#888' }}>Not set</span>}
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Grades</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(teacher?.grades_taught || []).length > 0 ? (teacher?.grades_taught || []).map((g: string, i: number) => (
                  <span key={i} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, background: '#F0FDF4', color: '#16A34A', fontWeight: 500 }}>Class {g}</span>
                )) : <span style={{ fontSize: 13, color: '#888' }}>Not set</span>}
              </div>
            </div>

            <button onClick={startEdit} style={{ marginTop: 8, padding: '10px 24px', borderRadius: 10, border: '1.5px solid #2563EB', background: '#fff', color: '#2563EB', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Edit Profile
            </button>
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: '#1a1a1a' }}>Edit Profile</div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Name</label>
              <input value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e0e0e0', fontSize: 14, outline: 'none' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>School Name</label>
              <input value={schoolName} onChange={e => setSchoolName(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e0e0e0', fontSize: 14, outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleSave} disabled={saving} style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: '#2563EB', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)} style={{ padding: '10px 24px', borderRadius: 10, border: '1.5px solid #e0e0e0', background: '#fff', color: '#555', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <button onClick={handleSignOut} style={{ marginTop: 20, width: '100%', padding: '12px', borderRadius: 12, border: '1.5px solid #EF4444', background: '#FEF2F2', color: '#EF4444', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Sign Out
        </button>
      </div>
    </div>
  );
}
