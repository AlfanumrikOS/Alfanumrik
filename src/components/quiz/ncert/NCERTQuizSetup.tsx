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
  { key: 'mixed',         label: 'Mixed CBSE Paper',   icon: '📄', marks: 'All types',  desc: 'Balanced MCQ + SA + MA + LA',  color: '#E8581C' },
  { key: 'mcq',           label: 'MCQ',                icon: '⭕', marks: '1 mark',     desc: 'Objective single choice',       color: '#6C5CE7' },
  { key: 'short_answer',  label: 'Short Answer (SA)',  icon: '✏️', marks: '1–2 marks',  desc: '2–3 sentences answer',          color: '#0891B2' },
  { key: 'medium_answer', label: 'Medium Answer (MA)', icon: '📝', marks: '3–4 marks',  desc: 'Paragraph with key points',     color: '#16A34A' },
  { key: 'long_answer',   label: 'Long Answer (LA)',   icon: '📃', marks: '5–6 marks',  desc: 'Structured essay response',     color: '#DC2626' },
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
      <div className="flex items-center gap-2 mb-6 text-xs">
        {(['subject','grade','chapter','type'] as const).map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            {i > 0 && <span style={{ color: 'var(--text-3)' }}>›</span>}
            <span
              className={`capitalize px-2 py-0.5 rounded-full font-medium cursor-pointer transition-colors ${
                step === s
                  ? 'text-white'
                  : i < (['subject','grade','chapter','type'].indexOf(step))
                  ? 'cursor-pointer'
                  : 'opacity-40'
              }`}
              style={step === s ? { background: 'var(--brand)', color: '#fff' } : { color: 'var(--text-2)' }}
              onClick={() => {
                if (i < (['subject','grade','chapter','type'].indexOf(step))) {
                  if (s === 'subject') { setStep('subject'); }
                  if (s === 'grade')   { setStep('grade'); }
                  if (s === 'chapter') { setStep('chapter'); }
                }
              }}
            >
              {s === 'subject' && subject ? SUBJECT_META.find(m => m.code === subject)?.name ?? s : s}
              {s === 'grade' && grade ? ` ${grade}` : ''}
              {s === 'chapter' && chapter ? ` Ch.${chapter}` : ''}
            </span>
          </span>
        ))}
      </div>

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
                      <span className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0"
                        style={{ background: mastery >= 70 ? '#16A34A18' : mastery >= 40 ? '#F59E0B18' : 'var(--surface-2)', color: mastery >= 70 ? '#16A34A' : mastery >= 40 ? '#D97706' : 'var(--text-3)' }}>
                        {ch.chapter_number}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate" style={{ color: 'var(--text-1)' }}>
                          {ch.chapter_title ?? `Chapter ${ch.chapter_number}`}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                          {ch.total_questions} questions · MCQ {ch.mcq_count} · Written {ch.written_count}
                          {prog && <span className="ml-2" style={{ color: mastery >= 70 ? '#16A34A' : 'var(--text-3)' }}> · {Math.round(mastery)}% mastery</span>}
                        </div>
                      </div>
                      {mastery >= 70 && <span className="text-lg">✅</span>}
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

          <div className="space-y-2 mb-5">
            {QUESTION_TYPES.map(qt => (
              <button key={qt.key} onClick={() => setQType(qt.key as NCERTQuizConfig['questionType'])}
                className="w-full flex items-center gap-3 p-3.5 rounded-xl text-left transition-all active:scale-[0.99]"
                style={{
                  border: questionType === qt.key ? `2px solid ${qt.color}` : '1.5px solid var(--border)',
                  background: questionType === qt.key ? `${qt.color}0C` : 'var(--surface-1)',
                }}>
                <span className="text-xl w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: `${qt.color}18` }}>
                  {qt.icon}
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{qt.label}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                      style={{ background: `${qt.color}18`, color: qt.color }}>{qt.marks}</span>
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{qt.desc}</div>
                </div>
                <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                  style={{ borderColor: questionType === qt.key ? qt.color : 'var(--border)',
                           background: questionType === qt.key ? qt.color : 'transparent' }}>
                  {questionType === qt.key && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
              </button>
            ))}
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

          <button onClick={handleStart}
            className="w-full py-4 rounded-2xl font-bold text-white text-base transition-all active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, var(--brand), #ff7043)' }}>
            Start Practice →
          </button>
        </div>
      )}
    </div>
  );
}
