'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { FoxyAvatar, Button, StepIndicator } from '@/components/ui';
import StreamStep, { type Stream } from './StreamStep';
import SubjectStep, { PLAN_SUBJECT_CAPS } from './SubjectStep';

/**
 * OnboardingFlow — 3-step guided introduction for new students.
 *
 * Step 1: Meet Foxy (personality introduction)
 * Step 2: Set Your Goal (academic motivation)
 * Step 3: First Action (start quiz or talk to Foxy)
 *
 * Total time: ~30 seconds. No friction.
 */

const GOALS = [
  { id: 'understand', icon: '💡', label: 'Understand concepts clearly', labelHi: 'कॉन्सेप्ट अच्छे से समझना' },
  { id: 'score', icon: '🎯', label: 'Score better in exams', labelHi: 'परीक्षा में बेहतर स्कोर' },
  { id: 'consistent', icon: '📅', label: 'Stay consistent daily', labelHi: 'हर दिन पढ़ाई करना' },
];

interface OnboardingFlowProps {
  onComplete: () => void;
}

type StepId = 'intro' | 'goal' | 'stream' | 'subjects' | 'cta';

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const { student, isHi } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<StepId>('intro');
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const gradeKey = (student?.grade || '9').replace('Grade ', '').trim();
  const needsStream = gradeKey === '11' || gradeKey === '12';
  const [stream, setStream] = useState<Stream | null>(null);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const planCap = useMemo(() => {
    const plan = (student?.subscription_plan as keyof typeof PLAN_SUBJECT_CAPS | undefined) ?? 'free';
    return PLAN_SUBJECT_CAPS[plan] ?? PLAN_SUBJECT_CAPS.free;
  }, [student?.subscription_plan]);

  const saveAndFinish = async (route: string) => {
    if (!student) return;
    setSaving(true);
    setSaveError(false);
    try {
      // Save onboarding response (non-blocking — goal is optional data)
      if (selectedGoal) {
        await supabase.from('onboarding_responses').insert({
          student_id: student.id,
          question_type: 'academic_goal',
          response_value: selectedGoal,
        }).then(() => {});
      }
      // Mark onboarding complete and persist stream + selected_subjects (both optional
      // columns — older rows just won't have them, which is fine for this migration).
      const patch: Record<string, unknown> = { onboarding_completed: true };
      if (needsStream && stream) patch.stream = stream;
      if (selectedSubjects.length > 0) {
        patch.selected_subjects = selectedSubjects;
        patch.preferred_subject = selectedSubjects[0];
      }
      const { error } = await supabase.from('students').update(patch).eq('id', student.id);
      if (error) throw error;
      if (typeof window !== 'undefined') localStorage.setItem('alfanumrik_onboarded', 'true');
      onComplete();
      router.push(route);
    } catch (e) {
      console.error('Onboarding save error:', e);
      setSaveError(true);
      setSaving(false);
    }
  };

  const firstName = student?.name?.split(' ')[0] || '';

  return (
    <div className="mesh-bg min-h-dvh flex flex-col items-center justify-center px-5 py-8">
      <div className="w-full max-w-sm">
        {/* Step indicator — total adjusts based on whether stream step is shown */}
        <div className="flex justify-center mb-8">
          <StepIndicator
            total={needsStream ? 5 : 4}
            current={
              step === 'intro' ? 0
              : step === 'goal' ? 1
              : step === 'stream' ? 2
              : step === 'subjects' ? (needsStream ? 3 : 2)
              : (needsStream ? 4 : 3)
            }
          />
        </div>

        {/* ═══ STEP 1: Meet Foxy ═══ */}
        {step === 'intro' && (
          <div className="text-center animate-fade-in">
            <FoxyAvatar state="happy" size="lg" />
            <h1 className="text-xl font-bold mt-6" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? `हाय ${firstName}! मैं Foxy हूँ 🦊` : `Hi ${firstName}! I'm Foxy 🦊`}
            </h1>
            <p className="text-sm text-[var(--text-2)] mt-2 max-w-xs mx-auto leading-relaxed">
              {isHi
                ? 'मैं तुम्हारा study buddy हूँ। हर सवाल में, हर chapter में — मैं साथ रहूँगा।'
                : "I'm your study buddy. Every question, every chapter — I'll be right here with you."}
            </p>
            <Button variant="primary" size="lg" fullWidth className="mt-8" onClick={() => setStep('goal')}>
              {isHi ? 'चलो शुरू करें!' : "Let's go!"}
            </Button>
          </div>
        )}

        {/* ═══ STEP 2: Set Your Goal ═══ */}
        {step === 'goal' && (
          <div className="animate-fade-in">
            <div className="text-center mb-6">
              <FoxyAvatar state="idle" size="md" />
              <h2 className="text-lg font-bold mt-4" style={{ fontFamily: 'var(--font-display)' }}>
                {isHi ? 'तुम्हारा लक्ष्य क्या है?' : 'What matters most to you?'}
              </h2>
            </div>
            <div className="space-y-3">
              {GOALS.map((goal) => (
                <button
                  key={goal.id}
                  onClick={() => setSelectedGoal(goal.id)}
                  className="w-full p-4 rounded-xl text-left flex items-center gap-3 transition-all active:scale-[0.98]"
                  style={{
                    background: selectedGoal === goal.id ? 'rgba(232,88,28,0.08)' : 'var(--surface-1)',
                    border: `1.5px solid ${selectedGoal === goal.id ? 'var(--orange)' : 'var(--border)'}`,
                  }}
                >
                  <span className="text-2xl">{goal.icon}</span>
                  <span className="text-sm font-semibold" style={{ color: selectedGoal === goal.id ? 'var(--orange)' : 'var(--text-1)' }}>
                    {isHi ? goal.labelHi : goal.label}
                  </span>
                </button>
              ))}
            </div>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              className="mt-6"
              disabled={!selectedGoal}
              onClick={() => setStep(needsStream ? 'stream' : 'subjects')}
            >
              {isHi ? 'आगे बढ़ो' : 'Continue'}
            </Button>
            <button
              onClick={() => setStep('intro')}
              className="w-full mt-3 text-sm text-[var(--text-3)] py-2 transition-colors"
            >
              {isHi ? '← वापस जाओ' : '← Go back'}
            </button>
          </div>
        )}

        {/* ═══ STEP 3 (11/12 only): Stream ═══ */}
        {step === 'stream' && (
          <StreamStep
            value={stream}
            onChange={setStream}
            onNext={() => setStep('subjects')}
            onBack={() => setStep('goal')}
            isHi={isHi}
          />
        )}

        {/* ═══ STEP: Subjects ═══ */}
        {step === 'subjects' && (
          <SubjectStep
            value={selectedSubjects}
            onChange={setSelectedSubjects}
            onNext={() => setStep('cta')}
            onBack={() => setStep(needsStream ? 'stream' : 'goal')}
            isHi={isHi}
            maxSubjects={planCap}
          />
        )}

        {/* ═══ FINAL STEP: First Action ═══ */}
        {step === 'cta' && (
          <div className="text-center animate-fade-in">
            <FoxyAvatar state="encouraging" size="lg" />
            <h2 className="text-lg font-bold mt-6" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'तैयार हो!' : "You're all set!"}
            </h2>
            <p className="text-sm text-[var(--text-2)] mt-2 max-w-xs mx-auto">
              {isHi
                ? 'एक छोटा क्विज़ लो ताकि मैं समझ सकूँ तुम कहाँ हो। या सीधे मुझसे बात करो!'
                : "Take a quiz so I know where you stand. Or just start talking to me!"}
            </p>

            {saveError && (
              <div className="mt-4 p-3 rounded-xl text-center" style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)' }}>
                <p className="text-xs text-[#DC2626] font-medium">
                  {isHi ? 'कुछ गलत हो गया। फिर से कोशिश करो।' : 'Something went wrong. Please try again.'}
                </p>
              </div>
            )}

            <div className="mt-6 space-y-3">
              <Button variant="primary" size="lg" fullWidth onClick={() => saveAndFinish('/foxy')} disabled={saving}>
                {saving ? (isHi ? 'सेव हो रहा...' : 'Saving...') : (
                  <>{isHi ? '🦊 Foxy से शुरू करो' : '🦊 Start with Foxy'}</>
                )}
              </Button>
              <Button variant="ghost" size="md" fullWidth onClick={() => saveAndFinish('/dashboard')} disabled={saving}>
                {isHi ? '📚 डैशबोर्ड पर जाओ' : '📚 Go to Dashboard'}
              </Button>
            </div>
            <button
              onClick={() => setStep('subjects')}
              className="w-full mt-3 text-sm text-[var(--text-3)] py-2 transition-colors"
            >
              {isHi ? '← वापस जाओ' : '← Go back'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
