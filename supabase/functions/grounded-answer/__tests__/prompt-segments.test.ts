// supabase/functions/grounded-answer/__tests__/prompt-segments.test.ts
// Deno test runner:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Pins the response-cache v2 prompt-cache restructuring (design item 9):
//   - buildSystemPromptSegments: for EVERY registered template, the joined
//     segment texts are byte-identical to resolveTemplate(template, vars) —
//     block boundaries only, never a prompt-text change.
//   - Segment plan: static head cached → personalization uncached → RAG
//     cached; ≤ 2 cache_control breakpoints emitted (Anthropic caps at 4).
//   - claude.ts buildSystemBlocks: drift guard (segments that don't
//     concatenate to systemPrompt fall back to the legacy single block),
//     whitespace-only-segment coalescing (no empty/whitespace-only text
//     block is ever sent), legacy single-block behavior when no segments.

import { assert, assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  loadTemplate,
  resolveTemplate,
  buildSystemPromptSegments,
} from '../prompts/index.ts';
import { buildSystemBlocks } from '../claude.ts';
import { REGISTERED_PROMPT_TEMPLATES } from '../config.ts';

// Representative variable map: service-computed vars + personalization
// sections populated so the uncached middle segment is non-empty.
const FULL_VARS: Record<string, string> = {
  grade: '10',
  subject: 'science',
  board: 'CBSE',
  chapter: 'Light',
  chapter_suffix: ', Chapter: Light',
  mode_upper: 'SOFT',
  mode_instruction: 'Answer only from the reference material.',
  mode_directive: 'Answer only from the reference material.',
  coach_mode: 'SOCRATIC',
  coach_mode_instruction: 'Ask, do not tell.',
  next_topic: 'Refraction',
  prereq: 'reflection',
  question_json: '{"q":"?"}',
  pending_expectation: 'ANSWERING_NOW: evaluate the reply as the answer.',
  academic_goal_section: '## Student Goal: boards',
  cognitive_context_section: 'COGNITIVE CONTEXT: weak on refraction.',
  misconception_section: 'KNOWN MISCONCEPTIONS: mixes up mirrors.',
  previous_session_context: 'PREVIOUS SESSION: covered reflection.',
  learner_memory_section: 'LEARNER MEMORY: prefers examples.',
  history_messages: '[]',
  reference_material_section: '=== REFERENCE MATERIAL ===\n[1] chunk text\n=== END REFERENCE MATERIAL ===',
};

const EMPTY_PERSONALIZATION_VARS: Record<string, string> = {
  ...FULL_VARS,
  pending_expectation: '',
  academic_goal_section: '',
  cognitive_context_section: '',
  misconception_section: '',
  previous_session_context: '',
  learner_memory_section: '',
  history_messages: '',
};

Deno.test('buildSystemPromptSegments: joined segments are byte-identical to resolveTemplate for EVERY registered template', async () => {
  for (const id of REGISTERED_PROMPT_TEMPLATES) {
    const template = await loadTemplate(id);
    for (const vars of [FULL_VARS, EMPTY_PERSONALIZATION_VARS]) {
      const segments = buildSystemPromptSegments(template, vars);
      const joined = segments.map((s) => s.text).join('');
      assertEquals(
        joined,
        resolveTemplate(template, vars),
        `segments for ${id} must concatenate to the exact resolved prompt`,
      );
    }
  }
});

Deno.test('buildSystemPromptSegments: static head cached, personalization uncached, RAG cached; ≤2 breakpoints', async () => {
  const template = await loadTemplate('foxy_tutor_teach_v1');
  const segments = buildSystemPromptSegments(template, FULL_VARS);
  assert(segments.length >= 2, 'foxy template must split into multiple segments');
  // Head = static template prefix → cached.
  assertEquals(segments[0].cacheControl, true);
  // Last segment starts at reference_material_section → cached breakpoint.
  assertEquals(segments[segments.length - 1].cacheControl, true);
  assert(
    segments[segments.length - 1].text.includes('REFERENCE MATERIAL'),
    'last segment must carry the RAG block',
  );
  // The personalization middle (when present) is uncached.
  const middle = segments.slice(1, -1);
  for (const seg of middle) {
    assertEquals(seg.cacheControl, false, 'personalization segments must be uncached');
  }
  const breakpoints = segments.filter((s) => s.cacheControl).length;
  assert(breakpoints <= 4, 'must never exceed the Anthropic 4-breakpoint cap');
});

Deno.test('buildSystemPromptSegments: ncert_solver_v1 (no personalization slots) → [static cached][RAG cached]', async () => {
  const template = await loadTemplate('ncert_solver_v1');
  const segments = buildSystemPromptSegments(template, FULL_VARS);
  assertEquals(segments.length, 2);
  assertEquals(segments[0].cacheControl, true);
  assertEquals(segments[1].cacheControl, true);
  assert(segments[1].text.includes('REFERENCE MATERIAL'));
});

Deno.test('buildSystemBlocks: no segments → legacy single block with cache_control (byte-identical pre-v2 behavior)', () => {
  const blocks = buildSystemBlocks('You are Foxy.');
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].text, 'You are Foxy.');
  assertEquals(blocks[0].cache_control, { type: 'ephemeral' });
});

Deno.test('buildSystemBlocks: drift guard — segments that do not concatenate to systemPrompt fall back to single block', () => {
  const blocks = buildSystemBlocks('You are Foxy.', [
    { text: 'You are ', cacheControl: true },
    { text: 'NOT Foxy.', cacheControl: false },
  ]);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].text, 'You are Foxy.');
});

Deno.test('buildSystemBlocks: whitespace-only middle segment is coalesced — no empty/whitespace block is sent, bytes preserved', () => {
  const prompt = 'STATIC HEAD\n\n\nRAG TAIL';
  const blocks = buildSystemBlocks(prompt, [
    { text: 'STATIC HEAD', cacheControl: true },
    { text: '\n\n\n', cacheControl: false }, // empty personalization resolved to newlines only
    { text: 'RAG TAIL', cacheControl: true },
  ]);
  assertEquals(blocks.length, 2);
  for (const b of blocks) {
    assert(b.text.trim().length > 0, 'no whitespace-only block may be sent');
  }
  assertEquals(blocks.map((b) => b.text).join(''), prompt, 'coalescing must preserve bytes');
  assertEquals(blocks[0].cache_control, { type: 'ephemeral' });
  assertEquals(blocks[1].cache_control, { type: 'ephemeral' });
});

Deno.test('buildSystemBlocks: multi-segment blocks preserve bytes and mark only cacheControl segments', () => {
  const segs = [
    { text: 'HEAD ', cacheControl: true },
    { text: 'PERSONAL ', cacheControl: false },
    { text: 'RAG', cacheControl: true },
  ];
  const prompt = 'HEAD PERSONAL RAG';
  const blocks = buildSystemBlocks(prompt, segs);
  assertEquals(blocks.length, 3);
  assertEquals(blocks.map((b) => b.text).join(''), prompt);
  assertEquals(blocks[0].cache_control, { type: 'ephemeral' });
  assertEquals(blocks[1].cache_control, undefined);
  assertEquals(blocks[2].cache_control, { type: 'ephemeral' });
});
