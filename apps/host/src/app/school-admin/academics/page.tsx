 'use client';
import SchoolAdminV3PageGate, { SchoolLegacyRedirect } from '../_components/SchoolAdminV3PageGate';
import { SchoolV3Academics } from '../_components/SchoolAdminV3Views';
export default function SchoolAcademicsPage() { return <SchoolAdminV3PageGate legacy={<SchoolLegacyRedirect href="/school-admin/classes" />} v3={<SchoolV3Academics />} />; }
