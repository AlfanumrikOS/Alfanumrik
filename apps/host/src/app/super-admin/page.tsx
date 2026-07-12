import { requireAdminOrRedirect } from '@/lib/admin-auth-server';
import { adminExperiencePermissions } from '@alfanumrik/lib/admin-auth';
import {
  resolveCapabilities,
  resolveExperienceV3,
  resolveExperienceV3Landing,
} from '@alfanumrik/lib/experience-v3';
import { DataState } from '@alfanumrik/ui/v3';
import { redirect } from 'next/navigation';
import LegacySuperAdminPage from './_components/LegacySuperAdminPage';

export default async function SuperAdminPage() {
  const admin = await requireAdminOrRedirect('support');
  const enabled = await resolveExperienceV3({
    role: 'super-admin',
    userId: admin.userId,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
  });

  const manifest = enabled
    ? resolveCapabilities({
        role: 'super-admin',
        permissions: adminExperiencePermissions(admin.adminLevel),
      }).manifest
    : null;
  const decision = resolveExperienceV3Landing({
    enabled,
    manifest,
    legacyPath: '/super-admin',
  });

  if (decision.kind === 'redirect') redirect(decision.href);
  if (decision.kind === 'denied') {
    return <DataState state="permission" title="This operator destination is unavailable" />;
  }
  return <LegacySuperAdminPage />;
}
