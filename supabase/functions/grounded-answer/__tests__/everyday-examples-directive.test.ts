// supabase/functions/grounded-answer/__tests__/everyday-examples-directive.test.ts
// Deno test runner:
//   cd supabase/functions/grounded-answer && deno test --allow-all __tests__/everyday-examples-directive.test.ts
//
// Pins ff_foxy_everyday_examples_v1 — the flag-gated everyday-Indian-life
// "example" requirement appended to Foxy's structured-output system prompt.
//
// Four contracts, in descending order of blast radius if broken:
//
//   1. CACHE CORRECTNESS (the important one). The flag changes generation, so
//      it MUST rotate the gen_ctx hash — otherwise a flagged-ON student can be
//      served an answer generated under the flagged-OFF prompt (and vice
//      versa), because every OTHER gen_ctx field is byte-identical between the
//      two states. Same failure mode, same fix, as the model_order fold-in
//      (REG-335 follow-up). Conversely the flag-OFF hash MUST be unchanged from
//      the pre-flag hash, which is what lets this ship without a PROMPT_REV
//      bump (see config.ts).
//   2. FLAG-OFF IS A STRICT NO-OP. buildStructuredOutputPrompt must return
//      FOXY_STRUCTURED_OUTPUT_PROMPT byte-for-byte when the flag is off.
//   3. FAIL-CLOSED. A missing row or a throwing DB must yield `false` — the
//      opposite of _mmr-flag.ts's fail-OPEN, because this changes
//      student-facing generation and the safe state is current behaviour.
//   4. NO VISUAL PROMISE (P12). Our corpus has no extractable per-figure
//      assets, so the directive must not reference a diagram / figure / image.

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStrictEquals,
} from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  buildStructuredOutputPrompt,
  EVERYDAY_EXAMPLE_DIRECTIVE,
  FOXY_STRUCTURED_OUTPUT_PROMPT,
} from '../structured-prompt.ts';
import {
  EVERYDAY_EXAMPLES_FLAG_NAME,
  isEverydayExamplesEnabled,
  __resetEverydayFlagCacheForTests,
} from '../_everyday-flag.ts';
import { buildGenCtx, hashGenCtx } from '../gen-ctx.ts';
import type { GroundedRequest } from '../types.ts';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Mirrors gen-ctx.test.ts's fixture so the two files pin the same shape. */
function makeRequest(): GroundedRequest {
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
      model_preference: 'auto',
      max_tokens: 1024,
      temperature: 0.3,
      system_prompt_template: 'foxy_tutor_teach_v1',
      template_variables: { mode: 'learn', mode_directive: '' },
    },
    retrieval: { match_count: 5 },
    timeout_ms: 20_000,
  };
}

/**
 * Minimal stub of the Supabase client surface _everyday-flag.ts touches:
 * sb.from(...).select(...).eq(...).single(). `single` decides the outcome;
 * `onEq` (optional) observes the flag_name the reader filtered on.
 *
 * The chain is explicitly typed so the self-referential `select: () => chain`
 * does not trip noImplicitAny.
 */
interface FlagChain {
  select: () => FlagChain;
  eq: (col: string, val: string) => FlagChain;
  // deno-lint-ignore no-explicit-any
  single: () => Promise<any>;
}

function stubSb(
  // deno-lint-ignore no-explicit-any
  single: () => Promise<any>,
  onEq?: (val: string) => void,
  // deno-lint-ignore no-explicit-any
): any {
  const chain: FlagChain = {
    select: () => chain,
    eq: (_col, val) => {
      onEq?.(val);
      return chain;
    },
    single,
  };
  return { from: () => chain };
}

// ─── 1. Cache correctness: the gen_ctx hash MUST rotate on the flag ──────────

Deno.test(
  'gen_ctx hash DIFFERS between flag-on and flag-off for otherwise-identical requests',
  async () => {
    // Identical request, identical content_version, identical model_order —
    // the ONLY difference is the resolved flag. If these hashes are equal the
    // cache cannot tell the two generations apart and WILL cross-serve them.
    const off = await hashGenCtx(buildGenCtx(makeRequest(), 7, 'openai_primary', false));
    const on = await hashGenCtx(buildGenCtx(makeRequest(), 7, 'openai_primary', true));
    assertNotEquals(
      on,
      off,
      'flag-on and flag-off MUST NOT share a gen_ctx hash — a flagged-ON student ' +
        'would be served a flagged-OFF cached answer',
    );
    assertEquals(off.length, 64);
    assertEquals(on.length, 64);
  },
);

Deno.test('gen_ctx: flag-on/flag-off each hash deterministically', async () => {
  const onA = await hashGenCtx(buildGenCtx(makeRequest(), 7, 'openai_primary', true));
  const onB = await hashGenCtx(buildGenCtx(makeRequest(), 7, 'openai_primary', true));
  assertEquals(onA, onB);
});

Deno.test(
  'gen_ctx: flag-OFF hash is UNCHANGED from the pre-flag (3-arg) hash — no cache flush',
  async () => {
    // This is what justifies declining the PROMPT_REV bump (config.ts): every
    // cache entry written before this flag shipped stays reachable AND correct,
    // because a flag-OFF request produces the identical prompt it was generated
    // under. Only flag-ON rotates.
    const preFlag = await hashGenCtx(buildGenCtx(makeRequest(), 7, 'openai_primary'));
    const explicitOff = await hashGenCtx(
      buildGenCtx(makeRequest(), 7, 'openai_primary', false),
    );
    assertEquals(explicitOff, preFlag);
  },
);

Deno.test('gen_ctx: everyday_examples is present ONLY when the flag is on', () => {
  // Absent (not `false`) when off — that omission is exactly what keeps the
  // flag-OFF canonical JSON byte-identical to a pre-flag request.
  assertEquals(buildGenCtx(makeRequest(), 7, 'openai_primary', false).everyday_examples, undefined);
  assertEquals(buildGenCtx(makeRequest(), 7, 'openai_primary', true).everyday_examples, true);
  assert(!('everyday_examples' in buildGenCtx(makeRequest(), 7, 'openai_primary', false)));
});

// ─── 2. Flag-OFF is a strict no-op; flag-ON appends the directive ────────────

Deno.test('flag-OFF returns the base structured-output prompt byte-identical', () => {
  const composed = buildStructuredOutputPrompt({ everydayExamples: false });
  // Strict equality on the STRING VALUE — a byte-for-byte pin, not a
  // "starts with" approximation.
  assertStrictEquals(composed, FOXY_STRUCTURED_OUTPUT_PROMPT);
  assertEquals(composed.length, FOXY_STRUCTURED_OUTPUT_PROMPT.length);
  // The directive must not have leaked into the base constant itself.
  assertEquals(FOXY_STRUCTURED_OUTPUT_PROMPT.includes('EVERYDAY EXAMPLE REQUIREMENT'), false);
});

Deno.test('flag-OFF base prompt retains its anchors (drift canary)', () => {
  assert(FOXY_STRUCTURED_OUTPUT_PROMPT.startsWith('# OUTPUT FORMAT (STRICT)'));
  assert(FOXY_STRUCTURED_OUTPUT_PROMPT.endsWith('Return ONLY the JSON object. Nothing else.'));
  // The "example" block type this feature reuses must already exist in the
  // union — the directive adds NO new block type.
  assert(FOXY_STRUCTURED_OUTPUT_PROMPT.includes('"example"'));
});

Deno.test('flag-ON appends the directive and preserves the base prompt intact', () => {
  const composed = buildStructuredOutputPrompt({ everydayExamples: true });
  assertNotEquals(composed, FOXY_STRUCTURED_OUTPUT_PROMPT);
  // Base is preserved verbatim as a prefix — the existing constraints, subject
  // rules, few-shot examples, and the untouched "diagram" block rules all
  // survive unchanged.
  assert(composed.startsWith(FOXY_STRUCTURED_OUTPUT_PROMPT));
  assert(composed.includes(EVERYDAY_EXAMPLE_DIRECTIVE));
  assertEquals(
    composed,
    `${FOXY_STRUCTURED_OUTPUT_PROMPT}\n\n${EVERYDAY_EXAMPLE_DIRECTIVE}`,
  );
});

Deno.test('flag-ON directive REQUIRES at least one example block', () => {
  const d = EVERYDAY_EXAMPLE_DIRECTIVE;
  // Imperative requirement, matching the surrounding Constraints voice.
  assert(/MUST include at least one "example" block/.test(d), 'must state the requirement');
  // Scoped to explanation-style turns.
  assert(/learn/.test(d) && /explain/.test(d) && /doubt/.test(d));
  // Reuses the existing block type; no second block type invented.
  assert(/do not invent a new block type/i.test(d));
});

Deno.test('flag-ON directive ports the India-grounded, age-appropriate language', () => {
  const d = EVERYDAY_EXAMPLE_DIRECTIVE;
  // Ported from packages/lib/src/ai/prompts/foxy-system.ts:57 and :155.
  assert(/everyday Indian life/i.test(d));
  for (const anchor of ['festivals', 'cricket']) {
    assert(d.includes(anchor), `directive must mention "${anchor}"`);
  }
  // Age-appropriateness for the student's grade band (P12).
  assert(/Classes 6 to 12/.test(d));
  assert(/age-appropriate/i.test(d));
});

Deno.test('flag-ON directive protects grounding: example is illustrative, not an NCERT claim', () => {
  const d = EVERYDAY_EXAMPLE_DIRECTIVE;
  assert(/ILLUSTRATIVE FRAMING ONLY/.test(d));
  assert(/Never present it as something the NCERT book or the Reference Material states/.test(d));
  // Every factual claim still comes from the reference material (P12).
  assert(/FACTUAL claim[\s\S]*must still come from the Reference Material/.test(d));
});

Deno.test('flag-ON composed prompt still ends with the strict-JSON closing line', () => {
  // The directive is appended AFTER the base prompt's closing instruction, so
  // it re-asserts it — the last thing the model reads must be the same in BOTH
  // flag states.
  const off = buildStructuredOutputPrompt({ everydayExamples: false });
  const on = buildStructuredOutputPrompt({ everydayExamples: true });
  const closing = 'Return ONLY the JSON object. Nothing else.';
  assert(off.endsWith(closing));
  assert(on.endsWith(closing));
});

// ─── 3. Flag reader fails CLOSED ─────────────────────────────────────────────

Deno.test('flag reader: fails CLOSED when the DB read throws', async () => {
  __resetEverydayFlagCacheForTests();
  const sb = stubSb(() => Promise.reject(new Error('db down')));
  assertEquals(await isEverydayExamplesEnabled(sb), false);
  __resetEverydayFlagCacheForTests();
});

Deno.test('flag reader: fails CLOSED when the single() call throws synchronously', async () => {
  __resetEverydayFlagCacheForTests();
  const sb = stubSb(() => {
    throw new Error('boom');
  });
  assertEquals(await isEverydayExamplesEnabled(sb), false);
  __resetEverydayFlagCacheForTests();
});

Deno.test('flag reader: fails CLOSED when the row is MISSING (migration not applied)', async () => {
  __resetEverydayFlagCacheForTests();
  const sb = stubSb(() => Promise.resolve({ data: null }));
  assertEquals(await isEverydayExamplesEnabled(sb), false);
  __resetEverydayFlagCacheForTests();
});

Deno.test('flag reader: OFF for is_enabled=false and for a null/absent column', async () => {
  for (const data of [{ is_enabled: false }, {}, { is_enabled: null }]) {
    __resetEverydayFlagCacheForTests();
    const sb = stubSb(() => Promise.resolve({ data }));
    assertEquals(await isEverydayExamplesEnabled(sb), false);
  }
  __resetEverydayFlagCacheForTests();
});

Deno.test('flag reader: ON only for an explicit is_enabled === true', async () => {
  __resetEverydayFlagCacheForTests();
  const sb = stubSb(() => Promise.resolve({ data: { is_enabled: true } }));
  assertEquals(await isEverydayExamplesEnabled(sb), true);
  __resetEverydayFlagCacheForTests();
});

Deno.test('flag reader: reads the seeded flag name', async () => {
  assertEquals(EVERYDAY_EXAMPLES_FLAG_NAME, 'ff_foxy_everyday_examples_v1');
  __resetEverydayFlagCacheForTests();
  const seen: string[] = [];
  const sb = stubSb(
    () => Promise.resolve({ data: { is_enabled: true } }),
    (val) => seen.push(val),
  );
  await isEverydayExamplesEnabled(sb);
  assertEquals(seen, ['ff_foxy_everyday_examples_v1']);
  __resetEverydayFlagCacheForTests();
});

Deno.test('flag reader: memoizes within the TTL (one DB read per window)', async () => {
  __resetEverydayFlagCacheForTests();
  let calls = 0;
  const sb = stubSb(() => {
    calls++;
    return Promise.resolve({ data: { is_enabled: true } });
  });
  await isEverydayExamplesEnabled(sb);
  await isEverydayExamplesEnabled(sb);
  await isEverydayExamplesEnabled(sb);
  assertEquals(calls, 1);
  __resetEverydayFlagCacheForTests();
});

// ─── 4. P12: the directive promises no visual asset ──────────────────────────

Deno.test('directive contains NO figure/diagram/image promise', () => {
  // Our corpus has no extractable per-figure assets: media_url is a
  // whole-textbook PDF and page_number is NULL on every chunk. A prompt that
  // referenced one would promise the student something we cannot render.
  // Asserted on the DIRECTIVE ONLY — the base prompt legitimately contains the
  // pre-existing "diagram" block rules, which this change does not touch.
  for (const banned of ['diagram', 'figure', 'image', 'picture', 'illustration', 'photo']) {
    assertEquals(
      new RegExp(banned, 'i').test(EVERYDAY_EXAMPLE_DIRECTIVE),
      false,
      `EVERYDAY_EXAMPLE_DIRECTIVE must not mention "${banned}"`,
    );
  }
});

Deno.test('directive does not alter the existing diagram block rules', () => {
  const on = buildStructuredOutputPrompt({ everydayExamples: true });
  // The pre-existing diagram rules survive verbatim in the composed prompt.
  assert(on.includes('"diagram" blocks must not include "text" or "latex".'));
  assert(on.includes('| { type: "diagram",'));
});
