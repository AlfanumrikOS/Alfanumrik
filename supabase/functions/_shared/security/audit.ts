type SupabaseClientLike = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

export async function writeSecurityAudit(sb: SupabaseClientLike, args: {
  requestId: string;
  route: string;
  schoolId: string | null;
  userId: string | null;
  role: string | null;
  callerType: 'authenticated' | 'internal_service';
  serviceName: string | null;
  cronJob: string | null;
  internalWorker: string | null;
  internalCallerId: string | null;
  quotaDecision: string;
  latencyMs: number;
  statusCode: number;
  enforcementMode: 'enforce' | 'shadow' | 'observe' | 'disabled';
  breakerState: 'closed' | 'open' | 'half_open' | null;
  errorCode?: string | null;
  estimatedInputTokens?: number | null;
  estimatedOutputTokens?: number | null;
  estimatedCost?: number | null;
  actualInputTokens?: number | null;
  actualOutputTokens?: number | null;
  actualCost?: number | null;
}): Promise<void> {
  await sb.rpc('security_write_request_audit', {
    p_request_id: args.requestId,
    p_route: args.route,
    p_school_id: args.schoolId,
    p_user_id: args.userId,
    p_role: args.role,
    p_caller_type: args.callerType,
    p_service_name: args.serviceName,
    p_cron_job: args.cronJob,
    p_internal_worker: args.internalWorker,
    p_internal_caller_id: args.internalCallerId,
    p_quota_decision: args.quotaDecision,
    p_latency_ms: args.latencyMs,
    p_status_code: args.statusCode,
    p_enforcement_mode: args.enforcementMode,
    p_breaker_state: args.breakerState,
    p_error_code: args.errorCode ?? null,
    p_estimated_input_tokens: args.estimatedInputTokens ?? null,
    p_estimated_output_tokens: args.estimatedOutputTokens ?? null,
    p_estimated_cost: args.estimatedCost ?? null,
    p_actual_input_tokens: args.actualInputTokens ?? null,
    p_actual_output_tokens: args.actualOutputTokens ?? null,
    p_actual_cost: args.actualCost ?? null,
  });
}

