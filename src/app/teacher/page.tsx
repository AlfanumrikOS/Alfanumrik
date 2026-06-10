'use client';

import dynamic from 'next/dynamic';
import { useTeacherCommandCenter } from '@/lib/use-teacher-command-center';
import AtlasTeacher from './AtlasTeacher';

// Phase 3A — the Command Center is code-split so the Atlas dispatch
// keeps its bundle when the flag is OFF (P10). The flag defaults OFF and is
// unseeded, so production never loads this chunk until rollout.
const CommandCenter = dynamic(() => import('./CommandCenter'), { ssr: false });

export default function TeacherPage() {
  // Phase 3A — Command Center wins when its flag is ON (the dense desktop home).
  // Synchronous read (sync cache, default OFF) so flag-OFF is byte-identical to
  // the prior dispatch on first paint — see use-teacher-command-center.ts.
  const commandCenter = useTeacherCommandCenter();
  if (commandCenter) return <CommandCenter />;
  return <AtlasTeacher />;
}
