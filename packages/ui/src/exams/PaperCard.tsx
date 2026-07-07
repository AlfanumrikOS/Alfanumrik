'use client';

/**
 * PaperCard — single mock-test paper tile rendered in the catalog grid.
 *
 * Owned by frontend. Mirrors the visual language of existing Card/Button
 * primitives but stays a leaf component (no SWR / no router dependency)
 * so it stays cheap to render in long grids and easy to test in isolation.
 *
 * P5 — grade strings (never integers) are surfaced via paper.exam_year as
 *   a number, which is the year of the exam, not a CBSE grade.
 * P6 — 4-option MCQ contract is the API's responsibility; this card only
 *   summarises paper-level metadata (count, duration, marking).
 * P7 — bilingual chrome resolves via the `isHi` prop. Technical terms
 *   (JEE, NEET, Olympiad, CBSE, MCQ) stay in English in both locales.
 */

import Link from 'next/link';

const SUBJECT_ICON: Record<string, string> = {
  physics: '⚛️',
  chemistry: '🧪',
  math: '🔢',
  mathematics: '🔢',
  biology: '🧬',
};

const EXAM_FAMILY_LABEL_HI: Record<string, string> = {
  jee_main: 'JEE Main',
  jee_advanced: 'JEE Advanced',
  neet: 'NEET',
  olympiad_math: 'ओलंपियाड गणित',
  olympiad_physics: 'ओलंपियाड भौतिकी',
  cbse_board: 'CBSE बोर्ड',
};

const EXAM_FAMILY_LABEL_EN: Record<string, string> = {
  jee_main: 'JEE Main',
  jee_advanced: 'JEE Advanced',
  neet: 'NEET',
  olympiad_math: 'Olympiad Math',
  olympiad_physics: 'Olympiad Physics',
  cbse_board: 'CBSE Board',
};

const SUBJECT_LABEL_HI: Record<string, string> = {
  physics: 'भौतिकी',
  chemistry: 'रसायन',
  math: 'गणित',
  mathematics: 'गणित',
  biology: 'जीव विज्ञान',
};

const SUBJECT_LABEL_EN: Record<string, string> = {
  physics: 'Physics',
  chemistry: 'Chemistry',
  math: 'Math',
  mathematics: 'Math',
  biology: 'Biology',
};

export interface PaperSummary {
  id: string;
  paper_code: string;
  exam_family: string;
  exam_year: number;
  subject_scope: string[];
  total_questions?: number;
  duration_minutes?: number;
  marking_scheme?: { correct: number; wrong: number };
  source_attribution?: string;
}

export interface PaperCardProps {
  paper: PaperSummary;
  isLocked: boolean;
  isHi: boolean;
  onStart?: (paperId: string) => void;
}

export function buildPaperTitle(
  paper: Pick<PaperSummary, 'exam_family' | 'exam_year' | 'subject_scope'>,
  isHi: boolean,
): string {
  const familyMap = isHi ? EXAM_FAMILY_LABEL_HI : EXAM_FAMILY_LABEL_EN;
  const subjectMap = isHi ? SUBJECT_LABEL_HI : SUBJECT_LABEL_EN;
  const familyLabel = familyMap[paper.exam_family] ?? paper.exam_family;
  const subjects = (paper.subject_scope ?? [])
    .map(s => subjectMap[s] ?? s.replace(/_/g, ' '))
    .filter(Boolean);
  const subjectLabel = subjects.length > 0 ? subjects.join(' · ') : '';
  return subjectLabel
    ? `${familyLabel} ${paper.exam_year} · ${subjectLabel}`
    : `${familyLabel} ${paper.exam_year}`;
}

export default function PaperCard({ paper, isLocked, isHi, onStart }: PaperCardProps) {
  const title = buildPaperTitle(paper, isHi);
  const icons = (paper.subject_scope ?? [])
    .map(s => SUBJECT_ICON[s])
    .filter(Boolean);
  const marking = paper.marking_scheme
    ? `+${paper.marking_scheme.correct} / −${Math.abs(paper.marking_scheme.wrong)}`
    : null;

  const handleStartClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (onStart) {
      e.preventDefault();
      onStart(paper.id);
    }
  };

  return (
    <div
      data-testid="paper-card"
      className="rounded-2xl p-5 relative overflow-hidden flex flex-col gap-3"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-md)',
        opacity: isLocked ? 0.85 : 1,
      }}
    >
      {/* Title + subject icons */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3
            className="text-sm font-bold leading-snug"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
          >
            {title}
          </h3>
          {paper.source_attribution && (
            <p className="text-[10px] text-[var(--text-3)] mt-0.5 truncate">
              {paper.source_attribution}
            </p>
          )}
        </div>
        {icons.length > 0 && (
          <div className="flex items-center gap-1 text-xl flex-shrink-0" aria-hidden="true">
            {icons.map((icon, i) => (
              <span key={i}>{icon}</span>
            ))}
          </div>
        )}
      </div>

      {/* Stat row */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-[var(--text-3)]">
        {typeof paper.total_questions === 'number' && (
          <span>
            <span className="font-semibold text-[var(--text-2)]">{paper.total_questions}</span>{' '}
            {isHi ? 'प्रश्न' : 'questions'}
          </span>
        )}
        {typeof paper.duration_minutes === 'number' && (
          <span>
            ⏱ {paper.duration_minutes} {isHi ? 'मिनट' : 'min'}
          </span>
        )}
        {marking && (
          <span title={isHi ? 'अंकन योजना' : 'Marking scheme'}>
            <span className="font-semibold text-[var(--text-2)]">{marking}</span>
          </span>
        )}
      </div>

      {/* CTA */}
      {isLocked ? (
        <button
          type="button"
          disabled
          data-testid="paper-card-locked"
          className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold cursor-not-allowed"
          style={{
            background: 'var(--surface-2)',
            color: 'var(--text-3)',
            border: '1px dashed var(--border-mid)',
          }}
        >
          <span aria-hidden="true">🔒</span>
          <span>{isHi ? 'लॉक्ड' : 'Locked'}</span>
        </button>
      ) : (
        <Link
          href={`/exams/mock/${paper.id}`}
          onClick={handleStartClick}
          data-testid="paper-card-start"
          className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
          style={{
            background: 'linear-gradient(135deg, var(--orange), var(--orange-light, #FB923C))',
            color: '#fff',
          }}
        >
          {isHi ? 'शुरू करें' : 'Start'}
          <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  );
}
