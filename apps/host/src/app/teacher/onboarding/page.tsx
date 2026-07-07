'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase } from '@alfanumrik/lib/supabase';
import { useTeacherAllowedSubjects } from '@alfanumrik/lib/useTeacherAllowedSubjects';
import { VALID_GRADES } from '@alfanumrik/lib/identity';
import {
  Card,
  Field,
  Input,
  Select,
  Button,
  Alert,
  EmptyState,
  ProgressBar,
} from '@alfanumrik/ui/ui/primitives';

// ============================================================
// BILINGUAL HELPERS (P7)
// ============================================================
const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

const GRADES = [...VALID_GRADES];
const SECTIONS = ['', 'A', 'B', 'C', 'D', 'E'];
const TOTAL_STEPS = 4;

export default function TeacherOnboardingPage() {
  const { teacher, isLoading: authLoading, isLoggedIn, activeRole, isHi } = useAuth();
  const { subjects } = useTeacherAllowedSubjects();
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [classCode, setClassCode] = useState('');

  // Create class form
  const [formName, setFormName] = useState('');
  const [formGrade, setFormGrade] = useState('9');
  const [formSection, setFormSection] = useState('');
  const [formSubject, setFormSubject] = useState('math');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');

  // Auth guard
  useEffect(() => {
    if (authLoading) return;
    if (!isLoggedIn || (activeRole !== 'teacher' && !teacher)) {
      router.replace('/login');
      return;
    }
    // If already onboarded, redirect to dashboard
    const teacherRecord = teacher as (typeof teacher & { onboarding_completed?: boolean | null });
    if (teacherRecord?.onboarding_completed) {
      router.replace('/teacher');
    }
  }, [authLoading, isLoggedIn, activeRole, teacher, router]);

  const handleCreateClass = async () => {
    const name = formName.trim();
    if (!name || name.length < 2) {
      setFormError(tt(isHi, 'Class name must be at least 2 characters', 'कक्षा का नाम कम से कम 2 अक्षरों का होना चाहिए'));
      return;
    }
    if (!/^[a-zA-Z0-9\s\-_().]+$/.test(name)) {
      setFormError(tt(isHi, 'Class name contains invalid characters', 'कक्षा के नाम में अमान्य अक्षर हैं'));
      return;
    }
    setCreating(true);
    setFormError('');
    try {
      const teacherId = teacher?.id;
      const { data, error } = await supabase.rpc('teacher_create_class', {
        p_teacher_id: teacherId,
        p_name: name,
        p_grade: formGrade,
        p_section: formSection || null,
        p_subject: formSubject,
      });
      if (error) throw error;
      // The RPC should return the class object or class_code
      const code = data?.class_code || data?.code || (typeof data === 'string' ? data : '');
      setClassCode(code);
      setStep(3);
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : tt(isHi, 'Failed to create class', 'कक्षा बनाने में विफल'));
    } finally {
      setCreating(false);
    }
  };

  const handleFinish = async () => {
    try {
      if (teacher?.id) {
        // Mark onboarding complete — field exists in DB but not in local TS type
        await supabase
          .from('teachers')
          .update({ onboarding_completed: true } as Record<string, unknown>)
          .eq('id', teacher.id);
      }
    } catch {
      // Non-blocking — proceed to dashboard regardless
    }
    router.push('/teacher');
  };

  const copyCode = () => {
    if (classCode) {
      navigator.clipboard.writeText(classCode).catch(() => null);
    }
  };

  const whatsappShare = () => {
    const msg = encodeURIComponent(
      tt(isHi,
        `Join my class on Alfanumrik! Code: ${classCode}`,
        `Alfanumrik पर मेरी कक्षा में जुड़ें! कोड: ${classCode}`
      )
    );
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  };

  if (authLoading) {
    return (
      <div className="mesh-bg flex min-h-dvh flex-col items-center justify-center px-4 py-6">
        <div
          aria-hidden="true"
          className="h-10 w-10 animate-spin rounded-full border-4 border-surface-3 motion-reduce:animate-none"
          style={{ borderTopColor: 'var(--orange)' }}
        />
      </div>
    );
  }

  const teacherName = teacher?.name || tt(isHi, 'Teacher', 'शिक्षक');
  const subjectMeta = subjects.find(s => s.code === formSubject);

  return (
    <div className="mesh-bg flex min-h-dvh flex-col items-center px-4 pb-16 pt-6">
      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes bounceIn{0%{transform:scale(0.5);opacity:0}60%{transform:scale(1.15)}100%{transform:scale(1);opacity:1}}
      `}</style>

      {/* Brand mark */}
      <div className="mb-8 flex items-center gap-2.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-accent text-fluid-lg font-bold text-on-accent">
          A
        </div>
        <span className="text-fluid-xl font-bold text-foreground">Alfanumrik</span>
      </div>

      {/* Step indicator — text label makes progress deuteranopia-safe */}
      <div className="mb-8 w-full max-w-[480px]">
        <ProgressBar
          value={(step / TOTAL_STEPS) * 100}
          tone="brand"
          showValue
          label={tt(isHi, `Step ${step} of ${TOTAL_STEPS}`, `चरण ${step} / ${TOTAL_STEPS}`)}
        />
      </div>

      {/* Step 1 — Welcome */}
      {step === 1 && (
        <Card variant="elevated" className="w-full max-w-[480px] p-8" style={{ animation: 'fadeIn 0.35s ease' }}>
          <div className="mb-4 text-center text-5xl" aria-hidden="true">👋</div>
          <h1 className="mb-2 text-center text-fluid-2xl font-bold text-foreground">
            {tt(isHi, `Welcome, ${teacherName}!`, `स्वागत है, ${teacherName}!`)}
          </h1>
          <p className="mb-7 text-center text-fluid-sm leading-relaxed text-muted-foreground">
            {tt(isHi,
              "Let's set up your classroom on Alfanumrik in just a few steps.",
              'आइए कुछ ही चरणों में Alfanumrik पर आपकी कक्षा सेट अप करें।'
            )}
          </p>

          {/* Profile summary */}
          <div className="mb-7 rounded-xl border border-surface-3 bg-surface-2 px-4 py-4">
            <p className="mb-2.5 text-fluid-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tt(isHi, 'Your Profile', 'आपकी प्रोफ़ाइल')}
            </p>
            <div className="flex items-center justify-between text-fluid-sm">
              <span className="text-muted-foreground">{tt(isHi, 'Name', 'नाम')}</span>
              <span className="font-semibold text-foreground">{teacherName}</span>
            </div>
          </div>

          <Button variant="primary" size="lg" fullWidth onClick={() => setStep(2)}>
            {tt(isHi, "Let's get started →", 'शुरू करें →')}
          </Button>
        </Card>
      )}

      {/* Step 2 — Create First Class */}
      {step === 2 && (
        <Card variant="elevated" className="w-full max-w-[480px] p-8" style={{ animation: 'fadeIn 0.35s ease' }}>
          <h2 className="mb-1.5 text-fluid-xl font-bold text-foreground">
            {tt(isHi, 'Create your first class', 'अपनी पहली कक्षा बनाएं')}
          </h2>
          <p className="mb-6 text-fluid-sm text-muted-foreground">
            {tt(isHi, 'Students will join using the class code generated below.', 'छात्र नीचे बनाए गए कक्षा कोड का उपयोग करके जुड़ेंगे।')}
          </p>

          <div className="flex flex-col gap-4">
            {/* Class Name */}
            <Field htmlFor="class-name" label={tt(isHi, 'Class Name', 'कक्षा का नाम')}>
              <Input
                id="class-name"
                type="text"
                placeholder={tt(isHi, 'e.g. 10-A Science', 'जैसे 10-A विज्ञान')}
                value={formName}
                onChange={e => setFormName(e.target.value)}
              />
            </Field>

            {/* Grade + Section */}
            <div className="grid grid-cols-2 gap-3">
              <Field htmlFor="class-grade" label={tt(isHi, 'Grade', 'कक्षा')}>
                <Select id="class-grade" value={formGrade} onChange={e => setFormGrade(e.target.value)}>
                  {GRADES.map(g => (
                    <option key={g} value={g}>{tt(isHi, `Grade ${g}`, `कक्षा ${g}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field htmlFor="class-section" label={tt(isHi, 'Section', 'सेक्शन')}>
                <Select id="class-section" value={formSection} onChange={e => setFormSection(e.target.value)}>
                  {SECTIONS.map(s => (
                    <option key={s} value={s}>{s || tt(isHi, 'None', 'कोई नहीं')}</option>
                  ))}
                </Select>
              </Field>
            </div>

            {/* Subject */}
            <Field htmlFor="class-subject" label={tt(isHi, 'Subject', 'विषय')}>
              <Select id="class-subject" value={formSubject} onChange={e => setFormSubject(e.target.value)}>
                {subjects.map(s => (
                  <option key={s.code} value={s.code}>{s.icon} {s.name}</option>
                ))}
              </Select>
            </Field>

            {formError && <Alert tone="danger">{formError}</Alert>}

            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setStep(1)} className="flex-1">
                {tt(isHi, '← Back', '← वापस')}
              </Button>
              <Button
                variant="primary"
                onClick={handleCreateClass}
                disabled={creating || !formName.trim()}
                loading={creating}
                className="flex-[2]"
              >
                {creating
                  ? tt(isHi, 'Creating...', 'बना रहे हैं...')
                  : tt(isHi, `Create ${subjectMeta?.name || 'Class'} →`, `${subjectMeta?.name || 'कक्षा'} बनाएं →`)
                }
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Step 3 — Share class code */}
      {step === 3 && (
        <Card variant="elevated" className="w-full max-w-[480px] p-8" style={{ animation: 'fadeIn 0.35s ease' }}>
          <div className="mb-3 text-center text-4xl" aria-hidden="true">🎉</div>
          <h2 className="mb-1.5 text-center text-fluid-xl font-bold text-foreground">
            {tt(isHi, 'Class created!', 'कक्षा बनाई गई!')}
          </h2>
          <p className="mb-7 text-center text-fluid-sm text-muted-foreground">
            {tt(isHi, 'Share this code with your students so they can join.', 'यह कोड अपने छात्रों के साथ साझा करें ताकि वे जुड़ सकें।')}
          </p>

          {/* Big code display */}
          <div className="mb-6 rounded-2xl border border-dashed border-surface-3 bg-surface-2 px-5 py-7 text-center">
            <p className="mb-2 text-fluid-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {tt(isHi, 'Class Code', 'कक्षा कोड')}
            </p>
            <div className="font-mono text-fluid-4xl font-extrabold tracking-[0.35em] text-primary">
              {classCode || '------'}
            </div>
          </div>

          {/* Action buttons */}
          <div className="mb-6 flex flex-col gap-3">
            <Button variant="secondary" fullWidth onClick={copyCode} leadingIcon="📋">
              {tt(isHi, 'Copy Code', 'कोड कॉपी करें')}
            </Button>
            <Button variant="secondary" fullWidth onClick={whatsappShare} leadingIcon="📲">
              {tt(isHi, 'Share on WhatsApp', 'WhatsApp पर साझा करें')}
            </Button>
          </div>

          <p className="mb-5 text-center text-fluid-xs leading-relaxed text-muted-foreground">
            {tt(isHi,
              'Students open the Alfanumrik app, tap "Join Class" and enter this code.',
              'छात्र Alfanumrik ऐप खोलें, "कक्षा में शामिल हों" टैप करें और यह कोड दर्ज करें।'
            )}
          </p>

          <Button variant="primary" size="lg" fullWidth onClick={() => setStep(4)}>
            {tt(isHi, 'Continue →', 'जारी रखें →')}
          </Button>
        </Card>
      )}

      {/* Step 4 — Done */}
      {step === 4 && (
        <Card variant="elevated" className="w-full max-w-[480px] p-8" style={{ animation: 'fadeIn 0.35s ease' }}>
          <EmptyState
            icon={<span style={{ animation: 'bounceIn 0.6s ease' }}>✅</span>}
            title={tt(isHi, "You're all set!", 'आप तैयार हैं!')}
            description={
              <>
                <span className="block text-fluid-base font-semibold text-success">
                  {tt(isHi, 'Your class is ready!', 'आपकी कक्षा तैयार है!')}
                </span>
                <span className="mt-2 block">
                  {tt(isHi,
                    'Head to your dashboard to track student progress, view mastery heatmaps, and create assignments.',
                    'छात्रों की प्रगति ट्रैक करने, मास्टरी हीटमैप देखने और असाइनमेंट बनाने के लिए अपने डैशबोर्ड पर जाएं।'
                  )}
                </span>
              </>
            }
            action={
              <Button variant="primary" size="lg" fullWidth onClick={handleFinish}>
                {tt(isHi, 'Go to Dashboard →', 'डैशबोर्ड पर जाएं →')}
              </Button>
            }
          />
        </Card>
      )}
    </div>
  );
}
