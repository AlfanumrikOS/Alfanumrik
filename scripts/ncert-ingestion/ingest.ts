/**
 * ALFANUMRIK — NCERT Curriculum Ingestion Pipeline
 *
 * Scans a local NCERT books directory, extracts text + images,
 * maps to curriculum schema, and prepares data for Supabase import.
 *
 * Usage:
 *   npx tsx scripts/ncert-ingestion/ingest.ts --source "/path/to/NCERT books"
 *
 * Requirements:
 *   - NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars
 *   - pdf-parse (npm install pdf-parse) for PDF extraction
 *   - sharp (npm install sharp) for image processing (optional)
 *
 * Pipeline:
 *   1. Discover: scan directory for PDFs organized by class/subject
 *   2. Parse: extract text and images from each PDF
 *   3. Map: assign class, subject, chapter, section, page numbers
 *   4. Chunk: create retrieval-sized text chunks (200-500 tokens)
 *   5. Store: upload to rag_content_chunks + curriculum_topics
 *   6. Deprecate: mark old content is_active = false
 *   7. Validate: verify coverage across all grades/subjects
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// ─── Configuration ───────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// NCERT class-to-grade mapping
const CLASS_TO_GRADE: Record<string, string> = {
  'class 6': '6', 'class 7': '7', 'class 8': '8',
  'class 9': '9', 'class 10': '10', 'class 11': '11', 'class 12': '12',
  'vi': '6', 'vii': '7', 'viii': '8', 'ix': '9', 'x': '10', 'xi': '11', 'xii': '12',
  '6': '6', '7': '7', '8': '8', '9': '9', '10': '10', '11': '11', '12': '12',
};

// Subject name normalization
const SUBJECT_NORMALIZE: Record<string, string> = {
  'mathematics': 'math', 'maths': 'math', 'math': 'math',
  'science': 'science',
  'physics': 'physics',
  'chemistry': 'chemistry',
  'biology': 'biology',
  'english': 'english',
  'hindi': 'hindi',
  'social science': 'social_studies', 'social studies': 'social_studies',
  'economics': 'economics',
  'accountancy': 'accountancy',
  'business studies': 'business_studies',
  'political science': 'political_science',
  'history': 'history_sr',
  'geography': 'geography',
  'computer science': 'computer_science',
};

// DB format normalization — rag_content_chunks uses "Grade 10" and "Mathematics"
const GRADE_TO_DB: Record<string, string> = {
  '6': 'Grade 6', '7': 'Grade 7', '8': 'Grade 8',
  '9': 'Grade 9', '10': 'Grade 10', '11': 'Grade 11', '12': 'Grade 12',
};

const SUBJECT_TO_DB: Record<string, string> = {
  'math': 'Mathematics', 'science': 'Science',
  'physics': 'Physics', 'chemistry': 'Chemistry', 'biology': 'Biology',
  'english': 'English', 'hindi': 'Hindi',
  'social_studies': 'Social Studies', 'economics': 'Economics',
  'accountancy': 'Accountancy', 'business_studies': 'Business Studies',
  'political_science': 'Political Science', 'history_sr': 'History',
  'geography': 'Geography', 'computer_science': 'Computer Science',
};

function toDbGrade(g: string): string { return GRADE_TO_DB[g] || `Grade ${g}`; }
function toDbSubject(s: string): string { return SUBJECT_TO_DB[s] || s; }

// ─── Types ───────────────────────────────────────────────────

interface DiscoveredBook {
  filePath: string;
  fileName: string;
  grade: string;
  subject: string;
  bookTitle: string;
}

interface ExtractedChapter {
  chapterNumber: number;
  title: string;
  text: string;
  pageStart: number;
  pageEnd: number;
  images: ExtractedImage[];
}

interface ExtractedImage {
  data: Buffer;
  format: string;
  pageNumber: number;
  caption?: string;
  width?: number;
  height?: number;
}

interface ContentChunk {
  grade: string;
  subject: string;
  chapterNumber: number;
  chapterTitle: string;
  sectionTitle?: string;
  content: string;
  pageNumber: number;
  sourceBook: string;
  chunkIndex: number;
  tokenEstimate: number;
}

interface ImageRecord {
  grade: string;
  subject: string;
  chapterNumber: number;
  chapterTitle: string;
  pageNumber: number;
  caption?: string;
  storagePath: string;
  mediaType: string;
}

// ─── Step 1: Discover Books ──────────────────────────────────

function discoverBooks(sourceDir: string): DiscoveredBook[] {
  const books: DiscoveredBook[] = [];

  if (!fs.existsSync(sourceDir)) {
    console.error(`Source directory not found: ${sourceDir}`);
    process.exit(1);
  }

  function scanDir(dir: string, depth = 0) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && depth < 3) {
        scanDir(fullPath, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.pdf', '.txt', '.md'].includes(ext)) continue;

      // Try to extract grade and subject from path/filename
      const pathParts = fullPath.replace(sourceDir, '').toLowerCase().split(/[\\/]/);
      const allText = pathParts.join(' ') + ' ' + entry.name.toLowerCase();

      let grade = '';
      let subject = '';

      // Find grade
      for (const [pattern, g] of Object.entries(CLASS_TO_GRADE)) {
        if (allText.includes(pattern)) {
          grade = g;
          break;
        }
      }

      // Find subject
      for (const [pattern, s] of Object.entries(SUBJECT_NORMALIZE)) {
        if (allText.includes(pattern)) {
          subject = s;
          break;
        }
      }

      if (grade && subject) {
        books.push({
          filePath: fullPath,
          fileName: entry.name,
          grade,
          subject,
          bookTitle: entry.name.replace(ext, ''),
        });
      } else {
        console.warn(`  ⚠️ Could not determine grade/subject for: ${fullPath}`);
        console.warn(`     Grade: ${grade || 'UNKNOWN'}, Subject: ${subject || 'UNKNOWN'}`);
      }
    }
  }

  scanDir(sourceDir);
  return books;
}

// ─── Step 2: Parse Book Content ──────────────────────────────

async function parseBook(book: DiscoveredBook): Promise<ExtractedChapter[]> {
  const ext = path.extname(book.filePath).toLowerCase();

  if (ext === '.pdf') {
    return parsePDF(book);
  } else if (ext === '.txt' || ext === '.md') {
    return parseText(book);
  }

  return [];
}

async function parsePDF(book: DiscoveredBook): Promise<ExtractedChapter[]> {
  try {
    // @ts-expect-error -- pdf-parse has no type declarations
    const pdfParse = (await import('pdf-parse')).default;
    const dataBuffer = fs.readFileSync(book.filePath);
    const data = await pdfParse(dataBuffer);

    const textLen = (data.text || '').trim().length;
    console.log(`     PDF text extracted: ${textLen} chars, ${data.numpages || '?'} pages`);

    if (textLen < 100) {
      console.warn(`     ⚠️ Very little text extracted — PDF may be scanned/image-based`);
      return [];
    }

    return splitIntoChapters(data.text, book);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ Failed to parse PDF: ${book.filePath}`, msg);
    if (msg.includes('Cannot find module')) {
      console.error(`     Install pdf-parse: npm install pdf-parse`);
    }
    return [];
  }
}

function parseText(book: DiscoveredBook): ExtractedChapter[] {
  const text = fs.readFileSync(book.filePath, 'utf-8');
  return splitIntoChapters(text, book);
}

function splitIntoChapters(text: string, book: DiscoveredBook): ExtractedChapter[] {
  // Try multiple chapter heading patterns (NCERT uses various formats)
  const patterns = [
    /(?:^|\n)\s*(?:Chapter|CHAPTER)\s+(\d+)\s*[:\.\-—]?\s*(.+?)(?:\n|$)/gm,
    /(?:^|\n)\s*(?:Unit|UNIT)\s+(\d+)\s*[:\.\-—]?\s*(.+?)(?:\n|$)/gm,
    /(?:^|\n)\s*(\d+)\.\s+([A-Z][A-Za-z\s,'-]+)(?:\n|$)/gm,
    /(?:^|\n)\s*अध्याय\s+(\d+)\s*[:\.\-—]?\s*(.+?)(?:\n|$)/gm, // Hindi: अध्याय = Chapter
  ];

  const chapters: ExtractedChapter[] = [];
  let matches: RegExpExecArray[] = [];

  for (const regex of patterns) {
    matches = Array.from(text.matchAll(regex));
    if (matches.length >= 2) break; // Found chapters with this pattern
  }

  if (matches.length === 0) {
    // No chapter headings found — split by page breaks or large gaps
    // Still create a single chapter so content isn't lost
    if (text.trim().length > 100) {
      chapters.push({
        chapterNumber: 1,
        title: book.bookTitle,
        text: text.trim(),
        pageStart: 1,
        pageEnd: 1,
        images: [],
      });
      console.log(`     ℹ️ No chapter headings detected — created 1 chapter from entire text`);
    }
    return chapters;
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const nextMatch = matches[i + 1];
    const chapterNum = parseInt(match[1]);
    const title = match[2].trim();
    const startIdx = match.index! + match[0].length;
    const endIdx = nextMatch ? nextMatch.index! : text.length;
    const chapterText = text.substring(startIdx, endIdx).trim();

    chapters.push({
      chapterNumber: chapterNum,
      title,
      text: chapterText,
      pageStart: i + 1, // Approximate
      pageEnd: i + 1,
      images: [],
    });
  }

  return chapters;
}

// ─── Step 3: Create Chunks ───────────────────────────────────

function chunkChapter(chapter: ExtractedChapter, book: DiscoveredBook): ContentChunk[] {
  const chunks: ContentChunk[] = [];
  const text = chapter.text;

  // Split by paragraphs first
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 30);

  let currentChunk = '';
  let chunkIdx = 0;

  for (const para of paragraphs) {
    const combined = currentChunk + '\n\n' + para;
    const tokenEstimate = combined.split(/\s+/).length;

    if (tokenEstimate > 400 && currentChunk.length > 0) {
      // Save current chunk
      chunks.push({
        grade: book.grade,
        subject: book.subject,
        chapterNumber: chapter.chapterNumber,
        chapterTitle: chapter.title,
        content: currentChunk.trim(),
        pageNumber: chapter.pageStart,
        sourceBook: book.bookTitle,
        chunkIndex: chunkIdx++,
        tokenEstimate: currentChunk.split(/\s+/).length,
      });
      currentChunk = para;
    } else {
      currentChunk = combined;
    }
  }

  // Save remaining
  if (currentChunk.trim().length > 30) {
    chunks.push({
      grade: book.grade,
      subject: book.subject,
      chapterNumber: chapter.chapterNumber,
      chapterTitle: chapter.title,
      content: currentChunk.trim(),
      pageNumber: chapter.pageStart,
      sourceBook: book.bookTitle,
      chunkIndex: chunkIdx,
      tokenEstimate: currentChunk.split(/\s+/).length,
    });
  }

  return chunks;
}

// ─── Step 4: Deprecate Old Content ───────────────────────────

async function deprecateOldContent(grade: string, subject: string): Promise<number> {
  const dbGrade = toDbGrade(grade);
  const dbSubject = toDbSubject(subject);
  const { error } = await supabase
    .from('rag_content_chunks')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('grade', dbGrade)
    .eq('subject', dbSubject)
    .eq('is_active', true);

  if (error) {
    console.error(`  ❌ Failed to deprecate old content for ${grade}/${subject}:`, error.message);
    return 0;
  }

  // Count what was deprecated
  const { count } = await supabase
    .from('rag_content_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('grade', dbGrade)
    .eq('subject', dbSubject)
    .eq('is_active', false)
    .eq('source', 'legacy');

  return count || 0;
}

// ─── Step 5: Upload New Content ──────────────────────────────

async function uploadChunks(chunks: ContentChunk[]): Promise<number> {
  let uploaded = 0;

  // Batch insert in groups of 50
  for (let i = 0; i < chunks.length; i += 50) {
    const batch = chunks.slice(i, i + 50).map(chunk => ({
      grade: toDbGrade(chunk.grade),
      subject: toDbSubject(chunk.subject),
      chapter_number: chunk.chapterNumber,
      chapter_title: chunk.chapterTitle,
      section_title: chunk.sectionTitle || null,
      chunk_text: chunk.content,
      page_number: chunk.pageNumber,
      source_book: chunk.sourceBook,
      chunk_index: chunk.chunkIndex,
      token_count: chunk.tokenEstimate,
      is_active: true,
      source: 'ncert_2025',
      created_at: new Date().toISOString(),
    }));

    const { error } = await supabase.from('rag_content_chunks').insert(batch);
    if (error) {
      console.error(`  ❌ Batch insert failed:`, error.message);
    } else {
      uploaded += batch.length;
    }
  }

  return uploaded;
}

// ─── Step 6: Update Curriculum Topics ────────────────────────

async function updateCurriculumTopics(chapters: ExtractedChapter[], book: DiscoveredBook): Promise<number> {
  let updated = 0;

  for (const chapter of chapters) {
    const { error } = await supabase.from('curriculum_topics').upsert({
      grade: book.grade,
      title: chapter.title,
      chapter_number: chapter.chapterNumber,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'grade,chapter_number,title' });

    if (error) {
      console.error(`  ⚠️ Failed to upsert topic: ${chapter.title}`, error.message);
    } else {
      updated++;
    }
  }

  return updated;
}

// ─── Step 7: Validate Coverage ───────────────────────────────

async function validateCoverage(): Promise<void> {
  console.log('\n📊 COVERAGE VALIDATION\n');

  const { data, error } = await supabase
    .from('rag_content_chunks')
    .select('grade, subject')
    .eq('is_active', true)
    .eq('source', 'ncert_2025');

  if (error || !data) {
    console.error('❌ Validation query failed:', error?.message);
    return;
  }

  // Count by grade × subject
  const counts: Record<string, number> = {};
  for (const row of data) {
    const key = `${row.grade}|${row.subject}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  const grades = ['6', '7', '8', '9', '10', '11', '12'];
  const subjects = ['math', 'science', 'physics', 'chemistry', 'biology', 'english', 'hindi', 'social_studies'];

  console.log('Grade | ' + subjects.map(s => s.padEnd(12)).join(' | '));
  console.log('-'.repeat(120));

  for (const g of grades) {
    const row = subjects.map(s => {
      const count = counts[`${g}|${s}`] || 0;
      const display = count > 0 ? `${count}`.padEnd(12) : '—'.padEnd(12);
      return count === 0 ? `\x1b[31m${display}\x1b[0m` : `\x1b[32m${display}\x1b[0m`;
    });
    console.log(`  ${g}   | ${row.join(' | ')}`);
  }

  console.log('');
  const totalNew = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`✅ Total new NCERT 2025 chunks: ${totalNew}`);
}

// ─── Main Pipeline ───────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const sourceIdx = args.indexOf('--source');
  const sourceDir = sourceIdx >= 0 ? args[sourceIdx + 1] : '';

  if (!sourceDir) {
    console.error('Usage: npx tsx scripts/ncert-ingestion/ingest.ts --source "/path/to/NCERT books"');
    console.error('');
    console.error('The source directory should contain NCERT PDF/text files organized by class/subject.');
    console.error('Example structure:');
    console.error('  NCERT books/');
    console.error('    Class 6/');
    console.error('      Mathematics.pdf');
    console.error('      Science.pdf');
    console.error('    Class 10/');
    console.error('      Mathematics.pdf');
    console.error('      Science.pdf');
    process.exit(1);
  }

  console.log('🏫 ALFANUMRIK NCERT CURRICULUM INGESTION PIPELINE');
  console.log('═'.repeat(60));
  console.log(`📂 Source: ${sourceDir}`);
  console.log('');

  // Step 1: Discover
  console.log('📚 Step 1: Discovering NCERT books...');
  const books = discoverBooks(sourceDir);
  console.log(`   Found ${books.length} books:`);
  for (const book of books) {
    console.log(`   📖 Grade ${book.grade} | ${book.subject} | ${book.fileName}`);
  }

  if (books.length === 0) {
    console.error('❌ No NCERT books found. Check directory structure.');
    process.exit(1);
  }

  // Step 2-5: Process each book
  let totalChunks = 0;
  let totalChapters = 0;
  let totalDeprecated = 0;

  for (const book of books) {
    console.log(`\n📖 Processing: Grade ${book.grade} ${book.subject} — ${book.fileName}`);

    // Parse
    const chapters = await parseBook(book);
    console.log(`   📑 Extracted ${chapters.length} chapters`);
    totalChapters += chapters.length;

    // Chunk
    const chunks: ContentChunk[] = [];
    for (const chapter of chapters) {
      chunks.push(...chunkChapter(chapter, book));
    }
    console.log(`   📝 Created ${chunks.length} content chunks`);

    // Deprecate old
    const deprecated = await deprecateOldContent(book.grade, book.subject);
    console.log(`   🗑️ Deprecated ${deprecated} old chunks`);
    totalDeprecated += deprecated;

    // Upload new
    const uploaded = await uploadChunks(chunks);
    console.log(`   ✅ Uploaded ${uploaded} new chunks`);
    totalChunks += uploaded;

    // Update curriculum topics
    const topicsUpdated = await updateCurriculumTopics(chapters, book);
    console.log(`   📋 Updated ${topicsUpdated} curriculum topics`);
  }

  // Step 6: Validate
  console.log('\n' + '═'.repeat(60));
  console.log('📊 MIGRATION SUMMARY');
  console.log(`   Books processed: ${books.length}`);
  console.log(`   Chapters extracted: ${totalChapters}`);
  console.log(`   New chunks uploaded: ${totalChunks}`);
  console.log(`   Old chunks deprecated: ${totalDeprecated}`);
  console.log('');

  await validateCoverage();

  console.log('\n✅ INGESTION COMPLETE');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Run check-content-gaps.ts to verify coverage');
  console.log('  2. Invalidate Foxy RAG cache');
  console.log('  3. Test Foxy retrieval with new content');
  console.log('  4. Verify quiz question generation uses new content');
}

main().catch(err => {
  console.error('❌ Pipeline failed:', err);
  process.exit(1);
});
