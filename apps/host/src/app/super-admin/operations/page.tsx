import SuperAdminV3ServerGate from '../_components/SuperAdminV3ServerGate';
import { SuperV3Operations } from '../_components/SuperAdminV3Views';
export default function SuperOperationsPage() { return <SuperAdminV3ServerGate legacyHref="/super-admin/observability" routePath="/super-admin/operations"><SuperV3Operations /></SuperAdminV3ServerGate>; }
