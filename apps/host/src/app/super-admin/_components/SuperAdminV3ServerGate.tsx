import { requireAdminOrRedirect } from '@/lib/admin-auth-server';
import { resolveCapabilities, resolveExperienceV3, resolveRouteCapability } from '@alfanumrik/lib/experience-v3';
import { adminExperiencePermissions, type AdminLevel } from '@alfanumrik/lib/admin-auth';
import { redirect } from 'next/navigation';
import SuperAdminV3Workspace from './SuperAdminV3Workspace';

export default async function SuperAdminV3ServerGate({ children, legacyHref, requiredLevel = 'support', routePath }: { children: React.ReactNode; legacyHref: string; requiredLevel?: AdminLevel; routePath: string }) {
  const admin = await requireAdminOrRedirect(requiredLevel);
  const enabled = await resolveExperienceV3({
    role: 'super-admin',
    userId: admin.userId,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
  });
  if (!enabled) redirect(legacyHref);
  const permissions = adminExperiencePermissions(admin.adminLevel);
  const manifest = resolveCapabilities({ role: 'super-admin', permissions }).manifest;
  if (!resolveRouteCapability(manifest, routePath)?.allowed) redirect(legacyHref);
  return <SuperAdminV3Workspace adminName={admin.name || admin.email} adminLevel={admin.adminLevel} manifest={manifest}>{children}</SuperAdminV3Workspace>;
}
