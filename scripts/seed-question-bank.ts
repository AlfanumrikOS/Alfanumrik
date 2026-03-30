/**
 * ALFANUMRIK — NCERT-Aligned Question Bank Seeder
 *
 * Generates MCQ questions from RAG content using Claude API,
 * then inserts them into the question_bank table.
 *
 * Run:
 *   npx tsx scripts/seed-question-bank.ts
 *   npx tsx scripts/seed-question-bank.ts --grade 10
 *   npx tsx scripts/seed-question-bank.ts --grade 10 --dry-run
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ANTHROPIC_API_KEY
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ─── Configuration ──────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const QUESTIONS_PER_CHAPTER = 5;
const MIN_EXISTING_QUESTIONS = 5; // Skip chapters with this many+ questions
const MAX_RAG_CHUNKS_PER_CHAPTER = 3;
const DELAY_BETWEEN_CALLS_MS = 2000;
const BATCH_INSERT_SIZE = 10;

// ─── Grade/Subject Mappings ─────────────────────────────────
// rag_content_chunks uses full names; question_bank uses codes

const SUBJECT_DB_TO_CODE: Record<string, string> = {
  'Mathematics': 'math',
  'Science': 'science',
  'Physics': 'physics',
  'Chemistry': 'chemistry',
  'Biology': 'biology',
  'English': 'english',
  'Hindi': 'hindi',
  'Social Studies': 'social_studies',
  'Economics': 'economics',
  'Accountancy': 'accountancy',
  'Business Studies': 'business_studies',
  'Political Science': 'political_science',
  'History': 'history_sr',
  'Geography': 'geography',
  'Computer Science': 'computer_science',
};

const SUBJECT_CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(SUBJECT_DB_TO_CODE).map(([name, code]) => [code, name])
);

// ─── Types ──────────────────────────────────────────────────

interface CurriculumTopic {
  id: string;
  grade: string;
  chapter_number: number;
  title: string;
  subject_code: string;
  subject_name: string;
}

interface GeneratedQuestion {
  question_text: string;
  options: string[];
  correct_answer_index: number;
  explanation: string;
  difficulty: number;
  bloom_level: string;
  tags: string[];
}

interface QuestionBankRow {
  subject: string;
  grade: string;
  chapter_number: number;
  topic: string | null;
  question_text: string;
  question_type: string;
  options: string[];
  correct_answer_index: number;
  explanation: string;
  difficulty: number;
  bloom_level: string;
  is_active: boolean;
  source: string;
  source_version: string;
  content_status: string;
}

// ─── CLI Argument Parsing ───────────────────────────────────

function parseArgs(): { grade: string | null; dryRun: boolean } {
  const args = process.argv.slice(2);
  let grade: string | null = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--grade' && args[i + 1]) {
      grade = args[i + 1];
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { grade, dryRun };
}

// ─── Supabase Helpers ───────────────────────────────────────

async function fetchCurriculumTopics(
  supabase: SupabaseClient,
  gradeFilter: string | null
): Promise<CurriculumTopic[]> {
  // curriculum_topics has subject_id (FK to subjects), grade (text like "6","7",...),
  // chapter_number, title, is_active
  let query = supabase
    .from('curriculum_topics')
    .select(`
      id,
      grade,
      chapter_number,
      title,
      subjects!inner ( code, name )
    `)
    .eq('is_active', true)
    .not('chapter_number', 'is', null)
    .order('grade')
    .order('chapter_number');

  if (gradeFilter) {
    query = query.eq('grade', gradeFilter);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Failed to fetch curriculum_topics:', error.message);
    return [];
  }

  if (!data || data.length === 0) {
    console.log('No curriculum topics found.');
    return [];
  }

  return data.map((row: any) => ({
    id: row.id,
    grade: row.grade,
    chapter_number: row.chapter_number,
    title: row.title,
    subject_code: row.subjects.code,
    subject_name: row.subjects.name,
  }));
}

async function fetchRagChunks(
  supabase: SupabaseClient,
  grade: string,
  subjectCode: string,
  chapterNumber: number
): Promise<string[]> {
  // rag_content_chunks uses "Grade X" and full subject names like "Mathematics"
  const dbGrade = `Grade ${grade}`;
  const dbSubject = SUBJECT_CODE_TO_NAME[subjectCode] || subjectCode;

  const { data, error } = await supabase
    .from('rag_content_chunks')
    .select('chunk_text')
    .eq('grade', dbGrade)
    .eq('subject', dbSubject)
    .eq('chapter_number', chapterNumber)
    .eq('is_active', true)
    .order('chunk_index', { ascending: true })
    .limit(MAX_RAG_CHUNKS_PER_CHAPTER);

  if (error) {
    console.error(`  Failed to fetch RAG chunks: ${error.message}`);
    return [];
  }

  return (data || [])
    .map((row: any) => row.chunk_text)
    .filter((text: string) => text && text.trim().length > 0);
}

async function countExistingQuestions(
  supabase: SupabaseClient,
  subjectCode: string,
  grade: string,
  chapterNumber: number
): Promise<number> {
  // question_bank uses "Grade X" for grade and subject codes like "math"
  const dbGrade = `Grade ${grade}`;

  const { count, error } = await supabase
    .from('question_bank')
    .select('*', { count: 'exact', head: true })
    .eq('subject', subjectCode)
    .eq('grade', dbGrade)
    .eq('chapter_number', chapterNumber)
    .eq('is_active', true);

  if (error) {
    console.error(`  Failed to count existing questions: ${error.message}`);
    return 0;
  }

  return count || 0;
}

// ─── Claude API ─────────────────────────────────────────────

function buildPrompt(
  subject: string,
  grade: string,
  chapterNumber: number,
  chapterTitle: string,
  chunkTexts: string[]
): string {
  const combinedContent = chunkTexts.join('\n\n---\n\n');

  return `You are an NCERT question generator for CBSE students.
Based on the following textbook content from ${subject} Grade ${grade}, Chapter ${chapterNumber}: ${chapterTitle}, generate exactly 5 multiple-choice questions.

RULES:
- Questions must be directly based on the provided textbook content
- Each question must have exactly 4 options (A, B, C, D)
- Only one correct answer per question
- Include a clear explanation referencing the textbook
- Vary difficulty: 2 easy (bloom: remember), 2 medium (bloom: understand), 1 hard (bloom: apply)
- Questions must be appropriate for Grade ${grade} students
- Use NCERT terminology exactly as in the textbook

TEXTBOOK CONTENT:
${combinedContent}

Respond in valid JSON array format:
[{
  "question_text": "...",
  "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
  "correct_answer_index": 0-3,
  "explanation": "...",
  "difficulty": 1-3,
  "bloom_level": "remember|understand|apply",
  "tags": ["tag1", "tag2"]
}]`;
}

async function callClaude(prompt: string): Promise<GeneratedQuestion[]> {
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Claude API ${response.status}: ${errorBody}`);
  }

  const result = await response.json();

  // Extract text content from Claude's response
  const textContent = result.content?.find((c: any) => c.type === 'text');
  if (!textContent?.text) {
    throw new Error('No text content in Claude response');
  }

  // Parse JSON from the response — handle markdown code blocks
  let jsonText = textContent.text.trim();

  // Strip markdown code fences if present
  const codeBlockMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1].trim();
  }

  const questions: GeneratedQuestion[] = JSON.parse(jsonText);

  // Validate each question
  return questions.filter((q) => {
    if (!q.question_text || q.question_text.trim().length === 0) return false;
    if (!Array.isArray(q.options) || q.options.length !== 4) return false;
    if (q.options.some((opt: string) => !opt || opt.trim().length === 0)) return false;
    if (typeof q.correct_answer_index !== 'number' || q.correct_answer_index < 0 || q.correct_answer_index > 3) return false;
    if (!q.explanation || q.explanation.trim().length === 0) return false;
    if (typeof q.difficulty !== 'number' || q.difficulty < 1 || q.difficulty > 3) return false;
    if (!['remember', 'understand', 'apply'].includes(q.bloom_level)) return false;
    // Check for template placeholders (P6)
    if (q.question_text.includes('{{') || q.question_text.includes('[BLANK]')) return false;
    // Check all 4 options are distinct
    const uniqueOptions = new Set(q.options.map((o: string) => o.trim().toLowerCase()));
    if (uniqueOptions.size !== 4) return false;
    return true;
  });
}

// ─── Insert Logic ───────────────────────────────────────────

async function batchInsertQuestions(
  supabase: SupabaseClient,
  rows: QuestionBankRow[]
): Promise<number> {
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_INSERT_SIZE) {
    const batch = rows.slice(i, i + BATCH_INSERT_SIZE);
    const { error } = await supabase.from('question_bank').insert(batch);

    if (error) {
      console.error(`  Batch insert failed (${batch.length} rows): ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }

  return inserted;
}

function toQuestionBankRows(
  questions: GeneratedQuestion[],
  topic: CurriculumTopic
): QuestionBankRow[] {
  const dbGrade = `Grade ${topic.grade}`;

  return questions.map((q) => ({
    subject: topic.subject_code,
    grade: dbGrade,
    chapter_number: topic.chapter_number,
    topic: q.tags?.length > 0 ? q.tags[0] : null,
    question_text: q.question_text,
    question_type: 'mcq',
    options: q.options,
    correct_answer_index: q.correct_answer_index,
    explanation: q.explanation,
    difficulty: q.difficulty,
    bloom_level: q.bloom_level,
    is_active: true,
    source: 'ncert_2025',
    source_version: 'ncert_2025',
    content_status: 'published',
  }));
}

// ─── Delay Helper ───────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main ───────────────────────────────────────────────────

async function main(): Promise<void> {
  // Validate environment
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (!ANTHROPIC_API_KEY) {
    console.error('ERROR: Missing ANTHROPIC_API_KEY');
    process.exit(1);
  }

  const { grade, dryRun } = parseArgs();

  console.log('\n=== ALFANUMRIK QUESTION BANK SEEDER ===\n');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no API calls, no inserts)' : 'LIVE'}`);
  console.log(`Model: ${CLAUDE_MODEL}`);
  if (grade) {
    console.log(`Grade filter: ${grade}`);
  }
  console.log('');

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Step 1: Fetch all curriculum topics
  console.log('Fetching curriculum topics...');
  const topics = await fetchCurriculumTopics(supabase, grade);
  console.log(`Found ${topics.length} active topics\n`);

  if (topics.length === 0) {
    console.log('No topics to process. Exiting.');
    return;
  }

  // Tracking
  let totalGenerated = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalNoRag = 0;
  const pendingInserts: QuestionBankRow[] = [];

  // Step 2: Process each chapter sequentially
  for (const topic of topics) {
    const label = `[Grade ${topic.grade} ${topic.subject_name} Ch ${topic.chapter_number}]`;

    // Check if chapter already has enough questions
    const existingCount = await countExistingQuestions(
      supabase,
      topic.subject_code,
      topic.grade,
      topic.chapter_number
    );

    if (existingCount >= MIN_EXISTING_QUESTIONS) {
      console.log(`${label} SKIP — already has ${existingCount} questions`);
      totalSkipped++;
      continue;
    }

    // Fetch RAG chunks
    const chunks = await fetchRagChunks(
      supabase,
      topic.grade,
      topic.subject_code,
      topic.chapter_number
    );

    if (chunks.length === 0) {
      console.log(`${label} SKIP — no RAG content available`);
      totalNoRag++;
      continue;
    }

    if (dryRun) {
      console.log(`${label} WOULD PROCESS — ${chunks.length} RAG chunks, ${existingCount} existing questions`);
      continue;
    }

    // Call Claude API
    try {
      const prompt = buildPrompt(
        topic.subject_name,
        topic.grade,
        topic.chapter_number,
        topic.title,
        chunks
      );

      const questions = await callClaude(prompt);

      if (questions.length === 0) {
        console.error(`${label} ERROR — Claude returned 0 valid questions`);
        totalErrors++;
      } else {
        const rows = toQuestionBankRows(questions, topic);
        pendingInserts.push(...rows);
        totalGenerated += questions.length;
        console.log(`${label} Generated ${questions.length} questions`);

        // Flush pending inserts when batch is large enough
        if (pendingInserts.length >= BATCH_INSERT_SIZE) {
          const toInsert = pendingInserts.splice(0, pendingInserts.length);
          const inserted = await batchInsertQuestions(supabase, toInsert);
          totalInserted += inserted;
        }
      }
    } catch (err: any) {
      console.error(`${label} ERROR — ${err.message}`);
      totalErrors++;
    }

    // Rate limit delay
    await delay(DELAY_BETWEEN_CALLS_MS);
  }

  // Flush remaining inserts
  if (pendingInserts.length > 0) {
    const inserted = await batchInsertQuestions(supabase, pendingInserts);
    totalInserted += inserted;
  }

  // Summary
  console.log('\n=== SUMMARY ===\n');
  console.log(`Topics found:       ${topics.length}`);
  console.log(`Skipped (enough):   ${totalSkipped}`);
  console.log(`Skipped (no RAG):   ${totalNoRag}`);
  console.log(`Questions generated: ${totalGenerated}`);
  console.log(`Questions inserted:  ${totalInserted}`);
  console.log(`Errors:             ${totalErrors}`);
  console.log('');

  if (totalErrors > 0) {
    console.log('Some chapters failed. Re-run the script to retry failed chapters.');
  }

  if (dryRun) {
    console.log('This was a dry run. No API calls were made and no data was inserted.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
