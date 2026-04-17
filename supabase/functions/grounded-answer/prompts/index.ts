// supabase/functions/grounded-answer/prompts/index.ts
// Prompt template registry loader for the grounded-answer Edge Function.
// Templates are resolved at runtime by template id (see REGISTERED_PROMPT_TEMPLATES
// in ../config.ts). Unknown ids throw — there is no fallback, callers must pass a
// registered id.

import { REGISTERED_PROMPT_TEMPLATES } from '../config.ts';

const TEMPLATE_CACHE = new Map<string, string>();

export async function loadTemplate(templateId: string): Promise<string> {
  if (!REGISTERED_PROMPT_TEMPLATES.includes(templateId as any)) {
    throw new Error(`Unknown prompt template: ${templateId}`);
  }
  const cached = TEMPLATE_CACHE.get(templateId);
  if (cached) return cached;
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