import SuperAdminV3ServerGate from '../_components/SuperAdminV3ServerGate';
import { SuperV3Revenue } from '../_components/SuperAdminV3Views';
export default function SuperRevenuePage() { return <SuperAdminV3ServerGate legacyHref="/super-admin/subscriptions" routePath="/super-admin/revenue"><SuperV3Revenue /></SuperAdminV3ServerGate>; }
