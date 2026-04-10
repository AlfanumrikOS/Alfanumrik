/**
 * ALFANUMRIK — NCERT Book Discovery (Dry Run)
 *
 * Scans the staging directory and reports what books are found
 * WITHOUT making any database changes. Use this to verify the
 * file structure before running the full ingestion.
 *
 * Usage:
 *   npx tsx scripts/ncert-ingestion/discover.ts
 *
 * Looks in: data/ncert-books/ (relative to project root)
 */

import * as fs from 'fs';
import * as path from 'path';

const STAGING_DIR = path.join(process.cwd(), 'data', 'ncert-books');

const CLASS_TO_GRADE: Record<string, string> = {
  'class 6': '6', 'class-6': '6', 'class6': '6',
  'class 7': '7', 'class-7': '7', 'class7': '7',
  'class 8': '8', 'class-8': '8', 'class8': '8',
  'class 9': '9', 'class-9': '9', 'class9': '9',
  'class 10': '10', 'class-10': '10', 'class10': '10',
  'class 11': '11', 'class-11': '11', 'class11': '11',
  'class 12': '12', 'class-12': '12', 'class12': '12',
  'vi': '6', 'vii': '7', 'viii': '8', 'ix': '9', 'x': '10', 'xi': '11', 'xii': '12',
  '6': '6', '7': '7', '8': '8', '9': '9', '10': '10', '11': '11', '12': '12',
};

const SUBJECT_NORMALIZE: Record<string, string> = {
  'mathematics': 'math', 'maths': 'math', 'math': 'math', 'ganit': 'math',
  'science': 'science', 'vigyan': 'science',
  'physics': 'physics', 'bhautiki': 'physics',
  'chemistry': 'chemistry', 'rasayan': 'chemistry',
  'biology': 'biology', 'jeev vigyan': 'biology',
  'english': 'english', 'hindi': 'hindi',
  'social science': 'social_studies', 'social studies': 'social_studies',
  'samajik vigyan': 'social_studies',
  'economics': 'economics', 'arthshastra': 'economics',
  'accountancy': 'accountancy', 'lekhashastra': 'accountancy',
  'business studies': 'business_studies',
  'political science': 'political_science', 'rajniti vigyan': 'political_science',
  'history': 'history_sr', 'itihas': 'history_sr',
  'geography': 'geography', 'bhugol': 'geography',
  'computer science': 'computer_science',
};

interface DiscoveredFile {
  path: string;
  name: string;
  size: string;
  grade: string | null;
  subject: string | null;
  type: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function discover(): DiscoveredFile[] {
  const files: DiscoveredFile[] = [];

  if (!fs.existsSync(STAGING_DIR)) {
    console.error(`❌ Staging directory not found: ${STAGING_DIR}`);
    console.error('');
    console.error('Create it and place NCERT books inside:');
    console.error('  mkdir -p data/ncert-books/class-6 data/ncert-books/class-7 ...');
    console.error('  cp your-ncert-pdfs/* data/ncert-books/class-X/');
    process.exit(1);
  }

  function scan(dir: string, depth = 0) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 3) {
        scan(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.pdf', '.txt', '.md', '.epub'].includes(ext)) continue;

      const relativePath = fullPath.replace(STAGING_DIR, '').replace(/^[\\/]/, '');
      const pathLower = relativePath.toLowerCase().replace(/[\\/]/g, ' ') + ' ' + entry.name.toLowerCase();
      const stats = fs.statSync(fullPath);

      let grade: string | null = null;
      for (const [pattern, g] of Object.entries(CLASS_TO_GRADE)) {
        if (pathLower.includes(pattern)) { grade = g; break; }
      }

      let subject: string | null = null;
      for (const [pattern, s] of Object.entries(SUBJECT_NORMALIZE)) {
        if (pathLower.includes(pattern)) { subject = s; break; }
      }

      files.push({
        path: relativePath,
        name: entry.name,
        size: formatSize(stats.size),
        grade,
        subject,
        type: ext.replace('.', '').toUpperCase(),
      });
    }
  }

  scan(STAGING_DIR);
  return files;
}

function main() {
  console.error('📚 ALFANUMRIK NCERT BOOK DISCOVERY');
  console.error('═'.repeat(60));
  console.error(`📂 Scanning: ${STAGING_DIR}`);
  console.error('');

  const files = discover();

  if (files.length === 0) {
    console.error('❌ No book files found in staging directory.');
    console.error('');
    console.error('Expected file types: .pdf, .txt, .md');
    console.error('Expected structure:');
    console.error('  data/ncert-books/class-6/mathematics.pdf');
    console.error('  data/ncert-books/class-10/science.pdf');
    process.exit(1);
  }

  // Print discovery table
  const ready = files.filter(f => f.grade && f.subject);
  const unresolved = files.filter(f => !f.grade || !f.subject);

  console.error(`✅ READY (${ready.length} files):`);
  for (const f of ready) {
    console.error(`   Grade ${f.grade!.padEnd(2)} | ${f.subject!.padEnd(16)} | ${f.size.padEnd(10)} | ${f.path}`);
  }

  if (unresolved.length > 0) {
    console.error('');
    console.error(`⚠️ UNRESOLVED (${unresolved.length} files — rename to include class/subject):`);
    for (const f of unresolved) {
      console.error(`   Grade ${(f.grade || '?').padEnd(2)} | ${(f.subject || '?').padEnd(16)} | ${f.size.padEnd(10)} | ${f.path}`);
    }
  }

  // Coverage summary
  console.error('');
  console.error('📊 COVERAGE:');
  const byGrade: Record<string, string[]> = {};
  for (const f of ready) {
    if (!byGrade[f.grade!]) byGrade[f.grade!] = [];
    if (!byGrade[f.grade!].includes(f.subject!)) byGrade[f.grade!].push(f.subject!);
  }
  for (const g of ['6', '7', '8', '9', '10', '11', '12']) {
    const subjects = byGrade[g] || [];
    console.error(`   Grade ${g}: ${subjects.length > 0 ? subjects.join(', ') : '❌ MISSING'}`);
  }

  console.error('');
  console.error(`Total: ${files.length} files, ${ready.length} ready, ${unresolved.length} need attention`);
  console.error('');
  if (ready.length > 0) {
    console.error('✅ To run full ingestion:');
    console.error(`   npx tsx scripts/ncert-ingestion/ingest.ts --source "${STAGING_DIR}"`);
  }
}

main();
