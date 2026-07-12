import SuperAdminV3ServerGate from '../_components/SuperAdminV3ServerGate';
import { SuperV3Governance } from '../_components/SuperAdminV3Views';
export default function SuperSettingsPage() { return <SuperAdminV3ServerGate legacyHref="/super-admin/flags" routePath="/super-admin/settings" requiredLevel="super_admin"><SuperV3Governance /></SuperAdminV3ServerGate>; }
