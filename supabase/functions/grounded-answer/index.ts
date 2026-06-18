// supabase/functions/grounded-answer/index.ts
import { validateRequest } from './validators.ts';
import { runPipeline, writeUpstreamErrorTrace } from './pipeline.ts';
import { runStreamingPipeline } from './pipeline-stream.ts';
import { ensureSb, getSb, setSbForTests } from './_sb.ts';
import type { GroundedRequest, GroundedResponse } from './types.ts';
import { getRequestId, getRequestIp, getRequestOrigin, hashRequestIp } from '../_shared/security/attribution.ts';
import { resolveSecurityPrincipal } from '../_shared/security/auth.ts';
import { resolveRoutePolicy } from '../_shared/security/policy.ts';
import { estimateGroundedAnswerUsage, computeEstimatedCost, reserveQuota, settleQuota } from '../_shared/security/quota.ts';
import { writeSecurityAudit } from '../_shared/security/audit.ts';
import { recordCircuitOutcome } from '../_shared/security/circuit.ts';
import { securityCorsHeaders, securityErrorResponse, securityJsonResponse } from '../_shared/security/cors.ts';
import { sha256Hex } from '../_shared/security/request-signature.ts';
import type { SecurityPrincipal } from '../_shared/security/types.ts';

export { runPipeline, writeUpstreamErrorTrace } from './pipeline.ts';
export { __resetFeatureFlagCacheForTests } from './pipeline.ts';

// deno-lint-ignore no-explicit-any
export function __setSupabaseClientForTests(client: any): void {
  setSbForTests(client);
}

const ROUTE_NAME = 'grounded-answer';

// TODO(ai-engineer): re-enable truncation once the MoL grading pipeline
// confirms that capped responses do not lose scoring points. Until then,
// the cap is a no-op (students see the full answer; truncated=false).
const FOXY_WORD_SOFT_CAP = 180; // eslint-disable-line @typescript-eslint/no-unused-vars

export function applyFoxyWordCap(answer: string): {
  answer: string;
  truncated: boolean;
  originalWordCount: number;
} {
  const words = answer.split(/\s+/).filter((w) => w.length > 0);
  return { answer, truncated: false, originalWordCount: words.length };
}

function buildPanicResponse(traceId: string, latencyMs: number): GroundedResponse {
  return {
    grounded: false,
    abstain_reason: 'upstream_error',
    suggested_alternatives: [],
    trace_id: traceId,
    meta: { latency_ms: latencyMs },
  };
}

interface Admission {
  request: GroundedRequest;
  requestId: string;
  requestIpHash: string;
  origin: string | null;
  principal: SecurityPrincipal;
  policyMode: 'enforce' | 'shadow' | 'observe' | 'disabled';
  quotaDecision: ReturnType<typeof normalizeQuotaDecision>;
  quotaEstimate: {
    requestCount: number;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    estimatedCost: number;
    modelProvider: string;
    modelName: string;
  };
  bodyHash: string;
}

type QuotaDecision = {
  allowed: boolean;
  decision: string;
  enforcementMode: 'enforce' | 'shadow' | 'observe' | 'disabled';
  quotaProfileId?: string;
  policyId?: string;
  circuitState?: 'closed' | 'open' | 'half_open';
  reason?: string;
};

function normalizeQuotaDecision(input: QuotaDecision): QuotaDecision {
  return {
    ...input,
    decision: input.decision || 'deny_invalid_request',
    enforcementMode: input.enforcementMode ?? 'enforce',
    circuitState: input.circuitState ?? 'closed',
  };
}

async function admitRequest(
  req: Request,
  _started: number,
): Promise<{ ok: true; admission: Admission } | { ok: false; response: Response; requestId: string }> {
  const origin = getRequestOrigin(req);
  const requestId = getRequestId(req);
  const ipAddress = getRequestIp(req);
  const requestIpHash = await hashRequestIp(ipAddress, Deno.env.get('SECURITY_IP_HASH_SALT') ?? '');

  let rawBody = '';
  try {
    rawBody = await req.text();
  } catch {
    return {
      ok: false,
      requestId,
      response: securityErrorResponse('invalid_body', 'failed to read request body', 400, origin, requestId),
    };
  }

  const bodyHash = await sha256Hex(rawBody);

  let parsedBody: unknown;
  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return {
      ok: false,
      requestId,
      response: securityErrorResponse('invalid_json', 'request body is not valid JSON', 400, origin, requestId),
    };
  }

  const { error, request } = validateRequest(parsedBody);
  if (error || !request) {
    return {
      ok: false,
      requestId,
      response: securityErrorResponse(
        'invalid_request',
        `invalid request: ${error?.field ?? 'unknown'}`,
        400,
        origin,
        requestId,
        { field: error?.field ?? null },
      ),
    };
  }

  ensureSb();
  const sb = getSb();

  const principalRes = await resolveSecurityPrincipal({
    req,
    sb,
    _route: ROUTE_NAME,
    requestId,
    bodyHash,
    requestBodyCaller: request.caller,
  });
  if (!principalRes.ok) {
    return {
      ok: false,
      requestId,
      response: securityErrorResponse(
        principalRes.code,
        principalRes.message,
        principalRes.status,
        origin,
        requestId,
      ),
    };
  }

  const principal = principalRes.principal;

  const policy = await resolveRoutePolicy(sb, {
    route: ROUTE_NAME,
    schoolId: principal.schoolId,
    role: principal.role,
    callerType: principal.callerType,
    internalCallerId: principal.internalCallerId,
  });

  if (!policy) {
    return {
      ok: false,
      requestId,
      response: securityErrorResponse(
        'deny_policy',
        'route policy not found',
        403,
        origin,
        requestId,
      ),
    };
  }

  if (!policy.isEnabled) {
    return {
      ok: false,
      requestId,
      response: securityErrorResponse(
        'deny_policy',
        'route policy is disabled',
        403,
        origin,
        requestId,
      ),
    };
  }

  if (principal.callerType === 'internal_service') {
    if (!policy.allowSignedInternal) {
      return {
        ok: false,
        requestId,
        response: securityErrorResponse('deny_policy', 'internal callers not permitted on this route', 403, origin, requestId),
      };
    }
  } else if (!policy.allowJwt) {
    return {
      ok: false,
      requestId,
      response: securityErrorResponse('deny_policy', 'jwt callers not permitted on this route', 403, origin, requestId),
    };
  }

  const quotaEstimate = estimateGroundedAnswerUsage(request);
  quotaEstimate.estimatedCost = await computeEstimatedCost(sb, quotaEstimate);

  const quotaDecisionRaw = await reserveQuota(sb, {
    route: ROUTE_NAME,
    principal,
    _requestId: requestId,
    requestIpHash,
    estimate: quotaEstimate,
    dryRun: policy.enforcementMode !== 'enforce',
  });
  const quotaDecision = normalizeQuotaDecision(quotaDecisionRaw);

  if (policy.enforcementMode === 'enforce' && !quotaDecision.allowed) {
    const status = quotaDecision.decision === 'deny_breaker' ? 503 : 429;
    return {
      ok: false,
      requestId,
      response: securityErrorResponse(
        quotaDecision.decision,
        quotaDecision.reason ?? 'quota denied',
        status,
        origin,
        requestId,
      ),
    };
  }

  return {
    ok: true,
    admission: {
      request,
      requestId,
      requestIpHash,
      origin,
      principal,
      policyMode: policy.enforcementMode,
      quotaDecision,
      quotaEstimate,
      bodyHash,
    },
  };
}

async function finalizeAudit(args: {
  admission: Admission;
  statusCode: number;
  latencyMs: number;
  breakerState: 'closed' | 'open' | 'half_open';
  errorCode?: string | null;
  actualInputTokens?: number | null;
  actualOutputTokens?: number | null;
  actualCost?: number | null;
}): Promise<void> {
  try {
    const sb = getSb();
    await writeSecurityAudit(sb, {
      requestId: args.admission.requestId,
      route: ROUTE_NAME,
      schoolId: args.admission.principal.schoolId,
      userId: args.admission.principal.userId,
      role: args.admission.principal.role,
      callerType: args.admission.principal.callerType,
      serviceName: args.admission.principal.serviceName,
      cronJob: args.admission.principal.cronJob,
      internalWorker: args.admission.principal.internalWorker,
      internalCallerId: args.admission.principal.internalCallerId,
      quotaDecision: args.admission.policyMode === 'enforce' ? args.admission.quotaDecision.decision : `shadow_${args.admission.quotaDecision.decision}`,
      latencyMs: args.latencyMs,
      statusCode: args.statusCode,
      enforcementMode: args.admission.policyMode,
      breakerState: args.breakerState,
      errorCode: args.errorCode ?? null,
      estimatedInputTokens: args.admission.quotaEstimate.estimatedInputTokens,
      estimatedOutputTokens: args.admission.quotaEstimate.estimatedOutputTokens,
      estimatedCost: args.admission.quotaEstimate.estimatedCost,
      actualInputTokens: args.actualInputTokens ?? null,
      actualOutputTokens: args.actualOutputTokens ?? null,
      actualCost: args.actualCost ?? null,
    });
  } catch (err) {
    console.error(`[grounded-answer] audit write failed: ${String(err instanceof Error ? err.message : err)}`);
  }
}

async function finalizeQuota(args: {
  admission: Admission;
  actualInputTokens: number;
  actualOutputTokens: number;
  actualCost: number;
}): Promise<void> {
  try {
    const sb = getSb();
    await settleQuota(sb, {
      route: ROUTE_NAME,
      principal: args.admission.principal,
      requestIpHash: args.admission.requestIpHash,
      actualInputTokens: args.actualInputTokens,
      actualOutputTokens: args.actualOutputTokens,
      actualCost: args.actualCost,
      requestCount: 1,
    });
  } catch (err) {
    console.error(`[grounded-answer] quota settle failed: ${String(err instanceof Error ? err.message : err)}`);
  }
}

async function finalizeCircuit(
  admission: Admission,
  event: 'success' | 'failure' | 'probe' | 'force_open',
): Promise<void> {
  try {
    const sb = getSb();
    await recordCircuitOutcome(sb, {
      route: ROUTE_NAME,
      schoolId: admission.principal.schoolId,
      role: admission.principal.role,
      callerType: admission.principal.callerType,
      internalCallerId: admission.principal.internalCallerId,
      event,
    });
  } catch (err) {
    console.error(`[grounded-answer] circuit update failed: ${String(err instanceof Error ? err.message : err)}`);
  }
}

export async function handleRequest(req: Request): Promise<Response> {
  const started = Date.now();
  const origin = getRequestOrigin(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: securityCorsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: securityCorsHeaders(origin) });
  }

  const admissionResult = await admitRequest(req, started);
  if (!admissionResult.ok) {
    return admissionResult.response;
  }

  const admission = admissionResult.admission;
  const request = admission.request;
  const wantsStream = new URL(req.url).searchParams.get('stream') === '1';
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  const voyageKey = Deno.env.get('VOYAGE_API_KEY') ?? '';
  const openaiKey = Deno.env.get('OPENAI_API_KEY') ?? '';

  if (wantsStream) {
    if (request.mode === 'soft' && request.retrieve_only !== true) {
      try {
        return buildStreamingResponse({
          admission,
          started,
          anthropicKey,
          voyageKey,
          openaiKey,
        });
      } catch (err) {
        console.error(
          `grounded-answer: streaming setup threw — ${String(err instanceof Error ? err.stack ?? err.message : err)}`,
        );
        const traceId = await writeUpstreamErrorTrace(request, started);
        await finalizeCircuit(admission, 'failure');
        await finalizeAudit({
          admission,
          statusCode: 500,
          latencyMs: Date.now() - started,
          breakerState: 'open',
          errorCode: 'stream_setup_threw',
        });
        return securityJsonResponse(buildPanicResponse(traceId, Date.now() - started), 500, {}, admission.origin);
      }
    }
  }

  try {
    const response = await runPipeline(request, started, anthropicKey, voyageKey, openaiKey);

    let actualInputTokens = admission.quotaEstimate.estimatedInputTokens;
    let actualOutputTokens = 0;
    let actualCost = admission.quotaEstimate.estimatedCost;
    let breakerState: 'closed' | 'open' | 'half_open' = 'closed';
    let breakerEvent: 'success' | 'failure' = 'success';

    if (response.grounded && typeof response.answer === 'string') {
      const capped = applyFoxyWordCap(response.answer);
      if (capped.truncated) {
        console.log(
          JSON.stringify({
            event: 'foxy_word_cap_exceeded',
            original_word_count: capped.originalWordCount,
            soft_cap: FOXY_WORD_SOFT_CAP,
            caller: request.caller,
            grade: request.scope.grade,
            subject: request.scope.subject_code,
            trace_id: response.trace_id,
          }),
        );
        response.answer = capped.answer;
      }
      actualOutputTokens = response.meta.tokens_used ?? admission.quotaEstimate.estimatedOutputTokens;
      breakerState = 'closed';
      breakerEvent = 'success';
    } else if (!response.grounded && (response.abstain_reason === 'upstream_error' || response.abstain_reason === 'circuit_open')) {
      breakerState = response.abstain_reason === 'circuit_open' ? 'open' : 'closed';
      breakerEvent = 'failure';
      actualOutputTokens = 0;
      actualCost = 0;
    } else {
      breakerEvent = 'success';
      actualOutputTokens = 0;
      actualCost = 0;
    }

    await finalizeQuota({
      admission,
      actualInputTokens,
      actualOutputTokens,
      actualCost,
    });
    await finalizeCircuit(admission, breakerEvent);
    await finalizeAudit({
      admission,
      statusCode: 200,
      latencyMs: Date.now() - started,
      breakerState,
      actualInputTokens,
      actualOutputTokens,
      actualCost,
    });

    return securityJsonResponse(response, 200, { 'X-Request-Id': admission.requestId }, admission.origin);
  } catch (err) {
    console.error(
      `grounded-answer: runPipeline threw — ${String(err instanceof Error ? err.stack ?? err.message : err)}`,
    );
    const traceId = await writeUpstreamErrorTrace(request, started);
    await finalizeCircuit(admission, 'failure');
    await finalizeAudit({
      admission,
      statusCode: 500,
      latencyMs: Date.now() - started,
      breakerState: 'open',
      errorCode: 'pipeline_threw',
    });
    return securityJsonResponse(
      buildPanicResponse(traceId, Date.now() - started),
      500,
      { 'X-Request-Id': admission.requestId },
      admission.origin,
    );
  }
}

function buildStreamingResponse(args: {
  admission: Admission;
  started: number;
  anthropicKey: string;
  voyageKey: string;
  openaiKey: string;
}): Response {
  const { admission, started } = args;
  let finalOutcome: 'success' | 'failure' = 'success';
  let finalBreakerState: 'closed' | 'open' | 'half_open' = 'closed';
  let actualInputTokens = admission.quotaEstimate.estimatedInputTokens;
  let actualOutputTokens = 0;
  let actualCost = admission.quotaEstimate.estimatedCost;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (eventName: string, payload: unknown) => {
        const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
        controller.enqueue(encoder.encode(frame));
      };
      try {
        for await (const evt of runStreamingPipeline(
          admission.request,
          started,
          args.anthropicKey,
          args.voyageKey,
          args.openaiKey,
        )) {
          if (evt.kind === 'metadata') {
            send('metadata', {
              groundingStatus: evt.groundingStatus,
              citations: evt.citations,
              traceId: evt.traceId,
              confidence: evt.confidence,
            });
          } else if (evt.kind === 'text') {
            send('text', { delta: evt.delta });
          } else if (evt.kind === 'done') {
            send('done', {
              tokensUsed: evt.tokensUsed,
              latencyMs: evt.latencyMs,
              groundedFromChunks: evt.groundedFromChunks,
              claudeModel: evt.claudeModel,
              answerLength: evt.answerLength,
            });
            actualOutputTokens = evt.tokensUsed ?? actualOutputTokens;
            finalOutcome = 'success';
          } else if (evt.kind === 'abstain') {
            send('abstain', {
              abstainReason: evt.abstainReason,
              suggestedAlternatives: evt.suggestedAlternatives,
              traceId: evt.traceId,
              latencyMs: evt.latencyMs,
            });
            finalOutcome = (evt.abstainReason === 'upstream_error' || evt.abstainReason === 'circuit_open') ? 'failure' : 'success';
            if (evt.abstainReason === 'circuit_open') {
              finalBreakerState = 'open';
            }
            if (evt.abstainReason === 'upstream_error') {
              actualCost = 0;
              actualOutputTokens = 0;
            }
          } else if (evt.kind === 'error') {
            send('error', {
              reason: evt.reason,
              traceId: evt.traceId,
              latencyMs: evt.latencyMs,
            });
            finalOutcome = 'failure';
            finalBreakerState = 'open';
            actualCost = 0;
            actualOutputTokens = 0;
          }
        }
      } catch (err) {
        console.error(
          `grounded-answer(stream): generator threw — ${String(err instanceof Error ? err.stack ?? err.message : err)}`,
        );
        send('error', {
          reason: 'pipeline_threw',
          traceId: 'pending',
          latencyMs: Date.now() - started,
        });
        finalOutcome = 'failure';
        finalBreakerState = 'open';
        actualCost = 0;
        actualOutputTokens = 0;
      } finally {
        await finalizeQuota({
          admission,
          actualInputTokens,
          actualOutputTokens,
          actualCost,
        });
        await finalizeCircuit(admission, finalOutcome === 'success' ? 'success' : 'failure');
        await finalizeAudit({
          admission,
          statusCode: finalOutcome === 'success' ? 200 : 500,
          latencyMs: Date.now() - started,
          breakerState: finalBreakerState,
          actualInputTokens,
          actualOutputTokens,
          actualCost,
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Request-Id': admission.requestId,
      ...securityCorsHeaders(admission.origin),
    },
  });
}

Deno.serve(handleRequest);

export { getSb as __sbForTests };
