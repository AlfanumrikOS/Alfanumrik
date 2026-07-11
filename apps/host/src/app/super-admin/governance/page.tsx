import SuperAdminV3ServerGate from '../_components/SuperAdminV3ServerGate';
import { SuperV3Governance } from '../_components/SuperAdminV3Views';
export default function SuperGovernancePage() { return <SuperAdminV3ServerGate legacyHref="/super-admin/rbac" routePath="/super-admin/governance" requiredLevel="super_admin"><SuperV3Governance /></SuperAdminV3ServerGate>; }
