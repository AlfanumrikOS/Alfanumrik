// eval/rag/harness/bind-corpus.ts
//
// B1 RAG eval-harness — Task 10 (step A) READ-ONLY corpus-binding helper.
//
// PURPOSE
//   For each item in eval/rag/golden/seed-queries.json, surface CANDIDATE
//   rag_content_chunks rows the operator (here) reads to assign PROVISIONAL
//   graded relevance (2/1/0) against the item's `target.relevance_2_description`
//   — A3 candidate-pool-INDEPENDENT: labels come from chunk_text, NOT from what
//   retrieve() returns.
//
// HARD SECURITY POSTURE (non-negotiable)
//   - READ-ONLY. The ONLY table this script ever names is
//     `public.rag_content_chunks` (NCERT curriculum — no PII). It NEVER queries
//     students/profiles/auth/sessions/any PII table, and NEVER calls a write RPC.
//   - NEVER prints/echoes/logs/commits any secret. It prints the project HOST
//     (derived from the URL) and ROW COUNTS only.
//   - Loads creds from .env.local via dotenv. .env.local is gitignored.
//
// CORPUS FILTERS (mirror the live retrieve() serve contract so we only ever
//   consider chunks the system could actually return):
//     source = 'ncert_2025'  AND  is_active = true  AND  language = 'en'
//     AND grade_short = item.grade  AND  subject_code = item.subject
//   Chapter narrowing is a UNION of: chapter_number = target number
//     OR chapter_title ILIKE chapter_name terms OR concept/topic ILIKE.
//   Content narrowing: chunk_text ILIKE key terms drawn from the target.
//
// USAGE
//   cd D:/Alfa_local/rag-baseline-wt
//   npx tsx eval/rag/harness/bind-corpus.ts            # writes candidate dossier
//   npx tsx eval/rag/harness/bind-corpus.ts --print    # also prints per-item summary
//
// OUTPUT (write-only inside eval/rag/, no DB writes):
//   eval/rag/reports/binding-candidates.raw.json — every candidate considered,
//   per item, with id + chapter + content_layer + bloom + a <=300-char snippet.
//   The OPERATOR (this agent) then reads that file, assigns provisional relevance,
//   and hand-authors eval/rag/golden/ncert-golden-v1.json +
//   eval/rag/reports/binding-candidates.json.

import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── The ONE allowed table. Any other table name is a security violation. ──────
const ALLOWED_TABLE = 'rag_content_chunks' as const;

// ── Load creds (.env.local only). Never print values. ─────────────────────────
const ENV_PATH = resolve(__dirname, '..', '..', '..', '.env.local');
loadEnv({ path: ENV_PATH });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}

// Print HOST ONLY (never the key, never the full URL with any token).
const HOST = (() => {
  try {
    return new URL(SUPABASE_URL).host;
  } catch {
    return '<unparseable-url>';
  }
})();

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Seed-set item shape (we only read what we need) ───────────────────────────
interface SeedTarget {
  chapter_name: string;
  concept: string;
  relevance_2_description: string;
  multi_hop_required_concepts?: string[];
}
interface SeedItem {
  id: string;
  query: string;
  query_type: string;
  grade: string;
  subject: string;
  chapter_number: number | null;
  target: SeedTarget;
}

// ── Candidate row shape we surface (NO PII columns — curriculum only) ─────────
interface CandidateRow {
  id: string;
  chapter_number: number | null;
  chapter_title: string | null;
  topic: string | null;
  concept: string | null;
  content_layer: string | null;
  bloom_level: string | null;
  difficulty_level: string | null;
  snippet: string; // <=300 chars of chunk_text
  match_reason: string; // which narrowing matched (chapter# / title / concept / term)
}

const SELECT_COLS =
  'id, chapter_number, chapter_title, topic, concept, content_layer, bloom_level, difficulty_level, chunk_text';

// Boilerplate filter — only skip chunks that are PURELY the NCERT reprint /
// copyright notice. The reprint footer ("Reprint 2026-27", "© NCERT", "not to
// be republished") appears INLINE on many REAL content chunks as a page header
// — those must NOT be skipped. We skip only when, after stripping that notice,
// almost no real text remains (i.e. the chunk is essentially the notice alone).
const BOILERPLATE_RE =
  /not to be republished|reprint\s*20\d\d-?\d\d|©\s*ncert|^\s*notes\b/gi;

function snippet(text: string | null | undefined): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 300 ? `${t.slice(0, 297)}...` : t;
}

function isBoilerplate(text: string | null | undefined): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 40) return true; // too short to be a real labelable chunk
  // Strip the reprint/copyright notice and see how much real text remains.
  const stripped = t.replace(BOILERPLATE_RE, ' ').replace(/\s+/g, ' ').trim();
  return stripped.length < 40; // pure-notice chunk
}

/** Per-item key terms for the chunk_text ILIKE content narrowing. Hand-curated
 *  from the seed target so we surface the right neighborhood; the OPERATOR still
 *  reads chunk_text and labels A3-independently of these terms. */
// NOTE: terms broadened + corrected to the LIVE NCERT 2025 corpus edition,
// which is renumbered/retitled vs the seed's assumed chapters (e.g. g7 science
// photosynthesis lives in ch10 "Life Processes in Plants", respiration/gas
// exchange in ch9 "Life Processes in Animals"; g10 electricity is ch11;
// g11 Laws of Motion is ch4, Gravitation ch7). Terms are a SEARCH neighborhood
// only — the operator still labels A3-independently from chunk_text.
const CONTENT_TERMS: Record<string, string[]> = {
  'seed-j-sci-photosynthesis-factual-001': ['carbon dioxide', 'stomata', 'sunlight', 'chlorophyll'],
  'seed-j-sci-photosynthesis-definition-002': ['photosynthesis', 'chlorophyll', 'glucose and oxygen', 'synthesis of food'],
  'seed-j-sci-respiration-conceptual-003': ['breathing', 'breathe', 'oxygen', 'exchange of gases', 'energy'],
  'seed-j-sci-respiration-conceptual-004': ['anaerobic', 'lactic', 'cramp', 'muscle', 'energy'],
  'seed-j-sci-nutrition-respiration-multihop-005': ['photosynthesis', 'exchange of gases', 'oxygen', 'carbon dioxide', 'breathing'],
  'seed-j-math-integers-factual-006': ['negative integer', 'product', 'positive', '–15', '-15'],
  'seed-j-math-integers-definition-007': ['additive inverse', 'inverse', 'zero'],
  'seed-j-math-fractions-conceptual-008': ['proper fraction', 'multiplying', 'smaller', 'product'],
  'seed-j-math-data-factual-009': ['mean', 'average', 'observations', 'arithmetic mean'],
  'seed-j-math-integers-fractions-multihop-010': ['negative integer', 'division', 'product', 'reciprocal', 'fraction'],
  'seed-s-sci-electricity-factual-011': ['ampere', 'coulomb of charge per second', 'SI unit', 'electric current'],
  'seed-s-sci-electricity-definition-012': ['ohm', 'potential difference', 'directly proportional', 'V = IR', 'V –I'],
  'seed-s-sci-acids-conceptual-013': ['hydrogen ion', 'aqueous', 'conduct', 'H+', 'ionis', 'dissociat'],
  'seed-s-sci-life-conceptual-014': ['chambers', 'oxygenated', 'oxygen-rich', 'heart', 'mixing'],
  'seed-s-sci-electricity-life-multihop-015': ['series', 'same current', 'circulation', 'blood', 'heart'],
  'seed-s-sst-nationalism-factual-016': ['Non-Cooperation', 'Gandhi', 'Mahatma', 'movement'],
  'seed-s-sst-resources-definition-017': ['renewable', 'replenish', 'resource'],
  'seed-s-sst-nationalism-conceptual-018': ['First World War', 'defence expenditure', 'taxes', 'prices', 'war loan'],
  'seed-s-sst-nationalism-conceptual-019': ['satyagraha', 'non-violen', 'truth', 'oppressor'],
  'seed-s-sst-nationalism-resources-multihop-020': ['peasant', 'war', 'land', 'rent', 'defence expenditure', 'resource'],
  'seed-sr-phy-motion-factual-021': ['newton', 'SI unit', 'force', '1 kg', 'm s'],
  'seed-sr-phy-motion-definition-022': ['second law', 'momentum', 'F = ma', 'rate of change of momentum'],
  'seed-sr-phy-gravitation-conceptual-023': ['altitude', 'height', 'g decreases', 'increasing altitude', 'acceleration due to gravity'],
  'seed-sr-phy-motion-conceptual-024': ['inertia', 'first law', 'rest', 'uniform', 'remains', 'sudden'],
  'seed-sr-phy-motion-gravitation-multihop-025': ['F = ma', 'g =', 'GM', 'mass', 'acceleration due to gravity', 'second law'],
  'seed-sr-hist-revolution-factual-026': ['1789', 'Bastille', 'French Revolution'],
  'seed-sr-hist-revolution-definition-027': ['Old Regime', 'three orders', 'estates', 'monarchy', 'privilege'],
  'seed-sr-hist-revolution-conceptual-028': ['third estate', 'taxes', 'privilege', 'discontent'],
  'seed-sr-hist-revolution-conceptual-029': ['Rousseau', 'Montesquieu', 'social contract', 'philosoph'],
  'seed-sr-hist-revolution-multihop-030': ['debt', 'bread', 'taxes', 'liberty', 'equality', 'Rousseau'],
};

// Live-corpus chapter-number overrides (seed numbers reflect an older NCERT
// edition; these are the ACTUAL chapter_numbers in source='ncert_2025'). When
// an item id is present here, the helper ALSO narrows by these chapter numbers.
const CHAPTER_OVERRIDES: Record<string, number[]> = {
  // g7 science (Curiosity 2025): photosynthesis = ch10 (plants); respiration / gas
  // exchange = ch9 (animals).
  'seed-j-sci-photosynthesis-factual-001': [10],
  'seed-j-sci-photosynthesis-definition-002': [10],
  'seed-j-sci-respiration-conceptual-003': [9],
  'seed-j-sci-respiration-conceptual-004': [9, 10],
  'seed-j-sci-nutrition-respiration-multihop-005': [9, 10],
  // g10 science: Electricity = ch11; Acids/Bases = ch2; Life Processes = ch5.
  'seed-s-sci-electricity-factual-011': [11],
  'seed-s-sci-electricity-definition-012': [11],
  'seed-s-sci-acids-conceptual-013': [2],
  'seed-s-sci-life-conceptual-014': [5],
  'seed-s-sci-electricity-life-multihop-015': [5, 11],
  // g11 physics: Laws of Motion = ch4; Gravitation = ch7.
  'seed-sr-phy-motion-factual-021': [4],
  'seed-sr-phy-motion-definition-022': [4],
  'seed-sr-phy-gravitation-conceptual-023': [7],
  'seed-sr-phy-motion-conceptual-024': [4],
  'seed-sr-phy-motion-gravitation-multihop-025': [4, 7],
};

/** Chapter-name terms used for chapter_title ILIKE narrowing. */
function chapterTitleTerms(chapterName: string): string[] {
  // Split a "A / B" combined chapter into the distinct chapter names.
  return chapterName
    .split('/')
    .map((s) => s.trim())
    .map((s) => s.replace(/\(.*?\)/g, '').trim()) // drop parentheticals
    .filter((s) => s.length > 0);
}

async function liveCount(): Promise<number> {
  // Single read-only count against the ONE allowed table.
  const { count, error } = await supabase
    .from(ALLOWED_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('source', 'ncert_2025');
  if (error) throw new Error(`count failed: ${error.message}`);
  return count ?? 0;
}

async function cellCount(grade: string, subject: string): Promise<number> {
  const { count, error } = await supabase
    .from(ALLOWED_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('source', 'ncert_2025')
    .eq('grade_short', grade)
    .eq('subject_code', subject)
    .eq('is_active', true)
    .eq('language', 'en');
  if (error) throw new Error(`cell count failed (${grade}/${subject}): ${error.message}`);
  return count ?? 0;
}

/** A base scoped query for a (grade, subject) cell — the live-serve filters. */
function baseQuery(grade: string, subject: string) {
  return supabase
    .from(ALLOWED_TABLE)
    .select(SELECT_COLS)
    .eq('source', 'ncert_2025')
    .eq('grade_short', grade)
    .eq('subject_code', subject)
    .eq('is_active', true)
    .eq('language', 'en');
}

async function gatherCandidates(item: SeedItem): Promise<CandidateRow[]> {
  const seen = new Map<string, CandidateRow>();

  const push = (rows: Record<string, unknown>[] | null, reason: string) => {
    for (const r of rows ?? []) {
      const id = String(r.id);
      if (seen.has(id)) {
        // keep the most specific reason
        continue;
      }
      const text = r.chunk_text as string | null;
      if (isBoilerplate(text)) continue;
      seen.set(id, {
        id,
        chapter_number: (r.chapter_number as number | null) ?? null,
        chapter_title: (r.chapter_title as string | null) ?? null,
        topic: (r.topic as string | null) ?? null,
        concept: (r.concept as string | null) ?? null,
        content_layer: (r.content_layer as string | null) ?? null,
        bloom_level: (r.bloom_level as string | null) ?? null,
        difficulty_level: (r.difficulty_level as string | null) ?? null,
        snippet: snippet(text),
        match_reason: reason,
      });
    }
  };

  // 1) chapter_number exact — prefer LIVE-corpus overrides; fall back to the
  //    seed's chapter_number when no override is registered.
  const chapterNums =
    CHAPTER_OVERRIDES[item.id] ??
    (item.chapter_number != null ? [item.chapter_number] : []);
  for (const cn of chapterNums) {
    const { data, error } = await baseQuery(item.grade, item.subject)
      .eq('chapter_number', cn)
      .limit(80);
    if (error) throw new Error(`[${item.id}] chapter# query failed: ${error.message}`);
    push(data, `chapter_number=${cn}`);
  }

  // 2) chapter_title ILIKE on each chapter-name fragment
  for (const term of chapterTitleTerms(item.target.chapter_name)) {
    const { data, error } = await baseQuery(item.grade, item.subject)
      .ilike('chapter_title', `%${term}%`)
      .limit(40);
    if (error) throw new Error(`[${item.id}] title ILIKE "${term}" failed: ${error.message}`);
    push(data, `chapter_title~"${term}"`);
  }

  // 3) concept/topic ILIKE on the concept fragment
  const conceptFrag = item.target.concept.split('/')[0].trim().slice(0, 40);
  if (conceptFrag.length >= 4) {
    const { data: byConcept, error: e1 } = await baseQuery(item.grade, item.subject)
      .ilike('concept', `%${conceptFrag}%`)
      .limit(30);
    if (e1) throw new Error(`[${item.id}] concept ILIKE failed: ${e1.message}`);
    push(byConcept, `concept~"${conceptFrag}"`);
    const { data: byTopic, error: e2 } = await baseQuery(item.grade, item.subject)
      .ilike('topic', `%${conceptFrag}%`)
      .limit(30);
    if (e2) throw new Error(`[${item.id}] topic ILIKE failed: ${e2.message}`);
    push(byTopic, `topic~"${conceptFrag}"`);
  }

  // 4) chunk_text ILIKE on each content key term (the strongest A3 signal)
  for (const term of CONTENT_TERMS[item.id] ?? []) {
    const { data, error } = await baseQuery(item.grade, item.subject)
      .ilike('chunk_text', `%${term}%`)
      .limit(40);
    if (error) throw new Error(`[${item.id}] chunk_text ILIKE "${term}" failed: ${error.message}`);
    push(data, `chunk_text~"${term}"`);
  }

  return [...seen.values()];
}

async function main(): Promise<void> {
  const printSummary = process.argv.includes('--print');

  console.log(`[bind-corpus] project host: ${HOST}`);
  console.log(`[bind-corpus] allowed table (read-only): public.${ALLOWED_TABLE}`);

  const total = await liveCount();
  console.log(`[bind-corpus] rag_content_chunks rows (source='ncert_2025'): ${total}`);

  const seedPath = resolve(__dirname, '..', 'golden', 'seed-queries.json');
  const seed = JSON.parse(readFileSync(seedPath, 'utf-8')) as { items: SeedItem[] };
  console.log(`[bind-corpus] seed items: ${seed.items.length}`);

  // Per-cell counts (printed counts only).
  const cells = new Map<string, number>();
  for (const it of seed.items) {
    const key = `${it.grade}/${it.subject}`;
    if (!cells.has(key)) cells.set(key, await cellCount(it.grade, it.subject));
  }
  console.log('[bind-corpus] per-cell live counts (grade/subject, is_active en):');
  for (const [k, v] of [...cells.entries()].sort()) {
    console.log(`             ${k}: ${v}`);
  }

  const out: Array<{
    id: string;
    query: string;
    query_type: string;
    grade: string;
    subject: string;
    chapter_number: number | null;
    target: SeedTarget;
    candidate_count: number;
    candidates: CandidateRow[];
  }> = [];

  for (const it of seed.items) {
    const candidates = await gatherCandidates(it);
    out.push({
      id: it.id,
      query: it.query,
      query_type: it.query_type,
      grade: it.grade,
      subject: it.subject,
      chapter_number: it.chapter_number,
      target: it.target,
      candidate_count: candidates.length,
      candidates,
    });
    if (printSummary) {
      console.log(`  ${it.id} [${it.grade}/${it.subject} ${it.query_type}] candidates=${candidates.length}`);
    }
  }

  const reportsDir = resolve(__dirname, '..', 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const outPath = resolve(reportsDir, 'binding-candidates.raw.json');
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        host: HOST,
        corpus_source: 'ncert_2025',
        corpus_total_rows: total,
        allowed_table: `public.${ALLOWED_TABLE}`,
        note: 'READ-ONLY candidate pool for Task 10 binding. Operator assigns PROVISIONAL relevance from chunk_text (A3 candidate-pool-independent).',
        items: out,
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );
  console.log(`[bind-corpus] wrote candidate dossier: ${outPath}`);
  console.log(`[bind-corpus] total candidates surfaced: ${out.reduce((s, x) => s + x.candidate_count, 0)}`);
}

main().catch((err) => {
  console.error(`[bind-corpus] FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
