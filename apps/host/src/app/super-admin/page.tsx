import { requireAdminOrRedirect } from '@/lib/admin-auth-server';
// File path retains its historical "Legacy" name; the export is ControlRoomPage.
import ControlRoomPage from './_components/LegacySuperAdminPage';

export default async function SuperAdminPage() {
  await requireAdminOrRedirect('support');
  return <ControlRoomPage />;
}
