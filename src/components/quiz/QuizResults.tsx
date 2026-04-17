'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Button, StatCard, BottomNav } from '@/components/ui';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import {
  BLOOM_CONFIG, BLOOM_LEVELS,
  type BloomLevel, type CognitiveLoadState,
} from '@/lib/cognitive-engine';
import { shareResult, quizShareMessage } from '@/lib/share';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import NextActionCard from '@/components/quiz/NextActionCard';
import CelebrationOverlay from '@/components/quiz/CelebrationOverlay';
import type { ErrorType } from '@/lib/cognitive-engine';

interface Question {
  id: string;
  question_text: string;
  question_hi: string | null;
  question_type: string;
  options: string | string[];
  correct_answer_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  hint: string | null;
  difficulty: number;
  bloom_level: string;
  chapter_number: number;
}

interface Response {
  question_id: string;
  selected_option: number;
  is_correct: boolean;
  time_spent: number;
  error_type?: ErrorType;
  // Written answer fields (populated for SA/MA/LA)
  student_answer_text?: string;
  marks_awarded?: number;
  marks_possible?: number;
  rubric_feedback?: string;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

interface QuizResultsProps {
  results: {
    total: number;
    correct: number;
    score_percent: number;
    xp_earned: number;
    session_id: string;
    cme_next_action?: string;
    cme_next_concept_id?: string;
    cme_reason?: string;
  };
  questions: Question[];
  responses: Response[];
  isHi: boolean;
  quizMode: 'practice' | 'cognitive' | 'exam';
  cogLoad: CognitiveLoadState;
  selectedSubject: string | null;
  studentName: string;
  timer: number;
  isFirstQuiz?: boolean;
  onRetry: () => void;
  onGoHome: () => void;
}

export default function QuizResults({
  results,
  questions,
  responses,
  isHi,
  quizMode,
  cogLoad,
  selectedSubject,
  studentName,
  timer,
  isFirstQuiz = false,
  onRetry,
  onGoHome,
}: QuizResultsProps) {
  const router = useRouter();
  const { student } = useAuth();
  const [expandedCorrect, setExpandedCorrect] = useState<Set<number>>(new Set());
  const [showCelebration, setShowCelebration] = useState(true);
  const [flashcardCount, setFlashcardCount] = useState(0);
  const [flashcardBanner, setFlashcardBanner] = useState(false);
  const flashcardCreated = useRef(false);

  const parseOptions = (opts: string | string[]): string[] => {
    if (Array.isArray(opts)) return opts;
    try { return JSON.parse(opts); } catch { return []; }
  };

  // Play completion sound on mount
  useEffect(() => {
    import('@/lib/sounds').then(({ playSound }) => playSound('complete'));
  }, []);

  // Auto-create flashcards from wrong answers
  useEffect(() => {
    if (flashcardCreated.current || !student?.id) return;
    flashcardCreated.current = true;

    const wrongIndices = responses
      .map((r, i) => (!r.is_correct ? i : -1))
      .filter(i => i >= 0);
    if (wrongIndices.length === 0) return;

    (async () => {
      try {
        // Check for existing cards to avoid duplicates
        const questionTexts = wrongIndices.map(i => questions[i].question_text);
        const { data: existing } = await supabase
          .from('spaced_repetition_cards')
          .select('front_text')
          .eq('student_id', student.id)
          .in('front_text', questionTexts);
        const existingSet = new Set((existing ?? []).map(c => c.front_text));

        const cardsToInsert = wrongIndices
          .filter(i => !existingSet.has(questions[i].question_text))
          .map(i => {
            const q = questions[i];
            const r = responses[i];
            const opts = parseOptions(q.options);
            const correctAnswer = opts[q.correct_answer_index] || '';
            const explanation = isHi && q.explanation_hi ? q.explanation_hi : (q.explanation || '');
            return {
              student_id: student.id,
              card_type: 'review',
              subject: selectedSubject || undefined,
              chapter_number: q.chapter_number || undefined,
              topic: q.bloom_level || undefined,
              front_text: q.question_text,
              back_text: `${correctAnswer}${explanation ? `\n\n${explanation}` : ''}`,
              hint: q.hint || undefined,
              source: 'quiz_wrong_answer',
              source_id: results.session_id || undefined,
            };
          });

        if (cardsToInsert.length > 0) {
          await supabase.from('spaced_repetition_cards').insert(cardsToInsert);
          setFlashcardCount(cardsToInsert.length);
          setFlashcardBanner(true);
        }
      } catch (err) {
        // Non-critical — flashcard creation should not block results display
        console.error('Failed to create flashcards:', err);
      }
    })();
  }, [student?.id, questions, responses, results.session_id, selectedSubject, isHi]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  const { unlocked: allowedSubjects } = useAllowedSubjects();
  const subMeta = allowedSubjects.find(s => s.code === selectedSubject);
  const pct = results.score_percent;
  const grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 40 ? 'D' : 'F';
  const emoji = pct >= 80 ? '🏆' : pct >= 60 ? '👍' : pct >= 40 ? '💪' : '📚';
  const message = pct >= 80
    ? (isHi ? 'शानदार! तुम तो CBSE topper हो!' : 'Outstanding! You nailed it!')
    : pct >= 60
      ? (isHi ? 'बहुत अच्छा! थोड़ा और अभ्यास करो!' : 'Good job! A little more practice!')
      : pct >= 40
        ? (isHi ? 'ठीक है! रिव्यू करके फिर try करो!' : 'Keep going! Review and try again!')
        : (isHi ? 'हर विशेषज्ञ कभी शुरुआती था। चलो मिलकर सीखते हैं!' : 'Every expert was once a beginner. Let\'s review together!');

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
     {/* Celebration overlay — auto-dismisses after 3s */}
     {showCelebration && (
       <CelebrationOverlay
         scorePercent={pct}
         xpEarned={results.xp_earned}
         isHi={isHi}
         onDismiss={() => setShowCelebration(false)}
       />
     )}
     <SectionErrorBoundary section="Quiz Results">
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <button onClick={onRetry} className="text-[var(--text-3)]">&larr;</button>
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'क्विज़ नतीजे' : 'Quiz Results'}
          </h1>
        </div>
      </header>
      <main className="app-container py-6 space-y-5 max-w-lg mx-auto">
        {/* First Quiz Celebration */}
        {isFirstQuiz && (
          <div className="bg-gradient-to-br from-purple-500 to-orange-400 rounded-2xl p-6 text-center text-white animate-scale-in">
            <div className="text-5xl mb-3">🎊</div>
            <h2 className="text-2xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'पहला क्विज़ पूरा!' : 'First Quiz Complete!'}
            </h2>
            <p className="text-sm opacity-90 mb-4">
              {isHi ? 'तुमने शुरुआत की — यही सबसे ज़रूरी कदम है!' : "You've started — that's the most important step!"}
            </p>
            <div className="flex gap-3 justify-center">
              <a href="/foxy" className="px-4 py-2 bg-white/20 rounded-lg text-sm backdrop-blur-sm hover:bg-white/30 transition-colors">
                {isHi ? '🦊 फॉक्सी से बात करो' : '🦊 Chat with Foxy'}
              </a>
              <a href="/learn" className="px-4 py-2 bg-white/20 rounded-lg text-sm backdrop-blur-sm hover:bg-white/30 transition-colors">
                {isHi ? '📚 पढ़ना शुरू करो' : '📚 Start Learning'}
              </a>
            </div>
          </div>
        )}

        {/* Score Card */}
        <Card accent={pct >= 60 ? 'var(--success)' : 'var(--danger)'}>
          <div className="text-center py-4">
            <div className="text-5xl mb-3">{emoji}</div>
            <div className="text-6xl font-bold mb-1 animate-score-reveal" style={{ fontFamily: 'var(--font-display)', color: pct >= 60 ? 'var(--success)' : 'var(--danger)' }}>
              {pct}%
            </div>
            <div className="text-xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
              Grade: {grade}
            </div>
            <p className="text-sm text-[var(--text-3)]">{message}</p>
          </div>
        </Card>

        {/* Stats Grid */}
        <div className="grid-stats">
          <StatCard icon="✓" value={results.correct} label={isHi ? 'सही' : 'Correct'} color="#16A34A" />
          <StatCard icon="✗" value={results.total - results.correct} label={isHi ? 'गलत' : 'Wrong'} color="#DC2626" />
          <StatCard icon="✨" value={`+${results.xp_earned}`} label="XP" color="var(--orange)" />
          <StatCard icon="⏱" value={formatTime(timer)} label={isHi ? 'समय' : 'Time'} color="var(--teal)" />
        </div>

        {/* Post-quiz nudge -- contextual encouragement based on score */}
        {(() => {
          const subjectParam = selectedSubject || '';
          if (pct >= 80) {
            return (
              <div
                className="rounded-2xl p-4 flex items-center gap-3"
                style={{ background: 'rgba(22,163,74,0.06)', border: '1.5px solid rgba(22,163,74,0.15)' }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                  style={{ background: 'rgba(22,163,74,0.12)' }}>🚀</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold" style={{ color: '#16A34A' }}>
                    {isHi ? 'शानदार! अब Level Up करो' : 'Great score! Ready to level up?'}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    {isHi ? 'कठिन सवालों से खुद को challenge करो' : 'Challenge yourself with harder questions'}
                  </p>
                </div>
                <button
                  onClick={() => router.push('/quiz')}
                  className="flex-shrink-0 text-xs font-bold px-3 py-2 rounded-xl transition-all active:scale-95"
                  style={{ background: '#16A34A', color: '#fff' }}
                >
                  {isHi ? 'करो →' : 'Go →'}
                </button>
              </div>
            );
          } else if (pct < 50) {
            return (
              <div
                className="rounded-2xl p-4 flex items-center gap-3"
                style={{ background: 'rgba(232,88,28,0.06)', border: '1.5px solid rgba(232,88,28,0.15)' }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                  style={{ background: 'rgba(232,88,28,0.12)' }}>🦊</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold" style={{ color: 'var(--orange)' }}>
                    {isHi ? 'Foxy तुम्हारी मदद कर सकती है!' : 'Foxy can help you improve!'}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    {isHi ? 'कमजोर topics को step-by-step समझो' : 'Get step-by-step help on weak topics'}
                  </p>
                </div>
                <button
                  onClick={() => router.push(`/foxy?subject=${subjectParam}&mode=doubt`)}
                  className="flex-shrink-0 text-xs font-bold px-3 py-2 rounded-xl transition-all active:scale-95"
                  style={{ background: 'var(--orange)', color: '#fff' }}
                >
                  {isHi ? 'पूछो →' : 'Ask →'}
                </button>
              </div>
            );
          } else {
            return (
              <div
                className="rounded-2xl p-4 flex items-center gap-3"
                style={{ background: 'rgba(59,130,246,0.06)', border: '1.5px solid rgba(59,130,246,0.15)' }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                  style={{ background: 'rgba(59,130,246,0.12)' }}>💪</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold" style={{ color: '#3B82F6' }}>
                    {isHi ? 'अच्छा काम! और अभ्यास करो' : 'Good effort! Keep practicing'}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    {isHi ? 'एक और क्विज़ से score बढ़ाओ' : 'One more quiz to push your score higher'}
                  </p>
                </div>
                <button
                  onClick={onRetry}
                  className="flex-shrink-0 text-xs font-bold px-3 py-2 rounded-xl transition-all active:scale-95"
                  style={{ background: '#3B82F6', color: '#fff' }}
                >
                  {isHi ? 'फिर से →' : 'Retry →'}
                </button>
              </div>
            );
          }
        })()}

        {/* Separate MCQ/Written subscores — shown when quiz has both types */}
        {(() => {
          const mcqResponses = responses.filter((r) => r.selected_option >= 0);
          const writtenResponses = responses.filter((r) => r.selected_option < 0 && r.student_answer_text !== undefined);
          if (mcqResponses.length === 0 || writtenResponses.length === 0) return null;
          const mcqCorrect = mcqResponses.filter(r => r.is_correct).length;
          const mcqPct = Math.round((mcqCorrect / mcqResponses.length) * 100);
          const writtenEarned = writtenResponses.reduce((sum, r) => sum + (r.marks_awarded ?? 0), 0);
          const writtenPossible = writtenResponses.reduce((sum, r) => sum + (r.marks_possible ?? 0), 0);
          const writtenPct = writtenPossible > 0 ? Math.round((writtenEarned / writtenPossible) * 100) : 0;
          return (
            <Card className="!p-4">
              <p className="text-xs font-semibold text-[var(--text-3)] mb-3 uppercase tracking-wider">
                {isHi ? 'अंकों का विवरण' : 'Score Breakdown'}
              </p>
              <div className="space-y-3">
                {/* MCQ subscore */}
                <div className="flex items-center gap-3">
                  <span className="text-base flex-shrink-0">⭕</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>MCQ</span>
                      <span className="text-xs font-bold" style={{ color: mcqPct >= 60 ? '#16A34A' : '#DC2626' }}>{mcqPct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${mcqPct}%`, background: mcqPct >= 60 ? '#16A34A' : '#DC2626' }} />
                    </div>
                    <span className="text-[10px] text-[var(--text-3)] mt-0.5 block">
                      {mcqCorrect}/{mcqResponses.length} {isHi ? 'सही' : 'correct'}
                    </span>
                  </div>
                </div>
                {/* Written subscore */}
                <div className="flex items-center gap-3">
                  <span className="text-base flex-shrink-0">✏️</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                        {isHi ? 'लिखित' : 'Written'}
                      </span>
                      <span className="text-xs font-bold" style={{ color: writtenPct >= 60 ? '#16A34A' : '#DC2626' }}>{writtenPct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${writtenPct}%`, background: writtenPct >= 60 ? '#16A34A' : '#DC2626' }} />
                    </div>
                    <span className="text-[10px] text-[var(--text-3)] mt-0.5 block">
                      {writtenEarned}/{writtenPossible} {isHi ? 'अंक' : 'marks'}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          );
        })()}

        {/* ── Ask Foxy about your weakest topic ── */}
        {(() => {
          // Find the bloom level with the highest wrong rate (>0 wrong answers)
          const bloomStats: Record<string, { wrong: number; total: number }> = {};
          questions.forEach((q, i) => {
            const bl = q.bloom_level || 'remember';
            if (!bloomStats[bl]) bloomStats[bl] = { wrong: 0, total: 0 };
            bloomStats[bl].total++;
            if (!responses[i]?.is_correct) bloomStats[bl].wrong++;
          });
          const worstEntry = Object.entries(bloomStats)
            .filter(([, s]) => s.wrong > 0)
            .sort(([, a], [, b]) => b.wrong / b.total - a.wrong / a.total)[0];
          if (!worstEntry) return null;
          const [worstBloom] = worstEntry;
          const bloomLabels: Record<string, { en: string; hi: string }> = {
            remember: { en: 'Recall & Memory', hi: 'याद करना' },
            understand: { en: 'Understanding', hi: 'समझना' },
            apply: { en: 'Application', hi: 'लागू करना' },
            analyze: { en: 'Analysis', hi: 'विश्लेषण' },
            evaluate: { en: 'Evaluation', hi: 'मूल्यांकन' },
            create: { en: 'Creative Thinking', hi: 'सृजन' },
          };
          const topicLabel = bloomLabels[worstBloom] ?? { en: worstBloom, hi: worstBloom };
          const subjectParam = selectedSubject ? `&subject=${encodeURIComponent(selectedSubject)}` : '';
          const foxyHref = `/foxy?mode=doubt&bloom=${encodeURIComponent(worstBloom)}${subjectParam}`;
          return (
            <div
              className="rounded-2xl p-4 flex items-center gap-4"
              style={{
                background: 'linear-gradient(135deg, rgba(232,88,28,0.06), rgba(245,166,35,0.06))',
                border: '1.5px solid rgba(232,88,28,0.18)',
              }}
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: 'rgba(232,88,28,0.12)' }}
              >
                🦊
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                  {isHi
                    ? `"${topicLabel.hi}" में मदद चाहिए?`
                    : `Struggling with ${topicLabel.en}?`}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {isHi ? 'Foxy तुम्हें step-by-step समझाएगी' : 'Foxy will explain it step by step'}
                </p>
              </div>
              <button
                onClick={() => router.push(foxyHref)}
                className="flex-shrink-0 text-sm font-bold px-4 py-2 rounded-xl transition-all active:scale-95"
                style={{ background: 'var(--orange)', color: '#fff' }}
              >
                {isHi ? 'पूछो →' : 'Ask →'}
              </button>
            </div>
          );
        })()}

        {/* Flashcard creation banner */}
        {flashcardBanner && flashcardCount > 0 && (
          <div
            className="rounded-xl p-3 flex items-center gap-3"
            style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)' }}
          >
            <span className="text-2xl flex-shrink-0">📝</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold" style={{ color: '#7C3AED' }}>
                {isHi
                  ? `${flashcardCount} फ्लैशकार्ड बन गए तुम्हारी गलतियों से — रिव्यू करो और master करो!`
                  : `${flashcardCount} flashcard${flashcardCount > 1 ? 's' : ''} created from your mistakes — review them to master these concepts!`}
              </p>
            </div>
            <button
              onClick={() => router.push('/review')}
              className="flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95"
              style={{ background: 'rgba(124,58,237,0.12)', color: '#7C3AED' }}
            >
              {isHi ? 'रिव्यू करो' : 'Review'}
            </button>
          </div>
        )}

        {/* CME Next Action Recommendation */}
        {results.cme_next_action && (
          <NextActionCard
            action={results.cme_next_action as 'teach' | 'practice' | 'challenge' | 'revise' | 'remediate' | 'exam_prep'}
            conceptId={results.cme_next_concept_id || null}
            reason={results.cme_reason || ''}
            isHi={isHi}
            wrongAnswerCount={results.total - results.correct}
            scorePercent={pct}
            subject={selectedSubject}
            onRetry={onRetry}
            onAction={(action, conceptId) => {
              const mode = action === 'teach' ? 'learn'
                : action === 'revise' ? 'revision'
                : action === 'remediate' ? 'doubt'
                : action === 'exam_prep' ? 'quiz'
                : action === 'practice' ? 'quiz'
                : 'quiz'; // challenge
              router.push(`/foxy?mode=${mode}${conceptId ? `&topic_id=${conceptId}` : ''}`);
            }}
          />
        )}

        {/* Error Classification Breakdown */}
        {responses.some(r => !r.is_correct) && (
          <div>
            <p className="text-sm font-semibold text-[var(--text-2)] mb-3">
              {isHi ? 'गलती विश्लेषण' : 'Error Breakdown'}
            </p>
            <Card className="!p-4">
              <div className="space-y-2">
                {(() => {
                  const wrongResponses = responses.filter(r => !r.is_correct);
                  const careless = wrongResponses.filter(r => r.error_type === 'careless').length;
                  const conceptual = wrongResponses.filter(r => r.error_type === 'conceptual').length;
                  const misinterpretation = wrongResponses.filter(r => r.error_type === 'misinterpretation').length;
                  const total = wrongResponses.length;
                  const items = [
                    { label: isHi ? 'लापरवाही' : 'Careless', count: careless, color: '#F59E0B', icon: '⚡' },
                    { label: isHi ? 'अवधारणा' : 'Conceptual', count: conceptual, color: '#EF4444', icon: '🧠' },
                    { label: isHi ? 'गलत समझ' : 'Misinterpretation', count: misinterpretation, color: '#8B5CF6', icon: '🔍' },
                  ];
                  return items.map(item => (
                    <div key={item.label} className="flex items-center gap-3">
                      <span className="text-xs w-5 text-center">{item.icon}</span>
                      <span className="text-xs font-semibold w-28" style={{ color: item.color }}>{item.label}</span>
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: `${item.color}15` }}>
                        <div className="h-full rounded-full transition-all" style={{ width: total > 0 ? `${(item.count / total) * 100}%` : '0%', background: item.color }} />
                      </div>
                      <span className="text-[10px] text-[var(--text-3)] w-12 text-right">
                        {item.count} ({total > 0 ? Math.round((item.count / total) * 100) : 0}%)
                      </span>
                    </div>
                  ));
                })()}
              </div>
            </Card>
          </div>
        )}

        {/* Bloom Analysis */}
        {quizMode === 'cognitive' && (
          <div>
            <p className="text-sm font-semibold text-[var(--text-2)] mb-3">
              {isHi ? 'ब्लूम विश्लेषण' : 'Bloom Analysis'}
            </p>
            <Card className="!p-4">
              <div className="space-y-2">
                {BLOOM_LEVELS.map(bl => {
                  const bc = BLOOM_CONFIG[bl];
                  const qsAtLevel = questions.filter(qq => (qq.bloom_level || 'remember') === bl);
                  const correctAtLevel = qsAtLevel.filter((qq) => {
                    const qIdx = questions.indexOf(qq);
                    return responses[qIdx]?.is_correct;
                  }).length;
                  if (qsAtLevel.length === 0) return null;
                  const pctCorrect = Math.round((correctAtLevel / qsAtLevel.length) * 100);
                  return (
                    <div key={bl} className="flex items-center gap-3">
                      <span className="text-xs w-5 text-center" style={{ color: bc.color }}>{bc.icon}</span>
                      <span className="text-xs font-semibold w-20" style={{ color: bc.color }}>
                        {isHi ? bc.labelHi : bc.label}
                      </span>
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: `${bc.color}15` }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${pctCorrect}%`, background: bc.color }} />
                      </div>
                      <span className="text-[10px] text-[var(--text-3)] w-16 text-right">
                        {correctAtLevel}/{qsAtLevel.length} ({pctCorrect}%)
                      </span>
                    </div>
                  );
                })}
              </div>
              {cogLoad.fatigueScore > 0.3 && (
                <div className="mt-3 pt-3 border-t flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-sm">😮‍💨</span>
                  <span className="text-[10px] text-[var(--text-3)]">
                    {isHi ? `थकान स्कोर: ${Math.round(cogLoad.fatigueScore * 100)}%` : `Fatigue detected: ${Math.round(cogLoad.fatigueScore * 100)}%`}
                  </span>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Question Review */}
        <div>
          <p className="text-sm font-semibold text-[var(--text-2)] mb-3">
            {isHi ? 'सवालों की समीक्षा' : 'Question Review'}
          </p>
          <div className="space-y-3">
            {questions.map((question, idx) => {
              const resp = responses[idx];
              const correct = resp?.is_correct;
              const isExpanded = !correct || expandedCorrect.has(idx);
              const opts = parseOptions(question.options);
              const correctAnswerText = opts[question.correct_answer_index] || '';
              const questionText = isHi && question.question_hi ? question.question_hi : question.question_text;
              const explanation = isHi && question.explanation_hi ? question.explanation_hi : question.explanation;
              return (
                <div
                  key={question.id}
                  className="rounded-xl overflow-hidden"
                  style={{
                    background: correct ? 'rgba(22,163,74,0.04)' : 'rgba(220,38,38,0.04)',
                    border: `1px solid ${correct ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.2)'}`,
                  }}
                >
                  {/* Header row */}
                  <button
                    className="w-full p-3 flex items-center gap-3 text-left"
                    onClick={() => {
                      if (correct) {
                        setExpandedCorrect(prev => {
                          const next = new Set(prev);
                          next.has(idx) ? next.delete(idx) : next.add(idx);
                          return next;
                        });
                      }
                    }}
                  >
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{
                        background: correct ? '#16A34A'
                          : (resp?.student_answer_text !== undefined && (resp?.marks_awarded ?? 0) > 0) ? '#F59E0B'
                          : '#DC2626',
                        color: '#fff',
                      }}
                    >
                      {resp?.student_answer_text !== undefined && resp?.selected_option < 0
                        ? `${resp.marks_awarded ?? 0}`
                        : (correct ? '✓' : '✗')}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                        Q{idx + 1}. {questionText.substring(0, 90)}{questionText.length > 90 ? '...' : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-[var(--text-3)]">{resp?.time_spent || 0}s</span>
                      {correct && (
                        <span className="text-[10px] text-[var(--text-3)]">{isExpanded ? '▲' : '▼'}</span>
                      )}
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2">
                      {/* Written answer display — when response has student_answer_text */}
                      {resp?.student_answer_text !== undefined && resp?.selected_option < 0 ? (
                        <>
                          {/* Student's written answer */}
                          {resp.student_answer_text && (
                            <div className="rounded-lg px-3 py-2 text-[11px] leading-relaxed" style={{ background: 'var(--surface-1)', color: 'var(--text-2)' }}>
                              <span className="font-semibold block mb-1" style={{ color: 'var(--text-3)' }}>
                                {isHi ? 'तुम्हारा उत्तर:' : 'Your answer:'}
                              </span>
                              <p className="whitespace-pre-wrap">{resp.student_answer_text}</p>
                            </div>
                          )}

                          {/* Marks awarded */}
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
                            style={{
                              background: (resp.marks_awarded ?? 0) >= (resp.marks_possible ?? 1)
                                ? 'rgba(22,163,74,0.08)' : (resp.marks_awarded ?? 0) > 0
                                ? 'rgba(245,158,11,0.08)' : 'rgba(220,38,38,0.06)',
                              border: `1px solid ${(resp.marks_awarded ?? 0) >= (resp.marks_possible ?? 1)
                                ? 'rgba(22,163,74,0.2)' : (resp.marks_awarded ?? 0) > 0
                                ? 'rgba(245,158,11,0.2)' : 'rgba(220,38,38,0.15)'}`,
                            }}>
                            <span className="text-sm font-bold"
                              style={{
                                color: (resp.marks_awarded ?? 0) >= (resp.marks_possible ?? 1)
                                  ? '#16A34A' : (resp.marks_awarded ?? 0) > 0
                                  ? '#F59E0B' : '#DC2626',
                              }}>
                              {resp.marks_awarded ?? 0}/{resp.marks_possible ?? 0} {isHi ? 'अंक' : 'marks'}
                            </span>
                          </div>

                          {/* AI rubric feedback */}
                          {resp.rubric_feedback && resp.rubric_feedback !== 'Skipped' && (
                            <div className="rounded-lg px-3 py-2 text-[11px] leading-relaxed" style={{ background: 'rgba(124,58,237,0.05)', border: '1px solid rgba(124,58,237,0.12)', color: 'var(--text-2)' }}>
                              <span className="font-semibold" style={{ color: '#7C3AED' }}>
                                {isHi ? 'AI मूल्यांकन: ' : 'AI Feedback: '}
                              </span>
                              {resp.rubric_feedback}
                            </div>
                          )}

                          {/* Model answer (from explanation field) */}
                          {explanation && (
                            <div className="rounded-lg px-3 py-2 text-[11px] leading-relaxed" style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.12)', color: 'var(--text-2)' }}>
                              <span className="font-semibold" style={{ color: '#3B82F6' }}>
                                {isHi ? 'आदर्श उत्तर: ' : 'Model Answer: '}
                              </span>
                              {explanation}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          {/* MCQ Options */}
                          {opts.length > 0 && (
                            <div className="space-y-1">
                              {opts.map((opt, oi) => {
                                const isCorrectOpt = oi === question.correct_answer_index;
                                const isSelected = oi === resp?.selected_option;
                                let bg = 'var(--surface-2)';
                                let borderColor = 'transparent';
                                let textColor = 'var(--text-3)';
                                if (isCorrectOpt) { bg = 'rgba(22,163,74,0.1)'; borderColor = '#16A34A'; textColor = '#16A34A'; }
                                else if (isSelected && !correct) { bg = 'rgba(220,38,38,0.08)'; borderColor = '#DC2626'; textColor = '#DC2626'; }
                                return (
                                  <div
                                    key={oi}
                                    className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px]"
                                    style={{ background: bg, border: `1px solid ${borderColor}`, color: textColor }}
                                  >
                                    <span className="font-bold w-4 flex-shrink-0">{OPTION_LETTERS[oi]}.</span>
                                    <span className="flex-1">{opt}</span>
                                    {isCorrectOpt && <span className="flex-shrink-0">✓</span>}
                                    {isSelected && !correct && <span className="flex-shrink-0">✗</span>}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Explanation */}
                          {explanation && (
                            <div className="rounded-lg px-3 py-2 text-[11px] leading-relaxed" style={{ background: 'var(--surface-1)', color: 'var(--text-3)' }}>
                              <span className="font-semibold" style={{ color: 'var(--text-2)' }}>
                                {isHi ? 'व्याख्या: ' : 'Explanation: '}
                              </span>
                              {explanation}
                            </div>
                          )}
                        </>
                      )}

                      {/* Study link */}
                      {!correct && selectedSubject && question.chapter_number && (
                        <button
                          onClick={() => router.push(`/learn/${selectedSubject}/${question.chapter_number}`)}
                          className="text-[11px] font-semibold px-3 py-1.5 rounded-lg w-full text-left"
                          style={{ background: `${subMeta?.color || '#7C3AED'}15`, color: subMeta?.color || '#7C3AED' }}
                        >
                          📖 {isHi ? `अध्याय ${question.chapter_number} के concept पढ़ो ->` : `Study Chapter ${question.chapter_number} concepts ->`}
                        </button>
                      )}

                      {/* Ask Foxy deep-link for wrong answers */}
                      {!correct && (
                        <button
                          className="w-full rounded-lg py-2 px-3 flex items-center justify-center gap-2 text-xs font-semibold transition-colors"
                          style={{ background: 'var(--orange)', color: '#fff' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            const subjectParam = selectedSubject || '';
                            const msg = encodeURIComponent(
                              `Explain why the answer to "${questionText.substring(0, 120)}" is "${correctAnswerText}"`
                            );
                            router.push(`/foxy?subject=${subjectParam}&mode=doubt&message=${msg}`);
                          }}
                        >
                          <span>🦊</span>
                          {isHi ? 'Foxy से पूछो' : 'Ask Foxy'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Chapters to Review */}
        {(() => {
          const weakChapters = [...new Set(
            responses
              .map((r, i) => (!r.is_correct && questions[i]?.chapter_number) ? questions[i].chapter_number : null)
              .filter((c): c is number => c !== null)
          )];
          if (weakChapters.length === 0 || !selectedSubject) return null;
          return (
            <div>
              <p className="text-sm font-semibold text-[var(--text-2)] mb-3">
                {isHi ? 'इन अध्यायों को दोबारा पढ़ो' : 'Chapters to Review'}
              </p>
              <Card className="!p-4">
                <div className="space-y-2">
                  {weakChapters.map(ch => (
                    <button
                      key={ch}
                      onClick={() => router.push(`/learn/${selectedSubject}/${ch}`)}
                      className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all active:scale-[0.98]"
                      style={{ background: `${subMeta?.color || '#7C3AED'}10`, border: `1px solid ${subMeta?.color || '#7C3AED'}30` }}
                    >
                      <span className="text-base">{subMeta?.icon || '📚'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold" style={{ color: subMeta?.color || '#7C3AED' }}>
                          {isHi ? `अध्याय ${ch}` : `Chapter ${ch}`}
                        </div>
                        <div className="text-[10px] text-[var(--text-3)]">
                          {isHi ? 'concepts और notes देखो' : 'Review concepts & notes'}
                        </div>
                      </div>
                      <span className="text-[10px]" style={{ color: subMeta?.color || '#7C3AED' }}>→</span>
                    </button>
                  ))}
                </div>
              </Card>
            </div>
          );
        })()}

        {/* Action Buttons */}
        <div className="space-y-2">
          {/* Share — the growth engine. Indian parents share on WhatsApp. */}
          <Button
            fullWidth
            onClick={() => shareResult(quizShareMessage({
              studentName,
              subject: subMeta?.name || selectedSubject!,
              score: pct,
              xpEarned: results.xp_earned,
              isHi,
            }))}
            style={{ background: '#25D366', color: '#fff' }}
          >
            {isHi ? '📱 WhatsApp पर शेयर करो' : '📱 Share on WhatsApp'}
          </Button>
          {/* Review Mistakes — shown when flashcards were created */}
          {flashcardCount > 0 && (
            <Button
              fullWidth
              onClick={() => router.push('/review?filter=quiz_wrong_answer')}
              style={{ background: '#7C3AED', color: '#fff' }}
            >
              📝 {isHi ? 'गलतियाँ रिव्यू करो' : 'Review Your Mistakes'}
            </Button>
          )}
          <Button fullWidth onClick={onRetry}>
            {isHi ? 'एक और क्विज़ खेलो' : 'Take Another Quiz'} ⚡
          </Button>
          {/* Score-contextual actions */}
          {pct < 50 && (
            <Button fullWidth variant="ghost" onClick={() => router.push(`/foxy?subject=${selectedSubject || ''}&mode=learn`)}>
              📖 {isHi ? 'बुनियादी बातें सीखो' : 'Review Basics with Foxy'}
            </Button>
          )}
          {pct >= 50 && pct <= 80 && (
            <Button fullWidth variant="ghost" onClick={() => router.push(`/foxy?subject=${selectedSubject || ''}&mode=practice`)}>
              🦊 {isHi ? 'और अभ्यास करो' : 'Practice More with Foxy'}
            </Button>
          )}
          {pct > 80 && (
            <Button fullWidth variant="ghost" onClick={() => router.push('/quiz')}>
              🚀 {isHi ? 'Level Up करो' : 'Level Up — Harder Quiz'}
            </Button>
          )}
          <Button fullWidth variant="ghost" onClick={onGoHome}>
            {isHi ? 'होम' : 'Home'}
          </Button>
        </div>
      </main>
     </SectionErrorBoundary>
      <BottomNav />
    </div>
  );
}
