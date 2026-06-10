'use client';

import { useSchoolCommandCenter } from '@/lib/use-school-command-center';
import AtlasSchoolAdmin from './AtlasSchoolAdmin';
import CommandCenter from './CommandCenter';

export default function SchoolAdminPage() {
  // Phase 3B dispatch (highest priority): when ff_school_command_center is ON,
  // render the read-only School Command Center. The hook sync-paints DEFAULT_OFF
  // with a 1h cache, so for every current (flag-absent) user it resolves to
  // false on the very first paint — the OFF path below is reached
  // byte-identically (no flash, no behaviour change). See
  // src/lib/use-school-command-center.ts.
  const commandCenter = useSchoolCommandCenter();
  if (commandCenter) return <CommandCenter />;
  return <AtlasSchoolAdmin />;
}
