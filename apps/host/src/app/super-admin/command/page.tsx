import SuperAdminV3ServerGate from '../_components/SuperAdminV3ServerGate';
import { SuperV3Command } from '../_components/SuperAdminV3Views';
export default function SuperCommandPage() { return <SuperAdminV3ServerGate legacyHref="/super-admin" routePath="/super-admin/command"><SuperV3Command /></SuperAdminV3ServerGate>; }
