// supabase/functions/grounded-answer/prompts/index.ts
// Prompt template registry loader for the grounded-answer Edge Function.
// Templates are resolved at runtime by template id (see REGISTERED_PROMPT_TEMPLATES
// in ../config.ts). Unknown ids throw — there is no fallback, callers must pass a
// registered id.
//
// Resolution strategy (Phase 0 hardening, Fix 0.2):
//   1. Prefer the inline TS string from `./inline.ts`. Inline strings are part
//      of the import graph so the Supabase deploy bundler always packages them.
//      This is the bulletproof path — works regardless of how the function is
//      bundled or served.
//   2. Fall back to `Deno.readTextFile('./<id>.txt')` only when the inline
//      version is missing for that id. The .txt files remain canonical for
//      review/diff and are still loaded by the local test harness.
//
// Why this matters: prior to this change, the loader only did the file-read
// path. If the .txt assets weren't packaged with the deployed function (which
// is the bundler's default behavior — only files in the import graph ship),
// every Foxy turn would throw NotFound and the student would see the generic
// "Foxy is catching its breath" upstream_error abstain.

import { REGISTERED_PROMPT_TEMPLATES } from '../config.ts';
import { INLINE_PROMPTS } from './inline.ts';

const TEMPLATE_CACHE = new Map<string, string>();

export async function loadTemplate(templateId: string): Promise<string> {
  if (!REGISTERED_PROMPT_TEMPLATES.includes(templateId as any)) {
    throw new Error(`Unknown prompt template: ${templateId}`);
  }
  const cached = TEMPLATE_CACHE.get(templateId);
  if (cached) return cached;

  // Path 1: inline (bundled with the function — preferred).
  const inline = INLINE_PROMPTS[templateId];
  if (typeof inline === 'string' && inline.length > 0) {
    console.info('[prompts] using inline for', templateId);
    TEMPLATE_CACHE.set(templateId, inline);
    return inline;
  }

  // Path 2: file-read fallback. Only reached if a registered template id has
  // no inline counterpart. Keeps backward compat with the local test harness
  // (which reads the canonical .txt files directly) and lets us add a new
  // template by dropping a .txt without having to inline it immediately.
  console.info('[prompts] using file for', templateId);
  const content = await Deno.readTextFile(
    new URL(`./${templateId}.txt`, import.meta.url)
  );
  TEMPLATE_CACHE.set(templateId, content);
  return content;
}

export function resolveTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

// ── Prompt-cache segmentation (response-cache v2, design item 9) ────────────
//
// Anthropic prompt caching caches PREFIXES at each cache_control breakpoint.
// Sending the whole system prompt as one cache_control block (the pre-v2
// behavior) means ANY change — new RAG chunks, a different per-student
// section — misses the whole prefix. Splitting the prompt at stable
// boundaries adds a breakpoint after the static template head so the large
// static prefix (persona + safety rails + mode directive + pedagogy rules)
// keeps hitting even when the tail varies.
//
// CRITICAL CONSTRAINT: block boundaries ONLY. The segments are exact,
// order-preserving substrings of the template — their resolved
// concatenation is byte-identical to resolveTemplate(template, vars)
// (resolveTemplate is a pure per-token substitution, so splitting at token
// boundaries and resolving each part independently commutes with resolving
// the whole). claude.ts additionally re-verifies that invariant and falls
// back to the legacy single block on ANY drift.
//
// Boundary slots:
//   - PERSONALIZATION_BOUNDARY_SLOTS: the per-student sections. The segment
//     starting at the FIRST of these gets cacheControl:false (uncached —
//     it varies per student/turn).
//   - reference_material_section (RAG chunks): the segment starting here
//     gets cacheControl:true — a breakpoint covering the full prefix, which
//     is exactly what the pre-v2 single block cached (multi-turn reuse
//     within a conversation), now IN ADDITION to the static-head breakpoint.
//
// In every registered template today the layout is
//   [static head] → [personalization slots] → [reference material]
// so this yields ≤2 cache_control breakpoints (Anthropic caps at 4).

export interface PromptSegment {
  text: string;
  cacheControl: boolean;
}

const PERSONALIZATION_BOUNDARY_SLOTS = [
  'pending_expectation',
  'academic_goal_section',
  'cognitive_context_section',
  'misconception_section',
  'previous_session_context',
  'learner_memory_section',
  'history_messages',
] as const;

const RAG_BOUNDARY_SLOT = 'reference_material_section';

/**
 * Split a raw template at the personalization/RAG boundaries and resolve
 * each part with the same variable map. Order of content is NEVER changed;
 * the concatenation of the returned texts equals
 * resolveTemplate(template, vars) byte-for-byte. Empty segments are
 * dropped (claude.ts also coalesces whitespace-only segments so no empty
 * text block is ever sent to the API).
 */
export function buildSystemPromptSegments(
  template: string,
  vars: Record<string, string>,
): PromptSegment[] {
  let personalizationIdx = -1;
  for (const slot of PERSONALIZATION_BOUNDARY_SLOTS) {
    const i = template.indexOf(`{{${slot}}}`);
    if (i !== -1 && (personalizationIdx === -1 || i < personalizationIdx)) {
      personalizationIdx = i;
    }
  }
  const ragIdx = template.indexOf(`{{${RAG_BOUNDARY_SLOT}}}`);

  // Cuts: each starts a new segment with the given cache flag. The head
  // (before the first cut) is the static template prefix → cached.
  const cuts: Array<{ at: number; cacheControl: boolean }> = [];
  if (personalizationIdx !== -1) cuts.push({ at: personalizationIdx, cacheControl: false });
  if (ragIdx !== -1) cuts.push({ at: ragIdx, cacheControl: true });
  cuts.sort((a, b) => a.at - b.at);

  const rawSegments: PromptSegment[] = [];
  let prevAt = 0;
  let prevFlag = true; // static head → cached
  for (const cut of cuts) {
    rawSegments.push({ text: template.slice(prevAt, cut.at), cacheControl: prevFlag });
    prevAt = cut.at;
    prevFlag = cut.cacheControl;
  }
  rawSegments.push({ text: template.slice(prevAt), cacheControl: prevFlag });

  return rawSegments
    .map((s) => ({ text: resolveTemplate(s.text, vars), cacheControl: s.cacheControl }))
    .filter((s) => s.text.length > 0);
}

export async function hashPrompt(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
