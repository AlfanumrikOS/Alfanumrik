// supabase/functions/alfabot-answer/index.ts
//
// AlfaBot Edge Function — "given a turn, return a response".
//
// Responsibility (PR 2 of AlfaBot rollout):
//   1. Validate body shape (shared.ts).
//   2. Detect hard refusals BEFORE any model call (shared.ts).
//   3. Retrieve KB chunks via Voyage + match_alfabot_kb_chunks RPC.
//   4. Build the AlfaBot system prompt + history.
//   5. Stream OpenAI gpt-4o-mini tokens back as SSE OR return JSON.
//   6. Post-process: ban-phrase + pricing + citation + length checks.
//   7. NEVER 5xx on upstream failures — return degradedMode:true abstain
//      so the user sees a useful reply instead of a broken UI.
//
// Out of scope (handled by the Next route in PR 2 sibling work):
//   - Session minting + DB persistence (alfabot_sessions / alfabot_messages).
//   - Rate limiting + denylist enforcement.
//   - Lead-capture API.
//
// Logging contract (P13): structured JSON only, NO message content. We log
// anonId (forwarded), sessionId, audience, lang, latencyMs, tokensUsed,
// model, degradedMode, abstainReason.
//
// Owner: ai-engineer. Reviewers: assessment (scope), quality.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

import {
  ALFABOT_CORE_CONTEXT,
  ALFABOT_OPENAI_CONFIG,
  buildAlfaBotPrompt,
} from './prompt.ts';
import { retrieveAlfabotChunks } from './retrieval.ts';
import {
  AlfabotUpstreamError,
  callOpenAIChat,
  type OpenAIMessage,
} from './openai-client.ts';
import { buildDegradedReply, validateResponse } from './post-process.ts';
import {
  alfabotCircuitKey,
  canProceed,
  recordFailure,
  recordSuccess,
} from './circuit.ts';
import {
  detectHardRefusal,
  logTurn,
  validateBody,
  type AlfabotRequest,
  type DoneEnvelope,
} from './shared.ts';
import { buildStreamingResponse } from './stream-response.ts';

// ─── CORS ───────────────────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
};

// ─── Supabase client (lazy, service-role) ──────────────────────────────────

// deno-lint-ignore no-explicit-any
let _sb: any = null;
// deno-lint-ignore no-explicit-any
function getServiceClient(): any {
  if (_sb) return _sb;
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) return null;
  _sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _sb;
}

// Test hook: inject a stub client.
// deno-lint-ignore no-explicit-any
export function __setSupabaseClientForTests(client: any): void {
  _sb = client;
}

// ─── Response builders ──────────────────────────────────────────────────────

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

interface NonStreamResult {
  response: string;
  sourcesUsed: string[];
  model: string;
  tokensUsed: number;
  latencyMs: number;
  degradedMode: boolean;
  abstainReason?: string;
}

// ─── Non-streaming turn ────────────────────────────────────────────────────

async function runTurnNonStream(
  req: AlfabotRequest,
  startedAt: number,
): Promise<NonStreamResult> {
  const hard = detectHardRefusal(req.message, req.lang);
  if (hard) {
    return {
      response: hard.reply,
      sourcesUsed: [],
      model: 'hard_refusal',
      tokensUsed: 0,
      latencyMs: Date.now() - startedAt,
      degradedMode: false,
      abstainReason: hard.reason,
    };
  }

  const cKey = alfabotCircuitKey('openai');
  if (!canProceed(cKey)) {
    return {
      response: buildDegradedReply(req.lang),
      sourcesUsed: [],
      model: 'circuit_open',
      tokensUsed: 0,
      latencyMs: Date.now() - startedAt,
      degradedMode: true,
      abstainReason: 'circuit_open',
    };
  }

  const sb = getServiceClient();
  const chunks = sb ? await retrieveAlfabotChunks(sb, req.message, req.audience, req.lang) : [];

  const { systemPrompt, userMessages } = buildAlfaBotPrompt({
    audience: req.audience,
    lang: req.lang,
    coreContext: ALFABOT_CORE_CONTEXT,
    retrievedChunks: chunks,
    history: req.history,
  });

  const messages: OpenAIMessage[] = [
    ...userMessages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: req.message },
  ];

  let modelText = '';
  let modelName: string = ALFABOT_OPENAI_CONFIG.model;
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    const result = await callOpenAIChat(systemPrompt, messages, {
      model: ALFABOT_OPENAI_CONFIG.model,
      temperature: ALFABOT_OPENAI_CONFIG.temperature,
      max_tokens: ALFABOT_OPENAI_CONFIG.max_tokens,
      presence_penalty: ALFABOT_OPENAI_CONFIG.presence_penalty,
      frequency_penalty: ALFABOT_OPENAI_CONFIG.frequency_penalty,
    });
    modelText = result.text;
    modelName = result.model;
    promptTokens = result.promptTokens;
    completionTokens = result.completionTokens;
    recordSuccess(cKey);
  } catch (err) {
    const kind = err instanceof AlfabotUpstreamError ? err.kind : 'unknown';
    if (kind !== 'auth_error') recordFailure(cKey);
    return {
      response: buildDegradedReply(req.lang),
      sourcesUsed: chunks.map((c) => c.section_id),
      model: `error_${kind}`,
      tokensUsed: 0,
      latencyMs: Date.now() - startedAt,
      degradedMode: true,
      abstainReason: `upstream_${kind}`,
    };
  }

  const validation = validateResponse(modelText, chunks, req.lang);
  const degraded = !validation.ok;
  const abstainReason = degraded ? validation.reason : undefined;

  return {
    response: validation.sanitized,
    sourcesUsed: chunks.map((c) => c.section_id),
    model: modelName,
    tokensUsed: promptTokens + completionTokens,
    latencyMs: Date.now() - startedAt,
    degradedMode: degraded,
    abstainReason,
  };
}

// ─── HTTP entry ─────────────────────────────────────────────────────────────

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const validation = validateBody(raw);
  if (!validation.ok) {
    return jsonResponse(400, { error: validation.error });
  }
  const reqBody = validation.value;

  const startedAt = Date.now();
  const accept = req.headers.get('Accept') ?? '';
  const wantsJson = accept.includes('application/json') && !accept.includes('text/event-stream');

  if (wantsJson) {
    const result = await runTurnNonStream(reqBody, startedAt);
    const doneShape: DoneEnvelope = {
      latency_ms: result.latencyMs,
      tokens_used: result.tokensUsed,
      model: result.model,
      degradedMode: result.degradedMode,
      abstainReason: result.abstainReason,
      sourcesUsed: result.sourcesUsed,
    };
    logTurn(reqBody, doneShape);
    return jsonResponse(200, result);
  }

  return buildStreamingResponse(reqBody, startedAt, getServiceClient());
}

Deno.serve(handleRequest);

// Test exports.
export { runTurnNonStream };
