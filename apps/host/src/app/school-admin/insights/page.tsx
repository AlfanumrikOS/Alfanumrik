 'use client';
import SchoolAdminV3PageGate, { SchoolLegacyRedirect } from '../_components/SchoolAdminV3PageGate';
import { SchoolV3Insights } from '../_components/SchoolAdminV3Views';
export default function SchoolInsightsPage() { return <SchoolAdminV3PageGate legacy={<SchoolLegacyRedirect href="/school-admin/reports" />} v3={<SchoolV3Insights />} />; }
