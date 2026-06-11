'use client';

/**
 * /school-admin/ai-assistant — Principal AI Assistant chat workspace (Track 2 v1).
 *
 * NEW page. A school-scoped, plain-language analytics assistant for a school's
 * PRINCIPAL. It is the UI for /api/school-admin/ai-assistant (GET history + POST
 * chat), gated to the principal-only `institution.use_principal_ai` capability.
 *
 * Gating (UI convenience — the route enforces regardless, P9):
 *   - Flag: `ff_principal_ai_v1` via usePrincipalAi(). DEFAULT OFF. When OFF the
 *     page renders a "not available" notice and never calls the API (which itself
 *     404s while the flag is OFF). The nav entry that links here is likewise
 *     suppressed when the flag is OFF (see SchoolAdminShell), so the OFF portal is
 *     byte-identical to today.
 *   - Capability: principal-only. We mirror the server's principal-only grant by
 *     checking the caller's own `school_admins.role === 'principal'`
 *     (useSchoolAdminRole, an RLS-bounded self-read). A non-principal sees the same
 *     "not available" notice; the API would 403 regardless. Fail-CLOSED here while
 *     the role is still loading (show a skeleton, not the chat) so a non-principal
 *     never briefly sees the workspace.
 *
 * P10: the chat workspace is lazy-loaded via next/dynamic so this route adds no
 * weight to the shared/legacy school-admin bundle (the chunk only ships once a
 * permitted principal opens the page).
 */

import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/AuthContext';
import { usePrincipalAi } from '@/lib/use-principal-ai';
import { useSchoolAdminRole } from '@/lib/use-school-admin-role';
import { Card, Skeleton } from '@/components/ui';

function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

// Lazy-load the chat workspace (P10 — keeps it off the shared bundle; only ships
// when a permitted principal lands here).
const PrincipalAiChat = dynamic(
  () => import('@/components/school-admin/principal-ai/PrincipalAiChat'),
  {
    ssr: false,
    loading: () => (
      <div className="mx-auto max-w-3xl space-y-3 px-4 pt-6">
        <Skeleton variant="title" height={26} width="40%" />
        <Skeleton variant="text" height={13} width="60%" />
        <div className="mt-6 space-y-3">
          <Skeleton variant="rect" height={48} rounded="rounded-xl" />
          <Skeleton variant="rect" height={48} rounded="rounded-xl" />
          <Skeleton variant="rect" height={48} rounded="rounded-xl" />
        </div>
      </div>
    ),
  },
);

function NotAvailable({ isHi }: { isHi: boolean }) {
  return (
    <div
      className="flex min-h-[60dvh] items-center justify-center px-4 font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
    >
      <Card className="w-full max-w-sm py-10 text-center">
        <div className="mb-3 text-4xl" aria-hidden="true">
          🔒
        </div>
        <h1
          className="mb-2 text-base font-bold text-[var(--text-1)]"
          style={{ fontFamily: 'Sora, system-ui, sans-serif' }}
        >
          {t(isHi, 'Principal Assistant is not available', 'Principal सहायक उपलब्ध नहीं है')}
        </h1>
        <p className="text-sm text-[var(--text-3)]">
          {t(
            isHi,
            'This feature is available to school principals once enabled for your school.',
            'यह सुविधा सक्षम होने पर स्कूल के प्रधानाचार्य के लिए उपलब्ध होती है।',
          )}
        </p>
      </Card>
    </div>
  );
}

export default function PrincipalAiPage() {
  const { authUserId, isHi } = useAuth();
  const flagEnabled = usePrincipalAi();
  const { role, loading: roleLoading } = useSchoolAdminRole(authUserId);

  // Flag OFF → not available (the API 404s too). Byte-identical-OFF.
  if (!flagEnabled) {
    return <NotAvailable isHi={isHi} />;
  }

  // Flag ON but role still resolving → fail-CLOSED with a skeleton so a
  // non-principal never briefly sees the chat workspace.
  if (roleLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 pt-6">
        <Skeleton variant="title" height={26} width="40%" />
        <Skeleton variant="text" height={13} width="60%" />
      </div>
    );
  }

  // Principal-only capability (mirrors the server grant). Non-principal → not
  // available; the API would 403 regardless.
  if (role !== 'principal') {
    return <NotAvailable isHi={isHi} />;
  }

  return <PrincipalAiChat />;
}
