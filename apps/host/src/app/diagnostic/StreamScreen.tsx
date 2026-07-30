'use client';

/**
 * /diagnostic — Stream-required screen (spec G4 / §7.4).
 *
 * NORMAL state (HTTP 200), not an error. Split out of page.tsx and loaded via
 * `next/dynamic` (P10): a grade 11/12 student with no stream yet is a rare
 * branch relative to the setup screen every student sees, so this JS should
 * not sit in the page's initial first-load chunk. See page.tsx for the full
 * flow docs.
 */

import { useRouter } from 'next/navigation';
import { DIAGNOSTIC_COPY as C, t, type Bilingual } from './copy';

/**
 * Where "Choose stream" goes.
 *
 * There is no standalone stream-selection ROUTE in this codebase. Stream is
 * captured by (a) the global `StreamGate` modal, mounted in the root layout via
 * LayoutDeferredChrome — it auto-opens for any grade 11/12 student with a NULL
 * stream, on every page including this one — and (b) the dashboard's inline
 * stream chip. We point at the dashboard rather than invent a URL. Raised as a
 * gap per the spec §7.4 note; do not replace this with a guessed route.
 */
const STREAM_PICKER_ROUTE = '/dashboard';

export interface StreamScreenProps {
  isHi: boolean;
  grade: string;
  streamMessage: Bilingual | null;
  onGoBack: () => void;
}

export default function StreamScreen({ isHi, grade, streamMessage, onGoBack }: StreamScreenProps) {
  const router = useRouter();
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
          textAlign: 'center',
          animation: 'slideUp 0.4s ease-out',
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 10 }} aria-hidden="true">🎓</div>
        <h1
          style={{
            fontSize: 19,
            fontWeight: 700,
            color: 'var(--text-1)',
            fontFamily: 'var(--font-display)',
            margin: '0 0 8px',
          }}
        >
          {t(C.streamHeadline, isHi)}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, margin: '0 0 20px' }}>
          {streamMessage
            ? t(streamMessage, isHi, { grade })
            : t(C.streamBody, isHi, { grade })}
        </p>

        <button
          type="button"
          onClick={() => router.push(STREAM_PICKER_ROUTE)}
          style={{
            width: '100%',
            padding: '14px 0',
            borderRadius: 12,
            background: 'linear-gradient(135deg, #E8590C, #F59E0B)',
            color: '#fff',
            border: 'none',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            minHeight: 44,
          }}
        >
          {t(C.streamCta, isHi)}
        </button>

        <button
          type="button"
          onClick={onGoBack}
          style={{
            width: '100%',
            marginTop: 10,
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
