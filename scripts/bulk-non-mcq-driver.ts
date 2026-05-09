/**
 * ALFANUMRIK — Phase 2 step 2: bulk SA/LA driver
 *
 * Iterates over (grade, subject, chapter) tuples in cbse_syllabus and calls
 * the `bulk-non-mcq-gen` Edge Function (PR #667) for each chapter that
 * lacks short_answer / long_answer coverage. Inserts go in with
 * verification_state='pending' for downstream admin review.
 *
 * Spec: docs/superpowers/plans/2026-05-09-non-mcq-question-seeding.md
 *
 * Run (from repo root):
 *   npx tsx scripts/bulk-non-mcq-driver.ts                # dry-run, all gaps
 *   npx tsx scripts/bulk-non-mcq-driver.ts --apply        # actually call
 *   npx tsx scripts/bulk-non-mcq-driver.ts --grade 7      # one grade
 *   npx tsx scripts/bulk-non-mcq-driver.ts --grade 7 --subject science
 *   npx tsx scripts/bulk-non-mcq-driver.ts --type short_answer  # SA only
 *   npx tsx scripts/bulk-non-mcq-driver.ts --max-chapters 5 --apply  # cap run
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL  — points at the target project
 *   SUPABASE_SERVICE_ROLE_KEY — used to invoke the Edge Function as service role
 *
 * Cost (Haiku): ~$0.0006/SA call (5 questions), ~$0.0011/LA call (3 questions).
 * Full coverage (~761 chapters × both types) ≈ $1.30 total. Per-grade is
 * cheaper proportionally. The driver reports cumulative cost as it runs.
 *
 * Safety:
 *   - Dry-run by default. Apply only with --apply.
 *   - Per-chapter target: 5 SA + 3 LA. Skips any chapter that already has
 *     >=3 SA OR >=2 LA from this generator (idempotent, can re-run safely).
 *   - Inserts are gated by verification_state='pending' — students do NOT
 *     see them until admin flips to 'verified' (Phase 5 UI, future work).
 *   - Sleeps 500ms between calls to stay under any per-second rate limits.
 *   - --max-chapters caps the run; useful for first canary against prod.
 *
 * Out of scope:
 *   - Reads cbse_syllabus to know what chapters exist; assumes
 *     subject_code/grade/chapter_number/chapter_title are populated.
 *   - Hindi translations — Phase 4 backfill on the inserted rows.
 */

import { createClient } from '@supabase/supabase-js';

// ─── Configuration ──────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const SA_TARGET = 5;
const LA_TARGET = 3;
const MIN_EXISTING_SA = 3;   // skip chapter if it has >= this many AI-generated SA already
const MIN_EXISTING_LA = 2;   // same for LA

const ESTIMATED_COST_USD_PER_SA_CALL = 0.0006;
const ESTIMATED_COST_USD_PER_LA_CALL = 0.0011;
const SLEEP_BETWEEN_CALLS_MS = 500;

// ─── Args ───────────────────────────────────────────────────

interface Args {
  apply: boolean;
  grade: string | null;
  subject: string | null;
  type: 'short_answer' | 'long_answer' | null; // null = both
  maxChapters: number | null;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { apply: false, grade: null, subject: null, type: null, maxChapters: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--grade') args.grade = argv[++i];
    else if (a === '--subject') args.subject = argv[++i];
    else if (a === '--type') {
      const v = argv[++i];
      if (v !== 'short_answer' && v !== 'long_answer') {
        throw new Error(`--type must be short_answer or long_answer (got "${v}")`);
      }
      args.type = v;
    } else if (a === '--max-chapters') args.maxChapters = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: tsx scripts/bulk-non-mcq-driver.ts [--apply] [--grade N] [--subject X] [--type short_answer|long_answer] [--max-chapters N]');
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return args;
}

// ─── Types ──────────────────────────────────────────────────

interface ChapterRow {
  grade: string;
  subject_code: string;
  chapter_number: number;
  chapter_title: string;
}

interface GapStat {
  saExisting: number;
  laExisting: number;
}

interface CallResult {
  ok: boolean;
  inserted: number;
  rejected: number;
  error?: string;
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
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

  // Compute per-chapter existing AI-generated SA/LA counts
  const gaps = new Map<string, GapStat>();
  for (const ch of chapters) {
    const key = `${ch.grade}|${ch.subject_code}|${ch.chapter_number}`;
    const { count: saCount } = await supabase
      .from('question_bank')
      .select('*', { count: 'exact', head: true })
      .eq('grade', ch.grade)
      .eq('subject', ch.subject_code)
      .eq('chapter_number', ch.chapter_number)
      .eq('question_type_v2', 'short_answer')
      .eq('source', 'bulk_non_mcq_gen_2026');
    const { count: laCount } = await supabase
      .from('question_bank')
      .select('*', { count: 'exact', head: true })
      .eq('grade', ch.grade)
      .eq('subject', ch.subject_code)
      .eq('chapter_number', ch.chapter_number)
      .eq('question_type_v2', 'long_answer')
      .eq('source', 'bulk_non_mcq_gen_2026');
    gaps.set(key, { saExisting: saCount ?? 0, laExisting: laCount ?? 0 });
  }

  // Build call plan
  interface PlannedCall {
    chapter: ChapterRow;
    type: 'short_answer' | 'long_answer';
    target: number;
  }
  const plan: PlannedCall[] = [];
  for (const ch of chapters) {
    const key = `${ch.grade}|${ch.subject_code}|${ch.chapter_number}`;
    const gap = gaps.get(key)!;
    if ((args.type === null || args.type === 'short_answer') && gap.saExisting < MIN_EXISTING_SA) {
      plan.push({ chapter: ch, type: 'short_answer', target: SA_TARGET });
    }
    if ((args.type === null || args.type === 'long_answer') && gap.laExisting < MIN_EXISTING_LA) {
      plan.push({ chapter: ch, type: 'long_answer', target: LA_TARGET });
    }
  }
  if (args.maxChapters !== null) {
    plan.length = Math.min(plan.length, args.maxChapters);
  }

  // Cost estimate
  const saCalls = plan.filter(p => p.type === 'short_answer').length;
  const laCalls = plan.filter(p => p.type === 'long_answer').length;
  const estCost = saCalls * ESTIMATED_COST_USD_PER_SA_CALL + laCalls * ESTIMATED_COST_USD_PER_LA_CALL;
  console.log(`Planned ${plan.length} calls: ${saCalls} short_answer + ${laCalls} long_answer.`);
  console.log(`Estimated cost: ~$${estCost.toFixed(4)} USD (Haiku).\n`);

  if (!args.apply) {
    console.log('Dry-run only. Re-run with --apply to actually invoke bulk-non-mcq-gen.\n');
    // Print a sample of the plan
    for (const p of plan.slice(0, 10)) {
      console.log(`  ${p.chapter.grade} / ${p.chapter.subject_code} / ch${p.chapter.chapter_number} (${p.chapter.chapter_title.slice(0, 50)}) → ${p.type} × ${p.target}`);
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
    const label = `[${i + 1}/${plan.length}] ${p.chapter.grade}/${p.chapter.subject_code}/ch${p.chapter.chapter_number} ${p.type}`;
    process.stdout.write(`${label} ... `);

    const result = await callBulkNonMcqGen(p.chapter, p.type, p.target);
    if (result.ok) {
      totalCallsOk++;
      totalInserted += result.inserted;
      totalRejected += result.rejected;
      totalCostUsd += p.type === 'long_answer' ? ESTIMATED_COST_USD_PER_LA_CALL : ESTIMATED_COST_USD_PER_SA_CALL;
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
  console.log(`\n=== Phase 2 driver complete in ${elapsedMin} min ===`);
  console.log(`Calls OK:     ${totalCallsOk}`);
  console.log(`Calls failed: ${totalCallsFailed}`);
  console.log(`Inserted:     ${totalInserted} rows (verification_state='pending')`);
  console.log(`Rejected:     ${totalRejected} (validator + db-insert combined)`);
  console.log(`Est. cost:    ~$${totalCostUsd.toFixed(4)} USD`);
  console.log(`\nNext step: admin verifies the pending rows (Phase 5 UI, or run a manual UPDATE`);
  console.log(`once spot-checked).`);
}

// ─── Edge Function caller ───────────────────────────────────

async function callBulkNonMcqGen(
  ch: ChapterRow,
  type: 'short_answer' | 'long_answer',
  count: number,
): Promise<CallResult> {
  const url = `${SUPABASE_URL}/functions/v1/bulk-non-mcq-gen`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grade: ch.grade,
        subject: ch.subject_code,
        chapter_title: ch.chapter_title,
        chapter_number: ch.chapter_number,
        question_type: type,
        count,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      return { ok: false, inserted: 0, rejected: 0, error: `HTTP ${res.status}: ${errBody.slice(0, 300)}` };
    }
    const body = await res.json() as { inserted?: number; rejected?: number };
    return { ok: true, inserted: body.inserted ?? 0, rejected: body.rejected ?? 0 };
  } catch (e) {
    return { ok: false, inserted: 0, rejected: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

main().catch(err => {
  console.error('Driver failed:', err);
  process.exit(1);
});
