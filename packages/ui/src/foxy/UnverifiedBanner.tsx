'use client';

import { useAuth } from '@alfanumrik/lib/AuthContext';
import { Alert, Button } from '@alfanumrik/ui/ui/primitives';

/* ═══════════════════════════════════════════════════════════════
   UnverifiedBanner — shown above tutor bubbles when the grounded
   answer service returned groundingStatus="unverified" (low
   confidence). Per spec §9.1.

   Presentation: re-skinned onto the canonical `Alert` primitive
   (tone="warning" → tokenised amber tint + hairline + ⚠ glyph,
   AA on every theme). The TRIGGER (groundingStatus) and WHEN it
   renders are owned by the parent and are unchanged here (P12).

   The a11y/regression contract from Batch 3A — role="status", the
   data-testid, and the trace-id `title` tooltip — lives on the
   outer wrapper (Alert cannot carry an HTML `title` attribute as it
   consumes `title` as a heading prop). The Alert's own tone role is
   stripped so there is exactly one live region.
   ═══════════════════════════════════════════════════════════════ */

export interface UnverifiedBannerProps {
  /** Trace id surfaced in the title tooltip for support/debugging. */
  traceId?: string;
  /** Invoked when the student clicks the "Show me NCERT chapters" action. */
  onShowChapters?: () => void;
}

export function UnverifiedBanner({ traceId, onShowChapters }: UnverifiedBannerProps) {
  const { isHi } = useAuth();

  const message = isHi
    ? 'यह उत्तर आपके सत्यापित पाठ्यक्रम से नहीं है — अपनी किताब से जाँच करें, या किसी विशिष्ट विषय पर प्रश्न पूछें।'
    : 'This answer isn’t from your verified curriculum — please verify with your book, or ask a specific question for a grounded answer.';

  const actionLabel = isHi
    ? 'मुझे दिखाइए कौन से सत्यापित पाठ्यक्रम विषय उपलब्ध हैं'
    : 'Show me verified curriculum topics I can ask about';

  return (
    <div
      data-testid="unverified-banner"
      role="status"
      title={traceId ? `trace: ${traceId}` : undefined}
      className="mb-2"
    >
      <Alert
        tone="warning"
        role={undefined}
        action={
          onShowChapters ? (
            <Button variant="secondary" size="sm" onClick={onShowChapters}>
              {actionLabel}
              <span aria-hidden className="ms-1">→</span>
            </Button>
          ) : undefined
        }
      >
        <p className="leading-relaxed">{message}</p>
      </Alert>
    </div>
  );
}
