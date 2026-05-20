// supabase/functions/alfabot-answer/retrieval.ts
//
// AlfaBot KB retrieval: embed the user message with Voyage, then call the
// `match_alfabot_kb_chunks` RPC for top-K filtered by audience + lang.
//
// Failure handling: any embedding or RPC error is logged and yields an EMPTY
// chunk array. The caller (Edge Function entry) decides whether an empty
// retrieval means "fall back to coreContext-only response" or "abstain to
// unknown_info refusal". This module never throws.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

import type { AlfaBotAudience, AlfaBotLang, KbChunk } from './prompt.ts';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-3';
const EMBEDDING_DIMENSIONS = 1024;
const VOYAGE_TIMEOUT_MS = 10_000;
const MAX_TEXT_CHARS = 8_000; // ~2000 tokens

/**
 * Embed a single string with Voyage. Returns null on any error.
 *
 * We intentionally do NOT import _shared/embeddings.ts: that module is
 * specifically written for the existing RAG pipeline and has provider
 * fallback to OpenAI text-embedding-3-small. AlfaBot uses Voyage only and
 * fails-soft (empty retrieval) so we keep the path tight.
 */
async function embedQuery(text: string): Promise<number[] | null> {
  const apiKey = Deno.env.get('VOYAGE_API_KEY') ?? '';
  if (!apiKey) {
    console.log(
      JSON.stringify({
        event: 'alfabot_embed_skip',
        reason: 'no_voyage_key',
      }),
    );
    return null;
  }

  const truncated = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOYAGE_TIMEOUT_MS);

  try {
    const res = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: [truncated],
        output_dimension: EMBEDDING_DIMENSIONS,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.log(
        JSON.stringify({
          event: 'alfabot_embed_http_error',
          status: res.status,
        }),
      );
      return null;
    }

    const data: { data?: Array<{ embedding?: number[] }> } = await res.json();
    const embedding = data.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
      console.log(
        JSON.stringify({
          event: 'alfabot_embed_bad_shape',
          length: Array.isArray(embedding) ? embedding.length : -1,
        }),
      );
      return null;
    }
    return embedding;
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    console.log(
      JSON.stringify({
        event: 'alfabot_embed_error',
        reason: isAbort ? 'timeout' : 'fetch_error',
      }),
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retrieve the top-K relevant KB chunks for the given turn. Returns [] on
 * any failure (embedding, RPC, no rows). Never throws.
 *
 * Caller contract: the returned chunks already filter on audience + lang
 * because the RPC enforces both. No additional filtering needed at the
 * call site.
 */
export async function retrieveAlfabotChunks(
  supabase: SupabaseClient,
  message: string,
  audience: AlfaBotAudience,
  lang: AlfaBotLang,
  topK = 4,
): Promise<KbChunk[]> {
  if (!message || message.trim().length === 0) return [];

  const embedding = await embedQuery(message);
  if (!embedding) return [];

  try {
    const { data, error } = await supabase.rpc('match_alfabot_kb_chunks', {
      query_embedding: embedding,
      match_audience: audience,
      match_lang: lang,
      match_count: topK,
    });

    if (error) {
      console.log(
        JSON.stringify({
          event: 'alfabot_rpc_error',
          message: String(error?.message ?? error).slice(0, 200),
        }),
      );
      return [];
    }

    if (!Array.isArray(data)) return [];

    return data
      .filter((row: unknown): row is Record<string, unknown> => row !== null && typeof row === 'object')
      .map((row: Record<string, unknown>): KbChunk => ({
        section_id: String(row.section_id ?? ''),
        title: String(row.title ?? ''),
        content: String(row.content ?? ''),
        canonical: Boolean(row.canonical),
        similarity: typeof row.similarity === 'number' ? row.similarity : undefined,
      }))
      .filter((chunk: KbChunk) => chunk.section_id.length > 0 && chunk.content.length > 0);
  } catch (err) {
    console.log(
      JSON.stringify({
        event: 'alfabot_rpc_exception',
        message: String(err).slice(0, 200),
      }),
    );
    return [];
  }
}
