'use client';

/**
 * NCERTEvaluation — shows AI-graded result for a written NCERT answer.
 * CBSE examiner style: marks, key points hit/missed, model answer, grade label.
 */

interface KeyPoint {
  point: string;
  hit: boolean;
}

interface Props {
  questionText: string;
  studentAnswer: string;
  marksAwarded: number;
  marksPossible: number;
  feedback: string;
  keyPoints: KeyPoint[];
  modelAnswerSummary: string;
  grade: 'Excellent' | 'Good' | 'Satisfactory' | 'Needs Improvement' | string;
  questionType: string;
  onNext: () => void;
  isLast: boolean;
}

const GRADE_CONFIG: Record<string, { colorVar: string; colorHex: string; bg: string; icon: string }> = {
  'Excellent':          { colorVar: 'var(--text-green)',  colorHex: '#168930', bg: '#16893012', icon: '⭐' },
  'Good':               { colorVar: 'var(--text-teal)',   colorHex: '#0880A1', bg: '#0880A112', icon: '✅' },
  'Satisfactory':       { colorVar: 'var(--text-amber)',  colorHex: '#BD5B06', bg: '#BD5B0612', icon: '📝' },
  'Needs Improvement':  { colorVar: 'var(--text-red)',    colorHex: '#DC2626', bg: '#DC262612', icon: '💡' },
};

export default function NCERTEvaluation({
  questionText, studentAnswer, marksAwarded, marksPossible,
  feedback, keyPoints, modelAnswerSummary, grade,
  onNext, isLast,
}: Props) {
  const ratio = marksPossible > 0 ? marksAwarded / marksPossible : 0;
  const g = GRADE_CONFIG[grade] ?? GRADE_CONFIG['Needs Improvement'];
  const hitCount = keyPoints.filter(k => k.hit).length;

  // Arc progress (SVG)
  const radius = 36;
  const circ   = 2 * Math.PI * radius;
  const dash   = circ * ratio;

  const arcColor = ratio >= 0.8 ? 'var(--text-green)' : ratio >= 0.5 ? 'var(--text-amber)' : 'var(--text-red)';

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      {/* ── Score arc ──────────────────────────────────── */}
      <div className="flex items-center gap-5 mb-4 p-4 rounded-2xl"
        style={{ background: g.bg, border: `1.5px solid ${g.colorHex}30` }}>
        {/* WCAG 1.1.1: SVG arc has role="img" with text alternative */}
        <div className="relative flex items-center justify-center flex-shrink-0">
          <svg
            width="88" height="88" viewBox="0 0 88 88"
            role="img"
            aria-label={`Score: ${marksAwarded} out of ${marksPossible} marks`}
          >
            <circle cx="44" cy="44" r={radius} fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="8" />
            <circle cx="44" cy="44" r={radius} fill="none"
              stroke={arcColor} strokeWidth="8"
              strokeDasharray={`${dash} ${circ}`}
              strokeLinecap="round"
              transform="rotate(-90 44 44)"
              style={{ transition: 'stroke-dasharray 0.8s ease' }} />
          </svg>
          {/* Hidden from AT — score is announced via svg aria-label above */}
          <div className="absolute flex flex-col items-center" aria-hidden="true">
            <span className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>{marksAwarded}</span>
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>/{marksPossible}</span>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span aria-hidden="true" className="text-base font-bold" style={{ color: g.colorVar }}>
              {g.icon} {grade}
            </span>
          </div>
          <div className="text-sm" style={{ color: 'var(--text-2)' }}>
            {marksAwarded === marksPossible
              ? 'Full marks! Perfect answer.'
              : marksAwarded === 0
              ? 'Review the model answer below.'
              : `${marksAwarded} out of ${marksPossible} marks.`}
          </div>
          {keyPoints.length > 0 && (
            <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
              {hitCount}/{keyPoints.length} key points covered
            </div>
          )}
        </div>
      </div>

      {/* ── Examiner feedback ───────────────────────────── */}
      <div className="mb-4 p-3 rounded-xl text-sm leading-relaxed"
        style={{ background: 'var(--surface-1)', border: '1.5px solid var(--border)', color: 'var(--text-2)' }}>
        <div className="text-xs font-bold mb-1" style={{ color: 'var(--text-3)' }}>EXAMINER FEEDBACK</div>
        {feedback}
      </div>

      {/* ── Key points checklist ────────────────────────── */}
      {keyPoints.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-bold mb-2" style={{ color: 'var(--text-3)' }}>KEY POINTS</div>
          {/* WCAG 1.3.1: list semantics for screen readers */}
          <ul role="list" className="space-y-1.5">
            {keyPoints.map((kp, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                {/* WCAG 1.1.1: emoji has text alternative */}
                <span
                  className="mt-0.5 flex-shrink-0 text-base"
                  aria-label={kp.hit ? 'Covered' : 'Missed'}
                  role="img"
                >
                  {kp.hit ? '✅' : '❌'}
                </span>
                <span style={{ color: kp.hit ? 'var(--text-1)' : 'var(--text-3)' }}>{kp.point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Your answer (collapsed review) ─────────────── */}
      <details className="mb-4 group">
        <summary className="text-xs font-bold cursor-pointer py-1"
          style={{ color: 'var(--text-3)' }}>
          YOUR ANSWER ▸
        </summary>
        <div className="mt-2 p-3 rounded-xl text-sm leading-relaxed whitespace-pre-wrap"
          style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
          {studentAnswer || <span className="italic">No answer submitted</span>}
        </div>
      </details>

      {/* ── Model answer ───────────────────────────────── */}
      <div className="mb-5 p-3 rounded-xl text-sm leading-relaxed"
        style={{ background: '#16893008', border: '1px solid #16893030' }}>
        <div className="text-xs font-bold mb-1" style={{ color: 'var(--text-green)' }}>
          <span aria-hidden="true">📖 </span>MODEL ANSWER
        </div>
        <p style={{ color: 'var(--text-1)' }}>{modelAnswerSummary}</p>
      </div>

      {/* ── Next CTA ───────────────────────────────────── */}
      <button
        onClick={onNext}
        className="w-full py-4 rounded-2xl font-bold text-white text-base transition-all active:scale-[0.98]"
        style={{ background: 'var(--btn-primary-gradient)' }}
      >
        {isLast ? 'View Results →' : 'Next Question →'}
      </button>
    </div>
  );
}
