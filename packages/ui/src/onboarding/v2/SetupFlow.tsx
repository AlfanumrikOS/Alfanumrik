'use client';

/**
 * SetupFlow — screen 01 "Set up" (`/onboarding`, `ff_onboarding_v2`).
 *
 * Four steps: welcome → class → subjects → parent. Presentational: it
 * fetches nothing itself. All reads (subjects list) and writes (grade,
 * subjects, guardian invite, finish) are passed in as props from the page,
 * via packages/lib/src/onboarding/use-setup.ts.
 *
 * House design system only — CSS custom properties (--orange, --surface-*,
 * --text-*, --border, --font-display), no hardcoded hex, no third design
 * token system. Matches packages/ui/src/today/v2/TodayHomeV2.tsx and
 * packages/ui/src/exams/v2/ExamSchedule.tsx.
 *
 * ── DPDP minor gate (read this before touching the "parent" step) ──
 *
 * SCREENS.md describes this step as "under-18 collects a parent email and
 * blocks completion until consent is recorded." Two things in this codebase
 * changed that plan, both confirmed by reading the real source before
 * building this component (not re-derived from the handoff doc):
 *
 *   1. The actual age/consent gate is NOT "under 18" — it is the signup-time
 *      age-range picker in AuthScreen.tsx, which only requires a parent
 *      email + a self-attested consent checkbox for the 10-12 age range
 *      (COPPA-style "under 13", not DPDP's "under 18"). That gate already
 *      BLOCKS signup itself — a 10-12-year-old cannot create an account
 *      without entering a parent email and checking the consent box. By the
 *      time a student reaches /onboarding, that gate has already run.
 *
 *   2. "Consent is recorded" in the strict sense (an active row in
 *      `parental_consent`, per migration 20260527000004) requires the
 *      GUARDIAN to take an action — sign up, follow the invite link, and
 *      grant consent on /link/[code]/consent. That is asynchronous and can
 *      take days. Blocking /onboarding (and therefore the whole dashboard)
 *      until a parent replies would violate P15 ("the signup→dashboard
 *      funnel must never break" — the #1 acquisition path) for the sake of
 *      a step the student has no control over. The existing bootstrap route
 *      (api/auth/bootstrap/route.ts) already treats the guardian invite as
 *      fire-and-forget for exactly this reason.
 *
 * Given that tension, this component's "parent" step blocks the FINISH
 * button on having a syntactically-valid parent email captured (either
 * confirming the one already captured at signup, or entering one now for a
 * minor who somehow reached this step without it — e.g. a legacy account).
 * It does NOT block on the guardian actually completing consent — that
 * would strand the student indefinitely on a step outside their control.
 * This interpretation is called out explicitly in the frontend agent's
 * handoff notes as an open product-policy question for ops/architect to
 * confirm or override; it is not silently assumed.
 */

import { useEffect, useMemo, useState } from 'react';
import { GRADES, BOARDS } from '@alfanumrik/lib/constants';
import type { Subject } from '@alfanumrik/lib/subjects.types';
import { Skeleton } from '@alfanumrik/ui/ui';

type Step = 'welcome' | 'class' | 'subjects' | 'parent';

export interface SetupFlowWriteResult {
  ok: boolean;
  error?: string;
}

export interface SetupFlowProps {
  isHi: boolean;
  studentName: string;
  initialGrade: string;
  initialBoard: string;
  /** Subjects available for the CURRENTLY SAVED grade. Empty until saveGrade resolves. */
  subjects: Subject[];
  subjectsLoading: boolean;
  isMinor: boolean;
  /** Parent email captured at signup, if any (see getMinorSignal in use-setup.ts). */
  existingParentEmail: string | null;
  saving: boolean;
  onSaveGrade: (grade: string, board: string) => Promise<SetupFlowWriteResult>;
  onSaveSubjects: (subjects: string[], preferred: string) => Promise<SetupFlowWriteResult>;
  onInviteGuardian: (email: string, locale: 'en' | 'hi') => Promise<SetupFlowWriteResult>;
  onFinish: () => Promise<SetupFlowWriteResult>;
  /** Called right after a grade save succeeds so the page can refresh the subjects list. */
  onGradeSaved?: () => void;
  /** Called once the whole flow finishes successfully — page decides where to route (/today). */
  onComplete: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STEP_ORDER: Step[] = ['welcome', 'class', 'subjects', 'parent'];

function StepDots({ step, total, isHi }: { step: number; total: number; isHi: boolean }) {
  return (
    <div
      className="flex items-center gap-1.5 justify-center mb-5"
      role="progressbar"
      aria-valuenow={step + 1}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-label={isHi ? 'सेटअप प्रगति' : 'Setup progress'}
    >
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className="rounded-full transition-all duration-200"
          style={{
            width: i === step ? 22 : 8,
            height: 8,
            background: i <= step ? 'var(--orange)' : 'var(--surface-3)',
          }}
        />
      ))}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="text-xs font-semibold rounded-xl px-3 py-2.5 mb-3"
      style={{
        color: 'var(--danger)',
        background: 'var(--danger-light)',
        border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)',
      }}
    >
      {message}
    </div>
  );
}

export default function SetupFlow({
  isHi,
  studentName,
  initialGrade,
  initialBoard,
  subjects,
  subjectsLoading,
  isMinor,
  existingParentEmail,
  saving,
  onSaveGrade,
  onSaveSubjects,
  onInviteGuardian,
  onFinish,
  onGradeSaved,
  onComplete,
}: SetupFlowProps) {
  const [step, setStep] = useState<Step>('welcome');
  const [grade, setGrade] = useState(initialGrade || '');
  const [board, setBoard] = useState(initialBoard || 'CBSE');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [parentEmail, setParentEmail] = useState(existingParentEmail ?? '');
  const [parentEmailTouched, setParentEmailTouched] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  // If a minor signal arrives after first paint (async auth.getUser call),
  // seed the parent-email field once so a slow resolve doesn't clobber
  // something the student already typed.
  useEffect(() => {
    if (existingParentEmail && !parentEmail) setParentEmail(existingParentEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingParentEmail]);

  const stepIndex = STEP_ORDER.indexOf(step);
  // Minor students see 4 steps; non-minor students never see "parent" (3 dots).
  const totalSteps = isMinor ? 4 : 3;

  const unlockedSubjects = useMemo(() => subjects.filter((s) => !s.isLocked), [subjects]);

  const goNext = () => {
    setStepError(null);
    if (step === 'welcome') setStep('class');
    else if (step === 'class') setStep('subjects');
    else if (step === 'subjects') {
      if (isMinor) setStep('parent');
      else void handleFinish();
    } else if (step === 'parent') {
      void handleFinish();
    }
  };

  const goBack = () => {
    setStepError(null);
    if (step === 'class') setStep('welcome');
    else if (step === 'subjects') setStep('class');
    else if (step === 'parent') setStep('subjects');
  };

  const handleContinueClass = async () => {
    if (!grade) {
      setStepError(isHi ? 'कृपया अपनी कक्षा चुनें' : 'Please select your grade');
      return;
    }
    const res = await onSaveGrade(grade, board);
    if (!res.ok) {
      setStepError(isHi ? 'सहेज नहीं सका — फिर कोशिश करें।' : 'Could not save — please try again.');
      return;
    }
    onGradeSaved?.();
    setStep('subjects');
  };

  const handleContinueSubjects = async () => {
    if (selectedSubjects.length === 0) {
      setStepError(isHi ? 'कम से कम एक विषय चुनें' : 'Please select at least one subject');
      return;
    }
    const res = await onSaveSubjects(selectedSubjects, selectedSubjects[0]!);
    if (!res.ok) {
      setStepError(isHi ? 'विषय सहेज नहीं सके — फिर कोशिश करें।' : 'Could not save subjects — please try again.');
      return;
    }
    if (isMinor) setStep('parent');
    else void handleFinish();
  };

  const parentEmailValid = EMAIL_RE.test(parentEmail.trim());

  const handleFinishFromParentStep = async () => {
    setParentEmailTouched(true);
    if (!parentEmailValid) {
      setStepError(isHi ? 'कृपया एक सही ईमेल पता दर्ज करें' : 'Please enter a valid email address');
      return;
    }
    // Idempotent — safe to (re-)invite even if signup already fired one.
    const inviteRes = await onInviteGuardian(parentEmail.trim(), isHi ? 'hi' : 'en');
    if (!inviteRes.ok) {
      setStepError(
        isHi
          ? 'अभिभावक को सूचित नहीं कर सके — फिर कोशिश करें।'
          : 'Could not notify your parent/guardian — please try again.',
      );
      return;
    }
    await handleFinish();
  };

  const handleFinish = async () => {
    setStepError(null);
    const res = await onFinish();
    if (!res.ok) {
      setStepError(isHi ? 'पूरा नहीं कर सके — फिर कोशिश करें।' : 'Could not finish setup — please try again.');
      return;
    }
    onComplete();
  };

  const toggleSubject = (code: string) => {
    setSelectedSubjects((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const cardStyle: React.CSSProperties = {
    borderRadius: 20,
    padding: 24,
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
  };

  const primaryBtnStyle: React.CSSProperties = {
    width: '100%',
    minHeight: 48,
    borderRadius: 12,
    background: 'linear-gradient(135deg, #E8590C, #F59E0B)',
    color: '#fff',
    border: 'none',
    fontSize: 15,
    fontWeight: 700,
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
      data-testid="setup-flow-v2"
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        <StepDots step={Math.min(stepIndex, totalSteps - 1)} total={totalSteps} isHi={isHi} />

        <div style={cardStyle} data-testid={`setup-step-${step}`}>
          {stepError && <ErrorBanner message={stepError} />}

          {/* ── Step 1: Welcome ── */}
          {step === 'welcome' && (
            <div style={{ textAlign: 'center' }}>
              <div className="animate-float" style={{ fontSize: 48, marginBottom: 12 }}>
                🦊
              </div>
              <h1
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: 'var(--text-1)',
                  marginBottom: 8,
                  fontFamily: 'var(--font-display)',
                }}
              >
                {isHi
                  ? `स्वागत है, ${studentName || 'दोस्त'}!`
                  : `Welcome${studentName ? `, ${studentName}` : ''}!`}
              </h1>
              <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.5, marginBottom: 24 }}>
                {isHi
                  ? 'बस कुछ सवाल — फिर हम आपकी कक्षा और विषयों के हिसाब से पढ़ाई तैयार कर देंगे।'
                  : "Just a few quick questions and we'll set up learning that matches your grade and subjects."}
              </p>
              <button type="button" onClick={goNext} style={primaryBtnStyle} data-testid="setup-welcome-continue">
                {isHi ? 'शुरू करें' : "Let's go"}
              </button>
            </div>
          )}

          {/* ── Step 2: Class ── */}
          {step === 'class' && (
            <div>
              <h2
                style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4, fontFamily: 'var(--font-display)' }}
              >
                {isHi ? 'आपकी कक्षा' : 'Your class'}
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>
                {isHi ? 'यह हमें सही विषय दिखाने में मदद करता है।' : 'This helps us show you the right subjects.'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label
                    htmlFor="setup-grade"
                    style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}
                  >
                    {isHi ? 'कक्षा' : 'Grade'}
                  </label>
                  <select
                    id="setup-grade"
                    value={grade}
                    onChange={(e) => setGrade(e.target.value)}
                    className="input-base"
                    style={{ width: '100%', minHeight: 44 }}
                  >
                    <option value="" disabled>
                      {isHi ? 'कक्षा चुनें...' : 'Select grade...'}
                    </option>
                    {GRADES.map((g) => (
                      <option key={g} value={g}>
                        {isHi ? 'कक्षा' : 'Grade'} {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="setup-board"
                    style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}
                  >
                    {isHi ? 'बोर्ड' : 'Board'}
                  </label>
                  <select
                    id="setup-board"
                    value={board}
                    onChange={(e) => setBoard(e.target.value)}
                    className="input-base"
                    style={{ width: '100%', minHeight: 44 }}
                  >
                    {BOARDS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  onClick={goBack}
                  style={{ minHeight: 48, minWidth: 44, padding: '0 16px', borderRadius: 12, background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}
                >
                  {isHi ? 'पीछे' : 'Back'}
                </button>
                <button
                  type="button"
                  onClick={handleContinueClass}
                  disabled={saving || !grade}
                  style={{ ...primaryBtnStyle, flex: 1, opacity: saving || !grade ? 0.6 : 1 }}
                  data-testid="setup-class-continue"
                >
                  {saving ? (isHi ? 'सहेज रहे हैं...' : 'Saving...') : isHi ? 'जारी रखें' : 'Continue'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Subjects ── */}
          {step === 'subjects' && (
            <div>
              <h2
                style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4, fontFamily: 'var(--font-display)' }}
              >
                {isHi ? 'अपने विषय चुनें' : 'Pick your subjects'}
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>
                {isHi ? 'आप बाद में इसे प्रोफ़ाइल में बदल सकते हैं।' : 'You can change this later from your profile.'}
              </p>

              {subjectsLoading ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }} data-testid="setup-subjects-loading">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} height={44} rounded="rounded-xl" />
                  ))}
                </div>
              ) : unlockedSubjects.length === 0 ? (
                <p
                  className="text-sm"
                  style={{ color: 'var(--text-3)', padding: '16px 0', textAlign: 'center' }}
                  data-testid="setup-subjects-empty"
                >
                  {isHi
                    ? 'इस कक्षा के लिए अभी कोई विषय उपलब्ध नहीं — आप बाद में जोड़ सकते हैं।'
                    : 'No subjects available for this grade yet — you can add them later.'}
                </p>
              ) : (
                <div
                  role="group"
                  aria-label={isHi ? 'विषय चुनें' : 'Select subjects'}
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}
                  data-testid="setup-subjects-grid"
                >
                  {unlockedSubjects.map((s) => {
                    const active = selectedSubjects.includes(s.code);
                    return (
                      <button
                        key={s.code}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleSubject(s.code)}
                        style={{
                          minHeight: 48,
                          padding: '10px 12px',
                          borderRadius: 12,
                          textAlign: 'left',
                          border: `2px solid ${active ? 'var(--orange)' : 'var(--border)'}`,
                          background: active ? 'rgb(var(--orange-rgb, 232 88 28) / 0.06)' : 'var(--surface-2)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                        data-testid={`setup-subject-${s.code}`}
                      >
                        <span aria-hidden="true">{s.icon}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--orange)' : 'var(--text-2)' }}>
                          {isHi ? s.nameHi : s.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  onClick={goBack}
                  style={{ minHeight: 48, minWidth: 44, padding: '0 16px', borderRadius: 12, background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}
                >
                  {isHi ? 'पीछे' : 'Back'}
                </button>
                <button
                  type="button"
                  onClick={handleContinueSubjects}
                  disabled={saving || subjectsLoading}
                  style={{ ...primaryBtnStyle, flex: 1, opacity: saving || subjectsLoading ? 0.6 : 1 }}
                  data-testid="setup-subjects-continue"
                >
                  {saving
                    ? isHi
                      ? 'सहेज रहे हैं...'
                      : 'Saving...'
                    : isMinor
                      ? isHi
                        ? 'जारी रखें'
                        : 'Continue'
                      : isHi
                        ? 'पूरा करें'
                        : 'Finish'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Parent (minors only) ── */}
          {step === 'parent' && (
            <div>
              <h2
                style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4, fontFamily: 'var(--font-display)' }}
              >
                {isHi ? 'अभिभावक की जानकारी' : 'Parent / guardian details'}
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>
                {isHi
                  ? 'हम आपके अभिभावक को एक सूचना भेजेंगे। इससे आपकी सुरक्षा सुनिश्चित होती है।'
                  : "We'll send your parent/guardian a notice — this keeps your account safe under India's data protection rules."}
              </p>

              <label
                htmlFor="setup-parent-email"
                style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}
              >
                {isHi ? 'अभिभावक का ईमेल' : 'Parent/guardian email'}
              </label>
              <input
                id="setup-parent-email"
                type="email"
                autoComplete="email"
                value={parentEmail}
                onChange={(e) => setParentEmail(e.target.value)}
                onBlur={() => setParentEmailTouched(true)}
                placeholder={isHi ? 'parent@example.com' : 'parent@example.com'}
                className="input-base"
                style={{ width: '100%', minHeight: 44 }}
                aria-invalid={parentEmailTouched && !parentEmailValid ? 'true' : undefined}
                data-testid="setup-parent-email-input"
              />
              {parentEmailTouched && !parentEmailValid && (
                <p className="text-xs mt-1.5" style={{ color: 'var(--danger)', fontWeight: 600 }} data-testid="setup-parent-email-invalid">
                  {isHi ? 'कृपया एक सही ईमेल पता दर्ज करें' : 'Please enter a valid email address'}
                </p>
              )}
              {existingParentEmail && (
                <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>
                  {isHi
                    ? 'यह वही ईमेल है जो साइन अप के समय दर्ज किया गया था।'
                    : 'This is the same email you gave at signup.'}
                </p>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  onClick={goBack}
                  style={{ minHeight: 48, minWidth: 44, padding: '0 16px', borderRadius: 12, background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}
                >
                  {isHi ? 'पीछे' : 'Back'}
                </button>
                <button
                  type="button"
                  onClick={handleFinishFromParentStep}
                  disabled={saving || !parentEmail.trim()}
                  style={{ ...primaryBtnStyle, flex: 1, opacity: saving || !parentEmail.trim() ? 0.6 : 1 }}
                  data-testid="setup-parent-finish"
                >
                  {saving ? (isHi ? 'भेज रहे हैं...' : 'Sending...') : isHi ? 'पूरा करें' : 'Finish'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
