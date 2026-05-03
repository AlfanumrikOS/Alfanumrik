#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * scripts/generate-rag-pack.ts
 *
 * Phase 4.6 Track A - Claude-generated content pack.
 *
 * Reads a JSON outline file specifying (subject, grade, chapter, topic,
 * count) tuples, calls Claude to generate content chunks for each tuple,
 * grades every chunk via the quality oracle, writes ACCEPTED chunks to
 * a JSONL pack file ready for ingestion by scripts/ingest-rag-pack.ts.
 *
 * Why a quality oracle: P12 (AI safety) prohibits unfiltered LLM output
 * reaching students. Every generated chunk must score >= 7/9 from a
 * separate Claude grader pass before it can be saved to the pack.
 *
 * Usage:
 *   tsx scripts/generate-rag-pack.ts --outline data/rag-packs/<file>.json --out data/rag-packs/<pack>.jsonl
 *   [--dry-run]      # prints what would be generated without calling Claude
 *   [--model haiku]  # which Claude model to use for both generation + grading
 *
 * Outline file shape:
 *   {
 *     "pack_id": "generated-class10-math-quadratic-v0",
 *     "pack_version": "v0",
 *     "items": [
 *       { "subject": "math", "grade": "10", "chapter_number": 4,
 *         "chapter_title": "Quadratic Equations", "topic": "discriminant",
 *         "concept": "...", "count": 3 }
 *     ]
 *   }
 *
 * Output: a JSONL file with PackHeader on line 1 + one PackEntry per line.
 *
 * Owner: ai-engineer
 * Reviewers: assessment (rubric in pack-quality-oracle.ts), testing
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validatePackEntry,
  validatePackHeader,
  type PackEntry,
  type PackHeader,
} from '../src/lib/rag/pack-manifest';
import { gradeWithClaude } from '../src/lib/rag/pack-quality-oracle';

interface OutlineItem {
  subject: string;
  grade: string;
  chapter_number: number;
  chapter_title?: string;
  topic?: string;
  concept?: string;
  count: number;
}

interface Outline {
  pack_id: string;
  pack_version: string;
  notes?: string;
  items: OutlineItem[];
}

interface ScriptArgs {
  outlinePath: string;
  outPath: string;
  dryRun: boolean;
  model: string;
}

interface GenerationSummary {
  pack_id: string;
  pack_version: string;
  itemsRequested: number;
  itemsGenerated: number;
  chunksAccepted: number;
  chunksRejected: number;
  rejections: Array<{ item: string; reason: string }>;
}

function parseArgs(argv: string[]): ScriptArgs {
  let outlinePath = '';
  let outPath = '';
  let dryRun = false;
  let model = 'claude-haiku-4-5-20251001';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--outline' && i + 1 < argv.length) outlinePath = argv[++i];
    else if (a === '--out' && i + 1 < argv.length) outPath = argv[++i];
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--model' && i + 1 < argv.length) {
      const v = argv[++i];
      model = v === 'haiku' ? 'claude-haiku-4-5-20251001' : v;
    }
  }
  if (!outlinePath || !outPath) {
    console.error('Usage: tsx scripts/generate-rag-pack.ts --outline <path.json> --out <path.jsonl> [--dry-run] [--model haiku|claude-...]');
    process.exit(2);
  }
  return { outlinePath, outPath, dryRun, model };
}

function readOutline(path: string): Outline {
  if (!existsSync(path)) throw new Error('Outline file not found: ' + path);
  return JSON.parse(readFileSync(path, 'utf8')) as Outline;
}

function buildGenerationPrompt(item: OutlineItem): { system: string; user: string } {
  const system = [
    'You are a CBSE textbook author writing concise content chunks for an AI tutor RAG store.',
    'Each chunk must be:',
    '  - 200-700 characters (a single passage; no question lists)',
    '  - Factually accurate and aligned with NCERT for the stated grade and subject',
    '  - Self-contained (no "see above" or "as discussed earlier")',
    '  - Plain prose, not Markdown - no bullet lists, no headers, no LaTeX',
    'Return STRICTLY a single JSON object on one line with key "chunks":',
    '  { "chunks": [ "first passage text", "second passage text", ... ] }',
    'No code fences, no commentary outside the JSON.',
  ].join('\n');

  const user = [
    'Generate ' + item.count + ' content chunks for:',
    'Subject: ' + item.subject,
    'Grade: ' + item.grade + ' (CBSE)',
    'Chapter: ' + (item.chapter_title ?? item.chapter_number),
    item.topic ? 'Topic: ' + item.topic : '',
    item.concept ? 'Concept: ' + item.concept : '',
    '',
    'Each chunk should cover one specific aspect of the topic. Aim for high RAG retrievability - include keywords a student would naturally type.',
  ].filter((l) => l !== '').join('\n');

  return { system, user };
}

async function callClaudeForGeneration(
  item: OutlineItem,
  apiKey: string,
  model: string,
): Promise<string[] | null> {
  const { system, user } = buildGenerationPrompt(item);
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  const text = body?.content?.[0]?.text;
  if (typeof text !== 'string') return null;
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/```$/, '').trim();
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && Array.isArray(parsed.chunks)) {
      return parsed.chunks.filter((c: unknown) => typeof c === 'string');
    }
    return null;
  } catch {
    return null;
  }
}

async function generate(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  if (!args.dryRun && !ANTHROPIC_KEY) {
    console.error('Missing ANTHROPIC_API_KEY (required unless --dry-run)');
    process.exit(2);
  }

  const outline = readOutline(resolve(args.outlinePath));

  const header: PackHeader = {
    pack_id: outline.pack_id,
    pack_version: outline.pack_version,
    pack_source: 'curated',
    default_provenance: 'generated',
    notes: outline.notes ?? 'Phase 4.6 Track A: Claude-generated, oracle-graded.',
  };

  const headerCheck = validatePackHeader(header);
  if (!headerCheck.ok) {
    console.error('Pack header invalid:');
    for (const e of headerCheck.errors) console.error('  - ' + e);
    process.exit(3);
  }

  const summary: GenerationSummary = {
    pack_id: outline.pack_id,
    pack_version: outline.pack_version,
    itemsRequested: outline.items.length,
    itemsGenerated: 0,
    chunksAccepted: 0,
    chunksRejected: 0,
    rejections: [],
  };

  console.log('Pack: ' + header.pack_id + ' ' + header.pack_version + (args.dryRun ? ' (DRY RUN)' : ''));
  console.log('Outline items: ' + summary.itemsRequested);

  const acceptedEntries: PackEntry[] = [];

  for (const item of outline.items) {
    const itemKey = item.subject + '/grade' + item.grade + '/ch' + item.chapter_number + (item.topic ? '/' + item.topic : '');

    if (args.dryRun) {
      console.log('  WOULD generate ' + item.count + ' chunks for ' + itemKey);
      summary.itemsGenerated++;
      summary.chunksAccepted += item.count;
      continue;
    }

    const generated = await callClaudeForGeneration(item, ANTHROPIC_KEY!, args.model);
    if (!generated || generated.length === 0) {
      summary.rejections.push({ item: itemKey, reason: 'generation_failed' });
      continue;
    }
    summary.itemsGenerated++;

    for (const chunkText of generated) {
      const candidate: PackEntry = {
        chunk_text: chunkText,
        grade: item.grade,
        subject: item.subject,
        chapter_number: item.chapter_number,
        chapter_title: item.chapter_title,
        topic: item.topic,
        concept: item.concept,
        source: 'curated',
        exam_relevance: ['CBSE'],
        provenance: 'generated',
      };

      const schemaCheck = validatePackEntry(candidate);
      if (!schemaCheck.ok) {
        summary.chunksRejected++;
        summary.rejections.push({ item: itemKey, reason: 'schema: ' + schemaCheck.errors.join('; ') });
        continue;
      }

      const grade = await gradeWithClaude(candidate, { apiKey: ANTHROPIC_KEY!, model: args.model });
      if (!grade) {
        summary.chunksRejected++;
        summary.rejections.push({ item: itemKey, reason: 'oracle_unavailable_or_error' });
        continue;
      }
      if (!grade.accepted) {
        summary.chunksRejected++;
        summary.rejections.push({
          item: itemKey,
          reason: 'oracle_rejected total=' + grade.total + ': ' + grade.reasoning,
        });
        continue;
      }
      acceptedEntries.push(candidate);
      summary.chunksAccepted++;
    }
  }

  if (!args.dryRun) {
    const lines = [JSON.stringify(header), ...acceptedEntries.map((e) => JSON.stringify(e))];
    writeFileSync(resolve(args.outPath), lines.join('\n') + '\n', 'utf8');
    console.log('Wrote ' + acceptedEntries.length + ' accepted chunks to ' + args.outPath);
  }

  console.log('Items requested: ' + summary.itemsRequested);
  console.log('Items generated: ' + summary.itemsGenerated);
  console.log('Chunks accepted: ' + summary.chunksAccepted);
  console.log('Chunks rejected: ' + summary.chunksRejected);
  if (summary.rejections.length > 0) {
    console.log('Rejection details:');
    for (const r of summary.rejections.slice(0, 20)) {
      console.log('  - ' + r.item + ': ' + r.reason);
    }
    if (summary.rejections.length > 20) {
      console.log('  ... and ' + (summary.rejections.length - 20) + ' more');
    }
  }
  process.exit(summary.chunksAccepted > 0 ? 0 : 1);
}

generate().catch((err) => {
  console.error('Fatal: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(2);
});
