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

const INSUFFICIENT_CONTEXT_SENTINEL = '{{INSUFFICIENT_CONTEXT}}';

const PER_CALL_TIMEOUT_CAP_MS = 45_000;
const PER_CALL_TIMEOUT_FRAC = 0.6;

export interface ClaudeRequest {
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  apiKey: string;
  modelPreference: 'haiku' | 'sonnet' | 'auto';
}

export type ClaudeResponse =
  | {
      ok: true;
      content: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      insufficientContext: boolean;
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
      inputTokens: number;
      outputTokens: number;
      insufficientContext: boolean;
    }
  | {
      type: 'final';
      ok: false;
      reason: 'timeout' | 'auth_error' | 'server_error' | 'unknown';
      // partial text accumulated up to the failure point — may be empty
      partialText: string;
      model: string | null;
    };

export async function callClaude(req: ClaudeRequest): Promise<ClaudeResponse> {
  if (!req.apiKey) {
    return { ok: false, reason: 'auth_error' };
  }

  const modelOrder = resolveModelOrder(req.modelPreference);
  const perCallTimeout = Math.min(req.timeoutMs * PER_CALL_TIMEOUT_FRAC, PER_CALL_TIMEOUT_CAP_MS);

  let lastReason: 'timeout' | 'server_error' | 'unknown' = 'unknown';

  for (const model of modelOrder) {
    const attempt = await callOnce({
      model,
      systemPrompt: req.systemPrompt,
      userMessage: req.userMessage,
      maxTokens: req.maxTokens,
      temperature: req.temperature,
      timeoutMs: perCallTimeout,
      apiKey: req.apiKey,
    });

    if (attempt.kind === 'ok') {
      const trimmed = attempt.content.trim();
      return {
        ok: true,
        content: attempt.content,
        model,
        inputTokens: attempt.inputTokens,
        outputTokens: attempt.outputTokens,
        insufficientContext: trimmed === INSUFFICIENT_CONTEXT_SENTINEL,
      };
    }

    if (attempt.kind === 'auth_error') {
      // Auth errors don't recover on the next model — same key, same result.
      return { ok: false, reason: 'auth_error' };
    }

    // timeout | server_error | unknown → try next model
    lastReason = attempt.kind;
  }

  return { ok: false, reason: lastReason };
}

function resolveModelOrder(pref: 'haiku' | 'sonnet' | 'auto'): string[] {
  if (pref === 'haiku') return [HAIKU_MODEL];
  if (pref === 'sonnet') return [SONNET_MODEL];
  return [HAIKU_MODEL, SONNET_MODEL];
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
    // History injection still flows via the system prompt string for now
    // (callers JSON-stringify history_messages). When we move to native
    // multi-turn message arrays, the same cache_control wrapping should
    // be applied to the first ~10 turn pairs as well — see route.ts
    // MAX_HISTORY_TURNS comment.
    const systemBlocks = [
      {
        type: 'text',
        text: params.systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ];

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
        messages: [{ role: 'user', content: params.userMessage }],
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
  if (!req.apiKey) {
    yield { type: 'final', ok: false, reason: 'auth_error', partialText: '', model: null };
    return;
  }

  const modelOrder = resolveModelOrder(req.modelPreference);
  const perCallTimeout = Math.min(req.timeoutMs * PER_CALL_TIMEOUT_FRAC, PER_CALL_TIMEOUT_CAP_MS);

  let lastReason: 'timeout' | 'server_error' | 'unknown' = 'unknown';

  for (let i = 0; i < modelOrder.length; i++) {
    const model = modelOrder[i];
    const isLastModel = i === modelOrder.length - 1;
    const result = yield* streamOnce({
      model,
      systemPrompt: req.systemPrompt,
      userMessage: req.userMessage,
      maxTokens: req.maxTokens,
      temperature: req.temperature,
      timeoutMs: perCallTimeout,
      apiKey: req.apiKey,
      // If we've already started streaming text (any text_delta yielded) we
      // can't retry — we must commit to this model's outcome. streamOnce
      // tracks `firstTokenSent` to enforce this contract.
      allowFallback: !isLastModel,
    });

    if (result.ok) {
      yield {
        type: 'final',
        ok: true,
        fullText: result.fullText,
        model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        insufficientContext: result.fullText.trim() === INSUFFICIENT_CONTEXT_SENTINEL,
      };
      return;
    }

    if (result.reason === 'auth_error') {
      yield { type: 'final', ok: false, reason: 'auth_error', partialText: '', model };
      return;
    }

    if (result.firstTokenSent) {
      // Tokens already streamed — cannot fallback. Surface the failure with
      // whatever partial text the client already has.
      yield {
        type: 'final',
        ok: false,
        reason: result.reason,
        partialText: result.fullText,
        model,
      };
      return;
    }

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
        messages: [{ role: 'user', content: params.userMessage }],
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