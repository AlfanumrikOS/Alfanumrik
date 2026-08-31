/**
 * NCERT -> Pinecone sandbox pipeline (concept-aware)
 *
 * Downloads NCERT textbooks (grades 6-12, Mathematics + Science/Physics/
 * Chemistry/Biology, English medium), parses + chunks them by CONCEPT and
 * CONTENT TYPE (concept explanation / solved example / exercise-quiz /
 * figure caption), extracts embedded diagram images and links them to their
 * covering chunks, and embeds text into a standalone Pinecone index using
 * Pinecone's own hosted embedding model (llama-text-embed-v2) -- no external
 * embedding API key, and no model "training" (Pinecone doesn't support
 * fine-tuning hosted models -- retrieval quality comes from chunking +
 * metadata structure, not a trained model).
 *
 * Content-type/heading detection is heuristic (regex over NCERT's fairly
 * consistent "Example N.N", "Fig. N.N", numbered "N.N HEADING" patterns) --
 * best-effort, not perfect OCR-proof parsing.
 *
 * Fully standalone: NOT wired into the running app, the AI provider gateway
 * (packages/lib/src/ai/gateway/), Supabase, or NCERT/Foxy RAG (which stays
 * on the existing Supabase pgvector pipeline -- see
 * .claude/skills/ai-integration/references/ncert-rag-architecture.md).
 *
 * Source: https://ncert.nic.in/textbook.php (used here under NCERT's written
 * permission -- see project memory alfanumrik-pinecone-standalone.md).
 * Raw downloads + extracted diagram images land in
 * data/ncert-books/pinecone-sandbox/ (gitignored via the existing
 * `data/ncert-books/` pattern -- never commit these files).
 *
 * Run (from the REPO ROOT):
 *   npx tsx scripts/pinecone-ncert-sandbox.ts download
 *   npx tsx scripts/pinecone-ncert-sandbox.ts reset        # wipe the index before a re-chunk rebuild
 *   npx tsx scripts/pinecone-ncert-sandbox.ts ingest [--images]  # --images is off by
 *     default: pdf-parse's image extraction has a fatal internal bug on these
 *     PDFs (silent process exit, not a catchable error) -- see the note above
 *     extractChapterImages(). Text/chunk ingestion is unaffected either way.
 *   npx tsx scripts/pinecone-ncert-sandbox.ts query "<question>" [--grade 10] [--subject science] [--type example]
 *
 * Requires: PINECONE_API_KEY in .env.local
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { PDFParse } from 'pdf-parse';
import { Pinecone, Errors } from '@pinecone-database/pinecone';

const DATA_ROOT = path.join(process.cwd(), 'data', 'ncert-books', 'pinecone-sandbox');
const ZIP_DIR = path.join(DATA_ROOT, 'zips');
const RAW_DIR = path.join(DATA_ROOT, 'raw');
const IMAGE_DIR = path.join(DATA_ROOT, 'images');

const INDEX_NAME = 'alfanumrik-ncert-sandbox';
const EMBED_MODEL = 'llama-text-embed-v2';
const UPSERT_BATCH_SIZE = 40; // smaller than Pinecone's 96 cap, to keep per-batch token spikes down

interface Book {
  grade: number;
  subject: 'mathematics' | 'science' | 'physics' | 'chemistry' | 'biology';
  part: number | null;
  code: string;
  title: string;
}

const BOOKS: Book[] = [
  { grade: 6, subject: 'mathematics', part: null, code: 'fegp1', title: 'Ganita Prakash' },
  { grade: 6, subject: 'science', part: null, code: 'fecu1', title: 'Curiosity' },
  { grade: 7, subject: 'mathematics', part: 1, code: 'gegp1', title: 'Ganita Prakash Part-I' },
  { grade: 7, subject: 'mathematics', part: 2, code: 'gegp2', title: 'Ganita Prakash Part-II' },
  { grade: 7, subject: 'science', part: null, code: 'gecu1', title: 'Curiosity' },
  { grade: 8, subject: 'mathematics', part: 1, code: 'hegp1', title: 'Ganita Prakash Part-I' },
  { grade: 8, subject: 'mathematics', part: 2, code: 'hegp2', title: 'Ganita Prakash Part-II' },
  { grade: 8, subject: 'science', part: null, code: 'hecu1', title: 'Curiosity' },
  { grade: 9, subject: 'mathematics', part: null, code: 'iemh1', title: 'Ganita Manjari' },
  { grade: 9, subject: 'science', part: null, code: 'iesc1', title: 'Exploration' },
  { grade: 10, subject: 'mathematics', part: null, code: 'jemh1', title: 'Mathematics' },
  { grade: 10, subject: 'science', part: null, code: 'jesc1', title: 'Science' },
  { grade: 11, subject: 'mathematics', part: null, code: 'kemh1', title: 'Mathematics' },
  { grade: 11, subject: 'physics', part: 1, code: 'keph1', title: 'Physics Part-I' },
  { grade: 11, subject: 'physics', part: 2, code: 'keph2', title: 'Physics Part-II' },
  { grade: 11, subject: 'chemistry', part: 1, code: 'kech1', title: 'Chemistry Part-I' },
  { grade: 11, subject: 'chemistry', part: 2, code: 'kech2', title: 'Chemistry Part-II' },
  { grade: 11, subject: 'biology', part: null, code: 'kebo1', title: 'Biology' },
  { grade: 12, subject: 'mathematics', part: 1, code: 'lemh1', title: 'Mathematics Part-I' },
  { grade: 12, subject: 'mathematics', part: 2, code: 'lemh2', title: 'Mathematics Part-II' },
  { grade: 12, subject: 'physics', part: 1, code: 'leph1', title: 'Physics Part-I' },
  { grade: 12, subject: 'physics', part: 2, code: 'leph2', title: 'Physics Part-II' },
  { grade: 12, subject: 'chemistry', part: 1, code: 'lech1', title: 'Chemistry-I' },
  { grade: 12, subject: 'chemistry', part: 2, code: 'lech2', title: 'Chemistry-II' },
  { grade: 12, subject: 'biology', part: null, code: 'lebo1', title: 'Biology' },
];

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function fetchWithRetry(url: string, attempts = 4): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Referer: 'https://ncert.nic.in/textbook.php',
        },
      });
    } catch (err) {
      lastErr = err;
      const delayMs = 1000 * 2 ** i;
      log(`fetch failed (attempt ${i + 1}/${attempts}): ${(err as Error).message} -- retrying in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

async function downloadBook(book: Book): Promise<void> {
  await mkdir(ZIP_DIR, { recursive: true });
  const zipPath = path.join(ZIP_DIR, `${book.code}.zip`);
  const extractDir = path.join(RAW_DIR, book.code);

  if (existsSync(extractDir)) {
    log(`[${book.code}] already extracted, skipping`);
    return;
  }

  if (!existsSync(zipPath)) {
    const url = `https://ncert.nic.in/textbook/pdf/${book.code}dd.zip`;
    log(`[${book.code}] downloading ${url}`);
    const resp = await fetchWithRetry(url);
    if (!resp.ok) throw new Error(`[${book.code}] download failed: HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    await writeFile(zipPath, buf);
    log(`[${book.code}] downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
  } else {
    log(`[${book.code}] zip already present, skipping download`);
  }

  await mkdir(extractDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(extractDir, true);
  const entries = await readdir(extractDir);
  log(`[${book.code}] extracted ${entries.length} entries`);
}

async function cmdDownload(onlyCode?: string): Promise<void> {
  const books = onlyCode ? BOOKS.filter((b) => b.code === onlyCode) : BOOKS;
  if (onlyCode && books.length === 0) {
    console.error(`No book with code "${onlyCode}"`);
    process.exit(2);
  }
  for (const book of books) {
    await downloadBook(book);
  }
  log('Download complete.');
}

function getClient(): Pinecone {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) {
    console.error('Missing PINECONE_API_KEY in .env.local');
    process.exit(1);
  }
  return new Pinecone({ apiKey });
}

async function ensureIndex(pc: Pinecone): Promise<void> {
  try {
    await pc.createIndexForModel({
      name: INDEX_NAME,
      cloud: 'aws',
      region: 'us-east-1',
      embed: { model: EMBED_MODEL, fieldMap: { text: 'chunk_text' } },
      waitUntilReady: true,
    });
    log(`Created index "${INDEX_NAME}" (model: ${EMBED_MODEL}).`);
  } catch (err) {
    if (err instanceof Errors.PineconeConflictError) {
      log(`Index "${INDEX_NAME}" already exists, skipping creation.`);
    } else {
      throw err;
    }
  }
}

function namespaceFor(book: Book): string {
  return `grade-${book.grade}-${book.subject}`;
}

async function findPdfFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.pdf'))
    .map((e) => path.join(e.parentPath ?? (e as { path?: string }).path ?? dir, e.name));
}

function chapterLabelFromFilename(filePath: string, bookCode: string): string {
  const base = path.basename(filePath, '.pdf');
  return base.startsWith(bookCode) ? base.slice(bookCode.length) : base;
}

type ContentType = 'concept' | 'example' | 'exercise' | 'figure_caption';

interface ConceptChunk {
  text: string;
  pageStart: number;
  pageEnd: number;
  conceptTitle: string;
  contentType: ContentType;
}

// Best-effort: NCERT numbered section headings, e.g. "11.3 PHOTOELECTRIC EFFECT"
// or "5.2 Prime Numbers" -- short, no trailing period, first line of a paragraph.
const HEADING_RE = /^(\d{1,2}\.\d{1,2})\s+([A-Za-z][A-Za-z0-9 ,'&-]{2,60})$/;
const SECTION_LABEL_RE = /^(EXERCISES?|SUMMARY|POINTS TO REMEMBER)$/i;
const EXAMPLE_RE = /^Example\s+\d+(\.\d+)?/i;
const FIGURE_RE = /^Fig\.?\s*\d+\.\d+/i;

function detectHeading(paragraph: string): string | null {
  // Headings often land mid-paragraph in extracted text (right after a stray
  // page number, with no blank line separating them from body text), so scan
  // every line, not just the first -- take the LAST match, closest to what
  // follows it.
  let found: string | null = null;
  for (const rawLine of paragraph.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.length > 70) continue;
    const numbered = line.match(HEADING_RE);
    if (numbered && !line.endsWith('.')) {
      found = `${numbered[1]} ${numbered[2].trim()}`;
      continue;
    }
    if (SECTION_LABEL_RE.test(line)) found = line.toUpperCase();
  }
  return found;
}

function classifyParagraph(paragraph: string, inExerciseSection: boolean): ContentType {
  const firstLine = paragraph.split('\n')[0].trim();
  if (EXAMPLE_RE.test(firstLine)) return 'example';
  if (FIGURE_RE.test(firstLine)) return 'figure_caption';
  if (inExerciseSection) return 'exercise';
  return 'concept';
}

function chunkPagesConcepts(pages: Array<{ num: number; text: string }>, targetSize = 1400): ConceptChunk[] {
  const chunks: ConceptChunk[] = [];
  let buffer = '';
  let pageStart: number | null = null;
  let pageEnd: number | null = null;
  let currentConcept = 'General';
  let currentType: ContentType = 'concept';
  let inExercise = false;

  function flush(): void {
    const trimmed = buffer.trim();
    if (trimmed.length > 0 && pageStart !== null && pageEnd !== null) {
      chunks.push({ text: trimmed, pageStart, pageEnd, conceptTitle: currentConcept, contentType: currentType });
    }
    buffer = '';
    pageStart = null;
  }

  for (const page of pages) {
    const paragraphs = page.text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const para of paragraphs) {
      const heading = detectHeading(para);
      if (heading) {
        flush();
        currentConcept = heading;
        inExercise = /^EXERCISES?$/i.test(heading);
      }

      const paraType = classifyParagraph(para, inExercise);
      if (paraType !== currentType && buffer.length > 0) flush();
      currentType = paraType;

      if (pageStart === null) pageStart = page.num;
      pageEnd = page.num;
      buffer += (buffer ? '\n\n' : '') + para;
      if (buffer.length >= targetSize) flush();
    }
  }
  flush();
  return chunks;
}

function extFromDataUrl(dataUrl: string): string {
  const m = dataUrl.match(/^data:image\/(\w+);/);
  return m ? m[1] : 'png';
}

async function extractChapterImages(
  buf: Buffer,
  bookCode: string,
  chapter: string,
  pageCount: number
): Promise<Map<number, string[]>> {
  const pageToImages = new Map<number, string[]>();
  const dir = path.join(IMAGE_DIR, bookCode, chapter);
  let dirCreated = false;
  let failedPages = 0;

  // pdf-parse's getImage() has an all-or-nothing failure mode: one bad
  // embedded image XObject reference (seen repeatedly on these NCERT PDFs)
  // aborts extraction for the WHOLE document, not just that image. Extract
  // one page at a time (on a single shared parser -- re-instantiating
  // PDFParse per page was too slow, ~minutes per chapter) so a broken
  // reference on page N doesn't cost every other page's diagrams too.
  const parser = new PDFParse({ data: buf });
  try {
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      try {
        const result = await parser.getImage({ imageThreshold: 80, partial: [pageNum] });
        const page = result.pages[0];
        if (!page || page.images.length === 0) continue;
        if (!dirCreated) {
          await mkdir(dir, { recursive: true });
          dirCreated = true;
        }
        const files: string[] = [];
        for (let i = 0; i < page.images.length; i++) {
          const img = page.images[i];
          const ext = extFromDataUrl(img.dataUrl);
          const fileName = `p${pageNum}-${i}.${ext}`;
          await writeFile(path.join(dir, fileName), Buffer.from(img.data));
          files.push(path.relative(DATA_ROOT, path.join(dir, fileName)));
        }
        pageToImages.set(pageNum, files);
      } catch {
        failedPages++;
      }
    }
  } finally {
    await parser.destroy();
  }
  if (failedPages > 0) {
    log(`[${bookCode}] chapter ${chapter}: image extraction failed on ${failedPages}/${pageCount} page(s), kept the rest`);
  }
  return pageToImages;
}

const BATCH_PACING_MS = 12_000; // proactive cooldown between every batch, not just after failures

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function upsertBatch(
  pc: Pinecone,
  namespace: string,
  records: Array<Record<string, string>>,
  attempts = 6
): Promise<void> {
  const index = pc.index(INDEX_NAME).namespace(namespace);
  for (let i = 0; i < attempts; i++) {
    try {
      await index.upsertRecords(records);
      await sleep(BATCH_PACING_MS); // pace even successes so we never burst
      return;
    } catch (err) {
      const isLast = i === attempts - 1;
      if (isLast) throw err;
      const isRateLimited = /RESOURCE_EXHAUSTED|max tokens per minute/i.test((err as Error).message);
      // Repeated 429s over a full minute (observed 10x65s still failing) means
      // a flat 60s wait isn't enough -- rejected requests may still count
      // against quota, or there's a longer cooldown penalty. Back off harder
      // and further apart instead of hammering every 65s.
      const delayMs = isRateLimited ? 90_000 * (i + 1) : 2000 * 2 ** i;
      log(`upsert batch failed (attempt ${i + 1}/${attempts}): ${(err as Error).message} -- retrying in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
}

async function ingestBook(pc: Pinecone, book: Book, force: boolean, includeImages: boolean): Promise<void> {
  const extractDir = path.join(RAW_DIR, book.code);
  const marker = path.join(extractDir, '.ingested-v2');
  if (!force && existsSync(marker)) {
    log(`[${book.code}] already ingested, skipping (use --force to redo)`);
    return;
  }
  if (!existsSync(extractDir)) {
    throw new Error(`[${book.code}] not downloaded yet -- run "download" first`);
  }

  const pdfFiles = (await findPdfFiles(extractDir)).sort();
  const namespace = namespaceFor(book);
  let totalChunks = 0;
  let totalImages = 0;
  let batch: Array<Record<string, string>> = [];

  for (const filePath of pdfFiles) {
    const chapter = chapterLabelFromFilename(filePath, book.code);
    const buf = await readFile(filePath);
    const parser = new PDFParse({ data: buf });
    const result = await parser.getText();
    await parser.destroy();

    const pageImages = includeImages
      ? await extractChapterImages(buf, book.code, chapter, result.pages.length)
      : new Map<number, string[]>();
    const chapterImageCount = [...pageImages.values()].reduce((n, files) => n + files.length, 0);
    totalImages += chapterImageCount;

    const chunks = chunkPagesConcepts(result.pages);
    log(
      `[${book.code}] chapter ${chapter}: ${result.pages.length} pages -> ${chunks.length} chunks, ${chapterImageCount} images`
    );

    chunks.forEach((chunk, idx) => {
      const contentHash = createHash('sha256').update(chunk.text).digest('hex').slice(0, 16);
      const images: string[] = [];
      for (let p = chunk.pageStart; p <= chunk.pageEnd; p++) {
        const files = pageImages.get(p);
        if (files) images.push(...files);
      }
      batch.push({
        _id: `${book.code}-${chapter}-${idx}`,
        chunk_text: chunk.text,
        grade: String(book.grade),
        subject: book.subject,
        part: book.part ? String(book.part) : '',
        book_code: book.code,
        book_title: book.title,
        chapter,
        concept_title: chunk.conceptTitle,
        content_type: chunk.contentType,
        page_start: String(chunk.pageStart),
        page_end: String(chunk.pageEnd),
        image_refs: images.join('|'),
        image_count: String(images.length),
        content_hash: contentHash,
      });
      totalChunks++;
    });

    while (batch.length >= UPSERT_BATCH_SIZE) {
      await upsertBatch(pc, namespace, batch.slice(0, UPSERT_BATCH_SIZE));
      batch = batch.slice(UPSERT_BATCH_SIZE);
    }
  }

  if (batch.length > 0) {
    await upsertBatch(pc, namespace, batch);
  }

  await writeFile(marker, new Date().toISOString());
  log(`[${book.code}] ingested ${totalChunks} chunks (${totalImages} images) into namespace "${namespace}".`);
}

async function cmdReset(): Promise<void> {
  const pc = getClient();
  try {
    await pc.deleteIndex(INDEX_NAME);
    log(`Deleted index "${INDEX_NAME}". Run "ingest" to rebuild it with the new concept-aware chunking.`);
  } catch (err) {
    if (/NOT_FOUND|404/i.test((err as Error).message)) {
      log(`Index "${INDEX_NAME}" does not exist, nothing to delete.`);
    } else {
      throw err;
    }
  }
}

async function cmdIngest(onlyCode?: string, force = false, includeImages = false): Promise<void> {
  const pc = getClient();
  await ensureIndex(pc);
  const books = onlyCode ? BOOKS.filter((b) => b.code === onlyCode) : BOOKS;
  const failed: string[] = [];
  for (const book of books) {
    try {
      await ingestBook(pc, book, force, includeImages);
    } catch (err) {
      failed.push(book.code);
      log(`[${book.code}] FAILED, continuing to next book: ${(err as Error).message}`);
    }
  }
  if (failed.length > 0) {
    log(`Ingest finished with ${failed.length} failed book(s): ${failed.join(', ')}. Re-run "ingest" to retry them (already-ingested books are skipped).`);
  } else {
    log('Ingest complete.');
  }
}

async function cmdQuery(question: string, grade?: string, subject?: string, contentType?: string): Promise<void> {
  if (!question) {
    console.error('Usage: pinecone-ncert-sandbox.ts query "<question>" [--grade N] [--subject X] [--type concept|example|exercise|figure_caption]');
    process.exit(2);
  }
  const pc = getClient();
  const index = pc.index(INDEX_NAME);
  const namespace = grade && subject ? `grade-${grade}-${subject}` : undefined;
  if (!namespace) {
    console.error('Both --grade and --subject are required (namespaces are per grade+subject).');
    process.exit(2);
  }
  const results = await index.namespace(namespace).searchRecords({
    query: {
      inputs: { text: question },
      topK: 5,
      ...(contentType ? { filter: { content_type: contentType } } : {}),
    },
  });
  console.log(JSON.stringify(results, null, 2));
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'download':
      return cmdDownload(rest[0]);
    case 'ingest': {
      const force = rest.includes('--force');
      const includeImages = rest.includes('--images');
      const onlyCode = rest.find((a) => !a.startsWith('--'));
      return cmdIngest(onlyCode, force, includeImages);
    }
    case 'query': {
      const question = rest.find((a) => !a.startsWith('--'));
      const gradeIdx = rest.indexOf('--grade');
      const subjectIdx = rest.indexOf('--subject');
      const typeIdx = rest.indexOf('--type');
      const grade = gradeIdx >= 0 ? rest[gradeIdx + 1] : undefined;
      const subject = subjectIdx >= 0 ? rest[subjectIdx + 1] : undefined;
      const contentType = typeIdx >= 0 ? rest[typeIdx + 1] : undefined;
      return cmdQuery(question ?? '', grade, subject, contentType);
    }
    case 'reset':
      return cmdReset();
    default:
      console.error(
        'Usage: pinecone-ncert-sandbox.ts download | reset | ingest | query "<question>" [--grade N] [--subject X] [--type concept|example|exercise|figure_caption]'
      );
      process.exit(2);
  }
}

main().catch((err) => {
  console.error('NCERT sandbox pipeline failed:', err);
  process.exit(1);
});
