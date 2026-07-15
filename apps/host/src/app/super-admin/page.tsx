import { requireAdminOrRedirect } from '@/lib/admin-auth-server';
import LegacySuperAdminPage from './_components/LegacySuperAdminPage';

export default async function SuperAdminPage() {
  await requireAdminOrRedirect('support');
  return <LegacySuperAdminPage />;
}
