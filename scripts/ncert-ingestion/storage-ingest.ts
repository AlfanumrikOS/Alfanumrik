/**
 * ALFANUMRIK -- NCERT Storage-to-DB Ingestion
 *
 * Downloads PDFs from Supabase Storage bucket 'ncert-books',
 * extracts text using pdf-parse, chunks, and uploads to rag_content_chunks.
 *
 * Usage:
 *   npx tsx scripts/ncert-ingestion/storage-ingest.ts
 *   npx tsx scripts/ncert-ingestion/storage-ingest.ts --dry-run
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

// ─── Subject Normalization ───────────────────────────────────

const SUBJECT_MAP: Record<string, string> = {
  'maths': 'Mathematics',
  'mathematics': 'Mathematics',
  'science': 'Science',
  'english': 'English',
  'hindi': 'Hindi',
  'social science': 'Social Studies',
  'social studies': 'Social Studies',
  'sanskrit': 'Sanskrit',
  'biology': 'Biology',
  'chemistry': 'Chemistry',
  'physics': 'Physics',
  'computer science': 'Computer Science',
  'informatics practice': 'Informatics Practices',
  'informatics practices': 'Informatics Practices',
};

function normalizeSubject(raw: string): string | null {
  const key = raw.toLowerCase().trim();
  return SUBJECT_MAP[key] ?? null;
}

function detectLanguage(subject: string, bookName: string): string {
  if (subject === 'Hindi') return 'hi';
  if (subject === 'Sanskrit') return 'sa';
  // Some Hindi-named books in other subjects
  const hindiBooks = ['kshitij', 'kritika', 'sanchayan', 'sparsh', 'abhyaswaan', 'shemushi', 'vyakaranavithi'];
  const lower = bookName.toLowerCase();
  for (const hb of hindiBooks) {
    if (lower.includes(hb)) return 'hi';
  }
  return 'en';
}

// ─── Skip Patterns ───────────────────────────────────────────

const SKIP_SUFFIXES = ['ps.pdf', 'an.pdf', 'a1.pdf', 'a2.pdf', 'gl.pdf', 'sm.pdf', 'cc.jpg'];

function shouldSkipFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (!lower.endsWith('.pdf')) return true;
  for (const suffix of SKIP_SUFFIXES) {
    if (lower.endsWith(suffix)) return true;
  }
  return false;
}

// ─── Chapter Number Extraction ───────────────────────────────

function extractChapterNumber(filename: string): number {
  // NCERT filenames: jemh101.pdf -> chapter 1, jemh116.pdf -> chapter 16
  // Pattern: letters followed by digits, last 2 digits before .pdf are chapter
  const match = filename.match(/(\d{2,3})\.pdf$/i);
  if (!match) return 0;
  const digits = match[1];
  // Last 2 digits are the chapter number
  const chapterStr = digits.slice(-2);
  return parseInt(chapterStr, 10);
}

// ─── Types ───────────────────────────────────────────────────

interface StorageFile {
  storagePath: string;
  fileName: string;
  grade: string;        // "6", "7", etc.
  gradeDb: string;      // "Grade 6", "Grade 7", etc.
  subject: string;      // Normalized: "Mathematics", "Science", etc.
  bookName: string;     // Subfolder name or subject
  chapterNumber: number;
  language: string;     // "en", "hi", or "sa"
}

interface ChunkRow {
  board: string;
  grade: string;
  subject: string;
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

async function listFolder(path: string): Promise<{ name: string; id: string | null; metadata: Record<string, unknown> | null }[]> {
  const { data, error } = await supabase.storage.from(BUCKET).list(path, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  });
  if (error) {
    console.error(`  ERROR listing ${path}:`, error.message);
    return [];
  }
  return data || [];
}

function isFolder(item: { id: string | null; metadata: Record<string, unknown> | null }): boolean {
  // Supabase Storage: folders have id=null or no metadata
  return item.id === null || item.metadata === null;
}

async function discoverFiles(): Promise<StorageFile[]> {
  const files: StorageFile[] = [];

  // Level 1: List root -> Grade folders
  const rootItems = await listFolder('');
  const gradeFolders = rootItems.filter(item => isFolder(item) && item.name.startsWith('Grade '));

  for (const gradeFolder of gradeFolders) {
    const gradeMatch = gradeFolder.name.match(/Grade\s+(\d+)/);
    if (!gradeMatch) continue;
    const gradeNum = gradeMatch[1]; // "6", "10", etc.
    const gradeDb = `Grade ${gradeNum}`;

    // Level 2: List grade folder -> Subject folders (or files)
    const subjectItems = await listFolder(gradeFolder.name);

    for (const subjectItem of subjectItems) {
      if (!isFolder(subjectItem)) {
        // Could be a loose file in grade folder - skip non-PDFs, skip skip-patterns
        // These are unusual; log and skip
        continue;
      }

      // Determine subject name
      let rawSubject = subjectItem.name;

      // Grade 6 has "Grade 6 English" style naming - strip prefix
      const gradePrefix = `Grade ${gradeNum} `;
      if (rawSubject.startsWith(gradePrefix)) {
        rawSubject = rawSubject.substring(gradePrefix.length);
      }

      const normalizedSubject = normalizeSubject(rawSubject);
      if (!normalizedSubject) {
        console.warn(`  WARN: Unknown subject "${rawSubject}" in ${gradeFolder.name}/${subjectItem.name} -- skipping`);
        continue;
      }

      // Level 3: List subject folder -> PDF files or book subfolders
      const subjectPath = `${gradeFolder.name}/${subjectItem.name}`;
      const level3Items = await listFolder(subjectPath);

      for (const l3Item of level3Items) {
        if (isFolder(l3Item)) {
          // Book subfolder (e.g., "First Flight", "Shemushi Prathmo")
          const bookPath = `${subjectPath}/${l3Item.name}`;
          const bookItems = await listFolder(bookPath);

          for (const bookFile of bookItems) {
            if (isFolder(bookFile)) continue; // Ignore deeper nesting
            if (shouldSkipFile(bookFile.name)) continue;

            files.push({
              storagePath: `${bookPath}/${bookFile.name}`,
              fileName: bookFile.name,
              grade: gradeNum,
              gradeDb,
              subject: normalizedSubject,
              bookName: l3Item.name,
              chapterNumber: extractChapterNumber(bookFile.name),
              language: detectLanguage(normalizedSubject, l3Item.name),
            });
          }
        } else {
          // Direct PDF in subject folder
          if (shouldSkipFile(l3Item.name)) continue;

          files.push({
            storagePath: `${subjectPath}/${l3Item.name}`,
            fileName: l3Item.name,
            grade: gradeNum,
            gradeDb,
            subject: normalizedSubject,
            bookName: rawSubject,
            chapterNumber: extractChapterNumber(l3Item.name),
            language: detectLanguage(normalizedSubject, rawSubject),
          });
        }
      }
    }
  }

  return files;
}

// ─── PDF Download & Parse ────────────────────────────────────

async function downloadAndParse(file: StorageFile): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(file.storagePath);
  if (error || !data) {
    console.error(`  ERROR downloading ${file.storagePath}:`, error?.message || 'no data');
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
    const buffer = Buffer.from(await data.arrayBuffer());
    const parsed = await pdfParse(buffer);
    const text = (parsed.text || '').trim();

    if (text.length < MIN_TEXT_LENGTH) {
      console.log(`    Skipped (only ${text.length} chars -- likely scanned/image PDF)`);
      return null;
    }
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ERROR parsing PDF ${file.storagePath}:`, msg);
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
      // Current chunk is full, push it
      chunks.push(current.trim());
      current = para;
    } else if (tokens > 500 && current.length === 0) {
      // Single paragraph exceeds limit -- split on sentences
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

  // Push remaining
  if (current.trim().length > 20) {
    chunks.push(current.trim());
  }

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

async function deprecateLegacyContent(): Promise<number> {
  // First count how many active legacy chunks exist
  const { count: beforeCount, error: countError } = await supabase
    .from('rag_content_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'legacy')
    .eq('is_active', true);

  if (countError) {
    console.error('  ERROR counting legacy content:', countError.message);
    return 0;
  }

  if (!beforeCount || beforeCount === 0) {
    console.log('  No active legacy chunks found to deprecate');
    return 0;
  }

  // Now deprecate them
  const { error } = await supabase
    .from('rag_content_chunks')
    .update({ is_active: false })
    .eq('source', 'legacy')
    .eq('is_active', true);

  if (error) {
    console.error('  ERROR deprecating legacy content:', error.message);
    return 0;
  }

  return beforeCount;
}

// ─── Summary ─────────────────────────────────────────────────

interface GradeSubjectCount {
  [gradeSubject: string]: number;
}

function printSummary(
  totalFiles: number,
  totalChunks: number,
  skippedFiles: number,
  errorFiles: number,
  matrix: GradeSubjectCount
): void {
  console.log('\n' + '='.repeat(70));
  console.log('INGESTION SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Total files processed: ${totalFiles}`);
  console.log(`  Total chunks inserted: ${totalChunks}`);
  console.log(`  Files skipped (low text): ${skippedFiles}`);
  console.log(`  Files with errors: ${errorFiles}`);
  console.log('');

  // Build grade x subject matrix
  const grades = new Set<string>();
  const subjects = new Set<string>();
  for (const key of Object.keys(matrix)) {
    const [g, s] = key.split('|');
    grades.add(g);
    subjects.add(s);
  }

  const sortedGrades = Array.from(grades).sort((a, b) => parseInt(a) - parseInt(b));
  const sortedSubjects = Array.from(subjects).sort();

  // Header
  const subjectHeaders = sortedSubjects.map(s => s.substring(0, 12).padEnd(12));
  console.log('  Grade  | ' + subjectHeaders.join(' | '));
  console.log('  ' + '-'.repeat(10 + sortedSubjects.length * 15));

  for (const g of sortedGrades) {
    const cells = sortedSubjects.map(s => {
      const count = matrix[`${g}|${s}`] || 0;
      return (count > 0 ? String(count) : '-').padEnd(12);
    });
    console.log(`  ${g.padEnd(6)} | ${cells.join(' | ')}`);
  }
}

// ─── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('ALFANUMRIK -- NCERT Storage-to-DB Ingestion');
  console.log('='.repeat(70));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no downloads, no DB writes)' : 'LIVE'}`);
  console.log(`Bucket: ${BUCKET}`);
  console.log('');

  // Step 1: Discover all files
  console.log('Step 1: Discovering files in Supabase Storage...');
  const files = await discoverFiles();
  console.log(`  Found ${files.length} PDF files to process\n`);

  if (files.length === 0) {
    console.log('No files found. Check bucket contents.');
    return;
  }

  // Dry run: just list files and exit
  if (DRY_RUN) {
    console.log('DRY RUN -- File listing:\n');
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      console.log(
        `  [${i + 1}/${files.length}] Grade ${f.grade} | ${f.subject} | ` +
        `Ch ${f.chapterNumber} | Book: ${f.bookName} | ${f.fileName}`
      );
    }

    // Summary by grade/subject
    const counts: Record<string, number> = {};
    for (const f of files) {
      const key = `${f.grade}|${f.subject}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    console.log('\nFile counts by Grade x Subject:');
    printSummary(files.length, 0, 0, 0, counts);
    return;
  }

  // Step 2: Process files sequentially
  console.log('Step 2: Downloading, parsing, chunking, and uploading...\n');

  let totalChunks = 0;
  let skippedFiles = 0;
  let errorFiles = 0;
  const matrix: GradeSubjectCount = {};
  const now = new Date().toISOString();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const label = `[${i + 1}/${files.length}] Grade ${file.grade} ${file.subject} - ${file.fileName}`;

    // Download and parse
    const text = await downloadAndParse(file);
    if (text === null) {
      // Could be either skip (low text) or download/parse error - already logged
      skippedFiles++;
      continue;
    }

    // Chunk
    const textChunks = chunkText(text);
    if (textChunks.length === 0) {
      console.log(`  ${label}: 0 chunks (text too short after chunking)`);
      skippedFiles++;
      continue;
    }

    // Build rows — must include all NOT NULL columns from rag_content_chunks
    const rows: ChunkRow[] = textChunks.map((chunk, idx) => ({
      board: 'CBSE',
      grade: file.gradeDb,
      subject: file.subject,
      chunk_text: chunk,
      chunk_type: 'concept_explanation',
      chunk_index: idx,
      language: file.language,
      version: 1,
      chapter_number: file.chapterNumber,
      chapter_title: file.bookName,
      source: 'ncert_2025',
      source_book: file.storagePath,
      is_active: true,
      word_count: chunk.split(/\s+/).filter((w: string) => w.length > 0).length,
      token_count: estimateTokens(chunk),
      created_at: now,
    }));

    // Insert
    const inserted = await insertBatch(rows);
    if (inserted === 0 && rows.length > 0) {
      errorFiles++;
      console.error(`  ${label}: FAILED to insert ${rows.length} chunks`);
      continue;
    }

    totalChunks += inserted;
    const matrixKey = `${file.grade}|${file.subject}`;
    matrix[matrixKey] = (matrix[matrixKey] || 0) + inserted;

    console.log(`  ${label}: ${inserted} chunks uploaded`);
  }

  // Step 3: Deprecate legacy content
  console.log('\nStep 3: Deprecating legacy content...');
  const deprecated = await deprecateLegacyContent();
  console.log(`  Deprecated ${deprecated} legacy chunks (set is_active=false)`);

  // Step 4: Summary
  const processedFiles = files.length - skippedFiles - errorFiles;
  printSummary(processedFiles, totalChunks, skippedFiles, errorFiles, matrix);

  console.log('\nDone. Next steps:');
  console.log('  1. Run: npx tsx scripts/ncert-ingestion/validate.ts');
  console.log('  2. Invalidate Foxy RAG cache');
  console.log('  3. Test retrieval with match_rag_chunks()');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
