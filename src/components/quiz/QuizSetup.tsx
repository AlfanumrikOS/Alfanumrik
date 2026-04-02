'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, Button, BottomNav } from '@/components/ui';
import { SUBJECT_META, GRADE_SUBJECTS } from '@/lib/constants';
import { getExamPresets, calculateExamConfig, type ExamPreset } from '@/lib/exam-engine';
import { XP_RULES } from '@/lib/xp-rules';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';

type QuizMode = 'practice' | 'cognitive' | 'exam';

const DIFF_LABELS = [
  { id: null, label: 'All Levels', labelHi: 'सभी स्तर', icon: '🎯' },
  { id: 1, label: 'Easy', labelHi: 'आसान', icon: '🟢' },
  { id: 2, label: 'Medium', labelHi: 'मध्यम', icon: '🟡' },
  { id: 3, label: 'Hard', labelHi: 'कठिन', icon: '🔴' },
];

const PRACTICE_COUNTS = [5, 10, 15, 20];

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
    chapterNumber: number | null;
  }) => void;
  onGoBack: () => void;
}

export default function QuizSetup({ isHi, initialSubject, initialMode, loading, onStart, onGoBack }: QuizSetupProps) {
  const { student } = useAuth();
  const grade = student?.grade || '9';

  const [quizMode, setQuizMode] = useState<QuizMode>(initialMode);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(initialSubject);
  const [selectedDifficulty, setSelectedDifficulty] = useState<number | null>(null);
  const [questionCount, setQuestionCount] = useState(10);
  const [selectedPreset, setSelectedPreset] = useState<string>('standard_test');
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [chapters, setChapters] = useState<{ chapter_number: number; title: string }[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);

  // Fetch chapters when subject changes
  useEffect(() => {
    setSelectedChapter(null);
    setChapters([]);
    if (!selectedSubject) return;

    let cancelled = false;
    (async () => {
      setChaptersLoading(true);
      try {
        // Look up the subject UUID from the code
        const { data: subjectRow } = await supabase.from('subjects').select('id').eq('code', selectedSubject).single();
        if (cancelled || !subjectRow) { setChaptersLoading(false); return; }

        const { data, error } = await supabase
          .from('curriculum_topics')
          .select('chapter_number, title')
          .eq('grade', grade)
          .eq('subject_id', subjectRow.id)
          .eq('is_active', true)
          .order('chapter_number');

        if (!cancelled && !error && data) {
          // Deduplicate by chapter_number (topics may share chapters)
          const seen = new Set<number>();
          const unique: { chapter_number: number; title: string }[] = [];
          for (const row of data) {
            if (!seen.has(row.chapter_number)) {
              seen.add(row.chapter_number);
              unique.push(row);
            }
          }
          setChapters(unique);
        }
      } catch {
        // Silently fail — chapters are optional
      }
      if (!cancelled) setChaptersLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedSubject, grade]);

  // Grade-filtered subjects
  const subjects = useMemo(() => {
    const codes = GRADE_SUBJECTS[grade] || GRADE_SUBJECTS['9'];
    return SUBJECT_META.filter(s => codes.includes(s.code));
  }, [grade]);

  // Exam presets based on grade + subject
  const presets = useMemo(() => {
    return getExamPresets(grade, selectedSubject || 'math');
  }, [grade, selectedSubject]);

  // Calculate exam config from selected preset
  const examConfig = useMemo(() => {
    if (quizMode !== 'exam' || !selectedSubject) return null;
    const preset = presets.find(p => p.id === selectedPreset);
    if (!preset) return null;
    return calculateExamConfig(preset, selectedSubject, grade);
  }, [quizMode, selectedSubject, selectedPreset, presets, grade]);

  const activePreset = presets.find(p => p.id === selectedPreset);
  const subMeta = SUBJECT_META.find(s => s.code === selectedSubject);

  const handleStart = () => {
    if (!selectedSubject) return;

    if (quizMode === 'exam' && examConfig) {
      // Exam: use preset-calculated values
      const diffMap: Record<string, number | null> = { easy: 1, medium: 2, hard: 3, mixed: null };
      onStart({
        subject: selectedSubject,
        difficulty: diffMap[examConfig.difficulty],
        questionCount: examConfig.questionCount,
        quizMode: 'exam',
        examTimeLimit: examConfig.durationMinutes,
        chapterNumber: selectedChapter,
      });
    } else {
      // Practice / Cognitive: use manual selections
      onStart({
        subject: selectedSubject,
        difficulty: quizMode === 'cognitive' ? null : selectedDifficulty,
        questionCount,
        quizMode,
        examTimeLimit: 0,
        chapterNumber: selectedChapter,
      });
    }
  };

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <button onClick={onGoBack} className="text-[var(--text-3)]" aria-label={isHi ? 'वापस जाओ' : 'Go back'}>&larr;</button>
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
          <div className="flex gap-3" role="radiogroup" aria-label={isHi ? 'क्विज़ मोड' : 'Quiz mode'}>
            {([
              { id: 'practice' as QuizMode, icon: '✏️', label: 'Practice', labelHi: 'अभ्यास', desc: 'Choose your own difficulty', descHi: 'अपनी कठिनाई चुनो', color: '#F5A623' },
              { id: 'cognitive' as QuizMode, icon: '🧠', label: 'Smart', labelHi: 'स्मार्ट', desc: 'AI picks the right level', descHi: 'AI सही स्तर चुनता है', color: '#7C3AED' },
              { id: 'exam' as QuizMode, icon: '📋', label: 'Exam', labelHi: 'परीक्षा', desc: 'Structured timed assessment', descHi: 'संरचित समयबद्ध परीक्षा', color: '#DC2626' },
            ]).map(m => (
              <button
                key={m.id}
                onClick={() => setQuizMode(m.id)}
                role="radio"
                aria-checked={quizMode === m.id}
                aria-label={isHi ? m.labelHi : m.label}
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

        {/* Subject Grid (grade-filtered) */}
        <div>
          <p className="text-sm text-[var(--text-3)] mb-3 font-medium">
            {isHi ? '1. विषय चुनो' : '1. Choose your subject'}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {subjects.map(s => (
              <button
                key={s.code}
                onClick={() => setSelectedSubject(s.code)}
                aria-label={`${isHi ? 'विषय' : 'Subject'}: ${s.name}`}
                aria-pressed={selectedSubject === s.code}
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

        {/* Chapter Selector (optional) */}
        {selectedSubject && chapters.length > 0 && (
          <div>
            <p className="text-sm text-[var(--text-3)] mb-3 font-medium">
              {isHi ? 'अध्याय चुनो (वैकल्पिक)' : 'Choose Chapter (optional)'}
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setSelectedChapter(null)}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold transition-all"
                style={{
                  background: selectedChapter === null ? 'var(--orange)' : 'var(--surface-2)',
                  color: selectedChapter === null ? '#fff' : 'var(--text-2)',
                  border: selectedChapter === null ? '1.5px solid var(--orange)' : '1.5px solid transparent',
                }}
              >
                {isHi ? 'सभी अध्याय' : 'All Chapters'}
              </button>
              {chapters.map(ch => (
                <button
                  key={ch.chapter_number}
                  onClick={() => setSelectedChapter(ch.chapter_number)}
                  className="rounded-xl px-4 py-2.5 text-sm font-semibold transition-all text-left"
                  style={{
                    background: selectedChapter === ch.chapter_number ? 'var(--orange)' : 'var(--surface-2)',
                    color: selectedChapter === ch.chapter_number ? '#fff' : 'var(--text-2)',
                    border: selectedChapter === ch.chapter_number ? '1.5px solid var(--orange)' : '1.5px solid transparent',
                  }}
                >
                  {ch.chapter_number}. {ch.title}
                </button>
              ))}
            </div>
            {chaptersLoading && (
              <p className="text-xs text-[var(--text-3)] mt-2">{isHi ? 'अध्याय लोड हो रहे हैं...' : 'Loading chapters...'}</p>
            )}
          </div>
        )}

        {/* ─── PRACTICE / COGNITIVE: Difficulty + Question Count ─── */}
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
                  aria-pressed={selectedDifficulty === d.id}
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

        {selectedSubject && quizMode !== 'exam' && (
          <div>
            <p className="text-sm text-[var(--text-3)] mb-3 font-medium">
              {isHi ? (quizMode === 'practice' ? '3. कितने सवाल?' : '2. कितने सवाल?') : (quizMode === 'practice' ? '3. Number of questions' : '2. Number of questions')}
            </p>
            <div className="flex gap-2">
              {PRACTICE_COUNTS.map(n => (
                <button
                  key={n}
                  onClick={() => setQuestionCount(n)}
                  aria-pressed={questionCount === n}
                  aria-label={`${n} ${isHi ? 'सवाल' : 'questions'}`}
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

        {/* ─── EXAM: Structured Presets ─── */}
        {selectedSubject && quizMode === 'exam' && (
          <div>
            <p className="text-sm text-[var(--text-3)] mb-3 font-medium">
              {isHi ? '2. परीक्षा प्रकार चुनो' : '2. Choose exam type'}
            </p>
            <div className="space-y-3">
              {presets.map(preset => {
                const config = calculateExamConfig(preset, selectedSubject, grade);
                const isSelected = selectedPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => setSelectedPreset(preset.id)}
                    className="w-full rounded-2xl p-4 text-left transition-all active:scale-[0.98]"
                    style={{
                      background: isSelected ? `${preset.color}10` : 'var(--surface-1)',
                      border: isSelected ? `2px solid ${preset.color}` : '1.5px solid var(--border)',
                      boxShadow: isSelected ? `0 4px 16px ${preset.color}15` : '0 2px 8px rgba(0,0,0,0.03)',
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{preset.icon}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold" style={{ color: isSelected ? preset.color : 'var(--text-1)' }}>
                              {isHi ? preset.labelHi : preset.label}
                            </span>
                            {preset.recommended && (
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${preset.color}15`, color: preset.color }}>
                                {isHi ? 'अनुशंसित' : 'RECOMMENDED'}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[var(--text-3)] mt-0.5">
                            {isHi ? preset.bloomMixHi : preset.bloomMix}
                          </p>
                        </div>
                      </div>
                      {isSelected && (
                        <span className="text-sm" style={{ color: preset.color }}>✓</span>
                      )}
                    </div>

                    {/* Exam specs */}
                    <div className="flex gap-4 mt-3 ml-11">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs">📝</span>
                        <span className="text-xs font-semibold text-[var(--text-2)]">
                          {config.questionCount} {isHi ? 'सवाल' : 'Qs'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs">⏱️</span>
                        <span className="text-xs font-semibold text-[var(--text-2)]">
                          {config.durationMinutes} {isHi ? 'मिनट' : 'min'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs">⚡</span>
                        <span className="text-xs font-semibold text-[var(--text-2)]">
                          ~{Math.round(config.avgSecondsPerQuestion / 60 * 10) / 10} {isHi ? 'मि/सवाल' : 'min/Q'}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Exam summary card */}
            {examConfig && activePreset && (
              <Card className="!p-4 !mt-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">📋</span>
                  <div className="flex-1">
                    <div className="text-sm font-bold" style={{ color: activePreset.color }}>
                      {isHi ? 'परीक्षा सारांश' : 'Exam Summary'}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-2">
                      <div className="text-xs text-[var(--text-3)]">{isHi ? 'सवाल' : 'Questions'}</div>
                      <div className="text-xs font-semibold">{examConfig.questionCount}</div>
                      <div className="text-xs text-[var(--text-3)]">{isHi ? 'समय' : 'Duration'}</div>
                      <div className="text-xs font-semibold">{examConfig.durationMinutes} {isHi ? 'मिनट' : 'minutes'}</div>
                      <div className="text-xs text-[var(--text-3)]">{isHi ? 'कठिनाई' : 'Difficulty'}</div>
                      <div className="text-xs font-semibold capitalize">{examConfig.difficulty}</div>
                      <div className="text-xs text-[var(--text-3)]">{isHi ? 'प्रति सवाल' : 'Per question'}</div>
                      <div className="text-xs font-semibold">~{Math.round(examConfig.avgSecondsPerQuestion)} {isHi ? 'सेकंड' : 'sec'}</div>
                    </div>
                    <p className="text-[10px] text-[var(--text-3)] mt-2 leading-relaxed">
                      {isHi
                        ? 'समय और सवालों की संख्या आपकी कक्षा, विषय और कठिनाई के आधार पर गणना की गई है।'
                        : 'Duration and question count are calculated based on your grade, subject, and difficulty level.'}
                    </p>
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Start Button */}
        {selectedSubject && (
          <Button fullWidth onClick={handleStart} color={quizMode === 'exam' ? activePreset?.color || '#DC2626' : subMeta?.color}>
            {loading ? (isHi ? 'लोड हो रहा...' : 'Loading...') : (
              quizMode === 'exam' && examConfig ? (
                <>{isHi
                  ? `📋 ${examConfig.durationMinutes} मिनट, ${examConfig.questionCount} सवालों की परीक्षा शुरू करो`
                  : `📋 Start ${activePreset?.label || 'Exam'} — ${examConfig.questionCount} Qs, ${examConfig.durationMinutes} min`}</>
              ) : (
                <>{subMeta?.icon} {isHi ? `${questionCount} सवालों की क्विज़ शुरू करो` : `Start ${questionCount}-Question Quiz`}</>
              )
            )}
          </Button>
        )}

        {/* XP Info */}
        <Card className="!p-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">💡</span>
            <div className="text-xs text-[var(--text-3)] leading-relaxed">
              {isHi
                ? `हर सही जवाब पर ${XP_RULES.quiz_per_correct} XP मिलता है। 80%+ स्कोर पर बोनस ${XP_RULES.quiz_high_score_bonus} XP!`
                : `Earn ${XP_RULES.quiz_per_correct} XP per correct answer. Score 80%+ for a bonus ${XP_RULES.quiz_high_score_bonus} XP!`}
            </div>
          </div>
        </Card>
      </main>
      <BottomNav />
    </div>
  );
}
