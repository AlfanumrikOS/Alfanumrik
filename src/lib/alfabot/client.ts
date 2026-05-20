/**
 * AlfaBot — Browser-side client helper.
 *
 * Used by:
 *   - src/components/alfabot/*  (PR 3 widget, frontend agent)
 *   - any future surface that wants to talk to the AlfaBot routes
 *
 * Two public entry points:
 *   - askAlfabot()    — POSTs to /api/alfabot, parses SSE stream if the
 *                       server upgraded the response, otherwise consumes
 *                       JSON. Calls callbacks as the stream progresses.
 *   - submitLead()    — POSTs to /api/alfabot/lead, returns the parsed
 *                       success/error envelope.
 *
 * SSE parsing: hand-rolled (no EventSource — we want to set Accept and
 * forward an abort signal). Split on `\n\n`, extract `event:` and `data:`
 * lines, JSON.parse the data payload. We tolerate keep-alive frames
 * (lines that begin with `:`) and missing `event:` lines (treated as
 * `event: message` per the SSE spec).
 *
 * Owner: backend (this file ships in PR 2 because the widget needs it in
 * PR 3; the frontend agent does not duplicate fetch logic).
 */

import type {
  AlfabotRequest,
  AlfabotResponse,
  AlfabotErrorResponse,
  AlfabotLeadRequest,
  AlfabotLeadResponse,
} from './types';
import { ALFABOT_SSE_EVENTS } from './sse-events';

// ─── askAlfabot — chat call ──────────────────────────────────────────────────

export interface AskAlfabotCallbacks {
  /** Called per text delta. SSE: `event: token data: { delta: "..." }`. */
  onToken?: (token: string) => void;
  /** Called once at the end. Carries the full assistant text + meta. */
  onDone?: (final: AlfabotResponse) => void;
  /** Called on any error (network, abort, 4xx/5xx, malformed stream). */
  onError?: (err: AlfabotErrorResponse | { error: 'network_error'; detail?: string }) => void;
  /** AbortController.signal — caller can cancel an in-flight request. */
  signal?: AbortSignal;
}

/**
 * POST to /api/alfabot. The server decides between SSE and JSON based on
 * the request's Accept header; we always set `text/event-stream` so the
 * server can stream, but we also handle a JSON-only response gracefully
 * (Edge Function down / streaming kill switch flipped off).
 *
 * Returns a Promise that resolves AFTER onDone (or onError) has fired.
 * Callers can `await askAlfabot(...)` to know when the turn finished.
 */
export async function askAlfabot(
  req: AlfabotRequest,
  callbacks: AskAlfabotCallbacks = {},
): Promise<void> {
  const { onToken, onDone, onError, signal } = callbacks;

  let res: Response;
  try {
    res = await fetch('/api/alfabot', {
      method: 'POST',
      credentials: 'include', // anon_id cookie
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(req),
      signal,
    });
  } catch (err) {
    onError?.({
      error: 'network_error',
      detail: err instanceof Error ? err.message : 'fetch_failed',
    });
    return;
  }

  // ── Error envelope path (4xx / 5xx with JSON body) ──
  if (!res.ok) {
    let parsed: AlfabotErrorResponse | null = null;
    try {
      parsed = (await res.json()) as AlfabotErrorResponse;
    } catch {
      /* body unreadable */
    }
    onError?.(parsed ?? { error: 'upstream_failed', detail: `http_${res.status}` });
    return;
  }

  const contentType = res.headers.get('content-type') || '';

  // ── JSON path (non-streaming fallback) ──
  if (!contentType.includes('text/event-stream')) {
    try {
      const body = (await res.json()) as AlfabotResponse;
      onToken?.(body.response);
      onDone?.(body);
    } catch (err) {
      onError?.({
        error: 'network_error',
        detail: err instanceof Error ? err.message : 'json_parse_failed',
      });
    }
    return;
  }

  // ── SSE path ──
  if (!res.body) {
    onError?.({ error: 'upstream_failed', detail: 'no_response_body' });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulatedText = '';
  let lastMeta: AlfabotResponse | null = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const parsed = parseSseEvent(rawEvent);
        if (!parsed) continue;
        const { event, data } = parsed;
        if (event === ALFABOT_SSE_EVENTS.TOKEN) {
          const delta = (data as { delta?: string })?.delta;
          if (typeof delta === 'string') {
            accumulatedText += delta;
            onToken?.(delta);
          }
        } else if (event === ALFABOT_SSE_EVENTS.META) {
          // The route emits `meta` immediately before `done` so the widget
          // has rate-limit context even on streaming abstains. Keep the
          // most recent one as our authoritative final envelope.
          lastMeta = mergeMeta(lastMeta, data as Record<string, unknown>, accumulatedText);
        } else if (event === ALFABOT_SSE_EVENTS.DONE) {
          // Final frame: merge any trailing fields and resolve.
          lastMeta = mergeMeta(lastMeta, data as Record<string, unknown>, accumulatedText);
          if (lastMeta) onDone?.(lastMeta);
          return;
        } else if (event === ALFABOT_SSE_EVENTS.ERROR || event === 'abstain') {
          // The Edge Function (or our route) signalled an abstain/error
          // mid-stream. If it sent a `response` field we still forward it
          // as a final answer (canned refusal copy).
          const payload = data as Record<string, unknown>;
          if (typeof payload.response === 'string') {
            accumulatedText = payload.response;
            onToken?.(payload.response);
          }
          lastMeta = mergeMeta(lastMeta, payload, accumulatedText);
          if (lastMeta) onDone?.(lastMeta);
          return;
        }
      }
    }
    // Stream ended without a `done` frame — best-effort resolve with what we have.
    if (lastMeta) onDone?.(lastMeta);
    else onError?.({ error: 'upstream_failed', detail: 'stream_ended_without_done' });
  } catch (err) {
    onError?.({
      error: 'network_error',
      detail: err instanceof Error ? err.message : 'stream_read_failed',
    });
  }
}

/** SSE frame parser. Returns null on malformed frames (keep-alive, comments). */
function parseSseEvent(raw: string): { event: string; data: unknown } | null {
  if (!raw || raw.startsWith(':')) return null;
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return null;
  const dataStr = dataLines.join('\n');
  try {
    return { event: eventName, data: JSON.parse(dataStr) };
  } catch {
    // Some SSE producers send raw text — surface as a string payload.
    return { event: eventName, data: dataStr };
  }
}

/**
 * Build the running `AlfabotResponse` envelope by overlaying incoming SSE
 * payloads. We tolerate either:
 *   - `meta` containing the full envelope (route's preferred shape)
 *   - `done` containing extra fields like { response, abstainReason }
 */
function mergeMeta(
  prev: AlfabotResponse | null,
  next: Record<string, unknown> | null | undefined,
  accumulatedText: string,
): AlfabotResponse | null {
  if (!next) return prev;
  const merged: Record<string, unknown> = { ...(prev ?? {}), ...next };
  // `response` MUST be populated — prefer explicit field, fall back to
  // the accumulated text deltas.
  if (typeof merged.response !== 'string') {
    merged.response = accumulatedText;
  }
  // Minimum required envelope keys.
  if (
    typeof merged.sessionId === 'string' &&
    typeof merged.traceId === 'string' &&
    typeof merged.degradedMode === 'boolean' &&
    typeof merged.model === 'string' &&
    typeof merged.rateLimitRemaining === 'object' &&
    merged.rateLimitRemaining !== null
  ) {
    return merged as unknown as AlfabotResponse;
  }
  return prev;
}

// ─── submitLead — lead capture ───────────────────────────────────────────────

export async function submitLead(
  req: AlfabotLeadRequest,
): Promise<AlfabotLeadResponse | AlfabotErrorResponse> {
  let res: Response;
  try {
    res = await fetch('/api/alfabot/lead', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch (err) {
    return {
      error: 'upstream_failed',
      detail: err instanceof Error ? err.message : 'fetch_failed',
    };
  }
  try {
    const body = await res.json();
    if (res.ok && body?.ok === true && typeof body.leadId === 'string') {
      return body as AlfabotLeadResponse;
    }
    return body as AlfabotErrorResponse;
  } catch {
    return { error: 'upstream_failed', detail: `http_${res.status}` };
  }
}
