'use client';

import { useState, useEffect } from 'react';
import { Card, Button, BottomNav } from '@/components/ui';
import { getChaptersForSubject } from '@/lib/supabase';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';

type QuizMode = 'practice' | 'cognitive' | 'exam';

const DIFF_LABELS = [
  { id: null, label: 'All Levels', labelHi: 'सभी स्तर', icon: '🎯' },
  { id: 1, label: 'Easy', labelHi: 'आसान', icon: '🟢' },
  { id: 2, label: 'Medium', labelHi: 'मध्यम', icon: '🟡' },
  { id: 3, label: 'Hard', labelHi: 'कठिन', icon: '🔴' },
];

export interface SmartSuggestion {
  subject: string;
  topicId?: string;
  topicTitle?: string;
  chapterId?: string;
  chapterTitle?: string;
  difficulty?: string;
  questionCount?: number;
  reason: string;
  reasonHi: string;
}

interface QuizSetupProps {
  isHi: boolean;
  initialSubject: string | null;
  initialMode: QuizMode;
  initialCount?: number;
  initialChapter?: number | null;
  loading: boolean;
  studentGrade?: string;
  smartSuggestion?: SmartSuggestion | null;
  onStartSmartQuiz?: (suggestion: SmartSuggestion) => void;
  onStart: (opts: {
    subject: string;
    difficulty: number | null;
    questionCount: number;
    quizMode: QuizMode;
    examTimeLimit: number;
    chapterNumber: number | null;
  }) => void;
  onGoBack: () => void;
}

export default function QuizSetup({
  isHi,
  initialSubject,
  initialMode,
  initialCount,
  initialChapter = null,
  loading,
  studentGrade = '',
  smartSuggestion,
  onStartSmartQuiz,
  onStart,
  onGoBack,
}: QuizSetupProps) {
  const [quizMode, setQuizMode] = useState<QuizMode>(initialMode);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(initialSubject);
  const [selectedDifficulty, setSelectedDifficulty] = useState<number | null>(null);
  const [questionCount, setQuestionCount] = useState(initialCount ?? 10);
  const [examTimeLimit, setExamTimeLimit] = useState(180);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(initialChapter);
  // Quick-start: when subject + chapter are pre-filled from context (e.g. from chapter page),
  // skip the full setup form and show a 1-confirm screen.
  const [showFullSetup, setShowFullSetup] = useState(false);
  const hasContext = !!(initialSubject && initialChapter);
  const [showCustom, setShowCustom] = useState(!smartSuggestion);
  const [chapters, setChapters] = useState<Array<{ chapter_number: number; title: string }>>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);

  // Allowed subjects — grade + plan aware, comes from subjects service.
  const { unlocked: allowedSubjects } = useAllowedSubjects();
  const subMeta = allowedSubjects.find(s => s.code === selectedSubject);

  // Load chapters when subject changes
  useEffect(() => {
    if (!selectedSubject || !studentGrade) {
      setChapters([]);
      setSelectedChapter(null);
      return;
    }
    setChaptersLoading(true);
    getChaptersForSubject(selectedSubject, studentGrade)
      .then(data => {
        setChapters(data);
        // If coming in with a pre-selected chapter (e.g. from /learn page), keep it
        if (initialChapter && data.some(c => c.chapter_number === initialChapter)) {
          setSelectedChapter(initialChapter);
        } else {
          setSelectedChapter(null);
        }
      })
      .catch(() => setChapters([]))
      .finally(() => setChaptersLoading(false));
  }, [selectedSubject, studentGrade, initialChapter]);

  const handleStart = () => {
    if (!selectedSubject) return;
    onStart({
      subject: selectedSubject,
      difficulty: selectedDifficulty,
      questionCount,
      quizMode,
      examTimeLimit,
      chapterNumber: selectedChapter,
    });
  };

  // Quick-start: subject + chapter already known → show a 1-confirm screen
  if (hasContext && !showFullSetup) {
    const subMeta = allowedSubjects.find(s => s.code === selectedSubject);
    return (
      <div className="mesh-bg min-h-dvh pb-nav">
        <header className="page-header">
          <div className="page-header-inner flex items-center gap-3">
            <button onClick={onGoBack} className="text-[var(--text-3)]">&larr;</button>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'क्विज़' : 'Quick Quiz'}
            </h1>
          </div>
        </header>
        <main className="app-container py-8 max-w-md mx-auto space-y-4">
          {/* Context card — shows what will be quizzed */}
          <div
            className="rounded-2xl p-5 text-center"
            style={{
              background: `${subMeta?.color || 'var(--orange)'}08`,
              border: `1.5px solid ${subMeta?.color || 'var(--orange)'}25`,
            }}
          >
            <div className="text-4xl mb-2">{subMeta?.icon || '📖'}</div>
            <div className="text-base font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
              {subMeta?.name}
            </div>
            <div className="text-sm text-[var(--text-3)] mb-1">
              {isHi ? `अध्याय ${selectedChapter}` : `Chapter ${selectedChapter}`}
            </div>
            <div className="text-xs text-[var(--text-3)]">
              {questionCount} {isHi ? 'सवाल · स्मार्ट मोड' : 'questions · Smart mode'}
            </div>
          </div>

          {/* Question count selector */}
          <div>
            <p className="text-xs text-[var(--text-3)] mb-2 font-medium text-center">
              {isHi ? 'कितने सवाल?' : 'How many questions?'}
            </p>
            <div className="flex gap-2 justify-center">
              {[5, 10, 15, 20].map(n => (
                <button
                  key={n}
                  onClick={() => setQuestionCount(n)}
                  className="rounded-xl px-4 py-2 text-sm font-bold transition-all"
                  style={{
                    background: questionCount === n ? (subMeta?.color || 'var(--orange)') : 'var(--surface-2)',
                    color: questionCount === n ? '#fff' : 'var(--text-2)',
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Start button */}
          <Button
            fullWidth
            color={subMeta?.color}
            onClick={() => onStart({
              subject: selectedSubject!,
              difficulty: null,
              questionCount,
              quizMode: 'cognitive', // Smart mode by default
              examTimeLimit,
              chapterNumber: selectedChapter,
            })}
          >
            {loading ? (isHi ? 'लोड हो रहा...' : 'Loading...') : `⚡ ${isHi ? 'क्विज़ शुरू करो' : 'Start Quiz'}`}
          </Button>

          {/* Full setup link */}
          <button
            onClick={() => setShowFullSetup(true)}
            className="w-full text-center text-xs font-medium py-2"
            style={{ color: 'var(--text-3)' }}
          >
            {isHi ? 'सेटिंग बदलो (विषय, कठिनाई...)' : 'Change settings (subject, difficulty...)'}
          </button>
        </main>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <button onClick={hasContext && showFullSetup ? () => setShowFullSetup(false) : onGoBack} className="text-[var(--text-3)]">&larr;</button>
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'क्विज़ शुरू करो' : 'Start a Quiz'}
          </h1>
        </div>
      </header>
      <main className="app-container py-6 space-y-5">

        {/* Smart Quiz — One Tap Start */}
        {smartSuggestion && onStartSmartQuiz && (
          <div className="mb-6 rounded-2xl p-5 relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, rgba(232,88,28,0.08), rgba(245,166,35,0.08))', border: '1px solid rgba(232,88,28,0.15)' }}>
            <div className="flex items-start gap-3">
              <span className="text-3xl" role="img" aria-label="brain">&#x1F9E0;</span>
              <div className="flex-1">
                <h3 className="text-sm font-bold mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
                  {isHi ? 'स्मार्ट क्विज़' : 'Smart Quiz'}
                </h3>
                <p className="text-xs text-[var(--text-3)] mb-3 leading-relaxed">
                  {smartSuggestion.reasonHi && isHi ? smartSuggestion.reasonHi : smartSuggestion.reason}
                </p>
                <div className="flex items-center gap-2 text-[10px] text-[var(--text-3)] mb-3">
                  <span>{smartSuggestion.questionCount || 5} {isHi ? 'प्रश्न' : 'questions'}</span>
                  <span>·</span>
                  <span>~{(smartSuggestion.questionCount || 5) * 2} {isHi ? 'मिनट' : 'min'}</span>
                  <span>·</span>
                  <span>{isHi ? 'ऑटो कठिनाई' : 'Auto difficulty'}</span>
                </div>
                <button
                  onClick={() => onStartSmartQuiz(smartSuggestion)}
                  className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.97]"
                  style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
                >
                  {isHi ? '\uD83D\uDE80 अभी शुरू करो' : '\uD83D\uDE80 Start Now'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Customize toggle — only shown when smart suggestion is present */}
        {smartSuggestion && (
          <button
            onClick={() => setShowCustom(!showCustom)}
            className="w-full py-2 text-xs font-semibold text-[var(--text-3)] flex items-center justify-center gap-1"
          >
            {showCustom ? (isHi ? 'कम विकल्प \u2191' : 'Fewer options \u2191') : (isHi ? 'क्विज़ कस्टमाइज़ करो \u2193' : 'Customize Quiz \u2193')}
          </button>
        )}

        {/* Custom quiz setup — always visible when no smart suggestion, collapsible otherwise */}
        {showCustom && (<>

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
            {allowedSubjects.map(s => (
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

        {/* Chapter Selector */}
        {selectedSubject && (
          <div>
            <p className="text-sm text-[var(--text-3)] mb-3 font-medium">
              {isHi ? '2. अध्याय चुनो (वैकल्पिक)' : '2. Choose chapter (optional)'}
            </p>
            {chaptersLoading ? (
              <div className="text-xs text-[var(--text-3)] py-2">
                {isHi ? 'अध्याय लोड हो रहे हैं...' : 'Loading chapters...'}
              </div>
            ) : chapters.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {/* "All chapters" option */}
                <button
                  onClick={() => setSelectedChapter(null)}
                  className="rounded-xl px-4 py-2.5 text-sm font-semibold transition-all"
                  style={{
                    background: selectedChapter === null ? subMeta?.color : 'var(--surface-2)',
                    color: selectedChapter === null ? '#fff' : 'var(--text-2)',
                    border: selectedChapter === null ? `1.5px solid ${subMeta?.color}` : '1.5px solid transparent',
                  }}
                >
                  🎯 {isHi ? 'सभी अध्याय' : 'All Chapters'}
                </button>
                {chapters.map(ch => (
                  <button
                    key={ch.chapter_number}
                    onClick={() => setSelectedChapter(ch.chapter_number)}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold transition-all max-w-[48%] text-left"
                    style={{
                      background: selectedChapter === ch.chapter_number ? `${subMeta?.color}12` : 'var(--surface-2)',
                      color: selectedChapter === ch.chapter_number ? subMeta?.color : 'var(--text-2)',
                      border: selectedChapter === ch.chapter_number ? `1.5px solid ${subMeta?.color}` : '1.5px solid transparent',
                    }}
                  >
                    <span className="font-bold">Ch {ch.chapter_number}</span>
                    <span className="text-[11px] block truncate opacity-70">{ch.title}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-3)]">
                {isHi ? 'इस विषय के लिए अध्याय उपलब्ध नहीं' : 'No chapters available for this subject yet'}
              </p>
            )}
          </div>
        )}

        {/* Difficulty (practice mode only) */}
        {selectedSubject && quizMode === 'practice' && (
          <div>
            <p className="text-sm text-[var(--text-3)] mb-3 font-medium">
              {isHi ? '3. कठिनाई स्तर' : '3. Difficulty level'}
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
              {isHi ? '3. समय सीमा (मिनट)' : '3. Time limit (minutes)'}
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
              {isHi ? '4. कितने सवाल?' : '4. Number of questions'}
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
              ) : selectedChapter ? (
                <>{subMeta?.icon} {isHi ? `अध्याय ${selectedChapter} · ${questionCount} सवाल शुरू करो` : `Start Ch ${selectedChapter} · ${questionCount} Questions`}</>
              ) : (
                <>{subMeta?.icon} {isHi ? `${questionCount} सवालों की क्विज़ शुरू करो` : `Start ${questionCount}-Question Quiz`}</>
              )
            )}
          </Button>
        )}

        {/* Quick tip */}
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

        </>)}
      </main>
      <BottomNav />
    </div>
  );
}
