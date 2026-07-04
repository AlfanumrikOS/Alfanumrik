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
 *   npx tsx --env-file=.env.local scripts/ncert-ingestion/storage-ingest.ts --dry-run --grade 11 --subject economics --only-missing
 *
 * --dry-run  : READ-ONLY. Lists what WOULD be ingested per (grade, subject,
 *              chapter), computes the coverage delta vs the legacy folder-walk,
 *              and breaks it down by cluster. No DB writes, no embeddings.
 * --probe    : (with --dry-run) additionally downloads + parses PDFs to report
 *              char count + mojibake-detected y/n. Still no DB writes.
 *
 * Staged-scoping flags (compose with --dry-run / --probe; omit for unchanged
 * all-chapters behavior). These let the ~967-chapter re-ingestion run per-subject,
 * safely and resumably, instead of all-or-nothing:
 * --grade <N>       : keep only these grades. Repeatable or comma-separated
 *                     (--grade 11 --grade 12  or  --grade 11,12).
 * --subject <code>  : keep only these subject_codes (cbse_syllabus codes, e.g.
 *                     economics). Repeatable or comma-separated.
 * --only-missing    : skip chapters whose cbse_syllabus row already has
 *                     chunk_count > 0. Targets exactly the 0-coverage gap
 *                     chapters and makes a killed run idempotently resumable.
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
import {
  selectChaptersToIngest,
  coverageKey,
  type ChapterCoordinate,
} from './chapter-selector';

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

// ─── Staged-scoping flags ────────────────────────────────────
// Each is repeatable AND comma-separated: `--grade 11 --grade 12` == `--grade 11,12`.

/** Collect all values for a repeatable/comma-separated flag (`--flag v` or `--flag=v`). */
function collectMultiFlag(flag: string): string[] {
  const out: string[] = [];
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === flag) {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) out.push(...next.split(','));
    } else if (a.startsWith(`${flag}=`)) {
      out.push(...a.slice(flag.length + 1).split(','));
    }
  }
  return out.map(s => s.trim().toLowerCase()).filter(Boolean);
}

const FILTER_GRADES = collectMultiFlag('--grade');
const FILTER_SUBJECTS = collectMultiFlag('--subject');
const ONLY_MISSING = process.argv.includes('--only-missing');

// Source tag written to every chunk row. Also the idempotency-guard key: a
// re-ingested chapter's prior chunks (same grade|subject|chapter|source) are
// deleted before re-insert so a resumed run never double-writes.
const SOURCE = 'ncert_2025';

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

/**
 * Idempotency guard for a resumed / repeated run. The ingest path does a plain
 * INSERT, so without this a chapter re-ingested after a kill would DOUBLE-WRITE
 * its chunks. We delete any prior chunks for this exact
 * (grade_short, subject_code, chapter_number, source) before re-inserting, so
 * the chapter's chunk set is replaced, never duplicated. Namespaced
 * chapter_number is collision-free within grade|subject, so this tuple uniquely
 * identifies one chapter's chunk set.
 */
async function deleteExistingChunks(file: StorageFile): Promise<boolean> {
  const { error } = await supabase
    .from('rag_content_chunks')
    .delete()
    .eq('grade_short', file.resolved.grade)
    .eq('subject_code', file.resolved.subjectCode)
    .eq('chapter_number', file.chapterNumber)
    .eq('source', SOURCE);
  if (error) {
    console.error(
      `  ERROR clearing prior chunks for G${file.resolved.grade} ` +
      `${file.resolved.subjectCode} ch${file.chapterNumber}:`, error.message
    );
    return false;
  }
  return true;
}

/**
 * Fetch the cbse_syllabus in-scope chapter registry, keyed by
 * coverageKey() = "grade|subject_code|chapter_number". Returns two sets:
 *  - `syllabus` : EVERY in-scope row (the eligibility gate — a resolved chapter
 *                 must be a known manifest row to count as a "gap row").
 *  - `covered`  : rows with chunk_count > 0 (skipped under --only-missing).
 * The 0-coverage gap set targeted by --only-missing is `syllabus \ covered`.
 * Paginated to avoid the Supabase JS default row cap.
 */
async function fetchSyllabusCoverage(): Promise<{ syllabus: Set<string>; covered: Set<string> }> {
  const syllabus = new Set<string>();
  const covered = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('cbse_syllabus')
      .select('grade, subject_code, chapter_number, chunk_count')
      .eq('is_in_scope', true)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`cbse_syllabus coverage query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{
      grade: string; subject_code: string; chapter_number: number; chunk_count: number;
    }>) {
      const key = `${r.grade}|${r.subject_code}|${r.chapter_number}`;
      syllabus.add(key);
      if (r.chunk_count > 0) covered.add(key);
    }
    if (data.length < pageSize) break;
  }
  return { syllabus, covered };
}

// ─── Scoping helpers ─────────────────────────────────────────

/** Project a StorageFile onto its (grade, subject_code, chapter) coordinate. */
function toCoordinate(f: StorageFile): ChapterCoordinate {
  return { grade: f.resolved.grade, subjectCode: f.resolved.subjectCode, chapterNumber: f.chapterNumber };
}

/**
 * Apply the CLI scoping flags to the resolved file set. Returns the selected
 * files plus a breakdown of how many were dropped by each filter, for the
 * per-run summary. `coveredKeys` is only consulted when --only-missing is set.
 */
function applyScoping(
  files: StorageFile[],
  coverage: { syllabus: ReadonlySet<string>; covered: ReadonlySet<string> },
): { selected: StorageFile[]; droppedByGradeSubject: number; droppedByOnlyMissing: number } {
  // Attach coordinate fields so the pure selector can read them while carrying
  // the full StorageFile through.
  const withCoord = files.map(f => ({ ...toCoordinate(f), file: f }));

  const afterGradeSubject = selectChaptersToIngest(withCoord, {
    grades: FILTER_GRADES,
    subjects: FILTER_SUBJECTS,
  });
  const selectedWrapped = selectChaptersToIngest(afterGradeSubject, {
    onlyMissing: ONLY_MISSING,
    existingCoverage: coverage.covered,
    syllabusChapters: coverage.syllabus,
  });

  return {
    selected: selectedWrapped.map(w => w.file),
    droppedByGradeSubject: files.length - afterGradeSubject.length,
    droppedByOnlyMissing: afterGradeSubject.length - selectedWrapped.length,
  };
}

function scopingActive(): boolean {
  return FILTER_GRADES.length > 0 || FILTER_SUBJECTS.length > 0 || ONLY_MISSING;
}

/** Sorted, de-duplicated resolved (grade, subject, chapter) list for the summary. */
function resolvedTripleList(files: StorageFile[]): string[] {
  const triples = new Set<string>();
  for (const f of files) {
    triples.add(`Grade ${f.resolved.grade.padStart(2)} | ${f.resolved.subjectCode.padEnd(20)} | ch ${f.chapterNumber}`);
  }
  return [...triples].sort();
}

/** Per-run scoping + skip summary (printed for both dry-run and live). */
function printRunSummary(params: {
  totalResolved: number;
  selected: StorageFile[];
  droppedByGradeSubject: number;
  droppedByOnlyMissing: number;
  chunksWritten?: number;
  skippedMojibake?: number;
  skippedLowText?: number;
}): void {
  const { selected, totalResolved, droppedByGradeSubject, droppedByOnlyMissing } = params;
  console.log('\n' + '='.repeat(72));
  console.log('PER-RUN SCOPING SUMMARY');
  console.log('='.repeat(72));
  console.log(`  Filters: grade=[${FILTER_GRADES.join(',') || 'ALL'}] ` +
    `subject=[${FILTER_SUBJECTS.join(',') || 'ALL'}] only-missing=${ONLY_MISSING}`);
  console.log(`  Resolved chapters (pre-filter)     : ${totalResolved}`);
  console.log(`  Dropped by grade/subject filter    : ${droppedByGradeSubject}`);
  console.log(`  Dropped by --only-missing (covered/non-manifest): ${droppedByOnlyMissing}`);
  console.log(`  Chapters TARGETED (after filters)  : ${selected.length}`);
  if (params.chunksWritten !== undefined) {
    console.log(`  Chunks written                     : ${params.chunksWritten}`);
    console.log(`  Skipped (mojibake)                 : ${params.skippedMojibake ?? 0}`);
    console.log(`  Skipped (low-text / scanned)       : ${params.skippedLowText ?? 0}`);
  }
  console.log(`\n  Resolved (grade, subject, chapter) target list (${selected.length}):`);
  for (const line of resolvedTripleList(selected)) console.log(`    ${line}`);
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

async function liveIngest(files: StorageFile[]): Promise<{
  totalChunks: number; mojibakeSkipped: number; skippedFiles: number;
}> {
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
      source: SOURCE,
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

    // Idempotency guard: clear this chapter's prior chunks before re-inserting
    // so a resumed / repeated run replaces rather than duplicates them.
    const cleared = await deleteExistingChunks(file);
    if (!cleared) {
      errorFiles++;
      console.error(`  ${label}: FAILED to clear prior chunks — skipping to avoid duplicates`);
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
  console.log(`  Targeted chapters         : ${files.length}`);
  console.log(`  Chunks inserted           : ${totalChunks}`);
  console.log(`  Files skipped (low text)  : ${skippedFiles}`);
  console.log(`  Files skipped (mojibake)  : ${mojibakeSkipped}`);
  console.log(`  Files with errors         : ${errorFiles}`);

  return { totalChunks, mojibakeSkipped, skippedFiles };
}

// ─── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('ALFANUMRIK -- NCERT Storage-to-DB Ingestion');
  console.log('='.repeat(72));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (read-only)' : 'LIVE'}${PROBE ? ' + PROBE' : ''}`);
  console.log(`Bucket: ${BUCKET}`);
  console.log('');

  if (scopingActive()) {
    console.log(`Scoping: grade=[${FILTER_GRADES.join(',') || 'ALL'}] ` +
      `subject=[${FILTER_SUBJECTS.join(',') || 'ALL'}] only-missing=${ONLY_MISSING}`);
  }

  console.log('Step 1: Discovering files via filename-prefix resolver...');
  const discovery = await discoverFiles();
  console.log(`  Resolved ${discovery.files.length} chapter PDFs ` +
    `(${discovery.skippedAssets} assets skipped, ${discovery.unresolved.length} unresolved)\n`);

  if (discovery.files.length === 0) {
    console.log('No resolvable files found. Check bucket contents.');
    return;
  }

  // Apply staged-scoping filters. --only-missing needs the syllabus registry
  // from cbse_syllabus; skip the query when the flag is off (read-only either way).
  const coverage = ONLY_MISSING
    ? await fetchSyllabusCoverage()
    : { syllabus: new Set<string>(), covered: new Set<string>() };
  if (ONLY_MISSING) {
    console.log(`  cbse_syllabus (in-scope): ${coverage.syllabus.size} rows, ` +
      `${coverage.covered.size} already covered (chunk_count > 0), ` +
      `${coverage.syllabus.size - coverage.covered.size} gap rows\n`);
  }
  const { selected, droppedByGradeSubject, droppedByOnlyMissing } = applyScoping(
    discovery.files, coverage,
  );

  if (selected.length === 0) {
    printRunSummary({
      totalResolved: discovery.files.length, selected,
      droppedByGradeSubject, droppedByOnlyMissing,
    });
    console.log('\nNo chapters match the current filters — nothing to do.');
    return;
  }

  if (DRY_RUN) {
    // Coverage-delta + PROBE report over the SELECTED (scoped) subset.
    await dryRunReport({ ...discovery, files: selected });
    printRunSummary({
      totalResolved: discovery.files.length, selected,
      droppedByGradeSubject, droppedByOnlyMissing,
    });
    console.log('\nDRY RUN complete — nothing was written.');
    return;
  }

  const result = await liveIngest(selected);
  printRunSummary({
    totalResolved: discovery.files.length, selected,
    droppedByGradeSubject, droppedByOnlyMissing,
    chunksWritten: result.totalChunks,
    skippedMojibake: result.mojibakeSkipped,
    skippedLowText: result.skippedFiles,
  });

  console.log('\nDone. Next steps:');
  console.log('  1. Run: npx tsx --env-file=.env.local scripts/ncert-ingestion/validate.ts');
  console.log('  2. Run: npm run ncert:embed');
  console.log('  3. Invalidate Foxy RAG cache');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
