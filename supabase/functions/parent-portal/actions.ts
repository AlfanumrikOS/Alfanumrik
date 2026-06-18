export const parentPortalActionNames = [
  'parent_login',
  'get_child_dashboard',
  'get_tips',
  'get_children',
  'get_monthly_report',
] as const

export type ParentPortalActionName = typeof parentPortalActionNames[number]

export interface ParentPortalActionInput {
  action: ParentPortalActionName
  guardian_id?: string
  [key: string]: unknown
}

export interface ParentPortalActionOutput {
  success?: boolean
  error?: string
  [key: string]: unknown
}

export interface ParentPortalActionContract {
  readonly name: ParentPortalActionName
  readonly auditLabel: `parent_portal.${ParentPortalActionName}`
  readonly metricLabel: `parent_portal.${ParentPortalActionName}`
  readonly requiresJwtAuth: true
  readonly requiresGuardianTenantBinding: boolean
}

export const parentPortalActions: Record<ParentPortalActionName, ParentPortalActionContract> =
  Object.fromEntries(
    parentPortalActionNames.map((name) => [name, {
      name,
      auditLabel: `parent_portal.${name}`,
      metricLabel: `parent_portal.${name}`,
      requiresJwtAuth: true,
      requiresGuardianTenantBinding: name !== 'parent_login',
    }]),
  ) as Record<ParentPortalActionName, ParentPortalActionContract>
