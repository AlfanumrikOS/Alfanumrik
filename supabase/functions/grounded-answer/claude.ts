// supabase/functions/grounded-answer/claude.ts
// Claude API caller with Haiku-primary, Sonnet-fallback routing.
//
// Single responsibility: send a fully-formed prompt to Claude and return
// a discriminated-union result. Never throws. Spec §6.4 step 6.
//
// Design:
//   - modelPreference drives which model(s) to try and in what order.
//   - Per-call timeout capped at min(budget * 0.6, 45s).
//   - HTTP 401/403 fail fast (auth errors won't recover on Sonnet either).
//   - HTTP 404/529 or AbortError → try next model.
//   - {{INSUFFICIENT_CONTEXT}} is a first-class sentinel the prompt can emit;
//     we surface it as insufficientContext:true so the caller can abstain
//     on no_supporting_chunks without treating it as an error.
//   - Token usage is surfaced for cost tracking in trace rows.

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-20250514';
const GPT_MINI_MODEL = 'gpt-4o-mini';
const GPT_FULL_MODEL = 'gpt-4o';

const INSUFFICIENT_CONTEXT_SENTINEL = '{{INSUFFICIENT_CONTEXT}}';

const PER_CALL_TIMEOUT_CAP_MS = 45_000;
const PER_CALL_TIMEOUT_FRAC = 0.6;

/**
 * Phase 2 of Foxy continuity fix (2026-05-18): a single prior turn passed
 * natively to Claude. When the pipeline supplies a non-empty
 * `conversationTurns` array, callOnce/streamOnce prepend it to the
 * `messages[]` body. The current `userMessage` is appended as the last turn.
 */
export interface ClaudeConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeRequest {
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  apiKey: string;
  openaiApiKey?: string;
  modelPreference: 'haiku' | 'sonnet' | 'auto';
  /**
   * Phase 2 of Foxy continuity fix: prior conversation turns in native shape.
   * When provided and non-empty, the call body becomes
   * `messages: [...conversationTurns, {role:'user', content: userMessage}]`.
   * Absent or empty array → byte-identical legacy behavior (single user turn).
   */
  conversationTurns?: ClaudeConversationTurn[];
}

export type ClaudeResponse =
  | {
      ok: true;
      content: string;
      model: string;
      provider?: 'openai' | 'anthropic';
      inputTokens: number;
      outputTokens: number;
      insufficientContext: boolean;
      /**
       * C3 (MOL grounded-answer integration, 2026-05-18): how many non-final
       * models failed before this one succeeded. 0 = the first model in the
       * preference order returned content. 1+ = at least one fallback fired.
       *
       * Optional and additive — older code that destructures the ok-true
       * variant ignores it. Surfaced into mol_request_logs.fallback_count via
       * the mol-telemetry-adapter so cost dashboards can attribute spend
       * accurately when Sonnet handled what Haiku couldn't.
       */
      fallback_count?: number;
      /**
       * C3: human-readable trace of every non-final model failure, in order.
       * Each entry is `'<provider>:<reason>'` (e.g. `'anthropic:timeout'`,
       * `'anthropic:5xx'`, `'anthropic:unknown'`). Empty/undefined when no
       * fallback fired. Mirrors mol_request_logs.failure_chain (joined with
       * '|' at the LogPayload boundary).
       */
      failure_chain?: string[];
    }
  | {
      ok: false;
      reason: 'timeout' | 'auth_error' | 'server_error' | 'unknown';
    };

/**
 * Streaming variant of ClaudeResponse — yields chunks of decoded text and a
 * final aggregated payload. Used by callClaudeStream() for the Phase 1.1
 * streaming pipeline. Caller iterates the AsyncIterable and accumulates the
 * full text; the closing `final` event includes token usage + model.
 *
 * Errors are surfaced as a `final` event with ok:false (NEVER thrown). This
 * matches callClaude()'s never-throws contract so callers can use one error
 * handler.
 */
export type ClaudeStreamEvent =
  | { type: 'text_delta'; delta: string }
  | {
      type: 'final';
      ok: true;
      fullText: string;
      model: string;
      provider?: 'openai' | 'anthropic';
      inputTokens: number;
      outputTokens: number;
      insufficientContext: boolean;
      /**
       * C3 (MOL grounded-answer integration, 2026-05-18): fallback bookkeeping.
       * Same semantics as ClaudeResponse.fallback_count above; for streaming
       * a fallback can only occur BEFORE any text_delta has shipped (the
       * generator commits to one model once tokens start). Optional and
       * additive — older consumers of the ok-true variant ignore it.
       */
      fallback_count?: number;
      failure_chain?: string[];
    }
  | {
      type: 'final';
      ok: false;
      reason: 'timeout' | 'auth_error' | 'server_error' | 'unknown';
      // partial text accumulated up to the failure point — may be empty
      partialText: string;
      model: string | null;
    };

export interface ModelTarget {
  provider: 'openai' | 'anthropic';
  model: string;
}

export async function callClaude(req: ClaudeRequest): Promise<ClaudeResponse> {
  if (!req.apiKey && !req.openaiApiKey) {
    return { ok: false, reason: 'auth_error' };
  }
  const modelOrder = resolveModelOrder(req.modelPreference);
  const perCallTimeout = Math.min(req.timeoutMs * PER_CALL_TIMEOUT_FRAC, PER_CALL_TIMEOUT_CAP_MS);

  let lastReason: 'timeout' | 'server_error' | 'unknown' = 'unknown';
  // C3 fallback bookkeeping: every non-final-model failure pushes an entry
  // onto failureChain and bumps fallbackCount. The successful model returns
  // these counts so downstream telemetry can attribute cost/latency to the
  // model that actually answered, not just the first model tried.
  const failureChain: string[] = [];

  for (const target of modelOrder) {
    if (target.provider === 'openai' && !req.openaiApiKey) {
      continue;
    }
    if (target.provider === 'anthropic' && !req.apiKey) {
      continue;
    }

    const attempt = target.provider === 'openai'
      ? await callOpenAIOnce({
          model: target.model,
          systemPrompt: req.systemPrompt,
          userMessage: req.userMessage,
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          timeoutMs: perCallTimeout,
          apiKey: req.openaiApiKey!,
          conversationTurns: req.conversationTurns,
        })
      : await callOnce({
          model: target.model,
          systemPrompt: req.systemPrompt,
          userMessage: req.userMessage,
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          timeoutMs: perCallTimeout,
          apiKey: req.apiKey,
          conversationTurns: req.conversationTurns,
        });

    if (attempt.kind === 'ok') {
      const trimmed = attempt.content.trim();
      return {
        ok: true,
        content: attempt.content,
        model: target.model,
        provider: target.provider,
        inputTokens: attempt.inputTokens,
        outputTokens: attempt.outputTokens,
        insufficientContext: trimmed === INSUFFICIENT_CONTEXT_SENTINEL,
        fallback_count: failureChain.length,
        failure_chain: failureChain.length > 0 ? failureChain.slice() : undefined,
      };
    }

    if (attempt.kind === 'auth_error') {
      // Auth errors don't recover on the next model — same key, same result.
      return { ok: false, reason: 'auth_error' };
    }

    // timeout | server_error | unknown → record + try next model.
    failureChain.push(failureLabel(target.provider, attempt.kind));
    lastReason = attempt.kind;
  }

  return { ok: false, reason: lastReason };
}

/**
 * C3 (MOL grounded-answer integration, 2026-05-18): map an internal
 * SingleCallResult.kind to a stable 'provider:reason' string for telemetry.
 *
 * Kept narrow on purpose — adding new internal kinds requires explicit
 * mapping here so the telemetry contract never drifts silently.
 */
function failureLabel(provider: 'openai' | 'anthropic', kind: 'timeout' | 'server_error' | 'unknown'): string {
  const reason = kind === 'server_error' ? '5xx' : kind;
  return `${provider}:${reason}`;
}

// Deprecated fallback mapping for backwards compatibility
function claudeFailureLabel(kind: 'timeout' | 'server_error' | 'unknown'): string {
  return failureLabel('anthropic', kind);
}

function resolveModelOrder(pref: 'haiku' | 'sonnet' | 'auto'): ModelTarget[] {
  // RCA-FIX CRITICAL-1 (2026-06-26): Foxy system prompt, JSON output contract,
  // and CBSE pedagogy decision tree are calibrated for Claude behavior.
  // GPT-4o-mini/GPT-4o are fallbacks only — they receive the same prompt verbatim
  // which causes format/persona deviations. Anthropic models run first; OpenAI
  // only activates if the Claude call fails (timeout / 5xx / auth).
  if (pref === 'haiku') {
    return [
      { provider: 'anthropic', model: HAIKU_MODEL },
      { provider: 'openai', model: GPT_MINI_MODEL },
    ];
  }
  if (pref === 'sonnet') {
    return [
      { provider: 'anthropic', model: SONNET_MODEL },
      { provider: 'openai', model: GPT_FULL_MODEL },
    ];
  }
  return [
    { provider: 'anthropic', model: HAIKU_MODEL },
    { provider: 'anthropic', model: SONNET_MODEL },
    { provider: 'openai', model: GPT_MINI_MODEL },
    { provider: 'openai', model: GPT_FULL_MODEL },
  ];
}

type SingleCallResult =
  | { kind: 'ok'; content: string; inputTokens: number; outputTokens: number }
  | { kind: 'timeout' }
  | { kind: 'auth_error' }
  | { kind: 'server_error' }
  | { kind: 'unknown' };

async function callOnce(params: {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  apiKey: string;
  conversationTurns?: ClaudeConversationTurn[];
}): Promise<SingleCallResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    // Phase 2.4: Anthropic prompt caching.
    //
    // The system prompt for Foxy/grounded-answer is large (safety rails +
    // cognitive context + reference material can run 3-6k tokens) and
    // changes only when the chunks/cognitive snapshot shift. We wrap the
    // system prompt as a single content block with cache_control so
    // Anthropic caches the prefix for ~5 minutes. Subsequent turns in the
    // same conversation reuse the cache and only pay for the user message
    // delta. Caching is a no-op (just a structural change) when the
    // backend doesn't honor the header — hence safe across model
    // generations. See https://docs.anthropic.com/claude/docs/prompt-caching
    //
    // Phase 2 of Foxy continuity fix (2026-05-18): prior turns are now passed
    // natively via `params.conversationTurns` when provided. Anthropic's
    // multi-turn coherence is markedly stronger for native messages[] than for
    // string-interpolated history inside a single user-message blob.
    const systemBlocks = [
      {
        type: 'text',
        text: params.systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ];

    // Phase 2: prepend prior turns when supplied. Empty/undefined → byte-
    // identical legacy single-user-message body.
    const messages: ClaudeConversationTurn[] = [];
    if (params.conversationTurns && params.conversationTurns.length > 0) {
      for (const t of params.conversationTurns) {
        messages.push({ role: t.role, content: t.content });
      }
    }
    messages.push({ role: 'user', content: params.userMessage });

    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': params.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        system: systemBlocks,
        messages,
      }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      await response.text().catch(() => '');
      return { kind: 'auth_error' };
    }

    if (response.status === 404 || response.status === 529) {
      // 404: model decommissioned / typo. 529: anthropic overloaded.
      // Both are retriable on the next model in the fallback order.
      await response.text().catch(() => '');
      return { kind: 'server_error' };
    }

    if (!response.ok) {
      await response.text().catch(() => '');
      console.warn(`claude: unexpected HTTP ${response.status} for model ${params.model}`);
      return { kind: 'unknown' };
    }

    const body = await response.json().catch(() => null);
    if (!body) return { kind: 'unknown' };

    // Anthropic content is an array of blocks; concatenate all text blocks.
    // deno-lint-ignore no-explicit-any
    const blocks: any[] = Array.isArray(body.content) ? body.content : [];
    const text = blocks
      // deno-lint-ignore no-explicit-any
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      // deno-lint-ignore no-explicit-any
      .map((b: any) => b.text as string)
      .join('');

    const inputTokens = typeof body.usage?.input_tokens === 'number' ? body.usage.input_tokens : 0;
    const outputTokens = typeof body.usage?.output_tokens === 'number' ? body.usage.output_tokens : 0;

    return { kind: 'ok', content: text, inputTokens, outputTokens };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { kind: 'timeout' };
    }
    console.warn(`claude: network error on ${params.model} — ${String(err)}`);
    return { kind: 'unknown' };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Streaming variant ───────────────────────────────────────────────────────
//
// callClaudeStream(): yields ClaudeStreamEvent values. Mirrors callClaude's
// model-fallback + auth-error fast-fail policy, but only the FIRST model in
// the order is used for the stream (we cannot retry mid-stream once tokens
// have shipped to the browser). If the chosen model fails BEFORE any tokens
// arrive, we transparently retry with the next model in the order.
//
// Why not full fallback once tokens flow: re-trying a different model
// after partial text would force the browser to either splice two responses
// (confusing) or discard work (wasteful). The first-token wait is short
// (~300-700ms with Haiku); any later failure is surfaced as a final
// `ok:false` event so the caller can show an error toast.

export async function* callClaudeStream(
  req: ClaudeRequest,
): AsyncGenerator<ClaudeStreamEvent, void, unknown> {
  if (!req.apiKey && !req.openaiApiKey) {
    yield { type: 'final', ok: false, reason: 'auth_error', partialText: '', model: null };
    return;
  }
  const modelOrder = resolveModelOrder(req.modelPreference);
  const perCallTimeout = Math.min(req.timeoutMs * PER_CALL_TIMEOUT_FRAC, PER_CALL_TIMEOUT_CAP_MS);

  let lastReason: 'timeout' | 'server_error' | 'unknown' = 'unknown';
  // C3 fallback bookkeeping (streaming variant). A fallback can only occur
  // BEFORE any text_delta has shipped — once tokens flow we commit to the
  // current model (see firstTokenSent below). Mirrors callClaude semantics
  // so a single MOL telemetry adapter handles both paths.
  const failureChain: string[] = [];

  for (let i = 0; i < modelOrder.length; i++) {
    const target = modelOrder[i];
    if (target.provider === 'openai' && !req.openaiApiKey) {
      continue;
    }
    if (target.provider === 'anthropic' && !req.apiKey) {
      continue;
    }

    const isLastModel = i === modelOrder.length - 1;
    const result = target.provider === 'openai'
      ? yield* streamOpenAIOnce({
          model: target.model,
          systemPrompt: req.systemPrompt,
          userMessage: req.userMessage,
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          timeoutMs: perCallTimeout,
          apiKey: req.openaiApiKey!,
          conversationTurns: req.conversationTurns,
          allowFallback: !isLastModel,
        })
      : yield* streamOnce({
          model: target.model,
          systemPrompt: req.systemPrompt,
          userMessage: req.userMessage,
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          timeoutMs: perCallTimeout,
          apiKey: req.apiKey,
          conversationTurns: req.conversationTurns,
          allowFallback: !isLastModel,
        });

    if (result.ok) {
      yield {
        type: 'final',
        ok: true,
        fullText: result.fullText,
        model: target.model,
        provider: target.provider,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        insufficientContext: result.fullText.trim() === INSUFFICIENT_CONTEXT_SENTINEL,
        fallback_count: failureChain.length,
        failure_chain: failureChain.length > 0 ? failureChain.slice() : undefined,
      };
      return;
    }

    if (result.reason === 'auth_error') {
      yield { type: 'final', ok: false, reason: 'auth_error', partialText: '', model: target.model };
      return;
    }

    if (result.firstTokenSent) {
      // Tokens already streamed — cannot fallback. Surface the failure with
      // whatever partial text the client already has.
      yield {
        type: 'final',
        ok: false,
        reason: result.reason || 'unknown',
        partialText: result.fullText,
        model: target.model,
      };
      return;
    }

    // No tokens shipped yet — record the failure and try the next model.
    failureChain.push(
      failureLabel(target.provider, result.reason as 'timeout' | 'server_error' | 'unknown'),
    );
    lastReason = result.reason as 'timeout' | 'server_error' | 'unknown';
    // Try next model in the order.
  }

  yield { type: 'final', ok: false, reason: lastReason, partialText: '', model: null };
}

interface StreamOnceResult {
  ok: boolean;
  reason?: 'timeout' | 'auth_error' | 'server_error' | 'unknown';
  fullText: string;
  inputTokens: number;
  outputTokens: number;
  firstTokenSent: boolean;
}

/**
 * Stream a single Claude call. Yields text_delta events as they arrive and
 * returns a StreamOnceResult describing the outcome. The caller (above) decides
 * whether to retry or surface the final event based on `firstTokenSent`.
 */
async function* streamOnce(params: {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  apiKey: string;
  allowFallback: boolean;
  conversationTurns?: ClaudeConversationTurn[];
}): AsyncGenerator<ClaudeStreamEvent, StreamOnceResult, unknown> {
  void params.allowFallback; // reserved for future telemetry; behavior driven by caller's loop

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);

  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let firstTokenSent = false;

  try {
    const systemBlocks = [
      {
        type: 'text',
        text: params.systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ];

    // Phase 2 of Foxy continuity fix (2026-05-18): prepend native prior
    // turns when provided. Empty/undefined preserves legacy behavior.
    const messages: ClaudeConversationTurn[] = [];
    if (params.conversationTurns && params.conversationTurns.length > 0) {
      for (const t of params.conversationTurns) {
        messages.push({ role: t.role, content: t.content });
      }
    }
    messages.push({ role: 'user', content: params.userMessage });

    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': params.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        system: systemBlocks,
        messages,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, reason: 'auth_error', fullText, inputTokens, outputTokens, firstTokenSent };
    }
    if (response.status === 404 || response.status === 529) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, reason: 'server_error', fullText, inputTokens, outputTokens, firstTokenSent };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      console.warn(`claude(stream): unexpected HTTP ${response.status} for ${params.model}`);
      return { ok: false, reason: 'unknown', fullText, inputTokens, outputTokens, firstTokenSent };
    }

    if (!response.body) {
      return { ok: false, reason: 'unknown', fullText, inputTokens, outputTokens, firstTokenSent };
    }

    // Parse Anthropic SSE stream. Each event is `event: <name>\ndata: <json>\n\n`.
    // We only act on `content_block_delta` (text deltas) and `message_delta`
    // / `message_stop` (final usage). Other event types (ping, content_block_start,
    // message_start) are ignored.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by blank lines (\n\n). Process each complete
      // event in the buffer and keep the trailing partial chunk for next read.
      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const dataLines = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6));
        if (dataLines.length === 0) continue;
        const dataPayload = dataLines.join('\n');
        if (dataPayload === '[DONE]') continue;
        let parsed: any = null;
        try {
          parsed = JSON.parse(dataPayload);
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== 'object') continue;

        if (parsed.type === 'content_block_delta') {
          const delta = parsed.delta;
          if (delta && delta.type === 'text_delta' && typeof delta.text === 'string') {
            fullText += delta.text;
            firstTokenSent = true;
            yield { type: 'text_delta', delta: delta.text };
          }
        } else if (parsed.type === 'message_start') {
          if (parsed.message?.usage?.input_tokens) {
            inputTokens = parsed.message.usage.input_tokens;
          }
        } else if (parsed.type === 'message_delta') {
          if (parsed.usage?.output_tokens) {
            outputTokens = parsed.usage.output_tokens;
          }
        }
        // Ignore: ping, content_block_start, content_block_stop, message_stop
      }
    }

    return { ok: true, fullText, inputTokens, outputTokens, firstTokenSent };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, reason: 'timeout', fullText, inputTokens, outputTokens, firstTokenSent };
    }
    console.warn(`claude(stream): network error on ${params.model} — ${String(err)}`);
    return { ok: false, reason: 'unknown', fullText, inputTokens, outputTokens, firstTokenSent };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOpenAIOnce(params: {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  apiKey: string;
  conversationTurns?: ClaudeConversationTurn[];
}): Promise<SingleCallResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: params.systemPrompt }
    ];
    if (params.conversationTurns && params.conversationTurns.length > 0) {
      for (const t of params.conversationTurns) {
        messages.push({ role: t.role, content: t.content });
      }
    }
    messages.push({ role: 'user', content: params.userMessage });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        messages,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
      }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      await response.text().catch(() => '');
      return { kind: 'auth_error' };
    }

    if (response.status === 404 || response.status === 429 || response.status >= 500) {
      await response.text().catch(() => '');
      return { kind: 'server_error' };
    }

    if (!response.ok) {
      await response.text().catch(() => '');
      console.warn(`openai: unexpected HTTP ${response.status} for model ${params.model}`);
      return { kind: 'unknown' };
    }

    const body = await response.json().catch(() => null);
    if (!body) return { kind: 'unknown' };

    const text = (body.choices?.[0]?.message?.content ?? '').trim();
    const inputTokens = body.usage?.prompt_tokens ?? 0;
    const outputTokens = body.usage?.completion_tokens ?? 0;

    return { kind: 'ok', content: text, inputTokens, outputTokens };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { kind: 'timeout' };
    }
    console.warn(`openai: network error on ${params.model} — ${String(err)}`);
    return { kind: 'unknown' };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function* streamOpenAIOnce(params: {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  apiKey: string;
  allowFallback: boolean;
  conversationTurns?: ClaudeConversationTurn[];
}): AsyncGenerator<ClaudeStreamEvent, StreamOnceResult, unknown> {
  void params.allowFallback;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);

  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let firstTokenSent = false;

  try {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: params.systemPrompt }
    ];
    if (params.conversationTurns && params.conversationTurns.length > 0) {
      for (const t of params.conversationTurns) {
        messages.push({ role: t.role, content: t.content });
      }
    }
    messages.push({ role: 'user', content: params.userMessage });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        messages,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, reason: 'auth_error', fullText, inputTokens, outputTokens, firstTokenSent };
    }
    if (response.status === 404 || response.status === 429 || response.status >= 500) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, reason: 'server_error', fullText, inputTokens, outputTokens, firstTokenSent };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      console.warn(`openai(stream): unexpected HTTP ${response.status} for ${params.model}`);
      return { ok: false, reason: 'unknown', fullText, inputTokens, outputTokens, firstTokenSent };
    }

    if (!response.body) {
      return { ok: false, reason: 'unknown', fullText, inputTokens, outputTokens, firstTokenSent };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const dataLines = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6));
        if (dataLines.length === 0) continue;
        const dataPayload = dataLines.join('\n');
        if (dataPayload.trim() === '[DONE]') continue;
        let parsed: any = null;
        try {
          parsed = JSON.parse(dataPayload);
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== 'object') continue;

        const deltaText = parsed.choices?.[0]?.delta?.content;
        if (typeof deltaText === 'string') {
          fullText += deltaText;
          firstTokenSent = true;
          yield { type: 'text_delta', delta: deltaText };
        }

        if (parsed.usage) {
          inputTokens = parsed.usage.prompt_tokens ?? 0;
          outputTokens = parsed.usage.completion_tokens ?? 0;
        }
      }
    }

    return { ok: true, fullText, inputTokens, outputTokens, firstTokenSent };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, reason: 'timeout', fullText, inputTokens, outputTokens, firstTokenSent };
    }
    console.warn(`openai(stream): network error on ${params.model} — ${String(err)}`);
    return { ok: false, reason: 'unknown', fullText, inputTokens, outputTokens, firstTokenSent };
  } finally {
    clearTimeout(timeoutId);
  }
}