// supabase/functions/grounded-answer/__tests__/gen-ctx.test.ts
// Deno test runner:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Pins the response-cache v2 gen_ctx tuple (design item 2):
//   - canonicalJson: key-order independent, deterministic.
//   - hashGenCtx: the v1 mode-collision fix — two Foxy turns with identical
//     query/scope/mode/caller but different template_variables (learn vs
//     practice mode_directive), max_tokens, temperature, model_preference,
//     conversation_turns, or content_version MUST hash differently.
//   - genCtxKeyFragment: 12-char prefix of the full hash.
//
// Percentage-rollout cache-order fix (2026-08-03, assessment finding,
// REG-335 follow-up — renumbered from REG-333 during the origin/main merge;
// see .claude/regression/00-header.md's collision note): buildGenCtx's
// model_order fold-in + the
// cachedResponseMatchesModelOrder defense-in-depth read-time check. See
// gen-ctx.ts's ModelOrder / GenCtx / cachedResponseMatchesModelOrder docs
// for the full design.

import { assert, assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  buildGenCtx,
  canonicalJson,
  genCtxKeyFragment,
  hashGenCtx,
  cachedResponseMatchesModelOrder,
  GEN_CTX_KEY_FRAGMENT_LENGTH,
} from '../gen-ctx.ts';
import { PROMPT_REV, MODEL_ROUTE_REV } from '../config.ts';
import type { GroundedRequest, GroundedResponse } from '../types.ts';

function makeRequest(overrides: {
  template_variables?: Record<string, string>;
  max_tokens?: number;
  temperature?: number;
  model_preference?: 'haiku' | 'sonnet' | 'auto';
  conversation_turns?: Array<{ role: 'user' | 'assistant'; content: string }>;
  match_count?: number;
  min_similarity_override?: number;
} = {}): GroundedRequest {
  return {
    caller: 'foxy',
    student_id: null,
    cache_scope: 'shared',
    query: 'What is photosynthesis?',
    scope: {
      board: 'CBSE',
      grade: '10',
      subject_code: 'science',
      chapter_number: 1,
      chapter_title: 'Life Processes',
    },
    mode: 'soft',
    generation: {
      model_preference: overrides.model_preference ?? 'auto',
      max_tokens: overrides.max_tokens ?? 1024,
      temperature: overrides.temperature ?? 0.3,
      system_prompt_template: 'foxy_tutor_teach_v1',
      template_variables: overrides.template_variables ?? { mode: 'learn', mode_directive: '' },
      ...(overrides.conversation_turns ? { conversation_turns: overrides.conversation_turns } : {}),
    },
    retrieval: {
      match_count: overrides.match_count ?? 5,
      ...(overrides.min_similarity_override !== undefined
        ? { min_similarity_override: overrides.min_similarity_override }
        : {}),
    },
    timeout_ms: 20_000,
  };
}

Deno.test('canonicalJson is key-order independent and deterministic', () => {
  const a = canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } });
  const b = canonicalJson({ a: { c: 'x', d: [1, 2] }, b: 1 });
  assertEquals(a, b);
  assertEquals(a, '{"a":{"c":"x","d":[1,2]},"b":1}');
});

Deno.test('buildGenCtx folds the configured revisions + content_version + retrieval params', () => {
  const ctx = buildGenCtx(makeRequest(), 7);
  assertEquals(ctx.prompt_rev, PROMPT_REV);
  assertEquals(ctx.model_route_rev, MODEL_ROUTE_REV);
  assertEquals(ctx.content_version, 7);
  assertEquals(ctx.prompt_template, 'foxy_tutor_teach_v1');
  // Retrieval params belong in the gen_ctx (they change the generated answer).
  assertEquals(ctx.match_count, 5);
  // Absent min_similarity_override MUST normalize to null (never undefined —
  // undefined members are dropped by canonicalJson, null is hash-stable).
  assertEquals(ctx.min_similarity_override, null);
  const withOverride = buildGenCtx(makeRequest({ min_similarity_override: 0.42 }), 7);
  assertEquals(withOverride.min_similarity_override, 0.42);
});

Deno.test('hashGenCtx: identical requests hash identically; the fragment is a 12-char prefix', async () => {
  const h1 = await hashGenCtx(buildGenCtx(makeRequest(), 0));
  const h2 = await hashGenCtx(buildGenCtx(makeRequest(), 0));
  assertEquals(h1, h2);
  assertEquals(h1.length, 64);
  assertEquals(genCtxKeyFragment(h1), h1.slice(0, GEN_CTX_KEY_FRAGMENT_LENGTH));
});

Deno.test('mode-collision fix: learn vs practice template variables produce DIFFERENT gen_ctx hashes', async () => {
  // The exact v1 production bug: same query text, caller='foxy', mode='soft'
  // — only the Foxy UI mode + directive differ. v1 collided; v2 must not.
  const learn = await hashGenCtx(buildGenCtx(
    makeRequest({ template_variables: { mode: 'learn', mode_directive: '' } }),
    0,
  ));
  const practice = await hashGenCtx(buildGenCtx(
    makeRequest({ template_variables: { mode: 'practice', mode_directive: 'Emit 5 mcq blocks.' } }),
    0,
  ));
  assert(learn !== practice, 'learn and practice generation contexts must never collide');
});

Deno.test('every gen_ctx component changes the hash (max_tokens, temperature, model_preference, turns, content_version, match_count, min_similarity_override)', async () => {
  const base = await hashGenCtx(buildGenCtx(makeRequest(), 0));
  const variants = await Promise.all([
    hashGenCtx(buildGenCtx(makeRequest({ max_tokens: 2048 }), 0)),
    hashGenCtx(buildGenCtx(makeRequest({ temperature: 0.7 }), 0)),
    hashGenCtx(buildGenCtx(makeRequest({ model_preference: 'sonnet' }), 0)),
    hashGenCtx(buildGenCtx(makeRequest({ conversation_turns: [{ role: 'user', content: 'hi' }] }), 0)),
    hashGenCtx(buildGenCtx(makeRequest(), 1)), // content_version bump
    // Retrieval params change the generated answer, so they MUST rotate the
    // hash (hardening fix: they were missing from the v2 tuple at ship).
    hashGenCtx(buildGenCtx(makeRequest({ match_count: 8 }), 0)),
    hashGenCtx(buildGenCtx(makeRequest({ min_similarity_override: 0.5 }), 0)),
  ]);
  for (const v of variants) {
    assert(v !== base, 'each gen_ctx component must contribute to the hash');
  }
  assertEquals(new Set([base, ...variants]).size, variants.length + 1);
});

// ─── Percentage-rollout cache-order fix (2026-08-03, REG-335 follow-up) ─────

Deno.test('buildGenCtx: defaults model_order to openai_primary, and folds an explicit order in verbatim', () => {
  const defaulted = buildGenCtx(makeRequest(), 0);
  assertEquals(defaulted.model_order, 'openai_primary');

  const explicitOpenai = buildGenCtx(makeRequest(), 0, 'openai_primary');
  assertEquals(explicitOpenai.model_order, 'openai_primary');

  const explicitClaude = buildGenCtx(makeRequest(), 0, 'claude_primary');
  assertEquals(explicitClaude.model_order, 'claude_primary');
});

Deno.test('cache-order-blindness fix: an otherwise-IDENTICAL request hashes DIFFERENTLY under openai_primary vs claude_primary', async () => {
  // This is the core property the fix depends on: a caller's rollout-bucket
  // flip must rotate the gen_ctx hash — which is embedded in every cache
  // tier's key/tuple — so a stale cross-order response can never be served
  // from a hash-matched key.
  const req = makeRequest();
  const openaiHash = await hashGenCtx(buildGenCtx(req, 0, 'openai_primary'));
  const claudeHash = await hashGenCtx(buildGenCtx(req, 0, 'claude_primary'));
  assert(
    openaiHash !== claudeHash,
    'identical request must hash differently across openai_primary vs claude_primary',
  );
  // Sanity: the SAME order is still deterministic (no accidental extra entropy).
  const openaiHashAgain = await hashGenCtx(buildGenCtx(req, 0, 'openai_primary'));
  assertEquals(openaiHash, openaiHashAgain);
});

// ─── cachedResponseMatchesModelOrder: exact-match defense-in-depth ──────────

function groundedResponseWithOrder(modelOrder?: 'openai_primary' | 'claude_primary'): GroundedResponse {
  return {
    grounded: true,
    answer: 'An answer.',
    citations: [],
    confidence: 0.9,
    groundedFromChunks: true,
    trace_id: 'trace-x',
    meta: {
      claude_model: 'claude-haiku-4-5-20251001',
      tokens_used: 100,
      latency_ms: 500,
      ...(modelOrder ? { model_order: modelOrder } : {}),
    },
  };
}

Deno.test('cachedResponseMatchesModelOrder: same recorded order as expected → true (serve)', () => {
  assert(cachedResponseMatchesModelOrder(groundedResponseWithOrder('openai_primary'), 'openai_primary'));
  assert(cachedResponseMatchesModelOrder(groundedResponseWithOrder('claude_primary'), 'claude_primary'));
});

Deno.test('cachedResponseMatchesModelOrder: DIFFERENT recorded order than expected → false (miss) — the actual bug scenario', () => {
  // The exact production bug assessment traced: a response generated under
  // one order must never be served to a caller currently expecting the
  // other order.
  assertEquals(
    cachedResponseMatchesModelOrder(groundedResponseWithOrder('claude_primary'), 'openai_primary'),
    false,
  );
  assertEquals(
    cachedResponseMatchesModelOrder(groundedResponseWithOrder('openai_primary'), 'claude_primary'),
    false,
  );
});

Deno.test('cachedResponseMatchesModelOrder: no false positive on ordinary same-order provider fallback', () => {
  // claude.ts's per-call fallback can legitimately answer via Claude even
  // while resolved under 'openai_primary' (e.g. an OpenAI outage). The
  // check compares the TAGGED order (routing decision), never the recorded
  // claude_model/provider, so this must still pass.
  const fellBackToClaudeUnderOpenaiPrimaryOrder: GroundedResponse = {
    grounded: true,
    answer: 'An answer.',
    citations: [],
    confidence: 0.9,
    groundedFromChunks: true,
    trace_id: 'trace-fallback',
    meta: {
      claude_model: 'claude-haiku-4-5-20251001', // Anthropic model actually answered...
      tokens_used: 100,
      latency_ms: 500,
      model_order: 'openai_primary', // ...but the ROUTING decision was openai_primary.
    },
  };
  assert(cachedResponseMatchesModelOrder(fellBackToClaudeUnderOpenaiPrimaryOrder, 'openai_primary'));
});

Deno.test('cachedResponseMatchesModelOrder: permissive (true) when model_order is absent — pre-fix/legacy entries never crash a read', () => {
  assert(cachedResponseMatchesModelOrder(groundedResponseWithOrder(undefined), 'openai_primary'));
  assert(cachedResponseMatchesModelOrder(groundedResponseWithOrder(undefined), 'claude_primary'));
});

Deno.test('cachedResponseMatchesModelOrder: permissive (true) for a non-grounded response', () => {
  const abstain: GroundedResponse = {
    grounded: false,
    abstain_reason: 'upstream_error',
    suggested_alternatives: [],
    trace_id: 'trace-abstain',
    meta: { latency_ms: 200 },
  };
  assert(cachedResponseMatchesModelOrder(abstain, 'openai_primary'));
});
