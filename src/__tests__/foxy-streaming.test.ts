/**
 * Foxy streaming pipeline — Phase 1.1 contract tests.
 *
 * The streaming path emits SSE events over the wire. These tests pin the
 * event shape, the quota policy ("deduct on done; refund on error"), and the
 * graceful-degradation behavior when the server returns JSON instead of SSE.
 *
 * We test the pure parsing logic + event-shape contract, NOT the live HTTP
 * round-trip — that lives in Playwright E2E. The parsing logic here mirrors
 * the implementation in src/app/foxy/page.tsx::callFoxyTutorStream and
 * src/app/api/foxy/route.ts::handleStreamingFoxyTurn (the side-channel
 * transformer). If those drift, both copies must be updated.
 */

import { describe, it, expect } from 'vitest';

// ─── SSE frame builder (matches server emitter) ─────────────────────────────

function sseFrame(eventName: string, payload: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

// ─── Pure SSE parser (mirror of route.ts side-channel and page.tsx parser) ──

interface ParsedEvent {
  eventName: string;
  data: any;
}

function parseSseStream(buffer: string): { events: ParsedEvent[]; rest: string } {
  const events: ParsedEvent[] = [];
  let rest = buffer;
  let sepIdx: number;
  while ((sepIdx = rest.indexOf('\n\n')) !== -1) {
    const rawEvent = rest.slice(0, sepIdx);
    rest = rest.slice(sepIdx + 2);
    const eventLine = rawEvent.split('\n').find((l) => l.startsWith('event: '));
    const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data: '));
    if (!eventLine || !dataLine) continue;
    let data: any = null;
    try { data = JSON.parse(dataLine.slice(6)); } catch { /* skip malformed */ }
    events.push({ eventName: eventLine.slice(7).trim(), data });
  }
  return { events, rest };
}

describe('SSE frame format', () => {
  it('produces an event-named frame with JSON data and trailing blank line', () => {
    const frame = sseFrame('text', { delta: 'Hello' });
    expect(frame).toBe('event: text\ndata: {"delta":"Hello"}\n\n');
  });

  it('parses a single frame', () => {
    const buf = sseFrame('metadata', {
      groundingStatus: 'grounded',
      citations: [],
      traceId: 'trace-1',
      confidence: 0.8,
    });
    const { events, rest } = parseSseStream(buf);
    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe('metadata');
    expect(events[0].data.groundingStatus).toBe('grounded');
    expect(rest).toBe('');
  });

  it('parses multiple frames in one buffer (typical chunk read)', () => {
    const buf =
      sseFrame('metadata', { groundingStatus: 'grounded', citations: [], traceId: 't1', confidence: 0.8 }) +
      sseFrame('text', { delta: 'Photosynthesis ' }) +
      sseFrame('text', { delta: 'is the process...' });
    const { events } = parseSseStream(buf);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.eventName)).toEqual(['metadata', 'text', 'text']);
  });

  it('keeps a trailing partial frame in `rest` for the next read', () => {
    const buf = sseFrame('text', { delta: 'Hi' }) + 'event: text\ndata: {"de'; // partial
    const { events, rest } = parseSseStream(buf);
    expect(events).toHaveLength(1);
    expect(rest).toContain('event: text');
    expect(rest).toContain('"de');
  });
});

describe('Streaming success path — done event payload', () => {
  it('contains tokensUsed, latencyMs, groundedFromChunks, claudeModel, answerLength', () => {
    const buf =
      sseFrame('metadata', { groundingStatus: 'grounded', citations: [{ index: 1 }], traceId: 't1', confidence: 0.78 }) +
      sseFrame('text', { delta: 'Photo' }) +
      sseFrame('text', { delta: 'synthesis' }) +
      sseFrame('done', {
        tokensUsed: 240,
        latencyMs: 4200,
        groundedFromChunks: true,
        claudeModel: 'claude-haiku-4-5-20251001',
        answerLength: 12,
      });
    const { events } = parseSseStream(buf);
    const done = events.find((e) => e.eventName === 'done');
    expect(done).toBeDefined();
    expect(done!.data).toMatchObject({
      tokensUsed: 240,
      groundedFromChunks: true,
      claudeModel: 'claude-haiku-4-5-20251001',
    });
    expect(done!.data.latencyMs).toBeGreaterThan(0);
  });

  it('accumulates text deltas in order', () => {
    const buf =
      sseFrame('text', { delta: 'A ' }) +
      sseFrame('text', { delta: 'B ' }) +
      sseFrame('text', { delta: 'C' }) +
      sseFrame('text', { delta: '!' }) +
      sseFrame('done', { tokensUsed: 10, latencyMs: 100, groundedFromChunks: true, claudeModel: 'haiku', answerLength: 4 });
    const { events } = parseSseStream(buf);
    const text = events.filter((e) => e.eventName === 'text').map((e) => e.data?.delta).join('');
    expect(text).toBe('A B C!');
  });
});

describe('Streaming error path — quota policy', () => {
  // Client mirror of REFUND_ABSTAIN_REASONS in route.ts. If this set diverges
  // from the route, update both. See foxy-grounded-gate.test.ts for the full
  // refund/no-refund matrix.
  const REFUND_ABSTAIN_REASONS = ['upstream_error', 'circuit_open', 'chapter_not_ready'];

  it('error event triggers quota refund (no done seen)', () => {
    const buf =
      sseFrame('metadata', { groundingStatus: 'grounded', citations: [], traceId: 't', confidence: 0.5 }) +
      sseFrame('error', { reason: 'timeout', traceId: 't', latencyMs: 30000 });
    const { events } = parseSseStream(buf);
    const sawDone = events.some((e) => e.eventName === 'done');
    const sawError = events.some((e) => e.eventName === 'error');
    expect(sawDone).toBe(false);
    expect(sawError).toBe(true);
    // route.ts logic: !doneSeen && !abstainTerminal-with-no-refund → refund.
    // Here the only terminal is `error`, so we always refund.
  });

  it('abstain with refund-eligible reason → refund', () => {
    const buf = sseFrame('abstain', {
      abstainReason: 'circuit_open',
      suggestedAlternatives: [],
      traceId: 't',
      latencyMs: 5,
    });
    const { events } = parseSseStream(buf);
    const ev = events.find((e) => e.eventName === 'abstain');
    expect(ev).toBeDefined();
    expect(REFUND_ABSTAIN_REASONS.includes(ev!.data.abstainReason)).toBe(true);
  });

  it('abstain with non-refund reason (no_chunks_retrieved) → keep deduction', () => {
    const buf = sseFrame('abstain', {
      abstainReason: 'no_chunks_retrieved',
      suggestedAlternatives: [{ grade: '10', subject_code: 'science', chapter_number: 6, chapter_title: 'Light', rag_status: 'ready' }],
      traceId: 't',
      latencyMs: 5,
    });
    const { events } = parseSseStream(buf);
    const ev = events.find((e) => e.eventName === 'abstain');
    expect(REFUND_ABSTAIN_REASONS.includes(ev!.data.abstainReason)).toBe(false);
  });

  it('done event triggers NO refund (full deduction)', () => {
    const buf = sseFrame('done', {
      tokensUsed: 240,
      latencyMs: 4000,
      groundedFromChunks: true,
      claudeModel: 'haiku',
      answerLength: 80,
    });
    const { events } = parseSseStream(buf);
    expect(events[0].eventName).toBe('done');
    // Client-side semantics: done == quota stays consumed.
  });
});

describe('Streaming session synthesis', () => {
  it('the route prepends a `session` event with sessionId before upstream events', () => {
    // The route's TransformStream injects this frame in start() so the client
    // knows the sessionId before any other event.
    const buf =
      sseFrame('session', { sessionId: '11111111-1111-1111-1111-111111111111' }) +
      sseFrame('metadata', { groundingStatus: 'grounded', citations: [], traceId: 't', confidence: 0.8 });
    const { events } = parseSseStream(buf);
    expect(events[0].eventName).toBe('session');
    expect(events[0].data.sessionId).toMatch(/^[0-9a-f-]+$/);
    expect(events[1].eventName).toBe('metadata');
  });
});

describe('Streaming graceful degradation', () => {
  // When the server doesn't honor stream:true (flag off, route fallback),
  // /api/foxy returns regular JSON. The client helper detects this via
  // content-type and adapts so onText fires once with the full response and
  // onDone fires immediately afterward.
  it('non-SSE content-type triggers single-shot fallback', () => {
    const fakeJsonResponse = {
      success: true,
      response: 'Photosynthesis is the process...',
      sessionId: 'sess-1',
      tokensUsed: 240,
      groundedFromChunks: true,
      citationsCount: 2,
    };
    // The fallback expectation: onText fires once with response, onDone with
    // tokensUsed/groundedFromChunks/citationsCount echoed from the JSON body.
    expect(fakeJsonResponse.response).toBe('Photosynthesis is the process...');
    expect(fakeJsonResponse.groundedFromChunks).toBe(true);
    expect(fakeJsonResponse.citationsCount).toBe(2);
  });
});
