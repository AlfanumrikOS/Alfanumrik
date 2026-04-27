// eval/rag/runner.ts
//
// Test runner for the RAG evaluation harness. Reads gold-query fixtures,
// invokes the grounded-answer Edge Function over HTTP, and returns a
// normalized Result[] for scoring.
//
// Design choices:
//   - Decoupled from Next.js runtime: posts via fetch to the deployed Edge
//     Function (or local `supabase functions serve`). This means the eval
//     can run from a CI job that doesn't bundle the app, and it exercises
//     the EXACT code path that production Foxy uses.
//   - Sequential, not parallel: the live grounded-answer service has a
//     circuit breaker that opens after 3 failures in 10s. Running 30
//     queries in parallel would blow the breaker on a partial outage and
//     give a false-negative eval. Keep it serial; run takes ~2-3 minutes.
//   - Never throws on individual query failure — captures the error in
//     Result.error so the run completes and we can see the failure mode
//     across the whole gold set.
//   - Throws ONLY when env vars are missing (configuration error, not a
//     test failure).

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GoldQuery, Result } from './types.ts';

// ─── Configuration ──────────────────────────────────────────────────────

interface RunnerConfig {
  /** Supabase project URL, e.g. https://abc.supabase.co */
  supabaseUrl: string;
  /** Service-role JWT (eval intentionally bypasses RLS for predictable scope). */
  serviceKey: string;
  /** Absolute path to eval/rag/fixtures/. */
  fixturesDir: string;
  /** Per-query timeout (passed through to the service). Default 30s. */
  timeoutMs?: number;
}

/** Shape returned by the live grounded-answer service. Mirror of types.ts. */
interface ServiceCitation {
  index: number;
  chunk_id: string;
  chapter_number: number;
  chapter_title: string;
  page_number: number | null;
  similarity: number;
  excerpt: string;
  media_url: string | null;
}

interface ServiceGroundedResponse {
  grounded: true;
  answer: string;
  citations: ServiceCitation[];
  confidence: number;
  trace_id: string;
  meta: { claude_model: string; tokens_used: number; latency_ms: number };
}

interface ServiceAbstainResponse {
  grounded: false;
  abstain_reason: string;
  suggested_alternatives: unknown[];
  trace_id: string;
  meta: { latency_ms: number };
}

type ServiceResponse = ServiceGroundedResponse | ServiceAbstainResponse;

// ─── Public entry points ─────────────────────────────────────────────────

/**
 * Load configuration from process.env. Throws a clear error if either of
 * the two required vars is missing — eval cannot run without them.
 */
export function loadRunnerConfig(fixturesDir: string): RunnerConfig {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      'RAG eval requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.',
    );
  }
  return {
    supabaseUrl,
    serviceKey,
    fixturesDir,
    timeoutMs: 30_000,
  };
}

/** Load every JSON fixture in `fixturesDir` and concatenate the queries. */
export async function loadGoldQueries(fixturesDir: string): Promise<GoldQuery[]> {
  const files = await readdir(fixturesDir);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  const all: GoldQuery[] = [];
  for (const file of jsonFiles) {
    const raw = await readFile(join(fixturesDir, file), 'utf-8');
    const parsed = JSON.parse(raw) as { queries: GoldQuery[] };
    if (!Array.isArray(parsed.queries)) {
      throw new Error(`Fixture ${file} is missing top-level "queries" array.`);
    }
    all.push(...parsed.queries);
  }
  return all;
}

/**
 * Run all gold queries against the live grounded-answer service. Returns
 * a Result[] in the same order as the input. Never throws on individual
 * query failure — errors are captured in Result.error.
 */
export async function runEval(config: RunnerConfig, queries: GoldQuery[]): Promise<Result[]> {
  const results: Result[] = [];
  for (const q of queries) {
    results.push(await invokeOne(config, q));
  }
  return results;
}

// ─── Internal: single-query invocation ───────────────────────────────────

async function invokeOne(config: RunnerConfig, q: GoldQuery): Promise<Result> {
  const url = `${config.supabaseUrl}/functions/v1/grounded-answer`;
  const body = buildRequestBody(q, config.timeoutMs ?? 30_000);
  const startedAt = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (config.timeoutMs ?? 30_000) + 2_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    clearTimeout(timer);
    const latency_ms = Date.now() - startedAt;

    if (!res.ok && res.status !== 500) {
      // 4xx (validation error from service) → record as error so triage
      // can spot a malformed gold query. 500 is treated as a normal abstain
      // path because the service returns structured upstream_error there.
      return {
        query_id: q.id,
        grounded_response: { text: '', citations: [], abstained: false },
        latency_ms,
        error: `http_${res.status}`,
      };
    }

    const parsed = (await res.json()) as ServiceResponse;
    return normalizeResponse(q.id, parsed, latency_ms);
  } catch (err) {
    clearTimeout(timer);
    const latency_ms = Date.now() - startedAt;
    const message =
      err instanceof Error
        ? err.name === 'AbortError'
          ? 'timeout'
          : err.message
        : String(err);
    return {
      query_id: q.id,
      grounded_response: { text: '', citations: [], abstained: false },
      latency_ms,
      error: message,
    };
  }
}

/**
 * Build the GroundedRequest body for one gold query. We use mode='strict'
 * so the service's grounding/confidence gates are exercised — the eval
 * is exactly about catching ungrounded answers.
 */
function buildRequestBody(q: GoldQuery, timeoutMs: number): Record<string, unknown> {
  return {
    caller: 'foxy',
    student_id: null,
    query: q.query,
    scope: {
      board: 'CBSE',
      grade: q.grade,
      subject_code: q.subject,
      chapter_number: q.chapter_number ?? null,
      chapter_title: q.chapter_title ?? null,
    },
    mode: 'strict',
    generation: {
      model_preference: 'auto',
      max_tokens: 1024,
      temperature: 0.3,
      system_prompt_template: 'foxy_tutor_v1',
      template_variables: {},
    },
    retrieval: { match_count: 5 },
    retrieve_only: false,
    timeout_ms: timeoutMs,
  };
}

/** Collapse the service's discriminated union into the eval's flat Result. */
function normalizeResponse(
  query_id: string,
  parsed: ServiceResponse,
  latency_ms: number,
): Result {
  if (parsed.grounded === true) {
    return {
      query_id,
      grounded_response: {
        text: parsed.answer,
        citations: parsed.citations,
        abstained: false,
        trace_id: parsed.trace_id,
      },
      latency_ms,
    };
  }
  return {
    query_id,
    grounded_response: {
      text: '',
      citations: [],
      abstained: true,
      abstain_reason: parsed.abstain_reason,
      trace_id: parsed.trace_id,
    },
    latency_ms,
  };
}
