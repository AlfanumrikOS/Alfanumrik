'use client';

/**
 * /diagnostic — Results screen (score, weak/strong topics, recommended
 * difficulty, CTA).
 *
 * Split out of page.tsx and loaded via `next/dynamic` (P10): this screen is
 * only reachable after a completed quiz submission, so its JS (including the
 * SVG circular-progress renderer) does not need to sit in the page's initial
 * first-load chunk. See page.tsx for the full flow docs.
 */

import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import { DIAGNOSTIC_COPY as C, RESULT_THRESHOLDS, t } from './copy';
import DiagnosticReview from './DiagnosticReview';
import type { DiagnosticQuestion, DiagnosticSummary } from './types';

const DIFFICULTY_LABELS: Record<string, { en: string; hi: string; color: string }> = {
  easy:   { en: 'Start with Easy questions',   hi: 'आसान प्रश्नों से शुरू करें',    color: '#16A34A' },
  medium: { en: 'Start with Medium questions',  hi: 'मध्यम प्रश्नों से शुरू करें',   color: '#D97706' },
  hard:   { en: 'Start with Hard questions',    hi: 'कठिन प्रश्नों से शुरू करें',    color: '#DC2626' },
};

// ─── Circular progress ring (SVG) ───────────────────────────────

function CircleProgress({ percent, size = 120, stroke = 10 }: { percent: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (percent / 100) * circ;
  // §7.5b: same 80 / 50 boundaries as the message and the recommendation, so
  // the ring colour can never contradict the copy next to it.
  const color =
    percent >= RESULT_THRESHOLDS.strong ? '#16A34A'
    : percent >= RESULT_THRESHOLDS.mid ? '#D97706'
    : '#DC2626';

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--border)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
      {/* percent text — rotated back so it reads correctly */}
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fill={color}
        fontSize={size / 4.5}
        fontWeight="700"
        style={{ transform: 'rotate(90deg)', transformOrigin: '50% 50%', fontFamily: 'var(--font-display)' }}
      >
        {percent}%
      </text>
    </svg>
  );
}

export interface ResultsScreenProps {
  isHi: boolean;
  isPostOnboarding: boolean;
  summary: DiagnosticSummary;
  /**
   * The questions as served by /api/diagnostic/start. Supplies the review
   * screen's text / options / `explanation` / `explanation_hi`; correctness
   * still comes only from `summary.question_results` (the server's
   * re-derivation). Optional so an older caller keeps compiling.
   */
  questions?: DiagnosticQuestion[];
  onPrimaryCta: () => void;
  onRetake: () => void;
}

/**
 * Pick the language-appropriate topic label list.
 *
 * P7: the server returns `weak_topics` (English `curriculum_topics.title`) plus
 * a parallel `weak_topics_hi` (`title_hi`, falling back to `title` server-side
 * for untranslated technical terms). Falls back to the English list when the
 * `_hi` sibling is absent — e.g. a response from an older deployment.
 */
function pickTopics(en: string[] | undefined, hi: string[] | undefined, isHi: boolean): string[] {
  const base = Array.isArray(en) ? en : [];
  if (!isHi) return base;
  return Array.isArray(hi) && hi.length === base.length ? hi : base;
}

export default function ResultsScreen({ isHi, isPostOnboarding, summary, questions, onPrimaryCta, onRetake }: ResultsScreenProps) {
  const pct = summary.score_percent;
  const weakTopics = pickTopics(summary.weak_topics, summary.weak_topics_hi, isHi);
  const strongTopics = pickTopics(summary.strong_topics, summary.strong_topics_hi, isHi);
  // C2: the server disarms `recommended_difficulty` to 'medium' and flags the
  // placement 'low' after a < 3s/question run, and suppresses the topic lists
  // for the same reason. Say so rather than presenting a disarmed default as a
  // real recommendation.
  const lowConfidence = summary.placement_confidence === 'low';
  // §7.5b: 80 / 50 — the SAME boundaries /api/diagnostic/complete uses for
  // recommended_difficulty, so the badge, the message and the recommendation
  // can never disagree. Do not drift these apart from RESULT_THRESHOLDS.
  const emoji =
    pct >= RESULT_THRESHOLDS.strong ? '🏆'
    : pct >= RESULT_THRESHOLDS.mid ? '💪'
    : '📚';
  const encouragement =
    pct >= RESULT_THRESHOLDS.strong ? C.resultStrong
    : pct >= RESULT_THRESHOLDS.mid ? C.resultMid
    : C.resultLow;
  const diffLabel = DIFFICULTY_LABELS[summary.recommended_difficulty] ?? DIFFICULTY_LABELS.medium;

  return (
    <div
      className="mesh-bg"
      style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', padding: '0 16px 40px' }}
    >
      <SectionErrorBoundary section="Diagnostic Results">
        <main
          style={{
            maxWidth: 480,
            width: '100%',
            margin: '0 auto',
            paddingTop: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            animation: 'slideUp 0.5s ease-out',
          }}
        >
          {/* Title */}
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: 'var(--text-1)',
              fontFamily: 'var(--font-display)',
              textAlign: 'center',
              margin: 0,
            }}
          >
            {isHi ? 'डायग्नोस्टिक परिणाम' : 'Diagnostic Results'}
          </h1>

          {/* Score card */}
          <div
            style={{
              borderRadius: 16,
              padding: 24,
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 8 }}>{emoji}</div>

            {/* Circular progress ring */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <CircleProgress percent={pct} size={120} stroke={10} />
            </div>

            <p
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: 'var(--text-1)',
                margin: '0 0 4px',
                fontFamily: 'var(--font-display)',
              }}
            >
              {summary.correct_answers}/{summary.total_questions}{' '}
              {isHi ? 'सही' : 'correct'}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
              {t(encouragement, isHi)}
            </p>
          </div>

          {/* Recommended difficulty tag */}
          <div
            style={{
              borderRadius: 12,
              padding: '14px 16px',
              background: `${diffLabel.color}12`,
              border: `1.5px solid ${diffLabel.color}40`,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ fontSize: 20 }}>🎯</span>
            <div>
              <p
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-3)',
                  margin: '0 0 2px',
                }}
              >
                {isHi ? 'सुझाव' : 'Recommendation'}
              </p>
              <p
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: diffLabel.color,
                  margin: 0,
                }}
              >
                {isHi ? diffLabel.hi : diffLabel.en}
              </p>
            </div>
          </div>

          {/* C2 — the placement was disarmed. Tell the student, don't hide it. */}
          {lowConfidence && (
            <p
              data-testid="diagnostic-low-confidence-note"
              style={{
                margin: 0,
                fontSize: 12,
                lineHeight: 1.55,
                color: '#B45309',
                background: 'rgba(217,119,6,0.10)',
                border: '1px solid rgba(217,119,6,0.28)',
                borderRadius: 10,
                padding: '10px 12px',
              }}
            >
              {t(C.lowConfidenceNote, isHi)}
            </p>
          )}

          {/* Weak topics */}
          {weakTopics.length > 0 && (
            <div
              style={{
                borderRadius: 14,
                padding: 16,
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
              }}
            >
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#DC2626',
                  marginBottom: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>⚠</span>
                {isHi ? 'सुधार की जरूरत' : 'Areas to strengthen'}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} data-testid="diagnostic-weak-topics">
                {weakTopics.map((topic) => (
                  <span
                    key={topic}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '5px 10px',
                      borderRadius: 20,
                      background: 'rgba(220,38,38,0.08)',
                      color: '#DC2626',
                      border: '1px solid rgba(220,38,38,0.2)',
                    }}
                  >
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Strong topics */}
          {strongTopics.length > 0 && (
            <div
              style={{
                borderRadius: 14,
                padding: 16,
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
              }}
            >
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#16A34A',
                  marginBottom: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>✓</span>
                {isHi ? 'मजबूत क्षेत्र' : 'Strong areas'}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} data-testid="diagnostic-strong-topics">
                {strongTopics.map((topic) => (
                  <span
                    key={topic}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '5px 10px',
                      borderRadius: 20,
                      background: 'rgba(22,163,74,0.08)',
                      color: '#16A34A',
                      border: '1px solid rgba(22,163,74,0.2)',
                    }}
                  >
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Empty state for topics — now reached only when the aggregation
              genuinely produced nothing (every topic in the 50-79 middle band,
              every topic_id NULL, the curriculum_topics lookup failed, or C2
              suppressed the analysis). Before Phase 5 the server hardcoded
              `weak_topics: []`, so this branch ALWAYS won and "Areas to
              strengthen" had literally never rendered in production. */}
          {weakTopics.length === 0 && strongTopics.length === 0 && (
            <div
              style={{
                borderRadius: 14,
                padding: 16,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                textAlign: 'center',
              }}
            >
              <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
                {isHi
                  ? 'विस्तृत topic विश्लेषण उपलब्ध नहीं है। कृपया अभ्यास शुरू करें।'
                  : 'Detailed topic analysis is not available. Please start practising.'}
              </p>
            </div>
          )}

          {/* Phase 5A — per-question review with the explanation the server has
              always been sending and this page never rendered. Deliberately
              placed ABOVE the CTAs: the answer to "why was I wrong" is the
              point of the screen, not a footnote below "Start Practicing".
              Rendered regardless of placement_confidence — an explanation is
              ground truth about the question, not an inference about the
              student, so a speed run still deserves it. */}
          {summary.question_results && summary.question_results.length > 0 && (
            <DiagnosticReview
              isHi={isHi}
              questions={questions ?? []}
              results={summary.question_results}
            />
          )}

          {/* CTA — go to dashboard when arriving from onboarding, else to quiz */}
          <button
            type="button"
            onClick={onPrimaryCta}
            style={{
              width: '100%',
              padding: '15px 0',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #E8590C, #F59E0B)',
              color: '#fff',
              border: 'none',
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'opacity 0.2s ease',
              minHeight: 44,
            }}
          >
            {isPostOnboarding
              ? (isHi ? 'अपना डैशबोर्ड देखें →' : 'Go to your dashboard →')
              : (isHi ? 'अभ्यास शुरू करें' : 'Start Practicing')}
          </button>

          {/* Secondary: re-take */}
          <button
            type="button"
            onClick={onRetake}
            style={{
              width: '100%',
              padding: '12px 0',
              borderRadius: 12,
              background: 'none',
              color: 'var(--text-2)',
              border: '1.5px solid var(--border)',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              minHeight: 44,
            }}
          >
            {isHi ? 'दूसरा विषय आज़माएं' : 'Try Another Subject'}
          </button>
        </main>
      </SectionErrorBoundary>
    </div>
  );
}
