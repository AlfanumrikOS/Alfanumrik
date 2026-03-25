'use client';

import { useState } from 'react';
import { Card, Button, BottomNav } from '@/components/ui';
import { SUBJECT_META } from '@/lib/constants';

type QuizMode = 'practice' | 'cognitive' | 'exam';

const DIFF_LABELS = [
  { id: null, label: 'All Levels', labelHi: 'सभी स्तर', icon: '🎯' },
  { id: 1, label: 'Easy', labelHi: 'आसान', icon: '🟢' },
  { id: 2, label: 'Medium', labelHi: 'मध्यम', icon: '🟡' },
  { id: 3, label: 'Hard', labelHi: 'कठिन', icon: '🔴' },
];

interface QuizSetupProps {
  isHi: boolean;
  initialSubject: string | null;
  initialMode: QuizMode;
  loading: boolean;
  onStart: (opts: {
    subject: string;
    difficulty: number | null;
    questionCount: number;
    quizMode: QuizMode;
    examTimeLimit: number;
  }) => void;
  onGoBack: () => void;
}

export default function QuizSetup({ isHi, initialSubject, initialMode, loading, onStart, onGoBack }: QuizSetupProps) {
  const [quizMode, setQuizMode] = useState<QuizMode>(initialMode);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(initialSubject);
  const [selectedDifficulty, setSelectedDifficulty] = useState<number | null>(null);
  const [questionCount, setQuestionCount] = useState(10);
  const [examTimeLimit, setExamTimeLimit] = useState(180);

  const subMeta = SUBJECT_META.find(s => s.code === selectedSubject);

  const handleStart = () => {
    if (!selectedSubject) return;
    onStart({
      subject: selectedSubject,
      difficulty: selectedDifficulty,
      questionCount,
      quizMode,
      examTimeLimit,
    });
  };

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <button onClick={onGoBack} className="text-[var(--text-3)]">&larr;</button>
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'क्विज़ शुरू करो' : 'Start a Quiz'}
          </h1>
        </div>
      </header>
      <main className="app-container py-6 space-y-5">
        {/* Quiz Mode */}
        <div>
          <p className="text-sm text-[var(--text-3)] mb-3 font-medium">
            {isHi ? 'मोड चुनो' : 'Choose Mode'}
          </p>
          <div className="flex gap-3">
            {([
              { id: 'practice' as QuizMode, icon: '✏️', label: 'Practice', labelHi: 'अभ्यास', desc: 'Choose your own difficulty', descHi: 'अपनी कठिनाई चुनो', color: '#F5A623' },
              { id: 'cognitive' as QuizMode, icon: '🧠', label: 'Smart', labelHi: 'स्मार्ट', desc: 'AI picks the right level', descHi: 'AI सही स्तर चुनता है', color: '#7C3AED' },
              { id: 'exam' as QuizMode, icon: '📋', label: 'Exam', labelHi: 'परीक्षा', desc: 'CBSE paper format, timed', descHi: 'CBSE पेपर, समयबद्ध', color: '#DC2626' },
            ]).map(m => (
              <button
                key={m.id}
                onClick={() => setQuizMode(m.id)}
                className="flex-1 rounded-2xl p-4 text-left transition-all active:scale-95"
                style={{
                  background: quizMode === m.id ? `${m.color}12` : 'var(--surface-1)',
                  border: quizMode === m.id ? `2px solid ${m.color}` : '1.5px solid var(--border)',
                  boxShadow: quizMode === m.id ? `0 4px 16px ${m.color}20` : 'none',
                }}
              >
                <div className="text-2xl mb-1">{m.icon}</div>
                <div className="text-sm font-bold" style={{ color: quizMode === m.id ? m.color : 'var(--text-2)' }}>
                  {isHi ? m.labelHi : m.label}
                </div>
                <div className="text-[10px] text-[var(--text-3)] mt-0.5">{isHi ? m.descHi : m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Subject Grid */}
        <div>
          <p className="text-sm text-[var(--text-3)] mb-3 font-medium">
            {isHi ? '1. विषय चुनो' : '1. Choose your subject'}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {SUBJECT_META.slice(0, 9).map(s => (
              <button
                key={s.code}
                onClick={() => setSelectedSubject(s.code)}
                className="rounded-2xl p-4 text-center transition-all active:scale-95"
                style={{
                  background: selectedSubject === s.code ? `${s.color}12` : 'var(--surface-1)',
                  border: selectedSubject === s.code ? `2px solid ${s.color}` : '1.5px solid var(--border)',
                  boxShadow: selectedSubject === s.code ? `0 4px 16px ${s.color}20` : '0 2px 8px rgba(0,0,0,0.03)',
                }}
              >
                <div className="text-3xl mb-2">{s.icon}</div>
                <div className="text-sm font-semibold" style={{ color: selectedSubject === s.code ? s.color : 'var(--text-2)' }}>
                  {s.name}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Difficulty Selection (hidden in cognitive mode — ZPD auto-selects) */}
        {selectedSubject && quizMode === 'practice' && (
          <div>
            <p className="text-sm text-[var(--text-3)] mb-3 font-medium">
              {isHi ? '2. कठिनाई स्तर' : '2. Difficulty level'}
            </p>
            <div className="flex gap-2 flex-wrap">
              {DIFF_LABELS.map(d => (
                <button
                  key={String(d.id)}
                  onClick={() => setSelectedDifficulty(d.id)}
                  className="rounded-xl px-4 py-2.5 text-sm font-semibold transition-all"
                  style={{
                    background: selectedDifficulty === d.id ? 'var(--orange)' : 'var(--surface-2)',
                    color: selectedDifficulty === d.id ? '#fff' : 'var(--text-2)',
                    border: selectedDifficulty === d.id ? '1.5px solid var(--orange)' : '1.5px solid transparent',
                  }}
                >
                  {d.icon} {isHi ? d.labelHi : d.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Exam Mode Config */}
        {selectedSubject && quizMode === 'exam' && (
          <div>
            <p className="text-sm text-[var(--text-3)] mb-3 font-medium">
              {isHi ? '2. समय सीमा (मिनट)' : '2. Time limit (minutes)'}
            </p>
            <div className="flex gap-2">
              {[30, 60, 90, 180].map(m => (
                <button
                  key={m}
                  onClick={() => setExamTimeLimit(m)}
                  className="rounded-xl px-4 py-2.5 text-sm font-bold transition-all"
                  style={{
                    background: examTimeLimit === m ? '#DC2626' : 'var(--surface-2)',
                    color: examTimeLimit === m ? '#fff' : 'var(--text-2)',
                  }}
                >
                  {m} {isHi ? 'मि' : 'min'}
                </button>
              ))}
            </div>
            <Card className="!p-3 !mt-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">📋</span>
                <div className="text-xs text-[var(--text-3)] leading-relaxed">
                  {isHi
                    ? 'CBSE पैटर्न: समयबद्ध परीक्षा, सवालों का जवाब एक बार में — रिवीज़न का समय रखो!'
                    : 'CBSE format: Timed exam, answer all questions — keep time for revision!'}
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Question Count */}
        {selectedSubject && (
          <div>
            <p className="text-sm text-[var(--text-3)] mb-3 font-medium">
              {isHi ? '3. कितने सवाल?' : '3. Number of questions'}
            </p>
            <div className="flex gap-2">
              {[5, 10, 15, 20].map(n => (
                <button
                  key={n}
                  onClick={() => setQuestionCount(n)}
                  className="rounded-xl px-5 py-2.5 text-sm font-bold transition-all"
                  style={{
                    background: questionCount === n ? 'var(--orange)' : 'var(--surface-2)',
                    color: questionCount === n ? '#fff' : 'var(--text-2)',
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Start Button */}
        {selectedSubject && (
          <Button fullWidth onClick={handleStart} color={quizMode === 'exam' ? '#DC2626' : subMeta?.color}>
            {loading ? (isHi ? 'लोड हो रहा...' : 'Loading...') : (
              quizMode === 'exam' ? (
                <>{isHi ? `📋 ${examTimeLimit} मिनट की परीक्षा शुरू करो` : `📋 Start ${examTimeLimit}-min Exam (${questionCount} Qs)`}</>
              ) : (
                <>{subMeta?.icon} {isHi ? `${questionCount} सवालों की क्विज़ शुरू करो` : `Start ${questionCount}-Question Quiz`}</>
              )
            )}
          </Button>
        )}

        {/* Quick stats */}
        <Card className="!p-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">💡</span>
            <div className="text-xs text-[var(--text-3)] leading-relaxed">
              {isHi
                ? 'हर सही जवाब पर 10 XP मिलता है। 80%+ स्कोर पर बोनस 20 XP!'
                : 'Earn 10 XP per correct answer. Score 80%+ for a bonus 20 XP!'}
            </div>
          </div>
        </Card>
      </main>
      <BottomNav />
    </div>
  );
}
