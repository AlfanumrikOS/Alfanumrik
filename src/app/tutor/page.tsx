/**
 * /tutor — the Adaptive Tutor Phase 0 page.
 *
 * One concept on screen, decided server-side by /api/tutor/next. After the
 * student answers the MCQ we POST to /api/tutor/answer (mastery upsert +
 * state-bus event), then refetch /api/tutor/next to advance.
 *
 * Phase 0 covers: concept card → 1 MCQ → mastery write → next concept.
 * Phase 1 adds the "re-teach with worked example" branch on wrong answer.
 * Phase 2 hands off to Foxy on repeated misses.
 *
 * Flag: ff_tutor_v1. When OFF, /api/tutor/next returns 404 and this page
 * shows a friendly "coming soon" with a back link to /dashboard. Falls
 * back rather than redirecting so deep-linked URLs don't bounce.
 *
 * ADR: docs/architecture/ADR-004-adaptive-tutor.md
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { Card, Button, ProgressBar, BottomNav, LoadingFoxy } from '@/components/ui';
import type { TutorNextResponse, TutorConceptRow } from '@/lib/tutor/types';
import { track } from '@/lib/posthog/client';

function parseOptions(opts: unknown): string[] {
  if (Array.isArray(opts)) return opts.map(String);
  if (typeof opts === 'string') {
    try { return JSON.parse(opts) as string[]; } catch { return []; }
  }
  return [];
}

export default function TutorPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading, isHi } = useAuth();
  const [data, setData] = useState<TutorNextResponse | null>(null);
  const [error, setError] = useState<'unauthenticated' | 'flag_off' | 'no_profile' | 'server' | null>(null);
  const [loading, setLoading] = useState(true);
  // Per-concept local UI state, reset every time the resolver returns a new id.
  const [chosenIdx, setChosenIdx] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ correct: boolean } | null>(null);
  const [answerStartedAt, setAnswerStartedAt] = useState<number>(Date.now());

  // ── Auth gate ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  // ── Fetch the next concept ──────────────────────────────────────────
  const fetchNext = useCallback(async () => {
    setLoading(true);
    setChosenIdx(null);
    setFeedback(null);
    setError(null);
    try {
      const res = await fetch('/api/tutor/next', { cache: 'no-store' });
      if (res.status === 401) { setError('unauthenticated'); return; }
      if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error === 'no_student_profile' ? 'no_profile' : 'flag_off');
        return;
      }
      if (!res.ok) { setError('server'); return; }
      const json = (await res.json()) as TutorNextResponse;
      setData(json);
      setAnswerStartedAt(Date.now());
      track('tutor_concept_viewed', {
        concept_id: json.concept?.id ?? null,
        subject: json.concept?.subject ?? null,
        chapter_number: json.concept?.chapter_number ?? null,
        status: json.status,
      });
    } catch {
      setError('server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) void fetchNext();
  }, [isLoggedIn, fetchNext]);

  // ── Submit the answer ───────────────────────────────────────────────
  const submitAnswer = async () => {
    if (chosenIdx === null || !data?.concept || submitting) return;
    const concept = data.concept;
    const correctIdx = concept.practice_correct_index;
    if (correctIdx === null) return;
    const correct = chosenIdx === correctIdx;
    setSubmitting(true);
    setFeedback({ correct });
    track('tutor_answer_submitted', {
      concept_id: concept.id,
      correct,
      chosen_index: chosenIdx,
      response_time_ms: Date.now() - answerStartedAt,
    });
    try {
      await fetch('/api/tutor/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          concept_id: concept.id,
          chosen_index: chosenIdx,
          correct,
          response_time_ms: Date.now() - answerStartedAt,
        }),
      });
    } catch {
      // Submission failure is non-fatal here — we still show feedback and
      // let the student advance. The mastery write will retry on the next
      // answer (idempotency-by-time on the publish path).
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading / error states ──────────────────────────────────────────
  if (isLoading || loading) return <LoadingFoxy />;
  if (!isLoggedIn) return null;

  if (error === 'flag_off') {
    return (
      <div className="mesh-bg min-h-dvh pb-nav flex flex-col">
        <main className="app-container py-12 text-center max-w-md mx-auto">
          <div className="text-5xl mb-3">🦊</div>
          <h1 className="text-xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'जल्द ही आएगा' : 'Coming soon'}
          </h1>
          <p className="text-sm text-[var(--text-3)] mb-6">
            {isHi
              ? 'अनुकूली ट्यूटर अभी सेट किया जा रहा है। तब तक /learn से अभ्यास करते रहो।'
              : 'The Adaptive Tutor is rolling out. In the meantime, keep practising from /learn.'}
          </p>
          <Button onClick={() => router.push('/dashboard')}>← {isHi ? 'डैशबोर्ड' : 'Back to dashboard'}</Button>
        </main>
        <BottomNav />
      </div>
    );
  }

  if (error === 'no_profile' || error === 'unauthenticated') {
    return (
      <div className="mesh-bg min-h-dvh pb-nav flex flex-col">
        <main className="app-container py-12 text-center max-w-md mx-auto">
          <p className="text-base font-semibold mb-4">
            {isHi ? 'पहले अपना खाता पूरा करो' : 'Finish setting up your account to start learning.'}
          </p>
          <Button onClick={() => router.push('/welcome')}>{isHi ? 'चलें' : 'Get started'}</Button>
        </main>
        <BottomNav />
      </div>
    );
  }

  if (error === 'server' || !data) {
    return (
      <div className="mesh-bg min-h-dvh pb-nav flex flex-col">
        <main className="app-container py-12 text-center">
          <p className="text-base mb-4">{isHi ? 'कुछ गड़बड़ हुई।' : 'Something went wrong.'}</p>
          <Button onClick={() => void fetchNext()}>{isHi ? 'फिर कोशिश करें' : 'Try again'}</Button>
        </main>
      </div>
    );
  }

  // ── Terminal states ─────────────────────────────────────────────────
  if (data.status === 'grade_complete') {
    return (
      <div className="mesh-bg min-h-dvh pb-nav flex flex-col">
        <header className="page-header"><div className="page-header-inner">
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'बधाई हो!' : 'Congratulations!'}
          </h1>
        </div></header>
        <main className="app-container py-12 text-center max-w-md mx-auto">
          <div className="text-6xl mb-3">🎉</div>
          <h2 className="text-xl font-bold mb-2">
            {isHi ? 'पूरा कक्षा-स्तर पूरा हो गया!' : "You've mastered every concept in your grade!"}
          </h2>
          <p className="text-sm text-[var(--text-3)] mb-2">
            {isHi
              ? `${data.progress?.total ?? 0} में से ${data.progress?.mastered ?? 0} अवधारणाएँ`
              : `${data.progress?.mastered ?? 0} of ${data.progress?.total ?? 0} concepts mastered.`}
          </p>
          <p className="text-xs text-[var(--text-3)] mb-6">
            {isHi
              ? 'अध्यापक से अगली कक्षा खोलने को कहो। पुरानी अवधारणाओं की दोबारा जाँच जल्द ही।'
              : 'Ask your teacher to unlock the next grade. Spaced-repetition review coming soon.'}
          </p>
          <Button onClick={() => router.push('/dashboard')}>← {isHi ? 'डैशबोर्ड' : 'Dashboard'}</Button>
        </main>
        <BottomNav />
      </div>
    );
  }

  if (data.status === 'no_content' || !data.concept) {
    return (
      <div className="mesh-bg min-h-dvh pb-nav flex flex-col">
        <main className="app-container py-12 text-center max-w-md mx-auto">
          <div className="text-5xl mb-3">📚</div>
          <p className="text-base font-semibold mb-3">
            {isHi ? 'अभी इस कक्षा का पाठ्यक्रम तैयार नहीं है' : 'Curriculum content for your grade is still being prepared.'}
          </p>
          <Button onClick={() => router.push('/dashboard')}>← {isHi ? 'डैशबोर्ड' : 'Dashboard'}</Button>
        </main>
        <BottomNav />
      </div>
    );
  }

  // ── Active state: concept on screen ─────────────────────────────────
  return <ConceptScreen
    concept={data.concept}
    progress={data.progress}
    isHi={isHi}
    chosenIdx={chosenIdx}
    setChosenIdx={setChosenIdx}
    feedback={feedback}
    submitting={submitting}
    onSubmit={submitAnswer}
    onNext={() => void fetchNext()}
  />;
}

interface ConceptScreenProps {
  concept: TutorConceptRow;
  progress: { mastered: number; total: number } | undefined;
  isHi: boolean;
  chosenIdx: number | null;
  setChosenIdx: (n: number) => void;
  feedback: { correct: boolean } | null;
  submitting: boolean;
  onSubmit: () => void;
  onNext: () => void;
}

function ConceptScreen(p: ConceptScreenProps) {
  const router = useRouter();
  const c = p.concept;
  const lang = p.isHi ? 'hi' : 'en';
  const title = p.isHi && c.title_hi ? c.title_hi : (c.title ?? '');
  const explanation = p.isHi && c.explanation_hi ? c.explanation_hi : (c.explanation ?? '');
  const example = p.isHi && c.example_content_hi ? c.example_content_hi : c.example_content;
  const options = parseOptions(c.practice_options);
  const correctIdx = c.practice_correct_index ?? -1;
  const explanationText = p.isHi && c.practice_explanation_hi
    ? c.practice_explanation_hi
    : (c.practice_explanation ?? '');
  const showFeedback = p.feedback !== null;
  const totalPct = p.progress && p.progress.total > 0
    ? Math.round((p.progress.mastered / p.progress.total) * 100)
    : 0;

  return (
    <div className="mesh-bg min-h-dvh pb-nav flex flex-col" lang={lang}>
      {/* Header — minimal: progress only, no chapter pickers */}
      <header className="page-header" style={{ background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(20px)' }}>
        <div className="app-container py-3">
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)] mr-1" aria-label="dashboard">&larr;</button>
            <span className="text-xs font-medium text-[var(--text-3)]">
              {p.isHi ? 'कक्षा प्रगति' : 'Grade progress'}: {p.progress?.mastered ?? 0}/{p.progress?.total ?? 0} ({totalPct}%)
            </span>
          </div>
          <ProgressBar value={totalPct} height={4} />
        </div>
      </header>

      <main className="flex-1 app-container py-4 max-w-2xl mx-auto w-full flex flex-col gap-4">

        {/* Subject + chapter breadcrumb — small, informational only */}
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[var(--text-3)] font-semibold">
          <span>{c.subject}</span>
          <span>·</span>
          <span>{p.isHi ? `अध्याय ${c.chapter_number}` : `Chapter ${c.chapter_number}`}</span>
          {c.chapter_title && <><span>·</span><span className="truncate">{c.chapter_title}</span></>}
        </div>

        {/* Concept card */}
        <Card className="!p-5">
          <h1 className="text-xl font-bold mb-3 leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
            {title}
          </h1>
          <p className="text-sm leading-relaxed text-[var(--text-2)] mb-4" style={{ whiteSpace: 'pre-wrap' }}>
            {explanation}
          </p>
          {example && (
            <div className="rounded-xl p-4 mb-2" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)' }}>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#D97706' }}>
                {p.isHi ? 'उदाहरण' : 'Worked example'}
              </div>
              <p className="text-sm leading-relaxed text-[var(--text-2)]" style={{ whiteSpace: 'pre-wrap' }}>
                {example}
              </p>
            </div>
          )}
          {c.key_formula && (
            <div className="rounded-lg px-3 py-2 mt-3" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)' }}>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#4F46E5' }}>
                {p.isHi ? 'मुख्य सूत्र' : 'Key formula'}
              </div>
              <code className="text-sm font-mono text-[var(--text-2)]">{c.key_formula}</code>
            </div>
          )}
        </Card>

        {/* Concept check */}
        <Card className="!p-5">
          <p className="text-sm font-semibold mb-3 text-[var(--text-2)]">
            {p.isHi ? 'समझ की जाँच' : 'Check your understanding'}
          </p>
          <p className="text-base mb-4 leading-snug">{c.practice_question}</p>
          <div className="space-y-2 mb-4">
            {options.map((opt, idx) => {
              const isChosen = p.chosenIdx === idx;
              const isCorrect = idx === correctIdx;
              const showColor = showFeedback && (isChosen || isCorrect);
              const cls = !showColor
                ? isChosen
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-slate-300 bg-white hover:bg-slate-50'
                : isCorrect
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                  : 'border-rose-500 bg-rose-50 text-rose-900';
              return (
                <button
                  key={idx}
                  type="button"
                  disabled={showFeedback}
                  onClick={() => p.setChosenIdx(idx)}
                  className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition-all ${cls}`}
                >
                  {opt}
                </button>
              );
            })}
          </div>

          {!showFeedback ? (
            <Button fullWidth onClick={p.onSubmit} disabled={p.chosenIdx === null || p.submitting}>
              {p.isHi ? 'जाँचें' : 'Check'}
            </Button>
          ) : (
            <>
              <div className={`rounded-lg p-4 mb-3 ${p.feedback?.correct ? 'bg-emerald-50' : 'bg-rose-50'}`}>
                <p className={`text-sm font-semibold mb-1 ${p.feedback?.correct ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {p.feedback?.correct
                    ? (p.isHi ? '✓ सही!' : '✓ Correct!')
                    : (p.isHi ? '✗ अभी नहीं' : '✗ Not quite')}
                </p>
                {explanationText && (
                  <p className="text-sm text-[var(--text-2)]" style={{ whiteSpace: 'pre-wrap' }}>{explanationText}</p>
                )}
              </div>
              <Button fullWidth onClick={p.onNext}>
                {p.isHi ? 'अगली अवधारणा →' : 'Next concept →'}
              </Button>
            </>
          )}
        </Card>

        {/* Foxy escape hatch — Phase 3 wires this to invoke the tutor inline. */}
        <button
          type="button"
          onClick={() => router.push(`/foxy?mode=doubt&topic=${encodeURIComponent(c.title ?? '')}`)}
          className="text-xs text-[var(--text-3)] underline mx-auto"
        >
          {p.isHi ? '🦊 इस पर Foxy से पूछो' : '🦊 Ask Foxy about this concept'}
        </button>
      </main>

      <BottomNav />
    </div>
  );
}
