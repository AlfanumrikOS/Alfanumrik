'use client';
import SchoolAdminV3PageGate, { SchoolLegacyRedirect } from '../_components/SchoolAdminV3PageGate';
import { SchoolV3Settings } from '../_components/SchoolAdminV3Views';
export default function SchoolGovernancePage() { return <SchoolAdminV3PageGate legacy={<SchoolLegacyRedirect href="/school-admin/audit-log" />} v3={<SchoolV3Settings />} />; }
