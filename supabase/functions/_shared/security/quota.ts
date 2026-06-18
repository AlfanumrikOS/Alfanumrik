import type { SecurityPrincipal, SecurityQuotaEstimate, SecurityQuotaResult } from './types.ts';
import { sha256Hex } from './request-signature.ts';

type SupabaseClientLike = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

function mapModel(preference: 'haiku' | 'sonnet' | 'auto'): { provider: string; model: string } {
  if (preference === 'haiku') return { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };
  return { provider: 'anthropic', model: 'claude-sonnet-4-6-20251022' };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateGroundedAnswerUsage(request: {
  query: string;
  scope: { grade: string; subject_code: string; chapter_number: number | null; chapter_title: string | null };
  generation: {
    model_preference: 'haiku' | 'sonnet' | 'auto';
    max_tokens: number;
    template_variables: Record<string, string>;
    conversation_turns?: Array<{ role: 'user' | 'assistant'; content: string }>;
  };
  retrieval: { match_count: number };
  retrieve_only?: boolean;
}): SecurityQuotaEstimate {
  const promptBits = [
    request.query,
    request.scope.grade,
    request.scope.subject_code,
    request.scope.chapter_title ?? '',
    JSON.stringify(request.generation.template_variables ?? {}),
    JSON.stringify(request.generation.conversation_turns ?? []),
  ].join('\n');
  const inputTokens = estimateTokens(promptBits) + 120 + (request.retrieval.match_count * 80);
  const outputTokens = request.retrieve_only ? 32 : request.generation.max_tokens;
  const model = mapModel(request.generation.model_preference);
  return {
    requestCount: 1,
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    estimatedCost: 0,
    modelProvider: model.provider,
    modelName: model.model,
  };
}

export async function computeEstimatedCost(
  sb: SupabaseClientLike,
  estimate: SecurityQuotaEstimate,
): Promise<number> {
  const res = await sb.rpc('security_compute_ai_cost', {
    p_provider: estimate.modelProvider,
    p_model: estimate.modelName,
    p_input_tokens: estimate.estimatedInputTokens,
    p_output_tokens: estimate.estimatedOutputTokens,
  });
  if (res.error || res.data == null) return 0;
  return Number(res.data) || 0;
}

export async function reserveQuota(
  sb: SupabaseClientLike,
  args: {
    route: string;
    principal: SecurityPrincipal;
    _requestId: string;
    requestIpHash: string;
    estimate: SecurityQuotaEstimate;
    dryRun?: boolean;
  },
): Promise<SecurityQuotaResult> {
  const res = await sb.rpc('security_reserve_quota', {
    p_route: args.route,
    p_school_id: args.principal.schoolId,
    p_user_id: args.principal.userId,
    p_role: args.principal.role,
    p_caller_type: args.principal.callerType,
    p_internal_caller_id: args.principal.internalCallerId,
    p_request_ip_hash: args.requestIpHash,
    p_estimated_input_tokens: args.estimate.estimatedInputTokens,
    p_estimated_output_tokens: args.estimate.estimatedOutputTokens,
    p_estimated_cost: args.estimate.estimatedCost,
    p_request_count: args.estimate.requestCount,
    p_dry_run: args.dryRun ?? false,
  });

  const data = (res.data && typeof res.data === 'object') ? res.data as Record<string, unknown> : {};
  return {
    allowed: data.allowed === true,
    decision: normalizeDecision(String(data.decision ?? 'deny_invalid_request')),
    enforcementMode: normalizeMode(String(data.enforcement_mode ?? 'enforce')),
    quotaProfileId: data.quota_profile_id ? String(data.quota_profile_id) : undefined,
    policyId: data.policy_id ? String(data.policy_id) : undefined,
    circuitState: normalizeCircuit(String(data.circuit_state ?? 'closed')),
    reason: data.reason ? String(data.reason) : undefined,
  };
}

export async function settleQuota(
  sb: SupabaseClientLike,
  args: {
    route: string;
    principal: SecurityPrincipal;
    requestIpHash: string;
    actualInputTokens: number;
    actualOutputTokens: number;
    actualCost: number;
    requestCount?: number;
  },
): Promise<void> {
  await sb.rpc('security_settle_quota', {
    p_route: args.route,
    p_school_id: args.principal.schoolId,
    p_user_id: args.principal.userId,
    p_role: args.principal.role,
    p_caller_type: args.principal.callerType,
    p_internal_caller_id: args.principal.internalCallerId,
    p_request_ip_hash: args.requestIpHash,
    p_actual_input_tokens: args.actualInputTokens,
    p_actual_output_tokens: args.actualOutputTokens,
    p_actual_cost: args.actualCost,
    p_request_count: args.requestCount ?? 1,
  });
}

function normalizeDecision(value: string): SecurityQuotaResult['decision'] {
  switch (value) {
    case 'allow':
    case 'deny_auth':
    case 'deny_signature':
    case 'deny_policy':
    case 'deny_breaker':
    case 'deny_quota':
    case 'deny_invalid_request':
      return value;
    default:
      return 'deny_invalid_request';
  }
}

function normalizeMode(value: string): SecurityQuotaResult['enforcementMode'] {
  switch (value) {
    case 'enforce':
    case 'shadow':
    case 'observe':
    case 'disabled':
      return value;
    default:
      return 'enforce';
  }
}

function normalizeCircuit(value: string): SecurityQuotaResult['circuitState'] {
  switch (value) {
    case 'closed':
    case 'open':
    case 'half_open':
      return value;
    default:
      return 'closed';
  }
}
