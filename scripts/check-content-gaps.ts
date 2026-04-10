/**
 * ALFANUMRIK — Content Gap Checker
 *
 * Checks RAG content and question bank coverage across all subjects/grades.
 * Run: npx tsx scripts/check-content-gaps.ts
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Subject codes must match question_bank.subject column (lowercase codes from SUBJECT_META)
const TARGET_SUBJECTS = [
  { subject: 'math', grades: ['6','7','8','9','10','11','12'], minChunks: 100, minQuestions: 100 },
  { subject: 'science', grades: ['6','7','8','9','10'], minChunks: 100, minQuestions: 100 },
  { subject: 'physics', grades: ['11','12'], minChunks: 100, minQuestions: 50 },
  { subject: 'chemistry', grades: ['11','12'], minChunks: 100, minQuestions: 50 },
  { subject: 'biology', grades: ['11','12'], minChunks: 50, minQuestions: 50 },
  { subject: 'english', grades: ['6','7','8','9','10'], minChunks: 20, minQuestions: 30 },
  { subject: 'hindi', grades: ['6','7','8','9','10'], minChunks: 20, minQuestions: 30 },
  { subject: 'social_studies', grades: ['6','7','8','9','10'], minChunks: 20, minQuestions: 30 },
  { subject: 'economics', grades: ['11','12'], minChunks: 20, minQuestions: 30 },
  { subject: 'accountancy', grades: ['11','12'], minChunks: 20, minQuestions: 30 },
  { subject: 'business_studies', grades: ['11','12'], minChunks: 20, minQuestions: 30 },
  { subject: 'political_science', grades: ['11','12'], minChunks: 20, minQuestions: 20 },
  { subject: 'computer_science', grades: ['11','12'], minChunks: 20, minQuestions: 20 },
];

async function main() {
  console.log('\n📊 ALFANUMRIK CONTENT GAP REPORT\n');

  // RAG chunks
  const { data: ragData } = await supabase
    .from('rag_content_chunks')
    .select('subject, grade')
    .eq('is_active', true);

  const ragCounts = new Map<string, number>();
  (ragData || []).forEach((r: any) => {
    const key = `${r.subject}|${r.grade}`;
    ragCounts.set(key, (ragCounts.get(key) || 0) + 1);
  });

  // Questions
  const { data: qData } = await supabase
    .from('question_bank')
    .select('subject, grade')
    .eq('is_active', true);

  const qCounts = new Map<string, number>();
  (qData || []).forEach((r: any) => {
    const key = `${r.subject?.toLowerCase()}|${r.grade}`;
    qCounts.set(key, (qCounts.get(key) || 0) + 1);
  });

  console.log('Subject          | Grade | RAG Chunks | Questions | RAG Status    | Q Status');
  console.log('-----------------|-------|------------|-----------|---------------|----------');

  let totalGaps = 0;

  for (const t of TARGET_SUBJECTS) {
    for (const g of t.grades) {
      const ragKey = `${t.subject}|Grade ${g}`;
      const qKey = `${t.subject.toLowerCase()}|Grade ${g}`;
      const ragCount = ragCounts.get(ragKey) || 0;
      const qCount = qCounts.get(qKey) || 0;
      const ragStatus = ragCount >= t.minChunks ? '✅ OK' : ragCount > 0 ? `⚠️  LOW (need ${t.minChunks})` : '❌ MISSING';
      const qStatus = qCount >= t.minQuestions ? '✅ OK' : qCount > 0 ? `⚠️  LOW` : '❌ MISSING';

      if (ragCount < t.minChunks || qCount < t.minQuestions) totalGaps++;

      const subj = t.subject.padEnd(16);
      const grade = g.padEnd(5);
      console.log(`${subj} | ${grade} | ${String(ragCount).padStart(10)} | ${String(qCount).padStart(9)} | ${ragStatus.padEnd(13)} | ${qStatus}`);
    }
  }

  console.log(`\n📋 Total gaps: ${totalGaps}`);
  console.log(`📦 Total RAG chunks: ${ragData?.length || 0}`);
  console.log(`❓ Total questions: ${qData?.length || 0}\n`);
}

main().catch(console.error);
