'use client';

/**
 * /diagnostic — Insufficient-content screen (spec §5.3/§7.2).
 *
 * NORMAL state (HTTP 200, no diagnostic row created), not an error. Split out
 * of page.tsx and loaded via `next/dynamic` (P10): the grade × subject pool
 * being unable to produce an honest placement is a rare branch relative to
 * the setup screen every student sees, so this JS should not sit in the
 * page's initial first-load chunk. See page.tsx for the full flow docs.
 */

import { DIAGNOSTIC_COPY as C, ALTERNATIVE_FALLBACK_LABEL, t } from './copy';
import type { DiagnosticAlternative, InsufficientState } from './types';

export interface InsufficientScreenProps {
  isHi: boolean;
  grade: string;
  insufficient: InsufficientState;
  subjectLabelFor: (code: string) => string;
  subjectFromHref: (href: string) => string;
  onAlternative: (alt: DiagnosticAlternative) => void;
  onGoBack: () => void;
}

export default function InsufficientScreen({
  isHi,
  grade,
  insufficient,
  subjectLabelFor,
  subjectFromHref,
  onAlternative,
  onGoBack,
}: InsufficientScreenProps) {
  const subjectName = subjectLabelFor(insufficient.subjectCode);

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
        style={{
          width: '100%',
          maxWidth: 420,
          borderRadius: 16,
          padding: 24,
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          animation: 'slideUp 0.4s ease-out',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }} aria-hidden="true">🧰</div>
          <h1
            style={{
              fontSize: 19,
              fontWeight: 700,
              color: 'var(--text-1)',
              fontFamily: 'var(--font-display)',
              margin: 0,
            }}
          >
            {t(C.insufficientHeadline, isHi)}
          </h1>
        </div>

        <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.65, margin: '0 0 18px' }}>
          {insufficient.message
            ? t(insufficient.message, isHi, { grade, subject: subjectName })
            : t(C.insufficientBody, isHi, { grade, subject: subjectName })}
        </p>

        {/* §5.4 fallback CTAs — always at least one, always tappable */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {insufficient.alternatives.map((alt, i) => {
            const targetCode = subjectFromHref(alt.href);
            const label = t(
              alt.label ?? ALTERNATIVE_FALLBACK_LABEL.get(alt.kind) ?? C.altFoxy,
              isHi,
              { subject: targetCode ? subjectLabelFor(targetCode) : subjectName },
            );
            const isPrimary = i === 0;
            return (
              <button
                key={`${alt.kind}-${alt.href}`}
                type="button"
                onClick={() => onAlternative(alt)}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: 12,
                  textAlign: 'left',
                  background: isPrimary
                    ? 'linear-gradient(135deg, #E8590C, #F59E0B)'
                    : 'var(--surface-2)',
                  color: isPrimary ? '#fff' : 'var(--text-1)',
                  border: isPrimary ? 'none' : '1.5px solid var(--border)',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  minHeight: 44,
                }}
              >
                {label} →
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onGoBack}
          style={{
            width: '100%',
            marginTop: 14,
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
          {t(C.goBack, isHi)}
        </button>
      </div>
    </div>
  );
}
