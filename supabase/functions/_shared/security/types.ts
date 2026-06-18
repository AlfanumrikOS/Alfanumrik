export type SecurityCallerType = 'authenticated' | 'internal_service';
export type SecurityRole = 'student' | 'parent' | 'teacher' | 'school_admin' | 'internal_service';
export type SecurityEnforcementMode = 'enforce' | 'shadow' | 'observe' | 'disabled';
export type SecurityDecision =
  | 'allow'
  | 'deny_auth'
  | 'deny_signature'
  | 'deny_policy'
  | 'deny_breaker'
  | 'deny_quota'
  | 'deny_invalid_request';

export interface RequestEnvelope {
  requestId: string;
  route: string;
  startedAt: number;
  origin: string | null;
  ipAddress: string | null;
  ipHash: string;
  bodyHash: string;
}

export interface SecurityPrincipal {
  callerType: SecurityCallerType;
  userId: string | null;
  schoolId: string | null;
  role: SecurityRole;
  serviceName: string;
  cronJob: string | null;
  internalWorker: string | null;
  internalCallerId: string | null;
  internalCallerName: string | null;
  internalCallerKind: 'service_name' | 'cron_job' | 'internal_worker' | null;
}

export interface SecurityPolicy {
  id: string;
  route: string;
  schoolId: string | null;
  role: SecurityRole | null;
  callerType: 'public' | 'authenticated' | 'internal_service';
  internalCallerId: string | null;
  quotaProfileId: string;
  enforcementMode: SecurityEnforcementMode;
  allowSignedInternal: boolean;
  allowJwt: boolean;
  allowServiceRole: boolean;
  isEnabled: boolean;
}

export interface SecurityQuotaEstimate {
  requestCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCost: number;
  modelProvider: string;
  modelName: string;
}

export interface SecurityQuotaResult {
  allowed: boolean;
  decision: SecurityDecision;
  enforcementMode: SecurityEnforcementMode;
  quotaProfileId?: string;
  policyId?: string;
  circuitState?: 'closed' | 'open' | 'half_open';
  reason?: string;
}

