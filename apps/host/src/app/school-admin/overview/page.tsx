'use client';
import SchoolAdminV3PageGate, { SchoolLegacyRedirect } from '../_components/SchoolAdminV3PageGate';
import { SchoolV3Overview } from '../_components/SchoolAdminV3Views';
export default function SchoolOverviewPage() { return <SchoolAdminV3PageGate legacy={<SchoolLegacyRedirect href="/school-admin" />} v3={<SchoolV3Overview />} />; }
