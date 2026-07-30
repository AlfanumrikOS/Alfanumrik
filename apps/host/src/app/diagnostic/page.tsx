'use client';

/**
 * /diagnostic — Diagnostic Assessment Page
 *
 * Student-facing cold-start placement check (grades 6-12). This is the single
 * hero CTA a brand-new student sees, so every failure mode has to land as an
 * honest, actionable screen — never a dead end and never a red error box for a
 * known content state.
 *
 * Flow:
 *   1. Setup screen   — grade (display-only when known) + subject selection
 *   2. Quiz screen    — up to 15 questions, one at a time, no timer
 *   3. Results screen — score, weak/strong topics, recommended difficulty, CTA
 *
 * Two additional NORMAL (non-error) screens, both driven by HTTP 200 responses
 * from /api/diagnostic/start:
 *   - 'insufficient' — the grade × subject pool cannot produce an honest
 *                      placement. Renders the spec §7.2 screen plus the
 *                      §5.4 fallback CTAs. `alternatives` is never empty.
 *   - 'stream'       — a grade 11/12 student has no stream yet (spec G4/§7.4).
 *
 * Spec: docs/superpowers/specs/2026-07-29-diagnostic-cold-start-correctness.md
 *
 * Constraints:
 *   - P3: no anti-cheat here (diagnostic is untimed and XP-neutral)
 *   - P5: grade is a STRING "6"-"12" everywhere it crosses a boundary
 *   - P7: bilingual (EN/HI) — all copy lives in ./copy.ts, none inline
 *   - P8: uses server-side auth in API routes; client only reads RLS-filtered data
 *   - P15: independent of onboarding funnel — no onboarding files modified
 */

import { useState, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';
import { LoadingFoxy, LockedCard, Skeleton } from '@alfanumrik/ui/ui';
import {
  DIAGNOSTIC_COPY as C,
  t,
  type Bilingual,
} from './copy';
import type {
  DiagnosticQuestion,
  DiagnosticResponse,
  DiagnosticSummary,
  DiagnosticAlternative,
  InsufficientState,
  DiagnosticScreen,
} from './types';

// ─── Lazy-loaded screens (P10 bundle budget) ─────────────────────
//
// Setup is the screen every student sees first, so it stays inline below.
// Quiz, results, insufficient-content and stream-required are all reached
// only after an async round trip to /api/diagnostic/start or /complete, so
// splitting them into their own chunks via next/dynamic keeps their JS out
// of this route's first-load bundle without changing behaviour — the extra
// chunk fetch overlaps a network round trip that was already happening.
// See scripts/check-bundle-size.mjs (P10 ratchet) and
// scripts/bundle-baseline.json's "/diagnostic" entry.
const StreamScreen = dynamic(() => import('./StreamScreen'), { loading: () => <LoadingFoxy /> });
const InsufficientScreen = dynamic(() => import('./InsufficientScreen'), { loading: () => <LoadingFoxy /> });
const QuizScreen = dynamic(() => import('./QuizScreen'), { loading: () => <LoadingFoxy /> });
const ResultsScreen = dynamic(() => import('./ResultsScreen'), { loading: () => <LoadingFoxy /> });

// ─── Constants ──────────────────────────────────────────────────

// P5: grades are STRINGS. Grades 11-12 are supported (spec G1) — the
// governance RPC behind /api/student/subjects is already stream- and
// plan-aware, so senior students need no client-side stream matrix.
// Kept as an inline `as const` tuple — NOT derived via GRADES.filter() —
// because `.filter()` would widen the type to string[] and break the
// `typeof …[number]` literal union used by the guard below.
const VALID_DIAGNOSTIC_GRADES = ['6', '7', '8', '9', '10', '11', '12'] as const;
type DiagnosticGrade = (typeof VALID_DIAGNOSTIC_GRADES)[number];

/** The full-form length. Anything shorter is a short form (spec §7.1). */
const DIAGNOSTIC_FULL_FORM = 15;

// Where "Choose stream" goes (spec §7.4): there is no standalone
// stream-selection route, so StreamScreen points at the dashboard. See
// STREAM_PICKER_ROUTE / its doc comment in ./StreamScreen.tsx for why.

// ─── Helpers ────────────────────────────────────────────────────

/** P5: normalise a profile grade to a bare string "6".."12", or '' if unusable. */
function normalizeGrade(raw: string | null | undefined): string {
  if (!raw) return '';
  const bare = String(raw).replace(/^(?:grade|class)\s*/i, '').trim();
  return (VALID_DIAGNOSTIC_GRADES as readonly string[]).includes(bare)
    ? (bare as DiagnosticGrade)
    : '';
}

/**
 * Flatten the /api/diagnostic/start envelope.
 *
 * ⚠️ DO NOT "SIMPLIFY" THIS TO A SINGLE SHAPE. It is deliberately tolerant.
 *
 * The route (`apps/host/src/app/api/diagnostic/start/route.ts`, verified
 * 2026-07-29) ships a SUPERSET of two contracts in one body — both are live
 * simultaneously, and each carries fields the other does not:
 *
 *   top level  — `{ ok, success, diagnostic: null, insufficientContent: true,
 *                   reason: 'INSUFFICIENT_POOL', message, headline, alternatives }`
 *                and `{ ok, success, diagnostic: null, streamRequired: true, … }`
 *   data.*     — the spec §5.3 F3 mirror: `content_insufficient`, `quality_tier`,
 *                and a `reason` carrying the FINER selector enum
 *                (`too_few_items` etc.) rather than the coarse
 *                `INSUFFICIENT_POOL`. On the success path `data` is where
 *                `session_id`, `questions`, `short_form_message` and
 *                `setup_reassurance` live.
 *
 * Spreading top-then-nested means `data.*` wins on key collision, so the finer
 * `data.reason` is what this page reads — which is the one we want for
 * telemetry. Deleting either branch breaks a shape the server is still
 * emitting, and deleting the merge breaks the success path outright.
 *
 * Keeping it is also cheap insurance: whichever side (web, mobile, backend)
 * next narrows its contract, this reader survives it.
 */
function readStartPayload(json: unknown): Record<string, unknown> {
  if (!json || typeof json !== 'object') return {};
  const top = json as Record<string, unknown>;
  const nested =
    top.data && typeof top.data === 'object' && !Array.isArray(top.data)
      ? (top.data as Record<string, unknown>)
      : {};
  return { ...top, ...nested };
}

/** Accept a `{ en, hi }` pair only when BOTH halves are real strings (P7). */
function asBilingual(raw: unknown): Bilingual | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.en !== 'string' || typeof r.hi !== 'string') return null;
  if (!r.en.trim() || !r.hi.trim()) return null;
  return { en: r.en, hi: r.hi };
}

/**
 * §5.4 F4 / AC-22: a student must NEVER reach a dead end. Drop malformed or
 * off-site entries, then guarantee at least the unconditional Foxy CTA even if
 * the server ever ships an empty list.
 */
function normalizeAlternatives(raw: unknown): DiagnosticAlternative[] {
  const out: DiagnosticAlternative[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const href = typeof r.href === 'string' ? r.href.trim() : '';
      // In-app routes only — an external or malformed href is a dead end.
      if (!href.startsWith('/')) continue;
      out.push({
        kind: typeof r.kind === 'string' ? r.kind : 'foxy',
        href,
        label: asBilingual(r.label),
      });
    }
  }
  if (out.length === 0) {
    out.push({ kind: 'foxy', href: '/foxy?from=diagnostic_unavailable', label: null });
  }
  return out;
}

/** Pull `?subject=` out of an in-app href, if present. */
function subjectFromHref(href: string): string {
  try {
    const qs = href.indexOf('?');
    if (qs < 0) return '';
    return new URLSearchParams(href.slice(qs + 1)).get('subject') ?? '';
  } catch {
    return '';
  }
}

// ─── Page Component ─────────────────────────────────────────────
// (CircleProgress lives in ./ResultsScreen.tsx now — it's only ever needed
// on the results screen, which is lazy-loaded; see the dynamic() imports above.)

export default function DiagnosticPage() {
  const { student, isLoggedIn, isLoading, isHi, activeRole } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isPostOnboarding = searchParams.get('ref') === 'onboarding';
  const subjectParam = searchParams.get('subject');

  // Subjects come from the governance RPC (get_available_subjects) via
  // /api/student/subjects — grade × stream × plan aware. The old hardcoded
  // SUBJECT_OPTIONS map was neither, and offered physics/chemistry/biology
  // separately for grades 9-10 (CBSE uses a single `science` there). Deleted
  // per spec G2; the RPC is now the single source of truth.
  const {
    unlocked: unlockedSubjects,
    locked: lockedSubjects,
    isLoading: subjectsLoading,
    error: subjectsError,
    refresh: refreshSubjects,
  } = useAllowedSubjects();

  // ── Navigation guard ──────────────────────────────────────────
  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.replace('/login');
    }
    if (!isLoading && isLoggedIn && activeRole !== 'student') {
      // Diagnostic is student-only
      router.replace(activeRole === 'teacher' ? '/teacher' : '/parent');
    }
  }, [isLoading, isLoggedIn, activeRole, router]);

  // ── Shared styles ─────────────────────────────────────────────
  const inputStyle: CSSProperties = {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 12,
    border: '1.5px solid var(--border)',
    background: 'var(--surface-2)',
    fontSize: 15,
    color: 'var(--text-1)',
    outline: 'none',
    fontFamily: 'var(--font-body)',
    appearance: 'none',
    transition: 'border-color 0.2s ease',
  };

  // ── Screen state ─────────────────────────────────────────────
  const [screen, setScreen] = useState<DiagnosticScreen>('setup');

  // ── Setup state ──────────────────────────────────────────────
  // Grade is DISPLAY-ONLY when the profile carries one (spec G3) — a Class 11
  // student must not be able to self-select "Class 8" and sit an off-syllabus
  // check. `pickedGrade` is only reachable when the profile has no usable grade.
  const profileGrade = useMemo(() => normalizeGrade(student?.grade), [student?.grade]);
  const gradeIsLocked = profileGrade !== '';
  const [pickedGrade, setPickedGrade] = useState('');
  const grade = gradeIsLocked ? profileGrade : pickedGrade;

  const [subject, setSubject] = useState('');
  const [setupError, setSetupError] = useState('');
  const [starting, setStarting] = useState(false);

  // ── Quiz state ───────────────────────────────────────────────
  const [sessionId, setSessionId] = useState('');
  const [questions, setQuestions] = useState<DiagnosticQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [responses, setResponses] = useState<DiagnosticResponse[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [quizError, setQuizError] = useState('');
  // §7.1 — the server's own verdict on the form it built. `quality_tier` is
  // assessment-owned (the blueprint ladder decides it); the client must not
  // second-guess it. '' means the field was absent from the response.
  const [qualityTier, setQualityTier] = useState('');
  // Pre-substituted bilingual banner from `data.short_form_message`. Server
  // copy wins when present — same posture the Flutter client takes — so the
  // two apps can never word the same state differently.
  const [shortFormMessage, setShortFormMessage] = useState<Bilingual | null>(null);
  // Track per-question start time (no timer display, but we record time_taken_seconds)
  const questionStartRef = useRef<number>(Date.now());

  // ── Degraded-content state (both are HTTP 200 NORMAL states) ──
  const [insufficient, setInsufficient] = useState<InsufficientState | null>(null);
  const [streamMessage, setStreamMessage] = useState<Bilingual | null>(null);

  // ── Results state ─────────────────────────────────────────────
  const [summary, setSummary] = useState<DiagnosticSummary | null>(null);

  // Deep-link prefill: the §5.4 "other subject" CTA navigates to
  // /diagnostic?subject=<code>. Only honour it once, and only for a subject the
  // governance RPC actually unlocked.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current || !subjectParam || subjectsLoading) return;
    if (unlockedSubjects.some((s) => s.code === subjectParam)) {
      setSubject(subjectParam);
      prefilledRef.current = true;
    }
  }, [subjectParam, subjectsLoading, unlockedSubjects]);

  // Drop a stale selection if the subject list changes underneath us (plan
  // downgrade, stream set, grade change). Never leave a locked/unknown code
  // selected — the server would 422 it.
  useEffect(() => {
    if (!subject || subjectsLoading) return;
    if (!unlockedSubjects.some((s) => s.code === subject)) setSubject('');
  }, [subject, subjectsLoading, unlockedSubjects]);

  // Reset question timer when question changes
  useEffect(() => {
    questionStartRef.current = Date.now();
  }, [currentIdx]);

  // ── Loading / redirect guards ─────────────────────────────────
  if (isLoading) return <LoadingFoxy />;
  if (!isLoggedIn || activeRole !== 'student') return <LoadingFoxy />;

  const currentQuestion = questions[currentIdx];
  const totalQuestions = questions.length;
  // §7.1 — show the banner when the SERVER says the form is short. The
  // `< 15` length test is only a fallback for a response that omits
  // `quality_tier` (older build, offline replay): it is a proxy, and a proxy
  // can disagree with the blueprint the server actually ran.
  const isShortForm =
    qualityTier !== ''
      ? qualityTier === 'short_form'
      : totalQuestions > 0 && totalQuestions < DIAGNOSTIC_FULL_FORM;

  function subjectLabelFor(code: string): string {
    const match =
      unlockedSubjects.find((s) => s.code === code) ??
      lockedSubjects.find((s) => s.code === code);
    if (!match) return code;
    return isHi ? match.nameHi : match.name;
  }

  // ─── Handler: start diagnostic ────────────────────────────────

  async function handleStart() {
    if (!grade) {
      setSetupError(t(C.chooseGradeError, isHi));
      return;
    }
    if (!subject) {
      setSetupError(t(C.chooseSubjectError, isHi));
      return;
    }
    setSetupError('');
    setStarting(true);

    try {
      const res = await fetch('/api/diagnostic/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // P5: grade crosses the boundary as a string.
        body: JSON.stringify({ grade, subject }),
      });
      const json = await res.json().catch(() => null);
      const payload = readStartPayload(json);
      const ok = payload.ok === true || payload.success === true;

      // NORMAL state — grades 11/12 with no stream yet (spec G4 / §7.4).
      // HTTP 200. Must NOT route into the red error UI.
      if (ok && (payload.streamRequired === true || payload.stream_required === true)) {
        setStreamMessage(asBilingual(payload.message));
        setScreen('stream');
        return;
      }

      // NORMAL state — the pool cannot produce an honest placement (§5.3).
      // HTTP 200, no diagnostic row created. Must NOT route into the red
      // error UI, and must always offer at least one real next action.
      //
      // Both keys are checked on purpose: the route emits `insufficientContent`
      // at the top level AND `content_insufficient` inside `data` (see
      // readStartPayload). Either one alone is a working contract today —
      // accepting both is what makes this page survive either side dropping
      // its half. Do not prune to one.
      if (ok && (payload.insufficientContent === true || payload.content_insufficient === true)) {
        setInsufficient({
          reason: typeof payload.reason === 'string' ? payload.reason : 'INSUFFICIENT_POOL',
          message: asBilingual(payload.message),
          alternatives: normalizeAlternatives(payload.alternatives),
          subjectCode: subject,
        });
        setScreen('insufficient');
        return;
      }

      if (!res.ok || !ok) {
        setSetupError(
          payload.error === 'subject_not_allowed'
            ? t(C.subjectNotAllowed, isHi)
            : t(C.startFailed, isHi),
        );
        setStarting(false);
        return;
      }

      const nextQuestions = Array.isArray(payload.questions)
        ? (payload.questions as DiagnosticQuestion[])
        : [];
      const nextSessionId = typeof payload.session_id === 'string' ? payload.session_id : '';

      if (!nextSessionId || nextQuestions.length === 0) {
        setSetupError(t(C.startFailed, isHi));
        setStarting(false);
        return;
      }

      // `rung` and `blueprint` also arrive on this response. They are
      // diagnostic metadata for backend/ops telemetry — deliberately NOT
      // surfaced to students, who should never see selector internals.
      setSessionId(nextSessionId);
      setQuestions(nextQuestions);
      // §7.1 — carry the server's verdict, not a client guess. Both fields are
      // optional; absent means fall back to the length proxy + local copy.
      setQualityTier(typeof payload.quality_tier === 'string' ? payload.quality_tier : '');
      setShortFormMessage(asBilingual(payload.short_form_message));
      setCurrentIdx(0);
      setResponses([]);
      setSelectedOption(null);
      questionStartRef.current = Date.now();
      setScreen('quiz');
    } catch {
      setSetupError(t(C.connectionError, isHi));
    } finally {
      setStarting(false);
    }
  }

  // ─── Handler: a fallback CTA on the insufficient screen ───────

  function handleAlternative(alt: DiagnosticAlternative) {
    const code = subjectFromHref(alt.href);
    // "Take the check in <subject> instead" targets this same route. A
    // router.push to /diagnostic?subject=x would not remount this client
    // component, so the student would sit on a stale screen — swap the
    // selection in place and drop them back on setup instead.
    if (code && alt.href.startsWith('/diagnostic')) {
      setSubject(code);
      setInsufficient(null);
      setSetupError('');
      // Drop any form metadata left over from an earlier attempt so the next
      // start cannot inherit a stale short-form verdict.
      setQualityTier('');
      setShortFormMessage(null);
      setScreen('setup');
      return;
    }
    router.push(alt.href);
  }

  function resetToSetup() {
    setScreen('setup');
    setInsufficient(null);
    setStreamMessage(null);
    setQualityTier('');
    setShortFormMessage(null);
    setResponses([]);
    setCurrentIdx(0);
    setSelectedOption(null);
    setQuizError('');
    setSetupError('');
    setSummary(null);
    setQuestions([]);
  }

  // ─── Handler: advance to next question ────────────────────────

  function handleNext() {
    if (selectedOption === null || !currentQuestion) return;

    const timeTaken = Math.round((Date.now() - questionStartRef.current) / 1000);
    const isCorrect = selectedOption === currentQuestion.correct_answer_index;

    const newResponse: DiagnosticResponse = {
      question_id: currentQuestion.id,
      selected_answer_index: selectedOption,
      is_correct: isCorrect,
      time_taken_seconds: timeTaken,
      topic: currentQuestion.topic_id ?? null,
      difficulty: currentQuestion.difficulty,
      bloom_level: currentQuestion.bloom_level,
    };

    const updatedResponses = [...responses, newResponse];
    setResponses(updatedResponses);
    setSelectedOption(null);

    if (currentIdx < totalQuestions - 1) {
      setCurrentIdx(currentIdx + 1);
    } else {
      // Last question — submit
      handleSubmit(updatedResponses);
    }
  }

  // ─── Handler: submit all responses ────────────────────────────

  async function handleSubmit(finalResponses: DiagnosticResponse[]) {
    setSubmitting(true);
    setQuizError('');

    try {
      const res = await fetch('/api/diagnostic/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, responses: finalResponses }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setQuizError(t(C.submitFailed, isHi));
        setSubmitting(false);
        return;
      }

      setSummary(json.data as DiagnosticSummary);
      setScreen('results');
    } catch {
      setQuizError(t(C.connectionError, isHi));
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Render: Setup screen ──────────────────────────────────────

  if (screen === 'setup') {
    const hasNoSubjects =
      !subjectsLoading && !subjectsError && unlockedSubjects.length === 0 && lockedSubjects.length === 0;

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
        <div style={{ width: '100%', maxWidth: 420, animation: 'slideUp 0.5s ease-out' }}>
          {/* Header — welcome variant when arriving from onboarding */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div className="animate-float" style={{ fontSize: 44, marginBottom: 12 }}>
              {isPostOnboarding ? '🧭' : '🎯'}
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
              {isPostOnboarding
                ? (isHi ? 'स्वागत है! आपकी शुरुआत खोजें' : "Welcome! Let's find your starting point")
                : (isHi ? 'डायग्नोस्टिक टेस्ट' : 'Diagnostic Assessment')}
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.6 }}>
              {isPostOnboarding
                ? (isHi
                  ? 'यह 10 मिनट का डायग्नोस्टिक क्विज़ Foxy को आपका स्तर समझने और पर्सनलाइज्ड स्टडी प्लान बनाने में मदद करता है।'
                  : 'This 10-minute diagnostic quiz helps Foxy understand your current level and create a personalised study plan.')
                : (isHi
                  ? '15 प्रश्नों का टेस्ट देकर जानें आप किस स्तर पर हैं।'
                  : 'Answer 15 questions to discover your current level and get personalised recommendations.')}
            </p>
          </div>

          {/* Card */}
          <div
            style={{
              borderRadius: 16,
              padding: 24,
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Grade — display-only when the profile carries one (spec G3) */}
              <div style={{ animation: 'slideUp 0.4s ease-out 0.1s both' }}>
                <label
                  htmlFor={gradeIsLocked ? undefined : 'diagnostic-grade'}
                  style={{
                    display: 'block',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text-2)',
                    marginBottom: 6,
                  }}
                >
                  {t(C.gradeLabel, isHi)}
                </label>

                {gradeIsLocked ? (
                  <div
                    style={{
                      ...inputStyle,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      minHeight: 44,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{t(C.gradeValue, isHi, { grade })}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>
                      {t(C.gradeFromProfile, isHi)}
                    </span>
                  </div>
                ) : (
                  <select
                    id="diagnostic-grade"
                    value={pickedGrade}
                    onChange={(e) => setPickedGrade(e.target.value)}
                    style={inputStyle}
                    aria-label={t(C.gradeSelectAria, isHi)}
                  >
                    <option value="" disabled>
                      {t(C.gradeSelectPlaceholder, isHi)}
                    </option>
                    {VALID_DIAGNOSTIC_GRADES.map((g) => (
                      <option key={g} value={g}>
                        {t(C.gradeValue, isHi, { grade: g })}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Subject selector — sourced from the governance RPC */}
              <div style={{ animation: 'slideUp 0.4s ease-out 0.15s both' }}>
                <p
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text-2)',
                    marginBottom: 8,
                  }}
                >
                  {t(C.subjectLabel, isHi)}
                </p>

                {/* Loading */}
                {subjectsLoading && (
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {[0, 1, 2, 3].map((i) => (
                        <Skeleton key={i} height={72} rounded="rounded-xl" />
                      ))}
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
                      {t(C.subjectsLoading, isHi)}
                    </p>
                  </div>
                )}

                {/* Error */}
                {!subjectsLoading && subjectsError && (
                  <div
                    role="alert"
                    style={{
                      fontSize: 13,
                      color: 'var(--danger)',
                      padding: '12px',
                      borderRadius: 10,
                      background: 'var(--danger-light)',
                      border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)',
                    }}
                  >
                    <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{t(C.subjectsError, isHi)}</p>
                    <button
                      type="button"
                      onClick={() => refreshSubjects()}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 10,
                        border: '1.5px solid var(--danger)',
                        background: 'transparent',
                        color: 'var(--danger)',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        minHeight: 44,
                      }}
                    >
                      {t(C.retry, isHi)}
                    </button>
                  </div>
                )}

                {/* Empty */}
                {hasNoSubjects && (
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 12,
                      background: 'var(--surface-2)',
                      border: '1px dashed var(--border-mid, var(--border))',
                      textAlign: 'center',
                    }}
                  >
                    <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-2)', margin: '0 0 4px' }}>
                      {t(C.subjectsEmptyTitle, isHi)}
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px', lineHeight: 1.5 }}>
                      {t(C.subjectsEmptyBody, isHi)}
                    </p>
                    <button
                      type="button"
                      onClick={() => router.push('/foxy?from=diagnostic_unavailable')}
                      style={{
                        padding: '10px 18px',
                        borderRadius: 10,
                        background: 'var(--accent)',
                        color: '#fff',
                        border: 'none',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        minHeight: 44,
                      }}
                    >
                      {t(C.altFoxy, isHi)}
                    </button>
                  </div>
                )}

                {/* Loaded */}
                {!subjectsLoading && !subjectsError && !hasNoSubjects && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {unlockedSubjects.map((opt) => {
                      const isSelected = subject === opt.code;
                      return (
                        <button
                          key={opt.code}
                          type="button"
                          onClick={() => setSubject(opt.code)}
                          style={{
                            padding: '12px 8px',
                            borderRadius: 10,
                            textAlign: 'center',
                            border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                            background: isSelected ? 'rgba(232,88,28,0.06)' : 'var(--surface-2)',
                            cursor: 'pointer',
                            transition: 'border-color 0.15s ease, background 0.15s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            minHeight: 44,
                          }}
                          aria-pressed={isSelected}
                        >
                          <span style={{ fontSize: 18 }} aria-hidden="true">{opt.icon}</span>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              lineHeight: 1.3,
                              color: isSelected ? 'var(--accent)' : 'var(--text-2)',
                            }}
                          >
                            {isHi ? opt.nameHi : opt.name}
                          </span>
                        </button>
                      );
                    })}

                    {/* Locked subjects are SHOWN, never hidden — same
                        LockedCard primitive and upgrade destination as /learn. */}
                    {lockedSubjects.map((opt) => (
                      <LockedCard
                        key={opt.code}
                        variant="plan"
                        icon={opt.icon}
                        title={isHi ? opt.nameHi : opt.name}
                        reason={t(C.lockedReason, isHi)}
                        actionLabel={t(C.lockedAction, isHi)}
                        onAction={() => router.push('/pricing')}
                        className="p-4"
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* §7.5c reassurance — the 5/6/4 blueprint intentionally includes
                  hard items, so an average student now scores ~65 rather than
                  ~95. Say so up front, or a correct placement reads as failure.

                  Read from local copy, NOT from the server's
                  `data.setup_reassurance`: this renders on the setup screen,
                  which is on screen BEFORE /api/diagnostic/start is called, so
                  the server's copy arrives too late to be useful here. Both
                  strings resolve to the same lib constant regardless. */}
              <p
                style={{
                  fontSize: 12,
                  color: 'var(--text-3)',
                  lineHeight: 1.5,
                  margin: 0,
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'var(--surface-2)',
                }}
              >
                💡 {t(C.reassurance, isHi)}
              </p>

              {/* Error */}
              {setupError && (
                <div
                  role="alert"
                  style={{
                    fontSize: 13,
                    color: 'var(--danger)',
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: 'var(--danger-light)',
                    border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)',
                    fontWeight: 600,
                  }}
                >
                  {setupError}
                </div>
              )}

              {/* Start button */}
              <button
                type="button"
                disabled={!grade || !subject || starting}
                onClick={handleStart}
                style={{
                  width: '100%',
                  padding: '14px 0',
                  borderRadius: 12,
                  background:
                    grade && subject
                      ? 'linear-gradient(135deg, #E8590C, #F59E0B)'
                      : 'var(--surface-3)',
                  color: grade && subject ? '#fff' : 'var(--text-3)',
                  border: 'none',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: grade && subject && !starting ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s ease',
                  animation: 'slideUp 0.4s ease-out 0.3s both',
                  minHeight: 44,
                }}
              >
                {starting
                  ? (isHi ? 'लोड हो रहा है...' : 'Loading...')
                  : (isHi ? 'टेस्ट शुरू करें' : 'Start Diagnostic')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Stream-required screen (NORMAL state, not an error) ─
  // Lazy-loaded — see ./StreamScreen.tsx and the dynamic() import above.

  if (screen === 'stream') {
    return (
      <StreamScreen
        isHi={isHi}
        grade={grade}
        streamMessage={streamMessage}
        onGoBack={resetToSetup}
      />
    );
  }

  // ─── Render: Insufficient-content screen (NORMAL state, not an error) ─
  // Lazy-loaded — see ./InsufficientScreen.tsx and the dynamic() import above.

  if (screen === 'insufficient' && insufficient) {
    return (
      <InsufficientScreen
        isHi={isHi}
        grade={grade}
        insufficient={insufficient}
        subjectLabelFor={subjectLabelFor}
        subjectFromHref={subjectFromHref}
        onAlternative={handleAlternative}
        onGoBack={resetToSetup}
      />
    );
  }

  // ─── Render: Quiz screen ───────────────────────────────────────
  // Lazy-loaded — see ./QuizScreen.tsx and the dynamic() import above.

  if (screen === 'quiz') {
    return (
      <QuizScreen
        isHi={isHi}
        currentQuestion={currentQuestion}
        totalQuestions={totalQuestions}
        currentIdx={currentIdx}
        selectedOption={selectedOption}
        onSelectOption={setSelectedOption}
        onNext={handleNext}
        submitting={submitting}
        quizError={quizError}
        isShortForm={isShortForm}
        shortFormMessage={shortFormMessage}
        onGoBack={resetToSetup}
      />
    );
  }

  // ─── Render: Results screen ────────────────────────────────────
  // Lazy-loaded — see ./ResultsScreen.tsx and the dynamic() import above.

  if (screen === 'results' && summary) {
    return (
      <ResultsScreen
        isHi={isHi}
        isPostOnboarding={isPostOnboarding}
        summary={summary}
        onPrimaryCta={() => router.push(isPostOnboarding ? '/dashboard' : '/quiz')}
        onRetake={resetToSetup}
      />
    );
  }

  // Fallback (should not be reached)
  return <LoadingFoxy />;
}
