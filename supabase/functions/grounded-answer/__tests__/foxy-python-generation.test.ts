// supabase/functions/grounded-answer/__tests__/foxy-python-generation.test.ts
//
// Phase 2.2 (MOL-unification) — parity + fail-safe harness for the surgical
// Foxy model-generation seam (foxy-python-generation.ts).
//
// Proves, WITHOUT a live Python service (fetch is mocked):
//   1. SHAPE PARITY — when Python returns a MolResult whose `text` is a Foxy
//      structured JSON payload, the seam surfaces it as a ClaudeResponse and
//      that payload validates against the SAME validateFoxyResponse the TS
//      pipeline runs (structured-schema.ts). i.e. the Python-routed answer
//      flows through the identical validation gate as the Claude path.
//   2. FAIL-SAFE — on a simulated Python outage (network throw, non-2xx,
//      timeout, non-JSON, empty text) the seam returns null so the pipeline
//      falls back to callClaude. A Python failure can NEVER fail a turn.
//   3. DARK BY DEFAULT — empty PYTHON_AI_BASE_URL or flag OFF ⇒ the seam
//      short-circuits and NEVER touches the network.

import { assert, assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { generateFoxyViaPython } from '../foxy-python-generation.ts';
import { validateFoxyResponse } from '../structured-schema.ts';
import { _resetFlagCache } from '../../_shared/mol/feature-flag.ts';

const PYTHON_BASE = 'https://python-ai.example.test';
const SUPABASE_URL = 'https://stub-project.supabase.test';

const originalFetch = globalThis.fetch;

// A valid FoxyResponse — the exact contract the TS pipeline expects the model
// to emit. Kept minimal but schema-complete (science subject, one paragraph).
const VALID_FOXY_JSON = JSON.stringify({
  title: 'Refraction of Light',
  subject: 'science',
  blocks: [
    { type: 'paragraph', text: 'Light bends when it passes from one medium into another of different density.' },
    { type: 'definition', text: 'Refraction is the change in direction of light at the boundary between two media.' },
    { type: 'question', text: 'Why does a straw look bent in a glass of water?' },
  ],
});

function molResult(text: string) {
  return {
    text,
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    task_type: 'explanation',
    latency_ms: 420,
    tokens: { prompt: 800, completion: 220 },
    usd_cost: 0.0012,
    inr_cost: 0.1,
    fallback_count: 0,
    passes: 1,
    request_id: 'req-parity-1',
    failure_chain: [],
  };
}

/** Route the flag read + the /v1/generate call. `generate` decides the Python
 * response (or throws to simulate an outage). */
function installStub(opts: {
  flagEnabled: boolean;
  rolloutPct?: number;
  generate: (u: string, init?: RequestInit) => Response | Promise<Response>;
  onGenerateCall?: () => void;
}) {
  _resetFlagCache();
  // The flag envelope is read via feature-flag.ts → fetch to
  // ${SUPABASE_URL}/rest/v1/feature_flags. Provide a stub project + key.
  Deno.env.set('SUPABASE_URL', SUPABASE_URL);
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-stub');
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/rest/v1/feature_flags')) {
      const rows = [
        {
          flag_name: 'ff_python_foxy_tutor_v1',
          is_enabled: opts.flagEnabled,
          target_environments: null,
          rollout_percentage: 100,
          metadata: {
            enabled: opts.flagEnabled,
            kill_switch: false,
            rollout_pct: opts.rolloutPct ?? 100,
          },
        },
      ];
      return Promise.resolve(
        new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    }
    if (u.startsWith(PYTHON_BASE)) {
      opts.onGenerateCall?.();
      return Promise.resolve(opts.generate(u, init));
    }
    throw new Error(`unexpected fetch to ${u}`);
  }) as typeof fetch;
}

/** Reject with the same AbortError a real fetch throws when the seam's
 * AbortController fires — used to exercise the timeout path faithfully. */
function abortableNeverResolves(init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal?.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

// Snapshot env we mutate so we can fully restore it — this suite shares a
// process with the rest of the grounded-answer Deno tests (pipeline.test.ts
// etc.), so a leaked PYTHON_AI_BASE_URL / SUPABASE_URL would contaminate them.
const ENV_KEYS = ['PYTHON_AI_BASE_URL', 'PYTHON_AI_SERVICE_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const ENV_SNAPSHOT: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) ENV_SNAPSHOT[k] = Deno.env.get(k);

function restore() {
  globalThis.fetch = originalFetch;
  _resetFlagCache();
  for (const k of ENV_KEYS) {
    const v = ENV_SNAPSHOT[k];
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
}

function baseArgs() {
  return {
    requestId: 'bucket-seed-abc',
    systemPrompt: 'SYSTEM PROMPT (composed in TS, includes reference material + FoxyResponse schema)',
    userMessage: 'Explain refraction of light.',
    conversationTurns: [{ role: 'user' as const, content: 'hi' }, { role: 'assistant' as const, content: 'hello' }],
    ragContext: '=== REFERENCE MATERIAL ===\n[1] Light bends...\n=== END ===',
    studentId: '11111111-1111-1111-1111-111111111111',
    grade: '10',
    subjectCode: 'science',
    modelPreference: 'haiku' as const,
    maxTokens: 1600,
    temperature: 0.1,
    timeoutMs: 20000,
  };
}

// ── 1. SHAPE PARITY ──────────────────────────────────────────────────────────

Deno.test('parity: Python-routed structured text validates against the SAME FoxyResponseSchema', async () => {
  Deno.env.set('PYTHON_AI_BASE_URL', PYTHON_BASE);
  installStub({
    flagEnabled: true,
    generate: () =>
      new Response(JSON.stringify(molResult(VALID_FOXY_JSON)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  try {
    const res = await generateFoxyViaPython(baseArgs());
    assert(res !== null, 'seam should route and return a response when enabled');
    assert(res!.ok, 'response should be ok:true');
    if (res!.ok) {
      // The seam surfaces the model text verbatim — the pipeline then runs the
      // SAME validation the Claude path runs.
      assertEquals(res!.content, VALID_FOXY_JSON);
      const validation = validateFoxyResponse(JSON.parse(res!.content));
      assert(validation.ok, `Python-routed payload must validate: ${validation.ok ? '' : validation.reason}`);
      assertEquals(res!.inputTokens, 800);
      assertEquals(res!.outputTokens, 220);
      assertEquals(res!.insufficientContext, false);
    }
  } finally {
    restore();
  }
});

Deno.test('parity: strict-mode INSUFFICIENT_CONTEXT sentinel maps through the abstain gate', async () => {
  Deno.env.set('PYTHON_AI_BASE_URL', PYTHON_BASE);
  installStub({
    flagEnabled: true,
    generate: () =>
      new Response(JSON.stringify(molResult('{{INSUFFICIENT_CONTEXT}}')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  try {
    const res = await generateFoxyViaPython(baseArgs());
    assert(res !== null && res.ok);
    if (res.ok) assertEquals(res.insufficientContext, true);
  } finally {
    restore();
  }
});

// ── 1b. STOP-REASON MAPPING (enables Python-answer bounded continuation) ─────
//
// pipeline.ts fires its flag-gated bounded max_tokens-continuation iff the
// producing call reports stopReason === 'max_tokens'. The seam must therefore
// map the Python MolResult's RAW provider finish_reason onto that normalized
// union — otherwise a truncated Python answer could never continue (the old
// hardcoded 'end_turn' bug). We collapse to the single distinction that matters:
// Anthropic 'max_tokens' / OpenAI 'length' → 'max_tokens'; else → 'end_turn'.

function molResultWith(text: string, finish_reason: string | null) {
  const r = molResult(text) as Record<string, unknown>;
  if (finish_reason === null) delete r.finish_reason;
  else r.finish_reason = finish_reason;
  return r;
}

async function stopReasonFor(finish_reason: string | null): Promise<string | undefined> {
  Deno.env.set('PYTHON_AI_BASE_URL', PYTHON_BASE);
  installStub({
    flagEnabled: true,
    generate: () =>
      new Response(JSON.stringify(molResultWith(VALID_FOXY_JSON, finish_reason)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  try {
    const res = await generateFoxyViaPython(baseArgs());
    assert(res !== null && res.ok, 'seam should route when enabled');
    return res.ok ? res.stopReason : undefined;
  } finally {
    restore();
  }
}

Deno.test("stopReason: Anthropic 'max_tokens' → 'max_tokens' (truncation → continuation eligible)", async () => {
  assertEquals(await stopReasonFor('max_tokens'), 'max_tokens');
});

Deno.test("stopReason: OpenAI 'length' → 'max_tokens' (OpenAI's truncation signal)", async () => {
  assertEquals(await stopReasonFor('length'), 'max_tokens');
});

Deno.test("stopReason: Anthropic 'end_turn' → 'end_turn' (complete answer, no continuation)", async () => {
  assertEquals(await stopReasonFor('end_turn'), 'end_turn');
});

Deno.test("stopReason: OpenAI 'stop' → 'end_turn' (complete answer)", async () => {
  assertEquals(await stopReasonFor('stop'), 'end_turn');
});

Deno.test("stopReason: unknown reason (e.g. 'content_filter') → 'end_turn' (safe default)", async () => {
  assertEquals(await stopReasonFor('content_filter'), 'end_turn');
});

Deno.test('stopReason: absent finish_reason → end_turn (back-compat: old MolResult / cache hit)', async () => {
  assertEquals(await stopReasonFor(null), 'end_turn');
});

// ── 2. FAIL-SAFE (Python outage → null → callClaude fallback) ────────────────

Deno.test('fail-safe: network throw returns null (→ callClaude fallback)', async () => {
  Deno.env.set('PYTHON_AI_BASE_URL', PYTHON_BASE);
  installStub({
    flagEnabled: true,
    generate: () => {
      throw new Error('ECONNREFUSED cloud run down');
    },
  });
  try {
    const res = await generateFoxyViaPython(baseArgs());
    assertEquals(res, null);
  } finally {
    restore();
  }
});

Deno.test('fail-safe: non-2xx returns null (→ callClaude fallback)', async () => {
  Deno.env.set('PYTHON_AI_BASE_URL', PYTHON_BASE);
  installStub({
    flagEnabled: true,
    generate: () => new Response('{"code":"NO_PROVIDER_AVAILABLE"}', { status: 502 }),
  });
  try {
    assertEquals(await generateFoxyViaPython(baseArgs()), null);
  } finally {
    restore();
  }
});

Deno.test('fail-safe: 401 (auth not yet wired) returns null (→ callClaude fallback)', async () => {
  Deno.env.set('PYTHON_AI_BASE_URL', PYTHON_BASE);
  installStub({
    flagEnabled: true,
    generate: () => new Response('{"error":"AUTHENTICATION_REQUIRED"}', { status: 401 }),
  });
  try {
    assertEquals(await generateFoxyViaPython(baseArgs()), null);
  } finally {
    restore();
  }
});

Deno.test('fail-safe: non-JSON body returns null', async () => {
  Deno.env.set('PYTHON_AI_BASE_URL', PYTHON_BASE);
  installStub({
    flagEnabled: true,
    generate: () => new Response('<html>gateway</html>', { status: 200 }),
  });
  try {
    assertEquals(await generateFoxyViaPython(baseArgs()), null);
  } finally {
    restore();
  }
});

Deno.test('fail-safe: 2xx with empty text returns null', async () => {
  Deno.env.set('PYTHON_AI_BASE_URL', PYTHON_BASE);
  installStub({
    flagEnabled: true,
    generate: () =>
      new Response(JSON.stringify(molResult('')), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  try {
    assertEquals(await generateFoxyViaPython(baseArgs()), null);
  } finally {
    restore();
  }
});

Deno.test('fail-safe: timeout returns null', async () => {
  Deno.env.set('PYTHON_AI_BASE_URL', PYTHON_BASE);
  installStub({
    flagEnabled: true,
    // Honors the AbortController signal the seam passes, exactly like real fetch.
    generate: (_u, init) => abortableNeverResolves(init),
  });
  try {
    // Tight timeout so the abort fires quickly.
    const res = await generateFoxyViaPython({ ...baseArgs(), timeoutMs: 20 });
    assertEquals(res, null);
  } finally {
    restore();
  }
});

// ── 3. DARK BY DEFAULT (no network when disabled) ────────────────────────────

Deno.test('dark: empty PYTHON_AI_BASE_URL returns null WITHOUT any fetch', async () => {
  Deno.env.set('PYTHON_AI_BASE_URL', '');
  let generateCalls = 0;
  installStub({
    flagEnabled: true,
    onGenerateCall: () => (generateCalls += 1),
    generate: () => new Response(JSON.stringify(molResult(VALID_FOXY_JSON)), { status: 200 }),
  });
  try {
    assertEquals(await generateFoxyViaPython(baseArgs()), null);
    assertEquals(generateCalls, 0);
  } finally {
    restore();
  }
});

Deno.test('dark: flag OFF returns null WITHOUT calling /v1/generate', async () => {
  Deno.env.set('PYTHON_AI_BASE_URL', PYTHON_BASE);
  let generateCalls = 0;
  installStub({
    flagEnabled: false,
    onGenerateCall: () => (generateCalls += 1),
    generate: () => new Response(JSON.stringify(molResult(VALID_FOXY_JSON)), { status: 200 }),
  });
  try {
    assertEquals(await generateFoxyViaPython(baseArgs()), null);
    assertEquals(generateCalls, 0);
  } finally {
    restore();
  }
});

Deno.test('dark: rollout_pct 0 returns null WITHOUT calling /v1/generate', async () => {
  Deno.env.set('PYTHON_AI_BASE_URL', PYTHON_BASE);
  let generateCalls = 0;
  installStub({
    flagEnabled: true,
    rolloutPct: 0,
    onGenerateCall: () => (generateCalls += 1),
    generate: () => new Response(JSON.stringify(molResult(VALID_FOXY_JSON)), { status: 200 }),
  });
  try {
    assertEquals(await generateFoxyViaPython(baseArgs()), null);
    assertEquals(generateCalls, 0);
  } finally {
    restore();
  }
});
