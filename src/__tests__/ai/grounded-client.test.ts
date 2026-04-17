// src/__tests__/ai/grounded-client.test.ts
//
// Unit tests for the Next.js client helper that calls the grounded-answer
// Edge Function. The helper must NEVER throw — every failure mode maps to an
// `{ grounded: false, abstain_reason: 'upstream_error' }` shape with a
// distinct trace_id so callers can branch cleanly.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callGroundedAnswer, type GroundedRequest, type GroundedResponse } from '@/lib/ai/grounded-client';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASE_REQUEST: GroundedRequest = {
  caller: 'foxy',
  student_id: 'student-abc',
  query: 'What is photosynthesis?',
  scope: {
    board: 'CBSE',
    grade: '9',
    subject_code: 'science',
    chapter_number: 6,
    chapter_title: 'Life Processes',
  },
  mode: 'soft',
  generation: {
    model_preference: 'auto',
    max_tokens: 1024,
    temperature: 0.3,
    system_prompt_template: 'foxy_tutor_v1',
    template_variables: { grade: '9', subject: 'science' },
  },
  retrieval: { match_count: 5 },
  timeout_ms: 20000,
};

function mockOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function mockHttpResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

// ─── Env setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Happy path: grounded: true ──────────────────────────────────────────────

describe('callGroundedAnswer — HTTP 200 grounded:true', () => {
  it('returns the parsed grounded response as-is', async () => {
    const groundedPayload: GroundedResponse = {
      grounded: true,
      answer: 'Photosynthesis is the process by which plants make food.',
      citations: [],
      confidence: 0.82,
      trace_id: 'trace-123',
      meta: { claude_model: 'claude-haiku-4-5', tokens_used: 250, latency_ms: 1500 },
    };

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockOkResponse(groundedPayload));

    const result = await callGroundedAnswer(BASE_REQUEST);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe('https://test.supabase.co/functions/v1/grounded-answer');
    expect(calledInit?.method).toBe('POST');
    expect(calledInit?.headers).toMatchObject({
      Authorization: 'Bearer test-service-key',
      'Content-Type': 'application/json',
    });
    expect(result).toEqual(groundedPayload);
  });
});

// ─── Service-side abstain: grounded: false ───────────────────────────────────

describe('callGroundedAnswer — HTTP 200 grounded:false', () => {
  it('returns the abstain response as-is without modification', async () => {
    const abstainPayload: GroundedResponse = {
      grounded: false,
      abstain_reason: 'chapter_not_ready',
      suggested_alternatives: [
        { grade: '9', subject_code: 'science', chapter_number: 7, chapter_title: 'Diversity', rag_status: 'ready' },
      ],
      trace_id: 'trace-456',
      meta: { latency_ms: 80 },
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(mockOkResponse(abstainPayload));

    const result = await callGroundedAnswer(BASE_REQUEST);
    expect(result).toEqual(abstainPayload);
    expect(result.grounded).toBe(false);
  });
});

// ─── Hop timeout via AbortController ─────────────────────────────────────────

describe('callGroundedAnswer — hop timeout', () => {
  it('returns upstream_error with trace_id="hop-timeout" on AbortError', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });

    const result = await callGroundedAnswer(BASE_REQUEST, { hopTimeoutMs: 10 });

    expect(result.grounded).toBe(false);
    if (!result.grounded) {
      expect(result.abstain_reason).toBe('upstream_error');
      expect(result.trace_id).toBe('hop-timeout');
      expect(result.suggested_alternatives).toEqual([]);
      expect(result.meta.latency_ms).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── Network error ───────────────────────────────────────────────────────────

describe('callGroundedAnswer — network error', () => {
  it('returns upstream_error with trace_id="network-error" when fetch throws', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    const result = await callGroundedAnswer(BASE_REQUEST);

    expect(result.grounded).toBe(false);
    if (!result.grounded) {
      expect(result.abstain_reason).toBe('upstream_error');
      expect(result.trace_id).toBe('network-error');
      expect(result.suggested_alternatives).toEqual([]);
    }
  });
});

// ─── HTTP 500 from service ───────────────────────────────────────────────────

describe('callGroundedAnswer — HTTP 500', () => {
  it('returns upstream_error with trace_id="service-500"', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(mockHttpResponse(500, { error: 'internal' }));

    const result = await callGroundedAnswer(BASE_REQUEST);

    expect(result.grounded).toBe(false);
    if (!result.grounded) {
      expect(result.abstain_reason).toBe('upstream_error');
      expect(result.trace_id).toBe('service-500');
    }
  });

  it('returns upstream_error with trace_id="service-503" for 503', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(mockHttpResponse(503));
    const result = await callGroundedAnswer(BASE_REQUEST);
    expect(result.grounded).toBe(false);
    if (!result.grounded) {
      expect(result.trace_id).toBe('service-500'); // any 5xx collapses to service-500
    }
  });
});

// ─── Config missing ──────────────────────────────────────────────────────────

describe('callGroundedAnswer — missing env vars', () => {
  it('returns upstream_error with trace_id="config-missing" if SUPABASE_URL unset', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const fetchSpy = vi.spyOn(global, 'fetch');

    const result = await callGroundedAnswer(BASE_REQUEST);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.grounded).toBe(false);
    if (!result.grounded) {
      expect(result.abstain_reason).toBe('upstream_error');
      expect(result.trace_id).toBe('config-missing');
    }
  });
});