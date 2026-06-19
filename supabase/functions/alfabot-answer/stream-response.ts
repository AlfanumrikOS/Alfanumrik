// supabase/functions/alfabot-answer/stream-response.ts
//
// SSE streaming branch of the AlfaBot Edge Function. Extracted from index.ts
// to keep each file under the 250-line house limit.
//
// Emits:
//   event: citation  data: { section_ids: string[] }         (once, before tokens)
//   event: token     data: { delta: string }                  (N times)
//   event: done      data: DoneEnvelope                       (once, terminator)
//
// On upstream failure the partial text is left in place and a degraded-mode
// "I don't have that info" string is appended as a final token. The UI is
// expected to swap to the last token when `done` arrives (or surface both —
// product decision).

import {
  ALFABOT_CORE_CONTEXT,
  ALFABOT_OPENAI_CONFIG,
  buildAlfaBotPrompt,
} from './prompt.ts';
import { retrieveAlfabotChunks } from './retrieval.ts';
import {
  AlfabotUpstreamError,
  streamOpenAIChat,
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
  type AlfabotRequest,
  type DoneEnvelope,
} from './shared.ts';
import { finalizeAiRoute, type AiAdmissionContext } from '../_shared/security/ai-admission.ts';

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
};

export function buildStreamingResponse(
  req: AlfabotRequest,
  startedAt: number,
  sb: SupabaseClient | null,
  admission: AiAdmissionContext,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, payload: unknown) => {
        const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
        controller.enqueue(encoder.encode(frame));
      };

      let totalTokens = 0;
      let streamStatusCode = 200;

      try {
        // Hard refusal — emit canned reply as a single token + done.
        const hard = detectHardRefusal(req.message, req.lang);
        if (hard) {
          send('token', { delta: hard.reply });
          const done: DoneEnvelope = {
            latency_ms: Date.now() - startedAt,
            tokens_used: 0,
            model: 'hard_refusal',
            degradedMode: false,
            abstainReason: hard.reason,
            sourcesUsed: [],
          };
          send('done', done);
          logTurn(req, done);
          controller.close();
          return;
        }

        const cKey = alfabotCircuitKey('openai');
        if (!canProceed(cKey)) {
          send('token', { delta: buildDegradedReply(req.lang) });
          const done: DoneEnvelope = {
            latency_ms: Date.now() - startedAt,
            tokens_used: 0,
            model: 'circuit_open',
            degradedMode: true,
            abstainReason: 'circuit_open',
            sourcesUsed: [],
          };
          send('done', done);
          logTurn(req, done);
          controller.close();
          return;
        }

        const chunks = sb
          ? await retrieveAlfabotChunks(sb, req.message, req.audience, req.lang)
          : [];
        const sourceIds = chunks.map((c) => c.section_id);

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

        if (sourceIds.length > 0) send('citation', { section_ids: sourceIds });

        let accumulated = '';
        let modelName: string = ALFABOT_OPENAI_CONFIG.model;
        let promptTokens = 0;
        let completionTokens = 0;
        let degraded = false;
        let abstainReason: string | undefined;

        try {
          for await (const evt of streamOpenAIChat(systemPrompt, messages, {
            model: ALFABOT_OPENAI_CONFIG.model,
            temperature: ALFABOT_OPENAI_CONFIG.temperature,
            max_tokens: ALFABOT_OPENAI_CONFIG.max_tokens,
            presence_penalty: ALFABOT_OPENAI_CONFIG.presence_penalty,
            frequency_penalty: ALFABOT_OPENAI_CONFIG.frequency_penalty,
          })) {
            if (evt.type === 'token') {
              accumulated += evt.delta;
              send('token', { delta: evt.delta });
            } else {
              modelName = evt.model;
              promptTokens = evt.promptTokens;
              completionTokens = evt.completionTokens;
            }
          }
          recordSuccess(cKey);
        } catch (err) {
          const kind = err instanceof AlfabotUpstreamError ? err.kind : 'unknown';
          if (kind !== 'auth_error') recordFailure(cKey);
          degraded = true;
          abstainReason = `upstream_${kind}`;
          send('token', { delta: `\n\n${buildDegradedReply(req.lang)}` });
          modelName = `error_${kind}`;
          promptTokens = 0;
          completionTokens = 0;
          streamStatusCode = 500;
        }

        if (!degraded) {
          const validation = validateResponse(accumulated, chunks, req.lang);
          if (!validation.ok) {
            degraded = true;
            abstainReason = validation.reason;
            send('token', { delta: `\n\n${validation.sanitized}` });
          }
        }

        totalTokens = promptTokens + completionTokens;
        const done: DoneEnvelope = {
          latency_ms: Date.now() - startedAt,
          tokens_used: totalTokens,
          model: modelName,
          degradedMode: degraded,
          abstainReason,
          sourcesUsed: sourceIds,
        };
        send('done', done);
        logTurn(req, done);
        controller.close();
      } finally {
        if (sb && admission) {
          try {
            await finalizeAiRoute({
              sb,
              admission,
              statusCode: streamStatusCode,
              actualInputTokens: totalTokens > 0 ? Math.ceil(totalTokens * 0.7) : null,
              actualOutputTokens: totalTokens > 0 ? Math.ceil(totalTokens * 0.3) : null,
              actualCost: null,
            });
          } catch (err) {
            console.error(`[alfabot-answer] stream finalize failed: ${String(err instanceof Error ? err.message : err)}`);
          }
        }
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
      ...CORS_HEADERS,
    },
  });
}
