'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import { getQuizQuestions, saveQuizSession, type DBQuestion } from '@/lib/supabase';
import { SUBJECT_CONFIG, BLOOM_CONFIG, type Subject, type BloomLevel } from '@/lib/types';
import { ArrowLeft, Clock, CheckCircle2, XCircle, Lightbulb, ChevronRight, Trophy, Flame } from 'lucide-react';

interface QuizResponse {
  questionId: string;
  conceptId: string;
  selectedAnswer: string;
  isCorrect: boolean;
  timeTakenSeconds: number;
}

export default function QuizPage() {
  const { student, isLoggedIn, isLoading, isHi, refreshSnapshot } = useStudent();
  const router = useRouter();

  const [questions, setQuestions] = useState<DBQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [responses, setResponses] = useState<QuizResponse[]>([]);
  const [quizComplete, setQuizComplete] = useState(false);
  const [xpEarned, setXpEarned] = useState(0);
  const [loadingQuestions, setLoadingQuestions] = useState(true);
  const [streak, setStreak] = useState(0);
  const questionStartTime = useRef(Date.now());
  const quizStartTime = useRef(Date.now());

  // Load questions from Supabase
  useEffect(() => {
    if (!isLoggedIn && !isLoading) { router.push('/'); return; }
    if (!student) return;

    setLoadingQuestions(true);
    getQuizQuestions({
      subjectId: student.subject || 'math',
      grade: student.grade,
      limit: 10,
    }).then(qs => {
      if (qs.length > 0) {
        // Shuffle questions
        const shuffled = [...qs].sort(() => Math.random() - 0.5);
        setQuestions(shuffled);
      }
      setLoadingQuestions(false);
    });

    quizStartTime.current = Date.now();
  }, [isLoggedIn, isLoading, student?.id]);

  if (isLoading || !student) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-2xl animate-pulse">🦊</div>
    </div>
  );

  if (loadingQuestions) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-3 animate-bounce">🧮</div>
        <div className="text-white/40">{isHi ? 'सवाल लोड हो रहे हैं...' : 'Loading questions...'}</div>
      </div>
    </div>
  );

  if (questions.length === 0) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center glass rounded-2xl p-8 max-w-sm">
        <div className="text-4xl mb-3">📝</div>
        <h2 className="font-bold text-lg mb-2">{isHi ? 'अभी सवाल उपलब्ध नहीं' : 'No questions available'}</h2>
        <p className="text-sm text-white/40 mb-4">{isHi ? 'इस विषय के लिए जल्दी ही सवाल जोड़े जाएंगे' : 'Questions for this subject will be added soon'}</p>
        <button onClick={() => router.push('/dashboard')} className="px-6 py-2 rounded-xl font-bold text-white" style={{background:'linear-gradient(135deg,#FF6B35,#FFB800)'}}>
          {isHi ? 'डैशबोर्ड पर जाओ' : 'Go to Dashboard'}
        </button>
      </div>
    </div>
  );

  const q = questions[currentIdx];
  const totalQ = questions.length;
  const subjectCfg = SUBJECT_CONFIG[(student.subject as Subject) || 'math'];
  const bloomCfg = BLOOM_CONFIG[(q?.bloom_level as BloomLevel) || 'apply'];

  const handleSelect = (optionId: string) => {
    if (showResult) return;
    setSelected(optionId);
  };

  const handleSubmit = () => {
    if (!selected || !q) return;
    const isCorrect = selected === q.correct_answer;
    const timeTaken = (Date.now() - questionStartTime.current) / 1000;

    const response: QuizResponse = {
      questionId: q.id,
      conceptId: q.concept_id,
      selectedAnswer: selected,
      isCorrect,
      timeTakenSeconds: Math.round(timeTaken),
    };

    setResponses(prev => [...prev, response]);
    setShowResult(true);
    setStreak(isCorrect ? streak + 1 : 0);
  };

  const handleNext = async () => {
    if (currentIdx + 1 >= totalQ) {
      // Quiz complete — save to Supabase
      setQuizComplete(true);
      const allResponses = [...responses];
      const durationSec = Math.round((Date.now() - quizStartTime.current) / 1000);

      const result = await saveQuizSession({
        studentId: student.id,
        subjectId: student.subject || 'math',
        quizType: 'practice',
        grade: student.grade,
        responses: allResponses,
        durationSeconds: durationSec,
      });

      if (result) setXpEarned(result.xpEarned);
      await refreshSnapshot();
    } else {
      setCurrentIdx(currentIdx + 1);
      setSelected(null);
      setShowResult(false);
      setShowHint(false);
      questionStartTime.current = Date.now();
    }
  };

  // Quiz Complete Screen
  if (quizComplete) {
    const correct = responses.filter(r => r.isCorrect).length;
    const pct = Math.round((correct / totalQ) * 100);
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="glass rounded-2xl p-8 max-w-sm w-full text-center animate-slide-up">
          <div className="text-5xl mb-4">{pct >= 80 ? '🏆' : pct >= 50 ? '⭐' : '💪'}</div>
          <h1 className="text-2xl font-bold mb-2">
            {pct >= 80 ? (isHi ? 'शानदार!' : 'Outstanding!') : pct >= 50 ? (isHi ? 'बहुत अच्छा!' : 'Well Done!') : (isHi ? 'अच्छा प्रयास!' : 'Good Effort!')}
          </h1>
          <div className="text-5xl font-bold my-4" style={{color: pct >= 80 ? '#FFD700' : pct >= 50 ? '#4CAF50' : '#FF9800'}}>{pct}%</div>
          <div className="text-white/40 mb-4">{correct}/{totalQ} {isHi ? 'सही' : 'correct'}</div>
          {xpEarned > 0 && (
            <div className="flex items-center justify-center gap-2 mb-6 text-lg font-bold" style={{color:'#FFB800'}}>
              <Flame className="w-5 h-5" /> +{xpEarned} XP
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => router.push('/dashboard')} className="flex-1 py-3 rounded-xl font-bold border border-white/10 text-white/50">
              {isHi ? 'डैशबोर्ड' : 'Dashboard'}
            </button>
            <button onClick={() => { setQuizComplete(false); setCurrentIdx(0); setResponses([]); setSelected(null); setShowResult(false); setStreak(0); quizStartTime.current = Date.now(); questionStartTime.current = Date.now(); }} className="flex-1 py-3 rounded-xl font-bold text-white" style={{background:'linear-gradient(135deg,#FF6B35,#FFB800)'}}>
              {isHi ? 'फिर से' : 'Play Again'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!q) return null;

  const options = q.options as Array<{ id: string; text_en: string; text_hi: string; is_correct: boolean }>;

  return (
    <div className="min-h-screen pb-8">
      {/* Header */}
      <div className="sticky top-0 z-50 glass border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={() => router.push('/dashboard')}><ArrowLeft className="w-5 h-5 text-white/40" /></button>
          <div className="flex items-center gap-2">
            <span className="text-sm">{subjectCfg.icon}</span>
            <span className="text-sm font-bold">{currentIdx + 1}/{totalQ}</span>
          </div>
          <div className="flex items-center gap-1">
            {streak >= 3 && <Flame className="w-4 h-4" style={{color:'#FF6B35'}} />}
            <span className="text-xs px-2 py-0.5 rounded" style={{background:`${bloomCfg.color}20`, color: bloomCfg.color}}>
              {bloomCfg.label}
            </span>
          </div>
        </div>
        {/* Progress bar */}
        <div className="h-1 w-full" style={{background:'rgba(255,255,255,0.05)'}}>
          <div className="h-full transition-all duration-300" style={{width:`${((currentIdx + 1) / totalQ) * 100}%`, background: subjectCfg.color}} />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Streak indicator */}
        {streak >= 3 && (
          <div className="text-center animate-slide-up">
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold" style={{background:'rgba(255,107,53,0.15)', color:'#FF6B35'}}>
              <Flame className="w-3 h-3" /> {streak} {isHi ? 'स्ट्रीक!' : 'streak!'}
            </span>
          </div>
        )}

        {/* Question */}
        <div className="glass rounded-2xl p-6">
          <p className="text-lg font-bold leading-relaxed">
            {isHi && q.question_text_hi ? q.question_text_hi : q.question_text_en}
          </p>
        </div>

        {/* Hint button */}
        {!showResult && (q.hint_en || q.hint_hi) && (
          <button onClick={() => setShowHint(!showHint)} className="flex items-center gap-2 text-sm text-white/30 hover:text-white/60 transition-colors">
            <Lightbulb className="w-4 h-4" />
            {isHi ? 'संकेत दिखाओ' : 'Show hint'}
          </button>
        )}
        {showHint && (
          <div className="glass rounded-xl p-4 text-sm text-white/50 border-l-2" style={{borderColor:'#FFB800'}}>
            💡 {isHi && q.hint_hi ? q.hint_hi : q.hint_en}
          </div>
        )}

        {/* Options */}
        <div className="space-y-3">
          {options.map((opt) => {
            let bg = 'rgba(30,27,46,0.5)';
            let borderColor = 'rgba(255,255,255,0.08)';
            let icon = null;

            if (showResult) {
              if (opt.is_correct) {
                bg = 'rgba(76,175,80,0.15)';
                borderColor = '#4CAF50';
                icon = <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{color:'#4CAF50'}} />;
              } else if (selected === opt.id && !opt.is_correct) {
                bg = 'rgba(244,67,54,0.15)';
                borderColor = '#F44336';
                icon = <XCircle className="w-5 h-5 flex-shrink-0" style={{color:'#F44336'}} />;
              }
            } else if (selected === opt.id) {
              bg = `${subjectCfg.color}15`;
              borderColor = subjectCfg.color;
            }

            return (
              <button
                key={opt.id}
                onClick={() => handleSelect(opt.id)}
                disabled={showResult}
                className="w-full p-4 rounded-xl text-left transition-all border flex items-center gap-3"
                style={{ background: bg, borderColor }}
              >
                <span className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0" style={{background:'rgba(255,255,255,0.05)'}}>
                  {opt.id.toUpperCase()}
                </span>
                <span className="flex-1">{isHi && opt.text_hi ? opt.text_hi : opt.text_en}</span>
                {icon}
              </button>
            );
          })}
        </div>

        {/* Explanation (shown after answer) */}
        {showResult && (q.explanation_en || q.explanation_hi) && (
          <div className="glass rounded-xl p-4 animate-slide-up">
            <div className="text-xs font-bold text-white/30 mb-2">{isHi ? 'समझाओ' : 'Explanation'}</div>
            <p className="text-sm text-white/70">
              {isHi && q.explanation_hi ? q.explanation_hi : q.explanation_en}
            </p>
          </div>
        )}

        {/* Action button */}
        {!showResult ? (
          <button onClick={handleSubmit} disabled={!selected} className="w-full py-4 rounded-xl font-bold text-white text-lg transition-all disabled:opacity-30" style={{background: selected ? 'linear-gradient(135deg,#FF6B35,#FFB800)' : '#333'}}>
            {isHi ? 'जवाब दो' : 'Submit Answer'}
          </button>
        ) : (
          <button onClick={handleNext} className="w-full py-4 rounded-xl font-bold text-white text-lg flex items-center justify-center gap-2" style={{background:'linear-gradient(135deg,#FF6B35,#FFB800)'}}>
            {currentIdx + 1 >= totalQ ? (isHi ? 'परिणाम देखो' : 'See Results') : (isHi ? 'अगला सवाल' : 'Next Question')} <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}
