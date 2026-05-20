'use client';

/**
 * Breadcrumbs — minimal sub-page navigation primitive (2026-05-19).
 *
 * Renders inside the AppShell content slot just below the sticky header
 * on non-dashboard pages (/foxy, /learn/*, /progress, /exams, /scan,
 * etc). Provides:
 *   - A 44×44 left-positioned back button with chevron + parent label
 *   - The current screen name, in --ink color, --text-xs
 *
 * Use case: a screen-reader user on /foxy needs to know "Home › Foxy"
 * so they can orient. A sighted user on a 360px phone wants a
 * predictable thumb-zone back button (vs. relying on the Android
 * system gesture).
 *
 * Pure CSS chrome via .app-breadcrumbs / .app-breadcrumbs__back /
 * .app-breadcrumbs__separator / .app-breadcrumbs__current in
 * globals.css. No client JS state, no hooks (besides router for the
 * back navigation).
 *
 * P7 (bilingual): caller provides bilingual `label` and `parentLabel`.
 * P10 (bundle): ~0.4 kB gzip.
 */

import { useRouter } from 'next/navigation';

export interface BreadcrumbsProps {
  /** Where the back button navigates. Default '/dashboard'. */
  parentHref?: string;
  /** Visible parent label (e.g. "Home", "Learn"). */
  parentLabel: string;
  /** Current screen label (e.g. "Foxy", "Chapter 3"). */
  label: string;
}

export function Breadcrumbs({
  parentHref = '/dashboard',
  parentLabel,
  label,
}: BreadcrumbsProps) {
  const router = useRouter();
  return (
    <nav
      className="app-breadcrumbs"
      aria-label={`Breadcrumb: ${parentLabel} / ${label}`}
    >
      <button
        type="button"
        onClick={() => router.push(parentHref)}
        className="app-breadcrumbs__back"
        aria-label={`Back to ${parentLabel}`}
      >
        <span aria-hidden="true">‹</span>
        <span>{parentLabel}</span>
      </button>
      <span className="app-breadcrumbs__separator" aria-hidden="true">/</span>
      <span className="app-breadcrumbs__current">{label}</span>
    </nav>
  );
}

export default Breadcrumbs;
