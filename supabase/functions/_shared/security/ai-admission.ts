import { getRequestId, getRequestIp, getRequestOrigin, hashRequestIp } from './attribution.ts';
import { resolveSecurityPrincipal } from './auth.ts';
import { resolveRoutePolicy } from './policy.ts';
import { computeEstimatedCost, reserveQuota, settleQuota } from './quota.ts';
import { recordCircuitOutcome } from './circuit.ts';
import { writeSecurityAudit } from './audit.ts';
import { sha256Hex } from './request-signature.ts';
import type { SecurityPrincipal, SecurityQuotaEstimate, SecurityQuotaResult, SecurityEnforcementMode } from './types.ts';

type SupabaseClientLike = {
  auth: { getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

export type AiRouteCallerType = 'student' | 'parent' | 'teacher' | 'school_admin' | 'public' | 'internal_service';

export interface AiAdmissionContext {
  route: string;
  requestId: string;
  origin: string | null;
  requestIpHash: string;
  startedAt: number;
  principal: SecurityPrincipal;
  quotaDecision: SecurityQuotaResult;
  quotaEstimate: SecurityQuotaEstimate;
  enforcementMode: SecurityEnforcementMode;
}

export interface AiRouteProfile {
  route: string;
  callerTypes: AiRouteCallerType[];
  modelProvider: string;
  modelName: string;
  estimate: (bodyText: string) => Omit<SecurityQuotaEstimate, 'estimatedCost' | 'modelProvider' | 'modelName'> & Partial<Pick<SecurityQuotaEstimate, 'modelProvider' | 'modelName'>>;
}

export function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function createStaticAiRouteProfile(args: {
  route: string;
  callerTypes: AiRouteCallerType[];
  modelProvider?: string;
  modelName?: string;
  inputTokenFloor?: number;
  outputTokens?: number;
}): AiRouteProfile {
  return {
    route: args.route,
    callerTypes: args.callerTypes,
    modelProvider: args.modelProvider ?? 'anthropic',
    modelName: args.modelName ?? 'claude-haiku-4-5-20251001',
    estimate: (bodyText: string) => ({
      requestCount: 1,
      estimatedInputTokens: Math.max(args.inputTokenFloor ?? 256, estimateTextTokens(bodyText)),
      estimatedOutputTokens: args.outputTokens ?? 1024,
    }),
  };
}

export async function admitAiRoute(args: {
  req: Request;
  sb: SupabaseClientLike;
  profile: AiRouteProfile;
  bodyText: string;
}): Promise<{ ok: true; admission: AiAdmissionContext } | { ok: false; response: Response; requestId: string }> {
  const requestId = getRequestId(args.req);
  const origin = getRequestOrigin(args.req);
  const requestIpHash = await hashRequestIp(getRequestIp(args.req), Deno.env.get('SECURITY_IP_HASH_SALT') ?? '');
  const bodyHash = await sha256Hex(args.bodyText);
  const auth = await resolveSecurityPrincipal({
    req: args.req,
    sb: args.sb,
    _route: args.profile.route,
    requestId,
    bodyHash,
    requestBodyCaller: args.profile.route,
  });
  if (!auth.ok) {
    return { ok: false, requestId, response: jsonDeny(auth.code, auth.message, auth.status, requestId, origin) };
  }

  const resolvedCallerType = auth.principal.role === 'internal_service' ? 'internal_service' : auth.principal.role;
  if (!args.profile.callerTypes.includes(resolvedCallerType)) {
    return { ok: false, requestId, response: jsonDeny('deny_policy', 'caller role is not admitted for this AI route', 403, requestId, origin) };
  }

  const policy = await resolveRoutePolicy(args.sb, {
    route: args.profile.route,
    schoolId: auth.principal.schoolId,
    role: auth.principal.role,
    callerType: auth.principal.callerType,
    internalCallerId: auth.principal.internalCallerId,
  });
  if (!policy?.isEnabled) {
    return { ok: false, requestId, response: jsonDeny('deny_policy', 'AI route policy is not enabled', 403, requestId, origin) };
  }

  const partial = args.profile.estimate(args.bodyText);
  const quotaEstimate: SecurityQuotaEstimate = {
    requestCount: partial.requestCount,
    estimatedInputTokens: partial.estimatedInputTokens,
    estimatedOutputTokens: partial.estimatedOutputTokens,
    estimatedCost: 0,
    modelProvider: partial.modelProvider ?? args.profile.modelProvider,
    modelName: partial.modelName ?? args.profile.modelName,
  };
  quotaEstimate.estimatedCost = await computeEstimatedCost(args.sb, quotaEstimate);
  const quotaDecision = await reserveQuota(args.sb, {
    route: args.profile.route,
    principal: auth.principal,
    _requestId: requestId,
    requestIpHash,
    estimate: quotaEstimate,
    dryRun: policy.enforcementMode !== 'enforce',
  });
  const enforcementMode = policy.enforcementMode;
  if (enforcementMode === 'enforce' && !quotaDecision.allowed) {
    const status = quotaDecision.decision === 'deny_breaker' ? 503 : 429;
    return { ok: false, requestId, response: jsonDeny(quotaDecision.decision, quotaDecision.reason ?? 'AI route admission denied', status, requestId, origin) };
  }
  return {
    ok: true,
    admission: { route: args.profile.route, requestId, origin, requestIpHash, startedAt: Date.now(), principal: auth.principal, quotaDecision, quotaEstimate, enforcementMode },
  };
}

export async function finalizeAiRoute(args: {
  sb: SupabaseClientLike;
  admission: AiAdmissionContext;
  statusCode: number;
  errorCode?: string | null;
  actualInputTokens?: number | null;
  actualOutputTokens?: number | null;
  actualCost?: number | null;
}): Promise<void> {
  const { admission } = args;
  await writeSecurityAudit(args.sb, {
    requestId: admission.requestId,
    route: admission.route,
    schoolId: admission.principal.schoolId,
    userId: admission.principal.userId,
    role: admission.principal.role,
    callerType: admission.principal.callerType,
    serviceName: admission.principal.serviceName,
    cronJob: admission.principal.cronJob,
    internalWorker: admission.principal.internalWorker,
    internalCallerId: admission.principal.internalCallerId,
    quotaDecision: admission.enforcementMode === 'enforce' ? admission.quotaDecision.decision : `shadow_${admission.quotaDecision.decision}`,
    latencyMs: Date.now() - admission.startedAt,
    statusCode: args.statusCode,
    enforcementMode: admission.enforcementMode,
    breakerState: admission.quotaDecision.circuitState ?? 'closed',
    errorCode: args.errorCode ?? null,
    estimatedInputTokens: admission.quotaEstimate.estimatedInputTokens,
    estimatedOutputTokens: admission.quotaEstimate.estimatedOutputTokens,
    estimatedCost: admission.quotaEstimate.estimatedCost,
    actualInputTokens: args.actualInputTokens ?? null,
    actualOutputTokens: args.actualOutputTokens ?? null,
    actualCost: args.actualCost ?? null,
  });
  if (args.statusCode < 400) {
    await settleQuota(args.sb, {
      route: admission.route,
      principal: admission.principal,
      requestIpHash: admission.requestIpHash,
      actualInputTokens: args.actualInputTokens ?? admission.quotaEstimate.estimatedInputTokens,
      actualOutputTokens: args.actualOutputTokens ?? admission.quotaEstimate.estimatedOutputTokens,
      actualCost: args.actualCost ?? admission.quotaEstimate.estimatedCost,
      requestCount: admission.quotaEstimate.requestCount,
    });
  }
  await recordCircuitOutcome(args.sb, {
    route: admission.route,
    schoolId: admission.principal.schoolId,
    role: admission.principal.role,
    callerType: admission.principal.callerType,
    internalCallerId: admission.principal.internalCallerId,
    event: args.statusCode >= 500 ? 'failure' : 'success',
    errorCode: args.errorCode ?? null,
  });
}

export async function fetchWithProviderTimeout(input: string | URL | Request, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: init.signal ?? controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function jsonDeny(code: string, message: string, status: number, requestId: string, origin: string | null): Response {
  return new Response(JSON.stringify({ error: code, message, request_id: requestId }), {
    status,
    headers: { 'content-type': 'application/json', ...(origin ? { 'access-control-allow-origin': origin } : {}) },
  });
}
