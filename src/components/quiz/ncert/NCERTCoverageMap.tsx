'use client';

/**
 * NCERTCoverageMap — shows chapter-by-chapter NCERT progress for a subject.
 * Grid of chapter tiles coloured by mastery_pct from student_ncert_chapter_progress.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { SUBJECT_META } from '@/lib/constants';

interface ChapterProgress {
  chapter_number: number;
  mastery_pct: number;
  attempted: number;
  correct: number;
  earned_marks: number;
  total_marks: number;
  last_attempted: string | null;
}

interface ChapterStat {
  chapter_number: number;
  chapter_title: string;
  total_questions: number;
}

interface Props {
  studentId: string;
  subject: string;
  grade: string;
  onChapterClick: (chapter: number, title: string) => void;
}

function masteryColor(pct: number): { bg: string; text: string; border: string } {
  // WCAG 1.4.1: use WCAG-corrected token values so colour + text both indicate state
  if (pct >= 80) return { bg: '#16893018', text: 'var(--text-green)', border: '#16893040' };
  if (pct >= 60) return { bg: '#0880A118', text: 'var(--text-teal)',  border: '#0880A140' };
  if (pct >= 40) return { bg: '#BD5B0618', text: 'var(--text-amber)', border: '#BD5B0640' };
  if (pct >  0)  return { bg: '#DC262618', text: 'var(--text-red)',   border: '#DC262640' };
  return { bg: 'var(--surface-1)', text: 'var(--text-3)', border: 'var(--border)' };
}

// WCAG 1.4.1: colour-blind symbol — never rely on colour alone
function masterySymbol(pct: number, attempted: number): string {
  if (attempted === 0) return '–';
  if (pct >= 80) return '✓';
  if (pct >= 60) return '◑';
  if (pct >= 40) return '◔';
  return '!';
}

export default function NCERTCoverageMap({ studentId, subject, grade, onChapterClick }: Props) {
  const [progress, setProgress]   = useState<ChapterProgress[]>([]);
  const [chapters, setChapters]   = useState<ChapterStat[]>([]);
  const [loading, setLoading]     = useState(true);

  const subjectMeta = SUBJECT_META.find(s => s.code === subject);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [progRes, statRes] = await Promise.all([
        supabase
          .from('student_ncert_chapter_progress')
          .select('chapter_number, mastery_pct, attempted, correct, earned_marks, total_marks, last_attempted')
          .eq('student_id', studentId).eq('subject', subject).eq('grade', grade)
          .order('chapter_number'),
        supabase.rpc('get_ncert_chapter_stats', { p_subject: subject, p_grade: grade }),
      ]);
      if (progRes.data)  setProgress(progRes.data as ChapterProgress[]);
      if (statRes.data)  setChapters(statRes.data as ChapterStat[]);
      setLoading(false);
    }
    load();
  }, [studentId, subject, grade]);

  if (loading) {
    return (
      <div className="text-center py-8 text-sm" style={{ color: 'var(--text-3)' }}>
        Loading coverage…
      </div>
    );
  }

  const progressMap = Object.fromEntries(progress.map(p => [p.chapter_number, p]));
  const totalAttempted = progress.reduce((s, p) => s + p.attempted, 0);
  const totalCorrect   = progress.reduce((s, p) => s + p.correct, 0);
  const totalEarned    = progress.reduce((s, p) => s + p.earned_marks, 0);
  const totalPossible  = progress.reduce((s, p) => s + p.total_marks, 0);
  const overallMastery = totalPossible > 0 ? Math.round((totalEarned / totalPossible) * 100) : 0;
  const chaptersStarted = progress.filter(p => p.attempted > 0).length;

  return (
    <div>
      {/* Summary bar */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
            {subjectMeta?.icon} {subjectMeta?.name} · Grade {grade}
          </span>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
            {chaptersStarted}/{chapters.length} chapters started · {totalAttempted} questions attempted
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold" style={{ color: overallMastery >= 60 ? '#16A34A' : 'var(--text-1)' }}>
            {overallMastery}%
          </div>
          <div className="text-xs" style={{ color: 'var(--text-3)' }}>overall mastery</div>
        </div>
      </div>

      {/* Overall progress bar */}
      <div className="w-full h-2 rounded-full mb-4" style={{ background: 'var(--surface-2)' }}>
        <div className="h-2 rounded-full transition-all"
          style={{ width: `${overallMastery}%`, background: overallMastery >= 60 ? '#16A34A' : overallMastery >= 40 ? '#D97706' : '#DC2626' }} />
      </div>

      {/* Legend — WCAG 1.4.1: symbols alongside colour swatches */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4 text-xs" style={{ color: 'var(--text-3)' }}>
        {[
          { label: 'Not started', pct: -1, sym: '–' },
          { label: '1–39%',       pct: 20, sym: '!' },
          { label: '40–59%',      pct: 50, sym: '◔' },
          { label: '60–79%',      pct: 65, sym: '◑' },
          { label: '80–100%',     pct: 85, sym: '✓' },
        ].map(l => {
          const c = l.pct < 0 ? masteryColor(0) : masteryColor(l.pct);
          return (
            <div key={l.label} className="flex items-center gap-1">
              <div
                aria-hidden="true"
                className="w-3 h-3 rounded-sm flex items-center justify-center text-[8px] font-bold"
                style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}
              >
                {l.sym}
              </div>
              <span>{l.label}</span>
            </div>
          );
        })}
      </div>

      {/* Chapter grid — WCAG 4.1.2: each button has descriptive aria-label */}
      <div className="grid grid-cols-4 gap-2" role="list" aria-label="Chapters">
        {chapters.map(ch => {
          const p       = progressMap[ch.chapter_number];
          const pct     = p?.mastery_pct ?? 0;
          const c       = masteryColor(pct);
          const done    = (p?.attempted ?? 0) > 0;
          const symbol  = masterySymbol(pct, p?.attempted ?? 0);
          const title   = ch.chapter_title ?? `Chapter ${ch.chapter_number}`;
          const a11yLabel = done
            ? `Chapter ${ch.chapter_number}: ${title} — ${Math.round(pct)}% mastery, ${p?.attempted} questions attempted`
            : `Chapter ${ch.chapter_number}: ${title} — not started`;
          return (
            <button
              key={ch.chapter_number}
              role="listitem"
              aria-label={a11yLabel}
              onClick={() => onChapterClick(ch.chapter_number, title)}
              className="relative p-2 rounded-xl text-left transition-all active:scale-[0.96] hover:shadow-md group"
              style={{ background: c.bg, border: `1.5px solid ${c.border}` }}
            >
              <div className="text-xs font-bold" style={{ color: c.text }}>
                Ch.{ch.chapter_number}
              </div>
              {/* WCAG 1.4.1: show symbol + percentage — not colour alone */}
              <div className="text-[10px] font-semibold mt-0.5" style={{ color: c.text }}>
                {done ? `${symbol} ${Math.round(pct)}%` : symbol}
              </div>
              {/* CSS-only tooltip — aria-label handles AT, tooltip is visual only */}
              <div
                aria-hidden="true"
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10"
                style={{ background: 'var(--surface-tooltip,#1a1a1a)', color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
              >
                {title}
                {done && ` · ${p?.attempted} Q`}
              </div>
            </button>
          );
        })}
      </div>

      {chapters.length === 0 && (
        <div className="text-center py-6 text-sm" style={{ color: 'var(--text-3)' }}>
          No chapter data available yet.
        </div>
      )}
    </div>
  );
}
