/**
 * ALFANUMRIK — Historical-query COSINE DISTRIBUTION replay harness
 * ================================================================================
 *
 * PURPOSE
 * -------
 * Shadow confidence instrumentation went live on 2026-07-27 (grounded-answer v80,
 * migrations 20260727130000 / 20260727130100). It records `cosine_similarity`,
 * `rerank_score`, `confidence_v2` and `signal_coverage` on every trace row — but
 * NO THRESHOLD CAN BE DERIVED UNTIL A REAL COSINE DISTRIBUTION EXISTS, and
 * production traffic is ~3 calls/day. Organic accumulation would take >1 year.
 *
 * The corpus of real queries already exists: `foxy_chat_messages` holds ~1,971
 * `role='user'` rows (~1,353 distinct) of genuine grade 6-12 phrasing, including
 * Hindi and code-mixed registers — exactly the register that assessment flagged
 * as penalised by the current lexical-overlap-dependent confidence v1.
 *
 * This harness replays those historical queries through the RETRIEVAL STAGE ONLY
 * and emits the resulting cosine distribution as an offline artifact.
 *
 * IT DOES NOT DERIVE, SUGGEST, OR HARD-CODE A THRESHOLD. Choosing a threshold is
 * assessment's call, with CEO approval. This tool only produces the evidence.
 *
 *
 * COST (read this before running)
 * -------------------------------
 * Per query, per LANE=direct:
 *   - 1 Voyage `voyage-3` EMBEDDING call  (the same call the live pipeline makes)
 *   - 1 Postgres RPC  `match_rag_chunks_ncert`  (read-only SELECT)
 *   - ZERO Anthropic/Claude calls. ZERO generation. Enforced structurally: this
 *     file never imports claude.ts and never sets a prompt template.
 *
 * Embedding-only estimate for the full corpus:
 *   ~1,353 distinct queries x ~20 tokens  ~=  27,000 voyage-3 tokens
 *   voyage-3 list price ~$0.06 / 1M tokens  ->  ~$0.002 (well under one cent).
 *   Even at 10x the token estimate this is a sub-$0.05 run.
 *
 * `--path stream` / `--path both` ADDITIONALLY issue one Voyage `rerank-2` call
 * per query over ~30 NCERT chunks. Rerank is priced per *document* token, not
 * per query token, so it is the dominant cost of this harness:
 *   ~1,353 queries x ~30 chunks x ~400 tokens ~= 16.2M rerank tokens
 *   rerank-2 list price ~$0.05 / 1M tokens  ->  ~$0.81
 * Still cheap, but ~400x the embedding lane. The dry-run prints both figures.
 * All prices are LIST PRICES AT TIME OF WRITING and are estimates only.
 *
 *
 * WHAT WRITES TO PRODUCTION  (P13 / read-only contract)
 * -----------------------------------------------------
 * LANE=direct  (THE DEFAULT):  **ZERO WRITES.** It performs exactly three kinds
 *   of production I/O, all read-only:
 *     1. SELECT on foxy_chat_messages / foxy_sessions / students / grounded_ai_traces
 *     2. SELECT-only RPC  match_rag_chunks_ncert  (SECURITY DEFINER, no writes)
 *     3. SELECT on feature_flags (MMR flag, strict mode only)
 *   It never invokes the deployed Edge Function, so `grounded_ai_traces` and
 *   `retrieval_traces` gain NO rows. This is why it is the default.
 *
 * LANE=edge  (OPT-IN, REFUSES TO RUN WITHOUT AN EXPLICIT ACK FLAG):
 *   ⚠️  **THIS LANE WRITES ONE ROW TO `grounded_ai_traces` PER QUERY, PLUS ONE
 *       ROW TO `retrieval_traces` PER QUERY.**  That is unavoidable: the
 *       `retrieve_only: true` branch in supabase/functions/grounded-answer/
 *       pipeline.ts:1252 terminates in `finalizeGrounded(...)`, which writes the
 *       trace row — trace-writing IS the pipeline's contract, and there is no
 *       suppress flag in the request schema. There is therefore NO `--no-trace`
 *       guard that could work against the deployed function; the only honest
 *       guard is refusal-by-default. Hence:
 *         * lane=edge requires  --i-understand-edge-lane-writes-traces
 *         * it stamps caller='concept-engine' (the only non-student caller the
 *           CHECK constraint allows for retrieve_only) and records the run id in
 *           the artifact so the injected rows are identifiable for later cleanup:
 *              DELETE FROM grounded_ai_traces
 *               WHERE caller='concept-engine' AND created_at BETWEEN <t0> AND <t1>;
 *           (Cleanup is a DELETE against production and is NOT performed by this
 *            script. It is listed here for the operator, not executed.)
 *       Use lane=edge ONLY if you specifically want to exercise the deployed
 *       function end-to-end. For the cosine distribution, lane=direct is both
 *       safer and MORE faithful (see NOTE ON FIDELITY below).
 *
 *
 * NOTE ON FIDELITY — why lane=direct is not a "replica"
 * -----------------------------------------------------
 * lane=direct does not reimplement anything. It imports and drives the REAL
 * production modules, in the real order, with the real constants:
 *     generateEmbedding()   supabase/functions/grounded-answer/embedding.ts
 *     retrieveChunks()      supabase/functions/grounded-answer/retrieval.ts
 *                             -> retrieve()  supabase/functions/_shared/rag/retrieve.ts
 *                             -> RPC match_rag_chunks_ncert (the same 11-arg overload)
 *     rerankDocuments()     supabase/functions/_shared/reranking.ts
 *     applyMMR()            supabase/functions/_shared/rag/mmr.ts
 *     computeConfidenceV2() supabase/functions/grounded-answer/confidence-v2.ts
 *     SOFT/STRICT_MIN_SIMILARITY, RRF_THEORETICAL_MAX   .../config.ts
 * The ONLY thing it omits relative to the deployed function is the trace write,
 * the cache lookup, and generation — none of which influence a cosine value.
 *
 *
 * STREAMING vs NON-STREAMING — THIS IS NOT A DETAIL, IT IS THE HEADLINE
 * ---------------------------------------------------------------------
 * The two pipelines diverge in FOUR places, and pooling them corrupts any
 * derived threshold. Verified in-source at 3723f881:
 *
 *   |                        | pipeline.ts (non-stream)     | pipeline-stream.ts (stream)  |
 *   |------------------------|------------------------------|------------------------------|
 *   | rerank in SOFT mode    | DISABLED (:191 returns false | ENABLED (:158 has no mode    |
 *   |                        | for mode==='soft')           | check; env default 'true')   |
 *   | over-fetch candidates  | RERANK_INITIAL_FETCH = 40    | RERANK_INITIAL_FETCH = 30    |
 *   | MMR after rerank       | applied (flag-gated, :1163)  | NOT APPLIED AT ALL           |
 *   | confidence v1 input    | RRF / RRF_THEORETICAL_MAX    | RAW un-normalized RRF (:631) |
 *
 * Consequence for the shadow signal: in SOFT mode the non-stream path never
 * reranks, so `rerank_score` is null and `confidence_v2_source` is 'cosine';
 * the stream path DOES rerank, so its source is 'rerank'. **Those are different
 * measurement scales and MUST NOT be pooled** (confidence-v2.ts says so
 * explicitly). This harness therefore keeps the two paths in separate record
 * streams and separate summary blocks, and the summary states which paths were
 * actually exercised. Run with `--path both` to get both populations.
 *
 * The COSINE value itself is path-independent (it comes from the RPC and is
 * unaffected by rerank/MMR) — but WHICH chunk lands at rank 1 is path-dependent,
 * so `cosine_top1` differs between paths. Both are reported.
 *
 *
 * USAGE
 * -----
 *   # 1. Plan + cost only. No network, no keys required.
 *   npx tsx scripts/rag/replay-cosine-distribution.ts --dry-run
 *
 *   # 2. The real run (the command a CEO/CI would use):
 *   export NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
 *   export VOYAGE_API_KEY=<voyage-key>
 *   npx tsx scripts/rag/replay-cosine-distribution.ts --path both --delay-ms 250
 *
 *   # 3. Resume an interrupted run (same --run-id, skips completed queries):
 *   npx tsx scripts/rag/replay-cosine-distribution.ts --run-id <id-from-run-1> --resume
 *
 * FLAGS
 *   --dry-run                 Print plan + cost, touch nothing. Needs no env vars.
 *   --limit N                 Cap distinct queries replayed (default: all).
 *   --lane direct|edge        direct = in-process, zero writes (default).
 *                             edge   = POST retrieve_only to the deployed function.
 *                                      WRITES TRACE ROWS. Requires the ack flag.
 *   --path nonstream|stream|both   Which pipeline's retrieval stage to reproduce.
 *                             Default nonstream (embedding-only cost).
 *   --mode soft|strict        Grounded mode. Default soft (what Foxy chat uses).
 *   --match-count N           retrieval.match_count. Default 5 (RAG_MATCH_COUNT
 *                             in apps/host/src/app/api/foxy/route.ts:288).
 *   --delay-ms N              Sleep between queries. Default 250.
 *   --run-id ID               Name the run (default: timestamp). Controls artifact
 *                             + checkpoint filenames.
 *   --resume                  Skip queries already present in the checkpoint.
 *   --out-dir DIR             Default eval/rag/reports/cosine-replay/
 *   --csv                     Also emit a flat CSV alongside the JSONL/JSON.
 *   --min-year YYYY           Only replay messages created on/after Jan 1 YYYY.
 *   --i-understand-edge-lane-writes-traces   Required for --lane edge.
 *
 * REQUIRED ENV (no silent degrade — the run ABORTS if any is missing/placeholder)
 *   NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   VOYAGE_API_KEY
 * A missing VOYAGE_API_KEY would silently drop the harness onto the RPC's
 * FTS-only tier, where `cosine_similarity` is NULL by construction — i.e. a
 * green run that measures nothing. That failure mode is the whole reason this
 * file refuses to start without the key.
 *
 * ARTIFACTS (written under eval/rag/reports/cosine-replay/, never to any table)
 *   <run-id>.records.jsonl    one JSON object per (query x path)
 *   <run-id>.summary.json     percentiles overall + by grade band + by register
 *   <run-id>.records.csv      optional flat view (--csv)
 *   <run-id>.checkpoint.jsonl append-only resume log
 *
 * PRIVACY (P13): artifacts carry NO student_id, NO session_id, NO name/email/
 * phone. The query text IS retained (it is the measurement subject) but is passed
 * through the SAME redactPreview() the production trace writer uses before being
 * stored, and every record carries a sha256 query hash for dedupe/joins.
 */

/* eslint-disable no-console */

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Deno env shim.
//
// The grounded-answer / _shared modules are Deno-targeted and read
// `Deno.env.get(...)` (e.g. reranking.ts:160 for VOYAGE_API_KEY, pipeline
// rerankEnabled() for FOXY_RERANK_ENABLED). Under `npx tsx` the `Deno` global
// does not exist, so those reads would throw a ReferenceError and — worse — be
// swallowed into a degraded no-rerank path. We install a minimal read-only shim
// backed by process.env BEFORE any of those modules are imported, so the real
// production code sees the real configuration. This is why every import of a
// supabase/functions module below is a dynamic import inside main().
// ─────────────────────────────────────────────────────────────────────────────
function installDenoEnvShim(): void {
  const g = globalThis as unknown as { Deno?: unknown };
  if (g.Deno === undefined) {
    g.Deno = {
      env: {
        get: (k: string): string | undefined => process.env[k],
        // Deliberately no set/delete: this shim is read-only on purpose.
      },
    };
  }
}

// ─── Repo paths ──────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, 'eval', 'rag', 'reports', 'cosine-replay');

// ─── Corpus / cost constants (documented, not derived) ───────────────────────

/** Distinct `role='user'` rows observed in foxy_chat_messages, 2026-07-27. */
const CORPUS_DISTINCT_ESTIMATE = 1353;
/** Total `role='user'` rows (pre-dedupe), same observation. */
const CORPUS_TOTAL_ESTIMATE = 1971;
/** Mean student query length. Foxy queries are short (median ~8 words). */
const EST_TOKENS_PER_QUERY = 20;
/** Rough NCERT chunk size fed to rerank-2 (~400-token chunks per the pipeline). */
const EST_TOKENS_PER_CHUNK = 400;
/** Voyage list prices at time of writing, USD per 1M tokens. ESTIMATES. */
const VOYAGE_EMBED_USD_PER_MTOK = 0.06;
const VOYAGE_RERANK_USD_PER_MTOK = 0.05;

/** Foxy's live retrieval.match_count — apps/host/src/app/api/foxy/route.ts:288. */
const DEFAULT_MATCH_COUNT = 5;

// ─── CLI ─────────────────────────────────────────────────────────────────────

type Lane = 'direct' | 'edge';
type PathSel = 'nonstream' | 'stream' | 'both';
type PipelinePath = 'nonstream' | 'stream';
type Mode = 'soft' | 'strict';

interface Cli {
  dryRun: boolean;
  limit: number | null;
  lane: Lane;
  path: PathSel;
  mode: Mode;
  matchCount: number;
  delayMs: number;
  runId: string;
  resume: boolean;
  outDir: string;
  csv: boolean;
  minYear: number | null;
  edgeAck: boolean;
}

function parseCli(argv: string[]): Cli {
  const get = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1) return null;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) {
      throw new Error(`--${name} requires a value`);
    }
    return v;
  };
  const has = (name: string): boolean => argv.includes(`--${name}`);

  const lane = (get('lane') ?? 'direct') as Lane;
  if (lane !== 'direct' && lane !== 'edge') throw new Error(`--lane must be direct|edge (got ${lane})`);
  const path = (get('path') ?? 'nonstream') as PathSel;
  if (!['nonstream', 'stream', 'both'].includes(path)) {
    throw new Error(`--path must be nonstream|stream|both (got ${path})`);
  }
  const mode = (get('mode') ?? 'soft') as Mode;
  if (mode !== 'soft' && mode !== 'strict') throw new Error(`--mode must be soft|strict (got ${mode})`);

  const limitRaw = get('limit');
  const limit = limitRaw === null ? null : Number.parseInt(limitRaw, 10);
  if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) throw new Error('--limit must be a positive integer');

  const matchCountRaw = get('match-count');
  const matchCount = matchCountRaw === null ? DEFAULT_MATCH_COUNT : Number.parseInt(matchCountRaw, 10);
  if (!Number.isFinite(matchCount) || matchCount <= 0) throw new Error('--match-count must be a positive integer');

  const delayRaw = get('delay-ms');
  const delayMs = delayRaw === null ? 250 : Number.parseInt(delayRaw, 10);
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error('--delay-ms must be >= 0');

  const minYearRaw = get('min-year');
  const minYear = minYearRaw === null ? null : Number.parseInt(minYearRaw, 10);
  if (minYear !== null && (!Number.isFinite(minYear) || minYear < 2000)) throw new Error('--min-year must be a 4-digit year');

  return {
    dryRun: has('dry-run'),
    limit,
    lane,
    path,
    mode,
    matchCount,
    delayMs,
    runId: get('run-id') ?? new Date().toISOString().replace(/[:.]/g, '-'),
    resume: has('resume'),
    outDir: get('out-dir') ?? DEFAULT_OUT_DIR,
    csv: has('csv'),
    minYear,
    edgeAck: has('i-understand-edge-lane-writes-traces'),
  };
}

function pathsFor(sel: PathSel): PipelinePath[] {
  return sel === 'both' ? ['nonstream', 'stream'] : [sel];
}

// ─── Config resolution — FAIL LOUDLY, never degrade ──────────────────────────

interface Creds {
  url: string;
  serviceKey: string;
  voyageKey: string;
}

const PLACEHOLDER_RE = /placeholder|example\.com|changeme|your-project|<.*>/i;

/**
 * Resolve required credentials. Throws (never returns a partial/degraded set).
 *
 * This repo has a documented history of harnesses that "stay green via the
 * degrade path": without VOYAGE_API_KEY the retrieval RPC still returns rows
 * from its FTS tier, but every one of them carries `cosine_similarity = NULL`,
 * so the run would complete, write an artifact, and measure literally nothing.
 * Refusing to start is the only correct behaviour.
 */
function requireCreds(): Creds {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const voyageKey = process.env.VOYAGE_API_KEY ?? '';

  const missing: string[] = [];
  if (!url) missing.push('NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)');
  if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!voyageKey) missing.push('VOYAGE_API_KEY');
  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s): ${missing.join(', ')}.\n` +
        '  This harness has NO degraded mode. Without VOYAGE_API_KEY the RPC falls back\n' +
        '  to its FTS tier where cosine_similarity is NULL by construction, so the run\n' +
        '  would look green while measuring nothing. Set the vars and re-run, or use\n' +
        '  --dry-run to inspect the plan without credentials.',
    );
  }
  const placeholders = [
    ['NEXT_PUBLIC_SUPABASE_URL', url],
    ['SUPABASE_SERVICE_ROLE_KEY', serviceKey],
    ['VOYAGE_API_KEY', voyageKey],
  ].filter(([, v]) => PLACEHOLDER_RE.test(v)).map(([k]) => k);
  if (placeholders.length > 0) {
    throw new Error(`Placeholder value detected in: ${placeholders.join(', ')}. Refusing to run.`);
  }
  return { url, serviceKey, voyageKey };
}

// ─── Query-corpus loading ────────────────────────────────────────────────────

interface SourceQuery {
  /** Normalized dedupe key (lowercased, whitespace-collapsed). */
  normKey: string;
  /** The raw text actually replayed — the FIRST variant seen for this key. */
  text: string;
  /** sha256:… over the production-normalized query (joins to grounded_ai_traces). */
  queryHash: string;
  /** How many raw rows collapsed into this distinct query. */
  occurrences: number;
  grade: string | null;
  subject: string | null;
  chapterNumber: number | null;
  /** Where grade/subject came from — kept so scope provenance is auditable. */
  scopeSource: 'session' | 'trace' | 'student' | 'none';
  register: Register;
}

type Register = 'devanagari' | 'code_mixed' | 'english' | 'other';

const DEVANAGARI_RE = /[ऀ-ॿ]/;
const LATIN_RE = /[A-Za-z]/;
/**
 * Romanized-Hindi ("Hinglish") marker vocabulary. Deliberately small, high
 * precision, and lowercase-matched on word boundaries. This is a HEURISTIC tag
 * for stratification only — it never affects retrieval or any score.
 */
const HINGLISH_MARKERS = [
  'kya', 'kaise', 'kyun', 'kyu', 'karo', 'karna', 'karte', 'hai', 'hain', 'nahi',
  'nahin', 'mujhe', 'mujhko', 'bataye', 'batao', 'samjhao', 'samjha', 'chahiye',
  'kaun', 'kitna', 'kitne', 'yeh', 'woh', 'aur', 'lekin', 'matlab', 'padhna',
  'padhai', 'sawal', 'uttar', 'prashn', 'hota', 'hoti', 'hote', 'wala', 'wali',
  'accha', 'theek', 'thik', 'jaldi', 'phir', 'abhi', 'sirf', 'bhi',
];

export function classifyRegister(text: string): Register {
  const t = (text ?? '').trim();
  if (t.length === 0) return 'other';
  const hasDeva = DEVANAGARI_RE.test(t);
  const hasLatin = LATIN_RE.test(t);
  if (hasDeva) return hasLatin ? 'code_mixed' : 'devanagari';
  if (!hasLatin) return 'other';
  const words = t.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const markerHits = words.filter((w) => HINGLISH_MARKERS.includes(w)).length;
  return markerHits > 0 ? 'code_mixed' : 'english';
}

export function gradeBand(grade: string | null): '6-8' | '9-10' | '11-12' | 'unknown' {
  const g = Number.parseInt(grade ?? '', 10);
  if (g >= 6 && g <= 8) return '6-8';
  if (g >= 9 && g <= 10) return '9-10';
  if (g >= 11 && g <= 12) return '11-12';
  return 'unknown';
}

/** Dedupe key. NOT the production hash — that one lives in trace.ts. */
export function normalizeForDedupe(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Map whatever `foxy_sessions.subject` holds onto the snake_case subject codes
 * the corpus is indexed by (packages/lib/src/sanitize.ts VALID_SUBJECTS).
 * Returns null for anything unrecognised — the caller SKIPS those rows and
 * counts them rather than guessing a subject, because a wrong subject would
 * silently produce a wrong-scope cosine.
 */
const SUBJECT_ALIASES: Record<string, string> = {
  math: 'math', maths: 'math', mathematics: 'math', ganit: 'math',
  science: 'science', vigyan: 'science',
  physics: 'physics', chemistry: 'chemistry', biology: 'biology',
  english: 'english', hindi: 'hindi',
  social_science: 'social_science', 'social science': 'social_science',
  socialscience: 'social_science', sst: 'social_science', 'social studies': 'social_science',
  history: 'social_science', geography: 'social_science', civics: 'social_science',
  economics: 'economics', accountancy: 'accountancy',
  business_studies: 'business_studies', 'business studies': 'business_studies',
  computer_science: 'computer_science', 'computer science': 'computer_science',
};

export function normalizeSubject(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const k = raw.trim().toLowerCase().replace(/[-\s]+/g, ' ');
  return SUBJECT_ALIASES[k] ?? SUBJECT_ALIASES[k.replace(/ /g, '_')] ?? null;
}

const VALID_GRADES = new Set(['6', '7', '8', '9', '10', '11', '12']);

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Load distinct historical user queries with their retrieval scope.
 *
 * Scope resolution order (first hit wins, recorded in `scopeSource`):
 *   1. `foxy_sessions` row that owns the message (grade / subject / chapter).
 *      This is the scope the student's session actually carried.
 *   2. `grounded_ai_traces` matched on `query_hash` — the scope the pipeline
 *      REALLY sent to retrieval for that exact query. Authoritative when present.
 *   3. `students.grade` for the grade only (subject still has to come from 1|2).
 * A query with no resolvable subject is SKIPPED and counted, never defaulted.
 *
 * All statements here are SELECTs. Nothing is written.
 */
async function loadQueries(
  sb: any,
  hashQuery: (q: string) => Promise<string>,
  opts: { limit: number | null; minYear: number | null },
): Promise<{ queries: SourceQuery[]; skippedNoScope: number; rawRows: number }> {
  const PAGE = 1000;
  const rows: Array<{ content: string; session_id: string; student_id: string; created_at: string }> = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb
      .from('foxy_chat_messages')
      .select('content, session_id, student_id, created_at')
      .eq('role', 'user')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (opts.minYear !== null) q = q.gte('created_at', `${opts.minYear}-01-01T00:00:00Z`);
    const { data, error } = await q;
    if (error) throw new Error(`foxy_chat_messages read failed: ${error.message ?? String(error)}`);
    const page = (data ?? []) as typeof rows;
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  // Session scope lookup.
  const sessionIds = [...new Set(rows.map((r) => r.session_id).filter(Boolean))];
  const sessions = new Map<string, { grade: string | null; subject: string | null; chapter: string | null }>();
  for (let i = 0; i < sessionIds.length; i += 500) {
    const { data, error } = await sb
      .from('foxy_sessions')
      .select('id, grade, subject, chapter')
      .in('id', sessionIds.slice(i, i + 500));
    if (error) throw new Error(`foxy_sessions read failed: ${error.message ?? String(error)}`);
    for (const s of (data ?? []) as any[]) {
      sessions.set(s.id, { grade: s.grade ?? null, subject: s.subject ?? null, chapter: s.chapter ?? null });
    }
  }

  // Student grade fallback (grade ONLY — no other student column is read, and
  // student_id never reaches the artifact).
  const studentIds = [...new Set(rows.map((r) => r.student_id).filter(Boolean))];
  const studentGrade = new Map<string, string | null>();
  for (let i = 0; i < studentIds.length; i += 500) {
    const { data, error } = await sb
      .from('students')
      .select('id, grade')
      .in('id', studentIds.slice(i, i + 500));
    if (error) throw new Error(`students read failed: ${error.message ?? String(error)}`);
    for (const s of (data ?? []) as any[]) studentGrade.set(s.id, s.grade ?? null);
  }

  // Trace scope by query_hash — the scope retrieval actually ran under.
  const { data: traceRows, error: traceErr } = await sb
    .from('grounded_ai_traces')
    .select('query_hash, grade, subject_code, chapter_number')
    .not('subject_code', 'is', null)
    .limit(20000);
  if (traceErr) throw new Error(`grounded_ai_traces read failed: ${traceErr.message ?? String(traceErr)}`);
  const traceScope = new Map<string, { grade: string | null; subject: string | null; chapter: number | null }>();
  for (const t of (traceRows ?? []) as any[]) {
    if (!traceScope.has(t.query_hash)) {
      traceScope.set(t.query_hash, {
        grade: t.grade ?? null,
        subject: t.subject_code ?? null,
        chapter: typeof t.chapter_number === 'number' ? t.chapter_number : null,
      });
    }
  }

  const byKey = new Map<string, SourceQuery>();
  let skippedNoScope = 0;

  for (const r of rows) {
    const text = (r.content ?? '').trim();
    if (text.length === 0) continue;
    const key = normalizeForDedupe(text);
    const existing = byKey.get(key);
    if (existing) {
      existing.occurrences += 1;
      continue;
    }

    const queryHash = await hashQuery(text);
    const sess = sessions.get(r.session_id);
    const trace = traceScope.get(queryHash);

    let grade: string | null = null;
    let subject: string | null = null;
    let chapterNumber: number | null = null;
    let scopeSource: SourceQuery['scopeSource'] = 'none';

    const sessSubject = normalizeSubject(sess?.subject ?? null);
    if (sessSubject && VALID_GRADES.has(String(sess?.grade ?? ''))) {
      grade = String(sess?.grade);
      subject = sessSubject;
      chapterNumber = parseChapterNumber(sess?.chapter ?? null);
      scopeSource = 'session';
    } else if (trace && normalizeSubject(trace.subject) && VALID_GRADES.has(String(trace.grade ?? ''))) {
      grade = String(trace.grade);
      subject = normalizeSubject(trace.subject);
      chapterNumber = trace.chapter;
      scopeSource = 'trace';
    } else if (sessSubject && VALID_GRADES.has(String(studentGrade.get(r.student_id) ?? ''))) {
      grade = String(studentGrade.get(r.student_id));
      subject = sessSubject;
      chapterNumber = parseChapterNumber(sess?.chapter ?? null);
      scopeSource = 'student';
    }

    if (!grade || !subject) {
      skippedNoScope += 1;
      continue;
    }

    byKey.set(key, {
      normKey: key,
      text,
      queryHash,
      occurrences: 1,
      grade,
      subject,
      chapterNumber,
      scopeSource,
      register: classifyRegister(text),
    });
  }

  let queries = [...byKey.values()];
  if (opts.limit !== null) queries = queries.slice(0, opts.limit);
  return { queries, skippedNoScope, rawRows: rows.length };
}

/**
 * Local copy of the chapter-string parser. Mirrors
 * packages/lib/src/foxy/chapter-parser.ts::parseFoxyChapterNumber — duplicated
 * rather than imported because that module lives behind the `@alfanumrik/lib`
 * path alias, which only resolves inside apps/host's tsconfig, and this script
 * runs from the repo root. Keep the two in sync if the format changes.
 */
export function parseChapterNumber(chapter: string | null): number | null {
  if (!chapter) return null;
  const m = chapter.trim().match(/^(?:chapter\s+|ch\.?\s+)?(\d{1,3})\b/i);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ─── Replay record ───────────────────────────────────────────────────────────

interface ReplayRecord {
  run_id: string;
  /** sha256:… over the production-normalized query. Joins to grounded_ai_traces. */
  query_hash: string;
  /** Redacted preview via the production redactPreview(). Never raw PII. */
  query_preview: string;
  query_chars: number;
  grade: string;
  grade_band: string;
  subject: string;
  chapter_number: number | null;
  scope_source: string;
  register: Register;
  occurrences: number;
  lane: Lane;
  pipeline_path: PipelinePath;
  mode: Mode;
  /** ABSOLUTE cosine of the rank-1 chunk. null = no relevance evidence. */
  cosine_top1: number | null;
  /** Mean absolute cosine over the top-3 chunks that carried one. */
  cosine_top3_avg: number | null;
  /** Every non-null cosine in the returned set, in served order. */
  cosine_all: Array<number | null>;
  /** Voyage rerank-2 score of the rank-1 chunk (stream path / strict only). */
  rerank_top1: number | null;
  /** ORDERING STATISTIC (RRF), not relevance. Kept for the v1 comparison. */
  rrf_top1: number | null;
  rrf_top3_avg: number | null;
  chunk_count: number;
  scope_drops: number;
  reranked: boolean;
  /** Shadow confidence, recomputed here by the REAL confidence-v2 module. */
  confidence_v2: number | null;
  confidence_v2_source: string;
  signal_coverage: number | null;
  embedding_ok: boolean;
  latency_ms: number;
  error: string | null;
}

// ─── Percentiles / summary ───────────────────────────────────────────────────

const PERCENTILES = [5, 10, 25, 50, 75, 90, 95] as const;

/** Nearest-rank percentile on a pre-sorted ascending array. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

interface Distribution {
  n: number;
  n_null_signal: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  percentiles: Record<string, number | null>;
}

function distributionOf(values: Array<number | null>): Distribution {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const sorted = [...nums].sort((a, b) => a - b);
  const pct: Record<string, number | null> = {};
  for (const p of PERCENTILES) pct[`p${p}`] = percentile(sorted, p);
  return {
    n: nums.length,
    n_null_signal: values.length - nums.length,
    min: sorted.length > 0 ? sorted[0] : null,
    max: sorted.length > 0 ? sorted[sorted.length - 1] : null,
    mean: nums.length > 0 ? nums.reduce((s, v) => s + v, 0) / nums.length : null,
    percentiles: pct,
  };
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

function buildSummary(cli: Cli, records: ReplayRecord[], meta: Record<string, unknown>) {
  const byPath = groupBy(records, (r) => r.pipeline_path);
  const perPath: Record<string, unknown> = {};

  for (const [path, recs] of byPath) {
    const ok = recs.filter((r) => r.error === null);
    const cos = ok.map((r) => r.cosine_top1);
    perPath[path] = {
      n_queries: recs.length,
      n_errors: recs.length - ok.length,
      n_zero_chunk: ok.filter((r) => r.chunk_count === 0).length,
      reranked_fraction: ok.length > 0 ? ok.filter((r) => r.reranked).length / ok.length : null,
      confidence_v2_source_counts: countBy(ok, (r) => r.confidence_v2_source),
      cosine_top1: distributionOf(cos),
      cosine_top3_avg: distributionOf(ok.map((r) => r.cosine_top3_avg)),
      rerank_top1: distributionOf(ok.map((r) => r.rerank_top1)),
      rrf_top1: distributionOf(ok.map((r) => r.rrf_top1)),
      confidence_v2: distributionOf(ok.map((r) => r.confidence_v2)),
      by_grade_band: Object.fromEntries(
        [...groupBy(ok, (r) => r.grade_band)].map(([k, v]) => [
          k,
          { n: v.length, cosine_top1: distributionOf(v.map((r) => r.cosine_top1)) },
        ]),
      ),
      by_register: Object.fromEntries(
        [...groupBy(ok, (r) => r.register)].map(([k, v]) => [
          k,
          { n: v.length, cosine_top1: distributionOf(v.map((r) => r.cosine_top1)) },
        ]),
      ),
      by_subject: Object.fromEntries(
        [...groupBy(ok, (r) => r.subject)].map(([k, v]) => [
          k,
          { n: v.length, cosine_top1: distributionOf(v.map((r) => r.cosine_top1)) },
        ]),
      ),
    };
  }

  const exercised = [...byPath.keys()].sort();
  return {
    run_id: cli.runId,
    generated_at: new Date().toISOString(),
    harness: 'scripts/rag/replay-cosine-distribution.ts',
    config: {
      lane: cli.lane,
      path_selection: cli.path,
      mode: cli.mode,
      match_count: cli.matchCount,
      limit: cli.limit,
      min_year: cli.minYear,
      delay_ms: cli.delayMs,
    },
    ...meta,
    // ── Interpretation guards. These are statements of fact about the run,
    //    not conclusions. No threshold is derived anywhere in this artifact.
    caveats: {
      threshold_derivation:
        'NO THRESHOLD IS DERIVED OR IMPLIED BY THIS ARTIFACT. It reports a distribution only. ' +
        'Threshold selection is assessment-owned and requires CEO approval.',
      paths_exercised: exercised,
      pooling_warning:
        exercised.length < 2
          ? `ONLY THE '${exercised[0] ?? 'none'}' PIPELINE PATH WAS EXERCISED. The other path was NOT ` +
            'measured by this run; do not generalise these numbers to it. Re-run with --path both.'
          : 'Both pipeline paths were exercised and are reported SEPARATELY. They must NOT be pooled: ' +
            'pipeline.ts disables rerank in soft mode (so confidence_v2_source=cosine) while ' +
            'pipeline-stream.ts reranks (source=rerank), and rerank scores and absolute cosines are ' +
            'different measurement scales. pipeline.ts also normalizes RRF by RRF_THEORETICAL_MAX ' +
            'before confidence v1 while pipeline-stream.ts feeds it RAW.',
      scale_warning:
        'cosine_top1 (absolute cosine, [0,1]) and rerank_top1 (Voyage cross-encoder score) are ' +
        'DIFFERENT SCALES and are reported in separate blocks. Never pool them. See confidence-v2.ts.',
      null_semantics:
        'A null cosine means "no relevance evidence for this row" (FTS-recovered tier-1 rows over ' +
        'unembedded chunks, all of tier 2 and tier 3). Nulls are EXCLUDED from percentiles and ' +
        'counted separately as n_null_signal — they are never coerced to 0.',
      corpus_bias:
        'The replay corpus is historical Foxy chat traffic, which is itself shaped by whatever ' +
        'students found the product usable for. It is not a uniform sample of CBSE question space.',
    },
    by_pipeline_path: perPath,
  };
}

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// ─── Cost model ──────────────────────────────────────────────────────────────

function estimateCost(nQueries: number, paths: PipelinePath[]) {
  const embedTokens = nQueries * EST_TOKENS_PER_QUERY;
  const embedUsd = (embedTokens / 1_000_000) * VOYAGE_EMBED_USD_PER_MTOK;
  // The embedding is computed ONCE per query and reused across both pipeline
  // paths — the two paths differ only after retrieval, so re-embedding would be
  // waste. Rerank, however, is per-path.
  const rerankPaths = paths.filter((p) => p === 'stream').length;
  const candidatesPerRerank = 30; // pipeline-stream.ts RERANK_INITIAL_FETCH
  const rerankTokens = nQueries * rerankPaths * candidatesPerRerank * EST_TOKENS_PER_CHUNK;
  const rerankUsd = (rerankTokens / 1_000_000) * VOYAGE_RERANK_USD_PER_MTOK;
  return {
    embedding_calls: nQueries,
    embedding_tokens_est: embedTokens,
    embedding_usd_est: embedUsd,
    rerank_calls: nQueries * rerankPaths,
    rerank_tokens_est: rerankTokens,
    rerank_usd_est: rerankUsd,
    total_usd_est: embedUsd + rerankUsd,
    anthropic_calls: 0,
  };
}

// ─── Dry run ─────────────────────────────────────────────────────────────────

function printDryRun(cli: Cli): void {
  const paths = pathsFor(cli.path);
  const n = cli.limit ?? CORPUS_DISTINCT_ESTIMATE;
  const cost = estimateCost(n, paths);
  const outDir = cli.outDir;

  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log(' COSINE DISTRIBUTION REPLAY — DRY RUN (no network, no credentials used)');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(' CONFIG');
  console.log(`   run id           : ${cli.runId}`);
  console.log(`   lane             : ${cli.lane}`);
  console.log(`   pipeline path(s) : ${paths.join(', ')}`);
  console.log(`   grounded mode    : ${cli.mode}`);
  console.log(`   match_count      : ${cli.matchCount}   (live Foxy default = ${DEFAULT_MATCH_COUNT})`);
  console.log(`   delay between    : ${cli.delayMs} ms`);
  console.log(`   limit            : ${cli.limit ?? '(none — full corpus)'}`);
  console.log(`   min year         : ${cli.minYear ?? '(none)'}`);
  console.log(`   resume           : ${cli.resume}`);
  console.log('');
  console.log(' QUERY PLAN (all SELECTs; nothing is written by lane=direct)');
  console.log('   1. SELECT content, session_id, student_id, created_at');
  console.log("        FROM foxy_chat_messages WHERE role='user'");
  console.log(cli.minYear ? `        AND created_at >= '${cli.minYear}-01-01T00:00:00Z'` : '        (no date filter)');
  console.log('        ORDER BY created_at ASC   [paged 1000/req]');
  console.log(`        expected ~${CORPUS_TOTAL_ESTIMATE} rows -> ~${CORPUS_DISTINCT_ESTIMATE} distinct after normalize+dedupe`);
  console.log('   2. SELECT id, grade, subject, chapter FROM foxy_sessions WHERE id IN (...)');
  console.log('        -> primary scope source');
  console.log('   3. SELECT query_hash, grade, subject_code, chapter_number FROM grounded_ai_traces');
  console.log('        -> fallback scope, matched on the production sha256 query hash');
  console.log('   4. SELECT id, grade FROM students WHERE id IN (...)');
  console.log('        -> last-resort GRADE ONLY. student_id never reaches the artifact.');
  console.log('   -> queries with no resolvable subject are SKIPPED AND COUNTED, never defaulted.');
  console.log('');
  console.log(' PER-QUERY EXECUTION');
  if (cli.lane === 'direct') {
    console.log('   a. generateEmbedding()  [grounded-answer/embedding.ts]  -> Voyage voyage-3, 1024-d');
    console.log('   b. retrieveChunks()     [grounded-answer/retrieval.ts]  -> RPC match_rag_chunks_ncert');
    console.log('        p_min_similarity = NCERT_MIN_COSINE_SIMILARITY (0.22), read-only SECURITY DEFINER');
    for (const p of paths) {
      if (p === 'nonstream') {
        console.log('   c. [nonstream] pipeline.ts step 6: rerankEnabled(soft)=false -> NO rerank, NO MMR');
        console.log('        over-fetch = match_count; chunks[0] is the RRF rank-1 row');
      } else {
        console.log('   c. [stream] pipeline-stream.ts step 6: rerankEnabled()=true -> Voyage rerank-2');
        console.log('        over-fetch = 30; chunks[0] is the CROSS-ENCODER rank-1 row; no MMR');
      }
    }
    console.log('   d. computeConfidenceV2() [grounded-answer/confidence-v2.ts] — the REAL module');
    console.log('   e. append record to the JSONL artifact + checkpoint');
    console.log('   NO Claude call. NO generation. NO INSERT/UPDATE/DELETE anywhere.');
  } else {
    console.log('   a. POST {supabase_url}/functions/v1/grounded-answer  with retrieve_only:true');
    console.log('        (same shape as apps/host/src/app/api/concept-engine/route.ts:404)');
    console.log('   ⚠️  b. THE DEPLOYED FUNCTION WRITES ONE grounded_ai_traces ROW AND ONE');
    console.log('          retrieval_traces ROW PER QUERY. That is the pipeline contract; there');
    console.log('          is no suppression flag. Rows are stamped caller=\'concept-engine\'.');
    console.log(`          Expected trace rows written: ~${n * paths.length}`);
  }
  console.log('');
  console.log(' ESTIMATED COST (Voyage list price at time of writing; ESTIMATE ONLY)');
  console.log(`   embedding calls  : ${cost.embedding_calls}  (~${cost.embedding_tokens_est.toLocaleString()} tokens)`);
  console.log(`   embedding cost   : ~$${cost.embedding_usd_est.toFixed(4)}`);
  console.log(`   rerank calls     : ${cost.rerank_calls}  (~${cost.rerank_tokens_est.toLocaleString()} doc tokens)`);
  console.log(`   rerank cost      : ~$${cost.rerank_usd_est.toFixed(4)}`);
  console.log(`   Anthropic calls  : ${cost.anthropic_calls}  (structurally zero — claude.ts is never imported)`);
  console.log(`   TOTAL            : ~$${cost.total_usd_est.toFixed(4)}`);
  console.log(`   wall clock (>=)  : ~${Math.round((n * paths.length * (cli.delayMs + 900)) / 60000)} min at ${cli.delayMs} ms delay`);
  console.log('');
  console.log(' ARTIFACTS');
  console.log(`   ${resolve(outDir, `${cli.runId}.records.jsonl`)}`);
  console.log(`   ${resolve(outDir, `${cli.runId}.summary.json`)}`);
  if (cli.csv) console.log(`   ${resolve(outDir, `${cli.runId}.records.csv`)}`);
  console.log(`   ${resolve(outDir, `${cli.runId}.checkpoint.jsonl`)}   (resume log)`);
  console.log('');
  console.log(' REQUIRED ENV FOR A REAL RUN (absent ones abort — there is no degraded mode)');
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VOYAGE_API_KEY']) {
    console.log(`   ${process.env[k] ? '[set]    ' : '[MISSING]'} ${k}`);
  }
  console.log('');
  console.log(' NOTE: this harness reports a DISTRIBUTION. It does not derive, suggest, or');
  console.log('       hard-code any confidence threshold — that is assessment + CEO territory.');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('');
}

// ─── Checkpointing ───────────────────────────────────────────────────────────

interface CheckpointEntry { query_hash: string; pipeline_path: string; }

function loadCheckpoint(file: string): Set<string> {
  const done = new Set<string>();
  if (!existsSync(file)) return done;
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as CheckpointEntry;
      if (e.query_hash && e.pipeline_path) done.add(`${e.query_hash}::${e.pipeline_path}`);
    } catch {
      // A torn final line from a killed process is expected; skip it.
    }
  }
  return done;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── CSV ─────────────────────────────────────────────────────────────────────

const CSV_COLUMNS: Array<keyof ReplayRecord> = [
  'run_id', 'query_hash', 'query_preview', 'query_chars', 'grade', 'grade_band', 'subject',
  'chapter_number', 'scope_source', 'register', 'occurrences', 'lane', 'pipeline_path', 'mode',
  'cosine_top1', 'cosine_top3_avg', 'rerank_top1', 'rrf_top1', 'rrf_top3_avg', 'chunk_count',
  'scope_drops', 'reranked', 'confidence_v2', 'confidence_v2_source', 'signal_coverage',
  'embedding_ok', 'latency_ms', 'error',
];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(records: ReplayRecord[]): string {
  const head = CSV_COLUMNS.join(',');
  const body = records.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(','));
  return [head, ...body].join('\n') + '\n';
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  let cli: Cli;
  try {
    cli = parseCli(process.argv.slice(2));
  } catch (e) {
    console.error(`[replay-cosine] bad arguments: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  if (cli.dryRun) {
    printDryRun(cli);
    return 0;
  }

  if (cli.lane === 'edge' && !cli.edgeAck) {
    console.error('');
    console.error('[replay-cosine] REFUSING TO RUN --lane edge without acknowledgement.');
    console.error('  The deployed grounded-answer function writes ONE grounded_ai_traces row and');
    console.error('  ONE retrieval_traces row per query, even with retrieve_only:true. That write is');
    console.error('  the pipeline contract (pipeline.ts:1252 -> finalizeGrounded) and cannot be');
    console.error('  suppressed by any request field, so no --no-trace guard is possible.');
    console.error('  If you accept writing those rows to production, re-run with:');
    console.error('    --i-understand-edge-lane-writes-traces');
    console.error('  Otherwise use the default --lane direct, which writes nothing.');
    console.error('');
    return 2;
  }

  let creds: Creds;
  try {
    creds = requireCreds();
  } catch (e) {
    console.error(`[replay-cosine] ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  installDenoEnvShim();

  const paths = pathsFor(cli.path);
  mkdirSync(cli.outDir, { recursive: true });
  const recordsPath = resolve(cli.outDir, `${cli.runId}.records.jsonl`);
  const summaryPath = resolve(cli.outDir, `${cli.runId}.summary.json`);
  const csvPath = resolve(cli.outDir, `${cli.runId}.records.csv`);
  const checkpointPath = resolve(cli.outDir, `${cli.runId}.checkpoint.jsonl`);

  // Dynamic imports AFTER the Deno shim is installed — see installDenoEnvShim.
  const { createClient } = await import('@supabase/supabase-js');
  const { generateEmbedding } = await import('../../supabase/functions/grounded-answer/embedding.ts');
  const { retrieveChunks } = await import('../../supabase/functions/grounded-answer/retrieval.ts');
  const { rerankDocuments } = await import('../../supabase/functions/_shared/reranking.ts');
  const { applyMMR } = await import('../../supabase/functions/_shared/rag/mmr.ts');
  const { computeConfidenceV2, coverageOrNull } = await import(
    '../../supabase/functions/grounded-answer/confidence-v2.ts'
  );
  const { isMMRDiversityEnabled } = await import('../../supabase/functions/grounded-answer/_mmr-flag.ts');
  const { hashQuery, redactPreview } = await import('../../supabase/functions/grounded-answer/trace.ts');
  const { SOFT_MIN_SIMILARITY, STRICT_MIN_SIMILARITY } = await import(
    '../../supabase/functions/grounded-answer/config.ts'
  );

  const minSimilarity = cli.mode === 'strict' ? STRICT_MIN_SIMILARITY : SOFT_MIN_SIMILARITY;
  const sb = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false } });

  console.log(`[replay-cosine] run_id=${cli.runId} lane=${cli.lane} paths=${paths.join('+')} mode=${cli.mode}`);
  console.log('[replay-cosine] loading historical queries (SELECT only)…');
  const { queries, skippedNoScope, rawRows } = await loadQueries(sb, hashQuery, {
    limit: cli.limit,
    minYear: cli.minYear,
  });
  console.log(
    `[replay-cosine] ${rawRows} raw user messages -> ${queries.length} distinct with resolvable scope ` +
      `(${skippedNoScope} skipped: no resolvable grade+subject)`,
  );
  if (queries.length === 0) {
    console.error('[replay-cosine] no replayable queries. Aborting rather than writing an empty artifact.');
    return 1;
  }

  const done = cli.resume ? loadCheckpoint(checkpointPath) : new Set<string>();
  if (cli.resume) console.log(`[replay-cosine] resume: ${done.size} (query,path) pairs already complete`);

  // Cost is quoted for the work THIS invocation will actually do. Resumed
  // (query,path) pairs are skipped before the embedding call, so they cost
  // nothing and must not be billed twice in the estimate.
  const remaining = queries.filter((q) => paths.some((p) => !done.has(`${q.queryHash}::${p}`)));
  const cost = estimateCost(remaining.length, paths);
  console.log(
    `[replay-cosine] estimated spend for this invocation ~$${cost.total_usd_est.toFixed(4)} ` +
      `(${cost.embedding_calls} embeddings, up to ${cost.rerank_calls} reranks, 0 Anthropic calls)`,
  );

  const records: ReplayRecord[] = [];
  let mmrEnabled = false;
  if (cli.mode === 'strict') mmrEnabled = await isMMRDiversityEnabled(sb);

  let i = 0;
  for (const q of queries) {
    i += 1;
    const outstanding = paths.filter((p) => !done.has(`${q.queryHash}::${p}`));
    if (outstanding.length === 0) continue;

    // ONE embedding per query, reused across paths. Mirrors generateEmbedding's
    // live call site (pipeline.ts:1089) including the timeout budget.
    const t0 = Date.now();
    let embedding: number[] | null = null;
    try {
      embedding = await generateEmbedding(q.text, 12_000, creds.voyageKey);
    } catch (e) {
      console.warn(`[replay-cosine] embedding threw for ${q.queryHash}: ${String(e)}`);
    }

    for (const path of outstanding) {
      const started = Date.now();
      const rec: ReplayRecord = {
        run_id: cli.runId,
        query_hash: q.queryHash,
        query_preview: redactPreview(q.text),
        query_chars: q.text.length,
        grade: q.grade!,
        grade_band: gradeBand(q.grade),
        subject: q.subject!,
        chapter_number: q.chapterNumber,
        scope_source: q.scopeSource,
        register: q.register,
        occurrences: q.occurrences,
        lane: cli.lane,
        pipeline_path: path,
        mode: cli.mode,
        cosine_top1: null,
        cosine_top3_avg: null,
        cosine_all: [],
        rerank_top1: null,
        rrf_top1: null,
        rrf_top3_avg: null,
        chunk_count: 0,
        scope_drops: 0,
        reranked: false,
        confidence_v2: null,
        confidence_v2_source: 'none',
        signal_coverage: null,
        embedding_ok: embedding !== null,
        latency_ms: 0,
        error: null,
      };

      try {
        if (cli.lane === 'edge') {
          await runEdgeLane(rec, q, cli, creds, path);
        } else {
          await runDirectLane(rec, q, cli, creds, path, {
            embedding,
            minSimilarity,
            mmrEnabled,
            sb,
            retrieveChunks,
            rerankDocuments,
            applyMMR,
            computeConfidenceV2,
            coverageOrNull,
          });
        }
      } catch (e) {
        rec.error = e instanceof Error ? e.message : String(e);
      }
      rec.latency_ms = Date.now() - started;

      records.push(rec);
      appendFileSync(recordsPath, JSON.stringify(rec) + '\n', 'utf-8');
      appendFileSync(
        checkpointPath,
        JSON.stringify({ query_hash: q.queryHash, pipeline_path: path } satisfies CheckpointEntry) + '\n',
        'utf-8',
      );
      if (cli.delayMs > 0) await sleep(cli.delayMs);
    }

    if (i % 25 === 0) {
      console.log(`[replay-cosine] ${i}/${queries.length} queries (${Date.now() - t0}ms last)`);
    }
  }

  // Merge any pre-existing records from an earlier partial run so the summary
  // covers the whole run, not just this invocation.
  const allRecords = cli.resume ? readAllRecords(recordsPath) : records;
  const summary = buildSummary(cli, allRecords, {
    corpus: {
      raw_user_messages: rawRows,
      distinct_replayable: queries.length,
      skipped_no_resolvable_scope: skippedNoScope,
    },
    cost_estimate: cost,
    production_writes:
      cli.lane === 'edge'
        ? `LANE=edge: this run wrote ~${allRecords.length} grounded_ai_traces rows (caller='concept-engine') ` +
          'and ~the same number of retrieval_traces rows to PRODUCTION.'
        : 'LANE=direct: this run performed SELECT-only production I/O. Zero rows written to any table.',
  });
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf-8');
  if (cli.csv) writeFileSync(csvPath, toCsv(allRecords), 'utf-8');

  printSummary(summary);
  console.log(`[replay-cosine] records : ${recordsPath}`);
  console.log(`[replay-cosine] summary : ${summaryPath}`);
  if (cli.csv) console.log(`[replay-cosine] csv     : ${csvPath}`);
  return 0;
}

function readAllRecords(file: string): ReplayRecord[] {
  if (!existsSync(file)) return [];
  const out: ReplayRecord[] = [];
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as ReplayRecord);
    } catch {
      /* torn line from a killed process */
    }
  }
  return out;
}

// ─── LANE: direct (default, zero writes) ─────────────────────────────────────

/**
 * Reproduce ONE pipeline's retrieval stage exactly, using the real modules.
 *
 * nonstream -> supabase/functions/grounded-answer/pipeline.ts step 6
 * stream    -> supabase/functions/grounded-answer/pipeline-stream.ts step 6
 *
 * The constants below are copied from those files with the line references
 * attached. If either pipeline changes its over-fetch or rerank gating, this
 * function must be updated in lockstep or the artifact silently stops
 * describing production.
 */
export async function runDirectLane(
  rec: ReplayRecord,
  q: SourceQuery,
  cli: Cli,
  _creds: Creds,
  path: PipelinePath,
  deps: {
    embedding: number[] | null;
    minSimilarity: number;
    mmrEnabled: boolean;
    sb: any;
    retrieveChunks: any;
    rerankDocuments: any;
    applyMMR: any;
    computeConfidenceV2: any;
    coverageOrNull: any;
  },
): Promise<void> {
  // pipeline.ts:189 RERANK_INITIAL_FETCH = 40 ; pipeline-stream.ts:113 = 30.
  const RERANK_INITIAL_FETCH = path === 'stream' ? 30 : 40;
  // pipeline.ts:191 rerankEnabled(mode) returns FALSE for soft mode.
  // pipeline-stream.ts:158 rerankEnabled() has NO mode check.
  const rerankOn =
    path === 'stream'
      ? (process.env.FOXY_RERANK_ENABLED ?? 'true').toLowerCase() !== 'false'
      : cli.mode !== 'soft' && (process.env.FOXY_RERANK_ENABLED ?? 'true').toLowerCase() !== 'false';

  const overFetchCount = rerankOn ? Math.max(RERANK_INITIAL_FETCH, cli.matchCount) : cli.matchCount;

  const { chunks: rawChunks, scopeDrops } = await deps.retrieveChunks(deps.sb, {
    query: q.text,
    embedding: deps.embedding,
    scope: {
      grade: q.grade,
      subject_code: q.subject,
      chapter_number: q.chapterNumber,
      chapter_title: null,
    },
    matchCount: overFetchCount,
    minSimilarity: deps.minSimilarity,
  });

  let chunks = rawChunks;
  let reranked = false;
  if (rerankOn && rawChunks.length > cli.matchCount) {
    const rr = await deps.rerankDocuments(
      { query: q.text, documents: rawChunks.map((c: any) => c.content) },
      cli.matchCount,
    );
    if (rr.reranked) {
      rr.rankedIndices.forEach((idx: number, pos: number) => {
        const c = rawChunks[idx];
        if (c) c.rerank_score = rr.rankedScores[pos] ?? null;
      });
      chunks = rr.rankedIndices.map((i: number) => rawChunks[i]).filter(Boolean);
      reranked = true;
    } else {
      chunks = rawChunks.slice(0, cli.matchCount);
    }
  } else {
    chunks = rawChunks.slice(0, cli.matchCount);
  }

  // MMR exists ONLY on the non-stream path (pipeline.ts:1163). pipeline-stream.ts
  // has no MMR step at all. In soft mode the non-stream path never reranks, so
  // this branch is unreachable there — it matters only for --mode strict.
  if (path === 'nonstream' && reranked && chunks.length > 1 && deps.mmrEnabled) {
    chunks = deps.applyMMR(chunks, 0.7);
  }

  // Digital-twin transfer retrieval (ff_digital_twin_v1) is deliberately NOT
  // reproduced: it is default-OFF in production and only ADDS cross-subject
  // chunks. If that flag is ever turned on, this harness under-reports the
  // served set and must be extended.

  const top = chunks[0];
  const cosines: Array<number | null> = chunks.map((c: any) =>
    typeof c.cosine_similarity === 'number' && Number.isFinite(c.cosine_similarity)
      ? c.cosine_similarity
      : null,
  );
  const top3Cos = cosines.slice(0, 3).filter((v): v is number => v !== null);

  rec.chunk_count = chunks.length;
  rec.scope_drops = scopeDrops;
  rec.reranked = reranked;
  rec.cosine_all = cosines;
  rec.cosine_top1 = cosines.length > 0 ? cosines[0] : null;
  rec.cosine_top3_avg = top3Cos.length > 0 ? top3Cos.reduce((s, v) => s + v, 0) / top3Cos.length : null;
  rec.rerank_top1 =
    top && typeof top.rerank_score === 'number' && Number.isFinite(top.rerank_score) ? top.rerank_score : null;
  rec.rrf_top1 = top && typeof top.similarity === 'number' ? top.similarity : null;
  rec.rrf_top3_avg =
    chunks.length > 0
      ? chunks.slice(0, 3).reduce((s: number, c: any) => s + (c.similarity ?? 0), 0) / Math.min(3, chunks.length)
      : null;

  // The REAL shadow module, with the same arguments both pipelines pass
  // (groundingCheckPassRatio = 1 in soft / retrieve_only).
  const v2 = deps.computeConfidenceV2({
    chunks,
    matchCountTarget: cli.matchCount,
    groundingCheckPassRatio: 1,
  });
  rec.confidence_v2 = v2.confidence_v2;
  rec.confidence_v2_source = v2.confidence_v2_source;
  rec.signal_coverage = deps.coverageOrNull(v2);
}

// ─── LANE: edge (opt-in; WRITES TRACE ROWS) ──────────────────────────────────

/**
 * POST retrieve_only:true to the DEPLOYED grounded-answer function, mirroring
 * apps/host/src/app/api/concept-engine/route.ts:404.
 *
 * ⚠️  EVERY CALL WRITES ONE grounded_ai_traces ROW + ONE retrieval_traces ROW.
 *
 * The response `citations[].similarity` is the RRF ORDERING STATISTIC, not a
 * cosine — the Citation shape (pipeline.ts buildCitationsFromAllChunks) does
 * not carry `cosine_similarity` at all. So this lane CANNOT observe the cosine
 * directly; it can only confirm the deployed function's end-to-end behaviour
 * and leave the cosine to be read back out of the trace row afterwards. That is
 * a second reason lane=direct is the default: it is the only lane that actually
 * measures what this harness exists to measure.
 */
async function runEdgeLane(
  rec: ReplayRecord,
  q: SourceQuery,
  cli: Cli,
  creds: Creds,
  path: PipelinePath,
): Promise<void> {
  const url = `${creds.url.replace(/\/$/, '')}/functions/v1/grounded-answer${path === 'stream' ? '?stream=1' : ''}`;
  const body = {
    caller: 'concept-engine',
    student_id: null,
    query: q.text,
    scope: {
      board: 'CBSE',
      grade: q.grade,
      subject_code: q.subject,
      chapter_number: q.chapterNumber,
      chapter_title: null,
    },
    mode: cli.mode,
    generation: {
      model_preference: 'auto',
      max_tokens: 1,
      temperature: 0,
      // Unused when retrieve_only=true but the validator requires a registered
      // template name. Same placeholder concept-engine uses.
      system_prompt_template: 'foxy_tutor_v1',
      template_variables: {},
    },
    retrieval: { match_count: cli.matchCount },
    retrieve_only: true,
    timeout_ms: 20_000,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.serviceKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    rec.error = `edge HTTP ${res.status}`;
    return;
  }
  const json = (await res.json()) as any;
  const citations = Array.isArray(json?.citations) ? json.citations : [];
  rec.chunk_count = citations.length;
  rec.rrf_top1 = citations.length > 0 && typeof citations[0].similarity === 'number' ? citations[0].similarity : null;
  rec.rrf_top3_avg =
    citations.length > 0
      ? citations.slice(0, 3).reduce((s: number, c: any) => s + (c.similarity ?? 0), 0) /
        Math.min(3, citations.length)
      : null;
  // Cosine is NOT in the Citation shape — see the doc comment above.
  rec.cosine_top1 = null;
  rec.cosine_top3_avg = null;
  rec.error =
    citations.length === 0
      ? `abstain:${String(json?.abstain_reason ?? 'unknown')}`
      : 'edge_lane_cannot_observe_cosine (read grounded_ai_traces.top_cosine_similarity instead)';
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Console summary ─────────────────────────────────────────────────────────

function printSummary(summary: ReturnType<typeof buildSummary>): void {
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log(' COSINE DISTRIBUTION — SUMMARY');
  console.log('════════════════════════════════════════════════════════════════════════');
  const paths = summary.by_pipeline_path as Record<string, any>;
  for (const [path, block] of Object.entries(paths)) {
    console.log('');
    console.log(` PIPELINE PATH: ${path}   (n=${block.n_queries}, errors=${block.n_errors}, zero-chunk=${block.n_zero_chunk})`);
    console.log(`   confidence_v2_source: ${JSON.stringify(block.confidence_v2_source_counts)}`);
    printDist('   cosine_top1     ', block.cosine_top1);
    printDist('   cosine_top3_avg ', block.cosine_top3_avg);
    printDist('   rerank_top1     ', block.rerank_top1);
    console.log('   — by grade band —');
    for (const [band, b] of Object.entries(block.by_grade_band as Record<string, any>)) {
      printDist(`   ${band.padEnd(16)}`, b.cosine_top1);
    }
    console.log('   — by language register —');
    for (const [reg, b] of Object.entries(block.by_register as Record<string, any>)) {
      printDist(`   ${reg.padEnd(16)}`, b.cosine_top1);
    }
  }
  console.log('');
  console.log(` paths exercised : ${(summary.caveats as any).paths_exercised.join(', ')}`);
  console.log(` ${(summary.caveats as any).pooling_warning}`);
  console.log(` ${(summary as any).production_writes}`);
  console.log('');
  console.log(' NO THRESHOLD IS DERIVED HERE. Distribution only — assessment + CEO decide.');
  console.log('════════════════════════════════════════════════════════════════════════');
}

function printDist(label: string, d: Distribution | undefined): void {
  if (!d) return;
  const f = (v: number | null) => (v === null ? '  n/a ' : v.toFixed(4));
  console.log(
    `${label} n=${String(d.n).padStart(5)} null=${String(d.n_null_signal).padStart(4)} ` +
      `p5=${f(d.percentiles.p5)} p10=${f(d.percentiles.p10)} p25=${f(d.percentiles.p25)} ` +
      `p50=${f(d.percentiles.p50)} p75=${f(d.percentiles.p75)} p90=${f(d.percentiles.p90)} ` +
      `p95=${f(d.percentiles.p95)}`,
  );
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error('[replay-cosine] fatal:', e instanceof Error ? (e.stack ?? e.message) : String(e));
      process.exit(2);
    });
}

export { main, estimateCost, distributionOf, buildSummary };
export type { ReplayRecord, SourceQuery, Cli };
