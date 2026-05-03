#!/usr/bin/env tsx
/* eslint-disable no-console */
/* eslint-disable no-console */
/**
 * scripts/ingest-rag-pack.ts
 *
 * Phase 4.5 of Goal-Adaptive Learning Layers - Content Pack Ingestion CLI.
 *
 * Reads a JSONL pack file (header + entries), validates each entry against
 * src/lib/rag/pack-manifest.ts, generates Voyage embeddings, and inserts
 * the chunks into rag_content_chunks with the appropriate metadata.
 *
 * Usage:
 *   tsx scripts/ingest-rag-pack.ts --pack data/rag-packs/sample-pyq-board-pack-v0.jsonl [--dry-run]
 *
 * Behavior:
 *   - First line of the JSONL is the PackHeader (pack_id, pack_version, etc.).
 *   - Remaining lines are PackEntry records (one JSON object per line).
 *   - Each entry runs through validatePackEntry. Invalid entries are
 *     reported and skipped (never inserted).
 *   - For valid entries: generate Voyage embedding, insert to
 *     rag_content_chunks with pack_id, pack_version, provenance,
 *     source, and exam_relevance set per the manifest.
 *   - Idempotent at the (pack_id, pack_version, chunk_text) level: the
 *     script SELECTs first; if a chunk with the same triple already exists,
 *     it skips (counted as 'already_present').
 *   - --dry-run mode validates + computes embeddings but does NOT insert.
 *
 * Environment:
 *   NEXT_PUBLIC_SUPABASE_URL          (required)
 *   SUPABASE_SERVICE_ROLE_KEY         (required)
 *   VOYAGE_API_KEY                    (required for embedding)
 *
 * Output: a summary report printed to stdout, e.g.:
 *   Pack: cbse-board-pyq-math-grade10 v1
 *   Total entries: 5
 *   Valid:         5
 *   Already present: 0
 *   Inserted:      5
 *   Failed:        0
 *
 * Owner: ai-engineer
 * Reviewers: assessment (curriculum correctness), architect (DB safety),
 *            ops (operator runbook)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validatePackEntry,
  validatePackHeader,
  applyHeaderDefaults,
  type PackEntry,
  type PackHeader,
} from '../src/lib/rag/pack-manifest';

interface ScriptArgs {
  packPath: string;
  dryRun: boolean;
}

interface IngestionSummary {
  pack_id: string;
  pack_version: string;
  total: number;
  valid: number;
  alreadyPresent: number;
  inserted: number;
  failed: number;
  failures: Array<{ index: number; reason: string }>;
}

function parseArgs(argv: string[]): ScriptArgs {
  let packPath = '';
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pack' && i + 1 < argv.length) {
      packPath = argv[++i];
    } else if (a === '--dry-run') {
      dryRun = true;
    }
  }
  if (!packPath) {
    console.error('Usage: tsx scripts/ingest-rag-pack.ts --pack <path.jsonl> [--dry-run]');
    process.exit(2);
  }
  return { packPath, dryRun };
}

function readPackFile(path: string): { header: PackHeader; entries: PackEntry[] } {
  if (!existsSync(path)) {
    throw new Error('Pack file not found: ' + path);
  }
  const raw = readFileSync(path, 'utf8').trim();
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('Pack must have at least a header line + 1 entry');
  }
  const header = JSON.parse(lines[0]) as PackHeader;
  const entries = lines.slice(1).map((l) => JSON.parse(l) as PackEntry);
  return { header, entries };
}

async function generateVoyageEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'voyage-3',
        input: [text],
        output_dimension: 1024,
      }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

async function chunkAlreadyPresent(
  fetcher: (url: string, init?: RequestInit) => Promise<Response>,
  supabaseUrl: string,
  serviceKey: string,
  packId: string,
  packVersion: string,
  chunkText: string,
): Promise<boolean> {
  // Match on (pack_id, pack_version, chunk_text) - the natural idempotency key.
  const params = new URLSearchParams({
    pack_id: 'eq.' + packId,
    pack_version: 'eq.' + packVersion,
    chunk_text: 'eq.' + chunkText,
    select: 'id',
    limit: '1',
  });
  const res = await fetcher(supabaseUrl + '/rest/v1/rag_content_chunks?' + params.toString(), {
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
    },
  });
  if (!res.ok) return false;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function insertChunk(
  fetcher: (url: string, init?: RequestInit) => Promise<Response>,
  supabaseUrl: string,
  serviceKey: string,
  row: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string }> {
  const res = await fetcher(supabaseUrl + '/rest/v1/rag_content_chunks', {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, reason: 'HTTP ' + res.status + ': ' + body.slice(0, 200) };
  }
  return { ok: true };
}

async function ingest(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

  if (!args.dryRun) {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      process.exit(2);
    }
    if (!VOYAGE_KEY) {
      console.error('Missing VOYAGE_API_KEY (required unless --dry-run)');
      process.exit(2);
    }
  }

  const path = resolve(args.packPath);
  const { header, entries } = readPackFile(path);

  const headerCheck = validatePackHeader(header);
  if (!headerCheck.ok) {
    console.error('Pack header invalid:');
    for (const e of headerCheck.errors) console.error('  - ' + e);
    process.exit(3);
  }

  const summary: IngestionSummary = {
    pack_id: header.pack_id,
    pack_version: header.pack_version,
    total: entries.length,
    valid: 0,
    alreadyPresent: 0,
    inserted: 0,
    failed: 0,
    failures: [],
  };

  console.log('Pack: ' + header.pack_id + ' ' + header.pack_version + (args.dryRun ? ' (DRY RUN)' : ''));
  console.log('Total entries: ' + summary.total);

  for (let i = 0; i < entries.length; i++) {
    const raw = entries[i];
    const check = validatePackEntry(raw);
    if (!check.ok) {
      summary.failed++;
      summary.failures.push({ index: i, reason: check.errors.join('; ') });
      continue;
    }
    summary.valid++;

    const entry = applyHeaderDefaults(raw, header);

    if (args.dryRun) {
      summary.inserted++;
      continue;
    }

    // Idempotency check
    const present = await chunkAlreadyPresent(
      fetch as never,
      SUPABASE_URL!,
      SERVICE_KEY!,
      header.pack_id,
      header.pack_version,
      entry.chunk_text,
    );
    if (present) {
      summary.alreadyPresent++;
      continue;
    }

    const embedding = await generateVoyageEmbedding(entry.chunk_text, VOYAGE_KEY!);
    if (!embedding) {
      summary.failed++;
      summary.failures.push({ index: i, reason: 'embedding_failed' });
      continue;
    }

    const row: Record<string, unknown> = {
      chunk_text: entry.chunk_text,
      grade: entry.grade,
      subject: entry.subject,
      chapter_number: entry.chapter_number,
      chapter_title: entry.chapter_title ?? null,
      topic: entry.topic ?? null,
      concept: entry.concept ?? null,
      source: entry.source,
      exam_relevance: entry.exam_relevance,
      provenance: entry.provenance,
      pack_id: header.pack_id,
      pack_version: header.pack_version,
      embedding,
      embedding_model: 'voyage-3',
      embedded_at: new Date().toISOString(),
      language: entry.language ?? 'en',
      board: 'CBSE',
    };
    if (entry.board_year !== undefined) row.board_year = entry.board_year;
    if (entry.difficulty_level !== undefined) row.difficulty_level = entry.difficulty_level;

    const ins = await insertChunk(fetch as never, SUPABASE_URL!, SERVICE_KEY!, row);
    if (ins.ok) {
      summary.inserted++;
    } else {
      summary.failed++;
      summary.failures.push({ index: i, reason: ins.reason ?? 'unknown' });
    }
  }

  console.log('Valid:           ' + summary.valid);
  console.log('Already present: ' + summary.alreadyPresent);
  console.log('Inserted:        ' + summary.inserted);
  console.log('Failed:          ' + summary.failed);
  if (summary.failures.length > 0) {
    console.log('Failures:');
    for (const f of summary.failures) {
      console.log('  - line ' + (f.index + 2) + ': ' + f.reason);
    }
  }
  process.exit(summary.failed > 0 ? 1 : 0);
}

ingest().catch((err) => {
  console.error('Fatal: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(2);
});
