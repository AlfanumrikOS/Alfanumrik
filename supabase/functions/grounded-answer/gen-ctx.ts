// supabase/functions/grounded-answer/gen-ctx.ts
//
// Response-cache v2 "generation context" (gen_ctx) tuple.
//
// The v1 cache key was (grade, subject_code, mode, caller, normalized-query
// hash). That collapsed requests that share the same query TEXT but produce
// materially different answers — the observed production bug was Foxy's
// learn / practice / quiz_me UI modes: all three arrive as caller='foxy',
// mode='soft' with identical query text, differing ONLY in template
// variables (mode, mode_directive), max_tokens, and sometimes temperature.
// v1 served a practice-shaped MCQ response to a learn turn.
//
// v2 folds EVERYTHING that can change the generated answer for the same
// query into one canonical tuple, hashes it, and makes that hash part of
// BOTH the cache key (12-hex-char fragment, keeps the visible key short)
// and the stored defense-in-depth tuple (full 64-hex-char hash, re-validated
// on every read — mismatch is a miss, never served).
//
// gen_ctx fields (design-approved, response-cache v2):
//   prompt_template     — which registered template renders the system prompt
//   prompt_rev          — config.ts PROMPT_REV (bump on ANY prompt-text change)
//   model_route_rev     — config.ts MODEL_ROUTE_REV (bump on model-routing change)
//   model_preference    — 'haiku' | 'sonnet' | 'auto'
//   max_tokens          — caller-requested generation budget
//   temperature         — caller-requested temperature
//   content_version     — rag_content_versions.version for (grade, subject_code);
//                         bumped by every ingestion writer, so re-ingested NCERT
//                         content invalidates cached answers built on old chunks
//   match_count         — retrieval.match_count: how many chunks feed the
//                         prompt's reference material (changes the answer)
//   min_similarity_override — retrieval.min_similarity_override (null when
//                         absent, so presence/absence hashes deterministically);
//                         changes which chunks qualify → changes the answer
//   template_variables  — the FULL caller-supplied template-variable record
//   conversation_turns  — prior turns (normally empty for cache-eligible
//                         requests — cache_scope:'shared' callers only declare
//                         shared when turns are absent — but included so a
//                         misdeclaring caller can never collide across
//                         different conversations)
//
// Canonicalization: recursive sorted-key JSON so two semantically identical
// contexts always serialize to the same bytes regardless of object key
// insertion order.

import { MODEL_ROUTE_REV, PROMPT_REV } from './config.ts';
import type { ConversationTurn, GroundedRequest } from './types.ts';

export interface GenCtx {
  prompt_template: string;
  prompt_rev: number;
  model_route_rev: number;
  model_preference: 'haiku' | 'sonnet' | 'auto';
  max_tokens: number;
  temperature: number;
  content_version: number;
  match_count: number;
  /** Normalized to null when the caller omits it (never undefined — undefined
   * members are dropped by canonicalJson, null is stable in the hash). */
  min_similarity_override: number | null;
  template_variables: Record<string, string>;
  conversation_turns: ConversationTurn[];
}

/** Length of the gen_ctx hash fragment embedded in the visible cache key. */
export const GEN_CTX_KEY_FRAGMENT_LENGTH = 12;

/** Build the gen_ctx tuple for a request + the current content version. */
export function buildGenCtx(request: GroundedRequest, contentVersion: number): GenCtx {
  return {
    prompt_template: request.generation.system_prompt_template,
    prompt_rev: PROMPT_REV,
    model_route_rev: MODEL_ROUTE_REV,
    model_preference: request.generation.model_preference,
    max_tokens: request.generation.max_tokens,
    temperature: request.generation.temperature,
    content_version: contentVersion,
    match_count: request.retrieval.match_count,
    min_similarity_override: request.retrieval.min_similarity_override ?? null,
    template_variables: request.generation.template_variables ?? {},
    conversation_turns: request.generation.conversation_turns ?? [],
  };
}

/**
 * Deterministic JSON: object keys sorted recursively, arrays kept in order.
 * Only JSON-safe values appear in GenCtx so no special handling is needed
 * for undefined/functions (JSON.stringify drops undefined object members —
 * GenCtx never carries undefined members by construction).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** Full sha256 hex (64 chars) of the canonical gen_ctx JSON. */
export async function hashGenCtx(genCtx: GenCtx): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(genCtx));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Short fragment of the full hash for the visible cache key. */
export function genCtxKeyFragment(fullHash: string): string {
  return fullHash.slice(0, GEN_CTX_KEY_FRAGMENT_LENGTH);
}
