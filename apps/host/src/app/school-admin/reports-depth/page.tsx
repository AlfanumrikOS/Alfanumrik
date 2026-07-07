'use client';

/**
 * /school-admin/reports-depth — Phase 3B Wave D. The flag-gated entry point for
 * the DEEP, board/parent-ready school-wide academic reporting surface (mastery
 * comparatives + Bloom's distribution + CSV/print export).
 *
 * This is a NEW route — it did not exist before Wave D, and nothing links to it
 * while `ff_school_reports_depth` is OFF (the Academics-section nav entry is
 * itself flag-gated in ConsolidatedSchoolNav). So the flag-OFF portal is
 * byte-identical to today: the existing /school-admin/reports tabbed view is
 * untouched and remains the only reachable reporting surface.
 *
 * Gating discipline:
 *   - `useSchoolReportsDepth()` sync-paints DEFAULT_OFF (1h localStorage cache,
 *     async confirm). For every current (flag-absent) admin it resolves to false,
 *     so a direct visit here renders a neutral "not available" state — never the
 *     reporting UI, and never any fetch to the (also-404-when-OFF) read routes.
 *   - When ON, the heavy SchoolReports component is lazy-loaded via next/dynamic
 *     so its chunk only ships once the feature is live (P10 bundle protection).
 *   - The surrounding SchoolAdminShell layout already enforces auth (redirects to
 *     /login when unauthenticated), so this page does no auth work itself.
 *
 * P7 bilingual via AuthContext.isHi.
 */

import dynamic from 'next/dynamic';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useSchoolReportsDepth } from '@alfanumrik/lib/use-school-reports-depth';

const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

// Lazy-load the reporting surface so its chunk + the SWR-driven tables only ship
// when the feature is enabled (P10). The skeleton covers the import latency.
const SchoolReports = dynamic(() => import('./SchoolReports'), {
  ssr: false,
  loading: () => (
    <div className="space-y-4" aria-hidden="true">
      <div className="h-7 w-56 rounded-lg bg-[var(--surface-2)] animate-pulse" />
      <div className="h-48 rounded-2xl bg-[var(--surface-2)] animate-pulse" />
      <div className="h-48 rounded-2xl bg-[var(--surface-2)] animate-pulse" />
    </div>
  ),
});

export default function SchoolReportsDepthPage() {
  const { isHi } = useAuth();
  // Sync-paints DEFAULT_OFF; flag-absent admins resolve false → not-available.
  const enabled = useSchoolReportsDepth();

  if (!enabled) {
    return (
      <div className="max-w-md mx-auto py-16 text-center font-['Plus_Jakarta_Sans',system-ui,sans-serif]">
        <div className="text-4xl mb-3" aria-hidden="true">📊</div>
        <h1 className="text-base font-bold text-[var(--text-1)] mb-1 font-['Sora',system-ui,sans-serif]">
          {tt(isHi, 'Reports not available', 'रिपोर्ट उपलब्ध नहीं')}
        </h1>
        <p className="text-sm text-[var(--text-3)]">
          {tt(
            isHi,
            'School-wide academic reporting is not enabled for your school yet.',
            'आपके स्कूल के लिए स्कूल-व्यापी शैक्षणिक रिपोर्टिंग अभी सक्षम नहीं है।',
          )}
        </p>
      </div>
    );
  }

  return <SchoolReports />;
}
