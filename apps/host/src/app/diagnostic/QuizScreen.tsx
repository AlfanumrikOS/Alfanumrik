'use client';

/**
 * /diagnostic — Quiz screen (up to 15 questions, one at a time, no timer).
 *
 * Split out of page.tsx and loaded via `next/dynamic` (P10): this screen is
 * only reachable after a successful `/api/diagnostic/start` round trip, so
 * its JS does not need to sit in the page's initial first-load chunk (every
 * student sees the setup screen first; most of this screen's weight — the
 * question renderer, option list, progress bar — is dead code until then).
 * See page.tsx for the full flow docs.
 */

import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import { OPTION_LETTERS, parseOptions } from '@alfanumrik/lib/quiz/options';
import { DIAGNOSTIC_COPY as C, t, type Bilingual } from './copy';
import type { DiagnosticQuestion } from './types';

export interface QuizScreenProps {
  isHi: boolean;
  currentQuestion: DiagnosticQuestion | undefined;
  totalQuestions: number;
  currentIdx: number;
  selectedOption: number | null;
  onSelectOption: (index: number) => void;
  onNext: () => void;
  submitting: boolean;
  quizError: string;
  isShortForm: boolean;
  shortFormMessage: Bilingual | null;
  onGoBack: () => void;
}

export default function QuizScreen({
  isHi,
  currentQuestion,
  totalQuestions,
  currentIdx,
  selectedOption,
  onSelectOption,
  onNext,
  submitting,
  quizError,
  isShortForm,
  shortFormMessage,
  onGoBack,
}: QuizScreenProps) {
  if (!currentQuestion || totalQuestions === 0) {
    return (
      <div
        className="mesh-bg"
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 16px',
        }}
      >
        <div
          role="alert"
          style={{
            textAlign: 'center',
            padding: 24,
            borderRadius: 16,
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            maxWidth: 360,
          }}
        >
          <p style={{ fontSize: 15, color: 'var(--danger)', marginBottom: 16 }}>
            {isHi ? 'प्रश्न लोड नहीं हो सके।' : 'Questions could not be loaded.'}
          </p>
          <button
            onClick={onGoBack}
            style={{
              padding: '10px 20px',
              borderRadius: 10,
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              fontWeight: 600,
              cursor: 'pointer',
              minHeight: 44,
            }}
          >
            {t(C.goBack, isHi)}
          </button>
        </div>
      </div>
    );
  }

  const opts = parseOptions(currentQuestion.options);
  const questionText =
    isHi && currentQuestion.question_hi
      ? currentQuestion.question_hi
      : currentQuestion.question_text;
  const progressPct = Math.round(((currentIdx) / totalQuestions) * 100);

  return (
    <div
      className="mesh-bg"
      style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', padding: '0' }}
    >
      <SectionErrorBoundary section="Diagnostic Quiz">
        {/* Header */}
        <header
          style={{
            padding: '16px 16px 0',
            maxWidth: 520,
            width: '100%',
            margin: '0 auto',
          }}
        >
          {/* Back + progress label */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <button
              onClick={onGoBack}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-3)',
                fontSize: 20,
                cursor: 'pointer',
                padding: '4px 8px',
                minHeight: 44,
                minWidth: 44,
                display: 'flex',
                alignItems: 'center',
              }}
              aria-label={t(C.goBack, isHi)}
            >
              &#8592;
            </button>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-2)',
              }}
            >
              {isHi
                ? `प्रश्न ${currentIdx + 1} / ${totalQuestions}`
                : `Question ${currentIdx + 1} of ${totalQuestions}`}
            </span>
            <div style={{ width: 44 }} />
          </div>

          {/* Progress bar */}
          <div
            style={{
              height: 6,
              borderRadius: 6,
              background: 'var(--surface-3)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                borderRadius: 6,
                width: `${progressPct}%`,
                background: 'linear-gradient(90deg, #E8590C, #F59E0B)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>

          {/* §7.1 short-form banner — the pool could not fill the full form.
              Tell the student rather than silently shortening the check. */}
          {isShortForm && (
            <p
              style={{
                marginTop: 12,
                marginBottom: 0,
                fontSize: 12,
                lineHeight: 1.5,
                color: '#B45309',
                background: 'rgba(217,119,6,0.10)',
                border: '1px solid rgba(217,119,6,0.28)',
                borderRadius: 10,
                padding: '8px 12px',
              }}
            >
              {shortFormMessage
                ? t(shortFormMessage, isHi)
                : t(C.shortFormBanner, isHi, { count: totalQuestions })}
            </p>
          )}
        </header>

        {/* Main content */}
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            padding: '20px 16px 24px',
            maxWidth: 520,
            width: '100%',
            margin: '0 auto',
          }}
        >
          {/* Question card */}
          <div
            style={{
              borderRadius: 16,
              padding: '20px',
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
              marginBottom: 16,
            }}
          >
            <p
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--text-1)',
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              {questionText}
            </p>
          </div>

          {/* Answer options */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              marginBottom: 20,
            }}
          >
            {opts.map((opt, oi) => {
              const isSelected = selectedOption === oi;
              return (
                <button
                  key={oi}
                  type="button"
                  onClick={() => onSelectOption(oi)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '14px 16px',
                    borderRadius: 12,
                    border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                    background: isSelected ? 'rgba(232,88,28,0.07)' : 'var(--surface-2)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'border-color 0.15s ease, background 0.15s ease',
                    minHeight: 44,
                  }}
                  aria-pressed={isSelected}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: isSelected ? 'var(--accent)' : 'var(--surface-3)',
                      color: isSelected ? '#fff' : 'var(--text-2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 700,
                      flexShrink: 0,
                      transition: 'background 0.15s ease',
                    }}
                  >
                    {OPTION_LETTERS[oi]}
                  </span>
                  <span
                    style={{
                      fontSize: 14,
                      color: isSelected ? 'var(--accent)' : 'var(--text-1)',
                      fontWeight: isSelected ? 600 : 400,
                      lineHeight: 1.4,
                      transition: 'color 0.15s ease',
                    }}
                  >
                    {opt}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Quiz error */}
          {quizError && (
            <div
              role="alert"
              style={{
                fontSize: 13,
                color: 'var(--danger)',
                padding: '8px 12px',
                borderRadius: 10,
                background: 'var(--danger-light)',
                border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)',
                fontWeight: 600,
                marginBottom: 12,
              }}
            >
              {quizError}
            </div>
          )}

          {/* Next / Submit button */}
          <button
            type="button"
            disabled={selectedOption === null || submitting}
            onClick={onNext}
            style={{
              width: '100%',
              padding: '14px 0',
              borderRadius: 12,
              background:
                selectedOption !== null
                  ? 'linear-gradient(135deg, #E8590C, #F59E0B)'
                  : 'var(--surface-3)',
              color: selectedOption !== null ? '#fff' : 'var(--text-3)',
              border: 'none',
              fontSize: 15,
              fontWeight: 700,
              cursor: selectedOption !== null && !submitting ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease',
              minHeight: 44,
            }}
          >
            {submitting
              ? (isHi ? 'जमा हो रहा है...' : 'Submitting...')
              : currentIdx < totalQuestions - 1
                ? (isHi ? 'अगला' : 'Next')
                : (isHi ? 'परिणाम देखें' : 'See Results')}
          </button>
        </main>
      </SectionErrorBoundary>
    </div>
  );
}
