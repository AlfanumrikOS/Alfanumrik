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

export async function hashPrompt(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
