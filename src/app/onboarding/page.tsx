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
  const { student, isLoggedIn, isLoading, refreshStudent, activeRole, isHi } = useAuth();
  const router = useRouter();

  const [grade, setGrade] = useState('');
  const [board, setBoard] = useState('CBSE');
  const [academicGoal, setAcademicGoal] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const GOAL_OPTIONS = [
    { value: 'board_topper',     label: 'Board Topper (90%+)',       labelHi: 'बोर्ड टॉपर (90%+)',         icon: '🏆' },
    { value: 'school_topper',    label: 'School Topper',             labelHi: 'स्कूल टॉपर',                icon: '🥇' },
    { value: 'pass_comfortably', label: 'Pass Comfortably',          labelHi: 'आराम से पास होना',           icon: '✅' },
    { value: 'competitive_exam', label: 'Crack JEE/NEET',            labelHi: 'JEE/NEET क्रैक करना',       icon: '🎯' },
    { value: 'olympiad',         label: 'Olympiad / Competition',    labelHi: 'ओलंपियाड / प्रतियोगिता',    icon: '🌟' },
    { value: 'improve_basics',   label: 'Improve Basics',            labelHi: 'बेसिक्स सुधारना',            icon: '📚' },
  ];

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.replace('/');
      return;
    }
    if (!isLoading && isLoggedIn) {
      // Redirect non-student roles to their home portal —
      // teachers and parents complete their profile setup there.
      if (activeRole === 'teacher') {
        router.replace('/teacher');
        return;
      }
      if (activeRole === 'guardian') {
        router.replace('/parent');
        return;
      }
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
  }, [isLoading, isLoggedIn, activeRole, student, router]);

  // Show loading while role is being determined or while a redirect is in flight
  if (isLoading) return <LoadingFoxy />;

  // Non-student roles: show a brief redirect indicator while useEffect fires
  if (activeRole === 'teacher' || activeRole === 'guardian') {
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
        <div className="animate-float" style={{ fontSize: 48, marginBottom: 16 }}>🦊</div>
        <p style={{ fontSize: 15, color: 'var(--text-2)', fontWeight: 600 }}>
          {isHi ? 'आपको रीडायरेक्ट किया जा रहा है…' : 'Redirecting you…'}
        </p>
      </div>
    );
  }

  if (!student) return <LoadingFoxy />;
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
          academic_goal: academicGoal || null,
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
      <div style={{ width: '100%', maxWidth: 400, animation: 'slideUp 0.5s ease-out' }}>
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
        <div style={{
          borderRadius: 16, padding: 24,
          background: 'var(--surface-1)', border: '1px solid var(--border)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        }}>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Grade */}
              <div style={{ animation: 'slideUp 0.4s ease-out 0.1s both' }}>
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
                  <option value="" disabled>Select grade...</option>
                  {GRADES.map(g => (
                    <option key={g} value={g}>Grade {g}</option>
                  ))}
                </select>
              </div>

              {/* Board */}
              <div style={{ animation: 'slideUp 0.4s ease-out 0.2s both' }}>
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

              {/* Academic Goal (optional) */}
              <div style={{ animation: 'slideUp 0.4s ease-out 0.3s both' }}>
                <label
                  style={{
                    display: 'block', fontSize: 13, fontWeight: 600,
                    color: 'var(--text-2)', marginBottom: 6,
                  }}
                >
                  {isHi ? 'आपका लक्ष्य क्या है? (वैकल्पिक)' : "What's your goal? (optional)"}
                </label>
                <div
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
                  }}
                >
                  {GOAL_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={academicGoal === opt.value}
                      onClick={() => setAcademicGoal(prev => prev === opt.value ? '' : opt.value)}
                      style={{
                        padding: '10px 8px', borderRadius: 10, textAlign: 'center',
                        border: `2px solid ${academicGoal === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                        background: academicGoal === opt.value ? 'rgba(232,88,28,0.06)' : 'var(--surface-2)',
                        cursor: 'pointer', transition: 'border-color 0.15s ease, background 0.15s ease',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      }}
                    >
                      <span style={{ fontSize: 20 }}>{opt.icon}</span>
                      <span
                        style={{
                          fontSize: 11, fontWeight: 600, lineHeight: 1.3,
                          color: academicGoal === opt.value ? 'var(--accent)' : 'var(--text-2)',
                        }}
                      >
                        {isHi ? opt.labelHi : opt.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Error */}
              {error && (
                <div role="alert" style={{
                  fontSize: 13, color: 'var(--danger)', margin: 0,
                  padding: '8px 12px', borderRadius: 12,
                  background: 'var(--danger-light)',
                  border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)',
                  fontWeight: 600,
                }}>
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={saving || !grade}
                style={{
                  width: '100%', padding: '14px 0', borderRadius: 12,
                  background: grade ? 'linear-gradient(135deg, #E8590C, #F59E0B)' : 'var(--surface-3)',
                  color: grade ? '#fff' : 'var(--text-3)',
                  border: 'none', fontSize: 15, fontWeight: 700,
                  cursor: grade && !saving ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s ease',
                  animation: 'slideUp 0.4s ease-out 0.4s both',
                }}
              >
                {saving ? 'Saving...' : 'Start Learning'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
