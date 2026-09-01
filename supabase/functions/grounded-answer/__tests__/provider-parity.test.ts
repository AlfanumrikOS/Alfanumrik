// supabase/functions/grounded-answer/__tests__/provider-parity.test.ts
// Deno test runner. Run via:
//   deno test --allow-env --allow-read \
//     supabase/functions/grounded-answer/__tests__/provider-parity.test.ts
//
// ─── What this file pins (Foxy MOL audit, requirement 4) ─────────────────────
//
// MODEL_FALLBACK_ORDER is CROSS-PROVIDER: a single Foxy turn can be answered by
// Anthropic (rungs 1-2) or, after a failure, by OpenAI (rungs 3-4). Both rungs
// must therefore be governed by the SAME instructions. Until this file existed
// nothing asserted that. `callClaude` builds the two request bodies in two
// separate functions (`callOnce` / `callOpenAIOnce`, claude.ts) with no shared
// builder, so a rail, a grounding instruction or a JSON-contract clause added to
// one branch and not the other would ship silently — and would only be visible
// on the minority of turns that actually fall through to OpenAI, which is
// exactly the traffic slice nobody watches.
//
// The test forces a real Anthropic -> OpenAI fallback and captures BOTH outbound
// request bodies, then compares them field by field.
//
// ─── Known, intended asymmetries (asserted explicitly, not ignored) ──────────
//
//   (a) `systemSegments` (Anthropic prompt-cache breakpoints) is Anthropic-only.
//       The Anthropic body sends `system` as an ARRAY of text blocks with
//       `cache_control` markers; OpenAI gets one `{role:'system'}` string.
//       This is CONTENT-NEUTRAL and is asserted as such: the concatenation of
//       the Anthropic blocks must be byte-identical to the OpenAI system string.
//       If it ever is not, the prompt-cache segmentation has started altering
//       prompt text — which is the failure mode buildSystemBlocks' own
//       byte-identity guard exists to prevent.
//
//   (b) OpenAI is sent NO `response_format: {type:'json_object'}`. The JSON
//       output contract is PROMPT-ONLY on both providers. That is a real
//       robustness asymmetry (Anthropic has no equivalent knob either, so both
//       rely on the prompt), and it is pinned here so that if someone later adds
//       response_format to the OpenAI branch they are forced to think about
//       whether the two providers are still under the same contract.
//
// Owner: testing. Enforces: P12 (AI safety instructions reach EVERY rung).
// Reviewer: ai-engineer.

import { assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { callClaude } from '../claude.ts';
import type { ClaudeConversationTurn } from '../claude.ts';
import { loadTemplate, resolveTemplate, buildSystemPromptSegments } from '../prompts/index.ts';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-5-20250929';

const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

interface CapturedCall {
  url: string;
  // deno-lint-ignore no-explicit-any
  body: any;
}

function installCapturingFetch(
  responses: Array<() => Promise<Response>>,
  captured: CapturedCall[],
) {
  let idx = 0;
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    captured.push({
      url: String(url),
      body: init?.body ? JSON.parse(init.body as string) : {},
    });
    const handler = responses[idx];
    idx += 1;
    if (!handler) return Promise.reject(new Error('no more stubbed responses'));
    return handler();
  }) as typeof fetch;
}

function openAIOk(text: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 40, completion_tokens: 200 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * ONE fixed request, rendered through the REAL prompt loader.
 *
 * The system prompt is a genuine `foxy_tutor_doubt_v1` render, not a stub
 * string — so this test covers the case that actually matters: the
 * service-composed instruction text must cross the provider boundary intact.
 *
 * SLOT CHOICE (2026-08-31): the sentinels ride `{{mode_directive}}` and
 * `{{reference_material_section}}`, two slots the LIVE template declares.
 * They deliberately do NOT ride `{{foxy_safety_rails}}`: no registered
 * template declares that slot (the PROMPT_REV=4 wiring that added it was
 * reverted before ship — it drove the model to emit a preamble ahead of the
 * JSON envelope, which `stripCodeFence` could not strip, leaking raw JSON to
 * students). A sentinel sent for an undeclared slot is silently discarded by
 * `resolveTemplate`, so pinning parity on it would make this whole suite
 * vacuous — comparing two copies of the same hole, which is precisely what
 * the guard test below exists to prevent.
 */
const MODE_DIRECTIVE_MARKER = 'MODE-DIRECTIVE-SENTINEL-DO-NOT-REMOVE';
const REFERENCE_MARKER =
  '[1] Light travels in straight lines. REFERENCE-SENTINEL-DO-NOT-REMOVE';
/** Sent but NOT declared by any live template — must NOT survive the render. */
const UNDECLARED_SLOT_MARKER = 'UNDECLARED-SLOT-SENTINEL';

async function buildFixedRequest() {
  const template = await loadTemplate('foxy_tutor_doubt_v1');
  const vars: Record<string, string> = {
    grade: '8',
    subject: 'Science',
    chapter_suffix: ' — Light',
    board: 'CBSE',
    foxy_safety_rails: UNDECLARED_SLOT_MARKER,
    mode_instruction:
      'You MUST answer ONLY from the Reference Material provided above. ' +
      'Do NOT use your general training knowledge even if you know the answer.',
    mode_directive: MODE_DIRECTIVE_MARKER,
    academic_goal_section: '',
    cognitive_context_section: '',
    misconception_section: '',
    learner_memory_section: '',
    pending_expectation: '',
    previous_session_context: '',
    reference_material_section: REFERENCE_MARKER,
  };
  const systemPrompt = resolveTemplate(template, vars);
  const systemSegments = buildSystemPromptSegments(template, vars).map((s) => ({
    text: s.text,
    cacheControl: s.cacheControl,
  }));
  return { systemPrompt, systemSegments };
}

const CONVERSATION_TURNS: ClaudeConversationTurn[] = [
  { role: 'user', content: 'Why does a pencil look bent in water?' },
  { role: 'assistant', content: 'Good question! What happens to light when it changes medium?' },
];
const USER_MESSAGE = 'It bends? But why does it bend?';
const MAX_TOKENS = 1536;
const TEMPERATURE = 0.3;

/** Anthropic `system` is a block array; flatten to the string the model sees. */
// deno-lint-ignore no-explicit-any
function flattenAnthropicSystem(system: any): string {
  if (typeof system === 'string') return system;
  if (!Array.isArray(system)) throw new Error('unexpected anthropic system shape');
  // deno-lint-ignore no-explicit-any
  return system.map((b: any) => b.text as string).join('');
}

/**
 * Run ONE request whose Anthropic rungs both fail with 500 so the chain reaches
 * the first OpenAI rung, and return the captured Anthropic + OpenAI bodies.
 */
async function captureBothProviders(): Promise<{
  // deno-lint-ignore no-explicit-any
  anthropic: any;
  // deno-lint-ignore no-explicit-any
  openai: any;
  calls: CapturedCall[];
}> {
  const { systemPrompt, systemSegments } = await buildFixedRequest();
  const captured: CapturedCall[] = [];
  installCapturingFetch(
    [
      () => Promise.resolve(new Response('upstream boom', { status: 500 })), // haiku
      () => Promise.resolve(new Response('upstream boom', { status: 500 })), // sonnet
      () => Promise.resolve(openAIOk('answer from gpt-4o-mini')), // first OpenAI rung
    ],
    captured,
  );

  try {
    const result = await callClaude({
      systemPrompt,
      systemSegments,
      userMessage: USER_MESSAGE,
      conversationTurns: CONVERSATION_TURNS,
      maxTokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      timeoutMs: 45_000,
      apiKey: 'sk-anthropic',
      openaiApiKey: 'sk-openai',
      modelPreference: 'auto',
    });
    // Sanity: the fallback we are measuring actually happened.
    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.provider, 'openai');
      assertEquals(result.model, 'gpt-4o-mini');
    }
    assertEquals(captured.length, 3);
    assertEquals(captured[0].body.model, HAIKU_MODEL);
    assertEquals(captured[1].body.model, SONNET_MODEL);
    assertEquals(captured[2].url.includes('api.openai.com'), true);
    return { anthropic: captured[0].body, openai: captured[2].body, calls: captured };
  } finally {
    restoreFetch();
  }
}

// ─── Guard against a vacuous suite ───────────────────────────────────────────
// If the rendered prompt did not actually contain the service-composed text,
// every "both providers got the same thing" assertion below would be comparing
// two copies of the same hole.
Deno.test('fixture guard: the rendered system prompt really carries the service-composed sections', async () => {
  const { systemPrompt, systemSegments } = await buildFixedRequest();
  assertEquals(systemPrompt.includes(MODE_DIRECTIVE_MARKER), true);
  assertEquals(systemPrompt.includes(REFERENCE_MARKER), true);
  // resolveTemplate substitutes ONLY tokens the template declares and silently
  // discards the rest — `foxy_safety_rails` is declared by no live template, so
  // its value never reaches the model. Pinned so that re-wiring the slot (which
  // was reverted for leaking raw JSON to students) cannot happen silently.
  assertEquals(systemPrompt.includes(UNDECLARED_SLOT_MARKER), false);
  // No unresolved slot survived the render.
  assertEquals(/\{\{[a-z_]+\}\}/.test(systemPrompt), false);
  // Segments must reconstruct the prompt exactly (buildSystemBlocks' own
  // precondition — otherwise Anthropic silently drops to a single block and
  // this test's asymmetry (a) assertion would pass for the wrong reason).
  assertEquals(systemSegments.map((s) => s.text).join(''), systemPrompt);
  assertEquals(systemSegments.length > 1, true);
});

Deno.test('parity: the OpenAI rung receives a BYTE-IDENTICAL system prompt to the Anthropic rung', async () => {
  const { anthropic, openai } = await captureBothProviders();

  const anthropicSystem = flattenAnthropicSystem(anthropic.system);
  const openaiSystem = openai.messages[0].content as string;

  assertEquals(openai.messages[0].role, 'system');
  assertEquals(anthropicSystem, openaiSystem);
});

Deno.test('parity: the mode directive and the reference material reach BOTH providers (P12)', async () => {
  const { anthropic, openai } = await captureBothProviders();

  const anthropicSystem = flattenAnthropicSystem(anthropic.system);
  const openaiSystem = openai.messages[0].content as string;

  for (const [label, text] of [['anthropic', anthropicSystem], ['openai', openaiSystem]] as const) {
    assertEquals(text.includes(MODE_DIRECTIVE_MARKER), true, `${label} lost the mode directive`);
    assertEquals(text.includes(REFERENCE_MARKER), true, `${label} lost the reference material`);
  }
});

Deno.test('parity: user message + conversation turns survive the fallback identically (session context)', async () => {
  const { anthropic, openai } = await captureBothProviders();

  // Anthropic: messages[] = [...turns, {user, userMessage}]
  const anthropicTurns = anthropic.messages.map(
    // deno-lint-ignore no-explicit-any
    (m: any) => ({ role: m.role, content: m.content }),
  );
  // OpenAI: messages[] = [{system}, ...turns, {user, userMessage}]
  const openaiTurns = openai.messages
    .slice(1)
    // deno-lint-ignore no-explicit-any
    .map((m: any) => ({ role: m.role, content: m.content }));

  const expected = [...CONVERSATION_TURNS, { role: 'user', content: USER_MESSAGE }];
  assertEquals(anthropicTurns, expected);
  assertEquals(openaiTurns, expected);
  assertEquals(anthropicTurns, openaiTurns);
});

Deno.test('parity: generation params (max_tokens, temperature) are identical on both rungs', async () => {
  const { anthropic, openai } = await captureBothProviders();

  assertEquals(anthropic.max_tokens, MAX_TOKENS);
  assertEquals(openai.max_tokens, MAX_TOKENS);
  assertEquals(anthropic.temperature, TEMPERATURE);
  assertEquals(openai.temperature, TEMPERATURE);
});

// ─── The two KNOWN asymmetries, asserted as intended-and-known ───────────────

Deno.test('known asymmetry (a): systemSegments is Anthropic-only and is CONTENT-NEUTRAL', async () => {
  const { anthropic, openai } = await captureBothProviders();

  // Anthropic gets a block array with cache_control breakpoints.
  assertEquals(Array.isArray(anthropic.system), true);
  assertEquals(anthropic.system.length > 1, true);
  const breakpoints = anthropic.system.filter(
    // deno-lint-ignore no-explicit-any
    (b: any) => b.cache_control?.type === 'ephemeral',
  ).length;
  assertEquals(breakpoints >= 1, true);
  assertEquals(breakpoints <= 4, true); // Anthropic's hard cap

  // OpenAI gets one plain string — no blocks, no cache_control.
  assertEquals(typeof openai.messages[0].content, 'string');
  assertEquals(JSON.stringify(openai).includes('cache_control'), false);

  // CONTENT-NEUTRAL: the difference is block boundaries only.
  assertEquals(flattenAnthropicSystem(anthropic.system), openai.messages[0].content);
});

Deno.test('known asymmetry (b): neither provider is sent response_format — the JSON contract is prompt-only', async () => {
  const { anthropic, openai } = await captureBothProviders();

  // If this ever flips, the two rungs are no longer under the same output
  // contract and the structured-output validator's failure modes diverge by
  // provider. Assert the CURRENT, deliberate state on both sides.
  assertEquals('response_format' in openai, false);
  assertEquals('response_format' in anthropic, false);
});

Deno.test('parity holds on the sonnet rung too (not just haiku) — every Anthropic rung sees the same body', async () => {
  const { calls } = await captureBothProviders();
  const haiku = calls[0].body;
  const sonnet = calls[1].body;

  assertEquals(flattenAnthropicSystem(haiku.system), flattenAnthropicSystem(sonnet.system));
  assertEquals(JSON.stringify(haiku.messages), JSON.stringify(sonnet.messages));
  assertEquals(haiku.max_tokens, sonnet.max_tokens);
  assertEquals(haiku.temperature, sonnet.temperature);
  // Only the model id differs.
  assertEquals(haiku.model === sonnet.model, false);
});
