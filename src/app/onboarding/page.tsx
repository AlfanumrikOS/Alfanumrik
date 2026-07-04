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
import { Field, Select, Chip, Button, Alert } from '@/components/ui/primitives';
import { track } from '@/lib/analytics';

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
      router.replace('/login');
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
      <div className="mesh-bg flex min-h-dvh flex-col items-center justify-center px-4 py-6">
        <div className="animate-float mb-4 text-5xl" aria-hidden="true">🦊</div>
        <p className="text-fluid-sm font-semibold" style={{ color: 'var(--text-2)' }}>
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
    if (!grade) { setError(isHi ? 'कृपया अपनी कक्षा चुनें' : 'Please select your grade'); return; }
    setError('');
    setSaving(true);
    try {
      const { error: updateErr } = await supabase
        .from('students')
        .update({
          // P5: grades are bare strings "6".."12" (e.g. "9"), never prefixed.
          // `grade` is already a validated bare string from GRADES (see useEffect
          // pre-fill at line ~67). Writing the canonical bare form keeps this
          // direct client write consistent with the server bootstrap path and
          // every reader: TS consumers parseInt(student.grade) / compare
          // (grade === '11') / interpolate (Class {grade}); the SQL side coerces
          // via normalize_grade(). The "Grade N" form broke all three.
          grade,
          board,
          academic_goal: academicGoal || null,
          onboarding_completed: true,
        })
        .eq('id', student.id);

      if (updateErr) {
        setError(isHi ? 'सहेज नहीं सका — कृपया फिर से प्रयास करें।' : 'Could not save — please try again.');
        setSaving(false);
        return;
      }

      // Analytics: F16 — see audit 2026-04-27.
      // Fires once per student when they complete grade/board setup. Non-student
      // roles short-circuit to their own portals before reaching this submit.
      try {
        track('onboarding_complete', {
          role: 'student',
          grade,
          board,
        });
      } catch { /* analytics is non-critical */ }

      // Refresh auth context so diagnostic sees updated grade/board
      await refreshStudent();
      // Send new students straight to the diagnostic so they have a
      // personalised plan before seeing an empty dashboard (activation fix).
      // Diagnostic only supports grades 6–10; grades 11–12 go straight to
      // the dashboard where the learner loop surfaces appropriate content.
      const diagnosticGrades = ['6', '7', '8', '9', '10'];
      if (diagnosticGrades.includes(grade)) {
        router.replace('/diagnostic?ref=onboarding');
      } else {
        router.replace('/dashboard');
      }
    } catch {
      setError(isHi ? 'कनेक्शन में समस्या। कृपया फिर से प्रयास करें।' : 'Connection error. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="mesh-bg flex min-h-dvh flex-col items-center justify-center px-4 py-6">
      <div className="w-full max-w-sm" style={{ animation: 'slideUp 0.5s ease-out' }}>
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="animate-float mb-3 text-5xl" aria-hidden="true">🦊</div>
          <h1
            className="mb-2 text-fluid-2xl font-bold text-foreground"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {isHi ? 'Alfanumrik में आपका स्वागत है!' : 'Welcome to Alfanumrik!'}
          </h1>
          <p className="text-fluid-sm leading-relaxed text-muted-foreground">
            {isHi
              ? 'हमें अपनी कक्षा और बोर्ड बताएं ताकि हम आपको सही विषय और अध्याय दिखा सकें।'
              : 'Tell us your grade and board so we can show you the right subjects and chapters.'}
          </p>
        </div>

        {/* Form */}
        <div className="rounded-2xl border border-surface-3 bg-surface-1 p-6 shadow-md">
          <form onSubmit={handleSubmit} aria-describedby={error ? 'onboarding-error' : undefined}>
            <div className="flex flex-col gap-4">
              {/* Grade */}
              <Field
                htmlFor="onboarding-grade"
                label={isHi ? 'आपकी कक्षा' : 'Your Grade'}
                required
                requiredText={isHi ? 'आवश्यक' : 'required'}
              >
                <Select
                  id="onboarding-grade"
                  value={grade}
                  onChange={e => setGrade(e.target.value)}
                  placeholder={isHi ? 'कक्षा चुनें...' : 'Select grade...'}
                  required
                >
                  {GRADES.map(g => (
                    <option key={g} value={g}>{isHi ? 'कक्षा' : 'Grade'} {g}</option>
                  ))}
                </Select>
              </Field>

              {/* Board */}
              <Field
                htmlFor="onboarding-board"
                label={isHi ? 'आपका बोर्ड' : 'Your Board'}
              >
                <Select
                  id="onboarding-board"
                  value={board}
                  onChange={e => setBoard(e.target.value)}
                >
                  {BOARDS.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </Select>
              </Field>

              {/* Academic Goal (optional) */}
              <Field
                label={isHi ? 'आपका लक्ष्य क्या है?' : "What's your goal?"}
                optional
                optionalText={isHi ? '(वैकल्पिक)' : '(optional)'}
              >
                <div
                  role="group"
                  aria-label={isHi ? 'आपका लक्ष्य' : 'Your goal'}
                  className="grid grid-cols-2 gap-2"
                >
                  {GOAL_OPTIONS.map(opt => (
                    <Chip
                      key={opt.value}
                      selected={academicGoal === opt.value}
                      icon={opt.icon}
                      onClick={() => setAcademicGoal(prev => prev === opt.value ? '' : opt.value)}
                      className="w-full justify-center"
                    >
                      {isHi ? opt.labelHi : opt.label}
                    </Chip>
                  ))}
                </div>
              </Field>

              {/* Error */}
              {error && (
                <Alert id="onboarding-error" tone="danger">
                  {error}
                </Alert>
              )}

              {/* Submit */}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={saving}
                disabled={saving || !grade}
              >
                {saving ? (isHi ? 'सहेज रहे हैं...' : 'Saving...') : (isHi ? 'सीखना शुरू करें' : 'Start Learning')}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
