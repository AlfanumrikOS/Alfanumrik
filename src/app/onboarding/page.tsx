'use client';

/**
 * /onboarding — Grade & Board Setup
 *
 * Shown to students whose onboarding_completed flag is null/false.
 * This includes:
 *   1. Legacy accounts created before grade/board collection was added.
 *   2. Auto-recovered accounts (AuthContext fallback insert).
 *   3. Accounts where the signup profile insert failed.
 *
 * Pre-fills current grade/board so users just confirm or correct.
 * On submit: updates students table + sets onboarding_completed = true.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { GRADES, BOARDS } from '@/lib/constants';
import { LoadingFoxy } from '@/components/ui';

export default function OnboardingPage() {
  const { student, isLoggedIn, isLoading, refreshStudent } = useAuth();
  const router = useRouter();

  const [grade, setGrade] = useState('');
  const [board, setBoard] = useState('CBSE');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.replace('/');
      return;
    }
    if (!isLoading && student) {
      // Already completed onboarding — skip this page
      if (student.onboarding_completed) {
        router.replace('/dashboard');
        return;
      }
      // Pre-fill with current values if they exist
      const rawGrade = (student.grade ?? '').replace('Grade ', '').trim();
      const validGrades: string[] = Array.from(GRADES);
      setGrade(validGrades.includes(rawGrade) ? rawGrade : '');
      setBoard(student.board ?? 'CBSE');
    }
  }, [isLoading, isLoggedIn, student, router]);

  if (isLoading || !student) return <LoadingFoxy />;
  // Guard: already onboarded — redirect handled in useEffect above
  if (student.onboarding_completed) return <LoadingFoxy />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grade) { setError('Please select your grade'); return; }
    setError('');
    setSaving(true);
    try {
      const { error: updateErr } = await supabase
        .from('students')
        .update({
          grade: `Grade ${grade}`,
          board,
          onboarding_completed: true,
        })
        .eq('id', student.id);

      if (updateErr) {
        setError('Could not save — please try again.');
        setSaving(false);
        return;
      }

      // Refresh auth context so dashboard sees updated grade/board
      await refreshStudent();
      router.replace('/dashboard');
    } catch {
      setError('Connection error. Please try again.');
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 16px', borderRadius: 12,
    border: '1.5px solid var(--border)', background: 'var(--surface-2)',
    fontSize: 15, color: 'var(--text-1)', outline: 'none',
    fontFamily: 'var(--font-body)', appearance: 'none',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  };

  return (
    <div
      className="mesh-bg"
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 400, animation: 'fadeInUp 0.5s ease-out' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div className="animate-float" style={{ fontSize: 48, marginBottom: 12 }}>🦊</div>
          <h1
            style={{
              fontSize: 22, fontWeight: 700, color: 'var(--text-1)',
              marginBottom: 8, fontFamily: 'var(--font-display)',
            }}
          >
            Welcome to Alfanumrik!
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.5 }}>
            Tell us your grade and board so we can show you the right subjects and chapters.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Grade */}
            <div>
              <label
                style={{
                  display: 'block', fontSize: 13, fontWeight: 600,
                  color: 'var(--text-2)', marginBottom: 6,
                }}
              >
                Your Grade
              </label>
              <select
                value={grade}
                onChange={e => setGrade(e.target.value)}
                style={inputStyle}
                required
              >
                <option value="" disabled>Select grade…</option>
                {GRADES.map(g => (
                  <option key={g} value={g}>Grade {g}</option>
                ))}
              </select>
            </div>

            {/* Board */}
            <div>
              <label
                style={{
                  display: 'block', fontSize: 13, fontWeight: 600,
                  color: 'var(--text-2)', marginBottom: 6,
                }}
              >
                Your Board
              </label>
              <select
                value={board}
                onChange={e => setBoard(e.target.value)}
                style={inputStyle}
              >
                {BOARDS.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            {/* Error */}
            {error && (
              <p style={{ fontSize: 13, color: 'var(--danger)', margin: 0 }}>{error}</p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={saving || !grade}
              style={{
                width: '100%', padding: '14px 0', borderRadius: 12,
                background: grade ? 'var(--orange)' : 'var(--surface-3)',
                color: grade ? '#fff' : 'var(--text-3)',
                border: 'none', fontSize: 15, fontWeight: 700,
                cursor: grade && !saving ? 'pointer' : 'not-allowed',
                transition: 'background 0.2s',
              }}
            >
              {saving ? 'Saving...' : 'Start Learning ✨'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
