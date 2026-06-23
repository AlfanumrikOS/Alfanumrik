#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * scripts/ncert-ingestion/embed-chunks.ts
 *
 * Node.js (not Deno) standalone script.
 *
 * Generates Voyage embeddings for every rag_content_chunks row where
 * embedding IS NULL and is_active = true, then writes the embedding back.
 * Fully resumable: kill and re-run at any time — already-embedded rows
 * are never re-queried (they no longer satisfy `embedding IS NULL`).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/ncert-ingestion/embed-chunks.ts
 *   npx tsx --env-file=.env.local scripts/ncert-ingestion/embed-chunks.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/ncert-ingestion/embed-chunks.ts --grade 10
 *   npx tsx --env-file=.env.local scripts/ncert-ingestion/embed-chunks.ts --subject science
 *   npx tsx --env-file=.env.local scripts/ncert-ingestion/embed-chunks.ts --grade 10 --subject science --dry-run
 *
 * Environment variables required:
 *   NEXT_PUBLIC_SUPABASE_URL      — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY     — Service-role key (bypasses RLS for bulk update)
 *   VOYAGE_API_KEY                — Voyage AI API key (get one at dash.voyageai.com)
 *
 * Owner: ai-engineer
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ─── Constants ──────────────────────────────────────────────────────────────

const BATCH_SIZE = 128;        // Voyage max per request
const RATE_LIMIT_DELAY_MS = 200; // 200 ms between Voyage calls to respect rate limits
const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 2000]; // Retry waits: 1 s, then 2 s
const VOYAGE_MODEL = 'voyage-3';
const VOYAGE_DIMENSION = 1024;
const EMBEDDING_MODEL_LABEL = 'voyage-3';

// ─── Grade / Subject normalization maps ─────────────────────────────────────

const GRADE_TO_DB: Record<string, string> = {
  '6': 'Grade 6', '7': 'Grade 7', '8': 'Grade 8', '9': 'Grade 9',
  '10': 'Grade 10', '11': 'Grade 11', '12': 'Grade 12',
};

const SUBJECT_TO_DB: Record<string, string> = {
  'math': 'Mathematics', 'mathematics': 'Mathematics', 'maths': 'Mathematics',
  'science': 'Science', 'physics': 'Physics', 'chemistry': 'Chemistry',
  'biology': 'Biology', 'english': 'English', 'hindi': 'Hindi',
  'social_studies': 'Social Studies', 'social science': 'Social Studies',
  'social-science': 'Social Studies', 'economics': 'Economics',
  'accountancy': 'Accountancy', 'business_studies': 'Business Studies',
  'political_science': 'Political Science', 'history': 'History',
  'geography': 'Geography', 'computer_science': 'Computer Science',
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChunkRow {
  id: string;
  chunk_text: string;
  token_count: number | null;
}

interface CliArgs {
  dryRun: boolean;
  gradeFilter: string | null;  // normalized DB value e.g. "Grade 10"
  subjectFilter: string | null; // normalized DB value e.g. "Science"
}

interface RunStats {
  embeddedThisRun: number;
  errorsThisRun: number;
}

// ─── CLI arg parsing ─────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CliArgs {
  let dryRun = false;
  let gradeFilter: string | null = null;
  let subjectFilter: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--grade' && i + 1 < argv.length) {
      const raw = argv[++i];
      const normalized = GRADE_TO_DB[raw];
      if (!normalized) {
        console.error(`Unknown grade "${raw}". Valid values: 6, 7, 8, 9, 10, 11, 12`);
        process.exit(1);
      }
      gradeFilter = normalized;
    } else if (arg === '--subject' && i + 1 < argv.length) {
      const raw = argv[++i].toLowerCase();
      const normalized = SUBJECT_TO_DB[raw];
      if (!normalized) {
        console.error(
          `Unknown subject "${argv[i]}". Valid values: math, science, physics, chemistry, ` +
          `biology, english, hindi, social_studies, economics, accountancy, business_studies, ` +
          `political_science, history, geography, computer_science`,
        );
        process.exit(1);
      }
      subjectFilter = normalized;
    }
  }

  return { dryRun, gradeFilter, subjectFilter };
}

// ─── Voyage API ──────────────────────────────────────────────────────────────

async function callVoyageBatch(
  texts: string[],
  apiKey: string,
): Promise<number[][] | null> {
  let lastError: string = '';

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: VOYAGE_MODEL,
          input: texts,
          output_dimension: VOYAGE_DIMENSION,
        }),
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      await sleep(wait);
      continue;
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after');
      const waitSec = retryAfter ? parseInt(retryAfter, 10) : 10;
      const waitMs = isNaN(waitSec) ? 10_000 : waitSec * 1000;
      console.log(`\n  [rate-limit] 429 from Voyage — waiting ${waitMs / 1000}s (retry-after header)...`);
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      lastError = `HTTP ${res.status}: ${body.slice(0, 200)}`;
      const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      await sleep(wait);
      continue;
    }

    const body = await res.json();
    // body.data is an array ordered by index, each item has { index, embedding }
    const sorted = (body?.data ?? []).sort(
      (a: { index: number }, b: { index: number }) => a.index - b.index,
    );
    const embeddings: number[][] = sorted.map(
      (item: { embedding: number[] }) => item.embedding,
    );

    if (embeddings.length !== texts.length) {
      lastError = `Expected ${texts.length} embeddings, got ${embeddings.length}`;
      continue;
    }
    return embeddings;
  }

  console.error(`\n  [voyage-error] All ${MAX_RETRIES} attempts failed: ${lastError}`);
  return null;
}

// ─── Supabase helpers ────────────────────────────────────────────────────────

async function fetchPendingChunks(
  supabase: SupabaseClient,
  gradeFilter: string | null,
  subjectFilter: string | null,
): Promise<ChunkRow[]> {
  let query = supabase
    .from('rag_content_chunks')
    .select('id, chunk_text, token_count')
    .is('embedding', null)
    .eq('is_active', true);

  if (gradeFilter) query = query.eq('grade', gradeFilter);
  if (subjectFilter) query = query.eq('subject', subjectFilter);

  // No server-side limit — we page in memory in BATCH_SIZE windows.
  // The table is O(tens of thousands) rows so fetching all IDs upfront is fine.
  const { data, error } = await query;
  if (error) {
    console.error('Failed to query pending chunks:', error.message);
    process.exit(1);
  }
  return (data ?? []) as ChunkRow[];
}

async function countTotalEmbedded(
  supabase: SupabaseClient,
  gradeFilter: string | null,
  subjectFilter: string | null,
): Promise<number> {
  let query = supabase
    .from('rag_content_chunks')
    .select('id', { count: 'exact', head: true })
    .not('embedding', 'is', null)
    .eq('is_active', true);

  if (gradeFilter) query = query.eq('grade', gradeFilter);
  if (subjectFilter) query = query.eq('subject', subjectFilter);

  const { count, error } = await query;
  if (error) return 0;
  return count ?? 0;
}

async function updateRowWithEmbedding(
  supabase: SupabaseClient,
  id: string,
  embedding: number[],
): Promise<boolean> {
  const { error } = await supabase
    .from('rag_content_chunks')
    .update({
      embedding: embedding as unknown as string, // pgvector accepts number[] from JS client
      embedding_model: EMBEDDING_MODEL_LABEL,
      embedded_at: new Date().toISOString(),
    })
    .eq('id', id);

  return !error;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 chars
  return Math.ceil(text.length / 4);
}

// ─── Progress display ────────────────────────────────────────────────────────

function printProgress(done: number, total: number): void {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const line = `  Embedded this run: ${done}/${total} (${pct}%)`;
  process.stdout.write(`\r${line}    `);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // ── Env validation ───────────────────────────────────────────────────────
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY ?? '';

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    console.error('       Make sure .env.local is present and loaded.');
    process.exit(1);
  }

  if (!args.dryRun && !VOYAGE_API_KEY) {
    console.error('ERROR: VOYAGE_API_KEY is not set.');
    console.error('       Get a key at https://dash.voyageai.com');
    console.error('       Then add VOYAGE_API_KEY=pa-... to your .env.local');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Banner ───────────────────────────────────────────────────────────────
  console.log('');
  console.log('ALFANUMRIK — NCERT RAG Embedding Script');
  console.log('========================================');
  if (args.dryRun) console.log('  Mode:    DRY RUN (no Voyage calls, no DB writes)');
  if (args.gradeFilter) console.log(`  Grade:   ${args.gradeFilter}`);
  if (args.subjectFilter) console.log(`  Subject: ${args.subjectFilter}`);
  console.log(`  Model:   ${VOYAGE_MODEL} (${VOYAGE_DIMENSION}d)`);
  console.log(`  Batch:   ${BATCH_SIZE} chunks per Voyage request`);
  console.log('');

  // ── Fetch pending rows ───────────────────────────────────────────────────
  console.log('Querying rag_content_chunks WHERE embedding IS NULL AND is_active = true ...');
  const pending = await fetchPendingChunks(supabase, args.gradeFilter, args.subjectFilter);
  console.log(`  Found ${pending.length} chunks needing embeddings.`);

  if (args.dryRun) {
    // Dry-run summary
    const totalTokens = pending.reduce((sum, row) => {
      return sum + (row.token_count ?? estimateTokens(row.chunk_text));
    }, 0);
    const batchesNeeded = Math.ceil(pending.length / BATCH_SIZE);

    console.log('');
    console.log('DRY RUN SUMMARY:');
    console.log(`  Chunks pending:      ${pending.length}`);
    console.log(`  Estimated tokens:    ${totalTokens.toLocaleString()}`);
    console.log(`  Voyage batches:      ${batchesNeeded} (at ${BATCH_SIZE} chunks each)`);
    console.log(`  Estimated API calls: ${batchesNeeded}`);
    console.log('');
    console.log('Run without --dry-run to generate and store embeddings.');
    return;
  }

  if (pending.length === 0) {
    console.log('Nothing to embed — all active chunks already have embeddings.');
    await printFinalStatus(supabase, 0, 0, args.gradeFilter, args.subjectFilter);
    return;
  }

  // ── Embedding loop ───────────────────────────────────────────────────────
  const stats: RunStats = { embeddedThisRun: 0, errorsThisRun: 0 };
  const total = pending.length;

  console.log('');

  for (let offset = 0; offset < total; offset += BATCH_SIZE) {
    const batch = pending.slice(offset, offset + BATCH_SIZE);
    const texts = batch.map(row => row.chunk_text);

    // Call Voyage with the whole batch at once
    const embeddings = await callVoyageBatch(texts, VOYAGE_API_KEY);

    if (!embeddings) {
      // All retries exhausted for this batch — count all as errors
      stats.errorsThisRun += batch.length;
      printProgress(stats.embeddedThisRun, total);
      // Rate limit delay still applies before next batch
      await sleep(RATE_LIMIT_DELAY_MS);
      continue;
    }

    // Parallel update — all 128 rows in the batch update simultaneously
    const updateResults = await Promise.all(
      batch.map((row, i) => updateRowWithEmbedding(supabase, row.id, embeddings[i])),
    );

    for (const ok of updateResults) {
      if (ok) {
        stats.embeddedThisRun++;
      } else {
        stats.errorsThisRun++;
      }
    }

    printProgress(stats.embeddedThisRun, total);

    // Respect Voyage rate limits between batches
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  // Move past the progress line
  process.stdout.write('\n');

  await printFinalStatus(
    supabase,
    stats.embeddedThisRun,
    stats.errorsThisRun,
    args.gradeFilter,
    args.subjectFilter,
  );
}

async function printFinalStatus(
  supabase: SupabaseClient,
  embeddedThisRun: number,
  errorsThisRun: number,
  gradeFilter: string | null,
  subjectFilter: string | null,
): Promise<void> {
  const totalEmbedded = await countTotalEmbedded(supabase, gradeFilter, subjectFilter);

  // Re-query pending to find how many are still outstanding
  const stillPending = await fetchPendingChunks(supabase, gradeFilter, subjectFilter);
  const pendingCount = stillPending.length;

  console.log('');
  console.log('FINAL STATUS:');
  console.log(`   Embedded this run:  ${embeddedThisRun}`);
  console.log(`   Errors this run:    ${errorsThisRun}`);
  console.log(`   Total embedded:     ${totalEmbedded}${pendingCount === 0 ? ' (complete)' : ''}`);
  console.log(`   Still pending:      ${pendingCount}`);
  console.log('');

  if (pendingCount === 0 && errorsThisRun === 0) {
    console.log('ALL CHUNKS EMBEDDED. pgvector HNSW index is fully populated.');
    console.log('');
    console.log('Next steps:');
    console.log('  1. npm run ncert:validate');
    console.log('  2. Test Foxy tutor -- ask "What is photosynthesis?"');
    console.log('  3. npm run eval:rag:harness  (RAG quality harness)');
  } else if (pendingCount > 0) {
    console.log(`WARNING: ${pendingCount} chunks still have no embedding.`);
    if (errorsThisRun > 0) {
      console.log(`         ${errorsThisRun} errors occurred this run.`);
    }
    console.log('         Re-run this script to resume (already-embedded rows are skipped).');
  }
}

main().catch(err => {
  process.stdout.write('\n');
  console.error('FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
