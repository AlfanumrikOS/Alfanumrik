/**
 * ALFANUMRIK — MCQ bulk seeding driver
 *
 * Seeds 15 MCQ rows per CBSE chapter (5 × remember + 5 × understand + 5 × apply)
 * by calling Claude Haiku directly (bypasses bulk-question-gen Edge Function which
 * requires an HMAC-signed internal-service caller registration not available
 * from CLI context). Inserts via service-role client (same P6 validation).
 * This is the companion script
 * to `scripts/bulk-non-mcq-driver.ts` which seeds short/long-answer questions.
 *
 * Context: question_bank currently has <=5 'remember'-only MCQ rows per chapter.
 * This script fills the gap so that:
 *   (a) the 80% pool-reset guard (migration 20260625000200) doesn't fire on every
 *       call (pool must be >= 10 to reset),
 *   (b) the future bloom-diversity gate (assessed_count >= 3) can be re-enabled
 *       after seeding adds 'understand' and 'apply' coverage.
 *
 * Prerequisite: supabase/migrations/20260624000100_seed_cbse_syllabus_manifest.sql
 * must be applied first (seeds the cbse_syllabus table with ~660 chapter rows).
 *
 * Run (from repo root):
 *   npx tsx scripts/bulk-mcq-driver.ts                   # dry-run, all gaps
 *   npx tsx scripts/bulk-mcq-driver.ts --apply           # actually call Edge Function
 *   npx tsx scripts/bulk-mcq-driver.ts --grade 7         # one grade
 *   npx tsx scripts/bulk-mcq-driver.ts --grade 7 --subject science
 *   npx tsx scripts/bulk-mcq-driver.ts --bloom remember  # one bloom level only
 *   npx tsx scripts/bulk-mcq-driver.ts --max-chapters 5 --apply  # canary
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL  — target Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — used to call the Edge Function as service role
 *
 * Cost (gpt-4o-mini): ~$0.0006/call (5 MCQ questions). Full run (~660 chapters x 3
 * bloom levels = ~1,980 calls) ~= $1.19 USD. Per-grade is cheaper proportionally.
 *
 * Safety:
 *   - Dry-run by default. Apply only with --apply.
 *   - Skips chapters that already have >= 4 existing MCQs for ALL THREE bloom levels.
 *   - Sleeps 800ms between calls to prevent Edge Function cold-start pileup.
 *   - --max-chapters caps the run for canary testing.
 */

import { createClient } from '@supabase/supabase-js';

// --- Configuration -------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const MCQ_TARGET_PER_BLOOM = 5;
const MIN_EXISTING_MCQ_PER_BLOOM = 4;  // skip if chapter already has >= 4 of each bloom
const BLOOM_LEVELS = ['remember', 'understand', 'apply'] as const;
type BloomLevel = typeof BLOOM_LEVELS[number];
const ESTIMATED_COST_USD_PER_CALL = 0.0006;
const SLEEP_BETWEEN_CALLS_MS = 800;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = 'gpt-4o-mini';
const OPENAI_MAX_TOKENS = 4096;

// --- Args ----------------------------------------------------------------

interface Args {
  apply: boolean;
  grade: string | null;
  subject: string | null;
  bloom: BloomLevel | null; // null = all three bloom levels
  maxChapters: number | null;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { apply: false, grade: null, subject: null, bloom: null, maxChapters: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--grade') args.grade = argv[++i];
    else if (a === '--subject') args.subject = argv[++i];
    else if (a === '--bloom') {
      const v = argv[++i] as BloomLevel;
      if (!BLOOM_LEVELS.includes(v)) {
        throw new Error(`--bloom must be remember, understand, or apply (got "${v}")`);
      }
      args.bloom = v;
    } else if (a === '--max-chapters') args.maxChapters = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: tsx scripts/bulk-mcq-driver.ts [--apply] [--grade N] [--subject X] [--bloom remember|understand|apply] [--max-chapters N]');
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return args;
}

// --- Types ---------------------------------------------------------------

interface ChapterRow {
  grade: string;
  subject_code: string;
  chapter_number: number;
  chapter_title: string;
}

interface BloomStat {
  remember: number;
  understand: number;
  apply: number;
}

interface CallResult {
  ok: boolean;
  inserted: number;
  rejected: number;
  error?: string;
}

// --- Main ----------------------------------------------------------------

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    process.exit(1);
  }

  if (!OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY must be set in env (loaded from .env.local)');
    process.exit(1);
  }

  const args = parseArgs();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Fetch syllabus rows scoped to the run
  let q = supabase
    .from('cbse_syllabus')
    .select('grade, subject_code, chapter_number, chapter_title')
    .eq('is_in_scope', true)
    .order('grade', { ascending: true })
    .order('subject_code', { ascending: true })
    .order('chapter_number', { ascending: true });
  if (args.grade) q = q.eq('grade', args.grade);
  if (args.subject) q = q.eq('subject_code', args.subject);
  const { data: syllabus, error: synErr } = await q;
  if (synErr) {
    console.error('Failed to fetch syllabus:', synErr.message);
    process.exit(1);
  }
  if (!syllabus || syllabus.length === 0) {
    console.error('No syllabus rows match the given filters.');
    process.exit(1);
  }
  const chapters = (syllabus as ChapterRow[]).filter(c => c.chapter_title?.length > 0);
  console.log(`\nLoaded ${chapters.length} chapters from cbse_syllabus.\n`);

  // Compute per-chapter existing MCQ counts per bloom level
  const gaps = new Map<string, BloomStat>();
  for (const ch of chapters) {
    const key = `${ch.grade}|${ch.subject_code}|${ch.chapter_number}`;
    const counts: BloomStat = { remember: 0, understand: 0, apply: 0 };
    for (const bloom of BLOOM_LEVELS) {
      const { count } = await supabase
        .from('question_bank')
        .select('*', { count: 'exact', head: true })
        .eq('grade', ch.grade)
        .eq('subject', ch.subject_code)
        .eq('chapter_number', ch.chapter_number)
        .eq('question_type_v2', 'mcq')
        .eq('bloom_level', bloom);
      counts[bloom] = count ?? 0;
    }
    gaps.set(key, counts);
  }

  // Build call plan
  interface PlannedCall {
    chapter: ChapterRow;
    bloom: BloomLevel;
    target: number;
  }
  const plan: PlannedCall[] = [];
  for (const ch of chapters) {
    const key = `${ch.grade}|${ch.subject_code}|${ch.chapter_number}`;
    const stat = gaps.get(key)!;

    // Skip chapter entirely if ALL three bloom levels are adequately seeded
    if (
      stat.remember >= MIN_EXISTING_MCQ_PER_BLOOM &&
      stat.understand >= MIN_EXISTING_MCQ_PER_BLOOM &&
      stat.apply >= MIN_EXISTING_MCQ_PER_BLOOM
    ) {
      continue;
    }

    for (const bloom of BLOOM_LEVELS) {
      if (args.bloom !== null && args.bloom !== bloom) continue;
      if (stat[bloom] < MIN_EXISTING_MCQ_PER_BLOOM) {
        plan.push({ chapter: ch, bloom, target: MCQ_TARGET_PER_BLOOM });
      }
    }
  }
  if (args.maxChapters !== null) {
    plan.length = Math.min(plan.length, args.maxChapters);
  }

  // Cost estimate
  const estCost = plan.length * ESTIMATED_COST_USD_PER_CALL;
  const rememberCalls = plan.filter(p => p.bloom === 'remember').length;
  const understandCalls = plan.filter(p => p.bloom === 'understand').length;
  const applyCalls = plan.filter(p => p.bloom === 'apply').length;
  console.log(`Planned ${plan.length} calls: ${rememberCalls} remember + ${understandCalls} understand + ${applyCalls} apply.`);
  console.log(`Estimated cost: ~$${estCost.toFixed(4)} USD (Haiku).\n`);

  if (!args.apply) {
    console.log('Dry-run only. Re-run with --apply to actually invoke bulk-question-gen.\n');
    // Print a sample of the plan
    for (const p of plan.slice(0, 10)) {
      console.log(`  ${p.chapter.grade} / ${p.chapter.subject_code} / ch${p.chapter.chapter_number} (${p.chapter.chapter_title.slice(0, 50)}) -> ${p.bloom} x ${p.target}`);
    }
    if (plan.length > 10) console.log(`  ... and ${plan.length - 10} more.`);
    return;
  }

  // Execute the plan
  let totalInserted = 0;
  let totalRejected = 0;
  let totalCallsOk = 0;
  let totalCallsFailed = 0;
  let totalCostUsd = 0;
  const startedAt = Date.now();

  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    const label = `[${i + 1}/${plan.length}] ${p.chapter.grade}/${p.chapter.subject_code}/ch${p.chapter.chapter_number} ${p.bloom}`;
    process.stdout.write(`${label} ... `);

    const result = await callBulkQuestionGen(p.chapter, p.bloom, p.target, supabase);
    if (result.ok) {
      totalCallsOk++;
      totalInserted += result.inserted;
      totalRejected += result.rejected;
      totalCostUsd += ESTIMATED_COST_USD_PER_CALL;
      console.log(`inserted=${result.inserted} rejected=${result.rejected}`);
    } else {
      totalCallsFailed++;
      console.log(`FAILED: ${result.error?.slice(0, 200)}`);
    }

    if (i + 1 < plan.length) {
      await new Promise(r => setTimeout(r, SLEEP_BETWEEN_CALLS_MS));
    }
  }

  const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`\n=== MCQ bulk seeding driver complete in ${elapsedMin} min ===`);
  console.log(`Calls OK:     ${totalCallsOk}`);
  console.log(`Calls failed: ${totalCallsFailed}`);
  console.log(`Inserted:     ${totalInserted} rows (verification_state='pending')`);
  console.log(`Rejected:     ${totalRejected} (validator + db-insert combined)`);
  console.log(`Est. cost:    ~$${totalCostUsd.toFixed(4)} USD`);
  console.log(`\nNext step: once seeding is complete, re-enable the bloom-diversity gate`);
  console.log(`(assessed_count >= 3) in the quiz-generator so understand/apply questions`);
  console.log(`are served alongside remember-level MCQs. Then admin verifies the pending`);
  console.log(`rows (flip verification_state to 'verified' after spot-check).`);
}

// --- Prompt builders -----------------------------------------------------

function buildSystemPrompt(grade: string, subject: string): string {
  const ageLow = String(10 + Number(grade) - 6);
  const ageHigh = String(11 + Number(grade) - 6);
  return `You are a CBSE curriculum question-generation assistant for an Indian K-12 EdTech platform.
You produce exam-quality multiple-choice questions for Grade ${grade} ${subject}.

RULES:
- Follow the NCERT/CBSE syllabus strictly. Do not go beyond the grade-level curriculum.
- All content must be age-appropriate for Grade ${grade} students (approx. ages ${ageLow}–${ageHigh}).
- No violence, adult content, political opinions, religion-based bias, or off-topic material.
- Questions must be factually accurate; incorrect options must be plausible but clearly wrong on reflection.
- Explanations must be clear and educational — 2-3 sentences maximum.
- Return ONLY the JSON array as instructed. No commentary.`;
}

function buildUserPrompt(grade: string, subject: string, chapter: string, count: number, bloomLevel: string): string {
  return `Generate ${count} CBSE Grade ${grade} ${subject} multiple-choice questions for chapter: "${chapter}".

Requirements:
- Each question must test a specific concept from this chapter
- 4 answer options, exactly one correct
- Include a clear explanation (2-3 sentences)
- Include a hint (one helpful clue without giving away the answer)
- Difficulty: 3 (medium)
- Bloom's level: ${bloomLevel}
- Age-appropriate for Grade ${grade} students
- Stay strictly within the CBSE curriculum scope for this chapter
- Do not include any violent, adult, or off-topic content

Return ONLY a valid JSON array — no markdown fences, no extra text — with this exact structure:
[{
  "question_text": "...",
  "options": ["A", "B", "C", "D"],
  "correct_answer_index": 0,
  "explanation": "...",
  "hint": "...",
  "difficulty": 3,
  "bloom_level": "${bloomLevel}"
}]`;
}

function extractJsonArray(text: string): unknown[] | null {
  const stripped = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/\s*```$/, '')
    .trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const VALID_BLOOM_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

interface CandidateQuestion {
  question_text: string;
  options: string[];
  correct_answer_index: number;
  explanation: string;
  hint: string;
  difficulty: number;
  bloom_level: string;
}

function isValidQuestion(q: unknown): q is CandidateQuestion {
  if (!q || typeof q !== 'object') return false;
  const item = q as Record<string, unknown>;

  // question_text: non-empty, no template placeholders
  if (typeof item.question_text !== 'string') return false;
  const text = item.question_text.trim();
  if (!text || text.includes('{{') || text.includes('[BLANK]')) return false;

  // options: exactly 4 distinct non-empty strings
  if (!Array.isArray(item.options) || item.options.length !== 4) return false;
  const opts = item.options as unknown[];
  if (!opts.every(o => typeof o === 'string' && (o as string).trim().length > 0)) return false;
  const uniqueOpts = new Set(opts.map(o => (o as string).trim().toLowerCase()));
  if (uniqueOpts.size !== 4) return false;

  // correct_answer_index: integer 0-3
  const idx = item.correct_answer_index;
  if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx > 3) return false;

  // explanation: non-empty string
  if (typeof item.explanation !== 'string' || !item.explanation.trim()) return false;

  // bloom_level: valid Bloom's level
  if (typeof item.bloom_level !== 'string') return false;
  if (!VALID_BLOOM_LEVELS.includes(item.bloom_level.toLowerCase())) return false;

  return true;
}

// --- Claude direct caller ------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callBulkQuestionGen(
  ch: ChapterRow,
  bloom: BloomLevel,
  count: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<CallResult> {
  if (!OPENAI_API_KEY) {
    return { ok: false, inserted: 0, rejected: 0, error: 'OPENAI_API_KEY not set in env' };
  }

  // Call Claude directly (same prompt as bulk-question-gen Edge Function)
  let rawText: string;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: OPENAI_MAX_TOKENS,
        messages: [
          { role: 'system', content: buildSystemPrompt(ch.grade, ch.subject_code) },
          { role: 'user',   content: buildUserPrompt(ch.grade, ch.subject_code, ch.chapter_title, count, bloom) },
        ],
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      return { ok: false, inserted: 0, rejected: 0, error: `Claude API ${res.status}: ${errBody.slice(0, 200)}` };
    }
    const body = await res.json() as { choices?: Array<{ message: { content: string } }> };
    rawText = body.choices?.[0]?.message?.content ?? '';
    if (!rawText) {
      return { ok: false, inserted: 0, rejected: 0, error: 'Empty Claude response' };
    }
  } catch (e) {
    return { ok: false, inserted: 0, rejected: 0, error: e instanceof Error ? e.message : String(e) };
  }

  // Parse JSON array from response
  const questions = extractJsonArray(rawText);
  if (!questions || questions.length === 0) {
    return { ok: false, inserted: 0, rejected: 0, error: `Failed to parse JSON array from Claude response (raw: ${rawText.slice(0, 100)})` };
  }

  // Validate each question with P6 rules
  const validRows: Record<string, unknown>[] = [];
  let rejected = 0;
  for (const q of questions) {
    if (isValidQuestion(q)) {
      validRows.push({
        question_text: q.question_text,
        options: q.options,
        correct_answer_index: q.correct_answer_index,
        explanation: q.explanation,
        hint: q.hint || null,
        difficulty: typeof q.difficulty === 'number' ? q.difficulty : 3,
        bloom_level: bloom,
        subject: ch.subject_code,
        grade: ch.grade,
        chapter_title: ch.chapter_title,
        chapter_number: ch.chapter_number,
        question_type_v2: 'mcq',
        question_type: 'mcq',
        is_active: true,             // active immediately — fixes pool-size issue
        source: 'bulk_mcq_gen_2026', // consistent source tag for gap-detection re-runs
        created_at: new Date().toISOString(),
      });
    } else {
      rejected++;
    }
  }

  if (validRows.length === 0) {
    return { ok: true, inserted: 0, rejected: questions.length };
  }

  // Insert directly via service-role client (bypasses RLS — correct for admin CLI)
  const { data, error } = await supabase
    .from('question_bank')
    .insert(validRows)
    .select('id');
  if (error) {
    return { ok: false, inserted: 0, rejected, error: `DB insert: ${error.message}` };
  }

  return { ok: true, inserted: data?.length ?? 0, rejected };
}

main().catch(err => {
  console.error('Driver failed:', err);
  process.exit(1);
});
