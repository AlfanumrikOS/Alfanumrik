'use client';

import { useState, useEffect } from 'react';
import {
  Card,
  CardBody,
  Button,
  IconButton,
  Chip,
  Field,
  Select,
  Alert,
} from '@alfanumrik/ui/ui/primitives';
import { getChaptersForSubject } from '@alfanumrik/lib/supabase';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';

type QuizMode = 'practice' | 'cognitive' | 'exam';

const DIFF_LABELS = [
  { id: null, label: 'All Levels', labelHi: 'सभी स्तर', icon: '🎯' },
  { id: 1, label: 'Easy', labelHi: 'आसान', icon: '🟢' },
  { id: 2, label: 'Medium', labelHi: 'मध्यम', icon: '🟡' },
  { id: 3, label: 'Hard', labelHi: 'कठिन', icon: '🔴' },
];

const QUESTION_TYPE_OPTIONS = [
  { id: 'mcq', label: 'MCQ Only', labelHi: 'केवल MCQ', icon: '⭕', desc: 'Multiple choice questions', descHi: 'बहुविकल्पीय प्रश्न', types: ['mcq'] },
  { id: 'short_answer', label: 'Short Answer', labelHi: 'लघु उत्तर', icon: '✏️', desc: '1-2 marks, typed answers', descHi: '1-2 अंक, लिखित उत्तर', types: ['short_answer'] },
  { id: 'long_answer', label: 'Long Answer', labelHi: 'दीर्घ उत्तर', icon: '📝', desc: '5-6 marks, paragraph answers', descHi: '5-6 अंक, विस्तृत उत्तर', types: ['long_answer'] },
  { id: 'mixed', label: 'Mixed', labelHi: 'मिश्रित', icon: '📋', desc: 'MCQ + SA + LA (CBSE pattern)', descHi: 'MCQ + SA + LA (CBSE पैटर्न)', types: ['mcq', 'short_answer', 'medium_answer', 'long_answer'] },
  { id: 'ncert', label: 'NCERT Exercise', labelHi: 'NCERT अभ्यास', icon: '📖', desc: 'From NCERT question bank', descHi: 'NCERT प्रश्न बैंक से', types: ['ncert'] },
];

const MODE_OPTIONS: Array<{ id: QuizMode; icon: string; label: string; labelHi: string; desc: string; descHi: string }> = [
  { id: 'practice', icon: '✏️', label: 'Practice Mode', labelHi: 'अभ्यास मोड', desc: 'No timer. Learn at your own pace.', descHi: 'कोई टाइमर नहीं। अपनी गति से सीखो।' },
  { id: 'cognitive', icon: '🧠', label: 'Smart Mode', labelHi: 'स्मार्ट मोड', desc: 'AI picks the right difficulty for you.', descHi: 'AI तुम्हारे लिए सही कठिनाई चुनता है।' },
  { id: 'exam', icon: '📋', label: 'Exam Mode', labelHi: 'परीक्षा मोड', desc: 'Timed. Simulates a real CBSE exam.', descHi: 'समयबद्ध। असली CBSE परीक्षा जैसा।' },
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
    questionTypes: string[];
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
  const [questionTypes, setQuestionTypes] = useState<string[]>(['mcq']);
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
      questionTypes,
    });
  };

  const backIcon = <span aria-hidden="true">←</span>;

  // Quick-start: subject + chapter already known → show a 1-confirm screen
  if (hasContext && !showFullSetup) {
    const ctxMeta = allowedSubjects.find(s => s.code === selectedSubject);
    return (
      <div className="mesh-bg min-h-dvh pb-nav">
        <header className="page-header">
          <div className="page-header-inner flex items-center gap-3">
            <IconButton
              variant="ghost"
              size="sm"
              onClick={onGoBack}
              label={isHi ? 'वापस जाएं' : 'Go back'}
              icon={backIcon}
            />
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'क्विज़' : 'Quiz'}
            </h1>
          </div>
        </header>
        <main className="app-container py-8 max-w-md mx-auto space-y-4">
          {/* Context card — shows what will be quizzed */}
          <Card variant="flat">
            <CardBody className="text-center">
              <div className="text-4xl mb-2" aria-hidden="true">{ctxMeta?.icon || '📖'}</div>
              <div className="text-base font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
                {ctxMeta?.name}
              </div>
              <div className="text-fluid-sm text-muted-foreground mb-1">
                {isHi ? `अध्याय ${selectedChapter}` : `Chapter ${selectedChapter}`}
              </div>
              <div className="text-fluid-xs text-muted-foreground">
                {questionCount} {isHi ? 'सवाल · स्मार्ट मोड' : 'questions · Smart mode'}
              </div>
            </CardBody>
          </Card>

          {/* Question count selector */}
          <div>
            <p className="text-fluid-xs text-muted-foreground mb-2 font-medium text-center">
              {isHi ? 'कितने सवाल?' : 'How many questions?'}
            </p>
            <div className="flex gap-2 justify-center">
              {[5, 10, 15, 20].map(n => (
                <Chip
                  key={n}
                  selected={questionCount === n}
                  onClick={() => setQuestionCount(n)}
                  aria-label={isHi ? `${n} सवाल` : `${n} questions`}
                >
                  {n}
                </Chip>
              ))}
            </div>
          </div>

          {/* Start button */}
          <Button
            fullWidth
            size="lg"
            loading={loading}
            onClick={() => onStart({
              subject: selectedSubject!,
              difficulty: null,
              questionCount,
              quizMode: 'cognitive', // Smart mode by default
              examTimeLimit,
              chapterNumber: selectedChapter,
              questionTypes: ['mcq'],
            })}
          >
            {loading ? (isHi ? 'लोड हो रहा...' : 'Loading...') : `⚡ ${isHi ? 'क्विज़ शुरू करो' : 'Start Quiz'}`}
          </Button>

          {/* Full setup link */}
          <Button
            variant="ghost"
            size="sm"
            fullWidth
            onClick={() => setShowFullSetup(true)}
          >
            {isHi ? 'सेटिंग बदलो (विषय, कठिनाई...)' : 'Change settings (subject, difficulty...)'}
          </Button>
        </main>
      </div>
    );
  }

  const activeMode = MODE_OPTIONS.find(m => m.id === quizMode);
  const activeQuestionType = QUESTION_TYPE_OPTIONS.find(qt =>
    (qt.id === 'mcq' && questionTypes.length === 1 && questionTypes[0] === 'mcq')
    || (qt.id === 'short_answer' && questionTypes.length === 1 && questionTypes[0] === 'short_answer')
    || (qt.id === 'long_answer' && questionTypes.length === 1 && questionTypes[0] === 'long_answer')
    || (qt.id === 'mixed' && questionTypes.length > 1)
    || (qt.id === 'ncert' && questionTypes.length === 1 && questionTypes[0] === 'ncert'),
  );

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <IconButton
            variant="ghost"
            size="sm"
            onClick={hasContext && showFullSetup ? () => setShowFullSetup(false) : onGoBack}
            label={isHi ? 'वापस जाएं' : 'Go back'}
            icon={backIcon}
          />
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'क्विज़ शुरू करो' : 'Start a Quiz'}
          </h1>
        </div>
      </header>
      <main className="app-container py-6 space-y-5">

        {/* Smart Quiz — One Tap Start */}
        {smartSuggestion && onStartSmartQuiz && (
          <Card variant="elevated">
            <CardBody>
              <div className="flex items-start gap-3">
                <span className="text-3xl" role="img" aria-label="brain">&#x1F9E0;</span>
                <div className="flex-1">
                  <h3 className="text-fluid-sm font-bold mb-1 text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                    {isHi ? 'स्मार्ट क्विज़' : 'Smart Quiz'}
                  </h3>
                  <p className="text-fluid-xs text-muted-foreground mb-3 leading-relaxed">
                    {smartSuggestion.reasonHi && isHi ? smartSuggestion.reasonHi : smartSuggestion.reason}
                  </p>
                  <div className="flex items-center gap-2 text-fluid-xs text-muted-foreground mb-3">
                    <span>{smartSuggestion.questionCount || 5} {isHi ? 'प्रश्न' : 'questions'}</span>
                    <span aria-hidden="true">·</span>
                    <span>~{(smartSuggestion.questionCount || 5) * 2} {isHi ? 'मिनट' : 'min'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{isHi ? 'ऑटो कठिनाई' : 'Auto difficulty'}</span>
                  </div>
                  <Button fullWidth onClick={() => onStartSmartQuiz(smartSuggestion)}>
                    {isHi ? '🚀 अभी शुरू करो' : '🚀 Start Now'}
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        {/* Customize toggle — only shown when smart suggestion is present */}
        {smartSuggestion && (
          <Button
            variant="ghost"
            size="sm"
            fullWidth
            aria-expanded={showCustom}
            onClick={() => setShowCustom(!showCustom)}
          >
            {showCustom ? (isHi ? 'कम विकल्प ↑' : 'Fewer options ↑') : (isHi ? 'क्विज़ कस्टमाइज़ करो ↓' : 'Customize Quiz ↓')}
          </Button>
        )}

        {/* Custom quiz setup — always visible when no smart suggestion, collapsible otherwise */}
        {showCustom && (<>

        {/* Quiz Mode */}
        <div>
          <p className="text-fluid-sm text-muted-foreground mb-3 font-medium">
            {isHi ? 'मोड चुनो' : 'Choose Mode'}
          </p>
          <div className="flex flex-wrap gap-2">
            {MODE_OPTIONS.map(m => (
              <Chip
                key={m.id}
                selected={quizMode === m.id}
                onClick={() => setQuizMode(m.id)}
                icon={<span>{m.icon}</span>}
              >
                {isHi ? m.labelHi : m.label}
              </Chip>
            ))}
          </div>
          {activeMode && (
            <p className="text-fluid-xs text-muted-foreground mt-2 leading-relaxed">
              {isHi ? activeMode.descHi : activeMode.desc}
            </p>
          )}
        </div>

        {/* Subject Grid */}
        <div>
          <p className="text-fluid-sm text-muted-foreground mb-3 font-medium">
            {isHi ? '1. विषय चुनो' : '1. Choose your subject'}
          </p>
          <div className="flex flex-wrap gap-2">
            {allowedSubjects.map(s => (
              <Chip
                key={s.code}
                selected={selectedSubject === s.code}
                onClick={() => setSelectedSubject(s.code)}
                icon={<span>{s.icon}</span>}
              >
                {s.name}
              </Chip>
            ))}
          </div>
        </div>

        {/* Chapter Selector */}
        {selectedSubject && (
          <div>
            {chaptersLoading ? (
              <>
                <p className="text-fluid-sm text-muted-foreground mb-3 font-medium">
                  {isHi ? '2. अध्याय चुनो (वैकल्पिक)' : '2. Choose chapter (optional)'}
                </p>
                <p className="text-fluid-xs text-muted-foreground py-2">
                  {isHi ? 'अध्याय लोड हो रहे हैं...' : 'Loading chapters...'}
                </p>
              </>
            ) : chapters.length === 0 ? (
              <>
                <p className="text-fluid-sm text-muted-foreground mb-3 font-medium">
                  {isHi ? '2. अध्याय चुनो (वैकल्पिक)' : '2. Choose chapter (optional)'}
                </p>
                <p className="text-fluid-xs text-muted-foreground">
                  {isHi ? 'इस विषय के लिए अध्याय उपलब्ध नहीं' : 'No chapters available for this subject yet'}
                </p>
              </>
            ) : chapters.length <= 8 ? (
              <>
                <p className="text-fluid-sm text-muted-foreground mb-3 font-medium">
                  {isHi ? '2. अध्याय चुनो (वैकल्पिक)' : '2. Choose chapter (optional)'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Chip selected={selectedChapter === null} onClick={() => setSelectedChapter(null)}>
                    🎯 {isHi ? 'सभी अध्याय' : 'All Chapters'}
                  </Chip>
                  {chapters.map(ch => (
                    <Chip
                      key={ch.chapter_number}
                      selected={selectedChapter === ch.chapter_number}
                      onClick={() => setSelectedChapter(ch.chapter_number)}
                      title={`Ch ${ch.chapter_number}: ${ch.title}`}
                    >
                      {`Ch ${ch.chapter_number}: ${ch.title}`}
                    </Chip>
                  ))}
                </div>
              </>
            ) : (
              <Field
                label={isHi ? '2. अध्याय चुनो' : '2. Choose chapter'}
                optional
                optionalText={isHi ? '(वैकल्पिक)' : '(optional)'}
              >
                <Select
                  value={selectedChapter === null ? '' : String(selectedChapter)}
                  onChange={e => setSelectedChapter(e.target.value === '' ? null : Number(e.target.value))}
                >
                  <option value="">{isHi ? '🎯 सभी अध्याय' : '🎯 All Chapters'}</option>
                  {chapters.map(ch => (
                    <option key={ch.chapter_number} value={String(ch.chapter_number)}>
                      {`Ch ${ch.chapter_number}: ${ch.title}`}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}

        {/* Difficulty (practice mode only) */}
        {selectedSubject && quizMode === 'practice' && (
          <div>
            <p className="text-fluid-sm text-muted-foreground mb-3 font-medium">
              {isHi ? '3. कठिनाई स्तर' : '3. Difficulty level'}
            </p>
            <div className="flex gap-2 flex-wrap">
              {DIFF_LABELS.map(d => (
                <Chip
                  key={String(d.id)}
                  selected={selectedDifficulty === d.id}
                  onClick={() => setSelectedDifficulty(d.id)}
                  icon={<span>{d.icon}</span>}
                >
                  {isHi ? d.labelHi : d.label}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {/* Exam Mode Config */}
        {selectedSubject && quizMode === 'exam' && (
          <div>
            <p className="text-fluid-sm text-muted-foreground mb-3 font-medium">
              {isHi ? '3. समय सीमा (मिनट)' : '3. Time limit (minutes)'}
            </p>
            <div className="flex gap-2 flex-wrap">
              {[30, 60, 90, 180].map(m => (
                <Chip
                  key={m}
                  tone="danger"
                  selected={examTimeLimit === m}
                  onClick={() => setExamTimeLimit(m)}
                >
                  {m} {isHi ? 'मि' : 'min'}
                </Chip>
              ))}
            </div>
            <Alert tone="info" icon={<span aria-hidden="true">📋</span>} className="mt-3">
              {isHi
                ? 'CBSE पैटर्न: समयबद्ध परीक्षा, सवालों का जवाब एक बार में — रिवीज़न का समय रखो!'
                : 'CBSE format: Timed exam, answer all questions — keep time for revision!'}
            </Alert>
          </div>
        )}

        {/* Question Type Selector */}
        {selectedSubject && (
          <div>
            <p className="text-fluid-sm text-muted-foreground mb-3 font-medium">
              {isHi ? `${quizMode === 'practice' ? '4' : '3'}. प्रश्न प्रकार` : `${quizMode === 'practice' ? '4' : '3'}. Question type`}
            </p>
            <div className="flex flex-wrap gap-2">
              {QUESTION_TYPE_OPTIONS.map(qt => {
                const isActive = activeQuestionType?.id === qt.id;
                return (
                  <Chip
                    key={qt.id}
                    selected={isActive}
                    onClick={() => setQuestionTypes(qt.types)}
                    icon={<span>{qt.icon}</span>}
                  >
                    {isHi ? qt.labelHi : qt.label}
                  </Chip>
                );
              })}
            </div>
            {activeQuestionType && (
              <p className="text-fluid-xs text-muted-foreground mt-2 leading-relaxed">
                {isHi ? activeQuestionType.descHi : activeQuestionType.desc}
              </p>
            )}
          </div>
        )}

        {/* Question Count */}
        {selectedSubject && (
          <div>
            <p className="text-fluid-sm text-muted-foreground mb-3 font-medium">
              {isHi ? `${quizMode === 'practice' ? '5' : '4'}. कितने सवाल?` : `${quizMode === 'practice' ? '5' : '4'}. Number of questions`}
            </p>
            <div className="flex gap-2 flex-wrap">
              {[5, 10, 15, 20].map(n => (
                <Chip
                  key={n}
                  selected={questionCount === n}
                  onClick={() => setQuestionCount(n)}
                  aria-label={isHi ? `${n} सवाल` : `${n} questions`}
                >
                  {n}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {/* Start Button */}
        {selectedSubject && (
          <Button
            fullWidth
            size="lg"
            loading={loading}
            variant={quizMode === 'exam' ? 'danger' : 'primary'}
            onClick={handleStart}
          >
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

        {/* Quick tip — XP copy genericized (P2: no hardcoded XP numerals in copy) */}
        <Alert tone="info" icon={<span aria-hidden="true">💡</span>}>
          {isHi
            ? 'हर सही जवाब पर XP कमाओ, और ज़्यादा स्कोर पर बोनस XP!'
            : 'Earn XP for every correct answer, plus a bonus for high scores!'}
        </Alert>

        </>)}
      </main>
    </div>
  );
}
