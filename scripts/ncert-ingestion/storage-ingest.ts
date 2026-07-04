/**
 * ALFANUMRIK -- NCERT Storage-to-DB Ingestion
 *
 * Downloads PDFs from Supabase Storage bucket 'ncert-books', extracts text
 * using pdf-parse, chunks, and uploads to rag_content_chunks.
 *
 * Discovery is FILENAME-PREFIX based (see ./prefix-resolver): NCERT filenames
 * deterministically encode class + subject + volume + chapter, so we no longer
 * depend on the messy/inconsistent Storage folder names ("Accounts XI",
 * "new Sy English", loose root PDFs, …). This unlocks the ~341 senior-subject +
 * scattered-core chapters the old "Grade "-folder-only walk silently skipped.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/ncert-ingestion/storage-ingest.ts
 *   npx tsx --env-file=.env.local scripts/ncert-ingestion/storage-ingest.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/ncert-ingestion/storage-ingest.ts --dry-run --probe --probe-limit=20
 *
 * --dry-run  : READ-ONLY. Lists what WOULD be ingested per (grade, subject,
 *              chapter), computes the coverage delta vs the legacy folder-walk,
 *              and breaks it down by cluster. No DB writes, no embeddings.
 * --probe    : (with --dry-run) additionally downloads + parses PDFs to report
 *              char count + mojibake-detected y/n. Still no DB writes.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  resolveNcertFilename,
  namespacedChapterNumber,
  languageForSubject,
  type ResolvedFile,
  type ResolveFailure,
} from './prefix-resolver';
import { findMojibakeOffenders, isDevanagariMojibake } from './mojibake';

// ─── Configuration ───────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BUCKET = 'ncert-books';
const BATCH_SIZE = 50;
const MIN_TEXT_LENGTH = 100;

const DRY_RUN = process.argv.includes('--dry-run');
const PROBE = process.argv.includes('--probe');
const PROBE_LIMIT = (() => {
  const arg = process.argv.find(a => a.startsWith('--probe-limit='));
  return arg ? parseInt(arg.split('=')[1], 10) || 0 : 0;
})();

// ─── Cluster classification (for the coverage-delta report) ──────────────────

const CLUSTER_B_FOLDERS = new Set([
  'Accounts XI', 'Accounts XII', 'Arts XI', 'Arts XII',
  'Psychology', 'Health and Fitness XI',
]);
const CLUSTER_C_FOLDERS = new Set([
  'new Science', 'new Sy English', 'New Sy Maths', 'New sy Sanskrit',
]);

type Cluster = 'B_senior_humanities' | 'C_scattered_core' | 'A_grade_folders';

function classifyCluster(storagePath: string): Cluster {
  const top = storagePath.includes('/') ? storagePath.split('/')[0] : '(root)';
  if (CLUSTER_B_FOLDERS.has(top)) return 'B_senior_humanities';
  if (CLUSTER_C_FOLDERS.has(top) || top === '(root)') return 'C_scattered_core';
  return 'A_grade_folders';
}

// ─── Legacy resolver (for before/after delta ONLY) ───────────────────────────
// Faithful reproduction of the OLD folder-walk + SUBJECT_MAP so the dry-run can
// report exactly what the previous code could reach. Do NOT use for ingestion.

const LEGACY_SUBJECT_MAP: Record<string, string> = {
  'maths': 'Mathematics', 'mathematics': 'Mathematics', 'science': 'Science',
  'english': 'English', 'hindi': 'Hindi', 'social science': 'Social Studies',
  'social studies': 'Social Studies', 'sanskrit': 'Sanskrit', 'biology': 'Biology',
  'chemistry': 'Chemistry', 'physics': 'Physics', 'computer science': 'Computer Science',
  'informatics practice': 'Informatics Practices', 'informatics practices': 'Informatics Practices',
};

function legacyResolve(storagePath: string): { grade: string; subject: string; chapter: number } | null {
  const parts = storagePath.split('/');
  const top = parts[0];
  const gradeMatch = top.match(/^Grade\s+(\d+)$/);
  if (!gradeMatch) return null;               // old walk only descended "Grade N" folders
  if (parts.length < 3) return null;          // needed Grade/Subject/…/file
  const gradeNum = gradeMatch[1];
  let rawSubject = parts[1];
  const gradePrefix = `Grade ${gradeNum} `;
  if (rawSubject.startsWith(gradePrefix)) rawSubject = rawSubject.substring(gradePrefix.length);
  const subject = LEGACY_SUBJECT_MAP[rawSubject.toLowerCase().trim()];
  if (!subject) return null;
  const fileName = parts[parts.length - 1];
  const m = fileName.match(/(\d{2,3})\.pdf$/i);
  if (!m) return null;
  const chapter = parseInt(m[1].slice(-2), 10);
  return { grade: gradeNum, subject, chapter };
}

// ─── Types ───────────────────────────────────────────────────

interface StorageFile {
  storagePath: string;
  fileName: string;
  resolved: ResolvedFile;
  cluster: Cluster;
  chapterNumber: number; // namespaced (collision-free within grade|subject)
}

interface ChunkRow {
  board: string;
  grade: string;
  subject: string;
  subject_code: string;
  grade_short: string;
  chunk_text: string;
  chunk_type: string;
  chunk_index: number;
  language: string;
  version: number;
  chapter_number: number;
  chapter_title: string;
  source: string;
  source_book: string;
  is_active: boolean;
  token_count: number;
  word_count: number;
  created_at: string;
}

// ─── Storage Traversal ──────────────────────────────────────

interface RawItem { name: string; id: string | null; metadata: Record<string, unknown> | null }

async function listFolder(path: string): Promise<RawItem[]> {
  const { data, error } = await supabase.storage.from(BUCKET).list(path, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  });
  if (error) {
    console.error(`  ERROR listing ${path}:`, error.message);
    return [];
  }
  return (data || []) as RawItem[];
}

function isFolder(item: RawItem): boolean {
  return item.id === null || item.metadata === null;
}

/** Recursively collect every PDF path in the bucket (all folders + root). */
async function collectAllPdfPaths(path = '', depth = 0, acc: string[] = []): Promise<string[]> {
  if (depth > 5) return acc;
  const items = await listFolder(path);
  for (const it of items) {
    const full = path ? `${path}/${it.name}` : it.name;
    if (isFolder(it)) {
      await collectAllPdfPaths(full, depth + 1, acc);
    } else if (it.name.toLowerCase().endsWith('.pdf')) {
      acc.push(full);
    }
  }
  return acc;
}

interface DiscoveryResult {
  files: StorageFile[];
  unresolved: Array<{ path: string; reason: ResolveFailure['reason']; prefix: string | null }>;
  skippedAssets: number;
}

async function discoverFiles(): Promise<DiscoveryResult> {
  const paths = await collectAllPdfPaths();
  const raw: Array<{ path: string; resolved: ResolvedFile }> = [];
  const unresolved: DiscoveryResult['unresolved'] = [];
  let skippedAssets = 0;

  for (const p of paths) {
    const fileName = p.split('/').pop() as string;
    const fail = { value: null as ResolveFailure | null };
    const resolved = resolveNcertFilename(fileName, fail);
    if (!resolved) {
      if (fail.value?.reason === 'not_pdf_or_asset') { skippedAssets++; continue; }
      unresolved.push({ path: p, reason: fail.value?.reason ?? 'unknown_prefix', prefix: fail.value?.prefix ?? null });
      continue;
    }
    raw.push({ path: p, resolved });
  }

  // Namespace multi-book chapters: gather the distinct volumes per grade|subject.
  const volumesByGroup = new Map<string, Array<{ prefix: string; bookNumber: number }>>();
  for (const r of raw) {
    const key = `${r.resolved.grade}|${r.resolved.subjectCode}`;
    const list = volumesByGroup.get(key) ?? [];
    list.push({ prefix: r.resolved.prefix, bookNumber: r.resolved.bookNumber });
    volumesByGroup.set(key, list);
  }

  // Build files + de-duplicate on the namespaced identity (handles misfiled dups
  // like jhva appearing under both Grade 9 and Grade 10 folders).
  const seen = new Set<string>();
  const files: StorageFile[] = [];
  for (const r of raw) {
    const key = `${r.resolved.grade}|${r.resolved.subjectCode}`;
    const chapterNumber = namespacedChapterNumber(
      { prefix: r.resolved.prefix, bookNumber: r.resolved.bookNumber, chapterInBook: r.resolved.chapterInBook },
      volumesByGroup.get(key) ?? []
    );
    const identity = `${r.resolved.grade}|${r.resolved.subjectCode}|${r.resolved.prefix}|${r.resolved.bookNumber}|${r.resolved.chapterInBook}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    files.push({
      storagePath: r.path,
      fileName: r.path.split('/').pop() as string,
      resolved: r.resolved,
      cluster: classifyCluster(r.path),
      chapterNumber,
    });
  }

  return { files, unresolved, skippedAssets };
}

// ─── PDF Download & Parse ────────────────────────────────────

async function downloadAndParse(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    console.error(`  ERROR downloading ${storagePath}:`, error?.message || 'no data');
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require('pdf-parse');
    const buffer = Buffer.from(await data.arrayBuffer());
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    const text = (parsed.text || '').trim();
    if (text.length < MIN_TEXT_LENGTH) {
      console.log(`    Skipped (only ${text.length} chars -- likely scanned/image PDF)`);
      return null;
    }
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ERROR parsing PDF ${storagePath}:`, msg);
    return null;
  }
}

// ─── Text Chunking ───────────────────────────────────────────

function estimateTokens(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 20);
  const chunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    const candidate = current ? current + '\n\n' + para : para;
    const tokens = estimateTokens(candidate);
    if (tokens > 500 && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else if (tokens > 500 && current.length === 0) {
      const sentences = para.split(/(?<=[.!?])\s+/);
      let sentenceChunk = '';
      for (const sentence of sentences) {
        const sc = sentenceChunk ? sentenceChunk + ' ' + sentence : sentence;
        if (estimateTokens(sc) > 500 && sentenceChunk.length > 0) {
          chunks.push(sentenceChunk.trim());
          sentenceChunk = sentence;
        } else {
          sentenceChunk = sc;
        }
      }
      current = sentenceChunk;
    } else {
      current = candidate;
    }
  }
  if (current.trim().length > 20) chunks.push(current.trim());
  return chunks;
}

// ─── Database Operations ─────────────────────────────────────

async function insertBatch(rows: ChunkRow[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('rag_content_chunks').insert(batch);
    if (error) {
      console.error(`  ERROR inserting batch at offset ${i}:`, error.message);
    } else {
      inserted += batch.length;
    }
  }
  return inserted;
}

// ─── Dry-run coverage report ─────────────────────────────────

function tripleKey(grade: string, subject: string, chapter: number): string {
  return `${grade}|${subject}|${chapter}`;
}

async function dryRunReport(discovery: DiscoveryResult): Promise<void> {
  const { files, unresolved, skippedAssets } = discovery;
  const paths = files.map(f => f.storagePath);

  // NEW resolvable triples (grade|subject_code|namespaced-chapter)
  const newTriples = new Set<string>();
  const newByCluster: Record<Cluster, Set<string>> = {
    A_grade_folders: new Set(), B_senior_humanities: new Set(), C_scattered_core: new Set(),
  };
  const coverageBySubject = new Map<string, Set<number>>(); // "grade|subject" -> chapters
  for (const f of files) {
    const k = tripleKey(f.resolved.grade, f.resolved.subjectCode, f.chapterNumber);
    newTriples.add(k);
    newByCluster[f.cluster].add(k);
    const gk = `${f.resolved.grade}|${f.resolved.subjectCode}`;
    (coverageBySubject.get(gk) ?? coverageBySubject.set(gk, new Set()).get(gk)!).add(f.chapterNumber);
  }

  // OLD (legacy folder-walk) resolvable triples — computed from the SAME paths.
  const oldTriples = new Set<string>();
  for (const p of paths.concat(unresolved.map(u => u.path))) {
    const legacy = legacyResolve(p);
    if (legacy) oldTriples.add(tripleKey(legacy.grade, legacy.subject, legacy.chapter));
  }

  // File-level delta: a file is "unlocked" if the legacy walk could NOT resolve it.
  const unlockedByCluster: Record<Cluster, Set<string>> = {
    A_grade_folders: new Set(), B_senior_humanities: new Set(), C_scattered_core: new Set(),
  };
  for (const f of files) {
    const legacy = legacyResolve(f.storagePath);
    if (!legacy) {
      unlockedByCluster[f.cluster].add(tripleKey(f.resolved.grade, f.resolved.subjectCode, f.chapterNumber));
    }
  }

  console.log('\n' + '='.repeat(72));
  console.log('DRY-RUN DISCOVERY REPORT (read-only — no DB writes, no embeddings)');
  console.log('='.repeat(72));
  console.log(`  Total PDF files in bucket        : ${paths.length + skippedAssets + unresolved.length}`);
  console.log(`  Skipped assets (prelims/answers) : ${skippedAssets}`);
  console.log(`  Unresolved (unknown prefix)      : ${unresolved.length}`);
  console.log(`  Resolved chapter files           : ${files.length}`);
  console.log('');
  console.log(`  Distinct (grade,subject,chapter) triples resolvable:`);
  console.log(`    NEW filename-prefix resolver   : ${newTriples.size}`);
  console.log(`    OLD folder-walk (legacy)       : ${oldTriples.size}`);
  console.log(`    NET-NEW (NEW - OLD)            : ${newTriples.size - oldTriples.size}`);
  console.log('    (net-new = brand-new files + multi-book chapters the legacy last-2-digit');
  console.log('     extractor silently collapsed onto colliding chapter numbers)');
  console.log('');
  console.log('  Brand-new chapters from files the legacy walk could NOT reach at all,');
  console.log('  by cluster (duplicates that also exist under a Grade N folder are');
  console.log('  attributed to that folder = Cluster A):');
  const bSize = unlockedByCluster.B_senior_humanities.size;
  const cSize = unlockedByCluster.C_scattered_core.size;
  const aSize = unlockedByCluster.A_grade_folders.size;
  console.log(`    Cluster B (senior humanities)  : ${bSize}`);
  console.log(`    Cluster C (scattered core)     : ${cSize}`);
  console.log(`    Cluster A (grade folders, newly-mapped subjects): ${aSize}`);
  console.log(`    TOTAL brand-new                : ${bSize + cSize + aSize}`);

  // Per grade|subject coverage table
  console.log('\n  Resolved coverage per grade | subject_code (chapter count):');
  const rows = [...coverageBySubject.entries()].sort(([a], [b]) => {
    const [ga, sa] = a.split('|'); const [gb, sb] = b.split('|');
    return parseInt(ga) - parseInt(gb) || sa.localeCompare(sb);
  });
  for (const [gk, chapters] of rows) {
    console.log(`    ${gk.padEnd(24)} : ${chapters.size}`);
  }

  // Unresolved detail (the genuine BUILD/acquire set)
  if (unresolved.length > 0) {
    console.log('\n  Unresolved files (need a prefix mapping or are genuinely missing):');
    const byPrefix = new Map<string, number>();
    for (const u of unresolved) byPrefix.set(u.prefix ?? '(none)', (byPrefix.get(u.prefix ?? '(none)') ?? 0) + 1);
    for (const [pfx, n] of [...byPrefix.entries()].sort()) console.log(`    prefix "${pfx}": ${n} file(s)`);
  }

  // Optional PROBE: parse a bounded sample to demonstrate char-count + mojibake.
  if (PROBE) {
    const indic = files.filter(f => f.resolved.language !== 'en');
    const sample = PROBE_LIMIT > 0 ? indic.slice(0, PROBE_LIMIT) : indic;
    console.log(`\n  PROBE: parsing ${sample.length} Indic (hi/sa) PDFs for char-count + mojibake (read-only)…`);
    let mojibakeHits = 0;
    for (const f of sample) {
      const text = await downloadAndParse(f.storagePath);
      const charCount = text?.length ?? 0;
      const moji = text ? isDevanagariMojibake(text.slice(0, 4000)) : false;
      if (moji) mojibakeHits++;
      console.log(
        `    [${f.resolved.language}] G${f.resolved.grade} ${f.resolved.subjectCode} ch${f.chapterNumber} ` +
        `| ${f.fileName} | chars=${charCount} | mojibake=${moji ? 'YES (would SKIP)' : 'no'}`
      );
    }
    console.log(`  PROBE result: ${mojibakeHits}/${sample.length} Indic PDFs are mojibake and would be SKIPPED (not written).`);
  }
}

// ─── Live ingestion ──────────────────────────────────────────

async function liveIngest(discovery: DiscoveryResult): Promise<void> {
  const { files } = discovery;
  console.log('Step 2: Downloading, parsing, chunking, and uploading...\n');

  let totalChunks = 0;
  let skippedFiles = 0;
  let errorFiles = 0;
  let mojibakeSkipped = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const label = `[${i + 1}/${files.length}] Grade ${file.resolved.grade} ${file.resolved.subjectCode} - ${file.fileName}`;

    const text = await downloadAndParse(file.storagePath);
    if (text === null) { skippedFiles++; continue; }

    const textChunks = chunkText(text);
    if (textChunks.length === 0) { skippedFiles++; continue; }

    const rows: ChunkRow[] = textChunks.map((chunk, idx) => ({
      board: 'CBSE',
      grade: file.resolved.gradeDb,
      subject: file.resolved.subjectDisplay,
      subject_code: file.resolved.subjectCode,
      grade_short: file.resolved.grade,
      chunk_text: chunk,
      chunk_type: 'concept_explanation',
      chunk_index: idx,
      language: file.resolved.language,
      version: 1,
      chapter_number: file.chapterNumber,
      chapter_title: `${file.resolved.subjectDisplay} (${file.resolved.prefix}) Ch ${file.chapterNumber}`,
      source: 'ncert_2025',
      source_book: file.storagePath,
      is_active: true,
      word_count: chunk.split(/\s+/).filter((w: string) => w.length > 0).length,
      token_count: estimateTokens(chunk),
      created_at: now,
    }));

    // Mojibake guard: for Indic subjects, refuse to write Krutidev garbage.
    // SKIP + log (do NOT throw — one bad legacy-font PDF must not abort the run).
    const offenders = findMojibakeOffenders(
      rows.map(r => ({ chapter_title: r.chapter_title, chunk_text: r.chunk_text })),
      file.resolved.subjectCode
    );
    if (offenders.length > 0) {
      mojibakeSkipped++;
      console.warn(
        `  ${label}: SKIPPED — ${offenders.length} mojibake chunk(s) detected ` +
        `(legacy-font ${file.resolved.subjectCode}). Re-extract via pdftotext/OCR. ` +
        `First: "${offenders[0].sample}"`
      );
      continue;
    }

    const inserted = await insertBatch(rows);
    if (inserted === 0 && rows.length > 0) {
      errorFiles++;
      console.error(`  ${label}: FAILED to insert ${rows.length} chunks`);
      continue;
    }
    totalChunks += inserted;
    console.log(`  ${label}: ${inserted} chunks uploaded`);
  }

  console.log('\n' + '='.repeat(72));
  console.log('INGESTION SUMMARY');
  console.log('='.repeat(72));
  console.log(`  Resolved files            : ${files.length}`);
  console.log(`  Chunks inserted           : ${totalChunks}`);
  console.log(`  Files skipped (low text)  : ${skippedFiles}`);
  console.log(`  Files skipped (mojibake)  : ${mojibakeSkipped}`);
  console.log(`  Files with errors         : ${errorFiles}`);
}

// ─── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('ALFANUMRIK -- NCERT Storage-to-DB Ingestion');
  console.log('='.repeat(72));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (read-only)' : 'LIVE'}${PROBE ? ' + PROBE' : ''}`);
  console.log(`Bucket: ${BUCKET}`);
  console.log('');

  console.log('Step 1: Discovering files via filename-prefix resolver...');
  const discovery = await discoverFiles();
  console.log(`  Resolved ${discovery.files.length} chapter PDFs ` +
    `(${discovery.skippedAssets} assets skipped, ${discovery.unresolved.length} unresolved)\n`);

  if (discovery.files.length === 0) {
    console.log('No resolvable files found. Check bucket contents.');
    return;
  }

  if (DRY_RUN) {
    await dryRunReport(discovery);
    console.log('\nDRY RUN complete — nothing was written.');
    return;
  }

  await liveIngest(discovery);

  console.log('\nDone. Next steps:');
  console.log('  1. Run: npx tsx --env-file=.env.local scripts/ncert-ingestion/validate.ts');
  console.log('  2. Run: npm run ncert:embed');
  console.log('  3. Invalidate Foxy RAG cache');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
