'use client';

/**
 * NCERTQuizSetup — Hick's Law compliant setup for NCERT quiz.
 * One decision at a time: Subject → Grade → Chapter → Question Type → Start
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { SUBJECT_META, GRADE_SUBJECTS } from '@/lib/constants';

export type NCERTQuizConfig = {
  subject: string;
  grade: string;
  chapter: number;
  chapterTitle: string;
  questionType: 'mcq' | 'short_answer' | 'medium_answer' | 'long_answer' | 'mixed';
  count: number;
};

interface ChapterStat {
  chapter_number: number;
  chapter_title: string;
  total_questions: number;
  mcq_count: number;
  written_count: number;
}

interface StudentProgress {
  chapter_number: number;
  mastery_pct: number;
  attempted: number;
}

interface Props {
  initialSubject?: string;
  initialGrade?: string;
  onStart: (cfg: NCERTQuizConfig) => void;
}

const QUESTION_TYPES = [
  { key: 'mixed',         label: 'Mixed CBSE Paper',   icon: '📄', marks: 'All types',  desc: 'Balanced MCQ + SA + MA + LA',  colorVar: 'var(--brand)',        colorHex: '#E8581C' },
  { key: 'mcq',           label: 'MCQ',                icon: '⭕', marks: '1 mark',     desc: 'Objective single choice',       colorVar: 'var(--text-purple)',  colorHex: '#6C5CE7' },
  { key: 'short_answer',  label: 'Short Answer (SA)',  icon: '✏️', marks: '1–2 marks',  desc: '2–3 sentences answer',          colorVar: 'var(--text-teal)',    colorHex: '#0880A1' },
  { key: 'medium_answer', label: 'Medium Answer (MA)', icon: '📝', marks: '3–4 marks',  desc: 'Paragraph with key points',     colorVar: 'var(--text-green)',   colorHex: '#168930' },
  { key: 'long_answer',   label: 'Long Answer (LA)',   icon: '📃', marks: '5–6 marks',  desc: 'Structured essay response',     colorVar: 'var(--text-red)',     colorHex: '#DC2626' },
] as const;

const COUNT_OPTIONS = [5, 10, 15, 20];

export default function NCERTQuizSetup({ initialSubject, initialGrade, onStart }: Props) {
  const [step, setStep]             = useState<'subject' | 'grade' | 'chapter' | 'type'>('subject');
  const [subject, setSubject]       = useState(initialSubject ?? '');
  const [grade, setGrade]           = useState(initialGrade ?? '');
  const [chapter, setChapter]       = useState<number | null>(null);
  const [chapterTitle, setChapterTitle] = useState('');
  const [questionType, setQType]    = useState<NCERTQuizConfig['questionType']>('mixed');
  const [count, setCount]           = useState(10);
  const [chapters, setChapters]     = useState<ChapterStat[]>([]);
  const [progress, setProgress]     = useState<StudentProgress[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(false);

  // Auto-skip to chapter step if subject+grade preset
  useEffect(() => {
    if (initialSubject && initialGrade) {
      setStep('chapter');
      loadChapters(initialSubject, initialGrade);
    }
  }, [initialSubject, initialGrade]);

  async function loadChapters(s: string, g: string) {
    setLoadingChapters(true);
    try {
      const { data, error } = await supabase.rpc('get_ncert_chapter_stats', {
        p_subject: s,
        p_grade: g,
      });
      if (!error && data) setChapters(data as ChapterStat[]);

      // Load student progress
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: prog } = await supabase
          .from('student_ncert_chapter_progress')
          .select('chapter_number, mastery_pct, attempted')
          .eq('student_id', user.id)
          .eq('subject', s)
          .eq('grade', g);
        if (prog) setProgress(prog as StudentProgress[]);
      }
    } finally {
      setLoadingChapters(false);
    }
  }

  function selectSubject(s: string) {
    setSubject(s);
    setGrade('');
    setChapter(null);
    setStep('grade');
  }

  function selectGrade(g: string) {
    setGrade(g);
    setChapter(null);
    setStep('chapter');
    loadChapters(subject, g);
  }

  function selectChapter(num: number, title: string) {
    setChapter(num);
    setChapterTitle(title);
    setStep('type');
  }

  function handleStart() {
    if (!subject || !grade || !chapter) return;
    onStart({ subject, grade, chapter, chapterTitle, questionType, count });
  }

  const subjectMeta = SUBJECT_META.find(s => s.code === subject);
  const availableGrades = subject
    ? Object.entries(GRADE_SUBJECTS)
        .filter(([, subs]) => subs.includes(subject))
        .map(([g]) => g)
    : [];

  const progressMap = Object.fromEntries(progress.map(p => [p.chapter_number, p]));

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* ── Step breadcrumb ─────────────────────────────── */}
      <nav aria-label="Quiz setup steps">
        <ol className="flex items-center gap-2 mb-6 text-xs list-none p-0 m-0">
          {(['subject','grade','chapter','type'] as const).map((s, i) => {
            const stepOrder = ['subject','grade','chapter','type'];
            const currentIdx = stepOrder.indexOf(step);
            const isActive = step === s;
            const isPast = i < currentIdx;
            const isFuture = i > currentIdx;
            return (
              <li key={s} className="flex items-center gap-2">
                {i > 0 && <span aria-hidden="true" style={{ color: 'var(--text-3)' }}>›</span>}
                {isPast ? (
                  <button
                    aria-label={`Go back to ${s} selection`}
                    className="capitalize px-2 py-0.5 rounded-full font-medium transition-colors underline-offset-2 hover:underline"
                    style={{ color: 'var(--text-2)' }}
                    onClick={() => {
                      if (s === 'subject') setStep('subject');
                      if (s === 'grade')   setStep('grade');
                      if (s === 'chapter') setStep('chapter');
                    }}
                  >
                    {s === 'subject' && subject ? SUBJECT_META.find(m => m.code === subject)?.name ?? s : s}
                    {s === 'grade' && grade ? ` ${grade}` : ''}
                    {s === 'chapter' && chapter ? ` Ch.${chapter}` : ''}
                  </button>
                ) : (
                  <span
                    aria-current={isActive ? 'step' : undefined}
                    className={`capitalize px-2 py-0.5 rounded-full font-medium ${isFuture ? 'opacity-40' : ''}`}
                    style={isActive ? { background: 'var(--brand)', color: '#fff' } : { color: 'var(--text-2)' }}
                  >
                    {s === 'subject' && subject ? SUBJECT_META.find(m => m.code === subject)?.name ?? s : s}
                    {s === 'grade' && grade ? ` ${grade}` : ''}
                    {s === 'chapter' && chapter ? ` Ch.${chapter}` : ''}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* ── Step: Subject ──────────────────────────────── */}
      {step === 'subject' && (
        <div>
          <h2 className="text-xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
            Which subject?
          </h2>
          <p className="text-sm mb-4" style={{ color: 'var(--text-3)' }}>NCERT questions from your textbook</p>
          <div className="grid grid-cols-2 gap-3">
            {SUBJECT_META.filter(s => ['math','science','physics','chemistry','biology','english','hindi','social_studies','computer_science'].includes(s.code)).map(s => (
              <button key={s.code} onClick={() => selectSubject(s.code)}
                className="flex items-center gap-3 p-3 rounded-xl text-left transition-all active:scale-[0.98] hover:shadow-md"
                style={{ border: '1.5px solid var(--border)', background: 'var(--surface-1)' }}>
                <span className="text-2xl w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: `${s.color}18`, color: s.color }}>
                  {s.icon}
                </span>
                <span className="font-medium text-sm" style={{ color: 'var(--text-1)' }}>{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step: Grade ────────────────────────────────── */}
      {step === 'grade' && (
        <div>
          <h2 className="text-xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
            {subjectMeta?.icon} {subjectMeta?.name} — which grade?
          </h2>
          <p className="text-sm mb-4" style={{ color: 'var(--text-3)' }}>Pick your NCERT textbook year</p>
          <div className="grid grid-cols-4 gap-3">
            {availableGrades.map(g => (
              <button key={g} onClick={() => selectGrade(g)}
                className="py-4 rounded-xl font-bold text-lg transition-all active:scale-[0.96] hover:shadow-md"
                style={{ border: '1.5px solid var(--border)', background: 'var(--surface-1)', color: 'var(--text-1)' }}>
                {g}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step: Chapter ──────────────────────────────── */}
      {step === 'chapter' && (
        <div>
          <h2 className="text-xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
            {subjectMeta?.icon} Grade {grade} — pick a chapter
          </h2>
          <p className="text-sm mb-4" style={{ color: 'var(--text-3)' }}>
            {loadingChapters ? 'Loading chapters…' : `${chapters.length} chapters available`}
          </p>
          {loadingChapters
            ? <div className="text-center py-8" style={{ color: 'var(--text-3)' }}>Loading…</div>
            : chapters.length === 0
            ? (
              <div className="text-center py-8 rounded-xl" style={{ background: 'var(--surface-1)', color: 'var(--text-3)' }}>
                <div className="text-3xl mb-2">📚</div>
                <p>No NCERT questions found for this combination yet.</p>
                <p className="text-xs mt-1">Try a different subject or grade.</p>
                <button onClick={() => setStep('grade')} className="mt-3 text-sm underline" style={{ color: 'var(--brand)' }}>← Back</button>
              </div>
            )
            : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {chapters.map(ch => {
                  const prog = progressMap[ch.chapter_number];
                  const mastery = prog?.mastery_pct ?? 0;
                  return (
                    <button key={ch.chapter_number} onClick={() => selectChapter(ch.chapter_number, ch.chapter_title ?? `Chapter ${ch.chapter_number}`)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all active:scale-[0.99] hover:shadow-sm"
                      style={{ border: '1.5px solid var(--border)', background: 'var(--surface-1)' }}>
                      <span
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0"
                        aria-hidden="true"
                        style={{
                          background: mastery >= 70 ? '#16893018' : mastery >= 40 ? '#BD5B0618' : 'var(--surface-2)',
                          color: mastery >= 70 ? 'var(--text-green)' : mastery >= 40 ? 'var(--text-amber)' : 'var(--text-3)',
                        }}>
                        {ch.chapter_number}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate" style={{ color: 'var(--text-1)' }}>
                          {ch.chapter_title ?? `Chapter ${ch.chapter_number}`}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                          {ch.total_questions} questions · MCQ {ch.mcq_count} · Written {ch.written_count}
                          {prog && (
                            <span className="ml-2" style={{ color: mastery >= 70 ? 'var(--text-green)' : 'var(--text-3)' }}>
                              {' · '}{Math.round(mastery)}% mastery
                            </span>
                          )}
                        </div>
                      </div>
                      {mastery >= 70 && <span className="text-lg" aria-label="Chapter completed">✅</span>}
                    </button>
                  );
                })}
              </div>
            )
          }
        </div>
      )}

      {/* ── Step: Question Type + Start ───────────────── */}
      {step === 'type' && (
        <div>
          <h2 className="text-xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
            Chapter {chapter}: {chapterTitle}
          </h2>
          <p className="text-sm mb-4" style={{ color: 'var(--text-3)' }}>Choose question format for your practice</p>

          {/* WCAG 1.3.1 / 4.1.2: radiogroup semantics for exclusive choice */}
          <div
            role="radiogroup"
            aria-label="Question format"
            className="space-y-2 mb-5"
          >
            {QUESTION_TYPES.map(qt => {
              const isSelected = questionType === qt.key;
              return (
                <button
                  key={qt.key}
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setQType(qt.key as NCERTQuizConfig['questionType'])}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl text-left transition-all active:scale-[0.99]"
                  style={{
                    border: isSelected ? `2px solid ${qt.colorHex}` : '1.5px solid var(--border)',
                    background: isSelected ? `${qt.colorHex}0C` : 'var(--surface-1)',
                  }}>
                  <span
                    className="text-xl w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    aria-hidden="true"
                    style={{ background: `${qt.colorHex}18` }}>
                    {qt.icon}
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{qt.label}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                        style={{ background: `${qt.colorHex}18`, color: qt.colorVar }}>{qt.marks}</span>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{qt.desc}</div>
                  </div>
                  {/* Visual radio indicator */}
                  <div
                    aria-hidden="true"
                    className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                    style={{
                      borderColor: isSelected ? qt.colorHex : 'var(--border)',
                      background:  isSelected ? qt.colorHex : 'transparent',
                    }}>
                    {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Question count */}
          <div className="flex items-center gap-2 mb-5">
            <span className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>Questions:</span>
            <div className="flex gap-2">
              {COUNT_OPTIONS.map(n => (
                <button key={n} onClick={() => setCount(n)}
                  className="w-12 py-1.5 rounded-lg text-sm font-bold transition-all"
                  style={{
                    background: count === n ? 'var(--brand)' : 'var(--surface-1)',
                    color: count === n ? '#fff' : 'var(--text-2)',
                    border: count === n ? '1.5px solid var(--brand)' : '1.5px solid var(--border)',
                  }}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleStart}
            className="w-full py-4 rounded-2xl font-bold text-white text-base transition-all active:scale-[0.98]"
            style={{ background: 'var(--btn-primary-gradient)' }}
            aria-label={`Start practice: ${count} ${questionType === 'mixed' ? 'mixed' : questionType.replace('_', ' ')} questions from Chapter ${chapter}`}
          >
            Start Practice →
          </button>
        </div>
      )}
    </div>
  );
}
