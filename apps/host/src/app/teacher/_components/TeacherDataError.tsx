'use client';

/**
 * TeacherDataError — the ONE honest failure surface for the teacher portal.
 *
 * Why this exists (frontend audit, Wave B — teacher portal):
 * `supabase.rpc()` and the PostgREST query builder RESOLVE with `{ data, error }`;
 * they never reject. Every teacher page that swallowed that into `?? []` /
 * `?? {}` therefore rendered a FAILED read as a reassuring, success-shaped
 * empty state. On the student side that produced "No knowledge gaps detected!"
 * after a 500. On the teacher side the same bug is worse, because a teacher
 * ACTS on it:
 *
 *   /teacher/reports    → "All students are on track!"  (+ 0% average mastery)
 *   /teacher/students   → "No Classes Yet"              (+ "0 students across 0 classes")
 *   /teacher/attendance → "No classes assigned yet — contact your admin"
 *   /teacher/grade-book → "No classes yet"              (error swallowed entirely)
 *   /teacher/submissions→ "No submissions yet"          (+ "0/0 submitted")
 *   /teacher/messages   → "No conversations yet"
 *
 * Each of those told a teacher to do nothing while students were, in fact,
 * struggling / enrolled / waiting. This component replaces the reassuring copy
 * on the failure path so genuine-empty and failed-read are never the same
 * pixels.
 *
 * Contract:
 *  - Presentation only. The caller owns the fetch and passes its own `onRetry`
 *    (normally the same loader the effect ran).
 *  - Asserts NO number. It never renders a count, a percentage or a score —
 *    a page that could not read its data has no number it can stand behind.
 *  - Bilingual per P7 (the caller supplies both strings; `isHi` selects).
 *  - `detail` is optional and is only ever the message the page already showed
 *    in its own banner — no student identifiers are introduced here (P13).
 *  - The retry control pins `minHeight: 44` / `minWidth: 44` as an INLINE
 *    style, not a utility class: Wave A found a retry button that computed to
 *    42px despite correct-looking source, because an arbitrary `text-[13px]`
 *    leaves line-height to inheritance. An inline min-height is unambiguous at
 *    every viewport.
 *
 * Visual convention matches the teacher portal's existing danger banners
 * (`var(--danger)` / `var(--danger-light)` tokens, warm-cream surfaces) rather
 * than introducing a second look.
 */

import type { CSSProperties } from 'react';

export interface TeacherDataErrorProps {
  /** Bilingual toggle from AuthContext.isHi. */
  isHi: boolean;
  /** Headline, English. e.g. "Couldn't load your classes". */
  titleEn: string;
  /** Headline, Hindi. */
  titleHi: string;
  /** Re-runs the failed read. */
  onRetry: () => void;
  /** Optional caught-error detail the page was already surfacing. */
  detail?: string | null;
  /**
   * `card` (default) replaces a whole surface that has no trustworthy data
   * behind it. `banner` sits above content that DID load, for a partial
   * failure.
   */
  variant?: 'card' | 'banner';
  /** Optional test hook so a page's specific failure can be asserted. */
  testId?: string;
}

const RETRY_TOUCH_TARGET: CSSProperties = {
  // WCAG 2.5.8 / repo floor: 44×44 CSS px, pinned inline so the computed box
  // cannot drift with font-size or line-height inheritance.
  minHeight: 44,
  minWidth: 44,
};

export function TeacherDataError({
  isHi,
  titleEn,
  titleHi,
  onRetry,
  detail,
  variant = 'card',
  testId,
}: TeacherDataErrorProps) {
  const title = isHi ? titleHi : titleEn;
  const reassurance = isHi
    ? 'कोई डेटा नहीं खोया है — केवल यह अनुरोध विफल हुआ। कृपया पुनः प्रयास करें।'
    : 'No data has been lost — only this request failed. Please try again.';
  const retryLabel = isHi ? 'पुनः प्रयास करें' : 'Retry';

  const retryButton = (
    <button
      type="button"
      onClick={onRetry}
      style={{
        ...RETRY_TOUCH_TARGET,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 18px',
        borderRadius: 8,
        border: '1px solid var(--danger)',
        background: 'transparent',
        color: 'var(--danger)',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {retryLabel}
    </button>
  );

  if (variant === 'banner') {
    return (
      <div
        role="alert"
        data-testid={testId}
        style={{
          background: 'var(--danger-light)',
          border: '1px solid var(--danger)',
          borderRadius: 10,
          padding: '12px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0, flex: '1 1 220px' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--danger)' }}>{title}</div>
          {detail && (
            <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 2, wordBreak: 'break-word' }}>
              {detail}
            </div>
          )}
        </div>
        {retryButton}
      </div>
    );
  }

  return (
    <div
      role="alert"
      data-testid={testId}
      style={{
        background: 'var(--danger-light)',
        border: '1px solid var(--danger)',
        borderRadius: 14,
        padding: '32px 24px',
        textAlign: 'center',
        marginBottom: 16,
      }}
    >
      <div aria-hidden="true" style={{ fontSize: 28, marginBottom: 8 }}>
        &#9888;
      </div>
      <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--danger)', margin: '0 0 6px' }}>{title}</p>
      <p
        style={{
          fontSize: 13,
          color: 'var(--text-2)',
          margin: '0 auto 16px',
          maxWidth: 380,
          lineHeight: 1.5,
        }}
      >
        {reassurance}
      </p>
      {detail && (
        <p
          style={{
            fontSize: 12,
            color: 'var(--danger)',
            margin: '0 auto 16px',
            maxWidth: 380,
            wordBreak: 'break-word',
          }}
        >
          {detail}
        </p>
      )}
      {retryButton}
    </div>
  );
}

export default TeacherDataError;
