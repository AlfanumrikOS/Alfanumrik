'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import {
  getChapterTopics,
  getChapterQuestions,
  getTopicDiagrams,
  recordLearningEvent,
} from '@/lib/supabase';
import { Card, Button, ProgressBar, BottomNav, LoadingFoxy } from '@/components/ui';
import { SUBJECT_META, getSubjectsForGrade } from '@/lib/constants';
import { BLOOM_CONFIG, type BloomLevel } from '@/lib/cognitive-engine';
import type { CurriculumTopic } from '@/lib/types';
import { getPlanConfig } from '@/lib/plans';

// Must match the same limits used in learn/page.tsx
const SUBJECT_LIMIT_BY_TIER: Record<number, number> = { 0: 2, 1: 4 };

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

interface Question {
  id: string;
  question_text: string;
  question_hi: string | null;
  options: string | string[];
  correct_answer_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  bloom_level: string;
  difficulty: number;
  chapter_number: number;
}

interface Diagram {
  id: string;
  image_url: string;
  caption: string | null;
  caption_hi: string | null;
  alt_text: string | null;
}

interface ConceptState {
  selectedOption: number | null;
  submitted: boolean;
  isCorrect: boolean;
}

export default function ChapterConceptPage() {
  const router = useRouter();
  const params = useParams();
  const subject = params.subject as string;
  const chapterNum = parseInt(params.chapter as string, 10);

  const { student, isLoggedIn, isLoading, isHi } = useAuth();

  const [topics, setTopics] = useState<CurriculumTopic[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [diagrams, setDiagrams] = useState<Diagram[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);
  // Per-concept quick-check state, keyed by topic index
  const [conceptStates, setConceptStates] = useState<Record<number, ConceptState>>({});
  const [completedCount, setCompletedCount] = useState(0);
  const [showCompletion, setShowCompletion] = useState(false);

  const subMeta = SUBJECT_META.find(s => s.code === subject);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
  }, [isLoading, isLoggedIn, router]);

  // Plan-gate: redirect to /learn if this subject is locked for the student's plan
  useEffect(() => {
    if (!student || isLoading) return;
    const plan = getPlanConfig(student.subscription_plan);
    const subjectLimit = SUBJECT_LIMIT_BY_TIER[plan.tier] ?? Infinity;
    if (subjectLimit === Infinity) return; // pro/unlimited — all subjects unlocked
    const allowedCodes: string[] = getSubjectsForGrade(student.grade)
      .slice(0, subjectLimit)
      .map(s => s.code);
    if (!allowedCodes.includes(subject)) {
      router.replace('/learn');
    }
  }, [student, isLoading, subject, router]);

  const load = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    const grade = student.grade;
    const [topicsData, questionsData, diagramsData] = await Promise.all([
      getChapterTopics(subject, grade, chapterNum),
      getChapterQuestions(subject, grade, chapterNum, 30),
      getTopicDiagrams(subject, grade, chapterNum),
    ]);
    setTopics(topicsData as CurriculumTopic[]);
    setQuestions(questionsData as Question[]);
    setDiagrams(diagramsData as Diagram[]);
    setLoading(false);
  }, [student, subject, chapterNum]);

  useEffect(() => {
    if (student) load();
  }, [student?.id, load]);

  const parseOptions = (opts: string | string[]): string[] => {
    if (Array.isArray(opts)) return opts;
    try { return JSON.parse(opts); } catch { return []; }
  };

  const selectOption = (optIdx: number) => {
    if (conceptStates[currentIdx]?.submitted) return;
    setConceptStates(prev => ({
      ...prev,
      [currentIdx]: { selectedOption: optIdx, submitted: false, isCorrect: false },
    }));
  };

  const submitAnswer = () => {
    const state = conceptStates[currentIdx];
    if (!state || state.selectedOption === null || state.submitted) return;
    const q = questions[currentIdx % Math.max(questions.length, 1)];
    if (!q) return;
    const isCorrect = state.selectedOption === q.correct_answer_index;
    setConceptStates(prev => ({
      ...prev,
      [currentIdx]: { ...state, submitted: true, isCorrect },
    }));
    if (student && topics[currentIdx]) {
      recordLearningEvent(
        student.id,
        topics[currentIdx].id,
        isCorrect,
        'practice',
        topics[currentIdx].bloom_focus || 'remember',
      ).catch(() => {});
    }
    if (!conceptStates[currentIdx]?.submitted) {
      setCompletedCount(prev => prev + 1);
    }
  };

  const goNext = () => {
    if (currentIdx < topics.length - 1) {
      setCurrentIdx(i => i + 1);
    } else {
      setShowCompletion(true);
    }
  };

  const goPrev = () => {
    if (currentIdx > 0) setCurrentIdx(i => i - 1);
  };

  const askFoxy = () => {
    const topic = topics[currentIdx];
    const topicParam = topic ? encodeURIComponent(topic.title) : '';
    router.push(`/foxy?subject=${subject}&mode=doubt&topic=${topicParam}`);
  };

  if (isLoading || loading) return <LoadingFoxy />;

  if (!student) return null;

  // ── Completion screen ──
  if (showCompletion) {
    const correctCount = Object.values(conceptStates).filter(s => s.submitted && s.isCorrect).length;
    const totalAnswered = Object.values(conceptStates).filter(s => s.submitted).length;
    const pct = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;

    // Which concepts did the student get wrong?
    const wrongTopics = Object.entries(conceptStates)
      .filter(([, s]) => s.submitted && !s.isCorrect)
      .map(([idx]) => topics[parseInt(idx)])
      .filter(Boolean)
      .slice(0, 3);

    const scoreGood = pct >= 60 || totalAnswered === 0;
    const scoreLabel = totalAnswered === 0
      ? null
      : pct >= 80
        ? (isHi ? '🌟 शानदार! तुमने अध्याय में महारत हासिल की!' : '🌟 Excellent! You\'ve mastered this chapter!')
        : pct >= 60
          ? (isHi ? '👍 अच्छा! क्विज़ देने के लिए तैयार हो!' : '👍 Good work! Ready for the quiz!')
          : (isHi ? '💪 थोड़ा और अभ्यास करो — नीचे कमज़ोर अवधारणाएँ देखो' : '💪 A bit more practice needed — see weak concepts below');

    return (
      <div className="mesh-bg min-h-dvh pb-nav flex flex-col">
        <header className="page-header">
          <div className="page-header-inner flex items-center gap-3">
            <button onClick={() => router.push('/learn')} className="text-[var(--text-3)]">&larr;</button>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'अध्याय पूरा!' : 'Chapter Complete!'}
            </h1>
          </div>
        </header>
        <main className="app-container py-6 max-w-lg mx-auto flex flex-col gap-5">
          <div className="text-center py-4">
            <div className="text-6xl mb-3">🎉</div>
            <h2 className="text-2xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? `अध्याय ${chapterNum} पूरा!` : `Chapter ${chapterNum} Done!`}
            </h2>
            <p className="text-sm text-[var(--text-3)]">
              {subMeta?.name} · {isHi ? `${topics.length} अवधारणाएँ पढ़ीं` : `${topics.length} concepts covered`}
            </p>
            {scoreLabel && (
              <p className="text-sm font-semibold mt-3 px-4" style={{ color: scoreGood ? '#16A34A' : '#D97706' }}>
                {scoreLabel}
              </p>
            )}
          </div>

          {totalAnswered > 0 && (
            <Card>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-bold text-[var(--text-2)]">
                  {isHi ? 'त्वरित जाँच स्कोर' : 'Quick Check Score'}
                </span>
                <span className="text-lg font-bold" style={{ color: scoreGood ? '#16A34A' : '#DC2626' }}>
                  {correctCount}/{totalAnswered} ({pct}%)
                </span>
              </div>
              <ProgressBar value={pct} color={scoreGood ? '#16A34A' : '#DC2626'} showPercent />
            </Card>
          )}

          {/* Weak concepts — shown when score < 60% */}
          {wrongTopics.length > 0 && (
            <div className="rounded-2xl p-4" style={{ background: 'rgba(220,38,38,0.04)', border: '1px solid rgba(220,38,38,0.12)' }}>
              <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#DC2626' }}>
                {isHi ? '⚠️ इन अवधारणाओं पर और ध्यान दो' : '⚠️ Review these concepts'}
              </p>
              <div className="space-y-2">
                {wrongTopics.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(220,38,38,0.08)', color: '#DC2626' }}>✗</span>
                    <span className="text-xs text-[var(--text-2)]">{t.title}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => router.push(`/foxy?subject=${subject}&chapter=${chapterNum}&mode=doubt`)}
                className="mt-3 text-xs font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95"
                style={{ background: 'rgba(220,38,38,0.08)', color: '#DC2626', border: '1px solid rgba(220,38,38,0.2)' }}
              >
                🦊 {isHi ? 'Foxy से ये समझो' : 'Clear doubts with Foxy'}
              </button>
            </div>
          )}

          <div className="space-y-3">
            {scoreGood ? (
              <Button
                fullWidth
                color={subMeta?.color}
                onClick={() => router.push(`/quiz?subject=${subject}&chapter=${chapterNum}`)}
              >
                ⚡ {isHi ? `अध्याय ${chapterNum} का क्विज़ दो` : `Take Chapter ${chapterNum} Quiz`}
              </Button>
            ) : (
              <Button
                fullWidth
                color={subMeta?.color}
                onClick={askFoxy}
              >
                🦊 {isHi ? 'Foxy के साथ कमज़ोर हिस्से सुधारो' : 'Fix weak spots with Foxy'}
              </Button>
            )}
            <Button
              fullWidth
              variant="ghost"
              onClick={() => router.push(`/learn/${subject}/${chapterNum + 1}`)}
            >
              📖 {isHi ? `अगला अध्याय ${chapterNum + 1} →` : `Next Chapter ${chapterNum + 1} →`}
            </Button>
            {!scoreGood && (
              <Button
                fullWidth
                variant="ghost"
                onClick={() => router.push(`/quiz?subject=${subject}&chapter=${chapterNum}`)}
              >
                ⚡ {isHi ? 'फिर भी क्विज़ दो' : 'Take Quiz anyway'}
              </Button>
            )}
            <Button fullWidth variant="ghost" onClick={() => router.push('/learn')}>
              {isHi ? '← विषय सूची पर वापस जाओ' : '← Back to Subjects'}
            </Button>
          </div>
        </main>
        <BottomNav />
      </div>
    );
  }

  // ── No topics fallback ──
  if (topics.length === 0) {
    return (
      <div className="mesh-bg min-h-dvh pb-nav flex flex-col">
        <header className="page-header">
          <div className="page-header-inner flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">&larr;</button>
            <span className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {subMeta?.icon} {subMeta?.name} · {isHi ? `अध्याय ${chapterNum}` : `Chapter ${chapterNum}`}
            </span>
          </div>
        </header>
        <main className="app-container py-12 text-center">
          <div className="text-5xl mb-4">📚</div>
          <p className="text-base font-semibold text-[var(--text-2)] mb-2">
            {isHi ? 'अभी कोई अवधारणा नहीं मिली' : 'No concepts found for this chapter yet'}
          </p>
          <p className="text-sm text-[var(--text-3)] mb-6">
            {isHi ? 'Foxy से इस अध्याय के बारे में पूछो' : 'Ask Foxy to teach you this chapter'}
          </p>
          <Button onClick={askFoxy} color={subMeta?.color}>
            🦊 {isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
          </Button>
        </main>
        <BottomNav />
      </div>
    );
  }

  const topic = topics[currentIdx];
  const question = questions.length > 0 ? questions[currentIdx % questions.length] : null;
  const diagram = diagrams.length > 0 ? diagrams[currentIdx % diagrams.length] : null;
  const conceptState = conceptStates[currentIdx];
  const progressPct = ((currentIdx + 1) / topics.length) * 100;
  const bloomLevel = (topic.bloom_focus || 'remember') as BloomLevel;
  const bloomCfg = BLOOM_CONFIG[bloomLevel] || BLOOM_CONFIG.remember;
  const opts = question ? parseOptions(question.options) : [];
  const isAnswered = conceptState?.submitted ?? false;
  const isCorrect = conceptState?.isCorrect ?? false;

  return (
    <div className="mesh-bg min-h-dvh pb-nav flex flex-col">
      {/* Header */}
      <header className="page-header" style={{ background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}>
        <div className="app-container py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)] mr-1">&larr;</button>
              <span className="text-lg">{subMeta?.icon}</span>
              <span className="text-sm font-semibold truncate" style={{ color: subMeta?.color }}>
                {subMeta?.name} · {isHi ? `अध्याय ${chapterNum}` : `Chapter ${chapterNum}`}
              </span>
            </div>
            <span className="text-xs font-medium text-[var(--text-3)]">
              {currentIdx + 1}/{topics.length}
            </span>
          </div>
          <ProgressBar value={progressPct} color={subMeta?.color} height={5} />
        </div>
      </header>

      <main className="flex-1 app-container py-4 max-w-2xl mx-auto w-full flex flex-col gap-4">

        {/* Concept label */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-[var(--text-3)] uppercase tracking-wider">
            {isHi ? `अवधारणा ${currentIdx + 1}/${topics.length}` : `Concept ${currentIdx + 1} of ${topics.length}`}
          </span>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: `${bloomCfg.color}18`, color: bloomCfg.color }}
          >
            {bloomCfg.icon} {isHi ? bloomCfg.labelHi : bloomCfg.label}
          </span>
        </div>

        {/* Concept card */}
        <Card className="!p-5">
          {/* Title */}
          <h2 className="text-lg font-bold mb-3 leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi && (topic as { title_hi?: string | null }).title_hi
              ? (topic as { title_hi?: string | null }).title_hi
              : topic.title}
          </h2>

          {/* Diagram */}
          {diagram && diagram.image_url && (
            <div className="mb-4 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={diagram.image_url}
                alt={diagram.alt_text || topic.title}
                className="w-full object-contain max-h-52"
                style={{ background: 'var(--surface-2)' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              {(diagram.caption || diagram.caption_hi) && (
                <p className="text-[11px] text-[var(--text-3)] px-3 py-2 text-center">
                  {isHi && diagram.caption_hi ? diagram.caption_hi : diagram.caption}
                </p>
              )}
            </div>
          )}

          {/* Description */}
          {topic.description && (
            <p className="text-sm leading-relaxed text-[var(--text-2)] mb-3" style={{ whiteSpace: 'pre-wrap' }}>
              {topic.description}
            </p>
          )}

          {/* Learning Objectives */}
          {topic.learning_objectives && topic.learning_objectives.length > 0 && (
            <div className="rounded-xl p-3 mb-1" style={{ background: `${subMeta?.color || 'var(--orange)'}08`, border: `1px solid ${subMeta?.color || 'var(--orange)'}20` }}>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: subMeta?.color }}>
                {isHi ? 'इस अवधारणा में सीखोगे' : 'You will learn'}
              </p>
              <ul className="space-y-1">
                {topic.learning_objectives.slice(0, 4).map((obj, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[var(--text-2)]">
                    <span className="mt-0.5 flex-shrink-0" style={{ color: subMeta?.color }}>•</span>
                    {obj}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {/* Quick Check */}
        {question && (
          <div>
            <p className="text-[11px] font-bold text-[var(--text-3)] uppercase tracking-wider mb-2">
              {isHi ? '⚡ त्वरित जाँच' : '⚡ Quick Check'}
            </p>
            <Card className="!p-4">
              <p className="text-sm font-semibold leading-relaxed mb-4" style={{ whiteSpace: 'pre-wrap' }}>
                {isHi && question.question_hi ? question.question_hi : question.question_text}
              </p>

              <div className="space-y-2">
                {opts.map((opt, idx) => {
                  const letter = OPTION_LETTERS[idx] || String(idx + 1);
                  const optText = opt.replace(/^[A-D][\.\)]\s*/, '');
                  const isSelected = conceptState?.selectedOption === idx;
                  const isCorrectOpt = idx === question.correct_answer_index;

                  let bg = 'var(--surface-2)';
                  let border = 'transparent';
                  let textColor = 'var(--text-2)';
                  let letterBg = 'var(--surface-1)';
                  let letterColor = 'var(--text-3)';

                  if (isAnswered) {
                    if (isCorrectOpt) {
                      bg = 'rgba(22,163,74,0.08)'; border = 'rgba(22,163,74,0.4)';
                      textColor = '#16A34A'; letterBg = '#16A34A'; letterColor = '#fff';
                    } else if (isSelected) {
                      bg = 'rgba(220,38,38,0.06)'; border = 'rgba(220,38,38,0.3)';
                      textColor = '#DC2626'; letterBg = '#DC2626'; letterColor = '#fff';
                    }
                  } else if (isSelected) {
                    bg = `${subMeta?.color || 'var(--orange)'}08`;
                    border = subMeta?.color || 'var(--orange)';
                    letterBg = subMeta?.color || 'var(--orange)';
                    letterColor = '#fff';
                  }

                  return (
                    <button
                      key={idx}
                      onClick={() => selectOption(idx)}
                      disabled={isAnswered}
                      className="w-full rounded-xl py-3 px-3 flex items-center gap-3 transition-all active:scale-[0.98] text-left"
                      style={{ background: bg, border: `1.5px solid ${border}`, minHeight: 48 }}
                    >
                      <span className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all" style={{ background: letterBg, color: letterColor }}>
                        {letter}
                      </span>
                      <span className="text-sm font-medium leading-snug flex-1" style={{ color: textColor }}>
                        {optText}
                      </span>
                      {isAnswered && isCorrectOpt && <span className="ml-auto text-base flex-shrink-0">✓</span>}
                      {isAnswered && isSelected && !isCorrectOpt && <span className="ml-auto text-base flex-shrink-0">✗</span>}
                    </button>
                  );
                })}
              </div>

              {/* Check answer button */}
              {!isAnswered && (
                <Button
                  fullWidth
                  className="mt-3"
                  color={subMeta?.color}
                  onClick={submitAnswer}
                  disabled={conceptState?.selectedOption === undefined || conceptState?.selectedOption === null}
                >
                  {isHi ? 'जवाब जाँचो' : 'Check Answer'}
                </Button>
              )}

              {/* Explanation */}
              {isAnswered && (
                <div
                  className="mt-3 rounded-xl p-3"
                  style={{
                    background: isCorrect ? 'rgba(22,163,74,0.05)' : 'rgba(220,38,38,0.04)',
                    border: `1px solid ${isCorrect ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.12)'}`,
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span>{isCorrect ? '🎉' : '💡'}</span>
                    <span className="text-xs font-bold" style={{ color: isCorrect ? '#16A34A' : '#DC2626' }}>
                      {isCorrect
                        ? (isHi ? 'शाबाश! सही जवाब!' : 'Correct!')
                        : (isHi ? 'गलत — पर सीखो!' : 'Not quite — here\'s why:')}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-[var(--text-2)]">
                    {isHi && question.explanation_hi ? question.explanation_hi : question.explanation || (isHi ? 'ऊपर दी गई अवधारणा दोबारा पढ़ो।' : 'Review the concept above.')}
                  </p>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Navigation — Next is the primary action */}
        <div className="flex flex-col gap-2 mt-auto pb-2">
          <Button
            fullWidth
            color={subMeta?.color}
            onClick={goNext}
          >
            {currentIdx === topics.length - 1
              ? (isHi ? '✓ अध्याय पूरा करो' : '✓ Finish Chapter')
              : isHi
                ? `अगला: ${topics[currentIdx + 1]?.title?.slice(0, 28)} →`
                : `Next: ${topics[currentIdx + 1]?.title?.slice(0, 28)} →`}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={goPrev} disabled={currentIdx === 0} className="flex-1">
              ← {isHi ? 'पिछला' : 'Prev'}
            </Button>
            <Button variant="soft" color="#E8581C" onClick={askFoxy} className="flex-1">
              🦊 {isHi ? 'Foxy से पूछो' : 'Ask Foxy'}
            </Button>
          </div>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
