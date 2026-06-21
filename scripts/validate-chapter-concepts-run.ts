#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * scripts/validate-chapter-concepts-run.ts
 *
 * Runs the assessment-owned rubric validation query
 * (scripts/sql/validate-chapter-concepts.sql) against the LIVE DB for a given
 * grade and prints the per-chapter floor_pass / rubric_pass table.
 *
 * It executes the SAME SQL logic as the .sql file, via the `exec_sql`-free
 * path: we reproduce the query through a Postgres function call is not
 * available, so this runner instead SELECTs the rows and computes the rubric
 * in TS using the identical thresholds. To guarantee parity with the SQL, the
 * thresholds are mirrored from the .sql file verbatim (see SQL_* constants).
 *
 * Usage: npx tsx scripts/validate-chapter-concepts-run.ts --grade 7 [--source ncert_2025_llm]
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

// Thresholds mirrored verbatim from scripts/sql/validate-chapter-concepts.sql
const FLOOR_MIN_CONCEPTS = 3;
const FLOOR_MIN_EXPL = 80;
const RUBRIC_MIN_AVG_EXPL = 150;
const RUBRIC_MIN_BLOOM_SPREAD = 2;
const RUBRIC_MIN_DIFF_SPREAD = 2;

interface Row {
  subject: string;
  chapter_number: number;
  title: string | null;
  explanation: string | null;
  explanation_hi: string | null;
  title_hi: string | null;
  difficulty: number | null;
  bloom_level: string | null;
  practice_question: string | null;
}

function parseArgs(argv: string[]): { grade: string; source: string | null } {
  let grade = '';
  let source: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--grade') grade = argv[++i];
    else if (argv[i] === '--source') source = argv[++i];
  }
  if (!grade) { console.error('Usage: npx tsx scripts/validate-chapter-concepts-run.ts --grade 7 [--source ncert_2025_llm]'); process.exit(2); }
  return { grade, source };
}

async function main(): Promise<void> {
  const { grade, source } = parseArgs(process.argv.slice(2));
  let q = `chapter_concepts?grade=eq.${grade}&is_active=is.true&chapter_number=gt.0` +
    `&select=subject,chapter_number,title,explanation,explanation_hi,title_hi,difficulty,bloom_level,practice_question` +
    `&order=subject,chapter_number,concept_number&limit=10000`;
  if (source) q += `&source=eq.${source}`;
  const r = await fetch(`${URL}/rest/v1/${q}`, { headers: H });
  if (!r.ok) { console.error('query failed', r.status, await r.text()); process.exit(1); }
  const rows = (await r.json()) as Row[];

  // group by subject+chapter
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const k = `${row.subject}|${row.chapter_number}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(row);
  }

  const norm = (s: string | null) => (s ?? '').trim();
  const out: Array<Record<string, unknown>> = [];
  let floorPassCount = 0;
  let rubricPassCount = 0;

  for (const [k, cards] of [...groups.entries()].sort()) {
    const [subject, chStr] = k.split('|');
    const chapter = parseInt(chStr, 10);
    const expl = cards.map((c) => norm(c.explanation));
    const explHi = cards.map((c) => norm(c.explanation_hi));
    const titleHi = cards.map((c) => norm(c.title_hi));
    const titles = cards.map((c) => norm(c.title));
    const pqs = cards.map((c) => norm(c.practice_question)).filter(Boolean);

    const concept_count = cards.length;
    const min_expl = Math.min(...expl.map((e) => e.length));
    const avg_expl = Math.round(expl.reduce((a, e) => a + e.length, 0) / Math.max(concept_count, 1));
    const below_floor = expl.filter((e) => e.length < FLOOR_MIN_EXPL).length;
    const empty_title = titles.filter((t) => t.length < 3).length;
    const dup_title = concept_count - new Set(titles.map((t) => t.toLowerCase())).size;
    const dup_expl = concept_count - new Set(expl.map((e) => e.toLowerCase())).size;
    const recycled_mcq = pqs.length - new Set(pqs.map((p) => p.toLowerCase())).size;
    const bloom_spread = new Set(cards.map((c) => c.bloom_level)).size;
    const diff_spread = new Set(cards.map((c) => c.difficulty)).size;
    const expl_hi_count = explHi.filter((e) => e !== '').length;
    const title_hi_count = titleHi.filter((t) => t !== '').length;

    const floor_pass = concept_count >= FLOOR_MIN_CONCEPTS && below_floor === 0 && empty_title === 0;
    const rubric_pass =
      concept_count >= FLOOR_MIN_CONCEPTS &&
      below_floor === 0 && empty_title === 0 &&
      dup_title === 0 && dup_expl === 0 && recycled_mcq === 0 &&
      avg_expl >= RUBRIC_MIN_AVG_EXPL &&
      bloom_spread >= RUBRIC_MIN_BLOOM_SPREAD &&
      diff_spread >= RUBRIC_MIN_DIFF_SPREAD &&
      expl_hi_count === concept_count && title_hi_count === concept_count;

    if (floor_pass) floorPassCount++;
    if (rubric_pass) rubricPassCount++;

    out.push({
      subject, ch: chapter, n: concept_count, minE: min_expl, avgE: avg_expl,
      belowFloor: below_floor, dupT: dup_title, dupE: dup_expl, recMCQ: recycled_mcq,
      bloom: bloom_spread, diff: diff_spread, hiE: expl_hi_count, hiT: title_hi_count,
      FLOOR: floor_pass ? 'PASS' : 'fail', RUBRIC: rubric_pass ? 'PASS' : 'FAIL',
    });
  }

  // print as a table
  const cols = ['subject', 'ch', 'n', 'minE', 'avgE', 'belowFloor', 'dupT', 'dupE', 'recMCQ', 'bloom', 'diff', 'hiE', 'hiT', 'FLOOR', 'RUBRIC'];
  console.error(cols.join('\t'));
  for (const row of out) console.error(cols.map((c) => String(row[c])).join('\t'));
  console.error(`\nChapters: ${out.length} | floor_pass: ${floorPassCount} | rubric_pass: ${rubricPassCount}`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
