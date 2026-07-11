 'use client';
import SchoolAdminV3PageGate, { SchoolLegacyRedirect } from '../_components/SchoolAdminV3PageGate';
import { SchoolV3People } from '../_components/SchoolAdminV3Views';
export default function SchoolPeoplePage() { return <SchoolAdminV3PageGate legacy={<SchoolLegacyRedirect href="/school-admin/students" />} v3={<SchoolV3People />} />; }
