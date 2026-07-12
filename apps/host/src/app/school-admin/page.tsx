'use client';

import CommandCenter from './CommandCenter';
import SchoolAdminV3PageGate from './_components/SchoolAdminV3PageGate';
import { SchoolV3Overview } from './_components/SchoolAdminV3Views';

export default function SchoolAdminPage() {
  // School Command Center is the sole school-admin home. The
  // ff_school_command_center flag is globally ON in prod, so the legacy
  // dispatch (and its first-paint flag race) is removed: every school_admin
  // sees the purple Command Center. The deprecated Atlas body is kept for
  // verification at ./_deprecated_AtlasSchoolAdmin.tsx (not rendered).
  return <SchoolAdminV3PageGate legacy={<CommandCenter />} v3={<SchoolV3Overview />} />;
}
