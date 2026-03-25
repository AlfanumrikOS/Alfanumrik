'use client';

import { useRouter } from 'next/navigation';
import { Card, Button, StatCard, BottomNav } from '@/components/ui';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { SUBJECT_META } from '@/lib/constants';
import {
  BLOOM_CONFIG, BLOOM_LEVELS,
  type BloomLevel, type CognitiveLoadState,
} from '@/lib/cognitive-engine';
import { shareResult, quizShareMessage } from '@/lib/share';
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
        : (isHi ? 'कोई बात नहीं! Foxy से सीखो!' : 'No worries! Learn with Foxy first!');

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
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
        <Card accent={pct >= 60 ? '#16A34A' : '#DC2626'}>
          <div className="text-center py-4">
            <div className="text-5xl mb-3">{emoji}</div>
            <div className="text-6xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)', color: pct >= 60 ? '#16A34A' : '#DC2626' }}>
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
          <StatCard icon="⭐" value={`+${results.xp_earned}`} label="XP" color="var(--orange)" />
          <StatCard icon="⏱" value={formatTime(timer)} label={isHi ? 'समय' : 'Time'} color="var(--teal)" />
        </div>

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
          <div className="space-y-2">
            {questions.map((question, idx) => {
              const resp = responses[idx];
              const correct = resp?.is_correct;
              return (
                <div
                  key={question.id}
                  className="rounded-xl p-3 flex items-center gap-3"
                  style={{
                    background: correct ? 'rgba(22,163,74,0.06)' : 'rgba(220,38,38,0.04)',
                    border: `1px solid ${correct ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.12)'}`,
                  }}
                >
                  <span
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{
                      background: correct ? '#16A34A' : '#DC2626',
                      color: '#fff',
                    }}
                  >
                    {correct ? '✓' : '✗'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate" style={{ color: 'var(--text-2)' }}>
                      {question.question_text.substring(0, 80)}{question.question_text.length > 80 ? '...' : ''}
                    </div>
                    {!correct && (
                      <div className="text-[10px] text-[var(--text-3)] mt-0.5">
                        {isHi ? 'सही:' : 'Correct:'} {OPTION_LETTERS[question.correct_answer_index]}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-[var(--text-3)] flex-shrink-0">
                    {resp?.time_spent || 0}s
                  </span>
                </div>
              );
            })}
          </div>
        </div>

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
