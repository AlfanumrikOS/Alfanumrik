#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * scripts/csv-to-rag-pack.ts
 *
 * Phase 4.6 Track B - convert a curated CSV of public-domain CBSE board
 * PYQ extracts into a JSONL pack ready for ingestion by
 * scripts/ingest-rag-pack.ts.
 *
 * Why CSV (not direct PDF scrape): real CBSE board PDFs are layout-heavy,
 * mixed-language, and full of figures - reliable extraction is a manual
 * curator workflow. This script is the post-curation step: take a
 * curator's CSV (one row per question or solution passage) and emit a
 * validated JSONL pack with provenance="public_domain", source="pyq".
 *
 * Usage:
 *   tsx scripts/csv-to-rag-pack.ts \
 *     --csv data/rag-packs/sample-board-pyq-class10-math.csv \
 *     --pack-id cbse-board-pyq-math-grade10 \
 *     --pack-version v1 \
 *     --out data/rag-packs/cbse-board-pyq-math-grade10-v1.jsonl
 *   [--dry-run]
 *
 * CSV columns (header row required):
 *   subject,grade,chapter_number,chapter_title,topic,concept,board_year,
 *   difficulty_level,language,chunk_text
 *
 * - subject + grade + chapter_number + board_year + chunk_text are REQUIRED.
 * - chapter_title, topic, concept are OPTIONAL but recommended.
 * - difficulty_level is OPTIONAL (1-5 scale).
 * - language defaults to 'en' if blank.
 * - exam_relevance is fixed to ["CBSE_BOARD"] (Track B is exclusively for
 *   board PYQs; for other exam relevance, build a different pack via
 *   the manifest spec).
 *
 * Output: a JSONL pack file with PackHeader (line 1) + PackEntry per row.
 *   - source = "pyq" (fixed)
 *   - provenance = "public_domain" (fixed)
 *   - exam_relevance = ["CBSE_BOARD"] (fixed)
 *
 * Idempotent: re-runs OVERWRITE the output file. The downstream
 * ingest-rag-pack.ts is itself idempotent on (pack_id, pack_version,
 * chunk_text), so re-runs against an already-ingested pack are safe.
 *
 * Owner: ai-engineer (script) + assessment (curriculum review of CSVs)
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validatePackEntry,
  validatePackHeader,
  type PackEntry,
  type PackHeader,
} from '../src/lib/rag/pack-manifest';

interface ScriptArgs {
  csvPath: string;
  packId: string;
  packVersion: string;
  outPath: string;
  dryRun: boolean;
}

interface ConvertSummary {
  pack_id: string;
  pack_version: string;
  rowsRead: number;
  rowsValid: number;
  rowsRejected: number;
  rejections: Array<{ row: number; reason: string }>;
}

function parseArgs(argv: string[]): ScriptArgs {
  let csvPath = '';
  let packId = '';
  let packVersion = '';
  let outPath = '';
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--csv' && i + 1 < argv.length) csvPath = argv[++i];
    else if (a === '--pack-id' && i + 1 < argv.length) packId = argv[++i];
    else if (a === '--pack-version' && i + 1 < argv.length) packVersion = argv[++i];
    else if (a === '--out' && i + 1 < argv.length) outPath = argv[++i];
    else if (a === '--dry-run') dryRun = true;
  }
  if (!csvPath || !packId || !packVersion || !outPath) {
    console.error('Usage: tsx scripts/csv-to-rag-pack.ts --csv <path> --pack-id <id> --pack-version <v> --out <path.jsonl> [--dry-run]');
    process.exit(2);
  }
  return { csvPath, packId, packVersion, outPath, dryRun };
}

/**
 * Minimal CSV parser. Supports double-quoted cells with embedded commas
 * and embedded "" escaped quotes. Does NOT support multi-line cells -
 * keep PYQ extracts on one line per row (replace embedded newlines with
 * spaces during curation).
 */
import { parseCsvLine } from '../src/lib/rag/csv';


const REQUIRED_COLS = ['subject', 'grade', 'chapter_number', 'board_year', 'chunk_text'];
const OPTIONAL_COLS = ['chapter_title', 'topic', 'concept', 'difficulty_level', 'language'];

function rowToEntry(
  cells: string[],
  colIndex: Record<string, number>,
): { ok: true; entry: PackEntry } | { ok: false; reason: string } {
  function get(col: string): string {
    const i = colIndex[col];
    return i !== undefined ? (cells[i] ?? '').trim() : '';
  }
  for (const req of REQUIRED_COLS) {
    if (!get(req)) return { ok: false, reason: 'missing required column: ' + req };
  }

  const chapter_number = parseInt(get('chapter_number'), 10);
  if (Number.isNaN(chapter_number)) {
    return { ok: false, reason: 'chapter_number not an integer: ' + get('chapter_number') };
  }
  const board_year = parseInt(get('board_year'), 10);
  if (Number.isNaN(board_year)) {
    return { ok: false, reason: 'board_year not an integer: ' + get('board_year') };
  }
  const diffRaw = get('difficulty_level');
  const difficulty_level = diffRaw ? parseInt(diffRaw, 10) : undefined;
  if (diffRaw && Number.isNaN(difficulty_level as number)) {
    return { ok: false, reason: 'difficulty_level not an integer: ' + diffRaw };
  }
  const langRaw = get('language');
  const language = langRaw === 'hi' ? 'hi' : 'en';

  const entry: PackEntry = {
    chunk_text: get('chunk_text'),
    grade: get('grade'),
    subject: get('subject'),
    chapter_number,
    chapter_title: get('chapter_title') || undefined,
    topic: get('topic') || undefined,
    concept: get('concept') || undefined,
    source: 'pyq',
    exam_relevance: ['CBSE_BOARD'],
    provenance: 'public_domain',
    board_year,
    difficulty_level,
    language,
  };

  const v = validatePackEntry(entry);
  if (!v.ok) return { ok: false, reason: 'manifest: ' + v.errors.join('; ') };
  return { ok: true, entry };
}

function convert(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(resolve(args.csvPath))) {
    console.error('CSV file not found: ' + args.csvPath);
    process.exit(2);
  }
  const raw = readFileSync(resolve(args.csvPath), 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) {
    console.error('CSV must have a header row and at least one data row');
    process.exit(2);
  }

  const headerCells = parseCsvLine(lines[0]).map((c) => c.trim());
  const colIndex: Record<string, number> = {};
  headerCells.forEach((c, i) => { colIndex[c] = i; });

  for (const req of REQUIRED_COLS) {
    if (!(req in colIndex)) {
      console.error('CSV missing required column: ' + req + '. Found: ' + headerCells.join(', '));
      process.exit(3);
    }
  }

  const header: PackHeader = {
    pack_id: args.packId,
    pack_version: args.packVersion,
    pack_source: 'pyq',
    default_provenance: 'public_domain',
    notes: 'Phase 4.6 Track B: curated from CSV of public-domain CBSE board PYQ extracts.',
  };
  const headerCheck = validatePackHeader(header);
  if (!headerCheck.ok) {
    console.error('Pack header invalid:');
    for (const e of headerCheck.errors) console.error('  - ' + e);
    process.exit(3);
  }

  const summary: ConvertSummary = {
    pack_id: args.packId,
    pack_version: args.packVersion,
    rowsRead: lines.length - 1,
    rowsValid: 0,
    rowsRejected: 0,
    rejections: [],
  };

  console.log('Pack: ' + args.packId + ' ' + args.packVersion + (args.dryRun ? ' (DRY RUN)' : ''));
  console.log('CSV rows (excluding header): ' + summary.rowsRead);

  const entries: PackEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const r = rowToEntry(cells, colIndex);
    if (r.ok) {
      entries.push(r.entry);
      summary.rowsValid++;
    } else {
      summary.rowsRejected++;
      summary.rejections.push({ row: i + 1, reason: r.reason });
    }
  }

  if (!args.dryRun) {
    const outLines = [JSON.stringify(header), ...entries.map((e) => JSON.stringify(e))];
    writeFileSync(resolve(args.outPath), outLines.join('\n') + '\n', 'utf8');
    console.log('Wrote pack to ' + args.outPath);
  }

  console.log('Valid:    ' + summary.rowsValid);
  console.log('Rejected: ' + summary.rowsRejected);
  if (summary.rejections.length > 0) {
    console.log('Rejection details:');
    for (const r of summary.rejections.slice(0, 20)) {
      console.log('  - row ' + r.row + ': ' + r.reason);
    }
    if (summary.rejections.length > 20) {
      console.log('  ... and ' + (summary.rejections.length - 20) + ' more');
    }
  }
  process.exit(summary.rowsRejected > 0 ? 1 : 0);
}

convert();
