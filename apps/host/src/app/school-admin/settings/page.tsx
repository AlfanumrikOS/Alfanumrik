/**
 * Legacy-bookmark redirect stub (Task 1.6c). This route existed under the old
 * flat school-admin IA (pre-Command-Center consolidation); it is intentionally
 * kept as a thin redirect — NOT an orphaned/dead page — so any bookmark,
 * external link, or muscle-memory URL still lands somewhere valid after the
 * consolidated nav (ConsolidatedSchoolNav.tsx) replaced it with '/school-admin/setup'.
 * Safe to delete only once analytics confirm zero hits over a full quarter.
 */
import { redirect } from 'next/navigation';
export default function SchoolSettingsPage() { redirect('/school-admin/setup'); }
