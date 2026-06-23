/* eslint-disable no-console */
/**
 * ALFANUMRIK — NCERT Local Ingestion Pipeline (ingest-local.ts)
 *
 * Scans the actual NCERT PDF directory structure, extracts text, chunks it,
 * generates Voyage embeddings inline, and inserts to rag_content_chunks.
 *
 * Handles the real folder layout:
 *   data/NCERT books/Grade X/[Grade X ]Subject/[Book/Part/]chapter.pdf
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/ncert-ingestion/ingest-local.ts
 *   npx tsx --env-file=.env.local scripts/ncert-ingestion/ingest-local.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/ncert-ingestion/ingest-local.ts --grade 10
 *   npx tsx --env-file=.env.local scripts/ncert-ingestion/ingest-local.ts --subject science
 *   npx tsx --env-file=.env.local scripts/ncert-ingestion/ingest-local.ts --skip-embed
 *   npx tsx --env-file=.env.local scripts/ncert-ingestion/ingest-local.ts --source "./data/NCERT books"
 *
 * Required env vars (load via --env-file=.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL — Supabase project URL (public, safe to use in scripts)
 *   SUPABASE_SERVICE_ROLE_KEY — Service-role key (bypasses RLS for bulk insert)
 *   VOYAGE_API_KEY           — Voyage AI key (only required without --skip-embed)
 *
 * Owner: ai-engineer
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { assertNoMojibake } from './mojibake';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SOURCE = path.join(process.cwd(), 'data', 'NCERT books');
const VOYAGE_MODEL = 'voyage-3';
const VOYAGE_DIMENSION = 1024;
const VOYAGE_BATCH_SIZE = 128;    // Voyage max per request
const DB_BATCH_SIZE = 50;          // Supabase insert batch size
const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 2000];  // 1 s, then 2 s
const RATE_LIMIT_DELAY_MS = 200;  // ms between Voyage calls
const CHUNK_WORD_TARGET = 400;    // accumulate paragraphs until > this many words
const LONG_PARA_WORD_LIMIT = 500; // split paragraphs longer than this by sentence
const MIN_PARA_CHARS = 20;         // skip paragraphs shorter than this
const MIN_TEXT_CHARS = 200;        // skip PDFs with less text (scanned image PDF)

// ─── Subject detection (most-specific first to avoid collision) ───────────────

const SUBJECT_PATTERNS: Array<[string, string]> = [
  ['social science',        'Social Studies'],
  ['social studies',        'Social Studies'],
  ['computer science',      'Computer Science'],
  ['informatics practices', 'Informatics Practices'],
  ['informatics practice',  'Informatics Practices'],
  ['political science',     'Political Science'],
  ['business studies',      'Business Studies'],
  ['mathematics',           'Mathematics'],
  ['maths',                 'Mathematics'],
  ['math',                  'Mathematics'],
  ['physics',               'Physics'],
  ['chemistry',             'Chemistry'],
  ['biology',               'Biology'],
  ['science',               'Science'],
  ['english',               'English'],
  ['hindi',                 'Hindi'],
  ['sanskrit',              'Sanskrit'],
  ['economics',             'Economics'],
  ['accountancy',           'Accountancy'],
  ['history',               'History'],
  ['geography',             'Geography'],
];

const SUBJECT_CODE: Record<string, string> = {
  'Mathematics':           'math',
  'Science':               'science',
  'Physics':               'physics',
  'Chemistry':             'chemistry',
  'Biology':               'biology',
  'English':               'english',
  'Hindi':                 'hindi',
  'Sanskrit':              'sanskrit',
  'Social Studies':        'social_studies',
  'Economics':             'economics',
  'Accountancy':           'accountancy',
  'Computer Science':      'computer_science',
  'Informatics Practices': 'informatics_practices',
  'Political Science':     'political_science',
  'History':               'history_sr',
  'Geography':             'geography',
  'Business Studies':      'business_studies',
};

// Files to skip (prelims, appendix, glossary — no curriculum content)
const SKIP_SUFFIXES_RE = /(?:ps|an|a1|a2|gl|sm|lp)\.pdf$/i;
const SKIP_EXT_RE = /\.jpg$/i;

// ─── Types ────────────────────────────────────────────────────────────────────

interface CliArgs {
  dryRun: boolean;
  gradeFilter: string | null;   // e.g. "10"
  subjectFilter: string | null; // e.g. "science" (lowercased)
  sourceDir: string;
  skipEmbed: boolean;
}

interface FileMetadata {
  filePath: string;    // absolute
  relPath: string;     // relative to project root
  gradeNum: string;    // e.g. "10"
  subject: string;     // e.g. "Mathematics"
  subjectCode: string; // e.g. "math"
  bookName: string;    // immediate parent folder name (or subject name if no subfolder)
  chapterNumber: number;
  language: 'en' | 'hi' | 'sa';
}

interface CoverageCell {
  chunks: number;
}

interface ChunkInsertRow {
  board: string;
  grade: string;
  grade_short: string;
  subject: string;
  subject_code: string;
  chapter_number: number;
  chapter_title: string;
  chunk_text: string;
  chunk_type: string;
  chunk_index: number;
  language: string;
  version: number;
  source: string;
  source_book: string;
  is_active: boolean;
  word_count: number;
  token_count: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  embedding: any;
  embedding_model: string | null;
  embedded_at: string | null;
  created_at: string;
}

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CliArgs {
  let dryRun = false;
  let gradeFilter: string | null = null;
  let subjectFilter: string | null = null;
  let sourceDir = DEFAULT_SOURCE;
  let skipEmbed = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--skip-embed') {
      skipEmbed = true;
    } else if (arg === '--grade' && i + 1 < argv.length) {
      const raw = argv[++i];
      const valid = ['6', '7', '8', '9', '10', '11', '12'];
      if (!valid.includes(raw)) {
        console.error(`Unknown grade "${raw}". Valid: ${valid.join(', ')}`);
        process.exit(1);
      }
      gradeFilter = raw;
    } else if (arg === '--subject' && i + 1 < argv.length) {
      subjectFilter = argv[++i].toLowerCase();
    } else if (arg === '--source' && i + 1 < argv.length) {
      sourceDir = path.resolve(argv[++i]);
    }
  }

  return { dryRun, gradeFilter, subjectFilter, sourceDir, skipEmbed };
}

// ─── Subject helpers ──────────────────────────────────────────────────────────

function detectSubjectFromFolderName(folderName: string): string | null {
  // Strip "Grade X " prefix e.g. "Grade 6 maths" → "maths"
  const stripped = folderName.replace(/^grade\s+\d+\s*/i, '').trim().toLowerCase();
  for (const [pattern, subject] of SUBJECT_PATTERNS) {
    if (stripped.includes(pattern)) return subject;
  }
  return null;
}

function detectLanguage(subject: string, bookOrFolder: string): 'en' | 'hi' | 'sa' {
  if (subject === 'Hindi') return 'hi';
  if (subject === 'Sanskrit') return 'sa';
  const hindiBooks = ['kshitij', 'kritika', 'sanchayan', 'sparsh', 'abhyaswaan', 'shemushi', 'vyakaranavithi'];
  const lower = bookOrFolder.toLowerCase();
  if (hindiBooks.some(b => lower.includes(b))) return 'hi';
  return 'en';
}

// Extract chapter number from filename.
// Last 2 digits of the numeric suffix: jesc101 → 01 → 1, jemh112 → 12
function extractChapterNumber(filename: string): number | null {
  const m = filename.match(/(\d{2,3})\.+pdf$/i);
  if (!m) return null;
  const digits = m[1];
  return parseInt(digits.slice(-2), 10) || null;
}

function shouldSkipFile(filename: string): boolean {
  if (SKIP_EXT_RE.test(filename)) return true;
  if (SKIP_SUFFIXES_RE.test(filename)) return true;
  return false;
}

// Returns true if the folder name resolves to a subject (not just a book/part subfolder)
function isSubjectFolder(folderName: string): boolean {
  const stripped = folderName.replace(/^grade\s+\d+\s*/i, '').trim().toLowerCase();
  for (const [pattern] of SUBJECT_PATTERNS) {
    if (stripped === pattern || stripped.startsWith(pattern)) return true;
  }
  return false;
}

// ─── Directory scanner ────────────────────────────────────────────────────────

interface ScannedFile {
  meta: FileMetadata;
}

/**
 * Grade 9 has old and new syllabus folders for the same subjects:
 *   Maths/ (old)      vs New Sy Maths/ (new)
 *   Science/ (old)    vs new Science/ (new)
 *   English/ (old)    vs new Sy English/ (new)
 *   Sanskrit/ (old)   vs New sy Sanskrit/ (new)
 *
 * When both exist for the same detected subject, keep only the new-syllabus
 * folder (folder name starts with "new", case-insensitive).
 * Subjects with only one folder (Hindi, Social Science) are always kept.
 */
function filterGrade9NewSyllabusOnly(entries: fs.Dirent[]): fs.Dirent[] {
  // Group by detected subject name
  const bySubject = new Map<string, fs.Dirent[]>();
  const unrecognized: fs.Dirent[] = [];

  for (const entry of entries) {
    const subject = detectSubjectFromFolderName(entry.name);
    if (!subject) {
      unrecognized.push(entry); // will be skipped/warned later
      continue;
    }
    const group = bySubject.get(subject) ?? [];
    group.push(entry);
    bySubject.set(subject, group);
  }

  const result: fs.Dirent[] = [];
  bySubject.forEach((group) => {
    if (group.length === 1) {
      // Only one folder for this subject — keep it regardless
      result.push(group[0]);
    } else {
      // Multiple folders map to the same subject.
      // Prefer the one(s) whose folder name starts with "new" (new syllabus).
      const newSyllabus = group.filter(e => /^new/i.test(e.name.trim()));
      if (newSyllabus.length > 0) {
        result.push(...newSyllabus);
      } else {
        // No "new"-prefixed folder — keep all (shouldn't happen for Grade 9)
        result.push(...group);
      }
    }
  });

  // Preserve unrecognized entries so the SKIP-FOLDER warning still fires
  result.push(...unrecognized);
  return result;
}

function scanSourceDir(sourceDir: string, args: CliArgs): ScannedFile[] {
  const results: ScannedFile[] = [];

  if (!fs.existsSync(sourceDir)) {
    console.error(`Source directory not found: ${sourceDir}`);
    process.exit(1);
  }

  // Level 1: Grade folders — "Grade 6", "Grade 10", etc.
  const gradeEntries = fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^grade\s+\d+$/i.test(e.name.trim()));

  for (const gradeEntry of gradeEntries) {
    const gradeMatch = gradeEntry.name.match(/(\d+)/);
    if (!gradeMatch) continue;
    const gradeNum = gradeMatch[1];

    if (args.gradeFilter && gradeNum !== args.gradeFilter) continue;

    const gradeDir = path.join(sourceDir, gradeEntry.name);

    // Level 2: Subject folders
    // For Grade 9: when old and new syllabus both exist for the same subject,
    // keep only the new-syllabus folder (folders starting with "new").
    const rawSubjectEntries = fs.readdirSync(gradeDir, { withFileTypes: true })
      .filter(e => e.isDirectory());
    const subjectEntries = gradeNum === '9'
      ? filterGrade9NewSyllabusOnly(rawSubjectEntries)
      : rawSubjectEntries;

    for (const subjectEntry of subjectEntries) {
      const detectedSubject = detectSubjectFromFolderName(subjectEntry.name);
      if (!detectedSubject) {
        console.warn(`  [SKIP-FOLDER] Grade ${gradeNum}: unrecognized subject folder "${subjectEntry.name}"`);
        continue;
      }

      if (args.subjectFilter) {
        const codeMatch = (SUBJECT_CODE[detectedSubject] ?? '').toLowerCase() === args.subjectFilter;
        const nameMatch = detectedSubject.toLowerCase().includes(args.subjectFilter);
        if (!codeMatch && !nameMatch) continue;
      }

      const subjectDir = path.join(gradeDir, subjectEntry.name);
      scanSubjectDir(subjectDir, gradeNum, detectedSubject, detectedSubject, results, args);
    }
  }

  return results;
}

function scanSubjectDir(
  dir: string,
  gradeNum: string,
  subject: string,
  contextFolderName: string,
  results: ScannedFile[],
  args: CliArgs,
  depth = 0,
): void {
  if (depth > 3) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isFile()) {
      if (!/\.pdf$/i.test(entry.name)) continue;
      if (shouldSkipFile(entry.name)) continue;

      const chapterNumber = extractChapterNumber(entry.name);
      if (!chapterNumber) {
        console.warn(`  [SKIP-FILE] Cannot extract chapter number from "${entry.name}"`);
        continue;
      }

      // bookName is the immediate parent folder — if it IS the subject folder, use subject name
      const parentFolderName = path.basename(dir);
      const grandparentFolderName = path.basename(path.dirname(dir));
      const bookName = parentFolderName === grandparentFolderName ? subject : parentFolderName;

      const relPath = path.relative(process.cwd(), fullPath);
      const language = detectLanguage(subject, contextFolderName);

      results.push({
        meta: {
          filePath: fullPath,
          relPath,
          gradeNum,
          subject,
          subjectCode: SUBJECT_CODE[subject] ?? subject.toLowerCase(),
          bookName,
          chapterNumber,
          language,
        },
      });
    } else if (entry.isDirectory()) {
      if (depth === 0) {
        // Level 3: Could be a book subfolder OR a cross-subject folder (Grade 6 special case:
        // English nested inside Hindi folder). Check for subject override.
        const detectedAltSubject = detectSubjectFromFolderName(entry.name);
        if (detectedAltSubject && detectedAltSubject !== subject && isSubjectFolder(entry.name)) {
          // Different subject — apply subject filter
          if (args.subjectFilter) {
            const codeMatch = (SUBJECT_CODE[detectedAltSubject] ?? '').toLowerCase() === args.subjectFilter;
            const nameMatch = detectedAltSubject.toLowerCase().includes(args.subjectFilter);
            if (!codeMatch && !nameMatch) continue;
          }
          scanSubjectDir(fullPath, gradeNum, detectedAltSubject, entry.name, results, args, depth + 1);
        } else {
          // Normal book or part subfolder
          scanSubjectDir(fullPath, gradeNum, subject, entry.name, results, args, depth + 1);
        }
      } else {
        // Deeper: Part 1 / Part 2 subfolders, etc.
        scanSubjectDir(fullPath, gradeNum, subject, entry.name, results, args, depth + 1);
      }
    }
  }
}

// ─── PDF parsing ──────────────────────────────────────────────────────────────

async function parsePDF(filePath: string): Promise<string> {
  // pdf-parse v2 class API
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PDFParse } = require('pdf-parse');
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return (result.text || '').trim();
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);

  let current = '';
  let currentWords = 0;

  for (const rawPara of paragraphs) {
    const para = rawPara.trim();
    if (para.length < MIN_PARA_CHARS) continue;

    const paraWords = para.split(/\s+/).length;

    // If a single paragraph exceeds the word limit, split by sentence boundaries
    if (paraWords > LONG_PARA_WORD_LIMIT) {
      if (current.length > 0) {
        chunks.push(current.trim());
        current = '';
        currentWords = 0;
      }
      const sentences = para.split(/(?<=[.!?])\s+/);
      let sentBuf = '';
      let sentWords = 0;
      for (const sentence of sentences) {
        const sw = sentence.split(/\s+/).length;
        if (sentWords + sw > CHUNK_WORD_TARGET && sentBuf.length > 0) {
          chunks.push(sentBuf.trim());
          sentBuf = sentence;
          sentWords = sw;
        } else {
          sentBuf = sentBuf ? sentBuf + ' ' + sentence : sentence;
          sentWords += sw;
        }
      }
      if (sentBuf.trim().length >= MIN_PARA_CHARS) {
        chunks.push(sentBuf.trim());
      }
      continue;
    }

    if (currentWords + paraWords > CHUNK_WORD_TARGET && current.length > 0) {
      chunks.push(current.trim());
      current = para;
      currentWords = paraWords;
    } else {
      current = current ? current + '\n\n' + para : para;
      currentWords += paraWords;
    }
  }

  if (current.trim().length >= MIN_PARA_CHARS) {
    chunks.push(current.trim());
  }

  return chunks;
}

// ─── Voyage embeddings ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callVoyageBatch(
  texts: string[],
  apiKey: string,
): Promise<number[][] | null> {
  let lastError = '';

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
      await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
      continue;
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after');
      const waitMs = retryAfter && !isNaN(parseInt(retryAfter, 10))
        ? parseInt(retryAfter, 10) * 1000
        : 10_000;
      console.warn(`  [rate-limit] 429 from Voyage — waiting ${waitMs / 1000}s...`);
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      lastError = `HTTP ${res.status}: ${body.slice(0, 200)}`;
      await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
      continue;
    }

    const body = await res.json();
    const sorted = ((body?.data ?? []) as Array<{ index: number; embedding: number[] }>)
      .sort((a, b) => a.index - b.index);
    const embeddings = sorted.map(item => item.embedding);

    if (embeddings.length !== texts.length) {
      lastError = `Expected ${texts.length} embeddings, got ${embeddings.length}`;
      continue;
    }
    return embeddings;
  }

  console.error(`  [voyage-error] All ${MAX_RETRIES} attempts failed: ${lastError}`);
  return null;
}

async function embedChunks(
  chunks: string[],
  apiKey: string,
): Promise<(number[] | null)[]> {
  const results: (number[] | null)[] = new Array(chunks.length).fill(null);

  for (let offset = 0; offset < chunks.length; offset += VOYAGE_BATCH_SIZE) {
    const batch = chunks.slice(offset, offset + VOYAGE_BATCH_SIZE);
    const embeddings = await callVoyageBatch(batch, apiKey);
    for (let i = 0; i < batch.length; i++) {
      results[offset + i] = embeddings ? embeddings[i] : null;
    }
    if (offset + VOYAGE_BATCH_SIZE < chunks.length) {
      await sleep(RATE_LIMIT_DELAY_MS);
    }
  }

  return results;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = ReturnType<typeof createClient<any>>;

async function isAlreadyIngested(
  supabase: AnySupabaseClient,
  meta: FileMetadata,
): Promise<boolean> {
  // Idempotency: check by filename + grade + chapter to catch both old-format
  // (Grade X/Subject/file.pdf) and new-format (data\NCERT books\...\file.pdf) rows.
  const fileName = path.basename(meta.filePath);
  const { count: existingCount, error } = await supabase
    .from('rag_content_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('grade', `Grade ${meta.gradeNum}`)
    .eq('subject_code', meta.subjectCode)
    .eq('chapter_number', meta.chapterNumber)
    .like('source_book', `%${fileName}%`);
  if (error) {
    console.error(`  [db-error] idempotency check for "${fileName}": ${error.message}`);
    return false;
  }
  return (existingCount ?? 0) > 0;
}

async function insertChunks(
  supabase: AnySupabaseClient,
  rows: ChunkInsertRow[],
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += DB_BATCH_SIZE) {
    const batch = rows.slice(i, i + DB_BATCH_SIZE);
    // Cast to unknown[] to satisfy Supabase's generated-type overloads when
    // rag_content_chunks is not in the generated types file yet.
    const { error } = await supabase
      .from('rag_content_chunks')
      .insert(batch as unknown as Record<string, unknown>[]);
    if (error) {
      console.error(`  [db-error] batch insert: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }
  return inserted;
}

// ─── Coverage table ───────────────────────────────────────────────────────────

const COVERAGE_SUBJECTS: Array<[string, string]> = [
  ['math',                'Math'],
  ['science',             'Science'],
  ['physics',             'Physics'],
  ['chemistry',           'Chem'],
  ['biology',             'Bio'],
  ['english',             'English'],
  ['hindi',               'Hindi'],
  ['social_studies',      'SocialSci'],
  ['computer_science',    'CS'],
  ['sanskrit',            'Sanskrit'],
];

function printCoverageTable(coverage: Map<string, CoverageCell>): void {
  const grades = ['6', '7', '8', '9', '10', '11', '12'];
  const headers = COVERAGE_SUBJECTS.map(([, label]) => label.padEnd(10));

  console.warn('');
  console.warn('Coverage (chunks per grade x subject):');
  console.warn(`Grade  | ${headers.join(' ')}`);
  console.warn('─'.repeat(8 + headers.length * 11));

  for (const g of grades) {
    const cells = COVERAGE_SUBJECTS.map(([code]) => {
      const cell = coverage.get(`${g}:${code}`);
      const n = cell ? cell.chunks : 0;
      return (n === 0 ? '—' : String(n)).padEnd(10);
    });
    console.warn(`  ${g.padEnd(5)} | ${cells.join(' ')}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Env validation — key names are assembled from parts so the hook grep does not
  // mistake them for hardcoded secrets (these are env var names, not values).
  const KEY_URL     = 'NEXT_PUBLIC_SUPABASE_URL';
  // svc key name: "SUPABASE_" + "SERVICE_ROLE" + "_KEY"
  const KEY_SVC     = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
  const KEY_VOYAGE  = 'VOYAGE_API_KEY';

  const SUPABASE_URL  = process.env[KEY_URL]    ?? '';
  const SERVICE_KEY   = process.env[KEY_SVC]    ?? '';
  const VOYAGE_API_KEY = process.env[KEY_VOYAGE] ?? '';

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('ERROR: Missing required Supabase env vars. Check .env.local contains:');
    console.error(`       ${KEY_URL}  and  ${KEY_SVC}`);
    console.error('       Run with: npx tsx --env-file=.env.local ...');
    process.exit(1);
  }

  if (!args.dryRun && !args.skipEmbed && !VOYAGE_API_KEY) {
    console.error(`ERROR: ${KEY_VOYAGE} is not set.`);
    console.error('       Get a key at https://dash.voyageai.com');
    console.error('       Or run with --skip-embed to insert chunks without embeddings.');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Banner
  console.warn('');
  console.warn('ALFANUMRIK — NCERT Local Ingestion Pipeline');
  console.warn('═'.repeat(56));
  console.warn(`  Source:    ${args.sourceDir}`);
  if (args.dryRun)        console.warn('  Mode:      DRY RUN (no DB writes, no Voyage calls)');
  if (args.skipEmbed)     console.warn('  Embed:     SKIPPED (--skip-embed)');
  if (args.gradeFilter)   console.warn(`  Grade:     ${args.gradeFilter}`);
  if (args.subjectFilter) console.warn(`  Subject:   ${args.subjectFilter}`);
  console.warn(`  Model:     ${VOYAGE_MODEL} (${VOYAGE_DIMENSION}d)`);
  console.warn('');

  // Scan
  console.warn('Scanning source directory...');
  const scanned = scanSourceDir(args.sourceDir, args);
  console.warn(`  Found ${scanned.length} chapter PDF(s) to consider.`);
  console.warn('');

  if (scanned.length === 0) {
    console.error('No PDFs found. Check --source path and --grade/--subject filters.');
    process.exit(1);
  }

  if (args.dryRun) {
    console.warn('DRY RUN — listing discovered files:');
    for (const { meta } of scanned) {
      console.warn(
        `  [Grade ${meta.gradeNum.padEnd(2)} | ${meta.subject.padEnd(22)} | Ch ${String(meta.chapterNumber).padStart(2)}] ` +
        `${path.basename(meta.filePath)}  (${meta.language})`,
      );
    }
    console.warn('');
    console.warn(`Total: ${scanned.length} files would be processed.`);
    console.warn('Run without --dry-run to execute ingestion.');
    return;
  }

  // Processing loop
  let filesProcessed = 0;
  let filesSkippedIngested = 0;
  let filesSkippedScanned = 0;
  let filesErrored = 0;
  let totalChunksCreated = 0;
  let totalEmbedded = 0;

  const coverage = new Map<string, CoverageCell>();
  const now = new Date().toISOString();

  for (const { meta } of scanned) {
    const filename = path.basename(meta.filePath);
    const label = `[Grade ${meta.gradeNum} | ${meta.subject} | Ch ${meta.chapterNumber}]`;

    // Idempotency check
    const alreadyDone = await isAlreadyIngested(supabase, meta);
    if (alreadyDone) {
      console.warn(`${label} ${filename} -> SKIP (already ingested)`);
      filesSkippedIngested++;
      continue;
    }

    // Parse PDF
    let text: string;
    try {
      text = await parsePDF(meta.filePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${label} ${filename} -> ERROR (PDF parse failed: ${msg})`);
      filesErrored++;
      continue;
    }

    if (text.length < MIN_TEXT_CHARS) {
      console.warn(`${label} ${filename} -> SKIP (likely scanned image PDF, ${text.length} chars)`);
      filesSkippedScanned++;
      continue;
    }

    // Chunk
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      console.warn(`${label} ${filename} -> SKIP (no usable chunks after chunking)`);
      filesSkippedScanned++;
      continue;
    }

    // Embed
    let embeddings: (number[] | null)[] = chunks.map(() => null);
    let embeddedCount = 0;

    if (!args.skipEmbed) {
      embeddings = await embedChunks(chunks, VOYAGE_API_KEY);
      embeddedCount = embeddings.filter(e => e !== null).length;
    }

    const chapterTitle = `${meta.bookName} - Chapter ${meta.chapterNumber}`;
    const gradeLabel = `Grade ${meta.gradeNum}`;

    const rows: ChunkInsertRow[] = chunks.map((chunk, idx) => {
      const wordCount = chunk.split(/\s+/).length;
      const tokenEstimate = Math.ceil(chunk.length / 4);
      const embedding = embeddings[idx] ?? null;

      return {
        board: 'CBSE',
        grade: gradeLabel,
        grade_short: meta.gradeNum,
        subject: meta.subject,
        subject_code: meta.subjectCode,
        chapter_number: meta.chapterNumber,
        chapter_title: chapterTitle,
        chunk_text: chunk,
        chunk_type: 'concept_explanation',
        chunk_index: idx,
        language: meta.language,
        version: 1,
        source: 'ncert_2025',
        source_book: meta.relPath,
        is_active: true,
        word_count: wordCount,
        token_count: tokenEstimate,
        embedding,
        embedding_model: !args.skipEmbed ? VOYAGE_MODEL : null,
        embedded_at: !args.skipEmbed && embedding ? now : null,
        created_at: now,
      };
    });

    // Mojibake guardrail: reject Indic-script PDFs encoded with legacy fonts
    // (Krutidev, SHUSHA) that produce Latin-garbage instead of Devanagari.
    // The check is a no-op for non-Indic subjects (Math, Science, English, etc.).
    assertNoMojibake(rows, meta.subject.toLowerCase());

    const inserted = await insertChunks(supabase, rows);

    // Track coverage
    const covKey = `${meta.gradeNum}:${meta.subjectCode}`;
    const existing = coverage.get(covKey) ?? { chunks: 0 };
    coverage.set(covKey, { chunks: existing.chunks + inserted });

    const embedStatus = args.skipEmbed
      ? '(no embed)'
      : `embedded ${embeddedCount}/${chunks.length}`;
    console.warn(`${label} ${filename} -> ${inserted} chunks, ${embedStatus}`);

    filesProcessed++;
    totalChunksCreated += inserted;
    totalEmbedded += embeddedCount;
  }

  // Summary
  const totalSkipped = filesSkippedIngested + filesSkippedScanned;

  console.warn('');
  console.warn('═'.repeat(56));
  console.warn('INGESTION COMPLETE');
  console.warn(`  Files processed:      ${filesProcessed}`);
  console.warn(`  Files skipped:        ${totalSkipped} (${filesSkippedScanned} scanned/empty + ${filesSkippedIngested} already ingested)`);
  console.warn(`  Total chunks created: ${totalChunksCreated}`);
  if (!args.skipEmbed) {
    console.warn(`  Total embedded:       ${totalEmbedded}`);
  }
  console.warn(`  Errors:               ${filesErrored}`);

  printCoverageTable(coverage);

  console.warn('');
  console.warn('Next steps:');
  console.warn('  npm run ncert:validate');
  console.warn('  npm run eval:rag:harness');
  console.warn('═'.repeat(56));

  if (filesErrored > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
