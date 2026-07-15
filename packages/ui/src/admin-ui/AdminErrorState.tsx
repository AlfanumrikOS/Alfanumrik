'use client';

/**
 * AdminErrorState — shared admin-ui primitive.
 *
 * The super-admin dashboards fetch several endpoints in parallel and, before
 * the Slice-1 UX pass, a failed fetch commonly left the page rendering `null`
 * or a misleading empty state with no way to recover. This primitive gives
 * those pages an explicit, retry-able error surface so a network / auth / 5xx
 * failure never renders as a blank screen.
 *
 * Presentation-only: the caller owns the fetch and passes its own `onRetry`
 * (usually the same `fetchAll` callback the effect ran). Built on the shared
 * danger/surface/foreground Tailwind tokens (no hex, no new palette) and
 * bilingual per P7 via the caller's `isHi` flag.
 */

export interface AdminErrorStateProps {
  /** Re-runs the failed fetch. */
  onRetry: () => void;
  /** Optional heading override. Defaults to a bilingual "couldn't load" line. */
  title?: string;
  /** Optional human-readable detail (e.g. the caught error message). */
  message?: string | null;
  /** Bilingual toggle (AuthContext.isHi). Defaults to English. */
  isHi?: boolean;
  /** Compact inline banner (for partial-failure notices above loaded content). */
  compact?: boolean;
}

export function AdminErrorState({
  onRetry,
  title,
  message,
  isHi = false,
  compact = false,
}: AdminErrorStateProps) {
  const heading = title ?? (isHi ? 'डेटा लोड नहीं हो सका' : "Couldn’t load data");
  const retryLabel = isHi ? 'फिर से कोशिश करें' : 'Retry';

  if (compact) {
    return (
      <div
        role="alert"
        className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3.5 py-2 text-[13px] text-danger"
      >
        <span aria-hidden>&#9888;</span>
        <span className="min-w-0 flex-1">
          {message ? `${heading}: ${message}` : heading}
        </span>
        <button
          onClick={onRetry}
          className="shrink-0 rounded-md border border-danger bg-transparent px-2.5 py-1 text-[11px] font-semibold text-danger hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"
        >
          {retryLabel}
        </button>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="mx-auto my-6 max-w-md rounded-xl border border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--danger)_6%,transparent)] px-6 py-8 text-center"
    >
      <div aria-hidden className="mb-2 text-2xl text-danger">&#9888;</div>
      <p className="mb-1 text-sm font-semibold text-foreground">{heading}</p>
      {message && (
        <p className="mb-4 text-[13px] text-muted-foreground">{message}</p>
      )}
      <button
        onClick={onRetry}
        className={`${message ? '' : 'mt-3 '}rounded-md bg-foreground px-5 py-2 text-[13px] font-semibold text-surface-1 hover:opacity-90`}
      >
        {retryLabel}
      </button>
    </div>
  );
}

export default AdminErrorState;
