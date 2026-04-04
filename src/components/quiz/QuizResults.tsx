'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Button, StatCard, BottomNav } from '@/components/ui';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { SUBJECT_META } from '@/lib/constants';
import {
  BLOOM_CONFIG, BLOOM_LEVELS,
  type BloomLevel, type CognitiveLoadState,
} from '@/lib/cognitive-engine';
import { shareResult, quizShareMessage } from '@/lib/share';
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
  onRetry,
  onGoHome,
}: QuizResultsProps) {
  const router = useRouter();
  const [expandedCorrect, setExpandedCorrect] = useState<Set<number>>(new Set());
  const [showCelebration, setShowCelebration] = useState(true);

  const parseOptions = (opts: string | string[]): string[] => {
    if (Array.isArray(opts)) return opts;
    try { return JSON.parse(opts); } catch { return []; }
  };

  // Play completion sound on mount
  useEffect(() => {
    import('@/lib/sounds').then(({ playSound }) => playSound('complete'));
  }, []);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  const subMeta = SUBJECT_META.find(s => s.code === selectedSubject);
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

        {/* CME Next Action Recommendation */}
        {results.cme_next_action && (
          <NextActionCard
            action={results.cme_next_action as 'teach' | 'practice' | 'challenge' | 'revise' | 'remediate' | 'exam_prep'}
            conceptId={results.cme_next_concept_id || null}
            reason={results.cme_reason || ''}
            isHi={isHi}
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
                      style={{ background: correct ? '#16A34A' : '#DC2626', color: '#fff' }}
                    >
                      {correct ? '✓' : '✗'}
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
                      {/* Options */}
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
          <Button fullWidth onClick={onRetry}>
            {isHi ? 'एक और क्विज़ खेलो' : 'Take Another Quiz'} ⚡
          </Button>
          {pct < 60 && (
            <Button fullWidth variant="ghost" onClick={() => router.push('/foxy')}>
              🦊 {isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
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
