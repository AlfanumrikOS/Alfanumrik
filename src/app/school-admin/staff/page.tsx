'use client';

/**
 * /school-admin/staff — Phase 3B Wave C STAFF-MANAGEMENT surface.
 *
 * NEW page. Lets a school's principal / institution_admin manage the OTHER
 * school admins for their own school (list · invite · change role · revoke).
 * It is the UI for /api/school-admin/staff (institution.manage_staff). It is
 * NOT a repurpose of /school-admin/rbac — that is the unrelated platform
 * elevation/delegation surface and stays untouched.
 *
 * Flag gating (byte-identical-OFF): the whole surface is gated on
 * `ff_school_admin_rbac` via useSchoolAdminRbac(). When OFF the page renders a
 * "feature not available" notice and never calls the staff API (which itself
 * 404s while the flag is OFF). The nav entry that links here is likewise
 * suppressed when the flag is OFF (see ConsolidatedSchoolNav), so the OFF portal
 * is byte-identical to today.
 *
 * P10: the heavy management UI is lazy-loaded via next/dynamic so this route
 * adds no weight to the shared/legacy bundle.
 */

import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/AuthContext';
import { useSchoolAdminRbac } from '@/lib/use-school-admin-rbac';
import { Card, Skeleton } from '@/components/ui';

function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

// Lazy-load the management client component (P10 — keeps it off the shared bundle).
const StaffManagement = dynamic(() => import('./StaffManagement'), {
  ssr: false,
  loading: () => (
    <div className="max-w-3xl mx-auto px-4 pt-6 pb-24 space-y-3">
      <Skeleton variant="title" height={26} width="40%" />
      <Skeleton variant="text" height={13} width="60%" />
      <div className="mt-4 space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rect" height={72} rounded="rounded-2xl" />
        ))}
      </div>
    </div>
  ),
});

export default function StaffPage() {
  const { isHi } = useAuth();
  const rbacEnabled = useSchoolAdminRbac();

  // Flag OFF → feature not available (the API 404s too). Byte-identical-OFF:
  // no staff data is fetched and the legacy portal is unaffected.
  if (!rbacEnabled) {
    return (
      <div
        className="min-h-dvh flex items-center justify-center px-4 font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
        style={{ background: 'var(--bg)' }}
      >
        <Card className="max-w-sm w-full text-center py-10">
          <div className="text-4xl mb-3" aria-hidden="true">🔒</div>
          <h1
            className="text-base font-bold text-[var(--text-1)] mb-2"
            style={{ fontFamily: 'Sora, system-ui, sans-serif' }}
          >
            {t(isHi, 'Staff management is not available', 'स्टाफ प्रबंधन उपलब्ध नहीं है')}
          </h1>
          <p className="text-sm text-[var(--text-3)]">
            {t(
              isHi,
              'This feature has not been enabled for your school yet.',
              'यह सुविधा अभी आपके स्कूल के लिए सक्षम नहीं की गई है।',
            )}
          </p>
        </Card>
      </div>
    );
  }

  return <StaffManagement />;
}
