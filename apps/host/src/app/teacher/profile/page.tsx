'use client';

import { useState } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { useTeacherAllowedSubjects } from '@alfanumrik/lib/useTeacherAllowedSubjects';
import { authHeader } from '@alfanumrik/lib/api/auth-header';
import {
  Card,
  Button,
  Field,
  Input,
  Badge,
  Alert,
} from '@alfanumrik/ui/ui/primitives';

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

  if (authLoading) return (
    <div className="min-h-dvh flex items-center justify-center bg-surface-2">
      <div className="text-5xl" role="img" aria-label="Teacher">👩‍🏫</div>
    </div>
  );
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

  const toastIsError =
    toast.includes('Failed') || toast.includes('must') || toast.includes('too long') ||
    toast.includes('विफल') || toast.includes('होना चाहिए') || toast.includes('लंबा');

  return (
    <div className="min-h-dvh bg-surface-2 pb-nav">
      {/* Branded header */}
      <div className="relative bg-surface-accent text-on-surface-accent px-5 pt-8 pb-7">
        <button
          onClick={() => router.push('/teacher')}
          className="absolute top-4 left-4 min-h-[44px] rounded-lg px-3 py-1.5 text-[13px] font-semibold text-on-surface-accent transition-colors"
          style={{ background: 'color-mix(in srgb, var(--surface-1) 20%, transparent)' }}
        >
          &larr; {tt(isHi, 'Dashboard', 'डैशबोर्ड')}
        </button>
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-[72px] w-[72px] items-center justify-center rounded-full text-4xl" style={{ background: 'color-mix(in srgb, var(--surface-1) 20%, transparent)' }}>
            {teacher?.name?.[0]?.toUpperCase() || '👩‍🏫'}
          </div>
          <h1 className="text-[22px] font-bold m-0">{teacher?.name || (isHi ? 'शिक्षक' : 'Teacher')}</h1>
          <p className="text-[13px] opacity-80 mt-1">{teacher?.school_name || 'Alfanumrik Educator'}</p>
        </div>
      </div>

      {toast && (
        <div className="mx-5 mt-4">
          <Alert tone={toastIsError ? 'danger' : 'success'}>{toast}</Alert>
        </div>
      )}

      <div className="p-5">
        {!editing ? (
          <Card className="p-5">
            <div className="text-[15px] font-bold mb-4 text-foreground">{tt(isHi, 'Profile Details', 'प्रोफ़ाइल विवरण')}</div>

            <div className="mb-3.5">
              <div className="text-[12px] text-muted-foreground font-semibold uppercase mb-1">{tt(isHi, 'Name', 'नाम')}</div>
              <div className="text-[15px] text-foreground font-medium">{teacher?.name || '—'}</div>
            </div>
            <div className="mb-3.5">
              <div className="text-[12px] text-muted-foreground font-semibold uppercase mb-1">{tt(isHi, 'School', 'स्कूल')}</div>
              <div className="text-[15px] text-foreground font-medium">{teacher?.school_name || '—'}</div>
            </div>
            <div className="mb-3.5">
              <div className="text-[12px] text-muted-foreground font-semibold uppercase mb-1">{tt(isHi, 'Subjects', 'विषय')}</div>
              <div className="flex gap-1.5 flex-wrap">
                {subjectNames.length > 0 ? subjectNames.map((s: string, i: number) => (
                  <Badge key={i} tone="info" variant="soft">{s}</Badge>
                )) : <span className="text-[13px] text-muted-foreground">{tt(isHi, 'Not set', 'सेट नहीं')}</span>}
              </div>
            </div>
            <div className="mb-3.5">
              <div className="text-[12px] text-muted-foreground font-semibold uppercase mb-1">{tt(isHi, 'Grades', 'कक्षाएँ')}</div>
              <div className="flex gap-1.5 flex-wrap">
                {(teacher?.grades_taught || []).length > 0 ? (teacher?.grades_taught || []).map((g: string, i: number) => (
                  <Badge key={i} tone="success" variant="soft">Class {g}</Badge>
                )) : <span className="text-[13px] text-muted-foreground">{tt(isHi, 'Not set', 'सेट नहीं')}</span>}
              </div>
            </div>

            <Button variant="secondary" size="sm" onClick={startEdit} className="mt-2">
              {tt(isHi, 'Edit Profile', 'प्रोफ़ाइल संपादित करें')}
            </Button>
          </Card>
        ) : (
          <Card className="p-5">
            <div className="text-[15px] font-bold mb-4 text-foreground">{tt(isHi, 'Edit Profile', 'प्रोफ़ाइल संपादित करें')}</div>
            <Field label={tt(isHi, 'Name', 'नाम')} htmlFor="teacher-name" className="mb-3">
              <Input id="teacher-name" value={name} onChange={e => setName(e.target.value)} />
            </Field>
            <Field label={tt(isHi, 'School Name', 'स्कूल का नाम')} htmlFor="teacher-school" className="mb-4">
              <Input id="teacher-school" value={schoolName} onChange={e => setSchoolName(e.target.value)} />
            </Field>
            <div className="flex gap-2.5">
              <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
                {saving ? tt(isHi, 'Saving...', 'सहेज रहे हैं...') : tt(isHi, 'Save', 'सहेजें')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                {tt(isHi, 'Cancel', 'रद्द करें')}
              </Button>
            </div>
          </Card>
        )}

        {/* Quick links */}
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button onClick={() => router.push('/teacher/classes')} className="min-h-[44px] rounded-xl border border-surface-3 bg-surface-1 p-3.5 text-center cursor-pointer hover:border-primary transition-colors">
            <div className="text-2xl mb-1">🏫</div>
            <div className="text-[12px] font-semibold text-foreground">{tt(isHi, 'Classes', 'कक्षाएँ')}</div>
          </button>
          <button onClick={() => router.push('/teacher/reports')} className="min-h-[44px] rounded-xl border border-surface-3 bg-surface-1 p-3.5 text-center cursor-pointer hover:border-primary transition-colors">
            <div className="text-2xl mb-1">📊</div>
            <div className="text-[12px] font-semibold text-foreground">{tt(isHi, 'Reports', 'रिपोर्ट')}</div>
          </button>
        </div>

        <Button variant="danger" fullWidth onClick={handleSignOut} className="mt-5">
          {tt(isHi, 'Sign Out', 'साइन आउट')}
        </Button>
      </div>
    </div>
  );
}
